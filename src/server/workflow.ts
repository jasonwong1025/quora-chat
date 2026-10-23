/**
 * The quotation workflow:
 * customer message → update the requirement brief → ask what's missing →
 * confirm a summary → draft → staff approve → customer signs.
 *
 * Code decides what is missing and which stage we're in. The AI only reads
 * answers out of messages and words the replies.
 */
import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	isNull,
	lte,
	or,
	sql,
} from "drizzle-orm";
import { type Database, getDb, schema } from "#/db";
import type {
	Answer,
	Attachment,
	Brief,
	BriefItem,
	Language,
	LineItem,
	QuoteTerms,
	ThoughtStep,
} from "#/db/schema";
import {
	agreementContent,
	agreementLines,
	quoteAgreementIssue,
	quoteReviewToken,
} from "#/lib/agreements";
import {
	type AvailabilityIssue,
	availabilityIssues,
	describeIssue,
	recapNote,
} from "#/lib/availability";
import { withSchedule } from "#/lib/billing";
import { resolveRelativeDate } from "#/lib/dates";
import {
	type Assessment,
	answerIssue,
	answerText,
	assess,
	businessQuestions,
	emptyBrief,
	followUpResolved,
	type IntakeProduct,
	type Missing,
	nextToAsk,
	type Question,
	questionsFor,
} from "#/lib/intake";
import { addWeeks } from "#/lib/price-builder";
import { sumOf } from "#/lib/quote-lines";
import {
	type Ask,
	aiModelName,
	type CatalogQuestion,
	type ChatTurn,
	estimateGaps,
	type Reading,
	type ReplyPlan,
	readTurn,
	writeReply,
} from "./ai";
import { issueInvoices } from "./billing";
import {
	CancellationNeedsReviewError,
	cancelSignedOrder,
	flagCancellationForReview,
} from "./cancellation";
import {
	onCustomerReplyToQuote,
	onQuoteClosed,
	onQuoteOpened,
	onQuoteSent,
	todayMY,
} from "./followups";
import { matchRelayAnswer } from "./jobs";
import { findKnowledge } from "./knowledge";
import { notify } from "./notify";
import { emitOrbyteEvent } from "./orbyte";
import { formatMYR, priceBrief, totals } from "./pricing";
import { createRequest, saveRequest, snapshotBrief } from "./requirements";
import { deliveryBaseline } from "./revisions";
import { enqueueTask } from "./tasks";

type RequestStatus = (typeof schema.requestStatus.enumValues)[number];

export type WorkflowStep =
	| { step: "received" }
	| { step: "parsed"; summary: string; language: string; itemCount: number }
	| { step: "staged"; status: RequestStatus | null; requestId: string | null }
	| { step: "replied"; body: string }
	| { step: "held"; staffName: string | null }
	| { step: "failed"; error: string };

/** Requests still being worked on (not yet approved or rejected). */
const OPEN: RequestStatus[] = [
	"gathering",
	"confirming",
	"needs_review",
	"draft_ready",
];
const MAX_AI_FOLLOW_UPS = 2;

const languageLabel: Record<Language, string> = {
	en: "English",
	ms: "Bahasa Melayu",
	zh: "Chinese",
	mixed: "a mix of languages",
};

// --- Loading -------------------------------------------------------------------------

async function loadCatalog(businessId: string) {
	const db = getDb();
	const [business, products, rules, questions] = await Promise.all([
		db.query.businesses.findFirst({
			where: eq(schema.businesses.id, businessId),
		}),
		db
			.select()
			.from(schema.products)
			// Switched-off products too, so we can tell the customer they're unavailable.
			.where(eq(schema.products.businessId, businessId)),
		db
			.select()
			.from(schema.pricingRules)
			.where(eq(schema.pricingRules.businessId, businessId)),
		db
			.select()
			.from(schema.intakeQuestions)
			.where(eq(schema.intakeQuestions.businessId, businessId)),
	]);
	if (!business) throw new Error(`Unknown business ${businessId}`);
	return { business, products, rules, questions };
}

type Catalog = Awaited<ReturnType<typeof loadCatalog>>;

async function findOpenRequest(conversationId: string) {
	return getDb().query.quoteRequests.findFirst({
		where: and(
			eq(schema.quoteRequests.conversationId, conversationId),
			inArray(schema.quoteRequests.status, OPEN),
		),
		orderBy: desc(schema.quoteRequests.createdAt),
	});
}

/** The latest request whose quote was sent but not signed yet, so it can still be revised. */
async function findSentQuote(conversationId: string) {
	const db = getDb();
	const [found] = await db
		.select({ quote: schema.quotes, request: schema.quoteRequests })
		.from(schema.quotes)
		.innerJoin(
			schema.quoteRequests,
			eq(schema.quoteRequests.id, schema.quotes.requestId),
		)
		.where(
			and(
				eq(schema.quoteRequests.conversationId, conversationId),
				inArray(schema.quotes.status, ["approved", "accepted"]),
				sql`(${schema.quotes.status} = 'accepted' OR ${schema.quotes.validUntil} >= now())`,
			),
		)
		.orderBy(desc(schema.quotes.createdAt))
		.limit(1);
	if (!found) return null;
	const { request, quote } = found;
	if (quote.status === "accepted") {
		const job = await db.query.jobs.findFirst({
			where: eq(schema.jobs.quoteId, quote.id),
		});
		const ids = quote.lineItems.flatMap((l) =>
			l.productId ? [l.productId] : [],
		);
		const products = ids.length
			? await db
					.select()
					.from(schema.products)
					.where(inArray(schema.products.id, ids))
			: [];
		if (
			(job &&
				(job.kind !== "project" ||
					["completed", "closed", "cancelled"].includes(job.status))) ||
			!products.some((p) => p.pricingMode === "custom") ||
			products.some((p) => p.type === "stock")
		)
			return null;
	}
	return { request, quote };
}

/** The signed agreement still in force, including stock orders that cannot be revised. */
async function findActiveSignedQuote(conversationId: string) {
	const [found] = await getDb()
		.select({ quote: schema.quotes, request: schema.quoteRequests })
		.from(schema.quotes)
		.innerJoin(
			schema.quoteRequests,
			eq(schema.quoteRequests.id, schema.quotes.requestId),
		)
		.where(
			and(
				eq(schema.quoteRequests.conversationId, conversationId),
				eq(schema.quotes.status, "accepted"),
			),
		)
		.orderBy(desc(schema.quotes.signedAt), desc(schema.quotes.createdAt))
		.limit(1);
	return found ?? null;
}

/** Messages that belong to this request: since the previous request closed. */
async function historyFor(
	conversationId: string,
	request: { createdAt: Date } | null,
) {
	const db = getDb();
	const lastClosed = await db.query.quoteRequests.findFirst({
		where: and(
			eq(schema.quoteRequests.conversationId, conversationId),
			inArray(schema.quoteRequests.status, ["approved", "rejected"]),
		),
		orderBy: desc(schema.quoteRequests.updatedAt),
	});
	const from =
		request && lastClosed && request.createdAt <= lastClosed.updatedAt
			? null // a reopened (revised) request: keep its whole history
			: lastClosed?.updatedAt;
	const rows = await db.query.messages.findMany({
		where: eq(schema.messages.conversationId, conversationId),
		orderBy: asc(schema.messages.createdAt),
		columns: { attachmentData: false },
	});
	return rows.filter((m) => !from || m.createdAt > from);
}

const toTurns = (rows: Awaited<ReturnType<typeof historyFor>>): ChatTurn[] =>
	rows.map((m) => ({
		id: m.id,
		sender: m.sender,
		body: m.body,
		attachment: m.attachment,
	}));

// --- AI thinking log --------------------------------------------------------------------

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

type Run = Awaited<ReturnType<typeof startRun>>;

// --- Brief helpers ------------------------------------------------------------------------

const intakeProducts = (products: Catalog["products"]): IntakeProduct[] =>
	products.map((p) => ({
		id: p.id,
		name: p.name,
		category: p.category,
		unit: p.unit,
		pricingMode: p.pricingMode,
		active: p.active,
		priceBuilder: p.priceBuilder,
	}));

/** A few things we do, for "what are you looking for?" (available ones only). */
const offerings = (products: IntakeProduct[]) =>
	[
		...new Set(
			products.filter((p) => p.active !== false).map((p) => p.category),
		),
	].slice(0, 5);

function toCatalogQuestion(q: Question): CatalogQuestion {
	return {
		key: q.key,
		question: q.label,
		type: q.type,
		options: q.options,
		onlyIf: q.showIf ? `${q.showIf.key} = ${q.showIf.equals}` : null,
	};
}

const answerValues = (answers: Record<string, Answer>) =>
	Object.fromEntries(
		Object.entries(answers).map(([k, a]) => [
			k,
			a.source === "skipped" ? ["(skipped)"] : a.values,
		]),
	);

const sameValues = (a: string[], b: string[]) =>
	a.length === b.length &&
	a.every((v, i) => v.trim().toLowerCase() === b[i]?.trim().toLowerCase());

/**
 * The catalog shows the model both ids and SKUs, and it sometimes answers with
 * the SKU ("KD-APP-MOBILE" or "kd-app-mobile") instead of the id. Accept either.
 */
export function resolveProductId(
	ref: string | null,
	products: { id: string; sku: string }[],
) {
	if (!ref) return null;
	const want = ref.trim().toLowerCase();
	return (
		products.find((p) => p.id === ref)?.id ??
		products.find(
			(p) => p.id.toLowerCase() === want || p.sku.toLowerCase() === want,
		)?.id ??
		null
	);
}

/**
 * Merges what the AI read into the brief. Answers it leaves out are kept,
 * and only keys the business actually asks about are accepted.
 */
function applyReading(
	brief: Brief,
	reading: Reading,
	latest: { id: string; attachment: Attachment | null },
	catalog: Catalog,
	history: ChatTurn[],
): { brief: Brief; changed: boolean } {
	const now = new Date().toISOString();
	const next: Brief = structuredClone(brief);
	let changed = false;
	next.language = reading.language;
	next.summary = reading.summary;
	next.reasoning = reading.reasoning;

	const productById = new Map(catalog.products.map((p) => [p.id, p]));

	const mergeAnswers = (
		target: Record<string, Answer>,
		incoming: Reading["general"],
		allowed: Question[],
	) => {
		const types = new Map(allowed.map((q) => [q.key, q.type]));
		for (const { key, values, state, evidenceMessageId } of incoming) {
			if (!types.has(key)) continue;
			let clean = values.map((v) => v.trim()).filter(Boolean);
			if (clean.length === 0) continue;
			// "Jumaat depan" → a real date, worked out by code, not left to the model.
			if (types.get(key) === "date")
				clean = clean.map((v) => resolveRelativeDate(v, todayMY()) ?? v);
			let fileMessageId: string | undefined;
			if (types.get(key) === "file") {
				// Only an actual file answers a file question ("will send later" doesn't).
				if (!latest.attachment) continue;
				clean = [latest.attachment.name];
				fileMessageId = latest.id;
			}
			const prev = target[key];
			const evidence = history.find(
				(m) => m.id === evidenceMessageId && m.sender === "customer",
			);
			if (
				(prev?.source === "staff" || prev?.source === "skipped") &&
				evidence?.id !== latest.id
			)
				continue;
			// Restating an answer we already have from the customer, without (valid)
			// evidence, keeps the original; it never downgrades it to "ambiguous".
			if (
				!evidence &&
				!fileMessageId &&
				prev?.source === "customer" &&
				sameValues(prev.values, clean)
			)
				continue;
			const answerState = evidence || fileMessageId ? state : "ambiguous";
			if (
				prev &&
				prev.source !== "skipped" &&
				sameValues(prev.values, clean) &&
				(prev.state ?? "known") === answerState
			)
				continue;
			// Staff-entered answers win unless the customer says something new about it.
			target[key] = {
				values: clean,
				source: "customer",
				...(evidence?.id ? { messageId: evidence.id } : {}),
				state: answerState,
				...(fileMessageId ? { fileMessageId } : {}),
				at: now,
			};
			changed = true;
		}
	};

	// An unrelated or garbled message ("who won the football?") never adds items,
	// and an item with no wording at all is never a real request.
	const addsItems = !reading.topic || reading.topic === "business";
	for (const r of reading.items) {
		const existing = next.items.find((i) => i.id === r.ref);
		if (!existing && (!addsItems || !r.rawText.trim())) continue;
		if (existing && r.removed) {
			next.items = next.items.filter((i) => i !== existing);
			changed = true;
			continue;
		}
		if (r.removed) continue;
		const productId = resolveProductId(r.productId, catalog.products);
		const candidates = r.candidateProductIds.flatMap((id) => {
			const found = resolveProductId(id, catalog.products);
			return found ? [found] : [];
		});
		const match: BriefItem["match"] =
			r.match === "exact" && !productId ? "none" : r.match;
		// A question ("berapa harga?", "what file should I send?") is not something
		// they want to buy. Models sometimes list one as an item; don't add it.
		if (
			!existing &&
			match === "none" &&
			/^\s*\(|[?？]\s*\)?\s*$/u.test(r.rawText)
		)
			continue;
		const item: BriefItem = existing ?? {
			id: crypto.randomUUID(),
			match,
			productId,
			candidateProductIds: candidates,
			rawText: r.rawText,
			quantity: null,
			answers: {},
		};
		if (!existing) {
			next.items.push(item);
			changed = true;
		} else if (existing.productId !== productId || existing.match !== match) {
			if (existing.productId !== productId) item.answers = {};
			changed = true;
		}
		item.match = match;
		item.productId = productId;
		item.candidateProductIds = candidates;
		// Keep the customer's original wording for the item.
		item.rawText = item.rawText || r.rawText;
		item.reason = r.reason;
		if (r.quantity !== null && r.quantity !== item.quantity) {
			item.quantity = r.quantity;
			changed = true;
		}
		const product = productId ? productById.get(productId) : undefined;
		if (product) {
			item.productName = product.name;
			mergeAnswers(
				item.answers,
				r.answers,
				questionsFor(product, catalog.questions),
			);
		}
	}

	mergeAnswers(
		next.general,
		reading.general,
		businessQuestions(catalog.questions),
	);

	for (const fa of reading.followUpAnswers) {
		const f = next.followUps.find((x) => x.id === fa.id);
		if (f && fa.answer.trim() && f.answer !== fa.answer.trim()) {
			f.answer = fa.answer.trim();
			delete f.waivedBy;
			delete f.waiverReason;
			changed = true;
		}
	}
	// A follow-up must clarify an answer we already have, never replace a preset question.
	const answeredKeys = new Set([
		...next.items.flatMap((i) => [
			...Object.keys(i.answers),
			...(i.quantity !== null ? ["quantity"] : []),
		]),
		...Object.keys(next.general),
	]);
	const aiFollowUps = next.followUps.filter((f) => f.from === "ai");
	if (
		reading.followUp &&
		answeredKeys.has(reading.followUp.aboutKey) &&
		aiFollowUps.length < MAX_AI_FOLLOW_UPS &&
		!aiFollowUps.some((f) => !followUpResolved(f))
	) {
		next.followUps.push({
			id: crypto.randomUUID().slice(0, 8),
			question: reading.followUp.question,
			from: "ai",
			answer: null,
			asked: false,
			at: now,
		});
	}
	return { brief: next, changed };
}

function toAsk(m: Missing, asked: Set<string>): Ask | null {
	const repeat = asked.has(m.id);
	switch (m.kind) {
		case "quantity":
			return {
				about: m.product.name,
				question: `How many (${m.product.unit})?`,
				type: "number",
				options: [],
				hint: null,
				optional: false,
				repeat,
			};
		case "question":
			return {
				about: m.product?.name ?? null,
				question: m.question.label,
				type: m.question.type,
				options: m.question.options,
				hint: m.question.hint,
				optional: !m.question.required,
				repeat,
			};
		case "follow_up":
			return {
				about: null,
				question: m.followUp.question,
				type: "text",
				options: [],
				hint: null,
				optional: false,
				repeat,
			};
		default:
			return null;
	}
}

function describeMissing(m: Missing) {
	switch (m.kind) {
		case "need":
			return "What they need";
		case "identify":
			return `Which product "${m.item.rawText}" means (${m.candidates.map((c) => c.name).join(" / ")})`;
		case "quantity":
			return `${m.product.name}: quantity`;
		case "question":
			return `${m.product ? `${m.product.name}: ` : ""}${m.question.label}${m.required ? "" : " (optional)"}`;
		case "follow_up":
			return `Follow-up (${m.followUp.from === "staff" ? `from ${m.followUp.by ?? "staff"}` : "AI"}): ${m.followUp.question}`;
	}
}

/** "Flyer A5 × 500 pc — Paper: 157gsm art paper; Sides: double" lines for the recap. */
function summaryLines(
	a: Assessment,
	brief: Brief,
	issues: AvailabilityIssue[] = [],
) {
	const lines = a.items.map(({ item, product, questions }) => {
		const issue = issues.find((i) => i.itemId === item.id);
		const name = product?.name ?? `${item.rawText} (to be checked)`;
		const qty = item.quantity
			? ` × ${item.quantity} ${product?.unit ?? ""}`
			: "";
		const details = questions
			.filter((q) => item.answers[q.key]?.source !== "skipped")
			.map((q) => `${q.label} → ${answerText(item.answers[q.key])}`)
			.filter((s) => !s.endsWith("→ "));
		return `${name}${qty}${issue ? ` (${recapNote(issue)})` : ""}${details.length ? `: ${details.join("; ")}` : ""}`;
	});
	for (const q of a.general) {
		const v = answerText(brief.general[q.key]);
		if (v && v !== "(skipped)") lines.push(`${q.label} → ${v}`);
	}
	for (const f of brief.followUps) {
		if (f.answer) lines.push(`${f.question} → ${f.answer}`);
	}
	return lines;
}

// --- Persistence ----------------------------------------------------------------------------

async function nextQuoteNumber(
	db: Database,
	businessId: string,
	prefix: string,
) {
	const [{ n }] = await db
		.select({ n: count() })
		.from(schema.quotes)
		.where(
			and(
				eq(schema.quotes.businessId, businessId),
				eq(schema.quotes.revision, 1),
			),
		);
	return `${prefix}-Q-${String(n + 1).padStart(4, "0")}`;
}

/** Highest revision already used for a quote number (e.g. 3 for KP-Q-0001-R3). */
async function latestRevision(db: Database, businessId: string, base: string) {
	const family = new RegExp(
		`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:-R\\d+)?$`,
	);
	const rows = await db
		.select({ number: schema.quotes.number, revision: schema.quotes.revision })
		.from(schema.quotes)
		.where(
			and(
				eq(schema.quotes.businessId, businessId),
				sql`starts_with(${schema.quotes.number}, ${base})`,
			),
		);
	return rows
		.filter((r) => family.test(r.number))
		.reduce((max, r) => Math.max(max, r.revision), 1);
}

/** Creates or updates the draft. While revising a sent quote, the draft is its next revision. */
async function upsertDraftQuote(
	request: typeof schema.quoteRequests.$inferSelect,
	business: Catalog["business"],
	lineItems: LineItem[],
	revisionOf: string | null | undefined,
	products: IntakeProduct[],
	questions: Question[],
	terms: QuoteTerms | null = null,
) {
	return getDb().transaction(async (db) => {
		const requestId = request.id;
		const [current] = await db
			.select()
			.from(schema.quoteRequests)
			.where(eq(schema.quoteRequests.id, requestId))
			.for("update");
		if (!current || current.briefVersion !== request.briefVersion)
			throw new Error("Requirements changed. Prepare the draft again.");
		if (!["draft_ready", "needs_review"].includes(current.status))
			throw new Error(
				"The request stage changed. Review it before preparing another draft.",
			);
		const snapshot = snapshotBrief(current.brief, products, questions);
		// Serialize quote numbering for this business as well as the draft update.
		await db
			.select({ id: schema.businesses.id })
			.from(schema.businesses)
			.where(eq(schema.businesses.id, business.id))
			.for("update");
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
				.set({
					lineItems,
					terms,
					...t,
					validUntil,
					requirementVersion: current.briefVersion,
					requirementsSnapshot: snapshot,
				})
				.where(eq(schema.quotes.id, existing.id))
				.returning();
			return row;
		}
		const previous = revisionOf
			? await db.query.quotes.findFirst({
					where: eq(schema.quotes.id, revisionOf),
				})
			: undefined;
		const base = previous
			? previous.number.replace(/-R\d+$/, "")
			: await nextQuoteNumber(db, business.id, business.quotePrefix);
		// Number from the whole family, not just `previous`: a rejected R2 keeps its
		// number, so the next attempt at revising R1 must become R3.
		const revision = previous
			? (await latestRevision(db, business.id, base)) + 1
			: 1;
		const [row] = await db
			.insert(schema.quotes)
			.values({
				number: revision > 1 ? `${base}-R${revision}` : base,
				revision,
				supersedesId: previous?.id ?? null,
				businessId: business.id,
				requestId,
				requirementVersion: current.briefVersion,
				requirementsSnapshot: snapshot,
				lineItems,
				terms,
				...t,
				validUntil,
			})
			.returning();
		return row;
	});
}

// --- Deciding the next step ---------------------------------------------------------------

type Advance = {
	catalog: Catalog;
	conversation: typeof schema.conversations.$inferSelect;
	request: typeof schema.quoteRequests.$inferSelect;
	brief: Brief;
	changed: boolean;
	confirmation: Reading["confirmation"];
	forceDraft?: boolean;
	run: Run;
	history: ChatTurn[];
	customerQuestion: string | null;
	topic?: Reading["topic"];
	asksForDiscount?: boolean;
	messageId?: string;
	/** Staff pressed "Ask now": always send something useful, never a recap of nothing. */
	nudged?: boolean;
};

/**
 * Picks the stage from what's known: keep asking, recap for confirmation, or
 * draft. Saves the request, drafts if due, and writes the reply.
 */
async function advance(a: Advance) {
	try {
		return await advanceRequest(a);
	} catch (error) {
		await a.run.add({
			kind: "error",
			title: "This action needs attention",
			detail: [error instanceof Error ? error.message : String(error)],
		});
		await a.run.finish("failed");
		throw error;
	}
}

async function advanceRequest(a: Advance): Promise<{
	status: RequestStatus;
	reply: string | null;
}> {
	const db = getDb();
	const { catalog, request, run } = a;
	const { business } = catalog;
	const brief = a.brief;
	const products = intakeProducts(catalog.products);
	const assessment = assess(brief, products, catalog.questions);
	const isRevision = Boolean(brief.revisionOf);
	const wasDrafted =
		request.status === "draft_ready" || request.status === "needs_review";

	// Out of stock or switched off? Tell the customer as soon as we know, not after the draft.
	const issues = availabilityIssues(brief, catalog.products, todayMY());
	const told = new Set(brief.availabilityTold ?? []);
	const fresh = a.forceDraft ? [] : issues.filter((i) => !told.has(i.key));
	const allUnavailable =
		assessment.items.length > 0 &&
		assessment.items.every((v) => v.product?.active === false);
	if (issues.length) {
		await run.add({
			kind: "check",
			title: fresh.length
				? `Availability: telling the customer about ${fresh.length === 1 ? fresh[0].name : `${fresh.length} items`}`
				: "Availability: customer already knows",
			detail: [
				...issues.map(describeIssue),
				"Stock and availability come from Products, not the AI.",
			],
		});
	}

	await run.add({
		kind: "check",
		title: assessment.blocking.length
			? `Requirements: ${assessment.requiredAnswered}/${assessment.requiredTotal} answered`
			: "All required details are in",
		detail: [
			...assessment.missing.map((m) => `Missing: ${describeMissing(m)}`),
			...(assessment.missing.length === 0 ? ["Nothing left to ask"] : []),
		],
	});

	let status: RequestStatus;
	let plan: ReplyPlan;
	let draft = false;
	let asks: Missing[] = [];

	if (a.forceDraft) {
		if (assessment.blocking.length)
			throw new Error(
				"Resolve or explicitly waive the required details before drafting.",
			);
		draft = true;
		status = "draft_ready";
		plan = { stage: "chat" };
	} else if (allUnavailable) {
		// Nothing we can quote right now: no point asking more; staff follow up.
		status = "needs_review";
		plan = { stage: "chat" };
	} else if (assessment.missing.length > 0) {
		status = "gathering";
		asks = nextToAsk(assessment.missing);
		const first = asks[0];
		plan =
			first.kind === "need"
				? { stage: "need", offerings: offerings(products) }
				: first.kind === "identify"
					? {
							stage: "identify",
							rawText: first.item.rawText,
							options: first.candidates.map((c) => c.name),
						}
					: {
							stage: "gathering",
							asks: asks
								.map((m) => toAsk(m, new Set(brief.asked)))
								.filter((x): x is Ask => x !== null),
						};
	} else if (
		request.status === "confirming" &&
		a.confirmation === "confirmed" &&
		!a.changed
	) {
		draft = true;
		status = "draft_ready";
		plan = {
			stage: "drafted",
			customPriced: assessment.items.some(
				(i) => i.product?.pricingMode === "custom",
			),
			isRevision,
		};
	} else if (
		(wasDrafted || request.status === "confirming") &&
		!a.changed &&
		!a.nudged &&
		a.confirmation !== "changed"
	) {
		// Nothing new (e.g. a side question while we wait): just reply, keep the stage.
		status = request.status;
		plan = { stage: "chat" };
	} else {
		status = "confirming";
		plan = {
			stage: "confirming",
			summary: summaryLines(assessment, brief, issues),
			isRevision,
		};
	}
	// Everything still short or unavailable has now been told (the reply below says it).
	if (!a.forceDraft) brief.availabilityTold = issues.map((i) => i.key);

	await run.add({
		kind: "ask",
		title:
			plan.stage === "gathering" ||
			plan.stage === "identify" ||
			plan.stage === "need"
				? `Asking ${asks.length === 1 ? "1 thing" : `${asks.length} things`} next`
				: plan.stage === "confirming"
					? "Sending a summary for the customer to confirm"
					: draft
						? a.forceDraft
							? "Staff asked to draft now"
							: "Customer confirmed: drafting the quotation"
						: allUnavailable
							? "Nothing available to quote: handed to staff"
							: "Nothing to ask: replying to the message",
		detail:
			plan.stage === "confirming"
				? plan.summary
				: asks.map((m) => describeMissing(m)),
	});

	// Write the customer's reply while the draft is priced: AI estimates for custom
	// items can take a while, and the reply doesn't depend on the numbers.
	// Staff drafting doesn't message the customer; they'll see the quote when it's sent.
	const notOffered = brief.items
		.filter((i) => i.match === "none")
		.map((i) => i.rawText);
	const replying: Promise<string | null> = a.forceDraft
		? Promise.resolve(null)
		: (async () => {
				try {
					return (
						(await writeReply({
							business,
							customerName: a.conversation.customerName,
							language: brief.language,
							plan,
							customerQuestion: a.customerQuestion,
							topic: a.topic,
							asksForDiscount: a.asksForDiscount,
							knowledge: await publicFaq(
								business.id,
								a.customerQuestion,
								a.run,
								[brief.summary, latestCustomerBody(a.history)],
							),
							notOffered,
							// The recap already carries the note next to the item.
							availability: plan.stage === "confirming" ? [] : fresh,
							history: a.history,
							firstReply: !a.history.some((m) => m.sender !== "customer"),
						})) || fallbackReply(brief.language)
					);
				} catch {
					return fallbackReply(brief.language);
				}
			})();

	// Remember what we asked, so optional questions are asked only once.
	const asked = new Set(brief.asked);
	for (const m of asks) asked.add(m.id);
	brief.asked = [...asked];
	for (const m of asks)
		if (m.kind === "follow_up") {
			const f = brief.followUps.find((x) => x.id === m.followUp.id);
			if (f) f.asked = true;
		}

	if (draft) {
		const result = priceBrief(
			brief,
			catalog.products,
			catalog.rules,
			catalog.questions,
			todayMY(),
		);
		status = result.outcome;
		const saved = await saveRequest(
			request.id,
			{
				status: result.outcome,
				brief,
				flags: result.flags,
				...(a.messageId ? { processedMessageId: a.messageId } : {}),
			},
			request.briefVersion,
			a.forceDraft ? "staff" : "quora-chat",
			"Updated customer requirements",
			request.status,
		);
		const estimated = await estimateCustomGaps(a, result);
		const quote = await upsertDraftQuote(
			saved,
			business,
			[...result.lineItems, ...estimated.lines],
			brief.revisionOf,
			products,
			catalog.questions,
			withSchedule(addWeeks(result.terms, estimated.weeks), business.billing),
		);
		if (result.lineItems.length) {
			await run.add({
				kind: "price",
				title: `Drafted ${quote.number}: ${formatMYR(quote.totalSen)} incl. SST`,
				detail: [
					...result.explain.flatMap((e) => e.lines),
					...estimated.log,
					estimated.lines.length
						? "Price-list parts come from the business; AI estimates are effort × the business's rate and need checking."
						: "Prices come from the pricing engine, not the AI.",
				],
			});
		}
		await run.add({
			kind: "decide",
			title:
				status === "needs_review"
					? "Staff need to review or price before sending"
					: "Draft ready for staff approval",
			detail: result.flags.length
				? result.flags.map((f) => f.message)
				: ["Nothing is sent to the customer until staff approve the quote."],
		});
		await emitOrbyteEvent(db, {
			businessId: business.id,
			requestId: request.id,
			type:
				status === "needs_review"
					? "quote.request.flagged_for_review"
					: "quote.draft.prepared",
			actor: a.forceDraft ? "staff" : "quora-chat",
			summary:
				status === "needs_review"
					? `${quote.number} drafted for review: ${result.flags.map((f) => f.message).join("; ")}`
					: `Draft ${quote.number} prepared (${formatMYR(quote.totalSen)})`,
			payload: { quoteId: quote.id, flags: result.flags },
		});
	} else {
		await saveRequest(
			request.id,
			{
				status,
				brief,
				...(allUnavailable
					? {
							flags: issues.map((i) => ({
								kind: "unavailable" as const,
								itemIndex: brief.items.findIndex((x) => x.id === i.itemId),
								message: `${describeIssue(i)}. Customer was told; follow up with them.`,
							})),
						}
					: {}),
				...(a.messageId ? { processedMessageId: a.messageId } : {}),
			},
			request.briefVersion,
			"quora-chat",
			"Updated customer requirements",
			request.status,
		);
		if (allUnavailable && request.status !== "needs_review") {
			await emitOrbyteEvent(db, {
				businessId: business.id,
				requestId: request.id,
				type: "quote.request.flagged_for_review",
				actor: "quora-chat",
				summary: `Nothing available to quote: ${issues.map(describeIssue).join("; ")}`,
			});
		} else if (status === "confirming" && request.status !== "confirming") {
			await emitOrbyteEvent(db, {
				businessId: business.id,
				requestId: request.id,
				type: "quote.request.confirmation_requested",
				actor: "quora-chat",
				summary: "All details in; asked the customer to confirm the summary",
			});
		} else if (status === "gathering" && asks.length) {
			await emitOrbyteEvent(db, {
				businessId: business.id,
				requestId: request.id,
				type: "quote.request.clarification_requested",
				actor: "quora-chat",
				summary: `Asked: ${asks.map(describeMissing).join("; ")}`,
			});
		}
	}

	if (fresh.length) await tellStaffAboutAvailability(a, fresh);

	return { status, reply: await replying };
}

/**
 * Custom items: what the customer asked for that the price list doesn't cover,
 * estimated by the AI as effort × the business's rate. Never fails the draft.
 */
async function estimateCustomGaps(
	a: Advance,
	result: ReturnType<typeof priceBrief>,
): Promise<{ lines: LineItem[]; weeks: number; log: string[] }> {
	const out = { lines: [] as LineItem[], weeks: 0, log: [] as string[] };
	if (!result.gaps.length) return out;
	const { business, products } = a.catalog;
	// The brief plus the customer's own words: details no question covers
	// (e.g. "we also deal in USD") still shape the scope.
	const requirements = [
		...(a.brief.summary ? [a.brief.summary] : []),
		...agreementLines(a.brief),
		...a.history
			.filter((m) => m.sender === "customer" && m.body.trim())
			.slice(-15)
			.map((m) => `Customer said: "${m.body.trim().slice(0, 600)}"`),
	];
	const several = a.brief.items.length > 1;
	await Promise.all(
		result.gaps.map(async (gap) => {
			const product = products.find((p) => p.id === gap.productId);
			if (!product) return;
			try {
				const found = await estimateGaps({
					businessName: business.name,
					industry: business.industry,
					productName: product.name,
					requirements,
					covered: gap.covered,
					unpriced: gap.unpriced,
					rateUnit: gap.rate.unit,
				});
				for (const g of found) {
					const quantity = Math.max(1, Math.round(g.effort));
					out.lines.push({
						productId: product.id,
						description: several ? `${product.name}: ${g.label}` : g.label,
						quantity,
						unit: gap.rate.unit,
						unitPriceSen: gap.rate.amountSen,
						amountSen: quantity * gap.rate.amountSen,
						charge: "one_time",
						source: "ai_estimate",
						estimate: { reasoning: g.reasoning },
					});
					out.weeks += g.weeks;
					out.log.push(
						`AI estimate — ${g.label}: ${quantity} ${gap.rate.unit}s × ${formatMYR(gap.rate.amountSen)} = ${formatMYR(quantity * gap.rate.amountSen)} (${g.reasoning})`,
					);
				}
				if (!found.length)
					out.log.push(
						`${product.name}: the price list covers everything asked`,
					);
			} catch (error) {
				out.log.push(
					`${product.name}: couldn't estimate extra work (${error instanceof Error ? error.message : String(error)}); staff to check`,
				);
			}
		}),
	);
	return out;
}

/** Staff hear about it at the same time as the customer, so they can step in. */
async function tellStaffAboutAvailability(
	a: Advance,
	issues: AvailabilityIssue[],
) {
	const db = getDb();
	const { business } = a.catalog;
	const approvers = await db
		.select({ id: schema.staff.id })
		.from(schema.staff)
		.where(
			and(
				eq(schema.staff.businessId, business.id),
				eq(schema.staff.canApprove, true),
			),
		);
	const short = issues.some((i) => i.kind === "short");
	await notify(db, {
		businessId: business.id,
		staffIds: approvers.map((s) => s.id),
		title: `${short ? "Not enough stock" : "Unavailable item"} for ${a.conversation.customerName}`,
		body: `${issues.map(describeIssue).join("; ")}. The customer has been told; take over if you can help.`,
		link: `/orbyte/${business.id}/inbox?c=${a.conversation.id}`,
	});
	await emitOrbyteEvent(db, {
		businessId: business.id,
		requestId: a.request.id,
		type: "quote.request.availability_told",
		actor: "quora-chat",
		summary: `Told ${a.conversation.customerName}: ${issues.map(describeIssue).join("; ")}`,
		payload: { issues },
	});
}

/**
 * "ok", "5", "👍", "tq" or a bare file say nothing about language, so they keep
 * the one we were using instead of flipping the reply to English.
 */
export function hasClearLanguage(text: string) {
	const words = text
		.toLowerCase()
		.replace(/[^\p{L}\s]/gu, " ")
		.split(/\s+/)
		.filter(Boolean);
	if (/\p{Script=Han}/u.test(text)) return true;
	const neutral = new Set([
		"ok",
		"okay",
		"okey",
		"oke",
		"k",
		"kk",
		"yes",
		"no",
		"noted",
		"tq",
		"ty",
		"thanks",
		"thx",
		"sure",
		"done",
		"hi",
		"hello",
		"pcs",
		"pc",
		"unit",
		"units",
	]);
	return words.filter((w) => !neutral.has(w) && w.length > 1).length > 0;
}

function fallbackReply(language: Language) {
	return language === "ms"
		? "Ok noted, team kami akan semak dan balas sekejap lagi ya."
		: language === "zh"
			? "好的收到，我们的同事稍后回复您。"
			: "Ok noted, our team will get back to you shortly.";
}

/**
 * Published FAQ passages for a customer's question. Only "public" docs: internal
 * knowledge is never loaded for the customer-facing AI, whatever the message says.
 */
const latestCustomerBody = (history: ChatTurn[]) =>
	[...history].reverse().find((m) => m.sender === "customer")?.body ?? "";

/**
 * Public FAQ passages for this reply. Every reply gets the ones relevant to the
 * chat (not only when they ask something), so the AI can mention a policy when
 * it helps. Only Public documents ever reach the customer-facing AI.
 */
async function publicFaq(
	businessId: string,
	question: string | null,
	run: Run,
	context: (string | null | undefined)[] = [],
) {
	const query = [question, ...context].filter(Boolean).join(" ");
	if (!query.trim()) return [];
	const passages = await findKnowledge(businessId, "customer", query, 3).catch(
		() => [],
	);
	// Staff can see what the customer was told it from, or that nothing covered it.
	if (passages.length)
		await run.add({
			kind: "check",
			title: question
				? "Answered their question from the public FAQ"
				: "Public FAQ given to the reply",
			detail: [
				...(question ? [`Question: ${question}`] : []),
				...[...new Set(passages.map((p) => p.title))].map(
					(t) => `Source: ${t}`,
				),
				"Only Public documents are given to the customer-facing AI.",
			],
		});
	else if (question)
		await run.add({
			kind: "check",
			title: "No public FAQ covers their question",
			detail: [
				`Question: ${question}`,
				"Told them the team will check, rather than guessing.",
			],
		});
	return passages;
}

// --- Customer message ---------------------------------------------------------------------

export async function* handleCustomerMessage(input: {
	conversationId: string;
	body: string;
	attachment?: { name: string; mime: string; dataUrl: string } | null;
}): AsyncGenerator<WorkflowStep> {
	const db = getDb();
	const conversation = await db.query.conversations.findFirst({
		where: eq(schema.conversations.id, input.conversationId),
	});
	if (!conversation) throw new Error("Conversation not found");

	const attachment: Attachment | null = input.attachment
		? {
				name: input.attachment.name,
				mime: input.attachment.mime,
				size: Math.round((input.attachment.dataUrl.length * 3) / 4),
			}
		: null;
	const incoming = await db.transaction(async (tx) => {
		await tx
			.select({ id: schema.conversations.id })
			.from(schema.conversations)
			.where(eq(schema.conversations.id, conversation.id))
			.for("update");
		const [message] = await tx
			.insert(schema.messages)
			.values({
				conversationId: conversation.id,
				sender: "customer",
				body: input.body,
				attachment,
				attachmentData: input.attachment?.dataUrl ?? null,
			})
			.returning();
		return message;
	});
	const lease = await claimTurn(conversation.id);
	try {
		// Re-read: staff may have taken over while this message waited.
		const fresh =
			(await db.query.conversations.findFirst({
				where: eq(schema.conversations.id, conversation.id),
			})) ?? conversation;
		yield* customerTurn(fresh, incoming, attachment, input);
	} finally {
		await releaseTurn(conversation.id, lease);
	}
}

const TURN_LEASE_MS = 90_000;

/**
 * Waits for this chat's turn: one AI turn at a time per chat, so two quick
 * messages don't race on the same requirements. A lease, not a lock: a turn
 * that crashes frees the chat after 90 seconds.
 */
async function claimTurn(conversationId: string) {
	const deadline = Date.now() + 60_000;
	for (;;) {
		const until = new Date(Date.now() + TURN_LEASE_MS);
		const [row] = await getDb()
			.update(schema.conversations)
			.set({ processingUntil: until })
			.where(
				and(
					eq(schema.conversations.id, conversationId),
					or(
						isNull(schema.conversations.processingUntil),
						lte(schema.conversations.processingUntil, new Date()),
					),
				),
			)
			.returning({ id: schema.conversations.id });
		if (row) return until;
		// Never stall a customer forever behind a stuck turn.
		if (Date.now() > deadline) return null;
		await new Promise((r) => setTimeout(r, 250));
	}
}

async function releaseTurn(conversationId: string, lease: Date | null) {
	if (!lease) return;
	await getDb()
		.update(schema.conversations)
		.set({ processingUntil: null })
		.where(
			and(
				eq(schema.conversations.id, conversationId),
				eq(schema.conversations.processingUntil, lease),
			),
		);
}

/** One AI turn for a customer message, run while this chat's turn is held. */
async function* customerTurn(
	conversation: typeof schema.conversations.$inferSelect,
	incoming: typeof schema.messages.$inferSelect,
	attachment: Attachment | null,
	input: { body: string },
): AsyncGenerator<WorkflowStep> {
	const db = getDb();
	const { businessId } = conversation;
	const run = await startRun(conversation.id, incoming.id);
	// A newer message arrived while we waited: its turn reads this one too, so the
	// customer gets one reply to both instead of two that race each other.
	const latest = await db.query.messages.findFirst({
		where: and(
			eq(schema.messages.conversationId, conversation.id),
			eq(schema.messages.sender, "customer"),
		),
		orderBy: desc(schema.messages.createdAt),
		columns: { id: true },
	});
	if (latest && latest.id !== incoming.id) {
		await run.add({
			kind: "read",
			title: "Answered together with their next message",
			detail: ["The customer sent another message right after this one."],
		});
		await run.finish("done");
		yield { step: "held", staffName: null };
		return;
	}
	const open = await findOpenRequest(conversation.id);
	await emitOrbyteEvent(db, {
		businessId,
		requestId: open?.id,
		type: "quote.request.received",
		actor: conversation.customerName,
		summary: `Message from ${conversation.customerName}`,
		payload: { body: input.body, attachment: attachment?.name },
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

	const catalog = await loadCatalog(businessId);

	// Waiting on an answer for a PIC? If this message is it, pass it on and stop.
	const relayed = await matchRelayAnswer({
		conversationId: conversation.id,
		message: incoming,
	});
	if (relayed) {
		await run.add({
			kind: "relay",
			title: `Answered the team's question for ${relayed.job?.number ?? "a job"}`,
			detail: [
				`Question: ${relayed.relay.question}`,
				`Answer: ${relayed.relay.answer}`,
				"Passed to the PIC; no new quotation request",
			],
		});
		const rows = await historyFor(conversation.id, null);
		const reply =
			(await writeReply({
				business: catalog.business,
				customerName: conversation.customerName,
				language:
					(
						await db.query.quoteRequests.findFirst({
							where: eq(schema.quoteRequests.conversationId, conversation.id),
							orderBy: desc(schema.quoteRequests.createdAt),
						})
					)?.brief.language ?? "en",
				plan: { stage: "relay_thanks" },
				customerQuestion: null,
				notOffered: [],
				history: toTurns(rows),
				firstReply: false,
			}).catch(() => "")) || fallbackReply("en");
		yield { step: "staged", status: null, requestId: null };
		await db.insert(schema.messages).values({
			conversationId: conversation.id,
			sender: "assistant",
			body: reply,
		});
		await run.add({ kind: "reply", title: "Thanked the customer" });
		await run.finish("done");
		yield { step: "replied", body: reply };
		return;
	}

	const sent = open ? null : await findSentQuote(conversation.id);
	const activeSigned =
		sent?.quote.status === "accepted"
			? sent
			: await findActiveSignedQuote(conversation.id);
	const quoteContext = sent ?? activeSigned;
	const rows = await historyFor(
		conversation.id,
		open ?? quoteContext?.request ?? null,
	);
	const history = toTurns(rows);
	await run.add({
		kind: "read",
		title: `Read the conversation (${history.filter((m) => m.sender === "customer").length} customer messages in this request)`,
		detail: [
			`Checked against ${catalog.products.length} products, ${catalog.questions.length} preset questions and ${catalog.rules.length} pricing rules`,
			...(attachment ? [`Customer sent a file: ${attachment.name}`] : []),
		],
	});

	const brief0 =
		open?.brief ??
		sent?.quote.requirementsSnapshot ??
		sent?.request.brief ??
		emptyBrief();
	const products = intakeProducts(catalog.products);
	// Replies follow the customer's latest message; "ok" or a photo keeps the language we were using.
	const previousLanguage =
		open?.brief.language ??
		sent?.request.brief.language ??
		activeSigned?.request.brief.language ??
		(
			await db.query.quoteRequests.findFirst({
				where: eq(schema.quoteRequests.conversationId, conversation.id),
				orderBy: desc(schema.quoteRequests.createdAt),
			})
		)?.brief.language ??
		null;
	const latestText =
		[...history].reverse().find((m) => m.sender === "customer")?.body ?? "";
	let reading: Reading;
	try {
		reading = await readTurn({
			businessName: catalog.business.name,
			industry: catalog.business.industry,
			catalog: catalog.products.map((p) => ({
				id: p.id,
				sku: p.sku,
				name: p.name,
				description: p.description,
				category: p.category,
				unit: p.unit,
				pricing: p.pricingMode,
				available: p.active,
				questions: questionsFor(p, catalog.questions).map(toCatalogQuestion),
			})),
			generalQuestions: businessQuestions(catalog.questions).map(
				toCatalogQuestion,
			),
			brief: {
				items: brief0.items.map((i) => ({
					ref: i.id,
					productId: i.productId,
					match: i.match,
					rawText: i.rawText,
					quantity: i.quantity,
					answers: answerValues(i.answers),
				})),
				general: answerValues(brief0.general),
			},
			openFollowUps: brief0.followUps
				.filter((f) => !followUpResolved(f))
				.map((f) => ({ id: f.id, question: f.question })),
			stage: open?.status === "confirming" ? "confirming" : "gathering",
			sentQuote:
				sent?.quote.status === "approved"
					? {
							number: sent.quote.number,
							signed: false,
							lines: sent.quote.lineItems.map(
								(l) => `${l.description} × ${l.quantity} ${l.unit}`,
							),
						}
					: null,
			activeSignedQuote: activeSigned
				? {
						number: activeSigned.quote.number,
						lines: activeSigned.quote.lineItems.map(
							(l) => `${l.description} × ${l.quantity} ${l.unit}`,
						),
					}
				: null,
			history,
			latestHasAttachment: Boolean(attachment),
			previousLanguage,
			today: todayMY(),
		});
	} catch (err) {
		// Never guess: if the AI fails, hand the conversation to a human.
		const message = err instanceof Error ? err.message : String(err);
		if (open) {
			await saveRequest(open.id, {
				status: "needs_review",
				flags: [
					{
						kind: "ai_uncertain",
						message: "Automatic reading failed — please handle manually.",
					},
				],
			});
			await run.setRequest(open.id);
		}
		await emitOrbyteEvent(db, {
			businessId,
			requestId: open?.id,
			type: "quote.processing_failed",
			actor: "quora-chat",
			summary: "AI could not read the message; flagged for staff",
			payload: { error: message },
		});
		await run.add({
			kind: "error",
			title: "Could not read the message — handed to staff",
			detail: [message],
		});
		await run.finish("failed");
		yield { step: "failed", error: message };
		return;
	}

	if (previousLanguage && !hasClearLanguage(latestText))
		reading = { ...reading, language: previousLanguage };

	yield {
		step: "parsed",
		summary: reading.summary,
		language: reading.language,
		itemCount: reading.items.filter((i) => !i.removed).length,
	};

	// A definite cancellation of an active signed order takes priority over
	// revisions, relayed questions and new enquiries. Questions or hypotheticals
	// are deliberately classified as "question" and never enter this branch.
	if (activeSigned && reading.quoteResponse.intent === "cancel_signed_order") {
		const requestId = open?.id ?? activeSigned.request.id;
		let outcome: Awaited<ReturnType<typeof cancelSignedOrder>> | null = null;
		let reviewReason: string | null = null;
		try {
			outcome = await cancelSignedOrder({
				quoteId: activeSigned.quote.id,
				actor: conversation.customerName,
				note: reading.quoteResponse.note,
				messageId: incoming.id,
				processedRequestId: requestId,
			});
		} catch (error) {
			if (!(error instanceof CancellationNeedsReviewError)) throw error;
			reviewReason = error.message;
			await db
				.update(schema.quoteRequests)
				.set({ processedMessageId: incoming.id, updatedAt: new Date() })
				.where(eq(schema.quoteRequests.id, requestId));
			await flagCancellationForReview({
				quoteId: activeSigned.quote.id,
				actor: conversation.customerName,
				reason: reviewReason,
			});
		}

		await run.setRequest(requestId);
		await run.add({
			kind: "understand",
			title: `Customer decided to cancel ${activeSigned.quote.number}`,
			detail: reading.reasoning,
		});
		await run.add({
			kind: "decide",
			title: outcome
				? `${activeSigned.quote.number} cancelled automatically`
				: "Cancellation sent to staff for review",
			detail: outcome
				? [
						outcome.released.length
							? `Released ${outcome.released.map((stock) => `${stock.quantity} ${stock.unit} ${stock.name}`).join(", ")}`
							: "No stock reservation needed release",
						`${outcome.voidedInvoices} unpaid invoice${outcome.voidedInvoices === 1 ? "" : "s"} voided`,
						...(outcome.paidInvoices
							? ["Paid invoice retained for staff refund review"]
							: []),
					]
				: [reviewReason ?? "The order needs staff review"],
		});

		const instruction = outcome
			? `The customer's signed order ${outcome.quoteNumber} has now been cancelled. Confirm this clearly. ${outcome.released.length ? "Tell them the reserved stock has been released." : "There was no reserved stock to release."} ${outcome.voidedInvoices ? "Tell them any unpaid invoice was cancelled." : ""} ${outcome.paidInvoices ? "Say the team will contact them separately about the payment already received; do not promise or assume a refund." : ""} Be brief, respectful, and do not ask them to reconsider.`
			: `They asked to cancel their signed order, but it could not be completed automatically because ${reviewReason ?? "it needs staff review"}. Say you have sent it to the team for urgent review and they will confirm. Do not say the order is cancelled or that stock/payment was released.`;
		const language = reading.language === "mixed" ? "en" : reading.language;
		const fallback = outcome
			? {
					en: `Your signed order ${outcome.quoteNumber} has been cancelled as requested.${outcome.released.length ? " The reserved stock has been released." : ""}${outcome.paidInvoices ? " Our team will contact you separately about the payment already received." : ""}`,
					ms: `Pesanan yang telah ditandatangani ${outcome.quoteNumber} telah dibatalkan seperti diminta.${outcome.released.length ? " Stok yang ditempah telah dilepaskan." : ""}${outcome.paidInvoices ? " Pasukan kami akan menghubungi anda berasingan tentang bayaran yang telah diterima." : ""}`,
					zh: `已按您的要求取消已签署的订单 ${outcome.quoteNumber}。${outcome.released.length ? "预留库存已释放。" : ""}${outcome.paidInvoices ? "我们的团队会另行联系您处理已收到的款项。" : ""}`,
				}[language]
			: {
					en: "I've sent your cancellation request to the team for urgent review. They'll confirm it with you shortly.",
					ms: "Saya telah menghantar permintaan pembatalan anda kepada pasukan untuk semakan segera. Mereka akan mengesahkannya dengan anda tidak lama lagi.",
					zh: "我已将您的取消请求提交给团队紧急审核，他们会尽快向您确认。",
				}[language];
		const reply =
			(await writeReply({
				business: catalog.business,
				customerName: conversation.customerName,
				language: reading.language,
				plan: { stage: "note", instruction },
				customerQuestion: null,
				notOffered: [],
				history,
				firstReply: false,
			}).catch(() => "")) || fallback;
		yield { step: "staged", status: null, requestId };
		await db.insert(schema.messages).values({
			conversationId: conversation.id,
			sender: "assistant",
			body: reply,
		});
		await run.add({
			kind: "reply",
			title: `Confirmed the cancellation in ${languageLabel[reading.language]}`,
		});
		await run.finish("done");
		yield { step: "replied", body: reply };
		return;
	}

	// After a quote was sent, anything that isn't a change to it is a new enquiry:
	// start a fresh brief with only the new items.
	const startFresh = Boolean(sent && !open && !reading.wantsChange);
	const oldRefs = new Set(brief0.items.map((i) => i.id));
	const { brief, changed } = applyReading(
		startFresh ? emptyBrief(reading.language) : brief0,
		startFresh
			? { ...reading, items: reading.items.filter((i) => !oldRefs.has(i.ref)) }
			: reading,
		incoming,
		catalog,
		history,
	);
	const names = new Map(products.map((p) => [p.id, p.name]));
	await run.add({
		kind: "understand",
		title: reading.summary || "Reading the message",
		detail: [
			previousLanguage && previousLanguage !== reading.language
				? `Customer switched from ${languageLabel[previousLanguage]} to ${languageLabel[reading.language]}, so we reply in ${languageLabel[reading.language]} too`
				: `Latest message is in ${languageLabel[reading.language]}, so we reply in it`,
			...reading.reasoning,
			...(reading.customerQuestion
				? [`They asked: ${reading.customerQuestion}`]
				: []),
			...(reading.followUp
				? [
						`Follow-up on "${reading.followUp.aboutKey}": ${reading.followUp.question}`,
					]
				: []),
		],
	});
	await run.add({
		kind: "match",
		title:
			brief.items.length === 0
				? "No products or services identified yet"
				: `${brief.items.length} item${brief.items.length === 1 ? "" : "s"} in the brief`,
		detail: brief.items.map((i) => {
			const target =
				i.match === "exact" && i.productId
					? (names.get(i.productId) ?? i.productId)
					: i.match === "ambiguous"
						? `could be ${i.candidateProductIds.map((id) => names.get(id) ?? id).join(" or ")}`
						: "not in the catalog";
			return `"${i.rawText}" → ${target}${i.quantity ? ` · qty ${i.quantity}` : ""}${i.reason ? ` — ${i.reason}` : ""}`;
		}),
	});

	// A reply to a quote that's waiting for their signature ("later", price, no thanks).
	if (!open && sent && !reading.wantsChange) {
		const handled = await onCustomerReplyToQuote({
			quoteId: sent.quote.id,
			response: reading.quoteResponse,
			customerName: conversation.customerName,
		});
		if (
			handled ||
			(sent.quote.status === "approved" &&
				(reading.quoteResponse.intent === "question" ||
					(brief.items.length === 0 &&
						Object.keys(brief.general).length === 0)))
		) {
			await saveRequest(
				sent.request.id,
				{ processedMessageId: incoming.id },
				sent.request.briefVersion,
				conversation.customerName,
				"Processed reply to sent quote",
				"approved",
			);
			await run.setRequest(sent.request.id);
			await run.add({
				kind: "decide",
				title: handled?.summary ?? "Question about the quotation",
				detail: [`About ${sent.quote.number}, still waiting for a signature`],
			});
			const reply =
				(await writeReply({
					business: catalog.business,
					customerName: conversation.customerName,
					language: reading.language,
					plan: {
						stage: "note",
						instruction:
							handled?.instruction ??
							"Answer their question about this quotation using the agreed requirements. Do not change the scope, price or promise new work.",
					},
					customerQuestion: reading.customerQuestion,
					topic: reading.topic,
					asksForDiscount: reading.asksForDiscount,
					knowledge: await publicFaq(
						businessId,
						reading.customerQuestion,
						run,
						[reading.summary, latestCustomerBody(history)],
					),
					notOffered: [],
					history,
					firstReply: false,
				}).catch(() => "")) || fallbackReply(reading.language);
			yield { step: "staged", status: null, requestId: sent.request.id };
			await db.insert(schema.messages).values({
				conversationId: conversation.id,
				sender: "assistant",
				body: reply,
			});
			await run.add({
				kind: "reply",
				title: `Replied in ${languageLabel[reading.language]}`,
			});
			await run.finish("done");
			yield { step: "replied", body: reply };
			return;
		}
	}

	// A change to a quote that was already sent reopens its request as a revision.
	let request = open;
	if (!request && sent && reading.wantsChange) {
		brief.revisionOf = sent.quote.id;
		request =
			sent.quote.status === "accepted"
				? await createRequest(
						{
							businessId,
							conversationId: conversation.id,
							status: "gathering",
							brief,
							processedMessageId: incoming.id,
						},
						conversation.customerName,
					)
				: await saveRequest(
						sent.request.id,
						{ status: "gathering", brief },
						sent.request.briefVersion,
					);
		await onQuoteClosed(sent.quote.id); // no reminders while requirements change
		await emitOrbyteEvent(db, {
			businessId,
			requestId: request.id,
			type: "quote.revision.requested",
			actor: conversation.customerName,
			summary: `${conversation.customerName} asked to change ${sent.quote.number}`,
		});
	}

	const hasContent =
		brief.items.length > 0 || Object.keys(brief.general).length > 0;
	if (!request && hasContent) {
		request = await createRequest({
			businessId,
			conversationId: conversation.id,
			status: "gathering",
			brief,
		});
		await emitOrbyteEvent(db, {
			businessId,
			requestId: request.id,
			type: "quote.request.parsed",
			actor: "quora-chat",
			summary: `New enquiry: ${reading.summary}`,
		});
	}

	let reply: string;
	let status: RequestStatus | null = null;
	if (!request) {
		// Small talk, or they haven't said what they need yet.
		const hadRequest =
			Boolean(sent) ||
			(await db.query.quoteRequests.findFirst({
				where: eq(schema.quoteRequests.conversationId, conversation.id),
			})) !== undefined;
		await run.add({
			kind: "ask",
			title: hadRequest
				? "No new request: replying to the message"
				: "Asking what they need",
		});
		reply =
			(await writeReply({
				business: catalog.business,
				customerName: conversation.customerName,
				language: reading.language,
				plan: hadRequest
					? { stage: "chat" }
					: { stage: "need", offerings: offerings(products) },
				customerQuestion: reading.customerQuestion,
				topic: reading.topic,
				asksForDiscount: reading.asksForDiscount,
				knowledge: await publicFaq(businessId, reading.customerQuestion, run, [
					reading.summary,
					latestCustomerBody(history),
				]),
				notOffered: [],
				history,
				firstReply: !history.some((m) => m.sender !== "customer"),
			}).catch(() => "")) || fallbackReply(reading.language);
	} else {
		await run.setRequest(request.id);
		if (request.status === "confirming" && reading.confirmation === "confirmed")
			await emitOrbyteEvent(db, {
				businessId,
				requestId: request.id,
				type: "quote.request.confirmed",
				actor: conversation.customerName,
				summary: `${conversation.customerName} confirmed the requirements`,
			});
		const result = await advance({
			catalog,
			conversation,
			request,
			brief,
			changed,
			confirmation: reading.confirmation,
			run,
			history,
			customerQuestion: reading.customerQuestion,
			topic: reading.topic,
			asksForDiscount: reading.asksForDiscount,
			messageId: incoming.id,
		});
		status = result.status;
		reply = result.reply ?? fallbackReply(brief.language);
	}
	yield { step: "staged", status, requestId: request?.id ?? null };

	await db.insert(schema.messages).values({
		conversationId: conversation.id,
		sender: "assistant",
		body: reply,
	});
	await run.add({
		kind: "reply",
		title: `Replied in ${languageLabel[reading.language]}`,
		detail: ["Wrote the message in a natural tone; no prices mentioned"],
	});
	await run.finish("done");
	yield { step: "replied", body: reply };
}

// --- Staff actions on the brief --------------------------------------------------------------

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

async function loadRequest(requestId: string) {
	const request = await getDb().query.quoteRequests.findFirst({
		where: eq(schema.quoteRequests.id, requestId),
	});
	if (!request) throw new Error("Request not found");
	return request;
}

export type BriefEdit =
	| { kind: "answer"; itemId: string | null; key: string; values: string[] }
	| { kind: "skip"; itemId: string | null; key: string; reason: string }
	| { kind: "clear"; itemId: string | null; key: string }
	| { kind: "quantity"; itemId: string; quantity: number | null }
	| { kind: "product"; itemId: string; productId: string }
	| { kind: "add_follow_up"; question: string }
	| { kind: "remove_follow_up"; id: string; reason: string }
	| { kind: "answer_follow_up"; id: string; answer: string };

/** Staff correct or fill in the brief (e.g. after a phone call), or add a question for the AI to ask. */
export async function editBrief(input: {
	requestId: string;
	staffId: string;
	edit: BriefEdit;
	expectedVersion?: number;
}) {
	const db = getDb();
	const request = await loadRequest(input.requestId);
	if (
		input.expectedVersion !== undefined &&
		input.expectedVersion !== request.briefVersion
	)
		throw new Error("Requirements changed. Refresh before editing.");
	if (!OPEN.includes(request.status)) throw new Error("This request is closed");
	const member = await loadStaff(input.staffId, request.businessId);
	const catalog = await loadCatalog(request.businessId);
	const brief = structuredClone(request.brief);
	const now = new Date().toISOString();
	const e = input.edit;
	const answersOf = (itemId: string | null) => {
		if (itemId === null) return brief.general;
		const item = brief.items.find((i) => i.id === itemId);
		if (!item) throw new Error("Item not found");
		return item.answers;
	};
	let summary: string;
	const questionFor = (itemId: string | null, key: string) => {
		const item = brief.items.find((i) => i.id === itemId);
		const product = catalog.products.find((p) => p.id === item?.productId);
		const q = (
			itemId === null
				? businessQuestions(catalog.questions)
				: product
					? questionsFor(product, catalog.questions)
					: []
		).find((q) => q.key === key);
		if (!q) throw new Error("Question not found for this requirement");
		return q;
	};

	switch (e.kind) {
		case "answer": {
			const values = e.values.map((v) => v.trim()).filter(Boolean);
			if (!values.length) throw new Error("Enter an answer");
			const issue = answerIssue(
				{ values, source: "staff", at: now },
				questionFor(e.itemId, e.key),
			);
			if (issue) throw new Error(issue);
			answersOf(e.itemId)[e.key] = {
				values,
				source: "staff",
				by: member.name,
				at: now,
			};
			summary = `${member.name} filled in ${e.key}: ${values.join(", ")}`;
			break;
		}
		case "skip": {
			questionFor(e.itemId, e.key);
			if (!member.canApprove)
				throw new Error("Only an approver can waive a requirement");
			if (!e.reason.trim())
				throw new Error("Explain why this requirement can be waived");
			answersOf(e.itemId)[e.key] = {
				values: [],
				source: "skipped",
				by: member.name,
				at: now,
				waiverReason: e.reason.trim(),
			};
			summary = `${member.name} waived ${e.key}: ${e.reason.trim()}`;
			break;
		}
		case "clear":
			delete answersOf(e.itemId)[e.key];
			summary = `${member.name} cleared ${e.key}`;
			break;
		case "quantity": {
			const item = brief.items.find((i) => i.id === e.itemId);
			if (!item) throw new Error("Item not found");
			item.quantity = e.quantity;
			summary = `${member.name} set the quantity of "${item.rawText}" to ${e.quantity ?? "unknown"}`;
			break;
		}
		case "product": {
			const item = brief.items.find((i) => i.id === e.itemId);
			if (!item) throw new Error("Item not found");
			if (!catalog.products.some((p) => p.id === e.productId))
				throw new Error("Product is not in this business's active catalog");
			if (item.productId !== e.productId) item.answers = {};
			item.productId = e.productId;
			item.match = "exact";
			summary = `${member.name} matched "${item.rawText}" to ${e.productId}`;
			break;
		}
		case "add_follow_up": {
			const question = e.question.trim();
			if (!question) throw new Error("Type a question");
			brief.followUps.push({
				id: crypto.randomUUID().slice(0, 8),
				question,
				from: "staff",
				by: member.name,
				answer: null,
				asked: false,
				at: now,
			});
			summary = `${member.name} asked the AI to find out: ${question}`;
			break;
		}
		case "remove_follow_up": {
			if (!member.canApprove)
				throw new Error("Only an approver can waive a follow-up");
			if (!e.reason.trim())
				throw new Error("Explain why this follow-up can be waived");
			const f = brief.followUps.find((f) => f.id === e.id);
			if (!f) throw new Error("Follow-up not found");
			f.waivedBy = member.name;
			f.waiverReason = e.reason.trim();
			summary = `${member.name} waived a follow-up: ${e.reason.trim()}`;
			break;
		}
		case "answer_follow_up": {
			const f = brief.followUps.find((x) => x.id === e.id);
			if (!f) throw new Error("Question not found");
			f.answer = e.answer.trim() || null;
			delete f.waivedBy;
			delete f.waiverReason;
			summary = `${member.name} answered: ${f.question}`;
			break;
		}
	}

	// New gaps mean the customer hasn't confirmed everything any more.
	brief.summary = brief.items
		.map(
			(item) =>
				`${catalog.products.find((p) => p.id === item.productId)?.name ?? item.rawText}${item.quantity !== null ? ` × ${item.quantity}` : ""}`,
		)
		.join("; ");
	const latest = await db.query.messages.findFirst({
		where: and(
			eq(schema.messages.conversationId, request.conversationId),
			eq(schema.messages.sender, "customer"),
		),
		orderBy: desc(schema.messages.createdAt),
	});
	const row = await saveRequest(
		request.id,
		{
			brief,
			status: "gathering",
			processedMessageId: latest?.id ?? request.processedMessageId,
		},
		request.briefVersion,
		member.name,
		summary,
		request.status,
	);
	await emitOrbyteEvent(db, {
		businessId: request.businessId,
		requestId: request.id,
		type: "quote.brief.edited",
		actor: member.name,
		summary,
	});
	return row;
}

/** Staff nudge: have the AI send its next question (or the recap) right now. */
export async function askNow(input: { requestId: string; staffId: string }) {
	return staffAdvance({ ...input, forceDraft: false });
}

/** Staff skip the remaining questions and draft from what's known. */
export async function draftNow(input: { requestId: string; staffId: string }) {
	return staffAdvance({ ...input, forceDraft: true });
}

async function staffAdvance(input: {
	requestId: string;
	staffId: string;
	forceDraft: boolean;
}) {
	const db = getDb();
	const request = await loadRequest(input.requestId);
	if (!OPEN.includes(request.status)) throw new Error("This request is closed");
	const member = await loadStaff(input.staffId, request.businessId);
	if (input.forceDraft && !member.canApprove)
		throw new Error(
			"Only an approver can prepare a draft without customer confirmation",
		);
	const conversation = await db.query.conversations.findFirst({
		where: eq(schema.conversations.id, request.conversationId),
	});
	if (!conversation) throw new Error("Conversation not found");
	if (!input.forceDraft && conversation.aiPaused)
		throw new Error("Hand the chat back to the AI first");

	const rows = await historyFor(conversation.id, request);
	const anchor = rows.at(-1);
	if (!anchor) throw new Error("No messages yet");
	const run = await startRun(conversation.id, anchor.id);
	await run.setRequest(request.id);
	await run.add({
		kind: "read",
		title: input.forceDraft
			? `${member.name} asked to draft now`
			: `${member.name} asked the AI to follow up now`,
	});
	const catalog = await loadCatalog(request.businessId);
	const result = await advance({
		catalog,
		conversation,
		request,
		brief: structuredClone(request.brief),
		changed: false,
		confirmation: "none",
		forceDraft: input.forceDraft,
		nudged: true,
		run,
		history: toTurns(rows),
		customerQuestion: null,
	});
	if (result.reply) {
		await db.insert(schema.messages).values({
			conversationId: conversation.id,
			sender: "assistant",
			body: result.reply,
		});
		await run.add({ kind: "reply", title: "Sent the follow-up" });
	}
	await run.finish("done");
	return { status: result.status };
}

// --- Staff actions on quotes ---------------------------------------------------------------

export async function editDraftQuote(input: {
	quoteId: string;
	staffId: string;
	lineItems: LineItem[];
	notes: string | null;
	/** Undefined keeps the current timeline and terms. */
	terms?: QuoteTerms | null;
	reviewToken: string;
}) {
	return getDb().transaction(async (db) => {
		const quote = await db.query.quotes.findFirst({
			where: eq(schema.quotes.id, input.quoteId),
		});
		if (!quote) throw new Error("Quote not found");
		const [request] = await db
			.select()
			.from(schema.quoteRequests)
			.where(eq(schema.quoteRequests.id, quote.requestId))
			.for("update");
		const [current] = await db
			.select()
			.from(schema.quotes)
			.where(eq(schema.quotes.id, quote.id))
			.for("update");
		if (current.status !== "draft")
			throw new Error("Only drafts can be edited");
		const issue = quoteAgreementIssue(current, request);
		if (issue) throw new Error(issue);
		if (input.reviewToken !== quoteReviewToken(current))
			throw new Error("The quotation changed. Refresh before editing.");
		const member = await loadStaff(input.staffId, quote.businessId);
		const business = await db.query.businesses.findFirst({
			where: eq(schema.businesses.id, quote.businessId),
		});
		if (!business) throw new Error("Business not found");
		const productIds = input.lineItems.flatMap((l) =>
			l.productId ? [l.productId] : [],
		);
		const products = productIds.length
			? await db
					.select()
					.from(schema.products)
					.where(
						and(
							inArray(schema.products.id, productIds),
							eq(schema.products.businessId, quote.businessId),
						),
					)
			: [];
		if (productIds.some((id) => !products.some((p) => p.id === id)))
			throw new Error("Quote items must belong to this business");

		// Amounts are computed here, never trusted from the browser. A line left exactly
		// as the pricing engine wrote it keeps its amount (e.g. a minimum charge).
		const lineItems = input.lineItems.map((l) => {
			const unchanged = current.lineItems.some(
				(o) =>
					o.productId === l.productId &&
					o.quantity === l.quantity &&
					o.unitPriceSen === l.unitPriceSen &&
					o.amountSen === l.amountSen,
			);
			return {
				...l,
				amountSen: unchanged ? l.amountSen : l.unitPriceSen * l.quantity,
			};
		});
		const [row] = await db
			.update(schema.quotes)
			.set({
				lineItems,
				notes: input.notes,
				...(input.terms !== undefined ? { terms: input.terms } : {}),
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
	});
}

function quoteMessage(input: {
	language: Language;
	name: string;
	number: string;
	total: string;
	validUntil: string;
	sst: boolean;
	revision: boolean;
	/** "RM 1,450.00 / month" etc.; recurring fees sit outside the total. */
	recurring: { monthly: string | null; yearly: string | null };
}) {
	const { name, number, validUntil } = input;
	const per = {
		en: { month: "month", year: "year" },
		ms: { month: "bulan", year: "tahun" },
		zh: { month: "月", year: "年" },
	}[input.language === "mixed" ? "en" : input.language];
	const plus = [
		input.recurring.monthly && `${input.recurring.monthly} / ${per.month}`,
		input.recurring.yearly && `${input.recurring.yearly} / ${per.year}`,
	]
		.filter(Boolean)
		.join(" + ");
	const sst = !input.sst
		? ""
		: { en: " (incl. SST)", ms: " (termasuk SST)", zh: "（含SST）" }[
				input.language === "mixed" ? "en" : input.language
			];
	// SST applies to the one-time total; recurring fees follow it.
	const total = `${input.total}${sst}${plus ? ` + ${plus}` : ""}`;
	switch (input.language) {
		case "ms":
			return `Hi ${name}, ini ${input.revision ? "sebut harga yang dikemas kini" : "sebut harga"} ${number} 👇\nJumlah: ${total}\nSah sehingga ${validUntil}\n\nBoleh semak dulu, kalau ok tekan "Review & sign" ya. Ada soalan, tanya je kat sini.`;
		case "zh":
			return `${name}您好，这是${input.revision ? "更新后的" : "您的"}报价单 ${number} 👇\n总额：${total}\n有效期至 ${validUntil}\n\n您先看看，没问题的话点 "Review & sign" 签署就可以了。有任何问题随时问我们。`;
		default:
			return `Hi ${name}, here's ${input.revision ? "the updated quotation" : "your quotation"} ${number} 👇\nTotal: ${total}\nValid until ${validUntil}\n\nHave a look, and tap "Review & sign" when you're happy with it. Any questions, just ask here.`;
	}
}

export async function decideQuote(input: {
	quoteId: string;
	staffId: string;
	decision: "approved" | "rejected";
	reason?: string;
	reviewToken: string;
}) {
	const decided = await getDb().transaction(async (db) => {
		const initial = await db.query.quotes.findFirst({
			where: eq(schema.quotes.id, input.quoteId),
		});
		if (!initial) throw new Error("Quote not found");
		const requestInfo = await db.query.quoteRequests.findFirst({
			where: eq(schema.quoteRequests.id, initial.requestId),
		});
		if (!requestInfo) throw new Error("Request not found");
		await db
			.select({ id: schema.conversations.id })
			.from(schema.conversations)
			.where(eq(schema.conversations.id, requestInfo.conversationId))
			.for("update");
		const [request] = await db
			.select()
			.from(schema.quoteRequests)
			.where(eq(schema.quoteRequests.id, initial.requestId))
			.for("update");
		const [quote] = await db
			.select()
			.from(schema.quotes)
			.where(eq(schema.quotes.id, input.quoteId))
			.for("update");
		if (quote.status !== "draft")
			throw new Error("Quote has already been decided");
		const reason = input.reason?.trim() || null;
		if (input.decision === "rejected" && !reason)
			throw new Error("Give a reason for rejecting, so it stays traceable");
		if (
			input.decision === "rejected" &&
			quote.requirementVersion !== request.briefVersion
		)
			throw new Error(
				"This outdated draft cannot close the updated request. Prepare the current draft first.",
			);
		if (input.reviewToken !== quoteReviewToken(quote))
			throw new Error(
				"The quotation changed. Refresh and review it before deciding.",
			);
		if (input.decision === "approved") {
			const issue = quoteAgreementIssue(quote, request);
			if (issue) throw new Error(issue);
			const latest = await db.query.messages.findFirst({
				where: and(
					eq(schema.messages.conversationId, request.conversationId),
					eq(schema.messages.sender, "customer"),
				),
				orderBy: desc(schema.messages.createdAt),
			});
			if (latest && latest.id !== request.processedMessageId)
				throw new Error(
					"A customer message has not been reviewed yet. Wait for the updated brief.",
				);
			const catalog = await loadCatalog(request.businessId);
			if (
				assess(
					request.brief,
					intakeProducts(catalog.products),
					catalog.questions,
				).blocking.length
			)
				throw new Error(
					"Resolve or waive the outstanding requirements before approving.",
				);
			const baseline = await deliveryBaseline(db, quote);
			if (baseline) {
				if (
					baseline.quote.status !== "accepted" ||
					(baseline.job &&
						(baseline.job.kind !== "project" ||
							["completed", "closed", "cancelled"].includes(
								baseline.job.status,
							)))
				)
					throw new Error(
						"This signed agreement can no longer be revised as an active project",
					);
				const ids = [...baseline.quote.lineItems, ...quote.lineItems].flatMap(
					(l) => (l.productId ? [l.productId] : []),
				);
				if (
					ids.length &&
					(
						await db
							.select()
							.from(schema.products)
							.where(
								and(
									inArray(schema.products.id, ids),
									eq(schema.products.type, "stock"),
								),
							)
					).length
				)
					throw new Error(
						"Signed changes involving inventory require a separate order and stock review",
					);
			}
		}
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

		const business = await db.query.businesses.findFirst({
			where: eq(schema.businesses.id, quote.businessId),
		});
		const conversation = await db.query.conversations.findFirst({
			where: eq(schema.conversations.id, request.conversationId),
		});

		const now = new Date();
		const [row] = await db
			.update(schema.quotes)
			.set({
				status: input.decision,
				decidedBy: member.id,
				decidedAt: now,
				decisionReason: input.decision === "rejected" ? reason : null,
				// Validity runs from when the customer receives it, not from the draft.
				...(input.decision === "approved" && business
					? {
							validUntil: new Date(
								now.getTime() + business.quoteValidityDays * 86_400_000,
							),
						}
					: {}),
			})
			.where(eq(schema.quotes.id, quote.id))
			.returning();
		let brief: Brief = { ...request.brief, revisionOf: null };
		let briefVersion = request.briefVersion;
		// A rejected revision leaves the earlier sent quote in place. When that quote
		// shares this request, the revision changed its requirements, so put back the
		// requirements it was agreed on; otherwise it could never be signed.
		let restored: typeof schema.quotes.$inferSelect | null = null;
		if (input.decision === "rejected" && quote.supersedesId) {
			const [earlier] = await db
				.select()
				.from(schema.quotes)
				.where(eq(schema.quotes.id, quote.supersedesId))
				.for("update");
			if (
				earlier?.requestId === request.id &&
				earlier.status === "approved" &&
				earlier.requirementsSnapshot
			) {
				brief = {
					...structuredClone(earlier.requirementsSnapshot),
					revisionOf: null,
				};
				if (agreementContent(brief) !== agreementContent(request.brief)) {
					briefVersion = request.briefVersion + 1;
					const reason = `Rejected ${quote.number}; restored the requirements agreed in ${earlier.number}`;
					await db.insert(schema.requirementVersions).values({
						requestId: request.id,
						version: briefVersion,
						brief,
						actor: member.name,
						reason,
					});
					await emitOrbyteEvent(db, {
						businessId: quote.businessId,
						requestId: request.id,
						type: "quote.brief.versioned",
						actor: member.name,
						summary: `Requirements updated to version ${briefVersion}: ${reason}`,
					});
				}
				// Same requirements as its snapshot, now under the current version number.
				if (earlier.requirementVersion !== briefVersion)
					await db
						.update(schema.quotes)
						.set({ requirementVersion: briefVersion })
						.where(eq(schema.quotes.id, earlier.id));
				restored = earlier;
			}
		}
		await db
			.update(schema.quoteRequests)
			.set({
				status:
					input.decision === "rejected" && quote.supersedesId
						? "approved"
						: input.decision,
				brief,
				briefVersion,
				updatedAt: now,
			})
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
			if (quote.supersedesId) {
				const [old] = await db
					.update(schema.quotes)
					.set({ status: "superseded" })
					.where(
						and(
							eq(schema.quotes.id, quote.supersedesId),
							eq(schema.quotes.status, "approved"),
						),
					)
					.returning();
				if (old)
					await emitOrbyteEvent(db, {
						businessId: quote.businessId,
						requestId: request.id,
						type: "quote.superseded",
						actor: member.name,
						summary: `${old.number} replaced by ${quote.number}`,
					});
			}
			await db.insert(schema.messages).values({
				conversationId: request.conversationId,
				sender: "staff",
				authorName: member.name,
				body: quoteMessage({
					language: request.brief.language,
					name: conversation?.customerName ?? "",
					number: quote.number,
					total: formatMYR(quote.totalSen),
					validUntil: row.validUntil.toLocaleDateString("en-MY", {
						timeZone: "Asia/Kuala_Lumpur",
					}),
					sst: Boolean(business?.sstRegistered),
					revision: quote.revision > 1,
					recurring: {
						monthly: sumOf(quote.lineItems, "monthly")
							? formatMYR(sumOf(quote.lineItems, "monthly"))
							: null,
						yearly: sumOf(quote.lineItems, "yearly")
							? formatMYR(sumOf(quote.lineItems, "yearly"))
							: null,
					},
				}),
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
		return { row, restoredId: restored?.id ?? null };
	});
	if (input.decision === "approved")
		await onQuoteSent(decided.row.id, decided.row.supersedesId);
	// Reminders stopped while the customer was changing it; the earlier quote is live again.
	else if (decided.restoredId) await onQuoteOpened(decided.restoredId);
	return decided.row;
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

const signedThanks: Record<Language, (n: string) => string> = {
	en: (n) =>
		`Got your signed quotation ${n}, thank you! 🙏 Our team will be in touch soon to arrange the next step.`,
	ms: (n) =>
		`Dah terima sebut harga ${n} yang ditandatangani, terima kasih! 🙏 Team kami akan contact tak lama lagi untuk langkah seterusnya.`,
	zh: (n) =>
		`收到您签好的报价单 ${n}，谢谢！🙏 我们的同事会尽快联系您安排下一步。`,
	mixed: (n) =>
		`Got your signed quotation ${n}, thank you! 🙏 Our team will be in touch soon to arrange the next step.`,
};

async function loadSignableQuote(quoteId: string) {
	const db = getDb();
	const quote = await db.query.quotes.findFirst({
		where: eq(schema.quotes.id, quoteId),
	});
	if (!quote) throw new Error("Quote not found");
	const request = await loadRequest(quote.requestId);
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
	await onQuoteOpened(quote.id);
	return row;
}

export async function signQuote(input: {
	quoteId: string;
	signerName: string;
	signatureImage: string;
}) {
	const signed = await getDb().transaction(async (db) => {
		const initial = await db.query.quotes.findFirst({
			where: eq(schema.quotes.id, input.quoteId),
		});
		if (!initial) throw new Error("Quote not found");
		const requestInfo = await db.query.quoteRequests.findFirst({
			where: eq(schema.quoteRequests.id, initial.requestId),
		});
		if (!requestInfo) throw new Error("Request not found");
		await db
			.select({ id: schema.conversations.id })
			.from(schema.conversations)
			.where(eq(schema.conversations.id, requestInfo.conversationId))
			.for("update");
		const [request] = await db
			.select()
			.from(schema.quoteRequests)
			.where(eq(schema.quoteRequests.id, initial.requestId))
			.for("update");
		const [quote] = await db
			.select()
			.from(schema.quotes)
			.where(eq(schema.quotes.id, input.quoteId))
			.for("update");
		if (quote.status === "accepted") return quote;
		if (quote.status === "superseded")
			throw new Error("This quotation was replaced by a newer version");
		if (quote.status === "lost")
			throw new Error(
				"This quotation is no longer open. Please message us for a new one.",
			);
		if (quote.status !== "approved")
			throw new Error("This quotation is not open for signing");
		if (quote.validUntil < new Date())
			throw new Error("This quotation has expired");
		const issue = quoteAgreementIssue(quote, {
			...request,
			status: request.status === "approved" ? "draft_ready" : request.status,
		});
		if (issue)
			throw new Error(
				"The requirements for this quotation need review. Please ask our team for an updated quotation.",
			);
		const latest = await db.query.messages.findFirst({
			where: and(
				eq(schema.messages.conversationId, request.conversationId),
				eq(schema.messages.sender, "customer"),
			),
			orderBy: desc(schema.messages.createdAt),
		});
		if (latest && latest.id !== request.processedMessageId)
			throw new Error(
				"Our team is reviewing your latest message. Please wait before signing.",
			);
		const baseline = await deliveryBaseline(db, quote);
		if (baseline) {
			const [prior] = await db
				.select()
				.from(schema.quotes)
				.where(eq(schema.quotes.id, baseline.quote.id))
				.for("update");
			if (prior.status !== "accepted")
				throw new Error(
					"A newer signed revision already replaced this agreement",
				);
			if (baseline.job) {
				const [job] = await db
					.select()
					.from(schema.jobs)
					.where(eq(schema.jobs.id, baseline.job.id))
					.for("update");
				if (
					job.kind !== "project" ||
					["completed", "closed", "cancelled"].includes(job.status)
				)
					throw new Error("This project requires a separate change review");
			}
			const ids = [...prior.lineItems, ...quote.lineItems].flatMap((l) =>
				l.productId ? [l.productId] : [],
			);
			if (
				ids.length &&
				(
					await db
						.select()
						.from(schema.products)
						.where(
							and(
								inArray(schema.products.id, ids),
								eq(schema.products.type, "stock"),
							),
						)
				).length
			)
				throw new Error("Signed inventory changes require a separate order");
			await db
				.update(schema.quotes)
				.set({ status: "superseded" })
				.where(eq(schema.quotes.id, prior.id));
		}
		await reserveStock(db, quote, request.id, input.signerName);

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
			body: signedThanks[request.brief.language](quote.number),
		});
		await onQuoteClosed(quote.id, db);
		await enqueueTask(db, "create_handover", quote.id);
		return row;
	});
	// A deposit or pay-upfront instalment is invoiced as soon as they sign.
	await issueInvoices(signed.id, { kind: "signed" }).catch((err) =>
		console.error("[billing] invoice on signing", err),
	);
	return signed;
}

/** A signed quote reserves its stock items so they are not promised twice. */
async function reserveStock(
	db: Database,
	quote: typeof schema.quotes.$inferSelect,
	requestId: string,
	signerName: string,
) {
	const qty = new Map<string, number>();
	const backorder = new Map<string, number>();
	for (const l of quote.lineItems) {
		if (!l.productId) continue;
		qty.set(l.productId, (qty.get(l.productId) ?? 0) + l.quantity);
		if (l.backorder)
			backorder.set(
				l.productId,
				(backorder.get(l.productId) ?? 0) + l.backorder,
			);
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
		)
		.orderBy(schema.products.id)
		.for("update");
	for (const p of items) {
		const n = qty.get(p.id) ?? 0;
		if (p.businessId !== quote.businessId || !Number.isInteger(n) || n <= 0)
			throw new Error("Stock items need a valid quantity from this business");
		// The quote said some units come after restock, so those are reserved ahead.
		const free = Math.max(p.stockOnHand - p.stockReserved, 0);
		const short = Math.max(n - free, 0);
		if (short > Math.min(backorder.get(p.id) ?? 0, n))
			throw new Error(
				`${p.name} no longer has enough stock. Ask our team to update the quotation.`,
			);
		await db
			.insert(schema.stockReservations)
			.values({ quoteId: quote.id, productId: p.id, quantity: n });
		await db
			.update(schema.products)
			.set({ stockReserved: sql`${schema.products.stockReserved} + ${n}` })
			.where(eq(schema.products.id, p.id));
		await emitOrbyteEvent(db, {
			businessId: quote.businessId,
			requestId,
			type: "stock.reserved",
			actor: signerName,
			summary: `Reserved ${n} ${p.unit} of ${p.name} (${p.sku}) for ${quote.number}${short ? ` (${short} on backorder, waiting for restock)` : ""}`,
			payload: { productId: p.id, quantity: n, backorder: short },
		});
	}
}
