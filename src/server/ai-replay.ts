/**
 * Replay mode (AI_MODE=replay): a predictable stand-in for the model, for live
 * demos. Clearly labelled in both interfaces. Only the AI's *language* work is
 * replaced:
 *
 * - Reading customer messages is scripted for the flagship scenario lines only.
 *   Anything off-script fails like a model outage, so the request is handed to
 *   staff instead of being guessed.
 * - Replies, handovers and team answers are written from templates using the same
 *   inputs the model would get (the plan code chose, the signed brief, the
 *   knowledge passages), so they stay grounded in real data.
 *
 * Pricing, requirement checks, approvals, signing, jobs and permissions run
 * exactly as in live mode.
 */
import { flagshipScenario, scriptKey } from "#/data/demo-scenario";
import type { Language } from "#/db/schema";
import { type AvailabilityIssue, formatDay } from "#/lib/availability";
import type { Passage } from "#/lib/knowledge";
import { searchKnowledge } from "#/lib/knowledge";
import type {
	BotReply,
	ChatTurn,
	HandoverDraft,
	JobContext,
	ReadInput,
	Reading,
	ReplyInput,
} from "./ai";

export const REPLAY_MODEL = "replay (scripted demo)";
export const isReplay = () => process.env.AI_MODE === "replay";

class OffScript extends Error {
	constructor() {
		super(
			"Replay mode only understands the demo script. A person needs to handle this message (or run with a live AI model).",
		);
	}
}

// --- Reading the scripted customer messages ------------------------------------------------

/**
 * "Jumaat depan" (next Friday): Friday of the following Monday-to-Sunday week,
 * the same rule the live model is given.
 */
function nextFriday(today: string) {
	const d = new Date(`${today}T00:00:00Z`);
	const sinceMonday = (d.getUTCDay() + 6) % 7;
	d.setUTCDate(d.getUTCDate() - sinceMonday + 7 + 4);
	return d.toISOString().slice(0, 10);
}

function reading(
	input: ReadInput,
	r: Partial<Reading> & Pick<Reading, "summary" | "items" | "reasoning">,
): Reading {
	return {
		language: "ms",
		general: [],
		followUpAnswers: [],
		followUp: null,
		confirmation: "none",
		wantsChange: false,
		customerQuestion: null,
		quoteResponse: {
			intent: "none",
			resumeOn: null,
			lostReason: null,
			note: null,
		},
		...r,
		...(input.stage !== "confirming" && r.confirmation
			? { confirmation: "none" }
			: {}),
	};
}

export function replayReadTurn(input: ReadInput): Reading {
	const latest = [...input.history]
		.reverse()
		.find((m) => m.sender === "customer");
	const step = flagshipScenario.steps.findIndex(
		(s) => scriptKey(s.say) === scriptKey(latest?.body ?? ""),
	);
	if (step < 0 || input.businessName !== "Kilat Print Studio")
		throw new OffScript();
	const evidence = latest?.id ?? null;
	const ref = input.brief.items[0]?.ref ?? "";
	const known = (key: string, values: string[]) => ({
		key,
		values,
		state: "known" as const,
		evidenceMessageId: evidence,
	});
	// Answers given so far stay in every reading, as a model would return them.
	const flyer = (quantity: number, answers: ReturnType<typeof known>[]) => ({
		ref,
		productId: "kp-flyer-a5",
		match: "exact" as const,
		candidateProductIds: [],
		rawText: "flyer A5",
		quantity,
		removed: false,
		reason: "Customer chose A5 flyers",
		answers,
	});
	const paper = [
		known("paper", ["157gsm art paper"]),
		known("sides", ["double"]),
	];
	const general = [
		known("needed_by", [nextFriday(input.today)]),
		known("collection", ["self pickup"]),
	];
	switch (step) {
		case 0:
			return reading(input, {
				summary: "Flyers for a cake shop; size and quantity not given yet",
				items: [
					{
						ref: "",
						productId: null,
						match: "ambiguous",
						candidateProductIds: ["kp-flyer-a5", "kp-flyer-a4"],
						rawText: "flyer",
						quantity: null,
						removed: false,
						reason: "Flyer, but A5 or A4 wasn't said",
						answers: [],
					},
				],
				reasoning: [
					"Customer wants flyers for her cake shop (Bahasa Melayu).",
					"Size not given: A5 and A4 both fit.",
					"Asked about price: never answered by the AI; pricing comes from the quotation.",
				],
			});
		case 1:
			return reading(input, {
				summary: "1000 A5 flyers for a cake shop",
				items: [flyer(1000, [])],
				customerQuestion: "What file format should the artwork be sent in?",
				reasoning: [
					"'A5' picks Flyer A5; '1000 keping' = 1000 pcs.",
					"Has a Canva design and asks which file to send: answered from the public FAQ.",
				],
			});
		case 2:
			return reading(input, {
				summary: "1000 A5 flyers, 157gsm, double sided",
				items: [flyer(1000, paper)],
				reasoning: [
					"'157gsm' maps to 157gsm art paper.",
					"'dua belah' (both sides) maps to double sided.",
				],
			});
		case 3:
			return reading(input, {
				summary:
					"1000 A5 flyers, 157gsm, double sided, self pickup next Friday",
				items: [flyer(1000, paper)],
				general,
				reasoning: [
					`'Jumaat depan' = next Friday, ${nextFriday(input.today)}.`,
					"'ambil sendiri' = self pickup, so no delivery address needed.",
				],
			});
		case 4:
		case 6:
			return reading(input, {
				summary: `${step === 6 ? 2000 : 1000} A5 flyers, 157gsm, double sided, self pickup next Friday`,
				items: [flyer(step === 6 ? 2000 : 1000, paper)],
				general,
				confirmation: "confirmed",
				reasoning: ["Customer confirmed the summary."],
			});
		default:
			return reading(input, {
				summary:
					"2000 A5 flyers, 157gsm, double sided, self pickup next Friday",
				items: [flyer(2000, paper)],
				general,
				confirmation: "changed",
				reasoning: [
					"Quantity changed from 1000 to 2000 ('2000 keping, bukan 1000').",
					"Other details unchanged.",
				],
			});
	}
}

// --- Replies, written from the plan code chose ----------------------------------------------

type Phrases = {
	need: (offer: string) => string;
	which: (raw: string, options: string) => string;
	ask: string;
	recap: string;
	confirm: string;
	drafted: string;
	custom: string;
	noted: string;
	relayThanks: string;
	faq: string;
	checkWithTeam: string;
	or: string;
};

const phrases: Record<"ms" | "en" | "zh", Phrases> = {
	ms: {
		need: (o) => `Hi! Boleh, kami buat ${o}. Nak buat apa ya?`,
		which: (r, o) => `Untuk ${r}, nak ${o}?`,
		ask: "Ok noted. Boleh share:",
		recap: "Ringkasan:",
		confirm: "Semua betul?",
		drafted:
			"Terima kasih! Kami sediakan sebut harga, team kami akan hantar di sini lepas semak.",
		custom:
			"Terima kasih! Team kami akan semak butiran dan hantar sebut harga, biasanya dalam 1 hari bekerja.",
		noted: "Baik, noted 👍",
		relayThanks: "Terima kasih, saya sampaikan pada team ya.",
		faq: "Untuk soalan tu:",
		checkWithTeam: "Soalan tu saya semak dengan team dulu ya.",
		or: " atau ",
	},
	en: {
		need: (o) => `Hi! Sure, we do ${o}. What are you looking for?`,
		which: (r, o) => `For the ${r}, would you like ${o}?`,
		ask: "Ok noted. Could you share:",
		recap: "Here's the summary:",
		confirm: "Is everything correct?",
		drafted:
			"Thanks! We're preparing the quotation; our team will send it here once checked.",
		custom:
			"Thanks! Our team will go through the details and send the quotation, usually within 1 working day.",
		noted: "Ok, noted 👍",
		relayThanks: "Thank you, I'll pass it to the team.",
		faq: "About your question:",
		checkWithTeam: "I'll check that with the team.",
		or: " or ",
	},
	zh: {
		need: (o) => `您好！我们做${o}。请问需要什么呢？`,
		which: (r, o) => `${r}要${o}？`,
		ask: "好的收到。请告诉我们：",
		recap: "总结一下：",
		confirm: "以上都对吗？",
		drafted: "谢谢！我们正在准备报价单，同事核对后会在这里发给您。",
		custom: "谢谢！我们的团队会查看细节并发报价单，一般在1个工作日内。",
		noted: "好的，收到 👍",
		relayThanks: "谢谢，我会转告团队。",
		faq: "关于您的问题：",
		checkWithTeam: "这个我先跟团队确认一下。",
		or: "还是",
	},
};

const phrasesFor = (l: Language) => phrases[l === "mixed" ? "en" : l];

/** The first sentence or two of the best FAQ passage. */
function faqAnswer(knowledge: Passage[] | undefined) {
	const top = knowledge?.[0];
	if (!top) return null;
	const sentences =
		top.text.replace(/\s+/g, " ").match(/[^.!?。！？]+[.!?。！？]?/g) ?? [];
	return sentences.slice(0, 2).join(" ").trim();
}

/** "2026-10-30" → "Fri, 30 Oct 2026" */
const day = (s: string) =>
	s.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) =>
		new Date(`${iso}T00:00:00+08:00`).toLocaleDateString("en-MY", {
			timeZone: "Asia/Kuala_Lumpur",
			weekday: "short",
			day: "numeric",
			month: "short",
			year: "numeric",
		}),
	);

/**
 * A recap line as a person would write it. Code gives "Flyer A5 × 1000 pc: Which
 * paper? → 157gsm art paper; Single or double sided? → double"; a live model
 * rephrases that, so replay tidies it the same way.
 */
function tidy(line: string) {
	const [head, ...rest] = line.split(": ");
	const details = rest.join(": ");
	if (details.includes(" → "))
		return day(
			`${head}: ${details
				.split("; ")
				.map((d) => d.split(" → ")[1] ?? d)
				.join(", ")}`,
		);
	const [q, a] = line.split(" → ");
	return a === undefined ? day(line) : day(`${q.replace(/\?$/, "")}: ${a}`);
}

export function replayReply(input: ReplyInput): string {
	const p = phrasesFor(input.language);
	const plan = input.plan;
	let body: string;
	switch (plan.stage) {
		case "need":
			body = p.need(plan.offerings.join(", "));
			break;
		case "identify":
			body = p.which(plan.rawText, plan.options.join(p.or));
			break;
		case "gathering":
			body = `${p.ask}\n${plan.asks
				.map(
					(a, i) =>
						`${i + 1}) ${a.question}${a.options.length ? ` (${a.options.join(" / ")})` : ""}`,
				)
				.join("\n")}`;
			break;
		case "confirming":
			body = `${p.recap}\n${plan.summary.map((l) => `- ${tidy(l)}`).join("\n")}\n${p.confirm}`;
			break;
		case "drafted":
			body = plan.customPriced ? p.custom : p.drafted;
			break;
		case "relay_thanks":
			body = p.relayThanks;
			break;
		default:
			body = p.noted;
	}
	if (input.customerQuestion) {
		const faq = faqAnswer(input.knowledge);
		body = `${faq ? `${p.faq} ${faq}` : p.checkWithTeam}\n\n${body}`;
	}
	const stock = (input.availability ?? []).map((i) =>
		availabilityLine(i, input.language),
	);
	if (stock.length) body = `${stock.join("\n")}\n\n${body}`;
	return body;
}

/** The same facts the live model gets, in a fixed sentence. */
function availabilityLine(i: AvailabilityIssue, language: Language) {
	const date =
		i.kind === "short" && i.restockDate ? formatDay(i.restockDate) : null;
	if (language === "ms") {
		if (i.kind === "unavailable")
			return `Maaf, ${i.name} tak ada buat masa ini. Team kami akan semak dan maklumkan semula ya.`;
		return `Untuk ${i.name}, ${i.available > 0 ? "stok sekarang tak cukup untuk kuantiti penuh" : "stok sekarang dah habis"}. ${
			date
				? `Stok baru dijangka sampai ${date}.`
				: "Tarikh stok baru belum pasti."
		} Boleh tunggu stok baru, atau team kami akan semak dan maklumkan semula.`;
	}
	if (language === "zh") {
		if (i.kind === "unavailable")
			return `不好意思，${i.name}目前暂时没有。我们的团队会确认后再回复您。`;
		return `${i.name}目前${i.available > 0 ? "库存不够您需要的数量" : "暂时缺货"}。${
			date ? `新货预计${date}到。` : "新货日期还未确定。"
		}您可以等新货，或者我们的团队确认后再回复您。`;
	}
	if (i.kind === "unavailable")
		return `Sorry, ${i.name} isn't available at the moment. Our team will check and get back to you on it.`;
	return `For ${i.name}, ${i.available > 0 ? "we don't have enough in stock for the full quantity right now" : "it's out of stock right now"}. ${
		date
			? `More stock is expected on ${date}.`
			: "We don't have a restock date yet."
	} You can wait for the restock, or our team will check and get back to you.`;
}

export function replayCustomerQuestion(input: {
	language: Language;
	question: string;
}) {
	return input.language === "ms"
		? `Hi, team kami nak tanya sikit supaya boleh mula: ${input.question}`
		: input.language === "zh"
			? `您好，为了开始制作，我们的团队想确认一下：${input.question}`
			: `Hi, our team has a quick question so we can get started: ${input.question}`;
}

export function replayFollowUp(input: {
	language: Language;
	quoteNumber: string;
	extendedUntil: string | null;
}) {
	if (input.extendedUntil)
		return input.language === "ms"
			? `Hi, sebut harga ${input.quoteNumber} kami lanjutkan sehingga ${input.extendedUntil}. Ada soalan, beritahu je ya.`
			: `Hi, we've extended quotation ${input.quoteNumber} until ${input.extendedUntil}. Any questions, just let us know.`;
	return input.language === "ms"
		? `Hi, sekadar mengingatkan sebut harga ${input.quoteNumber} masih menunggu semakan anda. Ada soalan, beritahu je ya.`
		: `Hi, just checking in on quotation ${input.quoteNumber}. Any questions, just let us know here.`;
}

// --- Handover and the team AI, written from the job's own records -------------------------------

/** "Flyer A5: When do you need it by? → 2026-10-30" → label/value. */
function briefFacts(c: JobContext) {
	return c.brief.map((line) => {
		const [left, value] = line.split(" → ");
		if (value === undefined) return { label: "Item", value: line };
		const label = (
			left.includes(": ") ? left.split(": ").slice(1).join(": ") : left
		).replace(/\?$/, "");
		return { label, value: day(value) };
	});
}

const deadlineOf = (c: JobContext) =>
	briefFacts(c).find((f) => /need it by|deadline|when/i.test(f.label))?.value ??
	null;

export function replayHandover(c: JobContext): HandoverDraft {
	const facts = briefFacts(c);
	const items = facts.filter((f) => f.label === "Item").map((f) => f.value);
	const deadline = deadlineOf(c);
	const collection = facts.find((f) => /pickup|delivery/i.test(f.label))?.value;
	const scope = c.quote
		.filter((l) => !l.startsWith("Total"))
		.map((l) => l.replace(/ @ .*$/, ""));
	return {
		title: `${items[0] ?? c.jobKind} for ${c.clientName}`,
		summary: `${c.clientName} signed for ${scope.join("; ") || items.join("; ")}.${deadline ? ` They need it by ${deadline}.` : ""}`,
		scope,
		requirements: facts.filter((f) => f.label !== "Item"),
		promises: [
			...(deadline
				? [`Ready by ${deadline}${collection ? ` (${collection})` : ""}`]
				: []),
		],
		timeline: deadline,
		watchOuts: [
			...(c.files.length
				? []
				: [
						"No artwork or files received in the chat yet: ask the customer through sales.",
					]),
			...(c.knowledge ?? []).map((k) => `Follow "${k.title}"`),
		],
		customerNotes: `Writes in ${c.language === "ms" ? "Bahasa Melayu" : c.language === "zh" ? "Chinese" : "English"}; keep messages short.`,
		tasks: [
			"Review the signed requirements and quotation",
			...(c.files.length
				? []
				: ["Ask the customer (via sales): send the artwork file"]),
			...(c.knowledge ?? []).slice(0, 2).map((k) => `Follow ${k.title}`),
			...(deadline ? [`Confirm the schedule to be ready by ${deadline}`] : []),
			"Deliver and hand over to the customer",
		].map((title) => ({ title, phase: null })),
	};
}

/** Answers from the signed brief, the chat and the knowledge base; says so when none cover it. */
export function replayJobAnswer(input: {
	context: JobContext;
	question: string;
	knowledge: (Passage & { ref: string })[];
}): BotReply {
	const c = input.context;
	const facts = briefFacts(c);
	// Rank the agreement's facts and the chat by the question's words.
	const agreed = searchKnowledge(
		facts.map((f, i) => ({
			id: `b${i}`,
			title: f.label,
			category: "brief",
			body: `${f.label}: ${f.value}`,
		})),
		input.question,
		6,
	);
	const chat = searchKnowledge(
		c.chat
			.filter((m) => m.who === "CUSTOMER")
			.map((m) => ({ id: m.ref, title: "", category: "chat", body: m.body })),
		input.question,
		1,
	);
	// Passages were found with the job title too; keep one only if it fits the question itself.
	const [kbHit] = searchKnowledge(
		input.knowledge.map((k) => ({
			id: k.ref,
			title: k.title,
			category: k.category,
			body: k.text,
		})),
		input.question,
		1,
	);
	const general =
		/what|agree|setuju|want|need|requirement|scope|summary|deadline|bila/i.test(
			input.question,
		);
	// "What did they agree to?" is answered from the agreement alone.
	const kb = general
		? undefined
		: input.knowledge.find((k) => k.ref === kbHit?.docId);
	const factLine = (f: { label: string; value: string }) =>
		f.label === "Item" ? f.value : `${f.label}: ${f.value}`;
	const lines = (
		general
			? facts.map(factLine)
			: agreed.map((a) => factLine(facts[Number(a.docId.slice(1))]))
	).slice(0, 8);
	if (!lines.length && !kb && !chat.length)
		return {
			answer:
				"The signed agreement, the customer chat and the knowledge base don't cover that. I can draft a question for sales to send the customer.",
			known: false,
			sources: [],
			actions: [{ kind: "ask_customer", text: input.question, taskId: null }],
		};
	const answer = [
		lines.length
			? `From the signed agreement:\n${lines.map((l) => `- ${l}`).join("\n")}`
			: "",
		kb
			? `Our ${kb.category === "FAQ" ? "FAQ" : "procedure"} "${kb.title}" says: ${kb.text.split("\n")[0]}`
			: "",
	]
		.filter(Boolean)
		.join("\n\n");
	return {
		answer,
		known: true,
		sources: [
			...(lines.length
				? [{ kind: "brief" as const, label: "Signed requirements", ref: null }]
				: []),
			...chat.map((m) => ({
				kind: "chat" as const,
				label: "Customer's message",
				ref: m.docId,
			})),
			...(kb
				? [{ kind: "knowledge" as const, label: kb.title, ref: kb.ref }]
				: []),
		],
		actions: [],
	};
}

export type { ChatTurn };
