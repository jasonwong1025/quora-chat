import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/db/index";
import { emptyBrief } from "../src/lib/intake";
import { createRequest } from "../src/server/requirements";
import { draftNow, editBrief } from "../src/server/workflow";

if (process.env.QUORA_ISOLATED_DB_TEST !== "1")
	throw new Error("UI fixtures require the isolated test database");
const db = getDb();
try {
	const businessId = "agreement-preview";
	await db.insert(schema.businesses).values({
		id: businessId,
		name: "Kodkraf Agreement Preview",
		quotePrefix: "QA",
		industry: "Software",
	});
	const [staff] = await db
		.insert(schema.staff)
		.values({
			businessId,
			name: "Sales owner",
			role: "Owner",
			canApprove: true,
		})
		.returning();
	await db.insert(schema.products).values({
		id: "preview-system",
		businessId,
		sku: "SYSTEM",
		name: "Custom system",
		description: "Business software project",
		category: "Systems",
		unit: "job",
		unitPriceSen: 50000,
		pricingMode: "custom",
	});
	await db.insert(schema.intakeQuestions).values({
		businessId,
		scope: "product",
		productId: "preview-system",
		key: "users",
		label: "How many staff will use it?",
		type: "number",
		required: true,
	});
	const [chat] = await db
		.insert(schema.conversations)
		.values({ id: "preview-chat", businessId, customerName: "Preview client" })
		.returning();
	const [message] = await db
		.insert(schema.messages)
		.values({
			conversationId: chat.id,
			sender: "customer",
			body: "We need a system for 50 staff",
		})
		.returning();
	const brief = {
		...emptyBrief(),
		summary: "Business system for 50 staff",
		items: [
			{
				id: "item",
				productId: "preview-system",
				match: "exact" as const,
				candidateProductIds: [],
				rawText: "Custom system",
				quantity: 1,
				answers: {
					users: {
						values: ["50"],
						source: "customer" as const,
						messageId: message.id,
						at: new Date().toISOString(),
					},
				},
			},
		],
	};
	const request = await createRequest({
		id: "preview-request",
		businessId,
		conversationId: chat.id,
		status: "gathering",
		brief,
		processedMessageId: message.id,
	});
	await draftNow({ requestId: request.id, staffId: staff.id });
	await editBrief({
		requestId: request.id,
		staffId: staff.id,
		expectedVersion: 1,
		edit: { kind: "clear", itemId: "item", key: "users" },
	});
	const revisedBrief = structuredClone(brief);
	revisedBrief.items[0].answers.users.values = ["100"];
	revisedBrief.summary = "Business system for 100 staff";
	revisedBrief.general.office = {
		values: ["办公室"],
		source: "customer",
		label: "Office",
		at: new Date().toISOString(),
	};
	const [acceptedRequest] = await db
		.insert(schema.quoteRequests)
		.values({
			id: "signed-request",
			businessId,
			conversationId: chat.id,
			status: "approved",
			brief: revisedBrief,
			processedMessageId: message.id,
		})
		.returning();
	const [quote] = await db
		.insert(schema.quotes)
		.values({
			id: "signed-quote",
			number: "QA-Q-0002-R2",
			revision: 2,
			businessId,
			requestId: acceptedRequest.id,
			status: "accepted",
			requirementsSnapshot: revisedBrief,
			requirementVersion: 1,
			lineItems: [
				{
					productId: "preview-system",
					description: "Custom system",
					quantity: 1,
					unit: "job",
					unitPriceSen: 50000,
					amountSen: 50000,
				},
			],
			subtotalSen: 50000,
			sstSen: 0,
			totalSen: 50000,
			signedAt: new Date(),
			validUntil: new Date(Date.now() + 86400000),
		})
		.returning();
	const [client] = await db
		.insert(schema.clients)
		.values({ businessId, name: "Preview client" })
		.returning();
	await db.insert(schema.jobs).values({
		id: "preview-job",
		number: "QA-PRJ-0001",
		businessId,
		clientId: client.id,
		requestId: acceptedRequest.id,
		quoteId: quote.id,
		conversationId: chat.id,
		kind: "project",
		title: "Revised software project",
		status: "upcoming",
		picId: staff.id,
		agreementReviewRequired: true,
		handover: {
			summary: "The customer signed a revised system scope.",
			scope: ["Support 100 staff"],
			requirements: [{ label: "Staff", value: "100" }],
			promises: [],
			timeline: null,
			watchOuts: ["Review retained tasks"],
			customerNotes: null,
			suggestedTasks: ["Review access requirements"],
		},
	});
	await db.insert(schema.jobTasks).values([
		{ jobId: "preview-job", title: "Completed discovery", status: "done" },
		{
			jobId: "preview-job",
			title: "Review access requirements",
			status: "blocked",
			note: "Review the revised agreement",
		},
	]);
	await db.delete(schema.businesses).where(eq(schema.businesses.id, "legacy"));
} finally {
	await db.$client.end();
}
