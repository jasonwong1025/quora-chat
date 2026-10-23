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
import { questionsFor } from "#/lib/intake";
import { emptyBuilder } from "#/lib/price-builder";
import { suggestSku, uniqueSku } from "#/lib/sku";
import {
	aiMode,
	aiModelName,
	draftPriceBuilder,
	suggestBilling,
	suggestQuestions,
} from "#/server/ai";
import {
	outstanding,
	payInvoice,
	recordPayment,
	reminderAction,
	sendStatement,
	statementFor,
} from "#/server/billing";
import { resetDemoActivity } from "#/server/demo-reset";
import { fastForward, followUpAction } from "#/server/followups";
import {
	addJobMember,
	addTask,
	loadMembers,
	postJobMessage,
	prepareHandover,
	removeJobMember,
	requestCustomerAnswer,
	reviewRelay,
	updateJob,
	updateTask,
} from "#/server/jobs";
import {
	deleteKnowledgeDoc,
	findKnowledge,
	loadKnowledge,
	saveKnowledgeDoc,
} from "#/server/knowledge";
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
	const [products, rules, staff, questions, categoryPics] = await Promise.all([
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
		db
			.select()
			.from(schema.categorySettings)
			.where(eq(schema.categorySettings.businessId, business.id)),
	]);
	return {
		...business,
		products,
		rules,
		staff,
		questions,
		categoryPics,
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
		const billing = await chatBilling(conversation.id);
		const relays = await db
			.select({
				relay: schema.relays,
				jobNumber: schema.jobs.number,
				jobTitle: schema.jobs.title,
				askedBy: schema.staff.name,
			})
			.from(schema.relays)
			.innerJoin(schema.jobs, eq(schema.relays.jobId, schema.jobs.id))
			.leftJoin(schema.staff, eq(schema.relays.askedById, schema.staff.id))
			.where(eq(schema.relays.conversationId, conversation.id))
			.orderBy(asc(schema.relays.createdAt));
		return {
			...conversation,
			messages,
			quotes,
			...billing,
			runs,
			relays: relays.map((r) => ({
				...r.relay,
				jobNumber: r.jobNumber,
				jobTitle: r.jobTitle,
				askedBy: r.askedBy,
			})),
		};
	});

/** Invoices (with what they cover) and payments in a chat, for the pay cards. */
async function chatBilling(conversationId: string) {
	const db = getDb();
	const rows = await db
		.select({ invoice: schema.invoices, quote: schema.quotes })
		.from(schema.invoices)
		.innerJoin(schema.quotes, eq(schema.invoices.quoteId, schema.quotes.id))
		.where(eq(schema.invoices.conversationId, conversationId))
		.orderBy(asc(schema.invoices.issuedAt));
	const payments = rows.length
		? await db
				.select()
				.from(schema.payments)
				.where(
					inArray(
						schema.payments.invoiceId,
						rows.map((r) => r.invoice.id),
					),
				)
		: [];
	return {
		invoices: rows.map(({ invoice, quote }) => ({
			...invoice,
			quoteNumber: quote.number,
			items: quote.lineItems
				.filter((l) => !l.charge || l.charge === "one_time")
				.map((l) => ({
					description: l.description,
					quantity: l.quantity,
					unit: l.unit,
				})),
		})),
		payments,
	};
}

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
	const jobs = ids.length
		? await db
				.select({
					id: schema.jobs.id,
					number: schema.jobs.number,
					requestId: schema.jobs.requestId,
					quoteId: schema.jobs.quoteId,
				})
				.from(schema.jobs)
				.where(eq(schema.jobs.businessId, input.businessId))
		: [];
	return requests.map(({ request, customerName }) => {
		const quote =
			quotes
				.filter((q) => q.requestId === request.id)
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
			null;
		const own = new Set(
			quotes.filter((q) => q.requestId === request.id).map((q) => q.id),
		);
		const job =
			jobs.find((j) => j.requestId === request.id || own.has(j.quoteId)) ??
			null;
		return {
			...request,
			customerName,
			quote,
			job: job ? { id: job.id, number: job.number } : null,
			baselineQuote:
				quotes.find(
					(q) => q.id === (request.brief.revisionOf ?? quote?.supersedesId),
				) ?? null,
		};
	});
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
	quantity: z.number().int().positive(),
	unit: z.string(),
	unitPriceSen: z.number().int().nonnegative(),
	amountSen: z.number().int().nonnegative(),
	notes: z.string().optional(),
	backorder: z.number().int().positive().optional(),
	charge: z.enum(["one_time", "monthly", "yearly", "optional"]).optional(),
	source: z.enum(["builder", "ai_estimate"]).optional(),
	estimate: z.object({ reasoning: z.string() }).optional(),
});

const termsSchema = z.object({
	phases: z.array(
		z.object({
			name: z.string().trim().min(1),
			weeks: z.number().int().positive().max(520),
		}),
	),
	payments: z
		.array(
			z.object({
				label: z.string().trim().min(1),
				percent: z.number().int().positive().max(100),
				when: z.enum(["signed", "phase", "completed"]).optional(),
				phase: z.string().nullable().optional(),
			}),
		)
		.refine(
			(p) => p.length === 0 || p.reduce((s, x) => s + x.percent, 0) === 100,
			"Payments must add up to 100%",
		),
	assumptions: z.array(z.string().trim().min(1)),
	exclusions: z.array(z.string().trim().min(1)),
});

const updateQuote = os
	.input(
		z.object({
			quoteId: z.string(),
			staffId: z.string(),
			lineItems: z.array(lineItemSchema),
			notes: z.string().nullable(),
			terms: termsSchema.nullable().optional(),
			reviewToken: z.string(),
		}),
	)
	.handler(({ input }) => editDraftQuote(input).catch(fail));

const decide = os
	.input(
		z.object({
			quoteId: z.string(),
			staffId: z.string(),
			decision: z.enum(["approved", "rejected"]),
			reviewToken: z.string(),
			reason: z.string().trim().max(500).optional(),
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
	restockDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.nullable()
		.optional(),
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
				inArray(schema.quotes.status, [
					"approved",
					"accepted",
					"superseded",
					"cancelled",
				]),
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
							"quote.cancelled",
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

// --- Price lists for custom-priced items ------------------------------------------

const sen = (rm: number) => Math.max(0, Math.round(rm * 100));

const priceBuilderSchema = z.object({
	rate: z
		.object({
			amountSen: z.number().int().positive(),
			unit: z.enum(["hour", "day"]),
		})
		.nullable(),
	components: z
		.array(
			z.object({
				id: z.string().min(1),
				label: z.string().trim().min(1).max(120),
				charge: z.enum(["one_time", "monthly", "yearly", "optional"]),
				when: z
					.object({ key: z.string().min(1), equals: z.string().min(1) })
					.nullable(),
				amountSen: z.number().int().nonnegative(),
				per: z.discriminatedUnion("kind", [
					z.object({ kind: z.literal("fixed") }),
					z.object({ kind: z.literal("quantity") }),
					z.object({
						kind: z.literal("answer"),
						key: z.string().min(1),
						unit: z.string().trim().min(1).max(30),
					}),
				]),
				weeks: z.number().nonnegative().max(260).nullable(),
				note: z.string().trim().max(200).nullable(),
			}),
		)
		.max(40),
	phases: termsSchema.shape.phases,
	payments: termsSchema.shape.payments,
	assumptions: z.array(z.string().trim().min(1).max(300)).max(12),
	exclusions: z.array(z.string().trim().min(1).max(300)).max(12),
});

async function loadCustomProduct(productId: string) {
	const db = getDb();
	const product = await db.query.products.findFirst({
		where: eq(schema.products.id, productId),
	});
	if (!product) throw new ORPCError("NOT_FOUND");
	const [business, questions, others] = await Promise.all([
		db.query.businesses.findFirst({
			where: eq(schema.businesses.id, product.businessId),
		}),
		db
			.select()
			.from(schema.intakeQuestions)
			.where(eq(schema.intakeQuestions.businessId, product.businessId)),
		db
			.select({ id: schema.products.id, name: schema.products.name })
			.from(schema.products)
			.where(eq(schema.products.businessId, product.businessId)),
	]);
	if (!business) throw new ORPCError("NOT_FOUND");
	return {
		product,
		business,
		questions: questionsFor(product, questions),
		others: others.filter((o) => o.id !== product.id).map((o) => o.name),
	};
}

/** AI drafts a price list (and any questions it needs). Nothing is saved. */
const suggestPriceBuilder = os
	.input(z.object({ productId: z.string() }))
	.handler(async ({ input }) => {
		const { product, business, questions, others } = await loadCustomProduct(
			input.productId,
		);
		const draft = await draftPriceBuilder({
			businessName: business.name,
			industry: business.industry,
			product,
			questions: questions.map((q) => ({
				key: q.key,
				label: q.label,
				type: q.type,
				options: q.options,
			})),
			otherProducts: others,
		}).catch(fail);
		const keys = new Set([
			...questions.map((q) => q.key),
			...draft.newQuestions.map((q) => q.key),
		]);
		const builder = {
			...emptyBuilder(),
			rate:
				draft.rate && draft.rate.amount > 0
					? { amountSen: sen(draft.rate.amount), unit: draft.rate.unit }
					: null,
			components: draft.components.map((c, i) => ({
				id: `c${i + 1}`,
				label: c.label,
				charge: c.charge,
				when:
					c.whenKey && c.whenEquals && keys.has(c.whenKey)
						? { key: c.whenKey, equals: c.whenEquals }
						: null,
				amountSen: sen(c.amount),
				per:
					c.per === "answer" && c.perKey && keys.has(c.perKey)
						? {
								kind: "answer" as const,
								key: c.perKey,
								unit: c.perUnit || "unit",
							}
						: c.per === "quantity"
							? { kind: "quantity" as const }
							: { kind: "fixed" as const },
				weeks: c.charge === "one_time" ? c.weeks : null,
				note: c.note,
			})),
			phases: draft.phases
				.filter((p) => p.weeks > 0)
				.map((p) => ({
					name: p.name,
					weeks: Math.max(1, Math.round(p.weeks)),
				})),
			payments: draft.payments.map((p) => ({
				label: p.label,
				percent: Math.round(p.percent),
				when: p.when,
				phase: p.when === "phase" ? p.phase : null,
			})),
			assumptions: draft.assumptions,
			exclusions: draft.exclusions,
		};
		return {
			builder,
			newQuestions: draft.newQuestions.filter(
				(q) => !questions.some((e) => e.key === q.key),
			),
		};
	});

/** Saves the price list, adding any questions it needs so the AI gathers them. */
const savePriceBuilder = os
	.input(
		z.object({
			productId: z.string(),
			builder: priceBuilderSchema.nullable(),
			newQuestions: z.array(questionFields).max(10).default([]),
			actor: z.string(),
		}),
	)
	.handler(async ({ input }) => {
		const { product, questions } = await loadCustomProduct(input.productId);
		return getDb().transaction(async (db) => {
			const keys = new Set(questions.map((q) => q.key));
			const fresh = input.newQuestions.filter((q) => !keys.has(q.key));
			let position = Math.max(
				0,
				...questions
					.filter((q) => q.productId === product.id)
					.map((q) => q.position + 1),
			);
			if (fresh.length)
				await db.insert(schema.intakeQuestions).values(
					fresh.map((q) => {
						checkQuestion(q);
						return {
							...q,
							businessId: product.businessId,
							scope: "product" as const,
							category: null,
							productId: product.id,
							position: position++,
							source: "ai" as const,
						};
					}),
				);
			const [row] = await db
				.update(schema.products)
				.set({ priceBuilder: input.builder })
				.where(eq(schema.products.id, product.id))
				.returning();
			await emitOrbyteEvent(db, {
				businessId: product.businessId,
				type: "product.updated",
				actor: input.actor,
				summary: input.builder
					? `${input.actor} saved the price list for ${product.name} (${input.builder.components.length} parts${fresh.length ? `, ${fresh.length} new question${fresh.length === 1 ? "" : "s"}` : ""})`
					: `${input.actor} removed the price list for ${product.name}`,
			});
			return row;
		});
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
		reason: z.string().trim().min(1).max(500),
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
	z.object({
		kind: z.literal("remove_follow_up"),
		id: z.string(),
		reason: z.string().trim().min(1).max(500),
	}),
	z.object({
		kind: z.literal("answer_follow_up"),
		id: z.string(),
		answer: z.string().max(500),
	}),
]);

const editRequestBrief = os
	.input(
		z.object({
			requestId: z.string(),
			staffId: z.string(),
			edit: briefEdit,
			expectedVersion: z.number().int().positive(),
		}),
	)
	.handler(({ input }) => editBrief(input).catch(fail));

const askRequestNow = os
	.input(z.object({ requestId: z.string(), staffId: z.string() }))
	.handler(({ input }) => askNow(input).catch(fail));

const draftRequestNow = os
	.input(z.object({ requestId: z.string(), staffId: z.string() }))
	.handler(({ input }) => draftNow(input).catch(fail));

// --- Orbyte Work: jobs handed over after signing ----------------------------------------

const jobStatusInput = z.enum(["upcoming", "active", "completed", "closed"]);

const listJobs = os.input(businessInput).handler(async ({ input }) => {
	const db = getDb();
	const rows = await db
		.select({
			job: schema.jobs,
			clientName: schema.clients.name,
			picName: schema.staff.name,
		})
		.from(schema.jobs)
		.innerJoin(schema.clients, eq(schema.jobs.clientId, schema.clients.id))
		.leftJoin(schema.staff, eq(schema.jobs.picId, schema.staff.id))
		.where(eq(schema.jobs.businessId, input.businessId))
		.orderBy(desc(schema.jobs.createdAt));
	const ids = rows.map((r) => r.job.id);
	const [tasks, relays, members] = ids.length
		? await Promise.all([
				db
					.select({
						jobId: schema.jobTasks.jobId,
						status: schema.jobTasks.status,
					})
					.from(schema.jobTasks)
					.where(inArray(schema.jobTasks.jobId, ids)),
				db
					.select({ jobId: schema.relays.jobId, status: schema.relays.status })
					.from(schema.relays)
					.where(inArray(schema.relays.jobId, ids)),
				db
					.select({
						jobId: schema.jobMembers.jobId,
						staffId: schema.jobMembers.staffId,
					})
					.from(schema.jobMembers)
					.where(inArray(schema.jobMembers.jobId, ids)),
			])
		: [[], [], []];
	return rows.map(({ job, clientName, picName }) => {
		const own = tasks.filter((t) => t.jobId === job.id);
		return {
			...job,
			clientName,
			picName,
			memberIds: members
				.filter((m) => m.jobId === job.id)
				.map((m) => m.staffId),
			tasksTotal: own.length,
			tasksDone: own.filter((t) => t.status === "done").length,
			blocked: own.filter((t) => t.status === "blocked").length,
			waitingOnCustomer: relays.filter(
				(r) =>
					r.jobId === job.id && (r.status === "pending" || r.status === "sent"),
			).length,
		};
	});
});

const getJob = os
	.input(z.object({ jobId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();
		const job = await db.query.jobs.findFirst({
			where: eq(schema.jobs.id, input.jobId),
		});
		if (!job) throw new ORPCError("NOT_FOUND");
		const [client, quote, request, tasks, chat, relays, messages, staff] =
			await Promise.all([
				db.query.clients.findFirst({
					where: eq(schema.clients.id, job.clientId),
				}),
				db.query.quotes.findFirst({ where: eq(schema.quotes.id, job.quoteId) }),
				db.query.quoteRequests.findFirst({
					where: eq(schema.quoteRequests.id, job.requestId),
				}),
				db
					.select()
					.from(schema.jobTasks)
					.where(eq(schema.jobTasks.jobId, job.id))
					.orderBy(
						asc(schema.jobTasks.position),
						asc(schema.jobTasks.createdAt),
					),
				db
					.select()
					.from(schema.jobChat)
					.where(eq(schema.jobChat.jobId, job.id))
					.orderBy(asc(schema.jobChat.createdAt)),
				db
					.select()
					.from(schema.relays)
					.where(eq(schema.relays.jobId, job.id))
					.orderBy(asc(schema.relays.createdAt)),
				db
					.select(messageColumns)
					.from(schema.messages)
					.where(eq(schema.messages.conversationId, job.conversationId))
					.orderBy(asc(schema.messages.createdAt)),
				db
					.select({ id: schema.staff.id, name: schema.staff.name })
					.from(schema.staff)
					.where(eq(schema.staff.businessId, job.businessId)),
			]);
		if (!client || !quote || !request) throw new ORPCError("NOT_FOUND");
		const members = await loadMembers(db, job.id);
		const handoverTask = await db.query.workflowTasks.findFirst({
			where: eq(
				schema.workflowTasks.key,
				`prepare_handover:${job.id}:${job.quoteId}`,
			),
			columns: { status: true, attempts: true },
		});
		const nameOf = (id: string | null) =>
			staff.find((s) => s.id === id)?.name ?? null;
		return {
			...job,
			handoverTask: handoverTask ?? null,
			client,
			quote: {
				id: quote.id,
				number: quote.number,
				lineItems: quote.lineItems,
				subtotalSen: quote.subtotalSen,
				sstSen: quote.sstSen,
				totalSen: quote.totalSen,
				notes: quote.notes,
				terms: quote.terms,
				signerName: quote.signerName,
				signedAt: quote.signedAt,
			},
			brief: quote.requirementsSnapshot ?? request.brief,
			tasks,
			chat,
			members,
			relays: relays.map((r) => ({
				...r,
				askedBy: nameOf(r.askedById),
				reviewedBy: nameOf(r.reviewedById),
			})),
			messages,
		};
	});

const updateJobInput = os
	.input(
		z.object({
			jobId: z.string(),
			staffId: z.string(),
			status: jobStatusInput.optional(),
			picId: z.string().nullable().optional(),
			acknowledgeAgreement: z.boolean().optional(),
		}),
	)
	.handler(({ input }) => updateJob(input).catch(fail));

const retryHandover = os
	.input(z.object({ jobId: z.string() }))
	.handler(({ input }) =>
		prepareHandover(input.jobId)
			.then(() => ({ ok: true }))
			.catch(fail),
	);

const addJobTask = os
	.input(
		z.object({
			jobId: z.string(),
			staffId: z.string(),
			title: z.string().trim().min(1).max(200),
			source: z.enum(["staff", "bot"]).optional(),
			phase: z.string().nullable().optional(),
		}),
	)
	.handler(({ input }) => addTask(input).catch(fail));

const updateJobTask = os
	.input(
		z.object({
			taskId: z.string(),
			status: z.enum(["todo", "active", "blocked", "done"]).optional(),
			note: z.string().max(500).nullable().optional(),
			title: z.string().trim().min(1).max(200).optional(),
			phase: z.string().nullable().optional(),
		}),
	)
	.handler(({ input }) => updateTask(input).catch(fail));

const deleteJobTask = os
	.input(z.object({ taskId: z.string() }))
	.handler(async ({ input }) => {
		await getDb()
			.delete(schema.jobTasks)
			.where(eq(schema.jobTasks.id, input.taskId));
		return { ok: true };
	});

/** Post in the job's team group. The AI replies only when the message tags @AI. */
const postJobChat = os
	.input(
		z.object({
			jobId: z.string(),
			staffId: z.string(),
			body: z.string().trim().min(1).max(2000),
		}),
	)
	.handler(({ input }) => postJobMessage(input).catch(fail));

const jobMemberInput = z.object({
	jobId: z.string(),
	staffId: z.string(), // who is doing it
	memberId: z.string(), // who is added or removed
});

const addMember = os
	.input(jobMemberInput)
	.handler(({ input }) => addJobMember(input).catch(fail));

const removeMember = os
	.input(jobMemberInput)
	.handler(({ input }) => removeJobMember(input).catch(fail));

const createRelay = os
	.input(
		z.object({
			jobId: z.string(),
			staffId: z.string(),
			question: z.string().trim().min(1).max(500),
		}),
	)
	.handler(({ input }) => requestCustomerAnswer(input).catch(fail));

const reviewRelayInput = os
	.input(
		z.object({
			relayId: z.string(),
			staffId: z.string(),
			action: z.enum(["send", "reject"]),
			draft: z.string().max(2000).optional(),
			reason: z.string().max(300).optional(),
		}),
	)
	.handler(({ input }) => reviewRelay(input).catch(fail));

/** Signed quotes waiting on sales to approve a PIC's question, across the business. */
const pendingRelays = os.input(businessInput).handler(({ input }) =>
	getDb()
		.select({
			id: schema.relays.id,
			conversationId: schema.relays.conversationId,
		})
		.from(schema.relays)
		.where(
			and(
				eq(schema.relays.businessId, input.businessId),
				eq(schema.relays.status, "pending"),
			),
		),
);

// --- Notifications ----------------------------------------------------------------------

const listNotifications = os
	.input(businessInput.extend({ staffId: z.string() }))
	.handler(({ input }) =>
		getDb()
			.select()
			.from(schema.notifications)
			.where(
				and(
					eq(schema.notifications.businessId, input.businessId),
					eq(schema.notifications.staffId, input.staffId),
				),
			)
			.orderBy(desc(schema.notifications.createdAt))
			.limit(30),
	);

const readNotifications = os
	.input(z.object({ staffId: z.string(), ids: z.array(z.string()).optional() }))
	.handler(async ({ input }) => {
		await getDb()
			.update(schema.notifications)
			.set({ readAt: new Date() })
			.where(
				and(
					eq(schema.notifications.staffId, input.staffId),
					input.ids?.length
						? inArray(schema.notifications.id, input.ids)
						: undefined,
				),
			);
		return { ok: true };
	});

// --- Default PIC per category ---------------------------------------------------------

const setCategoryPic = os
	.input(
		businessInput.extend({
			category: z.string().min(1),
			staffId: z.string().nullable(),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		await db
			.insert(schema.categorySettings)
			.values({
				businessId: input.businessId,
				category: input.category,
				defaultPicId: input.staffId,
			})
			.onConflictDoUpdate({
				target: [
					schema.categorySettings.businessId,
					schema.categorySettings.category,
				],
				set: { defaultPicId: input.staffId },
			});
		return { ok: true };
	});

// --- Following up unsigned quotes ----------------------------------------------------------

const quoteFollowUps = os
	.input(z.object({ quoteId: z.string() }))
	.handler(({ input }) =>
		getDb()
			.select()
			.from(schema.quoteFollowUps)
			.where(
				and(
					eq(schema.quoteFollowUps.quoteId, input.quoteId),
					ne(schema.quoteFollowUps.status, "cancelled"),
				),
			)
			.orderBy(asc(schema.quoteFollowUps.dueAt)),
	);

const quoteFollowUpAction = os
	.input(
		z.object({
			quoteId: z.string(),
			staffId: z.string(),
			action: z.enum(["pause", "resume", "send_now", "mark_lost"]),
			reason: z
				.enum([
					"price",
					"timing",
					"competitor",
					"not_needed",
					"no_reply",
					"other",
				])
				.optional(),
			note: z.string().max(300).optional(),
		}),
	)
	.handler(({ input }) => followUpAction(input).catch(fail));

const updateFollowUpRules = os
	.input(
		businessInput.extend({
			staffId: z.string(),
			followUpMax: z.number().int().min(0).max(10),
			followUpGapDays: z.number().int().min(1).max(30),
			workStart: z.string().regex(/^\d{2}:\d{2}$/),
			workEnd: z.string().regex(/^\d{2}:\d{2}$/),
			workDays: z.array(z.number().int().min(0).max(6)).min(1),
			extendDays: z.number().int().min(0).max(60),
		}),
	)
	.handler(async ({ input }) => {
		const db = getDb();
		const member = await db.query.staff.findFirst({
			where: and(
				eq(schema.staff.id, input.staffId),
				eq(schema.staff.businessId, input.businessId),
			),
		});
		if (!member?.canApprove)
			fail(
				new Error("Only someone who can approve quotes can change these rules"),
			);
		if (input.workStart >= input.workEnd)
			fail(new Error("Working hours must end after they start"));
		const { businessId, staffId: _s, ...rules } = input;
		await db
			.update(schema.businesses)
			.set(rules)
			.where(eq(schema.businesses.id, businessId));
		await emitOrbyteEvent(db, {
			businessId,
			type: "followup.resumed",
			actor: member?.name ?? "staff",
			summary: `${member?.name ?? "Staff"} updated the follow-up rules`,
			payload: rules,
		});
		return { ok: true };
	});

// --- Billing ------------------------------------------------------------------------------

const instalmentSchema = z.object({
	label: z.string().trim().min(1).max(80),
	percent: z.number().int().positive().max(100),
	when: z.enum(["signed", "phase", "completed"]),
	phase: z.string().nullable().optional(),
});

async function approver(businessId: string, staffId: string) {
	const member = await getDb().query.staff.findFirst({
		where: and(
			eq(schema.staff.id, staffId),
			eq(schema.staff.businessId, businessId),
		),
	});
	if (!member?.canApprove)
		fail(new Error("Only someone who can approve quotes can change this"));
	return member as typeof schema.staff.$inferSelect;
}

/** Everything billed and paid for a job, plus what's still to be invoiced. */
const jobBilling = os
	.input(z.object({ jobId: z.string() }))
	.handler(async ({ input }) => {
		const db = getDb();
		const job = await db.query.jobs.findFirst({
			where: eq(schema.jobs.id, input.jobId),
		});
		if (!job) throw new ORPCError("NOT_FOUND");
		const st = await statementFor(job.quoteId);
		const reminders = st.invoices.length
			? await db
					.select()
					.from(schema.quoteFollowUps)
					.where(
						inArray(
							schema.quoteFollowUps.invoiceId,
							st.invoices.map((i) => i.id),
						),
					)
					.orderBy(asc(schema.quoteFollowUps.dueAt))
			: [];
		const documents = await db
			.select({
				id: schema.messages.id,
				document: schema.messages.document,
				createdAt: schema.messages.createdAt,
			})
			.from(schema.messages)
			.where(
				and(
					eq(schema.messages.conversationId, st.conversation.id),
					sql`${schema.messages.document} is not null`,
				),
			)
			.orderBy(asc(schema.messages.createdAt));
		return {
			quoteNumber: st.quote.number,
			cancelled: st.quote.status === "cancelled",
			totalSen: st.quote.totalSen,
			paidSen: st.paidSen,
			balanceSen: st.balanceSen,
			plan: st.plan.map((p) => {
				const invoice = st.invoices.find((i) => i.instalment === p.index);
				return {
					...p,
					invoice: invoice ?? null,
					payments: invoice
						? st.payments.filter((x) => x.invoiceId === invoice.id)
						: [],
					reminders: invoice
						? reminders.filter((r) => r.invoiceId === invoice.id)
						: [],
				};
			}),
			documents: documents.flatMap((d) =>
				d.document ? [{ ...d.document, at: d.createdAt }] : [],
			),
		};
	});

/** The customer pays from the WhatsApp invoice card (simulated card; no real gateway). */
const payInvoiceInput = os
	.input(z.object({ invoiceId: z.string(), card: z.string().max(40) }))
	.handler(({ input }) => payInvoice(input).catch(fail));

const recordPaymentInput = os
	.input(
		z.object({
			invoiceId: z.string(),
			staffId: z.string(),
			method: z.enum(["bank_transfer", "cash"]),
			reference: z.string().trim().max(80).nullable(),
		}),
	)
	.handler(({ input }) => recordPayment(input).catch(fail));

const invoiceReminder = os
	.input(
		z.object({
			invoiceId: z.string(),
			staffId: z.string(),
			action: z.enum(["pause", "resume", "send_now"]),
		}),
	)
	.handler(({ input }) => reminderAction(input).catch(fail));

const resendStatement = os
	.input(z.object({ jobId: z.string(), staffId: z.string() }))
	.handler(async ({ input }) => {
		const job = await getDb().query.jobs.findFirst({
			where: eq(schema.jobs.id, input.jobId),
		});
		if (!job) throw new ORPCError("NOT_FOUND");
		const member = await getDb().query.staff.findFirst({
			where: and(
				eq(schema.staff.id, input.staffId),
				eq(schema.staff.businessId, job.businessId),
			),
		});
		if (!member) fail(new Error("Staff member not found"));
		await sendStatement(job.id);
		return { ok: true };
	});

const updateBillingRules = os
	.input(
		businessInput.extend({
			staffId: z.string(),
			billing: z.object({
				schedule: z
					.array(instalmentSchema)
					.min(1)
					.max(6)
					.refine(
						(p) => p.reduce((s, x) => s + x.percent, 0) === 100,
						"Payments must add up to 100%",
					),
				dueDays: z.number().int().min(0).max(90),
				statement: z.boolean(),
				completionReport: z.boolean(),
			}),
		}),
	)
	.handler(async ({ input }) => {
		const member = await approver(input.businessId, input.staffId);
		// Business defaults have no phases (those come from a quote's timeline).
		const billing = {
			...input.billing,
			schedule: input.billing.schedule.map((p) => ({
				label: p.label,
				percent: p.percent,
				when: p.when === "phase" ? ("completed" as const) : p.when,
			})),
		};
		const db = getDb();
		await db
			.update(schema.businesses)
			.set({ billing })
			.where(eq(schema.businesses.id, input.businessId));
		await emitOrbyteEvent(db, {
			businessId: input.businessId,
			type: "product.updated",
			actor: member.name,
			summary: `${member.name} updated the billing rules: ${billing.schedule.map((p) => `${p.percent}% ${p.when === "signed" ? "on signing" : "on completion"}`).join(", ")}`,
		});
		return { ok: true };
	});

const suggestBillingRules = os
	.input(businessInput)
	.handler(async ({ input }) => {
		const db = getDb();
		const business = await db.query.businesses.findFirst({
			where: eq(schema.businesses.id, input.businessId),
		});
		if (!business) throw new ORPCError("NOT_FOUND");
		const products = await db
			.select({ name: schema.products.name })
			.from(schema.products)
			.where(eq(schema.products.businessId, business.id));
		const r = await suggestBilling({
			businessName: business.name,
			industry: business.industry,
			products: products.map((p) => p.name),
		}).catch(fail);
		return {
			...r,
			schedule: r.schedule.map((p) => ({
				...p,
				percent: Math.round(p.percent),
			})),
			dueDays: Math.max(0, Math.min(90, Math.round(r.dueDays))),
		};
	});

const billingOverview = os
	.input(businessInput)
	.handler(({ input }) => outstanding(input.businessId));

// --- Company knowledge base --------------------------------------------------------------

const listKnowledge = os
	.input(businessInput)
	.handler(({ input }) => loadKnowledge(input.businessId, "team"));

const saveKnowledge = os
	.input(
		businessInput.extend({
			staffId: z.string(),
			id: z.string().optional(),
			title: z.string().trim().min(1).max(160),
			category: z.string().trim().max(60),
			visibility: z.enum(["internal", "public"]),
			body: z.string().trim().min(1).max(20_000),
		}),
	)
	.handler(({ input }) => saveKnowledgeDoc(input).catch(fail));

const deleteKnowledge = os
	.input(businessInput.extend({ staffId: z.string(), id: z.string() }))
	.handler(({ input }) => deleteKnowledgeDoc(input).catch(fail));

/** What each AI would be given for a question: shows the internal/public boundary. */
const previewKnowledge = os
	.input(businessInput.extend({ query: z.string().trim().min(1).max(500) }))
	.handler(async ({ input }) => {
		const [team, customer] = await Promise.all([
			findKnowledge(input.businessId, "team", input.query),
			findKnowledge(input.businessId, "customer", input.query),
		]);
		return { team, customer };
	});

/** Which AI the server uses, so both interfaces can label replay mode. */
const systemInfo = os.handler(() => ({
	aiMode: aiMode(),
	model: aiModelName(),
}));

/** Demo only: clear one demo business's chats, quotes and jobs (approvers only). */
const demoReset = os
	.input(businessInput.extend({ staffId: z.string() }))
	.handler(async ({ input }) => {
		const member = await getDb().query.staff.findFirst({
			where: and(
				eq(schema.staff.id, input.staffId),
				eq(schema.staff.businessId, input.businessId),
			),
		});
		if (!member?.canApprove)
			fail(new Error("Only an approver can reset the demo"));
		return resetDemoActivity(input.businessId).catch(fail);
	});

/** Demo only: pretend days have passed for one business. */
const demoFastForward = os
	.input(businessInput.extend({ days: z.number().int().min(1).max(30) }))
	.handler(({ input }) =>
		fastForward(input.businessId, input.days).catch(fail),
	);

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
		suggestPriceBuilder,
		savePriceBuilder,
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
	quotes: {
		get: getQuote,
		update: updateQuote,
		decide,
		followUps: quoteFollowUps,
		followUp: quoteFollowUpAction,
	},
	followUpRules: { update: updateFollowUpRules },
	billing: {
		job: jobBilling,
		pay: payInvoiceInput,
		record: recordPaymentInput,
		reminder: invoiceReminder,
		statement: resendStatement,
		rules: { update: updateBillingRules, suggest: suggestBillingRules },
		overview: billingOverview,
	},
	demo: { fastForward: demoFastForward, reset: demoReset },
	system: { info: systemInfo },
	jobs: {
		list: listJobs,
		get: getJob,
		update: updateJobInput,
		retryHandover,
		chat: { post: postJobChat },
		members: { add: addMember, remove: removeMember },
		tasks: { add: addJobTask, update: updateJobTask, delete: deleteJobTask },
	},
	relays: {
		create: createRelay,
		review: reviewRelayInput,
		pending: pendingRelays,
	},
	notifications: { list: listNotifications, read: readNotifications },
	categories: { setPic: setCategoryPic },
	knowledge: {
		list: listKnowledge,
		save: saveKnowledge,
		delete: deleteKnowledge,
		preview: previewKnowledge,
	},
	activity: { list: listActivity },
};
