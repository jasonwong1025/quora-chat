import OpenAI from "openai";
import { z } from "zod";
import type { ExtractedRequest, Flag } from "#/db/schema";
import type { CatalogProduct, Outcome } from "./pricing";

let client: OpenAI | undefined;

/** Replit AI Integrations first, plain OpenAI key as a local fallback. */
function getClient() {
	if (client) return client;
	const replitKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
	const replitUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
	if (replitKey && replitUrl) {
		client = new OpenAI({ apiKey: replitKey, baseURL: replitUrl });
	} else if (process.env.OPENAI_API_KEY) {
		client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
	} else {
		throw new Error(
			"No AI credentials. Set AI_INTEGRATIONS_OPENAI_* or OPENAI_API_KEY in .env.",
		);
	}
	return client;
}

const model = () => process.env.AI_MODEL || "gpt-5-mini";

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
		}),
	),
});

// Hand-written so it satisfies OpenAI strict mode (no open-ended objects).
const extractionJsonSchema = {
	type: "object",
	additionalProperties: false,
	required: ["language", "summary", "location", "neededBy", "items"],
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
				},
			},
		},
	},
} as const;

export type ChatTurn = {
	sender: "customer" | "assistant" | "staff";
	body: string;
};

export async function extractRequest(input: {
	businessName: string;
	industry: string;
	products: (CatalogProduct & { description: string })[];
	history: ChatTurn[];
}): Promise<ExtractedRequest> {
	const catalog = input.products.map((p) => ({
		id: p.id,
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
