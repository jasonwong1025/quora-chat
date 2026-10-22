import { ORPCError, os } from "@orpc/server";
import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	inArray,
	like,
	ne,
	sql,
} from "drizzle-orm";
import { z } from "zod";
import { getDemoBusiness } from "#/data/demo";
import { getDb, schema } from "#/db";
import { suggestSku, uniqueSku } from "#/lib/sku";
import { suggestQuestions } from "#/server/ai";
import { emitOrbyteEvent } from "#/server/orbyte";
import {
	askNow,
	decideQuote,
	draftNow,
	editBrief,
	editDraftQuote,
	handleCustomerMessage,
	markQuoteViewed,
	setTakeover,
	signQuote,
	staffReply,
} from "#/server/workflow";

const businessInput = z.object({ businessId: z.string() });

// Attachment bytes are only served from /api/messages/:id/attachment, never in lists.
const { attachmentData: _attachmentData, ...messageColumns } = getTableColumns(
	schema.messages,
);

function fail(err: unknown): never {
	throw new ORPCError("BAD_REQUEST", {
		message: err instanceof Error ? err.message : String(err),
	});
}

// --- Businesses ----------------------------------------------------------------

const listBusinesses = os.handler(() =>
	getDb().select().from(schema.businesses).orderBy(asc(schema.businesses.name)),
);

const getBusiness = os.input(businessInput).handler(async ({ input }) => {
	const db = getDb();
	const business = await db.query.businesses.findFirst({
		where: eq(schema.businesses.id, input.businessId),
	});
	if (!business) throw new ORPCError("NOT_FOUND");
	const { image, ...productColumns } = getTableColumns(schema.products);
	const [products, rules, staff, questions] = await Promise.all([
		db
			.select({
				...productColumns,
				// Short hash so the image URL changes when the picture does.
				imageVersion: sql<string | null>`left(md5(${image}), 8)`,
			})
			.from(schema.products)
			.where(eq(schema.products.businessId, business.id))
			.orderBy(asc(schema.products.category), asc(schema.products.name)),
		db
			.select()
			.from(schema.pricingRules)
			.where(eq(schema.pricingRules.businessId, business.id)),
		db
			.select()
			.from(schema.staff)
			.where(eq(schema.staff.businessId, business.id)),
		db
			.select()
			.from(schema.intakeQuestions)
			.where(eq(schema.intakeQuestions.businessId, business.id))
			.orderBy(
				asc(schema.intakeQuestions.position),
				asc(schema.intakeQuestions.createdAt),
			),
	]);
	return {
		...business,
		products,
		rules,
		staff,
		questions,
		sampleMessages: getDemoBusiness(business.id)?.sampleMessages ?? [],
	};
});

// --- Conversations -----------------------------------------------------------

const listConversations = os.input(businessInput).handler(({ input }) =>
	getDb().query.conversations.findMany({
		where: eq(schema.conversations.businessId, input.businessId),
		orderBy: desc(schema.conversations.createdAt),
	}),
);

const createConversation = os
	.input(businessInput.extend({ customerName: z.string().min(1) }))
	.handler(async ({ input }) => {
		const [row] = await getDb()
			.insert(schema.conversations)
			.values({
				businessId: input.businessId,
				customerName: input.customerName,
			})
			.returning();
		return row;
	});

const getConversation = os
	.input(z.object({ conversationId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();
		const conversation = await db.query.conversations.findFirst({
			where: eq(schema.conversations.id, input.conversationId),
		});
		if (!conversation) throw new ORPCError("NOT_FOUND");
		const messages = await db.query.messages.findMany({
			where: eq(schema.messages.conversationId, conversation.id),
			orderBy: asc(schema.messages.createdAt),
			columns: { attachmentData: false },
		});
		const quoteIds = messages.flatMap((m) => (m.quoteId ? [m.quoteId] : []));
		const quotes = quoteIds.length
			? await db
					.select({
						id: schema.quotes.id,
						number: schema.quotes.number,
						status: schema.quotes.status,
						totalSen: schema.quotes.totalSen,
					})
					.from(schema.quotes)
					.where(inArray(schema.quotes.id, quoteIds))
			: [];
		const runs = await db.query.aiRuns.findMany({
			where: eq(schema.aiRuns.conversationId, conversation.id),
			orderBy: asc(schema.aiRuns.createdAt),
		});
		return { ...conversation, messages, quotes, runs };
	});

/** Streams workflow progress so the UI can show each step as it happens. */
const attachmentInput = z
	.object({
		name: z.string().min(1).max(120),
		mime: z
			.string()
			.regex(
				/^(image\/(png|jpeg|webp)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.(spreadsheetml\.sheet|wordprocessingml\.document))$/,
				"Send a photo, PDF, Word or Excel file",
			),
		dataUrl: z.string().max(6_000_000, "File is too large (max ~4 MB)"),
	})
	.refine((a) => a.dataUrl.startsWith(`data:${a.mime};base64,`), {
		message: "File data does not match its type",
	});

const sendMessage = os
	.input(
		z
			.object({
				conversationId: z.string(),
				body: z.string().max(2000),
				attachment: attachmentInput.nullish(),
			})
			.refine((m) => m.body.trim() || m.attachment, {
				message: "Type a message or attach a file",
			}),
	)
	.handler(async function* ({ input }) {
		yield* handleCustomerMessage(input);
	});

// --- Requests & quotes --------------------------------------------------------

const listRequests = os.input(businessInput).handler(async ({ input }) => {
	const db = getDb();
	const requests = await db
		.select({
			request: schema.quoteRequests,
			customerName: schema.conversations.customerName,
		})
		.from(schema.quoteRequests)
		.innerJoin(
			schema.conversations,
			eq(schema.quoteRequests.conversationId, schema.conversations.id),
		)
		.where(eq(schema.quoteRequests.businessId, input.businessId))
		.orderBy(desc(schema.quoteRequests.updatedAt));

	const ids = requests.map((r) => r.request.id);
	const quotes = ids.length
		? await db
				.select()
				.from(schema.quotes)
				.where(inArray(schema.quotes.requestId, ids))
		: [];
	return requests.map(({ request, customerName }) => ({
		...request,
		customerName,
		quote:
			quotes
				.filter((q) => q.requestId === request.id)
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
			null,
	}));
});

const getQuote = os
	.input(z.object({ quoteId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();
		const quote = await db.query.quotes.findFirst({
			where: eq(schema.quotes.id, input.quoteId),
		});
		if (!quote) throw new ORPCError("NOT_FOUND");
		const [business, request, decidedBy] = await Promise.all([
			db.query.businesses.findFirst({
				where: eq(schema.businesses.id, quote.businessId),
			}),
			db.query.quoteRequests.findFirst({
				where: eq(schema.quoteRequests.id, quote.requestId),
			}),
			quote.decidedBy
				? db.query.staff.findFirst({
						where: eq(schema.staff.id, quote.decidedBy),
					})
				: undefined,
		]);
		const conversation = request
			? await db.query.conversations.findFirst({
					where: eq(schema.conversations.id, request.conversationId),
				})
			: undefined;
		return {
			...quote,
			business,
			request,
			conversation,
			decidedBy: decidedBy ?? null,
		};
	});

const lineItemSchema = z.object({
	productId: z.string().nullable(),
	description: z.string().min(1),
	quantity: z.number().positive(),
	unit: z.string(),
	unitPriceSen: z.number().int().nonnegative(),
	amountSen: z.number().int().nonnegative(),
	notes: z.string().optional(),
});

const updateQuote = os
	.input(
		z.object({
			quoteId: z.string(),
			staffId: z.string(),
			lineItems: z.array(lineItemSchema),
			notes: z.string().nullable(),
		}),
	)
	.handler(({ input }) => editDraftQuote(input).catch(fail));

const decide = os
	.input(
		z.object({
			quoteId: z.string(),
			staffId: z.string(),
			decision: z.enum(["approved", "rejected"]),
			reason: z.string().optional(),
		}),
	)
	.handler(({ input }) => decideQuote(input).catch(fail));

// --- Activity (simulated Orbyte) -----------------------------------------------

const listActivity = os
	.input(businessInput.extend({ requestId: z.string().optional() }))
	.handler(({ input }) =>
		getDb()
			.select()
			.from(schema.activityEvents)
			.where(
				and(
					eq(schema.activityEvents.businessId, input.businessId),
					input.requestId
						? eq(schema.activityEvents.requestId, input.requestId)
						: undefined,
				),
			)
			.orderBy(desc(schema.activityEvents.createdAt))
			.limit(100),
	);

// --- WhatsApp portal (customer's phone) ---------------------------------------

const customerInput = z.object({
	phone: z.string().min(5),
	name: z.string().min(1),
});

/** The customer's chat list: one chat per business. */
const whatsappChats = os
	.input(z.object({ phone: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();
		const businesses = await db
			.select()
			.from(schema.businesses)
			.orderBy(asc(schema.businesses.name));
		const conversations = await db.query.conversations.findMany({
			where: eq(schema.conversations.customerPhone, input.phone),
		});
		const ids = conversations.map((c) => c.id);
		const messages = ids.length
			? await db
					.select(messageColumns)
					.from(schema.messages)
					.where(inArray(schema.messages.conversationId, ids))
					.orderBy(asc(schema.messages.createdAt))
			: [];
		return businesses.map((b) => {
			const conversation = conversations.find((c) => c.businessId === b.id);
			const thread = messages.filter(
				(m) => m.conversationId === conversation?.id,
			);
			return {
				business: b,
				conversationId: conversation?.id ?? null,
				lastMessage: thread.at(-1) ?? null,
				// Timestamps of business messages, for client-side unread counts.
				incomingAt: thread
					.filter((m) => m.sender !== "customer")
					.map((m) => m.createdAt),
			};
		});
	});

/** Find or start the chat between this customer and a business. */
const whatsappOpen = os
	.input(customerInput.extend({ businessId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();
		const existing = await db.query.conversations.findFirst({
			where: and(
				eq(schema.conversations.businessId, input.businessId),
				eq(schema.conversations.customerPhone, input.phone),
			),
		});
		if (existing) return existing;
		const [row] = await db
			.insert(schema.conversations)
			.values({
				businessId: input.businessId,
				customerName: input.name,
				customerPhone: input.phone,
			})
			.returning();
		return row;
	});

// --- Orbyte: Quotation inbox ---------------------------------------------------

const inboxList = os.input(businessInput).handler(async ({ input }) => {
	const db = getDb();
	const conversations = await db.query.conversations.findMany({
		where: eq(schema.conversations.businessId, input.businessId),
	});
	const ids = conversations.map((c) => c.id);
	if (ids.length === 0) return [];
	const [messages, requests, staff] = await Promise.all([
		db
			.select(messageColumns)
			.from(schema.messages)
			.where(inArray(schema.messages.conversationId, ids))
			.orderBy(asc(schema.messages.createdAt)),
		db
			.select()
			.from(schema.quoteRequests)
			.where(inArray(schema.quoteRequests.conversationId, ids))
			.orderBy(desc(schema.quoteRequests.createdAt)),
		db
			.select()
			.from(schema.staff)
			.where(eq(schema.staff.businessId, input.businessId)),
	]);
	return conversations
		.map((c) => {
			const thread = messages.filter((m) => m.conversationId === c.id);
			const last = thread.at(-1) ?? null;
			return {
				...c,
				handledByName: staff.find((s) => s.id === c.handledBy)?.name ?? null,
				lastMessage: last,
				lastActivityAt: last?.createdAt ?? c.createdAt,
				// The customer spoke last and nobody (AI or staff) has answered yet.
				awaitingReply: last?.sender === "customer",
				latestRequest: requests.find((r) => r.conversationId === c.id) ?? null,
			};
		})
		.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
});

const takeover = os
	.input(
		z.object({
			conversationId: z.string(),
			staffId: z.string(),
			takeOver: z.boolean(),
		}),
	)
	.handler(({ input }) => setTakeover(input).catch(fail));

const reply = os
	.input(
		z.object({
			conversationId: z.string(),
			staffId: z.string(),
			body: z.string().min(1).max(2000),
		}),
	)
	.handler(({ input }) => staffReply(input).catch(fail));

// --- Orbyte: Products module -----------------------------------------------------

const productInput = z.object({
	sku: z.string().trim().max(40),
	type: z.enum(["stock", "service"]),
	category: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	unit: z.string().min(1),
	unitPriceSen: z.number().int().nonnegative(),
	pricingMode: z.enum(["fixed", "custom"]),
	active: z.boolean(),
});

async function skusOf(businessId: string) {
	const rows = await getDb()
		.select({ sku: schema.products.sku })
		.from(schema.products)
		.where(eq(schema.products.businessId, businessId));
	return rows.map((r) => r.sku);
}

async function assertSkuFree(businessId: string, sku: string, exceptId = "") {
	const clash = await getDb().query.products.findFirst({
		where: and(
			eq(schema.products.businessId, businessId),
			sql`upper(${schema.products.sku}) = ${sku.toUpperCase()}`,
			ne(schema.products.id, exceptId),
		),
	});
	if (clash) fail(new Error(`SKU ${sku} is already used by ${clash.name}`));
}

async function loadProduct(productId: string) {
	const row = await getDb().query.products.findFirst({
		where: eq(schema.products.id, productId),
	});
	if (!row) throw new ORPCError("NOT_FOUND");
	return row;
}

const MAX_IMAGE = 400_000; // characters of data URL (~300 KB)

const setProductImage = os
	.input(
		z.object({
			productId: z.string(),
			image: z
				.string()
				.max(MAX_IMAGE, "Image is too large")
				.regex(/^data:image\/(png|jpeg|webp);base64,/, "Not a PNG/JPEG/WebP")
				.nullable(),
			actor: z.string(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const p = await loadProduct(input.productId);
		await db
			.update(schema.products)
			.set({ image: input.image })
			.where(eq(schema.products.id, p.id));
		await emitOrbyteEvent(db, {
			businessId: p.businessId,
			type: "product.updated",
			actor: input.actor,
			summary: `${input.actor} ${input.image ? "changed" : "removed"} the image of ${p.name}`,
		});
		return { ok: true };
	});

/**
 * Manual stock moves:
 * receive = new stock in; deliver = reserved goods handed over (leaves on hand and reserved);
 * release = cancel a reservation; count = set on hand after a stock take.
 */
const adjustStock = os
	.input(
		z.object({
			productId: z.string(),
			action: z.enum(["receive", "deliver", "release", "count"]),
			quantity: z.number().int().nonnegative(),
			actor: z.string(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const p = await loadProduct(input.productId);
		if (p.type !== "stock") fail(new Error(`${p.name} is not a stock item`));
		const q = input.quantity;
		let next = { stockOnHand: p.stockOnHand, stockReserved: p.stockReserved };
		let summary: string;
		switch (input.action) {
			case "receive":
				next.stockOnHand += q;
				summary = `received ${q} ${p.unit}`;
				break;
			case "deliver":
				if (q > p.stockReserved)
					fail(new Error(`Only ${p.stockReserved} ${p.unit} are reserved`));
				next = {
					stockOnHand: p.stockOnHand - q,
					stockReserved: p.stockReserved - q,
				};
				summary = `delivered ${q} reserved ${p.unit}`;
				break;
			case "release":
				if (q > p.stockReserved)
					fail(new Error(`Only ${p.stockReserved} ${p.unit} are reserved`));
				next.stockReserved -= q;
				summary = `released ${q} reserved ${p.unit}`;
				break;
			case "count":
				next.stockOnHand = q;
				summary = `counted stock: ${p.stockOnHand} → ${q} ${p.unit}`;
				break;
		}
		const [row] = await db
			.update(schema.products)
			.set(next)
			.where(eq(schema.products.id, p.id))
			.returning();
		await emitOrbyteEvent(db, {
			businessId: p.businessId,
			type: "stock.adjusted",
			actor: input.actor,
			summary: `${input.actor} ${summary} of ${p.name} (${p.sku})`,
			payload: { productId: p.id, action: input.action, quantity: q, ...next },
		});
		return row;
	});

function slug(text: string) {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 40);
}

const createProduct = os
	.input(
		businessInput.extend({
			product: productInput,
			openingStock: z.number().int().nonnegative().default(0),
			actor: z.string(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const business = await db.query.businesses.findFirst({
			where: eq(schema.businesses.id, input.businessId),
		});
		if (!business) throw new ORPCError("NOT_FOUND");
		const sku =
			input.product.sku.toUpperCase() ||
			uniqueSku(
				suggestSku(
					business.quotePrefix,
					input.product.category,
					input.product.name,
				),
				await skusOf(business.id),
			);
		await assertSkuFree(business.id, sku);
		const prefix = `${business.quotePrefix.toLowerCase()}-${slug(input.product.name)}`;
		const taken = await db
			.select({ id: schema.products.id })
			.from(schema.products)
			.where(like(schema.products.id, `${prefix}%`));
		const id = taken.length ? `${prefix}-${taken.length + 1}` : prefix;
		const [row] = await db
			.insert(schema.products)
			.values({
				...input.product,
				sku,
				id,
				businessId: business.id,
				stockOnHand: input.product.type === "stock" ? input.openingStock : 0,
			})
			.returning();
		await emitOrbyteEvent(db, {
			businessId: business.id,
			type: "product.created",
			actor: input.actor,
			summary: `${input.actor} added ${row.name} to the catalog`,
		});
		return row;
	});

const updateProduct = os
	.input(
		z.object({
			productId: z.string(),
			product: productInput.partial(),
			actor: z.string(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const current = await loadProduct(input.productId);
		const changes = { ...input.product };
		if (changes.sku !== undefined) {
			changes.sku = changes.sku.toUpperCase();
			if (!changes.sku) throw fail(new Error("SKU cannot be empty"));
			await assertSkuFree(current.businessId, changes.sku, current.id);
		}
		const [row] = await db
			.update(schema.products)
			.set(changes)
			.where(eq(schema.products.id, input.productId))
			.returning();
		if (!row) throw new ORPCError("NOT_FOUND");
		await emitOrbyteEvent(db, {
			businessId: row.businessId,
			type: "product.updated",
			actor: input.actor,
			summary: `${input.actor} updated ${row.name}`,
			payload: { changes: input.product },
		});
		return row;
	});

const deleteRule = os
	.input(z.object({ ruleId: z.string() }))
	.handler(async ({ input }) => {
		await getDb()
			.delete(schema.pricingRules)
			.where(eq(schema.pricingRules.id, input.ruleId));
		return { ok: true };
	});

// --- Orbyte: eSign module --------------------------------------------------------

const esignList = os.input(businessInput).handler(async ({ input }) => {
	const db = getDb();
	const quotes = await db
		.select({
			quote: schema.quotes,
			customerName: schema.conversations.customerName,
			customerPhone: schema.conversations.customerPhone,
		})
		.from(schema.quotes)
		.innerJoin(
			schema.quoteRequests,
			eq(schema.quotes.requestId, schema.quoteRequests.id),
		)
		.innerJoin(
			schema.conversations,
			eq(schema.quoteRequests.conversationId, schema.conversations.id),
		)
		.where(
			and(
				eq(schema.quotes.businessId, input.businessId),
				inArray(schema.quotes.status, ["approved", "accepted", "superseded"]),
			),
		)
		.orderBy(desc(schema.quotes.decidedAt));
	const requestIds = quotes.map((q) => q.quote.requestId);
	const events = requestIds.length
		? await db
				.select()
				.from(schema.activityEvents)
				.where(
					and(
						inArray(schema.activityEvents.requestId, requestIds),
						inArray(schema.activityEvents.type, [
							"quote.approved",
							"quote.sent_to_customer",
							"esign.sent",
							"esign.viewed",
							"esign.signed",
							"quote.accepted",
						]),
					),
				)
				.orderBy(asc(schema.activityEvents.createdAt))
		: [];
	return quotes.map(({ quote, customerName, customerPhone }) => ({
		...quote,
		customerName,
		customerPhone,
		audit: events.filter((e) => e.requestId === quote.requestId),
	}));
});

const markViewed = os
	.input(z.object({ quoteId: z.string() }))
	.handler(({ input }) => markQuoteViewed(input.quoteId).catch(fail));

const sign = os
	.input(
		z.object({
			quoteId: z.string(),
			signerName: z.string().min(2).max(120),
			// PNG data URL from the signature pad; cap size to keep rows small.
			signatureImage: z
				.string()
				.startsWith("data:image/png;base64,")
				.max(300_000),
		}),
	)
	.handler(({ input }) => signQuote(input).catch(fail));

// --- Orbyte: Preset questions ------------------------------------------------------

const questionTypes = [
	"text",
	"number",
	"date",
	"single",
	"multi",
	"yes_no",
	"file",
] as const;

const questionFields = z.object({
	key: z
		.string()
		.min(1)
		.max(40)
		.regex(/^[a-z0-9_]+$/, "Key: lowercase letters, numbers and _ only"),
	label: z.string().trim().min(1).max(200),
	type: z.enum(questionTypes),
	options: z.array(z.string().trim().min(1).max(80)).max(12),
	required: z.boolean(),
	hint: z.string().trim().max(300).nullable(),
	showIf: z
		.object({ key: z.string().min(1), equals: z.string().min(1) })
		.nullable(),
	onQuote: z.boolean().default(false),
});

const questionTarget = z.discriminatedUnion("scope", [
	z.object({ scope: z.literal("business") }),
	z.object({ scope: z.literal("category"), category: z.string().min(1) }),
	z.object({ scope: z.literal("product"), productId: z.string().min(1) }),
]);

type QuestionFields = z.infer<typeof questionFields>;

function checkQuestion(q: QuestionFields) {
	if ((q.type === "single" || q.type === "multi") && q.options.length < 2)
		fail(new Error(`"${q.label}" needs at least 2 options`));
	if (q.type !== "single" && q.type !== "multi") q.options = [];
	if (q.type === "yes_no") q.options = ["yes", "no"];
}

function targetWhere(businessId: string, t: z.infer<typeof questionTarget>) {
	const q = schema.intakeQuestions;
	return and(
		eq(q.businessId, businessId),
		eq(q.scope, t.scope),
		t.scope === "category" ? eq(q.category, t.category) : undefined,
		t.scope === "product" ? eq(q.productId, t.productId) : undefined,
	);
}

const addQuestions = os
	.input(
		businessInput.extend({
			target: questionTarget,
			questions: z.array(questionFields).min(1).max(20),
			source: z.enum(["staff", "ai"]).default("staff"),
			actor: z.string(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const t = input.target;
		if (t.scope === "product") {
			const p = await db.query.products.findFirst({
				where: and(
					eq(schema.products.id, t.productId),
					eq(schema.products.businessId, input.businessId),
				),
			});
			if (!p) throw new ORPCError("NOT_FOUND");
		}
		const existing = await db
			.select()
			.from(schema.intakeQuestions)
			.where(targetWhere(input.businessId, t));
		const keys = new Set(existing.map((q) => q.key));
		let position = Math.max(0, ...existing.map((q) => q.position + 1));
		const rows = input.questions.map((q) => {
			checkQuestion(q);
			if (keys.has(q.key))
				fail(new Error(`A question with key "${q.key}" already exists here`));
			keys.add(q.key);
			return {
				...q,
				businessId: input.businessId,
				scope: t.scope,
				category: t.scope === "category" ? t.category : null,
				productId: t.scope === "product" ? t.productId : null,
				position: position++,
				source: input.source,
			};
		});
		const inserted = await db
			.insert(schema.intakeQuestions)
			.values(rows)
			.returning();
		await emitOrbyteEvent(db, {
			businessId: input.businessId,
			type: "product.updated",
			actor: input.actor,
			summary: `${input.actor} added ${inserted.length} preset question${inserted.length === 1 ? "" : "s"}${input.source === "ai" ? " (suggested by AI)" : ""}`,
		});
		return inserted;
	});

async function loadQuestion(questionId: string) {
	const row = await getDb().query.intakeQuestions.findFirst({
		where: eq(schema.intakeQuestions.id, questionId),
	});
	if (!row) throw new ORPCError("NOT_FOUND");
	return row;
}

const updateQuestion = os
	.input(z.object({ questionId: z.string(), question: questionFields }))
	.handler(async ({ input }) => {
		const db = getDb();
		const current = await loadQuestion(input.questionId);
		const q = input.question;
		checkQuestion(q);
		if (q.key !== current.key) {
			const clash = await db.query.intakeQuestions.findFirst({
				where: and(
					targetWhere(current.businessId, {
						scope: current.scope,
						category: current.category ?? "",
						productId: current.productId ?? "",
					} as z.infer<typeof questionTarget>),
					eq(schema.intakeQuestions.key, q.key),
				),
			});
			if (clash) fail(new Error(`Key "${q.key}" is already used here`));
		}
		const [row] = await db
			.update(schema.intakeQuestions)
			.set(q)
			.where(eq(schema.intakeQuestions.id, current.id))
			.returning();
		return row;
	});

const deleteQuestion = os
	.input(z.object({ questionId: z.string() }))
	.handler(async ({ input }) => {
		await getDb()
			.delete(schema.intakeQuestions)
			.where(eq(schema.intakeQuestions.id, input.questionId));
		return { ok: true };
	});

/** Swaps a question with its neighbour in the same list. */
const moveQuestion = os
	.input(
		z.object({ questionId: z.string(), direction: z.enum(["up", "down"]) }),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const current = await loadQuestion(input.questionId);
		const siblings = (
			await db
				.select()
				.from(schema.intakeQuestions)
				.where(
					targetWhere(current.businessId, {
						scope: current.scope,
						category: current.category ?? "",
						productId: current.productId ?? "",
					} as z.infer<typeof questionTarget>),
				)
		).sort(
			(a, b) =>
				a.position - b.position ||
				a.createdAt.getTime() - b.createdAt.getTime(),
		);
		const i = siblings.findIndex((q) => q.id === current.id);
		const j = input.direction === "up" ? i - 1 : i + 1;
		if (j < 0 || j >= siblings.length) return { ok: true };
		const order = [...siblings];
		[order[i], order[j]] = [order[j], order[i]];
		await Promise.all(
			order.map((q, position) =>
				db
					.update(schema.intakeQuestions)
					.set({ position })
					.where(eq(schema.intakeQuestions.id, q.id)),
			),
		);
		return { ok: true };
	});

/** AI proposes questions for a product, category or the whole business. Nothing is saved. */
const suggestPresetQuestions = os
	.input(businessInput.extend({ target: questionTarget }))
	.handler(async ({ input }) => {
		const db = getDb();
		const business = await db.query.businesses.findFirst({
			where: eq(schema.businesses.id, input.businessId),
		});
		if (!business) throw new ORPCError("NOT_FOUND");
		const [products, rules, questions] = await Promise.all([
			db
				.select()
				.from(schema.products)
				.where(eq(schema.products.businessId, business.id)),
			db
				.select()
				.from(schema.pricingRules)
				.where(eq(schema.pricingRules.businessId, business.id)),
			db
				.select()
				.from(schema.intakeQuestions)
				.where(eq(schema.intakeQuestions.businessId, business.id)),
		]);
		const t = input.target;
		const ruleKeysFor = (ids: string[]) => [
			...new Set(
				rules
					.filter((r) => r.productId && ids.includes(r.productId))
					.flatMap((r) =>
						"when" in r.config && r.config.when && "field" in r.config.when
							? [r.config.when.field]
							: [],
					),
			),
		];
		const shared = (category: string) =>
			questions.filter(
				(q) => q.scope === "category" && q.category === category,
			);
		const general = questions.filter((q) => q.scope === "business");
		const pick = (qs: typeof questions) =>
			qs.map((q) => ({ key: q.key, label: q.label }));

		try {
			if (t.scope === "product") {
				const p = products.find((x) => x.id === t.productId);
				if (!p) throw new ORPCError("NOT_FOUND");
				return await suggestQuestions({
					businessName: business.name,
					industry: business.industry,
					target: {
						kind: "product",
						name: p.name,
						description: p.description,
						category: p.category,
						unit: p.unit,
						pricing: p.pricingMode,
					},
					existing: pick([
						...questions.filter((q) => q.productId === p.id),
						...shared(p.category),
						...general,
					]),
					ruleKeys: ruleKeysFor([p.id]),
				});
			}
			if (t.scope === "category") {
				const inCat = products.filter((x) => x.category === t.category);
				return await suggestQuestions({
					businessName: business.name,
					industry: business.industry,
					target: {
						kind: "category",
						category: t.category,
						products: inCat.map((x) => x.name),
					},
					existing: pick([...shared(t.category), ...general]),
					ruleKeys: [],
				});
			}
			return await suggestQuestions({
				businessName: business.name,
				industry: business.industry,
				target: { kind: "business", products: products.map((x) => x.name) },
				existing: pick(general),
				ruleKeys: [],
			});
		} catch (err) {
			if (err instanceof ORPCError) throw err;
			fail(err);
		}
	});

// --- Orbyte: Requirement brief -----------------------------------------------------

const briefEdit = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("answer"),
		itemId: z.string().nullable(),
		key: z.string(),
		values: z.array(z.string().max(500)).min(1),
	}),
	z.object({
		kind: z.literal("skip"),
		itemId: z.string().nullable(),
		key: z.string(),
	}),
	z.object({
		kind: z.literal("clear"),
		itemId: z.string().nullable(),
		key: z.string(),
	}),
	z.object({
		kind: z.literal("quantity"),
		itemId: z.string(),
		quantity: z.number().positive().nullable(),
	}),
	z.object({
		kind: z.literal("product"),
		itemId: z.string(),
		productId: z.string(),
	}),
	z.object({ kind: z.literal("add_follow_up"), question: z.string().max(300) }),
	z.object({ kind: z.literal("remove_follow_up"), id: z.string() }),
	z.object({
		kind: z.literal("answer_follow_up"),
		id: z.string(),
		answer: z.string().max(500),
	}),
]);

const editRequestBrief = os
	.input(
		z.object({ requestId: z.string(), staffId: z.string(), edit: briefEdit }),
	)
	.handler(({ input }) => editBrief(input).catch(fail));

const askRequestNow = os
	.input(z.object({ requestId: z.string(), staffId: z.string() }))
	.handler(({ input }) => askNow(input).catch(fail));

const draftRequestNow = os
	.input(z.object({ requestId: z.string(), staffId: z.string() }))
	.handler(({ input }) => draftNow(input).catch(fail));

export default {
	businesses: { list: listBusinesses, get: getBusiness },
	conversations: {
		list: listConversations,
		create: createConversation,
		get: getConversation,
		send: sendMessage,
		takeover,
		reply,
	},
	whatsapp: { chats: whatsappChats, open: whatsappOpen },
	inbox: { list: inboxList },
	products: {
		create: createProduct,
		update: updateProduct,
		setImage: setProductImage,
		adjustStock,
	},
	rules: { delete: deleteRule },
	esign: { list: esignList, markViewed, sign },
	requests: {
		list: listRequests,
		editBrief: editRequestBrief,
		askNow: askRequestNow,
		draftNow: draftRequestNow,
	},
	questions: {
		add: addQuestions,
		update: updateQuestion,
		delete: deleteQuestion,
		move: moveQuestion,
		suggest: suggestPresetQuestions,
	},
	quotes: { get: getQuote, update: updateQuote, decide },
	activity: { list: listActivity },
};
