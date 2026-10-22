/**
 * Simulated Orbyte workflow hooks. In production these would publish to the
 * Orbyte event bus; for the demo they write activity records to our database.
 */
import type { Database } from "#/db";
import { schema } from "#/db";

export type OrbyteEventType =
	| "quote.request.received"
	| "quote.request.parsed"
	| "quote.request.clarification_requested"
	| "quote.request.confirmation_requested"
	| "quote.request.confirmed"
	| "quote.brief.edited"
	| "quote.draft.outdated"
	| "quote.revision.requested"
	| "quote.superseded"
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
	| "job.created"
	| "job.handover_ready"
	| "job.assigned"
	| "job.status_changed"
	| "job.task_added"
	| "job.agreement_changed"
	| "job.agreement_reviewed"
	| "relay.requested"
	| "relay.sent"
	| "relay.rejected"
	| "relay.answered"
	| "followup.scheduled"
	| "followup.sent"
	| "followup.paused"
	| "followup.resumed"
	| "quote.extended"
	| "quote.lost"
	| "stock.reserved"
	| "stock.adjusted";

export async function emitOrbyteEvent(
	db: Database,
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
