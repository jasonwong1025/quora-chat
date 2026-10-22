/**
 * Resets one demo business's activity so the flagship scenario can be run again.
 * Only for the synthetic demo businesses; never touches any other business.
 *
 * Cleared: chats, messages, requests, quotations, reminders, jobs and their team
 * chats, relayed questions, clients, notifications, activity and background tasks.
 * Kept: the business, staff, catalog, pricing rules, preset questions, default
 * PICs, follow-up rules and knowledge base. Stock tied up by cleared quotes is
 * returned.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { getDemoBusiness } from "#/data/demo";
import { getDb, schema } from "#/db";

export async function resetDemoActivity(businessId: string) {
	if (!getDemoBusiness(businessId))
		throw new Error("Only the synthetic demo businesses can be reset");
	return getDb().transaction(async (db) => {
		// One reset (or workflow step) at a time for this business.
		await db
			.select({ id: schema.businesses.id })
			.from(schema.businesses)
			.where(eq(schema.businesses.id, businessId))
			.for("update");
		const quoteIds = (
			await db
				.select({ id: schema.quotes.id })
				.from(schema.quotes)
				.where(eq(schema.quotes.businessId, businessId))
		).map((q) => q.id);
		const jobIds = (
			await db
				.select({ id: schema.jobs.id })
				.from(schema.jobs)
				.where(eq(schema.jobs.businessId, businessId))
		).map((j) => j.id);

		// Give back stock the cleared quotes reserved or delivered.
		if (quoteIds.length) {
			const reservations = await db
				.select()
				.from(schema.stockReservations)
				.where(inArray(schema.stockReservations.quoteId, quoteIds));
			for (const r of reservations)
				await db
					.update(schema.products)
					.set(
						r.deliveredAt
							? {
									stockOnHand: sql`${schema.products.stockOnHand} + ${r.quantity}`,
								}
							: {
									stockReserved: sql`greatest(${schema.products.stockReserved} - ${r.quantity}, 0)`,
								},
					)
					.where(eq(schema.products.id, r.productId));
		}
		const ids = [...quoteIds, ...jobIds];
		if (ids.length)
			await db
				.delete(schema.workflowTasks)
				.where(inArray(schema.workflowTasks.entityId, ids));

		// Conversations cascade to messages, requests, quotes, reminders, AI runs,
		// jobs, tasks, team chats, members and relays.
		const conversations = await db
			.delete(schema.conversations)
			.where(eq(schema.conversations.businessId, businessId))
			.returning({ id: schema.conversations.id });
		await db
			.delete(schema.clients)
			.where(eq(schema.clients.businessId, businessId));
		await db
			.delete(schema.notifications)
			.where(eq(schema.notifications.businessId, businessId));
		await db
			.delete(schema.activityEvents)
			.where(eq(schema.activityEvents.businessId, businessId));
		return {
			conversations: conversations.length,
			quotes: quoteIds.length,
			jobs: jobIds.length,
		};
	});
}
