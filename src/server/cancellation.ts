import { and, eq, inArray, sql } from "drizzle-orm";
import { type Database, getDb, schema } from "#/db";
import { formatMYR } from "#/lib/money";
import { notify } from "./notify";
import { emitOrbyteEvent } from "./orbyte";
import { deliveryBaseline } from "./revisions";

export class CancellationNeedsReviewError extends Error {}

type ReleasedStock = {
	productId: string;
	name: string;
	sku: string;
	unit: string;
	quantity: number;
};

export type SignedOrderCancellation = {
	quoteId: string;
	quoteNumber: string;
	alreadyCancelled: boolean;
	released: ReleasedStock[];
	voidedInvoices: number;
	paidInvoices: number;
	jobId: string | null;
};

async function markMessageProcessed(
	db: Database,
	input: { requestId?: string | null; messageId?: string | null },
	conversationId: string,
) {
	if (!input.requestId || !input.messageId) return;
	const request = await db.query.quoteRequests.findFirst({
		where: eq(schema.quoteRequests.id, input.requestId),
		columns: { id: true, conversationId: true },
	});
	if (request?.conversationId !== conversationId) return;
	await db
		.update(schema.quoteRequests)
		.set({ processedMessageId: input.messageId, updatedAt: new Date() })
		.where(eq(schema.quoteRequests.id, request.id));
}

/**
 * Cancels one signed order and releases exactly the stock rows reserved for it.
 * The quote lock makes retries and concurrent customer turns idempotent.
 */
export async function cancelSignedOrder(input: {
	quoteId: string;
	actor: string;
	note?: string | null;
	messageId?: string | null;
	processedRequestId?: string | null;
}): Promise<SignedOrderCancellation> {
	return getDb().transaction(async (db) => {
		const [quote] = await db
			.select()
			.from(schema.quotes)
			.where(eq(schema.quotes.id, input.quoteId))
			.for("update");
		if (!quote) throw new Error("Quotation not found");

		const request = await db.query.quoteRequests.findFirst({
			where: eq(schema.quoteRequests.id, quote.requestId),
		});
		if (!request) throw new Error("Quotation requirements not found");
		await markMessageProcessed(
			db,
			{ requestId: input.processedRequestId, messageId: input.messageId },
			request.conversationId,
		);

		if (quote.status === "cancelled")
			return {
				quoteId: quote.id,
				quoteNumber: quote.number,
				alreadyCancelled: true,
				released: [],
				voidedInvoices: 0,
				paidInvoices: 0,
				jobId: null,
			};
		if (quote.status === "superseded")
			throw new CancellationNeedsReviewError(
				"The signed agreement changed while cancellation was being processed",
			);
		if (quote.status !== "accepted")
			throw new Error("Only a signed order can be cancelled");

		let [job] = await db
			.select()
			.from(schema.jobs)
			.where(eq(schema.jobs.quoteId, quote.id))
			.for("update");
		// A freshly signed project revision may be cancelled before its worker has
		// moved the existing job to the new quote. Find and lock that baseline job.
		if (!job) {
			const baseline = await deliveryBaseline(db, quote);
			if (baseline?.job)
				[job] = await db
					.select()
					.from(schema.jobs)
					.where(eq(schema.jobs.id, baseline.job.id))
					.for("update");
		}
		if (job && ["completed", "closed"].includes(job.status))
			throw new CancellationNeedsReviewError(
				"The order was already completed and needs staff review",
			);

		const reservations = await db
			.select()
			.from(schema.stockReservations)
			.where(eq(schema.stockReservations.quoteId, quote.id))
			.orderBy(schema.stockReservations.productId)
			.for("update");
		if (reservations.some((row) => row.deliveredAt))
			throw new CancellationNeedsReviewError(
				"Some stock was already delivered and needs staff review",
			);
		const openReservations = reservations.filter((row) => !row.releasedAt);
		const productIds = openReservations.map((row) => row.productId);
		const products = productIds.length
			? await db
					.select()
					.from(schema.products)
					.where(inArray(schema.products.id, productIds))
					.orderBy(schema.products.id)
					.for("update")
			: [];
		const productById = new Map(
			products.map((product) => [product.id, product]),
		);
		const released: ReleasedStock[] = [];
		for (const reservation of openReservations) {
			const product = productById.get(reservation.productId);
			if (!product || product.stockReserved < reservation.quantity)
				throw new CancellationNeedsReviewError(
					"Reserved stock needs reconciliation before this order can be cancelled",
				);
			await db
				.update(schema.products)
				.set({
					stockReserved: sql`${schema.products.stockReserved} - ${reservation.quantity}`,
				})
				.where(eq(schema.products.id, product.id));
			released.push({
				productId: product.id,
				name: product.name,
				sku: product.sku,
				unit: product.unit,
				quantity: reservation.quantity,
			});
		}

		const now = new Date();
		if (openReservations.length)
			await db
				.update(schema.stockReservations)
				.set({ releasedAt: now })
				.where(
					inArray(
						schema.stockReservations.id,
						openReservations.map((row) => row.id),
					),
				);

		const [cancelled] = await db
			.update(schema.quotes)
			.set({
				status: "cancelled",
				cancelledAt: now,
				cancelledBy: input.actor,
				cancellationNote: input.note?.trim().slice(0, 500) || null,
			})
			.where(eq(schema.quotes.id, quote.id))
			.returning();

		// A draft or sent revision cannot remain signable after the agreement it
		// revises has been cancelled. Only requests explicitly linked to this quote
		// are closed; unrelated enquiries in the same chat are left alone.
		const conversationRequests = await db.query.quoteRequests.findMany({
			where: eq(schema.quoteRequests.conversationId, request.conversationId),
		});
		const revisionRequests = conversationRequests.filter(
			(candidate) =>
				candidate.id !== request.id && candidate.brief.revisionOf === quote.id,
		);
		if (revisionRequests.length) {
			const revisionRequestIds = revisionRequests.map(
				(candidate) => candidate.id,
			);
			await db
				.update(schema.quotes)
				.set({
					status: "cancelled",
					cancelledAt: now,
					cancelledBy: input.actor,
					cancellationNote: "Underlying signed order was cancelled",
				})
				.where(
					and(
						inArray(schema.quotes.requestId, revisionRequestIds),
						inArray(schema.quotes.status, ["draft", "approved"]),
					),
				);
			const openRevisionRequestIds = revisionRequests
				.filter((candidate) =>
					["gathering", "confirming", "needs_review", "draft_ready"].includes(
						candidate.status,
					),
				)
				.map((candidate) => candidate.id);
			if (openRevisionRequestIds.length)
				await db
					.update(schema.quoteRequests)
					.set({ status: "rejected", updatedAt: now })
					.where(inArray(schema.quoteRequests.id, openRevisionRequestIds));
		}

		if (job) {
			await db
				.update(schema.jobs)
				.set({ status: "cancelled", cancelledAt: now, updatedAt: now })
				.where(eq(schema.jobs.id, job.id));
			await db
				.update(schema.relays)
				.set({
					status: "rejected",
					rejectReason: "Order cancelled by the customer",
				})
				.where(
					and(
						eq(schema.relays.jobId, job.id),
						inArray(schema.relays.status, ["pending", "sent"]),
					),
				);
			await db.insert(schema.jobChat).values({
				jobId: job.id,
				role: "system",
				body: `The customer cancelled ${quote.number}. Work has stopped${released.length ? " and its reserved stock was released" : ""}.`,
			});
		}

		const voided = await db
			.update(schema.invoices)
			.set({ status: "void", remindersPaused: true })
			.where(
				and(
					eq(schema.invoices.quoteId, quote.id),
					eq(schema.invoices.status, "sent"),
				),
			)
			.returning({ id: schema.invoices.id, number: schema.invoices.number });
		const paid = await db
			.select({ id: schema.invoices.id, amountSen: schema.invoices.amountSen })
			.from(schema.invoices)
			.where(
				and(
					eq(schema.invoices.quoteId, quote.id),
					eq(schema.invoices.status, "paid"),
				),
			);
		await db
			.update(schema.quoteFollowUps)
			.set({ status: "cancelled" })
			.where(
				and(
					eq(schema.quoteFollowUps.quoteId, quote.id),
					eq(schema.quoteFollowUps.status, "scheduled"),
				),
			);

		for (const stock of released)
			await emitOrbyteEvent(db, {
				businessId: quote.businessId,
				requestId: request.id,
				type: "stock.released",
				actor: input.actor,
				summary: `Released ${stock.quantity} ${stock.unit} of ${stock.name} (${stock.sku}) from cancelled order ${quote.number}`,
				payload: {
					quoteId: quote.id,
					productId: stock.productId,
					quantity: stock.quantity,
				},
			});
		await emitOrbyteEvent(db, {
			businessId: quote.businessId,
			requestId: request.id,
			type: "quote.cancelled",
			actor: input.actor,
			summary: `${input.actor} cancelled signed order ${quote.number}${input.note ? `: ${input.note}` : ""}`,
			payload: {
				quoteId: quote.id,
				jobId: job?.id ?? null,
				released: released.map((stock) => ({
					productId: stock.productId,
					quantity: stock.quantity,
				})),
				voidedInvoiceIds: voided.map((invoice) => invoice.id),
				paidInvoiceIds: paid.map((invoice) => invoice.id),
			},
		});
		if (job)
			await emitOrbyteEvent(db, {
				businessId: quote.businessId,
				requestId: request.id,
				type: "job.cancelled",
				actor: input.actor,
				summary: `${job.number} cancelled after the customer cancelled ${quote.number}`,
				payload: { jobId: job.id, quoteId: quote.id },
			});

		const approvers = await db
			.select({ id: schema.staff.id })
			.from(schema.staff)
			.where(
				and(
					eq(schema.staff.businessId, quote.businessId),
					eq(schema.staff.canApprove, true),
				),
			);
		const paidSen = paid.reduce((sum, invoice) => sum + invoice.amountSen, 0);
		await notify(db, {
			businessId: quote.businessId,
			staffIds: [...approvers.map((member) => member.id), job?.picId],
			title: `Customer cancelled ${quote.number}`,
			body: `${released.length ? `${released.map((stock) => `${stock.quantity} ${stock.unit} ${stock.name}`).join(", ")} released. ` : ""}${voided.length ? `${voided.length} unpaid invoice${voided.length === 1 ? "" : "s"} voided. ` : ""}${paid.length ? `${formatMYR(paidSen)} already paid — review any refund separately.` : "No paid invoice requires refund review."}`,
			link: job
				? `/orbyte/${quote.businessId}/work/${job.id}?tab=billing`
				: `/orbyte/${quote.businessId}/inbox?c=${request.conversationId}`,
		});

		return {
			quoteId: cancelled.id,
			quoteNumber: cancelled.number,
			alreadyCancelled: false,
			released,
			voidedInvoices: voided.length,
			paidInvoices: paid.length,
			jobId: job?.id ?? null,
		};
	});
}

/** Records and routes a cancellation that cannot safely be completed automatically. */
export async function flagCancellationForReview(input: {
	quoteId: string;
	actor: string;
	reason: string;
}) {
	return getDb().transaction(async (db) => {
		const quote = await db.query.quotes.findFirst({
			where: eq(schema.quotes.id, input.quoteId),
		});
		if (!quote) return;
		const request = await db.query.quoteRequests.findFirst({
			where: eq(schema.quoteRequests.id, quote.requestId),
		});
		const job = await db.query.jobs.findFirst({
			where: eq(schema.jobs.quoteId, quote.id),
		});
		const approvers = await db
			.select({ id: schema.staff.id })
			.from(schema.staff)
			.where(
				and(
					eq(schema.staff.businessId, quote.businessId),
					eq(schema.staff.canApprove, true),
				),
			);
		await emitOrbyteEvent(db, {
			businessId: quote.businessId,
			requestId: request?.id,
			type: "quote.cancellation_review_requested",
			actor: input.actor,
			summary: `${input.actor} asked to cancel ${quote.number}; staff review needed: ${input.reason}`,
		});
		await notify(db, {
			businessId: quote.businessId,
			staffIds: [...approvers.map((member) => member.id), job?.picId],
			title: `Review cancellation: ${quote.number}`,
			body: input.reason,
			link: job
				? `/orbyte/${quote.businessId}/work/${job.id}?tab=billing`
				: request
					? `/orbyte/${quote.businessId}/inbox?c=${request.conversationId}`
					: undefined,
		});
	});
}
