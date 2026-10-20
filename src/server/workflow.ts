/**
 * The quotation workflow: customer message → structured request → pricing
 * check → draft / clarification / human review → approval → reply.
 */
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "#/db";
import type { ExtractedRequest, Flag, LineItem } from "#/db/schema";
import { composeReply, extractRequest } from "./ai";
import { emitOrbyteEvent } from "./orbyte";
import { formatMYR, type Outcome, priceRequest, totals } from "./pricing";

export type WorkflowStep =
	| { step: "received" }
	| { step: "parsed"; summary: string; language: string; itemCount: number }
	| { step: "priced"; outcome: Outcome; flags: Flag[]; requestId: string }
	| { step: "replied"; body: string }
	| { step: "failed"; error: string };

async function loadCatalog(businessId: string) {
	const db = getDb();
	const [business, products, rules] = await Promise.all([
		db.query.businesses.findFirst({
			where: eq(schema.businesses.id, businessId),
		}),
		db
			.select()
			.from(schema.products)
			.where(
				and(
					eq(schema.products.businessId, businessId),
					eq(schema.products.active, true),
				),
			),
		db
			.select()
			.from(schema.pricingRules)
			.where(eq(schema.pricingRules.businessId, businessId)),
	]);
	if (!business) throw new Error(`Unknown business ${businessId}`);
	return { business, products, rules };
}

async function nextQuoteNumber(businessId: string, prefix: string) {
	const db = getDb();
	const [{ n }] = await db
		.select({ n: count() })
		.from(schema.quotes)
		.where(eq(schema.quotes.businessId, businessId));
	return `${prefix}-Q-${String(n + 1).padStart(4, "0")}`;
}

/** Open = still being worked on (not approved or rejected). */
async function findOpenRequest(conversationId: string) {
	return getDb().query.quoteRequests.findFirst({
		where: and(
			eq(schema.quoteRequests.conversationId, conversationId),
			inArray(schema.quoteRequests.status, [
				"needs_clarification",
				"needs_review",
				"draft_ready",
			]),
		),
		orderBy: desc(schema.quoteRequests.createdAt),
	});
}

export async function* handleCustomerMessage(input: {
	conversationId: string;
	body: string;
}): AsyncGenerator<WorkflowStep> {
	const db = getDb();
	const conversation = await db.query.conversations.findFirst({
		where: eq(schema.conversations.id, input.conversationId),
	});
	if (!conversation) throw new Error("Conversation not found");
	const { businessId } = conversation;

	await db.insert(schema.messages).values({
		conversationId: conversation.id,
		sender: "customer",
		body: input.body,
	});
	const open = await findOpenRequest(conversation.id);
	await emitOrbyteEvent(db, {
		businessId,
		requestId: open?.id,
		type: "quote.request.received",
		actor: conversation.customerName,
		summary: `Message from ${conversation.customerName}`,
		payload: { body: input.body },
	});
	yield { step: "received" };

	const { business, products, rules } = await loadCatalog(businessId);

	// Only messages since the last closed request belong to this request.
	const lastClosed = await db.query.quoteRequests.findFirst({
		where: and(
			eq(schema.quoteRequests.conversationId, conversation.id),
			inArray(schema.quoteRequests.status, ["approved", "rejected"]),
		),
		orderBy: desc(schema.quoteRequests.updatedAt),
	});
	const history = (
		await db.query.messages.findMany({
			where: eq(schema.messages.conversationId, conversation.id),
			orderBy: asc(schema.messages.createdAt),
		})
	).filter((m) => !lastClosed || m.createdAt > lastClosed.updatedAt);

	let extracted: ExtractedRequest;
	try {
		extracted = await extractRequest({
			businessName: business.name,
			industry: business.industry,
			products,
			history,
		});
	} catch (err) {
		// Never guess: if the AI fails, hand the conversation to a human.
		const message = err instanceof Error ? err.message : String(err);
		const flags: Flag[] = [
			{
				kind: "ai_uncertain",
				message: "Automatic reading failed — please handle manually.",
			},
		];
		const request = await upsertRequest(open?.id, {
			businessId,
			conversationId: conversation.id,
			status: "needs_review",
			extracted: open?.extracted ?? {
				language: "en",
				summary: input.body.slice(0, 120),
				items: [],
				location: null,
				neededBy: null,
			},
			flags,
		});
		await emitOrbyteEvent(db, {
			businessId,
			requestId: request.id,
			type: "quote.processing_failed",
			actor: "quora-chat",
			summary: "AI could not read the message; flagged for staff",
			payload: { error: message },
		});
		yield { step: "failed", error: message };
		return;
	}

	yield {
		step: "parsed",
		summary: extracted.summary,
		language: extracted.language,
		itemCount: extracted.items.length,
	};

	const result = priceRequest(extracted, products, rules);
	const request = await upsertRequest(open?.id, {
		businessId,
		conversationId: conversation.id,
		status: result.outcome,
		extracted,
		flags: result.flags,
	});
	await emitOrbyteEvent(db, {
		businessId,
		requestId: request.id,
		type: "quote.request.parsed",
		actor: "quora-chat",
		summary: extracted.summary,
		payload: { extracted },
	});

	if (result.outcome === "needs_clarification") {
		await emitOrbyteEvent(db, {
			businessId,
			requestId: request.id,
			type: "quote.request.clarification_requested",
			actor: "quora-chat",
			summary: `Asked customer for ${result.flags.filter((f) => f.kind === "missing_info").length} missing detail(s)`,
			payload: { flags: result.flags },
		});
	} else {
		const quote = await upsertDraftQuote(
			request.id,
			business,
			result.lineItems,
		);
		await emitOrbyteEvent(db, {
			businessId,
			requestId: request.id,
			type:
				result.outcome === "needs_review"
					? "quote.request.flagged_for_review"
					: "quote.draft.prepared",
			actor: "quora-chat",
			summary:
				result.outcome === "needs_review"
					? `Flagged for review: ${result.flags.map((f) => f.message).join("; ")}`
					: `Draft ${quote.number} prepared (${formatMYR(quote.totalSen)})`,
			payload: { quoteId: quote.id, flags: result.flags },
		});
	}
	yield {
		step: "priced",
		outcome: result.outcome,
		flags: result.flags,
		requestId: request.id,
	};

	const reply = await composeReply({
		businessName: business.name,
		language: extracted.language,
		outcome: result.outcome,
		flags: result.flags,
		summary: extracted.summary,
	}).catch(() => "Thanks! Our team will get back to you shortly.");

	await db.insert(schema.messages).values({
		conversationId: conversation.id,
		sender: "assistant",
		body: reply,
	});
	yield { step: "replied", body: reply };
}

async function upsertRequest(
	existingId: string | undefined,
	values: typeof schema.quoteRequests.$inferInsert,
) {
	const db = getDb();
	if (existingId) {
		const [row] = await db
			.update(schema.quoteRequests)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(schema.quoteRequests.id, existingId))
			.returning();
		return row;
	}
	const [row] = await db
		.insert(schema.quoteRequests)
		.values(values)
		.returning();
	return row;
}

async function upsertDraftQuote(
	requestId: string,
	business: typeof schema.businesses.$inferSelect,
	lineItems: LineItem[],
) {
	const db = getDb();
	const t = totals(lineItems, business.sstRateBps, business.sstRegistered);
	const validUntil = new Date(
		Date.now() + business.quoteValidityDays * 86_400_000,
	);
	const existing = await db.query.quotes.findFirst({
		where: and(
			eq(schema.quotes.requestId, requestId),
			eq(schema.quotes.status, "draft"),
		),
	});
	if (existing) {
		const [row] = await db
			.update(schema.quotes)
			.set({ lineItems, ...t, validUntil })
			.where(eq(schema.quotes.id, existing.id))
			.returning();
		return row;
	}
	const [row] = await db
		.insert(schema.quotes)
		.values({
			number: await nextQuoteNumber(business.id, business.quotePrefix),
			businessId: business.id,
			requestId,
			lineItems,
			...t,
			validUntil,
		})
		.returning();
	return row;
}

// --- Staff actions -----------------------------------------------------------

async function loadStaff(staffId: string, businessId: string) {
	const member = await getDb().query.staff.findFirst({
		where: and(
			eq(schema.staff.id, staffId),
			eq(schema.staff.businessId, businessId),
		),
	});
	if (!member) throw new Error("Staff member not found for this business");
	return member;
}

export async function editDraftQuote(input: {
	quoteId: string;
	staffId: string;
	lineItems: LineItem[];
	notes: string | null;
}) {
	const db = getDb();
	const quote = await db.query.quotes.findFirst({
		where: eq(schema.quotes.id, input.quoteId),
	});
	if (!quote) throw new Error("Quote not found");
	if (quote.status !== "draft") throw new Error("Only drafts can be edited");
	const member = await loadStaff(input.staffId, quote.businessId);
	const business = await db.query.businesses.findFirst({
		where: eq(schema.businesses.id, quote.businessId),
	});
	if (!business) throw new Error("Business not found");

	const lineItems = input.lineItems.map((l) => ({
		...l,
		amountSen: l.amountSen ?? l.unitPriceSen * l.quantity,
	}));
	const [row] = await db
		.update(schema.quotes)
		.set({
			lineItems,
			notes: input.notes,
			...totals(lineItems, business.sstRateBps, business.sstRegistered),
		})
		.where(eq(schema.quotes.id, quote.id))
		.returning();
	await emitOrbyteEvent(db, {
		businessId: quote.businessId,
		requestId: quote.requestId,
		type: "quote.draft.edited",
		actor: member.name,
		summary: `${member.name} edited ${quote.number} (${formatMYR(row.totalSen)})`,
	});
	return row;
}

export async function decideQuote(input: {
	quoteId: string;
	staffId: string;
	decision: "approved" | "rejected";
	reason?: string;
}) {
	const db = getDb();
	const quote = await db.query.quotes.findFirst({
		where: eq(schema.quotes.id, input.quoteId),
	});
	if (!quote) throw new Error("Quote not found");
	if (quote.status !== "draft")
		throw new Error("Quote has already been decided");
	const member = await loadStaff(input.staffId, quote.businessId);
	if (!member.canApprove)
		throw new Error(`${member.name} is not authorised to approve quotes`);
	if (
		input.decision === "approved" &&
		(quote.lineItems.length === 0 || quote.totalSen <= 0)
	) {
		throw new Error("Add at least one priced line before approving");
	}
	if (
		input.decision === "approved" &&
		quote.lineItems.some((l) => l.unitPriceSen <= 0)
	) {
		throw new Error("Every line needs a price before approving");
	}

	const request = await db.query.quoteRequests.findFirst({
		where: eq(schema.quoteRequests.id, quote.requestId),
	});
	if (!request) throw new Error("Request not found");

	const now = new Date();
	const [row] = await db
		.update(schema.quotes)
		.set({ status: input.decision, decidedBy: member.id, decidedAt: now })
		.where(eq(schema.quotes.id, quote.id))
		.returning();
	await db
		.update(schema.quoteRequests)
		.set({ status: input.decision, updatedAt: now })
		.where(eq(schema.quoteRequests.id, request.id));

	await emitOrbyteEvent(db, {
		businessId: quote.businessId,
		requestId: request.id,
		type: input.decision === "approved" ? "quote.approved" : "quote.rejected",
		actor: member.name,
		summary:
			input.decision === "approved"
				? `${member.name} approved ${quote.number} (${formatMYR(quote.totalSen)})`
				: `${member.name} rejected ${quote.number}${input.reason ? `: ${input.reason}` : ""}`,
	});

	if (input.decision === "approved") {
		const lines = quote.lineItems
			.map(
				(l) => `• ${l.description} × ${l.quantity} — ${formatMYR(l.amountSen)}`,
			)
			.join("\n");
		const body = `Quotation ${quote.number}\n${lines}\nSubtotal ${formatMYR(quote.subtotalSen)}\nSST ${formatMYR(quote.sstSen)}\nTotal ${formatMYR(quote.totalSen)}\nValid until ${quote.validUntil.toLocaleDateString("en-MY")}`;
		await db.insert(schema.messages).values({
			conversationId: request.conversationId,
			sender: "staff",
			body,
			quoteId: quote.id,
		});
		await emitOrbyteEvent(db, {
			businessId: quote.businessId,
			requestId: request.id,
			type: "quote.sent_to_customer",
			actor: "quora-chat",
			summary: `${quote.number} sent to customer`,
		});
	}
	return row;
}
