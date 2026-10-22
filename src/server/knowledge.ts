/**
 * The company knowledge base. Which AI may read what is decided here, in code:
 * the team AI reads internal and public docs; the customer-facing AI only ever
 * receives public docs, so internal content can't leak through a crafted message.
 */
import { and, asc, eq } from "drizzle-orm";
import { type Database, getDb, schema } from "#/db";
import { type Passage, searchKnowledge } from "#/lib/knowledge";
import { emitOrbyteEvent } from "./orbyte";

export type Audience = "team" | "customer";

/** The docs an audience is allowed to see. */
export async function loadKnowledge(
	businessId: string,
	audience: Audience,
	db: Database = getDb(),
) {
	return db
		.select()
		.from(schema.knowledgeDocs)
		.where(
			and(
				eq(schema.knowledgeDocs.businessId, businessId),
				audience === "customer"
					? eq(schema.knowledgeDocs.visibility, "public")
					: undefined,
			),
		)
		.orderBy(
			asc(schema.knowledgeDocs.category),
			asc(schema.knowledgeDocs.title),
		);
}

/** The passages an audience's AI gets for this question. */
export async function findKnowledge(
	businessId: string,
	audience: Audience,
	query: string,
	limit = 4,
): Promise<Passage[]> {
	return searchKnowledge(
		await loadKnowledge(businessId, audience),
		query,
		limit,
	);
}

async function approver(businessId: string, staffId: string) {
	const member = await getDb().query.staff.findFirst({
		where: and(
			eq(schema.staff.id, staffId),
			eq(schema.staff.businessId, businessId),
		),
	});
	if (!member) throw new Error("Staff member not found for this business");
	if (!member.canApprove)
		throw new Error("Only an approver can change the knowledge base");
	return member;
}

export async function saveKnowledgeDoc(input: {
	businessId: string;
	staffId: string;
	id?: string;
	title: string;
	category: string;
	visibility: "internal" | "public";
	body: string;
}) {
	const member = await approver(input.businessId, input.staffId);
	const db = getDb();
	const values = {
		title: input.title.trim(),
		category: input.category.trim() || "General",
		visibility: input.visibility,
		body: input.body.trim(),
		updatedBy: member.name,
		updatedAt: new Date(),
	};
	if (!values.title || !values.body)
		throw new Error("Add a title and the content");
	const [row] = input.id
		? await db
				.update(schema.knowledgeDocs)
				.set(values)
				.where(
					and(
						eq(schema.knowledgeDocs.id, input.id),
						eq(schema.knowledgeDocs.businessId, input.businessId),
					),
				)
				.returning()
		: await db
				.insert(schema.knowledgeDocs)
				.values({ businessId: input.businessId, ...values })
				.returning();
	if (!row) throw new Error("Document not found");
	await emitOrbyteEvent(db, {
		businessId: input.businessId,
		type: input.id ? "knowledge.updated" : "knowledge.created",
		actor: member.name,
		summary: `${member.name} ${input.id ? "updated" : "added"} "${row.title}" (${row.visibility})`,
	});
	return row;
}

export async function deleteKnowledgeDoc(input: {
	businessId: string;
	staffId: string;
	id: string;
}) {
	const member = await approver(input.businessId, input.staffId);
	const db = getDb();
	const [row] = await db
		.delete(schema.knowledgeDocs)
		.where(
			and(
				eq(schema.knowledgeDocs.id, input.id),
				eq(schema.knowledgeDocs.businessId, input.businessId),
			),
		)
		.returning();
	if (!row) throw new Error("Document not found");
	await emitOrbyteEvent(db, {
		businessId: input.businessId,
		type: "knowledge.deleted",
		actor: member.name,
		summary: `${member.name} removed "${row.title}"`,
	});
	return { ok: true };
}
