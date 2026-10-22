/**
 * Synthetic evaluation (docs/EVALUATION.md). Plays scripted customer conversations
 * through the real workflow against the configured AI (live model, or replay with
 * AI_MODE=replay), then approves, signs, runs the handover worker and asks the team
 * AI about the job. Prints measured results as JSON.
 *
 * Run only against a disposable, seeded database (it creates chats, quotes, jobs
 * and reserves stock):  QUORA_EVAL_DB=1 DATABASE_URL=... pnpm eval
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { flagshipScenario } from "../src/data/demo-scenario";
import { getDb, schema } from "../src/db/index";
import { quoteReviewToken } from "../src/lib/agreements";
import { assess } from "../src/lib/intake";
import { aiModelName } from "../src/server/ai";
import { postJobMessage } from "../src/server/jobs";
import { runNextTask } from "../src/server/worker";
import {
	decideQuote,
	handleCustomerMessage,
	signQuote,
} from "../src/server/workflow";

if (process.env.QUORA_EVAL_DB !== "1")
	throw new Error(
		"Run the evaluation against a disposable seeded database: QUORA_EVAL_DB=1 DATABASE_URL=... pnpm eval",
	);

type Expected = {
	productId: string;
	quantity: number;
	answers: Record<string, string>; // question key → expected value (lowercase match)
	general: Record<string, string>;
	/** Things we agreed in the chat that the handover must carry. */
	commitments: string[];
};
type Scenario = {
	name: string;
	language: string;
	businessId: string;
	customer: string;
	steps: string[];
	expected: Expected;
};

/** "Next Friday": Friday of the following Monday-to-Sunday week (Malaysia time). */
function nextFriday() {
	const d = new Date(
		new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10),
	);
	const sinceMonday = (d.getUTCDay() + 6) % 7;
	d.setUTCDate(d.getUTCDate() - sinceMonday + 7 + 4);
	return d.toISOString().slice(0, 10);
}

const scenarios: Scenario[] = [
	{
		name: "Flagship: vague BM enquiry, quantity changed before approval",
		language: "ms",
		businessId: "kilat-print",
		customer: "Eval Kak Ros",
		steps: flagshipScenario.steps.map((s) => s.say),
		expected: {
			productId: "kp-flyer-a5",
			quantity: 2000,
			answers: { paper: "157gsm art paper", sides: "double" },
			general: { needed_by: nextFriday(), collection: "self pickup" },
			commitments: [nextFriday(), "self pickup"],
		},
	},
	{
		name: "Almost complete Manglish enquiry",
		language: "mixed",
		businessId: "kilat-print",
		customer: "Eval Encik Hafiz",
		steps: [
			"Hi boss, nak quote 500pcs flyer A5, 157gsm art paper, double sided. Need by next Friday.",
			"Self pickup",
			"Ok confirm",
		],
		expected: {
			productId: "kp-flyer-a5",
			quantity: 500,
			answers: { paper: "157gsm art paper", sides: "double" },
			general: { needed_by: nextFriday(), collection: "self pickup" },
			commitments: [nextFriday(), "self pickup"],
		},
	},
	{
		name: "Chinese name cards with missing details",
		language: "zh",
		businessId: "kilat-print",
		customer: "Eval 陈小姐",
		steps: [
			"你好，我要印名片，大概3盒，什么价钱？",
			"哑光，双面",
			"下个星期五要，我自己来拿",
			"对，没问题",
			// The AI may ask whether "大概3盒" (about 3 boxes) is final; this confirms.
			"对，就3盒，确认",
		],
		expected: {
			productId: "kp-namecard",
			quantity: 3,
			answers: { finish: "matte", sides: "double" },
			general: { needed_by: nextFriday(), collection: "self pickup" },
			commitments: [nextFriday(), "self pickup"],
		},
	},
];

const db = getDb();
const lower = (s: string) => s.toLowerCase();
const months = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
/** Does the text mention this value? Dates count in any common format. */
function mentions(text: string, value: string) {
	// "2,000" counts as 2000.
	const t = lower(text).replace(/(\d),(?=\d{3}\b)/g, "$1");
	const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!iso) return t.includes(lower(value));
	const m = Number(iso[2]);
	const day = Number(iso[3]);
	const mon = months[m - 1];
	return (
		t.includes(value) ||
		new RegExp(`\\b0?${day}\\s*(?:${mon}|/\\s*0?${m}\\b)`).test(t) ||
		new RegExp(`${mon}[a-z]*\\.?\\s+0?${day}\\b`).test(t) ||
		t.includes(`${m}月${day}`)
	);
}

async function runScenario(sc: Scenario) {
	const started = Date.now();
	const [chat] = await db
		.insert(schema.conversations)
		.values({ businessId: sc.businessId, customerName: sc.customer })
		.returning();
	const turnMs: number[] = [];
	let failedTurns = 0;
	for (const body of sc.steps) {
		const t = Date.now();
		try {
			for await (const step of handleCustomerMessage({
				conversationId: chat.id,
				body,
			}))
				if (step.step === "failed") failedTurns++;
		} catch {
			failedTurns++;
		}
		turnMs.push(Date.now() - t);
	}
	const request = await db.query.quoteRequests.findFirst({
		where: eq(schema.quoteRequests.conversationId, chat.id),
	});
	const business = await db.query.businesses.findFirst({
		where: eq(schema.businesses.id, sc.businessId),
	});
	const [products, questions, staff] = await Promise.all([
		db
			.select()
			.from(schema.products)
			.where(eq(schema.products.businessId, sc.businessId)),
		db
			.select()
			.from(schema.intakeQuestions)
			.where(eq(schema.intakeQuestions.businessId, sc.businessId)),
		db
			.select()
			.from(schema.staff)
			.where(eq(schema.staff.businessId, sc.businessId)),
	]);
	const result: Record<string, unknown> = {
		scenario: sc.name,
		language: sc.language,
		customerMessages: sc.steps.length,
		failedTurns,
		medianTurnSeconds:
			[...turnMs].sort((a, b) => a - b)[Math.floor(turnMs.length / 2)] / 1000,
		requestStatus: request?.status ?? null,
	};
	if (!request || !business) return { ...result, reachedDraft: false };

	// Requirement completeness and correctness at draft time.
	const a = assess(request.brief, products, questions);
	const item = request.brief.items.find(
		(i) => i.productId === sc.expected.productId,
	);
	const checks = [
		["product", Boolean(item)],
		["quantity", item?.quantity === sc.expected.quantity],
		...Object.entries(sc.expected.answers).map(([k, v]) => [
			k,
			Boolean(item?.answers[k]?.values.some((x) => lower(x) === lower(v))),
		]),
		...Object.entries(sc.expected.general).map(([k, v]) => [
			k,
			Boolean(request.brief.general[k]?.values.some((x) => mentions(x, v))),
		]),
	] as [string, boolean][];
	Object.assign(result, {
		requiredAnswered: `${a.requiredAnswered}/${a.requiredTotal}`,
		requirementAccuracy: `${checks.filter(([, ok]) => ok).length}/${checks.length}`,
		wrongOrMissing: checks.filter(([, ok]) => !ok).map(([k]) => k),
	});
	const quote = await db.query.quotes.findFirst({
		where: and(
			eq(schema.quotes.requestId, request.id),
			eq(schema.quotes.status, "draft"),
		),
	});
	const drafted = await db.query.activityEvents.findFirst({
		where: and(
			eq(schema.activityEvents.requestId, request.id),
			inArray(schema.activityEvents.type, [
				"quote.draft.prepared",
				"quote.request.flagged_for_review",
			]),
		),
		orderBy: asc(schema.activityEvents.createdAt),
	});
	Object.assign(result, {
		reachedDraft: Boolean(quote),
		flags: request.flags.map((f) => f.kind),
		secondsToFirstDraft: drafted
			? (drafted.createdAt.getTime() - started) / 1000
			: null,
	});
	if (!quote) return result;

	// The human steps, done by code here: approve, sign, run the handover worker.
	const approver = staff.find((s) => s.canApprove);
	if (!approver) return result;
	// The approval guards stay on: an outdated draft is reported, not forced through.
	try {
		await decideQuote({
			quoteId: quote.id,
			staffId: approver.id,
			decision: "approved",
			reviewToken: quoteReviewToken(quote),
		});
		await signQuote({
			quoteId: quote.id,
			signerName: sc.customer,
			signatureImage: "data:image/png;base64,ZXZhbA==",
		});
	} catch (err) {
		return {
			...result,
			approvalBlocked: err instanceof Error ? err.message : String(err),
		};
	}
	for (let i = 0; i < 4; i++) await runNextTask();
	const job = await db.query.jobs.findFirst({
		where: eq(schema.jobs.quoteId, quote.id),
	});
	if (!job?.handover) return { ...result, handover: false };

	// Handover accuracy: every agreed answer appears in the handover requirements.
	const handoverText = lower(
		JSON.stringify([
			job.handover.requirements,
			job.handover.scope,
			job.handover.timeline,
			job.handover.promises,
		]),
	);
	const agreed = [
		...Object.values(sc.expected.answers),
		...Object.values(sc.expected.general),
		String(sc.expected.quantity),
	];
	const inHandover = agreed.filter((v) => mentions(handoverText, v));
	const promises = lower(
		JSON.stringify([
			job.handover.promises,
			job.handover.timeline,
			job.handover.requirements,
		]),
	);
	const kept = sc.expected.commitments.filter((c) => mentions(promises, c));
	// The PIC asks the team AI; does the answer carry the agreed details?
	const pic = staff.find((s) => s.id === job.picId) ?? approver;
	const { reply } = await postJobMessage({
		jobId: job.id,
		staffId: pic.id,
		body: "@AI what exactly did the customer agree to, and by when?",
	});
	const answer = lower(reply?.body ?? "");
	const answered = agreed.filter((v) => mentions(answer, v));
	return {
		...result,
		handover: true,
		handoverAccuracy: `${inHandover.length}/${agreed.length}`,
		handoverMissing: agreed.filter((v) => !inHandover.includes(v)),
		commitmentsCaptured: `${kept.length}/${sc.expected.commitments.length}`,
		commitmentsMissed: sc.expected.commitments.filter((c) => !kept.includes(c)),
		teamAiRecall: `${answered.length}/${agreed.length}`,
		teamAiCitedSources: reply?.sources.map((s) => s.kind) ?? [],
	};
}

try {
	const results = [];
	// Replay only understands the flagship script; the others need a live model.
	const run =
		process.env.AI_MODE === "replay" ? scenarios.slice(0, 1) : scenarios;
	for (const sc of run)
		results.push(
			await runScenario(sc).catch((err) => ({
				scenario: sc.name,
				error: err instanceof Error ? err.message : String(err),
			})),
		);
	console.log(
		JSON.stringify(
			{ model: aiModelName(), ranAt: new Date().toISOString(), results },
			null,
			2,
		),
	);
} finally {
	await db.$client.end();
}
