/**
 * After the customer signs: hand the job to a person in charge (PIC).
 * Mirrors Orbyte's Clients → Projects → Tasks. Each job has an internal team
 * group (PIC, assigned workers and the AI, which answers when tagged @AI).
 * The team never talks to the customer; questions go through sales approval
 * and Quora Chat.
 */
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { type Database, getDb, schema } from "#/db";
import type { BotAction, BotSource, Handover } from "#/db/schema";
import { answerText } from "#/lib/intake";
import { AI_MENTION, findMentions, withoutAiTag } from "#/lib/mentions";
import { formatMYR } from "#/lib/money";
import {
	answerJobQuestion,
	draftCustomerQuestion,
	type JobContext,
	readRelayAnswer,
	writeHandover,
} from "./ai";
import { findKnowledge } from "./knowledge";
import { emitOrbyteEvent } from "./orbyte";
import { deliveryBaseline } from "./revisions";
import { enqueueTask, finishTask, type TaskClaim } from "./tasks";

type Quote = typeof schema.quotes.$inferSelect;
type Request = typeof schema.quoteRequests.$inferSelect;
type JobKind = (typeof schema.jobKind.enumValues)[number];

export const jobKindLabel: Record<JobKind, string> = {
	delivery_order: "Delivery order",
	job_order: "Job order",
	project: "Project",
};
const kindCode: Record<JobKind, string> = {
	delivery_order: "DO",
	job_order: "JO",
	project: "PRJ",
};

// --- Notifications (simulated Orbyte app + email) --------------------------------------

export async function notify(
	db: Database,
	n: {
		businessId: string;
		staffIds: (string | null | undefined)[];
		title: string;
		body: string;
		link?: string;
	},
) {
	const ids = [...new Set(n.staffIds.filter((x): x is string => Boolean(x)))];
	if (!ids.length) return;
	await db.insert(schema.notifications).values(
		ids.map((staffId) => ({
			businessId: n.businessId,
			staffId,
			title: n.title,
			body: n.body,
			link: n.link ?? null,
		})),
	);
}

const jobLink = (businessId: string, jobId: string) =>
	`/orbyte/${businessId}/work/${jobId}`;

// --- Creating the job on signing ----------------------------------------------------------

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

/** Called when the customer signs: client, job, PIC, then the AI writes the handover. */
export async function startHandover(
	quote: Quote,
	request: Request,
	claim?: TaskClaim,
) {
	return getDb().transaction(async (db) => {
		if (claim) await finishTask(db, claim);
		if (quote.status !== "accepted")
			throw new Error("Only a signed quotation can create a job");
		await db
			.select({ id: schema.businesses.id })
			.from(schema.businesses)
			.where(eq(schema.businesses.id, quote.businessId))
			.for("update");
		const existing = await db.query.jobs.findFirst({
			where: eq(schema.jobs.quoteId, quote.id),
		});
		if (existing) {
			if (!existing.handover)
				await enqueueTask(db, "prepare_handover", existing.id, quote.id);
			return existing;
		}
		const baseline = await deliveryBaseline(db, quote);
		const [previousJob] = baseline?.job
			? await db
					.select()
					.from(schema.jobs)
					.where(eq(schema.jobs.id, baseline.job.id))
					.for("update")
			: [];
		if (previousJob) {
			if (
				previousJob.kind !== "project" ||
				["completed", "closed"].includes(previousJob.status)
			)
				throw new Error("This signed change needs a separate job review");
			const [updated] = await db
				.update(schema.jobs)
				.set({
					quoteId: quote.id,
					requestId: request.id,
					status: "preparing",
					handover: null,
					agreementReviewRequired: true,
					updatedAt: new Date(),
				})
				.where(eq(schema.jobs.id, previousJob.id))
				.returning();
			await db
				.update(schema.jobTasks)
				.set({
					status: "blocked",
					note: `Signed scope changed (${quote.number}). Review this task against the new agreement.`,
				})
				.where(
					and(
						eq(schema.jobTasks.jobId, previousJob.id),
						sql`${schema.jobTasks.status} <> 'done'`,
					),
				);
			await postSystem(
				db,
				previousJob.id,
				`The customer signed a revised agreement (${quote.number}). Outstanding tasks are blocked until the PIC reviews the new scope.`,
			);
			await emitOrbyteEvent(db, {
				businessId: quote.businessId,
				requestId: request.id,
				type: "job.agreement_changed",
				actor: "quora-chat",
				summary: `${previousJob.number} updated to ${quote.number}; outstanding tasks require PIC review`,
				payload: {
					jobId: previousJob.id,
					previousQuoteId: previousJob.quoteId,
					previousHandover: previousJob.handover,
				},
			});
			await enqueueTask(db, "prepare_handover", previousJob.id, quote.id);
			return updated;
		}

		const [business, conversation] = await Promise.all([
			db.query.businesses.findFirst({
				where: eq(schema.businesses.id, quote.businessId),
			}),
			db.query.conversations.findFirst({
				where: eq(schema.conversations.id, request.conversationId),
			}),
		]);
		if (!business || !conversation) throw new Error("Business or chat missing");

		// Client: the company name from the brief, else the customer's name.
		const companyAnswer = (quote.requirementsSnapshot ?? request.brief).general
			.company_name;
		const clientName =
			(companyAnswer && companyAnswer.source !== "skipped"
				? companyAnswer.values[0]
				: null) || conversation.customerName;
		let client = await db.query.clients.findFirst({
			where: and(
				eq(schema.clients.businessId, business.id),
				sql`lower(${schema.clients.name}) = ${clientName.toLowerCase()}`,
			),
		});
		if (!client) {
			[client] = await db
				.insert(schema.clients)
				.values({
					businessId: business.id,
					name: clientName,
					contactName: conversation.customerName,
					phone: conversation.customerPhone,
				})
				.returning();
		}

		// Kind: custom-priced → Project; any service → Job order; all stock → Delivery order.
		const productIds = quote.lineItems.flatMap((l) =>
			l.productId ? [l.productId] : [],
		);
		const products = productIds.length
			? await db
					.select()
					.from(schema.products)
					.where(inArray(schema.products.id, productIds))
			: [];
		const kind: JobKind = products.some((p) => p.pricingMode === "custom")
			? "project"
			: products.length > 0 && products.every((p) => p.type === "stock")
				? "delivery_order"
				: "job_order";

		// PIC: the default for the first item's category, else the first approver.
		const first = products.find((p) => p.id === productIds[0]);
		const setting = first
			? await db.query.categorySettings.findFirst({
					where: and(
						eq(schema.categorySettings.businessId, business.id),
						eq(schema.categorySettings.category, first.category),
					),
				})
			: undefined;
		const fallback = await db.query.staff.findFirst({
			where: and(
				eq(schema.staff.businessId, business.id),
				eq(schema.staff.canApprove, true),
			),
		});
		const picId = setting?.defaultPicId ?? fallback?.id ?? null;

		const [{ n }] = await db
			.select({ n: count() })
			.from(schema.jobs)
			.where(
				and(
					eq(schema.jobs.businessId, business.id),
					eq(schema.jobs.kind, kind),
				),
			);
		const number = `${business.quotePrefix}-${kindCode[kind]}-${String(n + 1).padStart(4, "0")}`;
		const firstName = first?.name ?? quote.lineItems[0]?.description ?? "Job";
		const [job] = await db
			.insert(schema.jobs)
			.values({
				number,
				businessId: business.id,
				clientId: client.id,
				requestId: request.id,
				quoteId: quote.id,
				conversationId: conversation.id,
				kind,
				title: `${firstName} for ${client.name}`,
				picId,
			})
			.returning();
		if (picId) await joinGroup(db, job.id, picId, null);

		await emitOrbyteEvent(db, {
			businessId: business.id,
			requestId: request.id,
			type: "job.created",
			actor: "quora-chat",
			summary: `${jobKindLabel[kind]} ${number} created for ${client.name}`,
			payload: { jobId: job.id, quoteId: quote.id },
		});

		await enqueueTask(db, "prepare_handover", job.id, quote.id);
		return job;
	});
}

/** Plain-text context about a job for the AI: brief, quote, files, chat. */
async function jobContext(jobId: string) {
	const db = getDb();
	const job = await db.query.jobs.findFirst({
		where: eq(schema.jobs.id, jobId),
	});
	if (!job) throw new Error("Job not found");
	const [business, client, request, quote, conversation, products, questions] =
		await Promise.all([
			db.query.businesses.findFirst({
				where: eq(schema.businesses.id, job.businessId),
			}),
			db.query.clients.findFirst({
				where: eq(schema.clients.id, job.clientId),
			}),
			db.query.quoteRequests.findFirst({
				where: eq(schema.quoteRequests.id, job.requestId),
			}),
			db.query.quotes.findFirst({ where: eq(schema.quotes.id, job.quoteId) }),
			db.query.conversations.findFirst({
				where: eq(schema.conversations.id, job.conversationId),
			}),
			db
				.select()
				.from(schema.products)
				.where(eq(schema.products.businessId, job.businessId)),
			db
				.select()
				.from(schema.intakeQuestions)
				.where(eq(schema.intakeQuestions.businessId, job.businessId)),
		]);
	if (!business || !client || !request || !quote || !conversation)
		throw new Error("Job context is incomplete");
	const allMessages = await db.query.messages.findMany({
		where: eq(schema.messages.conversationId, conversation.id),
		orderBy: asc(schema.messages.createdAt),
		columns: { attachmentData: false },
	});
	const messages = allMessages.filter(
		(m) =>
			m.createdAt >= request.createdAt &&
			(!quote.signedAt || m.createdAt <= quote.signedAt),
	);
	const agreedBrief = quote.requirementsSnapshot ?? request.brief;

	const brief = [
		...agreedBrief.items.flatMap((item) => [
			`${item.productName ?? item.rawText}${item.quantity ? ` × ${item.quantity}` : ""}`,
			...Object.entries(item.answers).map(
				([key, answer]) =>
					`${item.productName ?? item.rawText}: ${answer.label ?? questions.find((q) => q.key === key)?.label ?? key} → ${answerText(answer)}`,
			),
		]),
		...Object.entries(agreedBrief.general).map(
			([key, answer]) =>
				`${answer.label ?? questions.find((q) => q.key === key)?.label ?? key} → ${answerText(answer)}`,
		),
		...agreedBrief.followUps
			.filter((f) => f.answer)
			.map((f) => `${f.question} → ${f.answer}`),
	];
	const refOf = new Map(messages.map((m, i) => [m.id, `m${i + 1}`]));
	const quoteProducts = products.filter((p) =>
		quote.lineItems.some((l) => l.productId === p.id),
	);
	const context: JobContext = {
		businessName: business.name,
		industry: business.industry,
		customerName: conversation.customerName,
		clientName: client.name,
		jobKind: jobKindLabel[job.kind],
		language: agreedBrief.language,
		brief,
		quote: [
			...quote.lineItems.map(
				(l) =>
					`${l.description} × ${l.quantity} ${l.unit} @ ${formatMYR(l.unitPriceSen)} = ${formatMYR(l.amountSen)}${l.notes ? ` (${l.notes})` : ""}`,
			),
			`Total ${formatMYR(quote.totalSen)}, quotation ${quote.number}, signed by ${quote.signerName ?? "customer"}`,
			...(quote.notes ? [`Notes on quote: ${quote.notes}`] : []),
		],
		files: messages
			.filter((m) => m.attachment)
			.map((m) => ({
				ref: refOf.get(m.id) ?? m.id,
				name: m.attachment?.name ?? "file",
			})),
		chat: messages.map((m) => ({
			ref: refOf.get(m.id) ?? m.id,
			who:
				m.sender === "customer"
					? "CUSTOMER"
					: m.sender === "staff"
						? `STAFF (${m.authorName ?? "staff"})`
						: "QUORA CHAT",
			at: m.createdAt.toISOString().slice(0, 16).replace("T", " "),
			body: `${m.attachment ? `[file: ${m.attachment.name}] ` : ""}${m.body}`,
		})),
		catalog: quoteProducts.map(
			(p) => `${p.name} (${p.sku}): ${p.description} Sold per ${p.unit}.`,
		),
	};
	return {
		job,
		business,
		client,
		request,
		quote,
		conversation,
		messages,
		refOf,
		context,
	};
}

/** The AI writes the briefing and starting tasks, then the PIC is notified. */
export async function buildHandover(
	jobId: string,
	claim: TaskClaim,
	expectedQuoteId: string | null,
) {
	const { job, context, quote } = await jobContext(jobId);
	if (
		(expectedQuoteId && job.quoteId !== expectedQuoteId) ||
		quote.status === "superseded"
	) {
		await getDb().transaction((db) => finishTask(db, claim));
		return;
	}
	const knowledge = await findKnowledge(
		job.businessId,
		"team",
		[job.title, ...context.quote, ...context.catalog].join(" "),
		3,
	);
	const draft = await writeHandover({ ...context, knowledge });
	const { title: proposedTitle, tasks, ...handover } = draft;
	const title = proposedTitle || job.title;
	return getDb().transaction(async (db) => {
		await finishTask(db, claim);
		const [agreedQuote] = await db
			.select()
			.from(schema.quotes)
			.where(eq(schema.quotes.id, job.quoteId))
			.for("update");
		if (!agreedQuote || agreedQuote.status !== "accepted") return;
		const [current] = await db
			.select()
			.from(schema.jobs)
			.where(eq(schema.jobs.id, jobId))
			.for("update");
		if (current.quoteId !== job.quoteId) return;
		if (current.handover) return;
		await db
			.update(schema.jobs)
			.set({
				handover: current.agreementReviewRequired
					? { ...handover, suggestedTasks: tasks }
					: handover,
				title,
				status: "upcoming",
				updatedAt: new Date(),
			})
			.where(eq(schema.jobs.id, job.id));
		if (!current.agreementReviewRequired) {
			await db
				.delete(schema.jobTasks)
				.where(
					and(
						eq(schema.jobTasks.jobId, job.id),
						eq(schema.jobTasks.source, "ai"),
					),
				);
			if (tasks.length)
				await db.insert(schema.jobTasks).values(
					tasks.slice(0, 10).map((t, position) => ({
						jobId: job.id,
						title: t,
						position,
						source: "ai",
					})),
				);
		}
		await emitOrbyteEvent(db, {
			businessId: job.businessId,
			requestId: job.requestId,
			type: "job.handover_ready",
			actor: "quora-chat",
			summary: `Handover pack ready for ${job.number} (${tasks.length} starting tasks)`,
			payload: { jobId: job.id },
		});
		// The AI opens the team group with the briefing, so everyone starts from it.
		await db.insert(schema.jobChat).values({
			jobId: job.id,
			role: "assistant",
			body: `${current.agreementReviewRequired ? "The revised handover is ready" : "Handover pack is ready"}. ${handover.summary}\n\nI've read the whole customer chat, the signed quotation and the requirements. Tag @AI here with any question about this job. If the customer never said, I can draft a question for sales to send them.`,
			sources: [{ kind: "handover", label: "Handover pack" }],
		});
		const members = await loadMembers(db, job.id);
		await notify(db, {
			businessId: job.businessId,
			staffIds: [current.picId],
			title: `New ${jobKindLabel[job.kind].toLowerCase()}: ${job.number}`,
			body: `You're the PIC for "${title}". The handover pack and chat history are ready.`,
			link: jobLink(job.businessId, job.id),
		});
		await notify(db, {
			businessId: job.businessId,
			staffIds: members.map((m) => m.id).filter((id) => id !== current.picId),
			title: `Handover ready: ${job.number}`,
			body: `The handover pack for "${title}" is ready in the team chat.`,
			link: teamLink(job),
		});
	});
}

/** Manual retry requeues failed work; it never starts an untracked background promise. */
export async function prepareHandover(jobId: string) {
	return getDb().transaction(async (db) => {
		const [job] = await db
			.select()
			.from(schema.jobs)
			.where(eq(schema.jobs.id, jobId));
		if (!job) throw new Error("Job not found");
		if (job.handover)
			throw new Error("This job already has its agreed handover");
		await enqueueTask(db, "prepare_handover", jobId, job.quoteId);
		await db
			.update(schema.workflowTasks)
			.set({
				status: "pending",
				attempts: 0,
				runAfter: new Date(),
				lastError: null,
				claimToken: null,
				lockedUntil: null,
			})
			.where(
				and(
					eq(
						schema.workflowTasks.key,
						`prepare_handover:${jobId}:${job.quoteId}`,
					),
					eq(schema.workflowTasks.status, "failed"),
				),
			);
	});
}

// --- Job updates --------------------------------------------------------------------------

export async function updateJob(input: {
	jobId: string;
	staffId: string;
	status?: "upcoming" | "active" | "completed" | "closed";
	picId?: string | null;
	acknowledgeAgreement?: boolean;
}) {
	return getDb().transaction(async (db) => {
		const [job] = await db
			.select()
			.from(schema.jobs)
			.where(eq(schema.jobs.id, input.jobId))
			.for("update");
		if (!job) throw new Error("Job not found");
		const member = await loadStaff(input.staffId, job.businessId);
		const currentQuote = await db.query.quotes.findFirst({
			where: eq(schema.quotes.id, job.quoteId),
		});
		if (currentQuote?.status === "superseded")
			throw new Error("A signed revision is waiting for its updated handover");
		const patch: Partial<typeof schema.jobs.$inferInsert> = {
			updatedAt: new Date(),
		};
		if (input.acknowledgeAgreement) {
			if (member.id !== job.picId && !member.canApprove)
				throw new Error(
					"Only the PIC or an approver can acknowledge the revised agreement",
				);
			if (!job.handover)
				throw new Error(
					"Wait for the revised handover before reviewing the agreement",
				);
			patch.agreementReviewRequired = false;
			await emitOrbyteEvent(db, {
				businessId: job.businessId,
				requestId: job.requestId,
				type: "job.agreement_reviewed",
				actor: member.name,
				summary: `${member.name} reviewed the revised agreement and tasks for ${job.number}`,
			});
		}

		if (input.picId !== undefined && input.picId !== job.picId) {
			const pic = input.picId
				? await loadStaff(input.picId, job.businessId)
				: null;
			patch.picId = pic?.id ?? null;
			if (pic) await joinGroup(db, job.id, pic.id, member.id);
			await postSystem(
				db,
				job.id,
				pic
					? `${member.name} made ${pic.name} the person in charge`
					: `${member.name} unassigned the person in charge`,
			);
			await emitOrbyteEvent(db, {
				businessId: job.businessId,
				requestId: job.requestId,
				type: "job.assigned",
				actor: member.name,
				summary: `${member.name} assigned ${job.number} to ${pic?.name ?? "nobody"}`,
			});
			if (pic && pic.id !== member.id)
				await notify(db, {
					businessId: job.businessId,
					staffIds: [pic.id],
					title: `${job.number} assigned to you`,
					body: `${member.name} made you the PIC for "${job.title}".`,
					link: jobLink(job.businessId, job.id),
				});
		}
		if (input.status && input.status !== job.status) {
			if (
				job.agreementReviewRequired &&
				!input.acknowledgeAgreement &&
				["active", "completed", "closed"].includes(input.status)
			)
				throw new Error(
					"Review the revised agreement and outstanding tasks before resuming work",
				);
			if (job.status === "preparing")
				throw new Error("Wait for the handover pack to finish");
			patch.status = input.status;
			patch.completedAt = input.status === "completed" ? new Date() : null;
			await emitOrbyteEvent(db, {
				businessId: job.businessId,
				requestId: job.requestId,
				type: "job.status_changed",
				actor: member.name,
				summary: `${job.number} marked ${input.status} by ${member.name}`,
			});
			if (input.status === "completed")
				await deliverStock(db, job, member.name);
		}
		const [row] = await db
			.update(schema.jobs)
			.set(patch)
			.where(eq(schema.jobs.id, job.id))
			.returning();
		return row;
	});
}

/** Completing a job hands over its reserved stock (it leaves inventory). */
async function deliverStock(
	db: Database,
	job: typeof schema.jobs.$inferSelect,
	actor: string,
) {
	const quote = await db.query.quotes.findFirst({
		where: eq(schema.quotes.id, job.quoteId),
	});
	const ids =
		quote?.lineItems.flatMap((l) => (l.productId ? [l.productId] : [])) ?? [];
	const stock = ids.length
		? await db
				.select({ id: schema.products.id })
				.from(schema.products)
				.where(
					and(
						inArray(schema.products.id, ids),
						eq(schema.products.type, "stock"),
					),
				)
		: [];
	const recorded = await db
		.select()
		.from(schema.stockReservations)
		.where(eq(schema.stockReservations.quoteId, job.quoteId));
	if (stock.some((p) => !recorded.some((r) => r.productId === p.id)))
		throw new Error(
			"This legacy job needs its stock reservations reconciled before completion",
		);
	const reservations = await db
		.select()
		.from(schema.stockReservations)
		.where(
			and(
				eq(schema.stockReservations.quoteId, job.quoteId),
				sql`${schema.stockReservations.deliveredAt} IS NULL`,
			),
		)
		.orderBy(schema.stockReservations.productId)
		.for("update");
	for (const reservation of reservations) {
		const [p] = await db
			.select()
			.from(schema.products)
			.where(eq(schema.products.id, reservation.productId))
			.for("update");
		const n = reservation.quantity;
		if (p && p.stockReserved >= n && p.stockOnHand < n)
			throw new Error(
				`${p.name}: only ${p.stockOnHand} ${p.unit} on hand for ${n} reserved (waiting for restock). Receive the new stock in Products first.`,
			);
		if (!p || p.stockReserved < n)
			throw new Error(
				"Reserved stock needs reconciliation before this job can be completed",
			);
		await db
			.update(schema.products)
			.set({
				stockOnHand: sql`${schema.products.stockOnHand} - ${n}`,
				stockReserved: sql`${schema.products.stockReserved} - ${n}`,
			})
			.where(eq(schema.products.id, p.id));
		await db
			.update(schema.stockReservations)
			.set({ deliveredAt: new Date() })
			.where(eq(schema.stockReservations.id, reservation.id));
		await emitOrbyteEvent(db, {
			businessId: job.businessId,
			requestId: job.requestId,
			type: "stock.adjusted",
			actor,
			summary: `Delivered ${n} ${p.unit} of ${p.name} (${p.sku}) for ${job.number}`,
			payload: { productId: p.id, action: "deliver", quantity: n },
		});
	}
}

export async function addTask(input: {
	jobId: string;
	staffId: string;
	title: string;
	source?: "staff" | "bot";
}) {
	const db = getDb();
	const job = await db.query.jobs.findFirst({
		where: eq(schema.jobs.id, input.jobId),
	});
	if (!job) throw new Error("Job not found");
	const member = await loadStaff(input.staffId, job.businessId);
	const [{ max }] = await db
		.select({
			max: sql<number>`coalesce(max(${schema.jobTasks.position}), -1)`,
		})
		.from(schema.jobTasks)
		.where(eq(schema.jobTasks.jobId, job.id));
	const [row] = await db
		.insert(schema.jobTasks)
		.values({
			jobId: job.id,
			title: input.title.trim(),
			position: Number(max) + 1,
			source: input.source ?? "staff",
		})
		.returning();
	await emitOrbyteEvent(db, {
		businessId: job.businessId,
		requestId: job.requestId,
		type: "job.task_added",
		actor: member.name,
		summary: `${member.name} added a task to ${job.number}: ${row.title}`,
	});
	return row;
}

export async function updateTask(input: {
	taskId: string;
	status?: "todo" | "active" | "blocked" | "done";
	note?: string | null;
	title?: string;
}) {
	return getDb().transaction(async (db) => {
		const task = await db.query.jobTasks.findFirst({
			where: eq(schema.jobTasks.id, input.taskId),
		});
		if (!task) throw new Error("Task not found");
		const [job] = await db
			.select()
			.from(schema.jobs)
			.where(eq(schema.jobs.id, task.jobId))
			.for("update");
		const currentQuote = await db.query.quotes.findFirst({
			where: eq(schema.quotes.id, job.quoteId),
		});
		if (
			currentQuote?.status === "superseded" &&
			input.status &&
			["active", "done"].includes(input.status)
		)
			throw new Error(
				"Wait for the revised agreement handover before progressing these tasks",
			);
		if (
			job.agreementReviewRequired &&
			input.status &&
			["active", "done"].includes(input.status)
		)
			throw new Error(
				"Review the revised agreement before progressing these tasks",
			);
		const { taskId, ...patch } = input;
		const [row] = await db
			.update(schema.jobTasks)
			.set(patch)
			.where(eq(schema.jobTasks.id, taskId))
			.returning();
		if (!row) throw new Error("Task not found");
		return row;
	});
}

// --- What the AI knows about the job -------------------------------------------------------

function handoverText(h: Handover | null) {
	if (!h) return "(not ready yet)";
	return [
		`Summary: ${h.summary}`,
		`Scope: ${h.scope.join("; ")}`,
		`Requirements: ${h.requirements.map((r) => `${r.label}: ${r.value}`).join("; ")}`,
		`Promised to customer: ${h.promises.join("; ") || "nothing specific"}`,
		`Timeline: ${h.timeline ?? "not stated"}`,
		`Watch out: ${h.watchOuts.join("; ") || "nothing"}`,
		`Customer notes: ${h.customerNotes ?? "none"}`,
	].join("\n");
}

// --- The team group chat --------------------------------------------------------------------

type Job = typeof schema.jobs.$inferSelect;
type StaffMember = typeof schema.staff.$inferSelect;

/** People in the job's group, in the order they joined. */
export async function loadMembers(db: Database, jobId: string) {
	return db
		.select({
			id: schema.staff.id,
			name: schema.staff.name,
			role: schema.staff.role,
			canApprove: schema.staff.canApprove,
		})
		.from(schema.jobMembers)
		.innerJoin(schema.staff, eq(schema.staff.id, schema.jobMembers.staffId))
		.where(eq(schema.jobMembers.jobId, jobId))
		.orderBy(asc(schema.jobMembers.createdAt));
}

/** Puts someone in the job's group. Returns false if they were already in it. */
async function joinGroup(
	db: Database,
	jobId: string,
	staffId: string,
	addedById: string | null,
) {
	const rows = await db
		.insert(schema.jobMembers)
		.values({ jobId, staffId, addedById })
		.onConflictDoNothing()
		.returning({ id: schema.jobMembers.id });
	return rows.length > 0;
}

/** A line in the group about what happened, e.g. "Aina added Lim". */
async function postSystem(db: Database, jobId: string, body: string) {
	await db.insert(schema.jobChat).values({ jobId, role: "system", body });
}

const canManageGroup = (job: Job, member: StaffMember) =>
	member.canApprove || member.id === job.picId;

const teamLink = (job: Job) => `${jobLink(job.businessId, job.id)}?tab=team`;

export async function addJobMember(input: {
	jobId: string;
	staffId: string;
	memberId: string;
}) {
	return getDb().transaction(async (db) => {
		const [job] = await db
			.select()
			.from(schema.jobs)
			.where(eq(schema.jobs.id, input.jobId))
			.for("update");
		if (!job) throw new Error("Job not found");
		const actor = await loadStaff(input.staffId, job.businessId);
		if (!canManageGroup(job, actor))
			throw new Error("Only the PIC or an approver can add people to this job");
		const target = await loadStaff(input.memberId, job.businessId);
		if (!(await joinGroup(db, job.id, target.id, actor.id)))
			throw new Error(`${target.name} is already in this job's group`);
		await postSystem(db, job.id, `${actor.name} added ${target.name}`);
		await emitOrbyteEvent(db, {
			businessId: job.businessId,
			requestId: job.requestId,
			type: "job.member_added",
			actor: actor.name,
			summary: `${actor.name} added ${target.name} to ${job.number}`,
		});
		if (target.id !== actor.id)
			await notify(db, {
				businessId: job.businessId,
				staffIds: [target.id],
				title: `You were added to ${job.number}`,
				body: `${actor.name} added you to "${job.title}". Tag @AI in the team chat to ask about the job.`,
				link: teamLink(job),
			});
		return { ok: true };
	});
}

export async function removeJobMember(input: {
	jobId: string;
	staffId: string;
	memberId: string;
}) {
	return getDb().transaction(async (db) => {
		const [job] = await db
			.select()
			.from(schema.jobs)
			.where(eq(schema.jobs.id, input.jobId))
			.for("update");
		if (!job) throw new Error("Job not found");
		const actor = await loadStaff(input.staffId, job.businessId);
		const leaving = input.memberId === actor.id;
		if (!leaving && !canManageGroup(job, actor))
			throw new Error(
				"Only the PIC or an approver can remove people from this job",
			);
		if (input.memberId === job.picId)
			throw new Error(
				"Assign another person in charge before removing the PIC",
			);
		const target = await loadStaff(input.memberId, job.businessId);
		const removed = await db
			.delete(schema.jobMembers)
			.where(
				and(
					eq(schema.jobMembers.jobId, job.id),
					eq(schema.jobMembers.staffId, target.id),
				),
			)
			.returning({ id: schema.jobMembers.id });
		if (!removed.length)
			throw new Error(`${target.name} is not in this job's group`);
		await postSystem(
			db,
			job.id,
			leaving
				? `${target.name} left the group`
				: `${actor.name} removed ${target.name}`,
		);
		await emitOrbyteEvent(db, {
			businessId: job.businessId,
			requestId: job.requestId,
			type: "job.member_removed",
			actor: actor.name,
			summary: leaving
				? `${target.name} left ${job.number}`
				: `${actor.name} removed ${target.name} from ${job.number}`,
		});
		return { ok: true };
	});
}

/**
 * A teammate posts in the job's group. Tagged teammates are notified, and the
 * AI only answers when the message tags @AI.
 */
export async function postJobMessage(input: {
	jobId: string;
	staffId: string;
	body: string;
}) {
	const db = getDb();
	const body = input.body.trim();
	if (!body) throw new Error("Type a message");
	const job = await db.query.jobs.findFirst({
		where: eq(schema.jobs.id, input.jobId),
	});
	if (!job) throw new Error("Job not found");
	const member = await loadStaff(input.staffId, job.businessId);
	const members = await loadMembers(db, job.id);
	if (!members.some((m) => m.id === member.id))
		throw new Error(
			"Only people in this job's group can post. Ask the PIC or an approver to add you.",
		);
	const history = await db
		.select()
		.from(schema.jobChat)
		.where(eq(schema.jobChat.jobId, job.id))
		.orderBy(asc(schema.jobChat.createdAt));
	const mentions = findMentions(body, members);
	const [message] = await db
		.insert(schema.jobChat)
		.values({
			jobId: job.id,
			role: "staff",
			authorId: member.id,
			authorName: member.name,
			body,
			mentions,
		})
		.returning();
	await notify(db, {
		businessId: job.businessId,
		staffIds: mentions.filter((id) => id !== AI_MENTION && id !== member.id),
		title: `${member.name} mentioned you in ${job.number}`,
		body: body.length > 200 ? `${body.slice(0, 197)}…` : body,
		link: teamLink(job),
	});
	if (!mentions.includes(AI_MENTION)) return { message, reply: null };
	const reply = await assistantReply({
		job,
		asker: member,
		members,
		history,
		question: withoutAiTag(body) || body,
	});
	return { message, reply };
}

/** The AI answers a teammate who tagged it, from the job's context and the group so far. */
async function assistantReply(input: {
	job: Job;
	asker: StaffMember;
	members: Awaited<ReturnType<typeof loadMembers>>;
	history: (typeof schema.jobChat.$inferSelect)[];
	question: string;
}) {
	const db = getDb();
	const { job, context, refOf } = await jobContext(input.job.id);
	const [tasks, relays] = await Promise.all([
		db
			.select()
			.from(schema.jobTasks)
			.where(eq(schema.jobTasks.jobId, job.id))
			.orderBy(asc(schema.jobTasks.position)),
		db
			.select()
			.from(schema.relays)
			.where(eq(schema.relays.jobId, job.id))
			.orderBy(asc(schema.relays.createdAt)),
	]);
	const knowledge = (
		await findKnowledge(
			job.businessId,
			"team",
			`${input.question} ${job.title}`,
		)
	).map((p, i) => ({ ...p, ref: `k${i + 1}` }));
	const label = (name: string | null, id: string | null) =>
		`${name ?? "Staff"}${id && id === job.picId ? " (PIC)" : ""}`;
	const reply = await answerJobQuestion({
		context,
		handover: handoverText(job.handover),
		tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
		relays: relays.map((r) => ({
			question: r.question,
			answer: r.answer,
			status: r.status,
		})),
		history: input.history.map((h) => ({
			who:
				h.role === "assistant"
					? "AI"
					: h.role === "system"
						? "SYSTEM"
						: label(h.authorName, h.authorId),
			body: h.body,
		})),
		question: input.question,
		askerName: label(input.asker.name, input.asker.id),
		picName: input.members.find((m) => m.id === job.picId)?.name ?? null,
		team: input.members.map((m) => label(m.name, m.id)),
		knowledge,
	}).catch((err) => {
		console.error("[job assistant]", err);
		return {
			answer: "Sorry, I couldn't look that up just now. Please try again.",
			known: false,
			sources: [],
			actions: [],
		};
	});

	// Map "m12" style references back to message ids so the UI can jump to them.
	const idOfRef = new Map([...refOf.entries()].map(([id, ref]) => [ref, id]));
	const taskIds = new Set(tasks.map((t) => t.id));
	const docOfRef = new Map(knowledge.map((k) => [k.ref, k]));
	const sources: BotSource[] = reply.sources.map((s) => {
		const doc =
			s.kind === "knowledge" && s.ref ? docOfRef.get(s.ref) : undefined;
		if (doc) return { kind: "knowledge", label: doc.title, ref: doc.docId };
		return {
			kind: s.kind,
			label: s.label,
			...(s.kind !== "knowledge" && s.ref && idOfRef.has(s.ref)
				? { ref: idOfRef.get(s.ref) }
				: {}),
		};
	});
	const actions: BotAction[] = reply.actions.slice(0, 3).map((a) =>
		a.kind === "add_task"
			? { kind: "add_task", title: a.text }
			: a.kind === "flag_blocker"
				? {
						kind: "flag_blocker",
						taskId: a.taskId && taskIds.has(a.taskId) ? a.taskId : null,
						note: a.text,
					}
				: { kind: "ask_customer", question: a.text },
	);
	const [row] = await db
		.insert(schema.jobChat)
		.values({
			jobId: job.id,
			role: "assistant",
			body: reply.answer,
			mentions: [input.asker.id],
			sources,
			actions,
		})
		.returning();
	return row;
}

// --- Asking the customer through sales ------------------------------------------------------

/** A PIC's question becomes a draft WhatsApp message waiting for sales approval. */
export async function requestCustomerAnswer(input: {
	jobId: string;
	staffId: string;
	question: string;
}) {
	const db = getDb();
	const { job, context, business, conversation, messages } = await jobContext(
		input.jobId,
	);
	const member = await loadStaff(input.staffId, job.businessId);
	const question = input.question.trim();
	if (!question) throw new Error("Type the question");
	if (
		!member.canApprove &&
		!(await loadMembers(db, job.id)).some((m) => m.id === member.id)
	)
		throw new Error(
			"Only people in this job's group can ask the customer a question",
		);
	const draft = await draftCustomerQuestion({
		businessName: business.name,
		customerName: conversation.customerName,
		language: context.language,
		jobTitle: job.title,
		question,
		recentChat: messages.map((m) => ({
			sender: m.sender,
			body: m.body,
			attachment: m.attachment,
		})),
	}).catch(() => question);
	const [relay] = await db
		.insert(schema.relays)
		.values({
			businessId: job.businessId,
			jobId: job.id,
			conversationId: conversation.id,
			askedById: member.id,
			question,
			draft,
		})
		.returning();
	await emitOrbyteEvent(db, {
		businessId: job.businessId,
		requestId: job.requestId,
		type: "relay.requested",
		actor: member.name,
		summary: `${member.name} (${job.number}) wants to ask the customer: ${question}`,
		payload: { relayId: relay.id },
	});
	await postSystem(
		db,
		job.id,
		`${member.name} asked sales to check with the customer: "${question}"`,
	);
	const approvers = await db
		.select({ id: schema.staff.id })
		.from(schema.staff)
		.where(
			and(
				eq(schema.staff.businessId, job.businessId),
				eq(schema.staff.canApprove, true),
			),
		);
	await notify(db, {
		businessId: job.businessId,
		staffIds: approvers.map((a) => a.id).filter((id) => id !== member.id),
		title: `Approve a question for ${conversation.customerName}`,
		body: `${member.name} (${job.number}) needs: ${question}`,
		link: `/orbyte/${job.businessId}/inbox?c=${conversation.id}`,
	});
	return relay;
}

/** Sales send (optionally edited) or reject a relayed question. */
export async function reviewRelay(input: {
	relayId: string;
	staffId: string;
	action: "send" | "reject";
	draft?: string;
	reason?: string;
}) {
	// Locked, so two approvers can't both send the same question.
	return getDb().transaction(async (db) => {
		const [relay] = await db
			.select()
			.from(schema.relays)
			.where(eq(schema.relays.id, input.relayId))
			.for("update");
		if (!relay) throw new Error("Question not found");
		if (relay.status !== "pending") throw new Error("Already handled");
		const member = await loadStaff(input.staffId, relay.businessId);
		if (!member.canApprove)
			throw new Error(`${member.name} can't approve messages to customers`);
		const job = await db.query.jobs.findFirst({
			where: eq(schema.jobs.id, relay.jobId),
		});

		if (input.action === "reject") {
			const [row] = await db
				.update(schema.relays)
				.set({
					status: "rejected",
					reviewedById: member.id,
					rejectReason: input.reason?.trim() || null,
				})
				.where(eq(schema.relays.id, relay.id))
				.returning();
			await emitOrbyteEvent(db, {
				businessId: relay.businessId,
				requestId: job?.requestId,
				type: "relay.rejected",
				actor: member.name,
				summary: `${member.name} didn't send: ${relay.question}`,
			});
			await postSystem(
				db,
				relay.jobId,
				`${member.name} (sales) didn't send "${relay.question}"${input.reason?.trim() ? `: ${input.reason.trim()}` : ""}`,
			);
			await notify(db, {
				businessId: relay.businessId,
				staffIds: [relay.askedById],
				title: `Question not sent (${job?.number ?? "job"})`,
				body: `${member.name}: ${input.reason?.trim() || "not sent to the customer"}. "${relay.question}"`,
				link: job ? jobLink(job.businessId, job.id) : undefined,
			});
			return row;
		}

		const draft = (input.draft ?? relay.draft).trim();
		if (!draft) throw new Error("The message is empty");
		const [message] = await db
			.insert(schema.messages)
			.values({
				conversationId: relay.conversationId,
				sender: "staff",
				authorName: member.name,
				body: draft,
			})
			.returning();
		const [row] = await db
			.update(schema.relays)
			.set({
				status: "sent",
				draft,
				reviewedById: member.id,
				sentAt: message.createdAt,
			})
			.where(eq(schema.relays.id, relay.id))
			.returning();
		await emitOrbyteEvent(db, {
			businessId: relay.businessId,
			requestId: job?.requestId,
			type: "relay.sent",
			actor: member.name,
			summary: `${member.name} sent the customer a question for ${job?.number ?? "a job"}`,
		});
		await postSystem(
			db,
			relay.jobId,
			`${member.name} (sales) sent the customer: "${draft}"`,
		);
		return row;
	});
}

/**
 * If we're waiting on an answer for a PIC, check whether this customer message
 * answers it. Returns the relay it answered, if any.
 */
export async function matchRelayAnswer(input: {
	conversationId: string;
	message: { id: string; body: string; attachment: { name: string } | null };
}) {
	const db = getDb();
	const open = await db.query.relays.findFirst({
		where: and(
			eq(schema.relays.conversationId, input.conversationId),
			eq(schema.relays.status, "sent"),
		),
		orderBy: desc(schema.relays.sentAt),
	});
	if (!open) return null;
	const result = await readRelayAnswer({
		question: open.question,
		sentMessage: open.draft,
		reply: input.message.body,
		hasAttachment: Boolean(input.message.attachment),
	}).catch(() => null);
	if (!result?.answers || !result.answer || result.changesScope) return null;

	const [row] = await db
		.update(schema.relays)
		.set({
			status: "answered",
			answer: result.answer,
			answerMessageId: input.message.id,
			answeredAt: new Date(),
		})
		.where(eq(schema.relays.id, open.id))
		.returning();
	const job = await db.query.jobs.findFirst({
		where: eq(schema.jobs.id, open.jobId),
	});
	if (job) {
		const asker = open.askedById
			? await db.query.staff.findFirst({
					where: eq(schema.staff.id, open.askedById),
				})
			: undefined;
		await db.insert(schema.jobChat).values({
			jobId: job.id,
			role: "assistant",
			mentions: asker ? [asker.id] : [],
			body: `The customer answered ${asker ? `${asker.name}'s` : "the team's"} question "${open.question}": ${result.answer}`,
			sources: [
				{ kind: "chat", label: "Customer's reply", ref: input.message.id },
			],
		});
		await emitOrbyteEvent(db, {
			businessId: job.businessId,
			requestId: job.requestId,
			type: "relay.answered",
			actor: "customer",
			summary: `Customer answered for ${job.number}: ${result.answer}`,
		});
		// The whole team sees the answer in the group, so tell all of them.
		const members = await loadMembers(db, job.id);
		await notify(db, {
			businessId: job.businessId,
			staffIds: [open.askedById, job.picId, ...members.map((m) => m.id)],
			title: `Customer answered (${job.number})`,
			body: `${open.question} → ${result.answer}`,
			link: teamLink(job),
		});
	}
	return { relay: row, job };
}
