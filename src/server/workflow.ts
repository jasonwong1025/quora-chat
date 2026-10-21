/**
 * The quotation workflow: customer message → structured request → pricing
 * check → draft / clarification / human review → approval → reply.
 */
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "#/db";
import type {
	ExtractedRequest,
	Flag,
	LineItem,
	ThoughtStep,
} from "#/db/schema";
import { aiModelName, composeReply, extractRequest } from "./ai";
import { emitOrbyteEvent } from "./orbyte";
import { formatMYR, type Outcome, priceRequest, totals } from "./pricing";

export type WorkflowStep =
	| { step: "received" }
	| { step: "parsed"; summary: string; language: string; itemCount: number }
	| { step: "priced"; outcome: Outcome; flags: Flag[]; requestId: string }
	| { step: "replied"; body: string }
	| { step: "held"; staffName: string | null }
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

const languageLabel: Record<ExtractedRequest["language"], string> = {
	en: "English",
	ms: "Bahasa Melayu",
	zh: "Chinese",
	mixed: "a mix of languages",
};

const outcomeLabel = {
	needs_clarification: "Ask the customer for the missing details",
	needs_review: "Flag for staff review before quoting",
	draft_ready: "Draft is ready for staff approval",
} as const;

/** Records the AI's thinking for one turn, step by step, so staff can follow it live. */
async function startRun(conversationId: string, messageId: string) {
	const db = getDb();
	const steps: ThoughtStep[] = [];
	const [run] = await db
		.insert(schema.aiRuns)
		.values({ conversationId, messageId, model: aiModelName() })
		.returning();
	const save = (patch: Partial<typeof schema.aiRuns.$inferInsert> = {}) =>
		db
			.update(schema.aiRuns)
			.set({ steps: [...steps], ...patch })
			.where(eq(schema.aiRuns.id, run.id));
	return {
		add(step: Omit<ThoughtStep, "at">) {
			steps.push({ ...step, at: new Date().toISOString() });
			return save();
		},
		setRequest(requestId: string) {
			return save({ requestId });
		},
		finish(status: "done" | "held" | "failed") {
			return save({ status, finishedAt: new Date() });
		},
	};
}

function describeItem(
	item: ExtractedRequest["items"][number],
	names: Map<string, string>,
) {
	const target =
		item.match === "exact" && item.productId
			? `${names.get(item.productId) ?? item.productId} (exact match)`
			: item.match === "ambiguous"
				? `could be ${item.candidateProductIds.map((id) => names.get(id) ?? id).join(" or ")}`
				: "not in the catalog";
	const facts = [
		item.quantity !== null ? `qty ${item.quantity}` : "no quantity yet",
		...Object.entries(item.fields).map(([k, v]) => `${k}: ${v}`),
	].join(", ");
	return `"${item.rawText}" → ${target} · ${facts}${item.reason ? ` — ${item.reason}` : ""}`;
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

	const [incoming] = await db
		.insert(schema.messages)
		.values({
			conversationId: conversation.id,
			sender: "customer",
			body: input.body,
		})
		.returning();
	const run = await startRun(conversation.id, incoming.id);
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

	// A staff member has taken over: keep the AI quiet and leave it to them.
	if (conversation.aiPaused) {
		const handler = conversation.handledBy
			? await db.query.staff.findFirst({
					where: eq(schema.staff.id, conversation.handledBy),
				})
			: undefined;
		await emitOrbyteEvent(db, {
			businessId,
			requestId: open?.id,
			type: "chat.message_held",
			actor: "quora-chat",
			summary: `AI paused — message left for ${handler?.name ?? "staff"}`,
		});
		await run.add({
			kind: "held",
			title: `Stayed quiet — ${handler?.name ?? "staff"} is handling this chat`,
			detail: ["The AI is paused until staff hand the chat back."],
		});
		await run.finish("held");
		yield { step: "held", staffName: handler?.name ?? null };
		return;
	}

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
	const customerTurns = history.filter((m) => m.sender === "customer").length;
	await run.add({
		kind: "read",
		title:
			customerTurns > 1
				? `Read the conversation (${customerTurns} customer messages in this request)`
				: "Read the new message",
		detail: [
			`Checked against ${products.length} products and ${rules.length} pricing rules from ${business.name}`,
		],
	});

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
		await run.setRequest(request.id);
		await run.add({
			kind: "error",
			title: "Could not read the message — handed to staff",
			detail: [message],
		});
		await run.finish("failed");
		yield { step: "failed", error: message };
		return;
	}

	yield {
		step: "parsed",
		summary: extracted.summary,
		language: extracted.language,
		itemCount: extracted.items.length,
	};

	const names = new Map(products.map((p) => [p.id, p.name]));
	await run.add({
		kind: "understand",
		title: extracted.summary,
		detail: [
			`Customer is writing in ${languageLabel[extracted.language]}`,
			...(extracted.location ? [`Location: ${extracted.location}`] : []),
			...(extracted.neededBy ? [`Needed by: ${extracted.neededBy}`] : []),
			...(extracted.reasoning ?? []),
		],
	});
	await run.add({
		kind: "match",
		title:
			extracted.items.length === 0
				? "No products mentioned yet"
				: `Matched ${extracted.items.length} item${extracted.items.length === 1 ? "" : "s"} to the catalog`,
		detail: extracted.items.map((i) => describeItem(i, names)),
	});

	const result = priceRequest(extracted, products, rules);
	const request = await upsertRequest(open?.id, {
		businessId,
		conversationId: conversation.id,
		status: result.outcome,
		extracted,
		flags: result.flags,
	});
	await run.setRequest(request.id);

	const missing = result.flags.filter((f) => f.kind === "missing_info");
	await run.add({
		kind: "check",
		title: missing.length
			? `${missing.length} detail${missing.length === 1 ? "" : "s"} missing before it can be priced`
			: "All required details are there",
		detail: missing.map(
			(f) =>
				`${f.message}${f.options?.length ? ` (${f.options.join(" / ")})` : ""}`,
		),
	});
	if (result.lineItems.length) {
		const t = totals(
			result.lineItems,
			business.sstRateBps,
			business.sstRegistered,
		);
		await run.add({
			kind: "price",
			title: `Priced from the catalog and rules: ${formatMYR(t.totalSen)} incl. SST`,
			detail: [
				...result.explain.flatMap((e) => e.lines),
				business.sstRegistered
					? `SST ${business.sstRateBps / 100}% = ${formatMYR(t.sstSen)}`
					: "Not SST registered — no SST",
				"Prices come from the pricing engine, not the AI.",
			],
		});
	}
	await run.add({
		kind: "decide",
		title: outcomeLabel[result.outcome],
		detail:
			result.outcome === "draft_ready"
				? ["Nothing is sent to the customer until staff approve the quote."]
				: result.flags
						.filter((f) => f.kind !== "missing_info")
						.map((f) => f.message),
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
	await run.add({
		kind: "reply",
		title: `Replied in ${languageLabel[extracted.language]}`,
		detail: [
			result.outcome === "needs_clarification"
				? "Asked only for the missing details, without mentioning prices"
				: "Told the customer the team will confirm, without mentioning prices",
		],
	});
	await run.finish("done");
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
		const body = `Quotation ${quote.number}\nTotal ${formatMYR(quote.totalSen)} (incl. SST)\nValid until ${quote.validUntil.toLocaleDateString("en-MY")}\n\nPlease review and sign to confirm.`;
		await db.insert(schema.messages).values({
			conversationId: request.conversationId,
			sender: "staff",
			authorName: member.name,
			body,
			quoteId: quote.id,
		});
		await emitOrbyteEvent(db, {
			businessId: quote.businessId,
			requestId: request.id,
			type: "quote.sent_to_customer",
			actor: "quora-chat",
			summary: `${quote.number} sent to customer on WhatsApp`,
		});
		await emitOrbyteEvent(db, {
			businessId: quote.businessId,
			requestId: request.id,
			type: "esign.sent",
			actor: "eSign",
			summary: `${quote.number} sent for customer signature`,
		});
	}
	return row;
}

// --- Chat takeover -------------------------------------------------------------

async function loadConversation(conversationId: string) {
	const conversation = await getDb().query.conversations.findFirst({
		where: eq(schema.conversations.id, conversationId),
	});
	if (!conversation) throw new Error("Conversation not found");
	return conversation;
}

export async function setTakeover(input: {
	conversationId: string;
	staffId: string;
	takeOver: boolean;
}) {
	const db = getDb();
	const conversation = await loadConversation(input.conversationId);
	const member = await loadStaff(input.staffId, conversation.businessId);
	const [row] = await db
		.update(schema.conversations)
		.set({
			aiPaused: input.takeOver,
			handledBy: input.takeOver ? member.id : null,
		})
		.where(eq(schema.conversations.id, conversation.id))
		.returning();
	const open = await findOpenRequest(conversation.id);
	await emitOrbyteEvent(db, {
		businessId: conversation.businessId,
		requestId: open?.id,
		type: input.takeOver ? "chat.taken_over" : "chat.handed_back",
		actor: member.name,
		summary: input.takeOver
			? `${member.name} took over the chat with ${conversation.customerName}`
			: `${member.name} handed ${conversation.customerName} back to the AI`,
	});
	return row;
}

/** A staff reply. Replying takes over the chat so the AI does not talk over staff. */
export async function staffReply(input: {
	conversationId: string;
	staffId: string;
	body: string;
}) {
	const db = getDb();
	const conversation = await loadConversation(input.conversationId);
	const member = await loadStaff(input.staffId, conversation.businessId);
	if (!conversation.aiPaused || conversation.handledBy !== member.id) {
		await setTakeover({ ...input, takeOver: true });
	}
	const [row] = await db
		.insert(schema.messages)
		.values({
			conversationId: conversation.id,
			sender: "staff",
			authorName: member.name,
			body: input.body,
		})
		.returning();
	const open = await findOpenRequest(conversation.id);
	await emitOrbyteEvent(db, {
		businessId: conversation.businessId,
		requestId: open?.id,
		type: "chat.staff_replied",
		actor: member.name,
		summary: `${member.name} replied to ${conversation.customerName}`,
		payload: { body: input.body },
	});
	return row;
}

// --- eSign ---------------------------------------------------------------------

const signedThanks: Record<
	ExtractedRequest["language"],
	(n: string) => string
> = {
	en: (n) =>
		`Thank you! We've received your signed quotation ${n}. Our team will contact you shortly to arrange the next step.`,
	ms: (n) =>
		`Terima kasih! Kami telah menerima sebut harga ${n} yang telah ditandatangani. Pasukan kami akan menghubungi anda tidak lama lagi.`,
	zh: (n) =>
		`谢谢！我们已收到您签署的报价单 ${n}，我们的团队会尽快联系您安排下一步。`,
	mixed: (n) =>
		`Thank you! We've received your signed quotation ${n}. Our team will contact you shortly to arrange the next step.`,
};

async function loadSignableQuote(quoteId: string) {
	const db = getDb();
	const quote = await db.query.quotes.findFirst({
		where: eq(schema.quotes.id, quoteId),
	});
	if (!quote) throw new Error("Quote not found");
	const request = await db.query.quoteRequests.findFirst({
		where: eq(schema.quoteRequests.id, quote.requestId),
	});
	if (!request) throw new Error("Request not found");
	return { quote, request };
}

export async function markQuoteViewed(quoteId: string) {
	const db = getDb();
	const { quote, request } = await loadSignableQuote(quoteId);
	if (quote.viewedAt || quote.status !== "approved") return quote;
	const [row] = await db
		.update(schema.quotes)
		.set({ viewedAt: new Date() })
		.where(eq(schema.quotes.id, quote.id))
		.returning();
	await emitOrbyteEvent(db, {
		businessId: quote.businessId,
		requestId: request.id,
		type: "esign.viewed",
		actor: "eSign",
		summary: `Customer opened ${quote.number} for signing`,
	});
	return row;
}

export async function signQuote(input: {
	quoteId: string;
	signerName: string;
	signatureImage: string;
}) {
	const db = getDb();
	const { quote, request } = await loadSignableQuote(input.quoteId);
	if (quote.status === "accepted") throw new Error("Already signed");
	if (quote.status !== "approved")
		throw new Error("This quotation is not open for signing");
	if (quote.validUntil < new Date())
		throw new Error("This quotation has expired");

	const now = new Date();
	const [row] = await db
		.update(schema.quotes)
		.set({
			status: "accepted",
			signedAt: now,
			signerName: input.signerName,
			signatureImage: input.signatureImage,
			viewedAt: quote.viewedAt ?? now,
		})
		.where(eq(schema.quotes.id, quote.id))
		.returning();

	await emitOrbyteEvent(db, {
		businessId: quote.businessId,
		requestId: request.id,
		type: "esign.signed",
		actor: input.signerName,
		summary: `${input.signerName} signed ${quote.number}`,
	});
	await reserveStock(quote, request.id, input.signerName);
	await emitOrbyteEvent(db, {
		businessId: quote.businessId,
		requestId: request.id,
		type: "quote.accepted",
		actor: input.signerName,
		summary: `${quote.number} accepted (${formatMYR(quote.totalSen)})`,
	});
	await db.insert(schema.messages).values({
		conversationId: request.conversationId,
		sender: "assistant",
		body: signedThanks[request.extracted.language](quote.number),
	});
	return row;
}

/** A signed quote reserves its stock items so they are not promised twice. */
async function reserveStock(
	quote: typeof schema.quotes.$inferSelect,
	requestId: string,
	signerName: string,
) {
	const db = getDb();
	const qty = new Map<string, number>();
	for (const l of quote.lineItems) {
		if (l.productId)
			qty.set(l.productId, (qty.get(l.productId) ?? 0) + l.quantity);
	}
	if (qty.size === 0) return;
	const items = await db
		.select()
		.from(schema.products)
		.where(
			and(
				inArray(schema.products.id, [...qty.keys()]),
				eq(schema.products.type, "stock"),
			),
		);
	for (const p of items) {
		const n = qty.get(p.id) ?? 0;
		await db
			.update(schema.products)
			.set({ stockReserved: sql`${schema.products.stockReserved} + ${n}` })
			.where(eq(schema.products.id, p.id));
		await emitOrbyteEvent(db, {
			businessId: quote.businessId,
			requestId,
			type: "stock.reserved",
			actor: signerName,
			summary: `Reserved ${n} ${p.unit} of ${p.name} (${p.sku}) for ${quote.number}`,
			payload: { productId: p.id, quantity: n },
		});
	}
}
