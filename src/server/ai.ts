import OpenAI from "openai";
import { z } from "zod";
import type { Language } from "#/db/schema";
import {
	type AvailabilityIssue,
	formatDay,
	stockPhrase,
} from "#/lib/availability";
import type { Passage } from "#/lib/knowledge";
import {
	isReplay,
	REPLAY_MODEL,
	replayCustomerQuestion,
	replayFollowUp,
	replayHandover,
	replayJobAnswer,
	replayReadTurn,
	replayReply,
} from "./ai-replay";

let client: OpenAI | undefined;

/** OpenRouter, via its OpenAI-compatible API. */
function getClient() {
	if (client) return client;
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		throw new Error("No AI credentials. Set OPENROUTER_API_KEY in .env.");
	}
	client = new OpenAI({
		apiKey,
		baseURL: process.env.AI_BASE_URL || "https://openrouter.ai/api/v1",
		defaultHeaders: { "X-Title": "Quora Chat" },
	});
	return client;
}

// OpenRouter model ids are "provider/model". The model must support
// structured outputs (json_schema), which reading relies on.
const model = () => process.env.AI_MODEL || "openai/gpt-5-mini";
/** What the AI thinking log records as the model; replay mode says so. */
export const aiModelName = () => (isReplay() ? REPLAY_MODEL : model());
export const aiMode = () => (isReplay() ? "replay" : "live");

/** One chat call that must return JSON matching `jsonSchema`, checked again with zod. */
// Reasoning models are slow at high effort; these tasks are narrow, so keep it low.
type Effort = "minimal" | "low" | "medium";

async function structured<T>(
	name: string,
	jsonSchema: Record<string, unknown>,
	parser: z.ZodType<T>,
	system: string,
	user: string,
	effort: Effort = "low",
): Promise<T> {
	const res = await getClient().chat.completions.create({
		model: model(),
		reasoning_effort: effort,
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		response_format: {
			type: "json_schema",
			json_schema: { name, strict: true, schema: jsonSchema },
		},
	});
	const raw = res.choices[0]?.message?.content;
	if (!raw) throw new Error("AI returned an empty response");
	return parser.parse(JSON.parse(raw));
}

// Hand-written JSON schemas satisfy OpenAI strict mode (every key required, no open objects).
const str = { type: "string" } as const;
const strOrNull = { type: ["string", "null"] } as const;
const strList = { type: "array", items: str } as const;
const obj = (properties: Record<string, unknown>) => ({
	type: "object",
	additionalProperties: false,
	required: Object.keys(properties),
	properties,
});
const answerList = {
	type: "array",
	items: obj({
		key: str,
		values: strList,
		state: { type: "string", enum: ["known", "ambiguous", "conflicting"] },
		evidenceMessageId: strOrNull,
	}),
} as const;

export type ChatTurn = {
	id?: string;
	sender: "customer" | "assistant" | "staff";
	body: string;
	attachment?: { name: string; mime: string } | null;
};

function transcript(history: ChatTurn[]) {
	return history
		.map((m) => {
			const who = m.sender === "customer" ? "CUSTOMER" : "US";
			const file = m.attachment
				? ` [sent a file: ${m.attachment.name} (${m.attachment.mime.startsWith("image/") ? "photo" : "document"})]`
				: "";
			return `${m.id ? `[${m.id}] ` : ""}${who}:${file} ${m.body}`.trim();
		})
		.join("\n");
}

// --- Reading a customer message ---------------------------------------------------

export type CatalogQuestion = {
	key: string;
	question: string;
	type: string;
	options: string[];
	onlyIf: string | null;
};

export type ReadInput = {
	businessName: string;
	industry: string;
	catalog: {
		id: string;
		sku: string;
		name: string;
		description: string;
		category: string;
		unit: string;
		pricing: "fixed" | "custom";
		/** false = switched off right now; still matched, code tells the customer. */
		available: boolean;
		questions: CatalogQuestion[];
	}[];
	generalQuestions: CatalogQuestion[];
	brief: {
		items: {
			ref: string;
			productId: string | null;
			match: string;
			rawText: string;
			quantity: number | null;
			answers: Record<string, string[]>;
		}[];
		general: Record<string, string[]>;
	};
	openFollowUps: { id: string; question: string }[];
	stage: "gathering" | "confirming";
	sentQuote: { number: string; lines: string[]; signed: boolean } | null;
	history: ChatTurn[];
	latestHasAttachment: boolean;
	today: string; // YYYY-MM-DD, Malaysia time
};

const readAnswerSchema = z.object({
	key: z.string(),
	values: z.array(z.string()),
	state: z.enum(["known", "ambiguous", "conflicting"]),
	evidenceMessageId: z.string().nullable(),
});
const readSchema = z.object({
	language: z.enum(["en", "ms", "zh", "mixed"]),
	summary: z.string(),
	items: z.array(
		z.object({
			ref: z.string(),
			productId: z.string().nullable(),
			match: z.enum(["exact", "ambiguous", "none"]),
			candidateProductIds: z.array(z.string()),
			rawText: z.string(),
			quantity: z.number().nullable(),
			removed: z.boolean(),
			reason: z.string(),
			answers: z.array(readAnswerSchema),
		}),
	),
	general: z.array(readAnswerSchema),
	followUpAnswers: z.array(z.object({ id: z.string(), answer: z.string() })),
	followUp: z.object({ aboutKey: z.string(), question: z.string() }).nullable(),
	confirmation: z.enum(["confirmed", "changed", "none"]),
	wantsChange: z.boolean(),
	customerQuestion: z.string().nullable(),
	quoteResponse: z.object({
		intent: z.enum([
			"none",
			"later",
			"price_concern",
			"not_interested",
			"question",
		]),
		resumeOn: z.string().nullable(),
		lostReason: z
			.enum(["price", "timing", "competitor", "not_needed", "other"])
			.nullable(),
		note: z.string().nullable(),
	}),
	reasoning: z.array(z.string()),
});

export type Reading = z.infer<typeof readSchema>;

const readJsonSchema = obj({
	language: { type: "string", enum: ["en", "ms", "zh", "mixed"] },
	summary: str,
	items: {
		type: "array",
		items: obj({
			ref: str,
			productId: strOrNull,
			match: { type: "string", enum: ["exact", "ambiguous", "none"] },
			candidateProductIds: strList,
			rawText: str,
			quantity: { type: ["number", "null"] },
			removed: { type: "boolean" },
			reason: str,
			answers: answerList,
		}),
	},
	general: answerList,
	followUpAnswers: { type: "array", items: obj({ id: str, answer: str }) },
	followUp: {
		anyOf: [obj({ aboutKey: str, question: str }), { type: "null" }],
	},
	confirmation: { type: "string", enum: ["confirmed", "changed", "none"] },
	wantsChange: { type: "boolean" },
	customerQuestion: strOrNull,
	quoteResponse: obj({
		intent: {
			type: "string",
			enum: ["none", "later", "price_concern", "not_interested", "question"],
		},
		resumeOn: strOrNull,
		lostReason: {
			type: ["string", "null"],
			enum: ["price", "timing", "competitor", "not_needed", "other", null],
		},
		note: strOrNull,
	}),
	reasoning: strList,
});

/** Reads the latest customer message into the requirement brief. */
export function readTurn(input: ReadInput): Promise<Reading> {
	if (isReplay()) return Promise.resolve().then(() => replayReadTurn(input));
	const system = `You keep a requirement brief for "${input.businessName}" (${input.industry}, Malaysia) up to date while a customer chats with them on WhatsApp. Customers write in English, Bahasa Melayu, Chinese, or a mix (Manglish, code-switching).

Catalog: products and services, each with the questions we need answered (JSON):
${JSON.stringify(input.catalog)}

Business-wide questions, asked in every enquiry (JSON):
${JSON.stringify(input.generalQuestions)}

Current brief, what we already know (JSON; reuse each item's "ref"):
${JSON.stringify(input.brief)}

Open follow-up questions waiting for an answer (JSON): ${JSON.stringify(input.openFollowUps)}
Stage: ${input.stage}${input.stage === "confirming" ? " (we sent the customer a summary and asked them to confirm it)" : ""}
${input.sentQuote ? `A quotation was already ${input.sentQuote.signed ? "SIGNED" : "sent"} by this customer: ${input.sentQuote.number}: ${input.sentQuote.lines.join("; ")}` : "No quotation has been sent yet."}
The latest customer message ${input.latestHasAttachment ? "HAS a file attached" : "has no attachment"}.

Rules:
- Read the whole conversation, but focus on what the latest customer message adds or changes. Later messages override earlier ones.
- items: return every item the customer still wants. Reuse the ref of existing items; use ref "" for new ones. Set removed=true on an existing item they no longer want. An item is something they want to buy; a question ("how much?", "berapa harga?", "什么价钱？") is never an item.
- match="exact" only when exactly one catalog product clearly fits (set productId). "ambiguous" when several could fit (productId=null, list candidateProductIds). "none" when nothing fits. Products with available=false still match normally (we'll tell the customer it's unavailable); don't treat them as "none".
- quantity: only a number the customer stated or clearly implied ("two units" = 2). Otherwise null. Never assume.
- answers: only keys from that product's questions. Only what the customer said or clearly implied, in any message. Map their words to the exact option text for single/multi/yes_no questions (e.g. "double side" → "double", "挂墙式" → "wall-mounted", "ya"/"boleh"/"可以" → "yes"). For number questions give the number or a short range in their words ("around 50"). For date questions, give the date as YYYY-MM-DD, working it out from today (${input.today}, Malaysia): "next Friday" / "Jumaat depan" / "下个星期五" = that weekday in the following Monday-to-Sunday week; "this Friday" = the coming one; "end of March" = the last day of March. Keep their words only when no specific date follows from them (e.g. "ASAP", "sometime in spring"). For file questions, answer ["<attachment>"] only if the latest message has a file that fits. Never invent, assume or default an answer.
- general: answers to the business-wide questions, same rules.
- For every answer, state="known" only when the customer's meaning is usable for that question. Use "ambiguous" for unresolved or vague answers and "conflicting" when statements conflict without a clear correction. A later explicit correction replaces an earlier answer; it is not a conflict. Never mark "not sure" as known. evidenceMessageId must be the bracketed ID of the CUSTOMER message that supplies that answer, or null if no evidence is available. Never cite our own messages as customer requirements.
- followUpAnswers: answers to the open follow-up questions, if the customer gave them.
- followUp: only if an answer the customer just gave to one of the questions above is too vague or contradictory to quote on (e.g. "a few users", clashing dates): aboutKey = that question's key (or "quantity"), question = ONE short question to clear it up. Otherwise null (this is the usual case). Never ask technical or implementation questions (APIs, databases, file formats, hosting setup): our team works those out. Never use it for something a preset question already covers, or to ask for files.
- confirmation: only at stage "confirming": "confirmed" if they agree the summary is right (ok / yes / betul / 对 / can / go ahead), including when they repeat a detail that already matches the summary ("Ya, 2000" when the summary says 2000). "changed" only if they correct or add something that differs from the summary. Otherwise "none".
- wantsChange: true only if a quotation was already sent or signed and the latest customer message requests changed requirements, scope, quantities or deadlines for that work. An answer clarifying an existing requirement or a question about agreed work is not a scope change. Never silently merge an additional deliverable into a signed agreement. A pure price concern or refusal is not a scope change; if the same message also changes deliverables, keep wantsChange=true.
- quoteResponse: only when a quotation was already sent and is waiting for their signature, how the latest message responds to it (otherwise intent "none"):
  - "later": they need more time / must ask their boss or partner. resumeOn = the date they'll be ready as YYYY-MM-DD (today is ${input.today}; "next week" = 7 days later, "end of month" = last day of the month), or null if they gave no time.
  - "price_concern": too expensive, asking for a discount or a better price.
  - "not_interested": they decided not to go ahead. lostReason = price / timing / competitor (went elsewhere) / not_needed / other.
  - "question": a question about the quotation or the work.
  - "none": anything else, including asking to change the quote (that's wantsChange).
  note = a few words on their reason, or null.
- customerQuestion: if they asked us something that is not a requirement (opening hours, location, turnaround…), the question in short English. Otherwise null.
- language: the language of the customer's messages ("mixed" if they mix).
- summary: one short English sentence describing the whole request.
- reasoning: 2-5 short English notes for our staff on how you read the latest message: what changed, how you mapped slang or other languages, anything you were unsure about.
- Never invent prices.`;

	return structured(
		"requirement_brief",
		readJsonSchema,
		readSchema,
		system,
		transcript(input.history),
	);
}

// --- Writing the reply ------------------------------------------------------------

const languageName: Record<Language, string> = {
	en: "English",
	ms: "Bahasa Melayu",
	zh: "Simplified Chinese",
	mixed: "the same mix of languages the customer uses",
};

export type Ask = {
	about: string | null; // product name, if the question is about one item
	question: string;
	type: string;
	options: string[];
	hint: string | null;
	repeat: boolean; // asked before and still unanswered
};

export type ReplyPlan =
	| { stage: "need"; offerings: string[] }
	| { stage: "identify"; rawText: string; options: string[] }
	| { stage: "gathering"; asks: Ask[] }
	| { stage: "confirming"; summary: string[]; isRevision: boolean }
	| { stage: "drafted"; customPriced: boolean; isRevision: boolean }
	| { stage: "relay_thanks" }
	| { stage: "note"; instruction: string }
	| { stage: "chat" };

export type ReplyInput = {
	business: {
		name: string;
		industry: string;
		tagline: string | null;
		phone: string | null;
		address: string | null;
		openingHours: string | null;
	};
	customerName: string;
	language: Language;
	plan: ReplyPlan;
	customerQuestion: string | null;
	notOffered: string[]; // things they asked for that we don't sell
	/** Stock or availability problems to tell them about now (facts from Products). */
	availability?: AvailabilityIssue[];
	history: ChatTurn[];
	firstReply: boolean;
	/** Public knowledge-base passages only; internal docs never reach the customer AI. */
	knowledge?: Passage[];
};

function planText(plan: ReplyPlan) {
	switch (plan.stage) {
		case "need":
			return `They haven't said what they need yet. Ask what they're looking for. You can mention a few things we do: ${plan.offerings.join(", ")}.`;
		case "identify":
			return `They mentioned "${plan.rawText}", which could be: ${plan.options.join(" / ")}. Ask which one they mean, casually.`;
		case "gathering":
			return `Ask about the following (rephrase naturally, don't copy word for word). We're still gathering details, so don't say you'll send a quote or check with the team yet; just ask.\n${plan.asks
				.map(
					(a, i) =>
						`${i + 1}. ${a.about ? `[${a.about}] ` : ""}${a.question}${
							a.options.length ? ` (options: ${a.options.join(" / ")})` : ""
						}${a.type === "file" ? " (they can send a photo or document here in the chat; it's optional, so make that clear)" : ""}${
							a.hint ? ` (note: ${a.hint})` : ""
						}${a.repeat ? " (we asked this before and they didn't answer: ask again briefly and differently, don't repeat the same words)" : ""}`,
				)
				.join("\n")}`;
		case "confirming":
			return `${plan.isRevision ? "They asked to change the quotation we sent. " : ""}We have everything we need. Recap what they want in a short list (keep their details exactly), then ask if it's all correct or if they want to change anything:\n${plan.summary.map((l) => `- ${l}`).join("\n")}`;
		case "drafted":
			return plan.customPriced
				? "They confirmed. Our team will go through the details and send the quotation, usually within 1 working day. Thank them briefly."
				: `They confirmed. Say we're preparing the ${plan.isRevision ? "updated " : ""}quotation and our team will send it here once checked, usually within the hour. Thank them briefly.`;
		case "note":
			return plan.instruction;
		case "relay_thanks":
			return "They just answered a question our team asked about their job. Thank them briefly and say you'll pass it to the team. Nothing else.";
		case "chat":
			return "There is nothing new to ask. Reply briefly and naturally to what they just said.";
	}
}

/** Facts only: the counts and date come from Products, and the AI must not add any. */
function availabilityText(i: AvailabilityIssue) {
	if (i.kind === "unavailable")
		return `Let them know up front, kindly and plainly, that ${i.name} isn't available at the moment, and that our team will check and get back to them on it. Don't ask anything about ${i.name}. Don't suggest other products.`;
	return `Right after your short hello or acknowledgement, and before any questions, tell them kindly and plainly: for ${i.name}, ${stockPhrase(i)}. Never say how many we have or how many are left; no stock numbers at all. ${
		i.restockDate
			? `More stock is expected on ${formatDay(i.restockDate)} (you may say this date, exactly as written).`
			: "We don't have a restock date yet: don't guess or hint at one."
	} Say they can wait for the restock, or our team will check and get back to them on it. Then carry on with the rest of the message.`;
}

/** Writes the WhatsApp message to send. Code decides what to ask; the AI decides how to say it. */
export async function writeReply(input: ReplyInput): Promise<string> {
	if (isReplay()) return replayReply(input);
	const b = input.business;
	const info = [
		b.tagline && `About us: ${b.tagline}`,
		b.address && `Address: ${b.address}`,
		b.phone && `Phone: ${b.phone}`,
		b.openingHours && `Opening hours: ${b.openingHours}`,
	]
		.filter(Boolean)
		.join("\n");
	const faq = (input.knowledge ?? [])
		.map((p) => `[${p.title}]\n${p.text}`)
		.join("\n\n");

	const system = `You are a staff member at "${b.name}" (${b.industry}, Malaysia), replying to a customer on WhatsApp. Write the way a friendly, experienced person at a small Malaysian business actually texts: warm, relaxed, short and clear. Not a bot, not a call centre.

How to write:
- Reply in ${languageName[input.language]}, matching the customer's register. If they write casual Manglish or rojak, you can be casual too (a light "ya", "can", "boleh", "ok noted" is fine; don't overdo "lah"). If they're formal, be polite. For Bahasa Melayu use everyday Malay, not stiff textbook Malay. For Chinese use natural simplified Chinese.
- ${input.firstReply ? `This is your first reply, so a short hello is fine${input.customerName ? ` (their name: ${input.customerName}; if you use it, write it exactly like that, never shortened)` : ""}.` : "Don't greet again; you're mid-conversation."}
- Briefly acknowledge what they just said when it helps (a few words, e.g. "Ok, 500 pcs noted"), then get to the point. Don't open every message with "Thank you" or "Great!".
- Ask only what you're told to ask, in one flowing message. Offer options the way people talk ("single or double sided?"), not like a form. If there are two questions, a tiny numbered list is ok.
- Usually 1-3 short sentences. Keep it under ~60 words, except a recap list.
- Avoid stiff phrases: "kindly", "please be informed", "we would like to", "Dear", "valued customer", "I hope this message finds you well", "Thank you for reaching out", "as an AI".
- At most one emoji, and only if the customer seems casual.
- Never mention or hint at prices, discounts, totals or estimates. Don't promise dates or availability, except the stock facts you're given below, stated exactly.
- Plain text. *bold* only if really useful. No sign-off or signature, and don't add our address or phone unless they ask.

What you know about the business (use only this, never make things up):
${info || "(nothing extra)"}${faq ? `\n\nThe business's published FAQ (you may use it to answer their question, in your own words; still never mention prices):\n${faq}` : ""}`;

	const extra = [
		input.customerQuestion &&
			`They also asked: "${input.customerQuestion}". Answer it first if the business info above covers it; otherwise say you'll check with the team.`,
		input.notOffered.length > 0 &&
			`They asked about something we don't list (${input.notOffered.join(", ")}). Say the team will check whether we can help with that.`,
		...(input.availability ?? []).map(availabilityText),
	]
		.filter(Boolean)
		.join("\n");

	const res = await getClient().chat.completions.create({
		model: model(),
		reasoning_effort: "minimal",
		messages: [
			{ role: "system", content: system },
			{
				role: "user",
				content: `Conversation so far:\n${transcript(input.history.slice(-12))}\n\nWhat to do now:\n${planText(input.plan)}${extra ? `\n${extra}` : ""}\n\nWrite only the message text.`,
			},
		],
	});
	return res.choices[0]?.message?.content?.trim() || "";
}

// --- Suggesting preset questions ------------------------------------------------------

const questionTypes = [
	"text",
	"number",
	"date",
	"single",
	"multi",
	"yes_no",
	"file",
] as const;

const suggestSchema = z.object({
	questions: z.array(
		z.object({
			key: z.string(),
			label: z.string(),
			type: z.enum(questionTypes),
			options: z.array(z.string()),
			required: z.boolean(),
			hint: z.string().nullable(),
			showIf: z.object({ key: z.string(), equals: z.string() }).nullable(),
		}),
	),
});

export type SuggestedQuestion = z.infer<
	typeof suggestSchema
>["questions"][number];

const suggestJsonSchema = obj({
	questions: {
		type: "array",
		items: obj({
			key: str,
			label: str,
			type: { type: "string", enum: questionTypes },
			options: strList,
			required: { type: "boolean" },
			hint: strOrNull,
			showIf: { anyOf: [obj({ key: str, equals: str }), { type: "null" }] },
		}),
	},
});

/** Proposes the questions a business should ask before quoting something. Staff edit and accept. */
export async function suggestQuestions(input: {
	businessName: string;
	industry: string;
	target:
		| {
				kind: "product";
				name: string;
				description: string;
				category: string;
				unit: string;
				pricing: "fixed" | "custom";
		  }
		| { kind: "category"; category: string; products: string[] }
		| { kind: "business"; products: string[] };
	existing: { key: string; label: string }[];
	ruleKeys: string[];
}) {
	if (isReplay())
		throw new Error(
			"Suggesting questions needs a live AI model; replay mode only covers the demo script.",
		);
	const t = input.target;
	const what =
		t.kind === "product"
			? `the product/service "${t.name}" (${t.description}; category ${t.category}; sold per ${t.unit}; ${t.pricing === "custom" ? "custom-priced: staff price it from these answers, so cover the scope well" : "fixed price list"})`
			: t.kind === "category"
				? `every product in the category "${t.category}" (${t.products.join(", ")}). Only questions that apply to all of them.`
				: `every enquiry, whatever they buy (products: ${t.products.join(", ")}). Only general things like company name, location or timeline; nothing product-specific.`;

	const result = await structured(
		"preset_questions",
		suggestJsonSchema,
		suggestSchema,
		`You help "${input.businessName}" (${input.industry}, Malaysia) decide what to ask customers on WhatsApp before preparing a quotation. Suggest the questions they need answered for ${what}

Rules:
- 3 to 8 questions, most important first. Only what is needed to quote accurately; skip nice-to-haves.
- Don't ask for quantity (handled separately). Don't ask about price or budget unless the work is custom-priced and budget really shapes the scope.
- label: the question as staff would write it, short plain English.
- key: short snake_case, unique (e.g. "paper_type", "user_count").
- type: "single"/"multi" with 2-6 options when answers fall into known choices; "yes_no" for yes/no; "number" for counts or sizes; "date" for deadlines; "file" when a photo or document really helps (floor plan, existing design, last year's accounts); otherwise "text".
- required: false only for things that help but aren't essential.
- hint: optional guidance for the assistant (e.g. "a rough range is fine"), else null.
- showIf: when a question only makes sense after another answer (e.g. ask "which system?" only if "has_existing_system" equals "yes"), that question's key and the exact option value. Else null.
- Don't repeat these existing questions: ${JSON.stringify(input.existing)}.
- These keys are used by pricing rules; if they aren't among the existing questions, include them with these exact keys: ${JSON.stringify(input.ruleKeys)}.`,
		"Suggest the questions.",
	);
	return result.questions;
}

// --- Handover to the PIC --------------------------------------------------------------

/** Everything the business knows about one signed job, as plain text for the AI. */
export type JobContext = {
	businessName: string;
	industry: string;
	customerName: string;
	clientName: string;
	jobKind: string;
	language: Language;
	brief: string[]; // "Item — question → answer" lines
	quote: string[]; // signed quotation lines
	files: { ref: string; name: string }[];
	/** The WhatsApp conversation; ref is a short id the AI can cite. */
	chat: { ref: string; who: string; at: string; body: string }[];
	catalog: string[]; // descriptions of the products involved
	/** Internal knowledge-base passages relevant to this job (SOPs, policies). */
	knowledge?: Passage[];
};

function contextText(c: JobContext) {
	return `Business: ${c.businessName} (${c.industry}, Malaysia)
Client: ${c.clientName} (contact: ${c.customerName}; customer writes in ${languageName[c.language]})
Job type: ${c.jobKind}

Requirement brief (confirmed by the customer before quoting):
${c.brief.map((l) => `- ${l}`).join("\n") || "(none)"}

Signed quotation:
${c.quote.map((l) => `- ${l}`).join("\n") || "(none)"}

Files the customer sent:
${c.files.map((f) => `- [${f.ref}] ${f.name}`).join("\n") || "(none)"}

Products involved:
${c.catalog.map((l) => `- ${l}`).join("\n") || "(none)"}
${c.knowledge?.length ? `\nOur internal procedures that apply (follow them when planning; never share them with the customer):\n${c.knowledge.map((k) => `- ${k.title}: ${k.text.replace(/\s+/g, " ")}`).join("\n")}\n` : ""}
WhatsApp conversation (each line has a reference id in brackets):
${c.chat.map((m) => `[${m.ref}] ${m.at} ${m.who}: ${m.body}`).join("\n")}`;
}

const handoverSchema = z.object({
	title: z.string(),
	summary: z.string(),
	scope: z.array(z.string()),
	requirements: z.array(z.object({ label: z.string(), value: z.string() })),
	promises: z.array(z.string()),
	timeline: z.string().nullable(),
	watchOuts: z.array(z.string()),
	customerNotes: z.string().nullable(),
	tasks: z.array(z.string()),
});

export type HandoverDraft = z.infer<typeof handoverSchema>;

/** Writes the PIC's briefing and a starting task list from the chat, brief and quote. */
export function writeHandover(c: JobContext): Promise<HandoverDraft> {
	if (isReplay()) return Promise.resolve(replayHandover(c));
	return structured(
		"handover",
		obj({
			title: str,
			summary: str,
			scope: strList,
			requirements: {
				type: "array",
				items: obj({ label: str, value: str }),
			},
			promises: strList,
			timeline: strOrNull,
			watchOuts: strList,
			customerNotes: strOrNull,
			tasks: strList,
		}),
		handoverSchema,
		`You brief the person in charge (PIC) who will deliver a job a customer just signed for. The PIC never talks to the customer and wasn't in the chat, so give them everything they need. Write in plain, specific English. Only use facts from the context; never invent details or prices.

Return:
- title: short job title, e.g. "Inventory & sales order system for Syarikat Contoh".
- summary: 2-4 sentences: who the customer is, what they bought, and what success looks like for them.
- scope: the deliverables, one per line.
- requirements: the key facts about the work itself that the PIC must follow (label → value), e.g. paper type, number of users, go-live date, site address. Never include the customer's name, quotation number, totals, validity, product codes or how they found us; those are shown elsewhere.
- promises: anything we told or agreed with the customer in the chat (timelines, what's included, what they will send). Empty if none.
- timeline: the deadline or timing in the customer's words, or null.
- watchOuts: risks, open points, vague answers, things to confirm. Empty if none.
- customerNotes: how to deal with them (language, tone, anything notable), or null.
- tasks: 3-8 concrete first tasks for the PIC, verb first (e.g. "Set up the staging environment"). The PIC must not contact the customer directly: anything that needs the customer becomes "Ask the customer (via sales): …". Stock on the quote is already reserved automatically when the customer signed, so don't add tasks to reserve or check stock.`,
		contextText(c),
	);
}

const botSchema = z.object({
	answer: z.string(),
	known: z.boolean(),
	sources: z.array(
		z.object({
			kind: z.enum([
				"chat",
				"brief",
				"quote",
				"handover",
				"file",
				"relay",
				"catalog",
				"knowledge",
			]),
			label: z.string(),
			ref: z.string().nullable(),
		}),
	),
	actions: z.array(
		z.object({
			kind: z.enum(["add_task", "flag_blocker", "ask_customer"]),
			text: z.string(),
			taskId: z.string().nullable(),
		}),
	),
});

export type BotReply = z.infer<typeof botSchema>;

/** The AI teammate in the job's team chat: answers from the job's context and suggests next steps. */
export function answerJobQuestion(input: {
	context: JobContext;
	handover: string;
	tasks: { id: string; title: string; status: string }[];
	relays: { question: string; answer: string | null; status: string }[];
	/** Recent team chat, oldest first. `who` is e.g. "Ravi Chandran (PIC)", "AI" or "SYSTEM". */
	history: { who: string; body: string }[];
	question: string;
	askerName: string;
	picName: string | null;
	team: string[];
	/** Company knowledge base passages (internal and public), refs k1, k2… */
	knowledge: (Passage & { ref: string })[];
}): Promise<BotReply> {
	if (isReplay()) return Promise.resolve(replayJobAnswer(input));
	return structured(
		"job_assistant",
		obj({
			answer: str,
			known: { type: "boolean" },
			sources: {
				type: "array",
				items: obj({
					kind: {
						type: "string",
						enum: [
							"chat",
							"brief",
							"quote",
							"handover",
							"file",
							"relay",
							"catalog",
							"knowledge",
						],
					},
					label: str,
					ref: strOrNull,
				}),
			},
			actions: {
				type: "array",
				items: obj({
					kind: {
						type: "string",
						enum: ["add_task", "flag_blocker", "ask_customer"],
					},
					text: str,
					taskId: strOrNull,
				}),
			},
		}),
		botSchema,
		`You are the AI teammate in the internal team group chat for this job. The team: ${input.team.join(", ") || "(nobody assigned yet)"}; the person in charge (PIC) is ${input.picName ?? "not assigned"}. ${input.askerName} just tagged you. The customer is not in this group, and the team can't contact the customer directly, so you are their source of truth about what the customer wants. Answer ${input.askerName} only from the context below. Be direct and brief (usually 1-4 sentences or a short list), like a helpful colleague who read the whole chat. Earlier team messages are there for context; teammates' messages are not facts about the customer.

Rules:
- If the context answers it, answer and set known=true. Quote exact details (numbers, names, dates) as given.
- If it doesn't, say clearly that the customer didn't say, set known=false, and suggest an ask_customer action with a clear question we could ask them.
- The company knowledge base (SOPs, policies, specs) is internal: use it for how we do things, but what the customer agreed always comes from the brief, quote and chat. If the two conflict, say so.
- sources: where you found it. kind "chat" with ref = the bracketed message id (e.g. "m12"), "file" with the file ref, "knowledge" with ref = the knowledge passage id (e.g. "k2"), or "brief" / "quote" / "handover" / "relay" / "catalog" with ref null. label = a few words on what it shows.
- actions: suggest only when genuinely useful, max 3. add_task (text = task title), flag_blocker (text = what's blocking; taskId = an existing task id if it applies, else null), ask_customer (text = the question for the customer, in plain English). Don't suggest a task that already exists.
- Never invent facts or prices.

${contextText(input.context)}

Handover pack:
${input.handover}

Tasks (id: title [status]):
${input.tasks.map((t) => `- ${t.id}: ${t.title} [${t.status}]`).join("\n") || "(none)"}

Questions already relayed to the customer:
${input.relays.map((r) => `- ${r.question} → ${r.answer ?? `(${r.status})`}`).join("\n") || "(none)"}

Company knowledge base (most relevant passages; internal):
${input.knowledge.map((k) => `[${k.ref}] ${k.title} (${k.category})\n${k.text}`).join("\n\n") || "(nothing relevant)"}`,
		`Team chat so far:\n${
			input.history
				.slice(-12)
				.map((h) => `${h.who}: ${h.body}`)
				.join("\n") || "(empty)"
		}\n\n${input.askerName} asks you: ${input.question}`,
		"low",
	);
}

/** Turns a PIC's internal question into a friendly WhatsApp message from the business. */
export async function draftCustomerQuestion(input: {
	businessName: string;
	customerName: string;
	language: Language;
	jobTitle: string;
	question: string;
	recentChat: ChatTurn[];
}): Promise<string> {
	if (isReplay()) return replayCustomerQuestion(input);
	const res = await getClient().chat.completions.create({
		model: model(),
		reasoning_effort: "minimal",
		messages: [
			{
				role: "system",
				content: `You write WhatsApp messages for "${input.businessName}" (Malaysia) to an existing customer whose job ("${input.jobTitle}") our team has started. Our team needs one detail. Write it in ${languageName[input.language]}, warm and short like a real staff member texting (1-3 sentences), with a brief reason ("so our team can get started on…"). No greeting if the chat is ongoing, no sign-off, no internal jargon or staff names, no prices. Plain text.`,
			},
			{
				role: "user",
				content: `Recent chat:\n${transcript(input.recentChat.slice(-6))}\n\nWhat our team wants to know: ${input.question}\n\nWrite only the message.`,
			},
		],
	});
	return res.choices[0]?.message?.content?.trim() || input.question;
}

/** Does the customer's reply answer the question we relayed? */
export function readRelayAnswer(input: {
	question: string;
	sentMessage: string;
	reply: string;
	hasAttachment: boolean;
}) {
	// Replay: any reply to a relayed question counts as its answer.
	if (isReplay())
		return Promise.resolve({
			answers: Boolean(input.reply.trim()),
			answer: input.reply.trim() || null,
			changesScope: false,
		});
	return structured(
		"relay_answer",
		obj({
			answers: { type: "boolean" },
			answer: strOrNull,
			changesScope: { type: "boolean" },
		}),
		z.object({
			answers: z.boolean(),
			answer: z.string().nullable(),
			changesScope: z.boolean(),
		}),
		`We asked a customer a question on WhatsApp on behalf of our team. Decide whether their reply answers it.
- answers: true if the reply gives the information asked (even partly, or "don't know"), false if it's about something else.
- answer: if answers=true, the answer as a short English note for our team (keep exact details; mention an attached file if there is one). Else null.
- changesScope: true if the reply also requests additional deliverables or a change to agreed scope, quantities or deadlines. This must go through the quotation change workflow rather than silently being treated as a clarification.`,
		`Our team's question: ${input.question}\nMessage we sent: ${input.sentMessage}\nCustomer's reply: ${input.reply}${input.hasAttachment ? " [with a file attached]" : ""}`,
		"minimal",
	);
}

// --- Following up unsigned quotes ------------------------------------------------------

/** Picks when to nudge a customer about an unsigned quote. Code enforces the limits. */
export function planFollowUpTiming(input: {
	businessName: string;
	hoursSinceSent: number;
	opened: boolean;
	hoursSinceOpened: number | null;
	remindersSent: number;
	maxReminders: number;
	hoursUntilExpiry: number;
	customerDeadline: string | null;
	recentChat: ChatTurn[];
	now: string;
}) {
	if (isReplay())
		return Promise.resolve({
			waitHours: input.opened ? 24 : 48,
			reason:
				"Replay mode: standard timing (a day after opening, else two days).",
		});
	return structured(
		"follow_up_timing",
		obj({ waitHours: { type: "number" }, reason: str }),
		z.object({ waitHours: z.number(), reason: z.string() }),
		`You decide when "${input.businessName}" (Malaysia) should next follow up on a quotation the customer hasn't signed. Be considerate: not pushy, not forgotten. Consider whether they opened it, how long ago, how engaged the chat was, their own deadline, and how long until the quote expires. Typical: first nudge 1-2 days after sending; sooner if they opened it and went quiet; nearer the expiry for the last one.
Return waitHours (from now) and a one-sentence reason in plain English for the staff.`,
		`Now: ${input.now}
Sent ${Math.round(input.hoursSinceSent)} hours ago. ${input.opened ? `Customer opened it ${Math.round(input.hoursSinceOpened ?? 0)} hours ago.` : "Customer hasn't opened it yet."}
Reminders sent so far: ${input.remindersSent} of max ${input.maxReminders}.
Expires in ${Math.round(input.hoursUntilExpiry)} hours.
Customer's own deadline: ${input.customerDeadline ?? "not stated"}.
Recent chat:
${transcript(input.recentChat.slice(-6))}`,
		"low",
	);
}

/** A short, human follow-up about an unsigned quote. Never discounts or pressure. */
export async function writeFollowUp(input: {
	businessName: string;
	customerName: string;
	language: Language;
	quoteNumber: string;
	what: string; // e.g. "500 A5 flyers"
	opened: boolean;
	reminderNumber: number;
	final: boolean;
	extendedUntil: string | null; // set when we just extended validity
	recentChat: ChatTurn[];
}) {
	if (isReplay()) return replayFollowUp(input);
	const situation = input.extendedUntil
		? `The quotation's validity just ran out, so we've kindly extended it once, until ${input.extendedUntil}. Let them know, no pressure, and that they can still review and sign it from the quotation above.`
		: input.final
			? "This is the last reminder before the quotation expires. Mention it's valid for a little longer and offer help if anything is holding them back."
			: input.opened
				? "They opened the quotation but haven't signed. Gently check in: any questions or anything they'd like to adjust?"
				: "They haven't opened the quotation yet. Gently remind them it's waiting in the chat for them to review and sign.";
	const res = await getClient().chat.completions.create({
		model: model(),
		reasoning_effort: "minimal",
		messages: [
			{
				role: "system",
				content: `You write a WhatsApp follow-up for "${input.businessName}" (Malaysia) about quotation ${input.quoteNumber} (${input.what}) that the customer hasn't signed yet. Write in ${languageName[input.language]}, like a friendly staff member: 1-3 short sentences, warm, no pressure. Never offer discounts, new prices or terms, never invent deadlines or scarcity, never say you're an AI. No sign-off. If you use their name (${input.customerName}), write it exactly. Plain text.`,
			},
			{
				role: "user",
				content: `Recent chat:\n${transcript(input.recentChat.slice(-6))}\n\nThis is follow-up #${input.reminderNumber}. ${situation}\n\nWrite only the message.`,
			},
		],
	});
	return res.choices[0]?.message?.content?.trim() || "";
}
