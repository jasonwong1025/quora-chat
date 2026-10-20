import { ORPCError, os } from "@orpc/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDemoBusiness } from "#/data/demo";
import { getDb, schema } from "#/db";
import {
	decideQuote,
	editDraftQuote,
	handleCustomerMessage,
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
	const [products, rules, staff] = await Promise.all([
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
		return { ...conversation, messages };
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

export default {
	businesses: { list: listBusinesses, get: getBusiness },
	conversations: {
		list: listConversations,
		create: createConversation,
		get: getConversation,
		send: sendMessage,
	},
	requests: { list: listRequests },
	quotes: { get: getQuote, update: updateQuote, decide },
	activity: { list: listActivity },
};
