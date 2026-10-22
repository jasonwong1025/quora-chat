/**
 * After the customer signs: hand the job to a person in charge (PIC).
 * Mirrors Orbyte's Clients → Projects → Tasks. The PIC never talks to the
 * customer; questions go through sales approval and Quora Chat.
 */
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "#/db";
import type { BotAction, BotSource, Handover } from "#/db/schema";
import { answerText, assess } from "#/lib/intake";
import { formatMYR } from "#/lib/money";
import {
	answerJobQuestion,
	draftCustomerQuestion,
	type JobContext,
	readRelayAnswer,
	writeHandover,
} from "./ai";
import { emitOrbyteEvent } from "./orbyte";

type Db = ReturnType<typeof getDb>;
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
	db: Db,
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
export async function startHandover(quote: Quote, request: Request) {
	const db = getDb();
	const existing = await db.query.jobs.findFirst({
		where: eq(schema.jobs.quoteId, quote.id),
	});
	if (existing) return existing;

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
	const companyAnswer = request.brief.general.company_name;
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
			and(eq(schema.jobs.businessId, business.id), eq(schema.jobs.kind, kind)),
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

	await emitOrbyteEvent(db, {
		businessId: business.id,
		requestId: request.id,
		type: "job.created",
		actor: "quora-chat",
		summary: `${jobKindLabel[kind]} ${number} created for ${client.name}`,
		payload: { jobId: job.id, quoteId: quote.id },
	});

	// The AI briefing takes a few seconds; don't make the customer wait for it.
	void prepareHandover(job.id).catch((err) =>
		console.error("[handover]", job.number, err),
	);
	return job;
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
	const messages = await db.query.messages.findMany({
		where: eq(schema.messages.conversationId, conversation.id),
		orderBy: asc(schema.messages.createdAt),
		columns: { attachmentData: false },
	});

	const a = assess(request.brief, products, questions);
	const brief = [
		...a.items.flatMap(({ item, product, questions: qs }) => [
			`${product?.name ?? item.rawText}${item.quantity ? ` × ${item.quantity}` : ""}`,
			...qs
				.filter((q) => item.answers[q.key])
				.map(
					(q) =>
						`${product?.name ?? item.rawText}: ${q.label} → ${answerText(item.answers[q.key])}`,
				),
		]),
		...a.general
			.filter((q) => request.brief.general[q.key])
			.map((q) => `${q.label} → ${answerText(request.brief.general[q.key])}`),
		...request.brief.followUps
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
		language: request.brief.language,
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

function fallbackHandover(context: JobContext): Handover {
	return {
		summary: `${context.clientName} signed for: ${context.quote[0] ?? "see quotation"}.`,
		scope: context.quote.slice(0, -1),
		requirements: [],
		promises: [],
		timeline: null,
		watchOuts: [
			"The AI briefing could not be written. Read the chat transcript.",
		],
		customerNotes: null,
	};
}

/** The AI writes the briefing and starting tasks, then the PIC is notified. */
export async function prepareHandover(jobId: string) {
	const db = getDb();
	const { job, context } = await jobContext(jobId);
	let handover: Handover;
	let title = job.title;
	let tasks: string[] = [];
	try {
		const draft = await writeHandover(context);
		const { title: t, tasks: ts, ...rest } = draft;
		handover = rest;
		title = t || title;
		tasks = ts;
	} catch (err) {
		console.error("[handover] AI failed", err);
		handover = fallbackHandover(context);
	}
	await db
		.update(schema.jobs)
		.set({ handover, title, status: "upcoming", updatedAt: new Date() })
		.where(eq(schema.jobs.id, job.id));
	await db
		.delete(schema.jobTasks)
		.where(
			and(eq(schema.jobTasks.jobId, job.id), eq(schema.jobTasks.source, "ai")),
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
	await emitOrbyteEvent(db, {
		businessId: job.businessId,
		requestId: job.requestId,
		type: "job.handover_ready",
		actor: "quora-chat",
		summary: `Handover pack ready for ${job.number} (${tasks.length} starting tasks)`,
		payload: { jobId: job.id },
	});
	await notify(db, {
		businessId: job.businessId,
		staffIds: [job.picId],
		title: `New ${jobKindLabel[job.kind].toLowerCase()}: ${job.number}`,
		body: `You're the PIC for "${title}". The handover pack and chat history are ready.`,
		link: jobLink(job.businessId, job.id),
	});
}

// --- Job updates --------------------------------------------------------------------------

export async function updateJob(input: {
	jobId: string;
	staffId: string;
	status?: "upcoming" | "active" | "completed" | "closed";
	picId?: string | null;
}) {
	const db = getDb();
	const job = await db.query.jobs.findFirst({
		where: eq(schema.jobs.id, input.jobId),
	});
	if (!job) throw new Error("Job not found");
	const member = await loadStaff(input.staffId, job.businessId);
	const patch: Partial<typeof schema.jobs.$inferInsert> = {
		updatedAt: new Date(),
	};

	if (input.picId !== undefined && input.picId !== job.picId) {
		const pic = input.picId
			? await loadStaff(input.picId, job.businessId)
			: null;
		patch.picId = pic?.id ?? null;
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
		if (input.status === "completed") await deliverStock(job, member.name);
	}
	const [row] = await db
		.update(schema.jobs)
		.set(patch)
		.where(eq(schema.jobs.id, job.id))
		.returning();
	return row;
}

/** Completing a job hands over its reserved stock (it leaves inventory). */
async function deliverStock(
	job: typeof schema.jobs.$inferSelect,
	actor: string,
) {
	const db = getDb();
	const quote = await db.query.quotes.findFirst({
		where: eq(schema.quotes.id, job.quoteId),
	});
	if (!quote) return;
	for (const line of quote.lineItems) {
		if (!line.productId) continue;
		const p = await db.query.products.findFirst({
			where: eq(schema.products.id, line.productId),
		});
		if (!p || p.type !== "stock") continue;
		const n = Math.min(p.stockReserved, line.quantity);
		if (n <= 0) continue;
		await db
			.update(schema.products)
			.set({
				stockOnHand: sql`${schema.products.stockOnHand} - ${n}`,
				stockReserved: sql`${schema.products.stockReserved} - ${n}`,
			})
			.where(eq(schema.products.id, p.id));
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
	const db = getDb();
	const { taskId, ...patch } = input;
	const [row] = await db
		.update(schema.jobTasks)
		.set(patch)
		.where(eq(schema.jobTasks.id, taskId))
		.returning();
	if (!row) throw new Error("Task not found");
	return row;
}

// --- The PIC's chatbot ----------------------------------------------------------------------

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

export async function askJobAssistant(input: {
	jobId: string;
	staffId: string;
	question: string;
}) {
	const db = getDb();
	const { job, context, refOf } = await jobContext(input.jobId);
	const member = await loadStaff(input.staffId, job.businessId);
	const [tasks, relays, history] = await Promise.all([
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
		db
			.select()
			.from(schema.jobChat)
			.where(eq(schema.jobChat.jobId, job.id))
			.orderBy(asc(schema.jobChat.createdAt)),
	]);
	await db.insert(schema.jobChat).values({
		jobId: job.id,
		role: "pic",
		authorName: member.name,
		body: input.question,
	});

	const reply = await answerJobQuestion({
		context,
		handover: handoverText(job.handover),
		tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
		relays: relays.map((r) => ({
			question: r.question,
			answer: r.answer,
			status: r.status,
		})),
		history: history.map((h) => ({
			role: h.role === "pic" ? "pic" : "assistant",
			body: h.body,
		})),
		question: input.question,
		picName: member.name,
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
	const sources: BotSource[] = reply.sources.map((s) => ({
		kind: s.kind,
		label: s.label,
		...(s.ref && idOfRef.has(s.ref) ? { ref: idOfRef.get(s.ref) } : {}),
	}));
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
	const db = getDb();
	const relay = await db.query.relays.findFirst({
		where: eq(schema.relays.id, input.relayId),
	});
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
	return row;
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
	if (!result?.answers || !result.answer) return null;

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
		await db.insert(schema.jobChat).values({
			jobId: job.id,
			role: "assistant",
			body: `The customer answered your question "${open.question}": ${result.answer}`,
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
		await notify(db, {
			businessId: job.businessId,
			staffIds: [open.askedById, job.picId],
			title: `Customer answered (${job.number})`,
			body: `${open.question} → ${result.answer}`,
			link: jobLink(job.businessId, job.id),
		});
	}
	return { relay: row, job };
}
