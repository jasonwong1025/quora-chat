import OpenAI from "openai";
import { z } from "zod";
import type { Language } from "#/db/schema";

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
		baseURL: "https://openrouter.ai/api/v1",
		defaultHeaders: { "X-Title": "Quora Chat" },
	});
	return client;
}

// OpenRouter model ids are "provider/model". The model must support
// structured outputs (json_schema), which reading relies on.
const model = () => process.env.AI_MODEL || "openai/gpt-5-mini";
export const aiModelName = model;

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
	items: obj({ key: str, values: strList }),
} as const;

export type ChatTurn = {
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
			return `${who}:${file} ${m.body}`.trim();
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
	sentQuote: { number: string; lines: string[] } | null;
	history: ChatTurn[];
	latestHasAttachment: boolean;
};

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
			answers: z.array(
				z.object({ key: z.string(), values: z.array(z.string()) }),
			),
		}),
	),
	general: z.array(z.object({ key: z.string(), values: z.array(z.string()) })),
	followUpAnswers: z.array(z.object({ id: z.string(), answer: z.string() })),
	followUp: z.object({ aboutKey: z.string(), question: z.string() }).nullable(),
	confirmation: z.enum(["confirmed", "changed", "none"]),
	wantsChange: z.boolean(),
	customerQuestion: z.string().nullable(),
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
	reasoning: strList,
});

/** Reads the latest customer message into the requirement brief. */
export function readTurn(input: ReadInput): Promise<Reading> {
	const system = `You keep a requirement brief for "${input.businessName}" (${input.industry}, Malaysia) up to date while a customer chats with them on WhatsApp. Customers write in English, Bahasa Melayu, Chinese, or a mix (Manglish, code-switching).

Catalog: products and services, each with the questions we need answered (JSON):
${JSON.stringify(input.catalog)}

Business-wide questions, asked in every enquiry (JSON):
${JSON.stringify(input.generalQuestions)}

Current brief, what we already know (JSON; reuse each item's "ref"):
${JSON.stringify(input.brief)}

Open follow-up questions waiting for an answer (JSON): ${JSON.stringify(input.openFollowUps)}
Stage: ${input.stage}${input.stage === "confirming" ? " (we sent the customer a summary and asked them to confirm it)" : ""}
${input.sentQuote ? `A quotation was already sent to this customer: ${input.sentQuote.number}: ${input.sentQuote.lines.join("; ")}` : "No quotation has been sent yet."}
The latest customer message ${input.latestHasAttachment ? "HAS a file attached" : "has no attachment"}.

Rules:
- Read the whole conversation, but focus on what the latest customer message adds or changes. Later messages override earlier ones.
- items: return every item the customer still wants. Reuse the ref of existing items; use ref "" for new ones. Set removed=true on an existing item they no longer want.
- match="exact" only when exactly one catalog product clearly fits (set productId). "ambiguous" when several could fit (productId=null, list candidateProductIds). "none" when nothing fits.
- quantity: only a number the customer stated or clearly implied ("two units" = 2). Otherwise null. Never assume.
- answers: only keys from that product's questions. Only what the customer said or clearly implied, in any message. Map their words to the exact option text for single/multi/yes_no questions (e.g. "double side" → "double", "挂墙式" → "wall-mounted", "ya"/"boleh"/"可以" → "yes"). For number questions give the number or a short range in their words ("around 50"). For dates, the date or their words ("end of March"). For file questions, answer ["<attachment>"] only if the latest message has a file that fits. Never invent, assume or default an answer.
- general: answers to the business-wide questions, same rules.
- followUpAnswers: answers to the open follow-up questions, if the customer gave them.
- followUp: only if an answer the customer just gave to one of the questions above is too vague or contradictory to quote on (e.g. "a few users", clashing dates): aboutKey = that question's key (or "quantity"), question = ONE short question to clear it up. Otherwise null (this is the usual case). Never ask technical or implementation questions (APIs, databases, file formats, hosting setup): our team works those out. Never use it for something a preset question already covers, or to ask for files.
- confirmation: only at stage "confirming": "confirmed" if they agree the summary is right (ok / yes / betul / 对 / can / go ahead), "changed" if they correct or add anything. Otherwise "none".
- wantsChange: true only if a quotation was already sent and the customer asks to change it.
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
	history: ChatTurn[];
	firstReply: boolean;
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
		case "chat":
			return "There is nothing new to ask. Reply briefly and naturally to what they just said.";
	}
}

/** Writes the WhatsApp message to send. Code decides what to ask; the AI decides how to say it. */
export async function writeReply(input: ReplyInput): Promise<string> {
	const b = input.business;
	const info = [
		b.tagline && `About us: ${b.tagline}`,
		b.address && `Address: ${b.address}`,
		b.phone && `Phone: ${b.phone}`,
		b.openingHours && `Opening hours: ${b.openingHours}`,
	]
		.filter(Boolean)
		.join("\n");

	const system = `You are a staff member at "${b.name}" (${b.industry}, Malaysia), replying to a customer on WhatsApp. Write the way a friendly, experienced person at a small Malaysian business actually texts: warm, relaxed, short and clear. Not a bot, not a call centre.

How to write:
- Reply in ${languageName[input.language]}, matching the customer's register. If they write casual Manglish or rojak, you can be casual too (a light "ya", "can", "boleh", "ok noted" is fine; don't overdo "lah"). If they're formal, be polite. For Bahasa Melayu use everyday Malay, not stiff textbook Malay. For Chinese use natural simplified Chinese.
- ${input.firstReply ? `This is your first reply, so a short hello is fine${input.customerName ? ` (their name: ${input.customerName}; use it only if it looks like a real name)` : ""}.` : "Don't greet again; you're mid-conversation."}
- Briefly acknowledge what they just said when it helps (a few words, e.g. "Ok, 500 pcs noted"), then get to the point. Don't open every message with "Thank you" or "Great!".
- Ask only what you're told to ask, in one flowing message. Offer options the way people talk ("single or double sided?"), not like a form. If there are two questions, a tiny numbered list is ok.
- Usually 1-3 short sentences. Keep it under ~60 words, except a recap list.
- Avoid stiff phrases: "kindly", "please be informed", "we would like to", "Dear", "valued customer", "I hope this message finds you well", "Thank you for reaching out", "as an AI".
- At most one emoji, and only if the customer seems casual.
- Never mention or hint at prices, discounts, totals or estimates. Don't promise dates or availability.
- Plain text. *bold* only if really useful. No sign-off or signature, and don't add our address or phone unless they ask.

What you know about the business (use only this, never make things up):
${info || "(nothing extra)"}`;

	const extra = [
		input.customerQuestion &&
			`They also asked: "${input.customerQuestion}". Answer it first if the business info above covers it; otherwise say you'll check with the team.`,
		input.notOffered.length > 0 &&
			`They asked about something we don't list (${input.notOffered.join(", ")}). Say the team will check whether we can help with that.`,
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
