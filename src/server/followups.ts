/**
 * Following up on sent-but-unsigned quotes. The AI suggests when to nudge and
 * writes the message; code enforces the business's limits (how many, how far
 * apart, working hours, never after expiry) and logs every step.
 */
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "#/db";
import type { Language, LostReason } from "#/db/schema";
import { answerText } from "#/lib/intake";
import { planFollowUpTiming, writeFollowUp } from "./ai";
import { notify } from "./jobs";
import { emitOrbyteEvent } from "./orbyte";

type Business = typeof schema.businesses.$inferSelect;
type Quote = typeof schema.quotes.$inferSelect;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MY = 8 * HOUR; // Malaysia is UTC+8 all year

// --- Malaysia working hours --------------------------------------------------------------

const minutesOf = (hm: string) => {
	const [h, m] = hm.split(":").map(Number);
	return (h || 0) * 60 + (m || 0);
};

/** The next moment inside the business's working hours (Malaysia time). */
export function intoWorkingHours(when: Date, b: Business) {
	const start = minutesOf(b.workStart);
	const end = minutesOf(b.workEnd);
	let t = when.getTime();
	for (let i = 0; i < 14; i++) {
		const local = new Date(t + MY); // UTC fields now read as Malaysia time
		const day = local.getUTCDay();
		const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
		const workday = b.workDays.includes(day);
		if (workday && minutes >= start && minutes < end) return new Date(t);
		const midnight = Date.UTC(
			local.getUTCFullYear(),
			local.getUTCMonth(),
			local.getUTCDate(),
		);
		const sameDay = workday && minutes < start;
		t = (sameDay ? midnight : midnight + DAY) + start * 60_000 - MY;
	}
	return new Date(t);
}

/** "Thu 23 Oct, 10:00 AM" in Malaysia time. */
export function myTime(d: Date) {
	return d.toLocaleString("en-MY", {
		timeZone: "Asia/Kuala_Lumpur",
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "numeric",
		minute: "2-digit",
	});
}

export function myDate(d: Date) {
	return d.toLocaleDateString("en-MY", {
		timeZone: "Asia/Kuala_Lumpur",
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

export function todayMY() {
	return new Date(Date.now() + MY).toISOString().slice(0, 10);
}

// --- Loading ---------------------------------------------------------------------------------

async function loadQuoteContext(quoteId: string) {
	const db = getDb();
	const quote = await db.query.quotes.findFirst({
		where: eq(schema.quotes.id, quoteId),
	});
	if (!quote) return null;
	const [business, request] = await Promise.all([
		db.query.businesses.findFirst({
			where: eq(schema.businesses.id, quote.businessId),
		}),
		db.query.quoteRequests.findFirst({
			where: eq(schema.quoteRequests.id, quote.requestId),
		}),
	]);
	if (!business || !request) return null;
	const conversation = await db.query.conversations.findFirst({
		where: eq(schema.conversations.id, request.conversationId),
	});
	if (!conversation) return null;
	return { quote, business, request, conversation };
}

async function cancelScheduled(quoteId: string) {
	await getDb()
		.update(schema.quoteFollowUps)
		.set({ status: "cancelled" })
		.where(
			and(
				eq(schema.quoteFollowUps.quoteId, quoteId),
				eq(schema.quoteFollowUps.status, "scheduled"),
			),
		);
}

async function recentChat(conversationId: string) {
	const rows = await getDb().query.messages.findMany({
		where: eq(schema.messages.conversationId, conversationId),
		orderBy: desc(schema.messages.createdAt),
		columns: { attachmentData: false },
		limit: 8,
	});
	return rows.reverse().map((m) => ({
		sender: m.sender,
		body: m.body,
		attachment: m.attachment,
	}));
}

/** The customer's own deadline, if the brief has one. */
function customerDeadline(
	request: typeof schema.quoteRequests.$inferSelect,
): string | null {
	const keys = [
		"needed_by",
		"deadline",
		"go_live",
		"start_month",
		"preferred_date",
	];
	const all = [
		request.brief.general,
		...request.brief.items.map((i) => i.answers),
	];
	for (const answers of all)
		for (const k of keys) {
			const a = answers[k];
			if (a && a.source !== "skipped") return answerText(a);
		}
	return null;
}

// --- Planning the next reminder ----------------------------------------------------------------

/**
 * Works out when to nudge next. Call after the quote is sent, opened, or the
 * customer writes. Replaces any reminder already scheduled.
 */
export async function planNextFollowUp(quoteId: string) {
	const db = getDb();
	const ctx = await loadQuoteContext(quoteId);
	if (!ctx) return null;
	const { quote, business, request, conversation } = ctx;
	await cancelScheduled(quote.id);
	// Only sent, unsigned quotes that aren't paused or being revised.
	if (
		quote.status !== "approved" ||
		quote.followUpsPaused ||
		request.status !== "approved"
	)
		return null;

	const sent = await db
		.select()
		.from(schema.quoteFollowUps)
		.where(
			and(
				eq(schema.quoteFollowUps.quoteId, quote.id),
				eq(schema.quoteFollowUps.status, "sent"),
			),
		)
		.orderBy(desc(schema.quoteFollowUps.sentAt));
	const reminders = sent.filter((f) => f.kind === "reminder").length;
	if (reminders >= business.followUpMax) return null;

	const now = new Date();
	const sentAt = quote.decidedAt ?? quote.createdAt;
	const lastOutbound = new Date(
		Math.max(sentAt.getTime(), sent[0]?.sentAt?.getTime() ?? 0),
	);
	const ai = await planFollowUpTiming({
		businessName: business.name,
		hoursSinceSent: (now.getTime() - sentAt.getTime()) / HOUR,
		opened: Boolean(quote.viewedAt),
		hoursSinceOpened: quote.viewedAt
			? (now.getTime() - quote.viewedAt.getTime()) / HOUR
			: null,
		remindersSent: reminders,
		maxReminders: business.followUpMax,
		hoursUntilExpiry: (quote.validUntil.getTime() - now.getTime()) / HOUR,
		customerDeadline: customerDeadline(request),
		recentChat: await recentChat(conversation.id),
		now: myTime(now),
	}).catch(() => ({
		waitHours: reminders === 0 ? 24 : 48,
		reason: "Default timing (the AI was unavailable).",
	}));

	// The AI suggests; the business's rules decide.
	const notes: string[] = [];
	let due = new Date(
		now.getTime() + Math.min(Math.max(ai.waitHours, 1), 24 * 30) * HOUR,
	);
	const earliest = new Date(
		lastOutbound.getTime() + business.followUpGapDays * DAY,
	);
	if (due < earliest) {
		due = earliest;
		notes.push(`kept ${business.followUpGapDays} days after the last message`);
	}
	if (quote.pausedUntil && due < quote.pausedUntil) {
		due = quote.pausedUntil;
		notes.push(
			`waiting until ${myDate(quote.pausedUntil)} as the customer asked`,
		);
	}
	const inHours = intoWorkingHours(due, business);
	if (inHours.getTime() !== due.getTime())
		notes.push("moved into working hours");
	due = inHours;
	if (due >= quote.validUntil) {
		await emitOrbyteEvent(db, {
			businessId: business.id,
			requestId: request.id,
			type: "followup.scheduled",
			actor: "quora-chat",
			summary: `No more reminders for ${quote.number} before it expires on ${myDate(quote.validUntil)}`,
		});
		return null;
	}

	const reason = `${ai.reason}${notes.length ? ` (${notes.join("; ")})` : ""}`;
	const [row] = await db
		.insert(schema.quoteFollowUps)
		.values({
			businessId: business.id,
			quoteId: quote.id,
			conversationId: conversation.id,
			dueAt: due,
			reason,
		})
		.returning();
	await emitOrbyteEvent(db, {
		businessId: business.id,
		requestId: request.id,
		type: "followup.scheduled",
		actor: "quora-chat",
		summary: `Follow-up ${reminders + 1}/${business.followUpMax} for ${quote.number} set for ${myTime(due)}: ${reason}`,
	});
	return row;
}

// --- Sending ---------------------------------------------------------------------------------

function whatWasQuoted(quote: Quote) {
	const first = quote.lineItems[0]?.description ?? "your order";
	return quote.lineItems.length > 1
		? `${first} and ${quote.lineItems.length - 1} more`
		: first;
}

function fallbackFollowUp(language: Language, number: string) {
	return language === "ms"
		? `Hi, sekadar mengingatkan sebut harga ${number} masih menunggu semakan anda. Ada soalan, beritahu je ya.`
		: language === "zh"
			? `您好，提醒一下报价单 ${number} 还在等您查看，有任何问题随时告诉我们。`
			: `Hi, just checking in on quotation ${number}. Any questions, just let us know here.`;
}

async function sendReminder(followUpId: string, byStaff?: string) {
	const db = getDb();
	const fu = await db.query.quoteFollowUps.findFirst({
		where: eq(schema.quoteFollowUps.id, followUpId),
	});
	if (!fu || fu.status !== "scheduled") return null;
	const ctx = await loadQuoteContext(fu.quoteId);
	if (!ctx) return null;
	const { quote, business, request, conversation } = ctx;
	if (
		quote.status !== "approved" ||
		request.status !== "approved" ||
		(quote.followUpsPaused && !byStaff)
	) {
		await cancelScheduled(quote.id);
		return null;
	}
	const sentBefore = await db
		.select({ id: schema.quoteFollowUps.id })
		.from(schema.quoteFollowUps)
		.where(
			and(
				eq(schema.quoteFollowUps.quoteId, quote.id),
				eq(schema.quoteFollowUps.status, "sent"),
				eq(schema.quoteFollowUps.kind, "reminder"),
			),
		);
	const number = sentBefore.length + 1;
	const body =
		(await writeFollowUp({
			businessName: business.name,
			customerName: conversation.customerName,
			language: request.brief.language,
			quoteNumber: quote.number,
			what: whatWasQuoted(quote),
			opened: Boolean(quote.viewedAt),
			reminderNumber: number,
			final:
				number >= business.followUpMax ||
				quote.validUntil.getTime() - Date.now() < 2 * DAY,
			extendedUntil: null,
			recentChat: await recentChat(conversation.id),
		}).catch(() => "")) ||
		fallbackFollowUp(request.brief.language, quote.number);

	const [message] = await db
		.insert(schema.messages)
		.values({ conversationId: conversation.id, sender: "assistant", body })
		.returning();
	await db
		.update(schema.quoteFollowUps)
		.set({
			status: "sent",
			body,
			messageId: message.id,
			sentAt: message.createdAt,
		})
		.where(eq(schema.quoteFollowUps.id, fu.id));
	await emitOrbyteEvent(db, {
		businessId: business.id,
		requestId: request.id,
		type: "followup.sent",
		actor: byStaff ?? "quora-chat",
		summary: `Follow-up ${number} sent for ${quote.number}${byStaff ? ` (sent now by ${byStaff})` : ""}`,
		payload: { body },
	});
	await planNextFollowUp(quote.id);
	return message;
}

/** Quote ran out: extend once with a friendly note, after that it's lost. */
async function handleExpiry(quote: Quote) {
	const db = getDb();
	const ctx = await loadQuoteContext(quote.id);
	if (!ctx) return;
	const { business, request, conversation } = ctx;
	if (request.status !== "approved") return; // being revised

	if (!quote.extendedAt) {
		const validUntil = new Date(
			quote.validUntil.getTime() + business.extendDays * DAY,
		);
		await db
			.update(schema.quotes)
			.set({ validUntil, extendedAt: new Date() })
			.where(eq(schema.quotes.id, quote.id));
		const body =
			(await writeFollowUp({
				businessName: business.name,
				customerName: conversation.customerName,
				language: request.brief.language,
				quoteNumber: quote.number,
				what: whatWasQuoted(quote),
				opened: Boolean(quote.viewedAt),
				reminderNumber: 0,
				final: false,
				extendedUntil: myDate(validUntil),
				recentChat: await recentChat(conversation.id),
			}).catch(() => "")) ||
			`Hi, quotation ${quote.number} has been extended until ${myDate(validUntil)}. Any questions, just let us know.`;
		const [message] = await db
			.insert(schema.messages)
			.values({ conversationId: conversation.id, sender: "assistant", body })
			.returning();
		await db.insert(schema.quoteFollowUps).values({
			businessId: business.id,
			quoteId: quote.id,
			conversationId: conversation.id,
			kind: "extension",
			status: "sent",
			dueAt: message.createdAt,
			sentAt: message.createdAt,
			messageId: message.id,
			body,
			reason: `Validity ran out; extended once by ${business.extendDays} days`,
		});
		await emitOrbyteEvent(db, {
			businessId: business.id,
			requestId: request.id,
			type: "quote.extended",
			actor: "quora-chat",
			summary: `${quote.number} expired unsigned; extended once until ${myDate(validUntil)}`,
		});
		await planNextFollowUp(quote.id);
		return;
	}
	await markLost({
		quoteId: quote.id,
		reason: "no_reply",
		note: "Expired after one extension with no signature",
		actor: "quora-chat",
	});
}

export async function markLost(input: {
	quoteId: string;
	reason: LostReason;
	note?: string | null;
	actor: string;
}) {
	const db = getDb();
	const ctx = await loadQuoteContext(input.quoteId);
	if (!ctx) throw new Error("Quote not found");
	const { quote, business, request } = ctx;
	if (quote.status !== "approved")
		throw new Error("Only a sent, unsigned quote can be marked lost");
	await cancelScheduled(quote.id);
	const [row] = await db
		.update(schema.quotes)
		.set({
			status: "lost",
			lostReason: input.reason,
			lostNote: input.note ?? null,
			lostAt: new Date(),
		})
		.where(eq(schema.quotes.id, quote.id))
		.returning();
	await emitOrbyteEvent(db, {
		businessId: business.id,
		requestId: request.id,
		type: "quote.lost",
		actor: input.actor,
		summary: `${quote.number} lost: ${input.reason.replace("_", " ")}${input.note ? ` (${input.note})` : ""}`,
	});
	const approvers = await db
		.select({ id: schema.staff.id })
		.from(schema.staff)
		.where(
			and(
				eq(schema.staff.businessId, business.id),
				eq(schema.staff.canApprove, true),
			),
		);
	await notify(db, {
		businessId: business.id,
		staffIds: approvers.map((a) => a.id),
		title: `${quote.number} lost`,
		body: `Reason: ${input.reason.replace("_", " ")}${input.note ? `. ${input.note}` : ""}`,
		link: `/orbyte/${business.id}/quotes?r=${request.id}`,
	});
	return row;
}

// --- The scheduler -----------------------------------------------------------------------------

let running = false;

/** Sends due reminders and handles expired quotes. Runs every minute and after demo fast-forward. */
export async function runFollowUps(businessId?: string) {
	if (running) return;
	running = true;
	const db = getDb();
	try {
		const now = new Date();
		const due = await db
			.select({ id: schema.quoteFollowUps.id })
			.from(schema.quoteFollowUps)
			.where(
				and(
					eq(schema.quoteFollowUps.status, "scheduled"),
					lte(schema.quoteFollowUps.dueAt, now),
					businessId
						? eq(schema.quoteFollowUps.businessId, businessId)
						: undefined,
				),
			)
			.orderBy(asc(schema.quoteFollowUps.dueAt));
		for (const fu of due) await sendReminder(fu.id);

		const expired = await db
			.select()
			.from(schema.quotes)
			.where(
				and(
					eq(schema.quotes.status, "approved"),
					lte(schema.quotes.validUntil, now),
					businessId ? eq(schema.quotes.businessId, businessId) : undefined,
				),
			);
		for (const q of expired) await handleExpiry(q);
	} catch (err) {
		console.error("[follow-ups]", err);
	} finally {
		running = false;
	}
}

/** Starts the once-a-minute scheduler (once per server process). */
export function startFollowUpScheduler() {
	const g = globalThis as { __qcFollowUps?: ReturnType<typeof setInterval> };
	if (g.__qcFollowUps) return;
	g.__qcFollowUps = setInterval(() => void runFollowUps(), 60_000);
}

// --- Hooks from the quote workflow ---------------------------------------------------------------

export async function onQuoteSent(
	quoteId: string,
	supersededId?: string | null,
) {
	if (supersededId) await cancelScheduled(supersededId);
	await planNextFollowUp(quoteId).catch((err) =>
		console.error("[follow-ups] plan", err),
	);
}

export const onQuoteOpened = (quoteId: string) =>
	planNextFollowUp(quoteId).catch((err) =>
		console.error("[follow-ups] plan", err),
	);

export const onQuoteClosed = (quoteId: string) => cancelScheduled(quoteId);

/**
 * The customer wrote back while a quote waits for their signature. Returns how
 * Quora Chat should reply, or null to carry on as normal.
 */
export async function onCustomerReplyToQuote(input: {
	quoteId: string;
	response: {
		intent: "none" | "later" | "price_concern" | "not_interested" | "question";
		resumeOn: string | null;
		lostReason:
			| "price"
			| "timing"
			| "competitor"
			| "not_needed"
			| "other"
			| null;
		note: string | null;
	};
	customerName: string;
}): Promise<{ instruction: string; summary: string } | null> {
	const db = getDb();
	const ctx = await loadQuoteContext(input.quoteId);
	if (!ctx || ctx.quote.status !== "approved") return null;
	const { quote, business, request } = ctx;
	const r = input.response;

	if (r.intent === "later") {
		const parsed = r.resumeOn ? new Date(`${r.resumeOn}T00:00:00+08:00`) : null;
		const until = intoWorkingHours(
			parsed && !Number.isNaN(parsed.getTime()) && parsed > new Date()
				? parsed
				: new Date(Date.now() + 3 * DAY),
			business,
		);
		await db
			.update(schema.quotes)
			.set({ pausedUntil: until })
			.where(eq(schema.quotes.id, quote.id));
		await emitOrbyteEvent(db, {
			businessId: business.id,
			requestId: request.id,
			type: "followup.paused",
			actor: input.customerName,
			summary: `${input.customerName} needs more time${r.note ? ` (${r.note})` : ""}; reminders wait until ${myDate(until)}`,
		});
		await planNextFollowUp(quote.id);
		return {
			summary: `Customer needs more time; reminders wait until ${myDate(until)}`,
			instruction: `They need more time to decide${r.note ? ` (${r.note})` : ""}. Reply warmly: no rush, and say we'll check back around ${myDate(until)}. Don't push.`,
		};
	}
	if (r.intent === "price_concern") {
		await db
			.update(schema.quotes)
			.set({ followUpsPaused: true })
			.where(eq(schema.quotes.id, quote.id));
		await cancelScheduled(quote.id);
		await emitOrbyteEvent(db, {
			businessId: business.id,
			requestId: request.id,
			type: "followup.paused",
			actor: input.customerName,
			summary: `${input.customerName} raised a price concern on ${quote.number}${r.note ? `: ${r.note}` : ""}. Reminders paused for staff`,
		});
		const approvers = await db
			.select({ id: schema.staff.id })
			.from(schema.staff)
			.where(
				and(
					eq(schema.staff.businessId, business.id),
					eq(schema.staff.canApprove, true),
				),
			);
		await notify(db, {
			businessId: business.id,
			staffIds: approvers.map((a) => a.id),
			title: `Price concern on ${quote.number}`,
			body: `${input.customerName}: ${r.note ?? "thinks it's too expensive"}. Reminders are paused until you decide.`,
			link: `/orbyte/${business.id}/inbox?c=${request.conversationId}`,
		});
		return {
			summary: "Price concern: reminders paused, staff notified",
			instruction:
				"They raised a concern about the price. Thank them for being upfront and say you'll pass it to the team to look into and get back to them. Do NOT offer or hint at any discount, price change or promise (avoid phrases like 'see what we can do').",
		};
	}
	if (r.intent === "not_interested") {
		await markLost({
			quoteId: quote.id,
			reason: r.lostReason ?? "other",
			note: r.note,
			actor: input.customerName,
		});
		return {
			summary: `Customer declined: ${r.lostReason ?? "other"}${r.note ? ` (${r.note})` : ""}`,
			instruction:
				"They decided not to go ahead. Thank them graciously for considering us and say they're welcome back anytime. No pushing, no questions.",
		};
	}
	// A question or anything else: they're engaged, so re-plan the next nudge.
	await planNextFollowUp(quote.id);
	return null;
}

// --- Staff controls -------------------------------------------------------------------------------

export async function followUpAction(input: {
	quoteId: string;
	staffId: string;
	action: "pause" | "resume" | "send_now" | "mark_lost";
	reason?: LostReason;
	note?: string;
}) {
	const db = getDb();
	const ctx = await loadQuoteContext(input.quoteId);
	if (!ctx) throw new Error("Quote not found");
	const { quote, business, request, conversation } = ctx;
	const member = await db.query.staff.findFirst({
		where: and(
			eq(schema.staff.id, input.staffId),
			eq(schema.staff.businessId, business.id),
		),
	});
	if (!member) throw new Error("Staff member not found");
	if (quote.status !== "approved")
		throw new Error("Follow-ups only apply to a sent, unsigned quote");

	switch (input.action) {
		case "pause":
			await db
				.update(schema.quotes)
				.set({ followUpsPaused: true })
				.where(eq(schema.quotes.id, quote.id));
			await cancelScheduled(quote.id);
			await emitOrbyteEvent(db, {
				businessId: business.id,
				requestId: request.id,
				type: "followup.paused",
				actor: member.name,
				summary: `${member.name} paused follow-ups for ${quote.number}`,
			});
			return { ok: true };
		case "resume":
			await db
				.update(schema.quotes)
				.set({ followUpsPaused: false, pausedUntil: null })
				.where(eq(schema.quotes.id, quote.id));
			await emitOrbyteEvent(db, {
				businessId: business.id,
				requestId: request.id,
				type: "followup.resumed",
				actor: member.name,
				summary: `${member.name} resumed follow-ups for ${quote.number}`,
			});
			await planNextFollowUp(quote.id);
			return { ok: true };
		case "send_now": {
			if (request.status !== "approved")
				throw new Error(
					"The customer is changing this quote; follow-ups are on hold",
				);
			await cancelScheduled(quote.id);
			const [fu] = await db
				.insert(schema.quoteFollowUps)
				.values({
					businessId: business.id,
					quoteId: quote.id,
					conversationId: conversation.id,
					dueAt: new Date(),
					reason: `Sent now by ${member.name}`,
				})
				.returning();
			await sendReminder(fu.id, member.name);
			return { ok: true };
		}
		case "mark_lost":
			await markLost({
				quoteId: quote.id,
				reason: input.reason ?? "other",
				note: input.note,
				actor: member.name,
			});
			return { ok: true };
	}
}

// --- Demo clock ----------------------------------------------------------------------------------

/**
 * Demo only: pretend `days` have passed for one business by moving its
 * timestamps back, then run the scheduler so due reminders and expiries happen.
 */
export async function fastForward(businessId: string, days: number) {
	const db = getDb();
	const shift = sql`make_interval(days => ${days})`;
	const conv = sql`(select id from conversations where business_id = ${businessId})`;
	const started = new Date();
	await db.transaction(async (tx) => {
		await tx.execute(
			sql`update conversations set created_at = created_at - ${shift} where business_id = ${businessId}`,
		);
		await tx.execute(
			sql`update messages set created_at = created_at - ${shift} where conversation_id in ${conv}`,
		);
		await tx.execute(
			sql`update ai_runs set created_at = created_at - ${shift}, finished_at = finished_at - ${shift} where conversation_id in ${conv}`,
		);
		await tx.execute(
			sql`update quote_requests set created_at = created_at - ${shift}, updated_at = updated_at - ${shift} where business_id = ${businessId}`,
		);
		await tx.execute(
			sql`update quotes set created_at = created_at - ${shift}, valid_until = valid_until - ${shift}, decided_at = decided_at - ${shift}, viewed_at = viewed_at - ${shift}, signed_at = signed_at - ${shift}, paused_until = paused_until - ${shift}, extended_at = extended_at - ${shift}, lost_at = lost_at - ${shift} where business_id = ${businessId}`,
		);
		await tx.execute(
			sql`update quote_follow_ups set created_at = created_at - ${shift}, due_at = due_at - ${shift}, sent_at = sent_at - ${shift} where business_id = ${businessId}`,
		);
		await tx.execute(
			sql`update activity_events set created_at = created_at - ${shift} where business_id = ${businessId}`,
		);
		await tx.execute(
			sql`update jobs set created_at = created_at - ${shift}, updated_at = updated_at - ${shift}, completed_at = completed_at - ${shift} where business_id = ${businessId}`,
		);
		await tx.execute(
			sql`update job_tasks set created_at = created_at - ${shift} where job_id in (select id from jobs where business_id = ${businessId})`,
		);
		await tx.execute(
			sql`update job_chat set created_at = created_at - ${shift} where job_id in (select id from jobs where business_id = ${businessId})`,
		);
		await tx.execute(
			sql`update relays set created_at = created_at - ${shift}, sent_at = sent_at - ${shift}, answered_at = answered_at - ${shift} where business_id = ${businessId}`,
		);
		await tx.execute(
			sql`update notifications set created_at = created_at - ${shift}, read_at = read_at - ${shift} where business_id = ${businessId}`,
		);
	});
	await runFollowUps(businessId);
	// What happened as a result, for the toast.
	const happened = await db
		.select({
			summary: schema.activityEvents.summary,
			type: schema.activityEvents.type,
		})
		.from(schema.activityEvents)
		.where(
			and(
				eq(schema.activityEvents.businessId, businessId),
				inArray(schema.activityEvents.type, [
					"followup.sent",
					"quote.extended",
					"quote.lost",
				]),
				sql`${schema.activityEvents.createdAt} >= ${started}`,
			),
		);
	return { days, happened: happened.map((h) => h.summary) };
}
