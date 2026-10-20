/**
 * Resets the database to the synthetic demo data.
 * Run with: pnpm db:seed
 */
import { demoBusinesses } from "../data/demo";
import { getDb, schema } from "./index";

async function main() {
	const db = getDb();

	await db.transaction(async (tx) => {
		// Deleting businesses cascades to everything else.
		await tx.delete(schema.businesses);

		for (const b of demoBusinesses) {
			await tx.insert(schema.businesses).values({
				id: b.id,
				name: b.name,
				quotePrefix: b.quotePrefix,
				industry: b.industry,
				tagline: b.tagline,
				phone: b.phone,
				address: b.address,
				sstRateBps: b.sstRateBps,
				quoteValidityDays: b.quoteValidityDays,
			});
			await tx
				.insert(schema.staff)
				.values(b.staff.map((s) => ({ ...s, businessId: b.id })));
			await tx
				.insert(schema.products)
				.values(b.products.map((p) => ({ ...p, businessId: b.id })));
			await tx
				.insert(schema.pricingRules)
				.values(b.rules.map((r) => ({ ...r, businessId: b.id })));
		}
	});

	console.log(`Seeded ${demoBusinesses.length} demo businesses.`);
	await getDb().$client.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
