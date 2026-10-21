/**
 * Simulated Orbyte workflow hooks. In production these would publish to the
 * Orbyte event bus; for the demo they write activity records to our database.
 */
import type { getDb } from "#/db";
import { schema } from "#/db";

type Db = ReturnType<typeof getDb>;

export type OrbyteEventType =
	| "quote.request.received"
	| "quote.request.parsed"
	| "quote.request.clarification_requested"
	| "quote.request.flagged_for_review"
	| "quote.draft.prepared"
	| "quote.draft.edited"
	| "quote.approved"
	| "quote.rejected"
	| "quote.sent_to_customer"
	| "quote.processing_failed"
	| "quote.accepted"
	| "chat.taken_over"
	| "chat.handed_back"
	| "chat.staff_replied"
	| "chat.message_held"
	| "esign.sent"
	| "esign.viewed"
	| "esign.signed"
	| "product.created"
	| "product.updated"
	| "stock.reserved"
	| "stock.adjusted";

export async function emitOrbyteEvent(
	db: Db,
	event: {
		businessId: string;
		requestId?: string | null;
		type: OrbyteEventType;
		actor: string;
		summary: string;
		payload?: Record<string, unknown>;
	},
) {
	const [row] = await db
		.insert(schema.activityEvents)
		.values({ ...event, requestId: event.requestId ?? null })
		.returning();
	return row;
}
