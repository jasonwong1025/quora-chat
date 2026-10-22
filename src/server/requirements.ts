import { eq } from "drizzle-orm";
import { getDb, schema } from "#/db";
import type { Brief } from "#/db/schema";
import { agreementContent } from "#/lib/agreements";
import {
	businessQuestions,
	type IntakeProduct,
	type Question,
	questionsFor,
} from "#/lib/intake";

type Values = Partial<typeof schema.quoteRequests.$inferInsert>;

/** Serialize brief edits and reject results computed from an older version. */
export async function saveRequest(
	id: string,
	values: Values,
	expectedVersion?: number,
	actor = "quora-chat",
	reason = "Updated customer requirements",
	expectedStatus?: string,
) {
	return getDb().transaction(async (tx) => {
		const [current] = await tx
			.select()
			.from(schema.quoteRequests)
			.where(eq(schema.quoteRequests.id, id))
			.for("update");
		if (!current) throw new Error("Request not found");
		if (
			expectedVersion !== undefined &&
			current.briefVersion !== expectedVersion
		) {
			throw new Error(
				"Requirements changed while this action was running. Refresh and try again.",
			);
		}
		if (expectedStatus !== undefined && current.status !== expectedStatus)
			throw new Error(
				"The request stage changed while this action was running. Refresh and try again.",
			);
		if (
			["approved", "rejected"].includes(current.status) &&
			values.status &&
			values.status !== current.status &&
			!values.brief?.revisionOf
		)
			throw new Error("This request is closed; prepare a separate revision.");
		await tx
			.insert(schema.requirementVersions)
			.values({
				requestId: id,
				version: current.briefVersion,
				brief: current.brief,
				actor: "import",
				reason: "Initial captured requirements",
			})
			.onConflictDoNothing();
		const changed =
			values.brief &&
			agreementContent(values.brief) !== agreementContent(current.brief);
		const version = current.briefVersion + (changed ? 1 : 0);
		const [row] = await tx
			.update(schema.quoteRequests)
			.set({ ...values, briefVersion: version, updatedAt: new Date() })
			.where(eq(schema.quoteRequests.id, id))
			.returning();
		if (changed) {
			await tx
				.insert(schema.requirementVersions)
				.values({ requestId: id, version, brief: row.brief, actor, reason });
			await tx.insert(schema.activityEvents).values({
				businessId: row.businessId,
				requestId: id,
				type: "quote.brief.versioned",
				actor,
				summary: `Requirements updated to version ${version}: ${reason}`,
			});
		}
		return row;
	});
}

export async function createRequest(
	values: typeof schema.quoteRequests.$inferInsert,
	actor = "quora-chat",
) {
	return getDb().transaction(async (tx) => {
		const [request] = await tx
			.insert(schema.quoteRequests)
			.values(values)
			.returning();
		await tx.insert(schema.requirementVersions).values({
			requestId: request.id,
			version: request.briefVersion,
			brief: request.brief,
			actor,
			reason: "Initial captured requirements",
		});
		return request;
	});
}

export function snapshotBrief(
	brief: Brief,
	products: IntakeProduct[] = [],
	questions: Question[] = [],
): Brief {
	const snapshot = structuredClone(brief);
	for (const item of snapshot.items) {
		const product = products.find((p) => p.id === item.productId);
		if (product) item.productName = product.name;
		for (const q of product ? questionsFor(product, questions) : []) {
			if (item.answers[q.key]) item.answers[q.key].label = q.label;
		}
	}
	for (const q of businessQuestions(questions))
		if (snapshot.general[q.key]) snapshot.general[q.key].label = q.label;
	return snapshot;
}
