import { eq } from "drizzle-orm";
import { type Database, schema } from "#/db";

/** Find the signed agreement behind any unsent/unaccepted intermediate revisions. */
export async function deliveryBaseline(
	db: Database,
	quote: { supersedesId: string | null },
) {
	let id = quote.supersedesId;
	const seen = new Set<string>();
	let signed: typeof schema.quotes.$inferSelect | null = null;
	while (id) {
		if (seen.has(id) || seen.size >= 50)
			throw new Error("Quotation revision history is invalid");
		seen.add(id);
		const prior = await db.query.quotes.findFirst({
			where: eq(schema.quotes.id, id),
		});
		if (!prior) throw new Error("Previous quotation not found");
		const job = await db.query.jobs.findFirst({
			where: eq(schema.jobs.quoteId, prior.id),
		});
		if (!signed && prior.signedAt) signed = prior;
		if (job) return { quote: signed ?? prior, job };
		id = prior.supersedesId;
	}
	return signed ? { quote: signed, job: undefined } : null;
}
