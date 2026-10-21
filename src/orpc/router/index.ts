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
import { emitOrbyteEvent } from "#/server/orbyte";
import {
	decideQuote,
	editDraftQuote,
	handleCustomerMessage,
	markQuoteViewed,
	setTakeover,
	signQuote,
	staffReply,
} from "#/server/workflow";

const businessInput = z.object({ businessId: z.string() });

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
	const [products, rules, staff] = await Promise.all([
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
	]);
	return {
		...business,
		products,
		rules,
		staff,
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
const sendMessage = os
	.input(
		z.object({ conversationId: z.string(), body: z.string().min(1).max(2000) }),
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
					.select()
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
			.select()
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

const requiredFieldSchema = z.object({
	key: z.string().min(1),
	label: z.string().min(1),
	options: z.array(z.string()).optional(),
});

const productInput = z.object({
	sku: z.string().trim().max(40),
	type: z.enum(["stock", "service"]),
	category: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	unit: z.string().min(1),
	unitPriceSen: z.number().int().nonnegative(),
	requiredFields: z.array(requiredFieldSchema),
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
				inArray(schema.quotes.status, ["approved", "accepted"]),
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
	requests: { list: listRequests },
	quotes: { get: getQuote, update: updateQuote, decide },
	activity: { list: listActivity },
};
