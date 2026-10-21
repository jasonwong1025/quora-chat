import OpenAI from "openai";
import { z } from "zod";
import type { ExtractedRequest, Flag } from "#/db/schema";
import type { CatalogProduct, Outcome } from "./pricing";

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
// structured outputs (json_schema), which extraction relies on.
const model = () => process.env.AI_MODEL || "openai/gpt-5-mini";
export const aiModelName = model;

// --- Extraction -------------------------------------------------------------

const extractionSchema = z.object({
	language: z.enum(["en", "ms", "zh", "mixed"]),
	summary: z.string(),
	location: z.string().nullable(),
	neededBy: z.string().nullable(),
	items: z.array(
		z.object({
			match: z.enum(["exact", "ambiguous", "none"]),
			productId: z.string().nullable(),
			candidateProductIds: z.array(z.string()),
			rawText: z.string(),
			quantity: z.number().nullable(),
			fields: z.array(z.object({ key: z.string(), value: z.string() })),
			reason: z.string(),
		}),
	),
	reasoning: z.array(z.string()),
});

// Hand-written so it satisfies OpenAI strict mode (no open-ended objects).
const extractionJsonSchema = {
	type: "object",
	additionalProperties: false,
	required: [
		"language",
		"summary",
		"location",
		"neededBy",
		"items",
		"reasoning",
	],
	properties: {
		language: { type: "string", enum: ["en", "ms", "zh", "mixed"] },
		summary: { type: "string" },
		location: { type: ["string", "null"] },
		neededBy: { type: ["string", "null"] },
		items: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"match",
					"productId",
					"candidateProductIds",
					"rawText",
					"quantity",
					"fields",
					"reason",
				],
				properties: {
					match: { type: "string", enum: ["exact", "ambiguous", "none"] },
					productId: { type: ["string", "null"] },
					candidateProductIds: { type: "array", items: { type: "string" } },
					rawText: { type: "string" },
					quantity: { type: ["number", "null"] },
					fields: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							required: ["key", "value"],
							properties: {
								key: { type: "string" },
								value: { type: "string" },
							},
						},
					},
					reason: { type: "string" },
				},
			},
		},
		reasoning: { type: "array", items: { type: "string" } },
	},
} as const;

export type ChatTurn = {
	sender: "customer" | "assistant" | "staff";
	body: string;
};

export async function extractRequest(input: {
	businessName: string;
	industry: string;
	products: (CatalogProduct & { description: string; sku: string })[];
	history: ChatTurn[];
}): Promise<ExtractedRequest> {
	const catalog = input.products.map((p) => ({
		id: p.id,
		sku: p.sku,
		name: p.name,
		description: p.description,
		unit: p.unit,
		requiredFields: p.requiredFields,
	}));

	const system = `You turn customer chat messages into a structured quotation request for "${input.businessName}" (${input.industry}, Malaysia).
Customers write in English, Bahasa Melayu, Chinese, or a mix (Manglish, code-switching).

Catalog (JSON):
${JSON.stringify(catalog)}

Rules:
- Read the whole conversation. Later customer messages add to or correct earlier ones.
- One item per distinct product the customer wants.
- match="exact" only when exactly one catalog product clearly fits. Set productId.
- match="ambiguous" when several products could fit (e.g. "flyer" without a size). productId=null, list candidateProductIds.
- match="none" when nothing in the catalog fits. productId=null.
- quantity: only a number the customer stated or clearly implied ("two units" = 2). Otherwise null. Never assume.
- fields: only keys from that product's requiredFields. Normalise the customer's wording to the exact option text (e.g. "1.5匹" → "1.5", "挂墙式" → "wall-mounted", "double side" → "double", "kamu sediakan cat" → "we supply"). If a field was not stated, leave it out. Never fill defaults.
- language: the language of the customer's messages ("mixed" if they mix).
- summary: one short English sentence describing the request.
- location / neededBy: as stated by the customer, else null.
- reason (per item): one short English sentence on why you chose this match, quoting the customer's words (e.g. "Said 'flyer A5 1000pcs', matches the A5 flyer exactly").
- reasoning: 2-5 short English notes, shown to the business's staff, on how you read the conversation: what the customer wants, how you handled other languages or slang, any corrections in later messages, and anything you were unsure about. Facts only, no prices.
- Never invent prices.`;

	const transcript = input.history
		.map((m) => `${m.sender.toUpperCase()}: ${m.body}`)
		.join("\n");

	const res = await getClient().chat.completions.create({
		model: model(),
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: transcript },
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "quote_request",
				strict: true,
				schema: extractionJsonSchema as unknown as Record<string, unknown>,
			},
		},
	});

	const raw = res.choices[0]?.message?.content;
	if (!raw) throw new Error("AI returned an empty response");
	const parsed = extractionSchema.parse(JSON.parse(raw));

	return {
		...parsed,
		items: parsed.items.map((i) => ({
			...i,
			fields: Object.fromEntries(i.fields.map((f) => [f.key, f.value])),
		})),
	};
}

// --- Customer reply ---------------------------------------------------------

const languageName: Record<ExtractedRequest["language"], string> = {
	en: "English",
	ms: "Bahasa Melayu",
	zh: "Simplified Chinese",
	mixed: "the same mix of languages the customer used",
};

export async function composeReply(input: {
	businessName: string;
	language: ExtractedRequest["language"];
	outcome: Outcome;
	flags: Flag[];
	summary: string;
}): Promise<string> {
	const situation =
		input.outcome === "needs_clarification"
			? `We cannot quote yet. Ask the customer for ONLY these missing details, as a short numbered list. Offer the options when given:\n${JSON.stringify(
					input.flags
						.filter((f) => f.kind === "missing_info")
						.map((f) => ({ need: f.message, options: f.options })),
				)}`
			: input.outcome === "needs_review"
				? "Thank the customer. Say our team needs to check some details (or arrange a site visit if relevant) and will get back with a quotation soon."
				: "Thank the customer. Say the quotation is being prepared and will be sent after our team confirms it, usually within the hour.";

	const res = await getClient().chat.completions.create({
		model: model(),
		messages: [
			{
				role: "system",
				content: `You write WhatsApp replies for "${input.businessName}", a Malaysian small business. Friendly, brief, polite. Reply in ${languageName[input.language]}. Never mention or estimate any price. No greetings like "Dear". Plain text only.`,
			},
			{
				role: "user",
				content: `Customer request: ${input.summary}\n\nWhat to say: ${situation}`,
			},
		],
	});

	return (
		res.choices[0]?.message?.content?.trim() ||
		"Thanks! Our team will get back to you shortly."
	);
}
