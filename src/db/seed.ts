/**
 * Resets the database to the synthetic demo data.
 * Run with: pnpm db:seed
 */
import { demoPriceLists } from "#/data/demo-price-lists";
import { type DemoQuestion, demoBusinesses } from "../data/demo";
import { demoKnowledge } from "../data/demo-knowledge";
import { getDb, schema } from "./index";

/** A demo question as a database row, keeping the listed order. */
function questionRows(
	businessId: string,
	target:
		| { scope: "business" }
		| { scope: "category"; category: string }
		| { scope: "product"; productId: string },
	questions: DemoQuestion[],
) {
	return questions.map((q, position) => ({
		businessId,
		scope: target.scope,
		category: target.scope === "category" ? target.category : null,
		productId: target.scope === "product" ? target.productId : null,
		key: q.key,
		label: q.label,
		type: q.type,
		options: q.type === "yes_no" ? ["yes", "no"] : (q.options ?? []),
		required: q.required ?? true,
		position,
		hint: q.hint ?? null,
		showIf: q.showIf ?? null,
		onQuote: q.onQuote ?? (q.type === "single" || q.type === "multi"),
	}));
}

async function main() {
	const db = getDb();

	await db.transaction(async (tx) => {
		// Deleting businesses cascades to everything else, except the background task
		// queue (it has no foreign keys), so clear that too.
		await tx.delete(schema.workflowTasks);
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
				openingHours: b.openingHours,
				sstRateBps: b.sstRateBps,
				quoteValidityDays: b.quoteValidityDays,
				billing: b.billing,
			});
			const staff = await tx
				.insert(schema.staff)
				.values(b.staff.map((s) => ({ ...s, businessId: b.id })))
				.returning();
			await tx.insert(schema.products).values(
				b.products.map(({ questions: _q, restockInDays, ...p }) => ({
					...p,
					businessId: b.id,
					priceBuilder: demoPriceLists[p.id] ?? null,
					restockDate:
						restockInDays === undefined
							? null
							: new Date(
									Date.now() + restockInDays * 86_400_000,
								).toLocaleDateString("en-CA", {
									timeZone: "Asia/Kuala_Lumpur",
								}),
				})),
			);
			const questions = [
				...questionRows(b.id, { scope: "business" }, b.businessQuestions),
				...Object.entries(b.categoryQuestions).flatMap(([category, qs]) =>
					questionRows(b.id, { scope: "category", category }, qs),
				),
				...b.products.flatMap((p) =>
					questionRows(
						b.id,
						{ scope: "product", productId: p.id },
						p.questions ?? [],
					),
				),
			];
			if (questions.length)
				await tx.insert(schema.intakeQuestions).values(questions);
			const pics = Object.entries(b.categoryPics).map(([category, name]) => {
				const pic = staff.find((s) => s.name === name);
				if (!pic) throw new Error(`${b.id}: no staff named ${name}`);
				return { businessId: b.id, category, defaultPicId: pic.id };
			});
			if (pics.length) await tx.insert(schema.categorySettings).values(pics);
			await tx
				.insert(schema.pricingRules)
				.values(b.rules.map((r) => ({ ...r, businessId: b.id })));
			const docs = demoKnowledge[b.id] ?? [];
			if (docs.length)
				await tx.insert(schema.knowledgeDocs).values(
					docs.map((d) => ({
						...d,
						businessId: b.id,
						updatedBy: b.staff.find((s) => s.canApprove)?.name ?? null,
					})),
				);
		}
	});

	console.log(`Seeded ${demoBusinesses.length} demo businesses.`);
	await getDb().$client.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
