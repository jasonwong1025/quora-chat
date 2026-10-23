/**
 * Billing after signing, fully automatic:
 * - each instalment of the quote's payment schedule is invoiced on WhatsApp when its
 *   trigger happens (signed / a phase's tasks done / job completed);
 * - the customer pays from the invoice card (simulated card, no real gateway) or staff
 *   record an offline payment; every payment gets an official receipt;
 * - on completion the business's chosen documents go out (completion report,
 *   statement of account); once everything is paid, the job closes;
 * - unpaid invoices get polite reminders, timed by the AI within the business's limits.
 */
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { type Database, getDb, schema } from "#/db";
import type { Language } from "#/db/schema";
import { instalmentsFor, type ResolvedInstalment } from "#/lib/billing";
import { formatMYR } from "#/lib/money";
import { planPaymentReminder, writePaymentReminder } from "./ai";
import { intoWorkingHours, myDate, myTime, recentChat } from "./followups";
import { notify } from "./notify";
import { emitOrbyteEvent } from "./orbyte";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Invoice = typeof schema.invoices.$inferSelect;
export type BillingEvent =
	| { kind: "signed" }
	| { kind: "phase"; phase: string }
	| { kind: "completed" };

// --- Loading ------------------------------------------------------------------------------

async function loadQuote(db: Database, quoteId: string) {
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

async function approverIds(db: Database, businessId: string) {
	const rows = await db
		.select({ id: schema.staff.id })
		.from(schema.staff)
		.where(
			and(
				eq(schema.staff.businessId, businessId),
				eq(schema.staff.canApprove, true),
			),
		);
	return rows.map((r) => r.id);
}

async function jobFor(db: Database, quoteId: string) {
	return db.query.jobs.findFirst({ where: eq(schema.jobs.quoteId, quoteId) });
}

/** "KD-INV-0001" / "KD-OR-0001", per business. Call inside a transaction that locks the business. */
async function nextNumber(
	db: Database,
	businessId: string,
	prefix: string,
	kind: "INV" | "OR",
) {
	const table = kind === "INV" ? schema.invoices : schema.payments;
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(table)
		.where(eq(table.businessId, businessId));
	return `${prefix}-${kind}-${String(Number(n) + 1).padStart(4, "0")}`;
}

const lockBusiness = (db: Database, businessId: string) =>
	db
		.select({ id: schema.businesses.id })
		.from(schema.businesses)
		.where(eq(schema.businesses.id, businessId))
		.for("update");

/**
 * Rows written in one transaction share Postgres's now(), so chat messages get
 * their own increasing times: a payment bubble always shows before its receipt.
 */
let lastStamp = 0;
function stamp() {
	lastStamp = Math.max(Date.now(), lastStamp + 1);
	return new Date(lastStamp);
}

const day = (d: Date) =>
	d.toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur" });

// --- Messages to the customer (fixed wording, in their language) ---------------------------

function lang(l: Language): "en" | "ms" | "zh" {
	return l === "mixed" ? "en" : l;
}

function invoiceText(
	l: Language,
	i: { number: string; label: string; amount: string; due: string },
) {
	return {
		en: `Here's invoice ${i.number} (${i.label}): ${i.amount}, due ${i.due}. Tap "Review and pay" to pay here.`,
		ms: `Ini invois ${i.number} (${i.label}): ${i.amount}, perlu dibayar sebelum ${i.due}. Tekan "Review and pay" untuk bayar terus di sini.`,
		zh: `这是发票 ${i.number}（${i.label}）：${i.amount}，请在 ${i.due} 前付款。点击 "Review and pay" 即可在这里付款。`,
	}[lang(l)];
}

function receiptText(l: Language, r: { number: string; amount: string }) {
	return {
		en: `Payment received, thank you! Here's your official receipt ${r.number} for ${r.amount}.`,
		ms: `Bayaran diterima, terima kasih! Ini resit rasmi ${r.number} untuk ${r.amount}.`,
		zh: `已收到付款，谢谢！这是您的正式收据 ${r.number}，金额 ${r.amount}。`,
	}[lang(l)];
}

function completionText(l: Language, job: string, report: boolean) {
	if (!report)
		return {
			en: `Good news: ${job} is complete! Thank you for choosing us.`,
			ms: `Berita baik: ${job} sudah siap! Terima kasih kerana memilih kami.`,
			zh: `好消息：${job} 已经完成！感谢您的支持。`,
		}[lang(l)];
	return {
		en: `Good news: ${job} is complete! Here's the completion report with what we've done.`,
		ms: `Berita baik: ${job} sudah siap! Ini laporan penyiapan kerja yang telah kami buat.`,
		zh: `好消息：${job} 已经完成！这是我们的完工报告。`,
	}[lang(l)];
}

function statementText(l: Language, balance: string, paid: boolean) {
	return paid
		? {
				en: "Here's your statement of account. Everything is fully paid, thank you!",
				ms: "Ini penyata akaun anda. Semua bayaran telah selesai, terima kasih!",
				zh: "这是您的账户结单。所有款项已付清，谢谢！",
			}[lang(l)]
		: {
				en: `Here's your statement of account. Balance remaining: ${balance}.`,
				ms: `Ini penyata akaun anda. Baki perlu dibayar: ${balance}.`,
				zh: `这是您的账户结单。未付余额：${balance}。`,
			}[lang(l)];
}

function reminderFallback(l: Language, number: string, overdue: boolean) {
	return overdue
		? {
				en: `Hi, a gentle reminder that invoice ${number} is now past its due date. You can tap "Review and pay" on the invoice above. Thank you!`,
				ms: `Hi, sekadar mengingatkan invois ${number} sudah melepasi tarikh akhir. Boleh tekan "Review and pay" pada invois di atas. Terima kasih!`,
				zh: `您好，温馨提醒：发票 ${number} 已过付款期限。可以点击上面发票的 "Review and pay" 付款，谢谢！`,
			}[lang(l)]
		: {
				en: `Hi, just a friendly reminder that invoice ${number} is due soon. You can tap "Review and pay" on the invoice above. Thank you!`,
				ms: `Hi, sekadar mengingatkan invois ${number} akan tamat tempoh tidak lama lagi. Boleh tekan "Review and pay" pada invois di atas. Terima kasih!`,
				zh: `您好，温馨提醒：发票 ${number} 即将到期。可以点击上面发票的 "Review and pay" 付款，谢谢！`,
			}[lang(l)];
}

// --- Invoicing ----------------------------------------------------------------------------

/**
 * Invoices the instalments this event triggers. Idempotent: each instalment is
 * invoiced at most once. On completion, anything still not invoiced is billed too.
 */
export async function issueInvoices(quoteId: string, event: BillingEvent) {
	const db = getDb();
	const ctx = await loadQuote(db, quoteId);
	if (!ctx || ctx.quote.status !== "accepted") return [];
	const { quote, business, request, conversation } = ctx;
	const due = instalmentsFor(quote, business.billing).filter((i) =>
		event.kind === "completed"
			? true
			: event.kind === "phase"
				? i.when === "phase" && i.phase === event.phase
				: i.when === "signed",
	);
	if (!due.length) return [];

	const created = await db.transaction(async (tx) => {
		// Cancellation and invoicing serialize on the quote. A trigger that loaded
		// an accepted quote just before cancellation must not send a late invoice.
		const [currentQuote] = await tx
			.select({ status: schema.quotes.status })
			.from(schema.quotes)
			.where(eq(schema.quotes.id, quote.id))
			.for("update");
		if (currentQuote?.status !== "accepted") return [];
		await lockBusiness(tx, business.id);
		const existing = await tx
			.select({ instalment: schema.invoices.instalment })
			.from(schema.invoices)
			.where(eq(schema.invoices.quoteId, quote.id));
		const done = new Set(existing.map((e) => e.instalment));
		const rows: Invoice[] = [];
		for (const i of due) {
			if (done.has(i.index) || i.amountSen <= 0) continue;
			const number = await nextNumber(
				tx,
				business.id,
				business.quotePrefix,
				"INV",
			);
			const dueAt = new Date(
				Date.now() + (business.billing?.dueDays ?? 7) * DAY,
			);
			const [row] = await tx
				.insert(schema.invoices)
				.values({
					number,
					businessId: business.id,
					quoteId: quote.id,
					conversationId: conversation.id,
					instalment: i.index,
					label: i.label,
					percent: i.percent,
					amountSen: i.amountSen,
					dueAt,
				})
				.returning();
			await tx.insert(schema.messages).values({
				conversationId: conversation.id,
				sender: "assistant",
				invoiceId: row.id,
				createdAt: stamp(),
				body: invoiceText(request.brief.language, {
					number,
					label: i.label,
					amount: formatMYR(i.amountSen),
					due: day(dueAt),
				}),
			});
			await emitOrbyteEvent(tx, {
				businessId: business.id,
				requestId: request.id,
				type: "invoice.sent",
				actor: "quora-chat",
				summary: `Invoice ${number} sent to ${conversation.customerName}: ${i.label} ${formatMYR(i.amountSen)} (${triggerWhy(i, event)})`,
				payload: { invoiceId: row.id, quoteId: quote.id },
			});
			rows.push(row);
		}
		return rows;
	});
	for (const row of created)
		await planReminder(row.id).catch((err) =>
			console.error("[billing] plan reminder", err),
		);
	return created;
}

function triggerWhy(i: ResolvedInstalment, event: BillingEvent) {
	if (i.when === "signed") return "customer signed";
	if (i.when === "phase") return `${i.phase} done`;
	return event.kind === "completed" ? "job completed" : "due";
}

// --- Payments ---------------------------------------------------------------------------

/** The customer paid from the WhatsApp invoice card (simulated card). */
export function payInvoice(input: { invoiceId: string; card: string }) {
	return settle(input.invoiceId, {
		method: "card",
		reference: input.card,
		recordedBy: null,
	});
}

/** Staff record money received outside the chat (bank transfer, cash). */
export async function recordPayment(input: {
	invoiceId: string;
	staffId: string;
	method: "bank_transfer" | "cash";
	reference: string | null;
}) {
	const member = await getDb().query.staff.findFirst({
		where: eq(schema.staff.id, input.staffId),
	});
	if (!member) throw new Error("Staff member not found");
	return settle(input.invoiceId, {
		method: input.method,
		reference: input.reference,
		recordedBy: member,
	});
}

async function settle(
	invoiceId: string,
	how: {
		method: "card" | "bank_transfer" | "cash";
		reference: string | null;
		recordedBy: typeof schema.staff.$inferSelect | null; // null = the customer paid
	},
) {
	const db = getDb();
	const result = await db.transaction(async (tx) => {
		const [invoice] = await tx
			.select()
			.from(schema.invoices)
			.where(eq(schema.invoices.id, invoiceId))
			.for("update");
		if (!invoice) throw new Error("Invoice not found");
		if (invoice.status === "paid")
			throw new Error("This invoice is already paid");
		if (invoice.status === "void")
			throw new Error("This invoice was cancelled");
		if (how.recordedBy && how.recordedBy.businessId !== invoice.businessId)
			throw new Error("Staff member not found");
		const ctx = await loadQuote(tx, invoice.quoteId);
		if (!ctx) throw new Error("Quotation not found");
		const { business, request, conversation } = ctx;
		await lockBusiness(tx, business.id);
		const receiptNumber = await nextNumber(
			tx,
			business.id,
			business.quotePrefix,
			"OR",
		);
		const by = how.recordedBy?.name ?? conversation.customerName;
		const [payment] = await tx
			.insert(schema.payments)
			.values({
				businessId: business.id,
				invoiceId: invoice.id,
				receiptNumber,
				amountSen: invoice.amountSen,
				method: how.method,
				reference: how.reference,
				recordedBy: by,
			})
			.returning();
		await tx
			.update(schema.invoices)
			.set({ status: "paid", paidAt: payment.paidAt })
			.where(eq(schema.invoices.id, invoice.id));
		if (!how.recordedBy)
			await tx.insert(schema.messages).values({
				conversationId: conversation.id,
				sender: "customer",
				paymentId: payment.id,
				createdAt: stamp(),
				body: `Payment ${formatMYR(invoice.amountSen)} for ${invoice.number}`,
			});
		await tx.insert(schema.messages).values({
			conversationId: conversation.id,
			sender: "assistant",
			createdAt: stamp(),
			document: {
				kind: "receipt",
				id: payment.id,
				name: `${receiptNumber}.pdf`,
			},
			body: receiptText(request.brief.language, {
				number: receiptNumber,
				amount: formatMYR(invoice.amountSen),
			}),
		});
		await tx
			.update(schema.quoteFollowUps)
			.set({ status: "cancelled" })
			.where(
				and(
					eq(schema.quoteFollowUps.invoiceId, invoice.id),
					eq(schema.quoteFollowUps.status, "scheduled"),
				),
			);
		const method = {
			card: `card (${how.reference ?? "card"})`,
			bank_transfer: "bank transfer",
			cash: "cash",
		}[how.method];
		await emitOrbyteEvent(tx, {
			businessId: business.id,
			requestId: request.id,
			type: "payment.received",
			actor: by,
			summary: `${formatMYR(invoice.amountSen)} received for ${invoice.number} by ${method}; receipt ${receiptNumber} sent`,
			payload: { invoiceId: invoice.id, paymentId: payment.id },
		});
		const job = await jobFor(tx, invoice.quoteId);
		await notify(tx, {
			businessId: business.id,
			staffIds: [...(await approverIds(tx, business.id)), job?.picId],
			title: `Payment received: ${invoice.number}`,
			body: `${conversation.customerName} paid ${formatMYR(invoice.amountSen)} (${invoice.label}). Receipt ${receiptNumber} sent.`,
			link: job
				? `/orbyte/${business.id}/work/${job.id}?tab=billing`
				: `/orbyte/${business.id}/inbox?c=${conversation.id}`,
		});
		return { payment, invoice: { ...invoice, status: "paid" as const } };
	});
	await closeIfSettled(result.invoice.quoteId);
	return result;
}

/** A completed job whose every instalment is paid is closed. */
async function closeIfSettled(quoteId: string) {
	const db = getDb();
	const ctx = await loadQuote(db, quoteId);
	const job = await jobFor(db, quoteId);
	if (!ctx || !job || job.status !== "completed") return;
	const plan = instalmentsFor(ctx.quote, ctx.business.billing).filter(
		(i) => i.amountSen > 0,
	);
	const invoices = await db
		.select()
		.from(schema.invoices)
		.where(eq(schema.invoices.quoteId, quoteId));
	const paid = invoices.filter((i) => i.status === "paid").length;
	if (paid < plan.length) return;
	await db.transaction(async (tx) => {
		const [row] = await tx
			.update(schema.jobs)
			.set({ status: "closed", updatedAt: new Date() })
			.where(
				and(eq(schema.jobs.id, job.id), eq(schema.jobs.status, "completed")),
			)
			.returning();
		if (!row) return;
		await tx.insert(schema.jobChat).values({
			jobId: job.id,
			role: "system",
			body: "Fully paid. The job is closed.",
		});
		await emitOrbyteEvent(tx, {
			businessId: job.businessId,
			requestId: job.requestId,
			type: "job.status_changed",
			actor: "quora-chat",
			summary: `${job.number} closed: fully paid (${formatMYR(ctx.quote.totalSen)})`,
		});
	});
}

// --- Completion ---------------------------------------------------------------------------

/**
 * The job is done: send the completion report (if the business uses one), invoice
 * whatever is still unbilled, then the statement of account (if used).
 */
export async function onJobCompleted(jobId: string) {
	const db = getDb();
	const job = await db.query.jobs.findFirst({
		where: eq(schema.jobs.id, jobId),
	});
	if (!job) return;
	const ctx = await loadQuote(db, job.quoteId);
	if (!ctx) return;
	const { business, request, conversation } = ctx;
	const billing = business.billing;
	const language = request.brief.language;
	// The customer always hears it's done; the report goes with it if the business uses one.
	const report = billing?.completionReport ?? true;
	await db.insert(schema.messages).values({
		conversationId: conversation.id,
		sender: "assistant",
		document: report
			? {
					kind: "completion_report",
					id: job.id,
					name: `${job.number}-completion-report.pdf`,
				}
			: null,
		body: completionText(language, job.title, report),
	});
	await emitOrbyteEvent(db, {
		businessId: business.id,
		requestId: request.id,
		type: "document.sent",
		actor: "quora-chat",
		summary: report
			? `Completion report for ${job.number} sent to ${conversation.customerName}`
			: `Told ${conversation.customerName} that ${job.number} is complete`,
	});
	await issueInvoices(job.quoteId, { kind: "completed" });
	if (billing?.statement) await sendStatement(job.id);
	await closeIfSettled(job.quoteId);
}

/** Statement of account: every invoice and payment for the job, and what's left. */
export async function sendStatement(jobId: string) {
	const db = getDb();
	const job = await db.query.jobs.findFirst({
		where: eq(schema.jobs.id, jobId),
	});
	if (!job) return;
	const ctx = await loadQuote(db, job.quoteId);
	if (!ctx) return;
	if (ctx.quote.status === "cancelled")
		throw new Error("A statement cannot be sent for a cancelled order");
	const s = await statementFor(job.quoteId);
	await db.insert(schema.messages).values({
		conversationId: ctx.conversation.id,
		sender: "assistant",
		document: {
			kind: "statement",
			id: job.id,
			name: `${job.number}-statement.pdf`,
		},
		body: statementText(
			ctx.request.brief.language,
			formatMYR(s.balanceSen),
			s.balanceSen <= 0,
		),
	});
	await emitOrbyteEvent(db, {
		businessId: job.businessId,
		requestId: job.requestId,
		type: "document.sent",
		actor: "quora-chat",
		summary: `Statement of account for ${job.number} sent (balance ${formatMYR(s.balanceSen)})`,
	});
}

/** Everything billed and paid for a signed quotation. */
export async function statementFor(quoteId: string) {
	const db = getDb();
	const ctx = await loadQuote(db, quoteId);
	if (!ctx) throw new Error("Quotation not found");
	const invoices = await db
		.select()
		.from(schema.invoices)
		.where(eq(schema.invoices.quoteId, quoteId))
		.orderBy(asc(schema.invoices.instalment));
	const payments = invoices.length
		? await db
				.select()
				.from(schema.payments)
				.where(
					inArray(
						schema.payments.invoiceId,
						invoices.map((i) => i.id),
					),
				)
				.orderBy(asc(schema.payments.paidAt))
		: [];
	const paidSen = payments.reduce((s, p) => s + p.amountSen, 0);
	return {
		...ctx,
		plan: instalmentsFor(ctx.quote, ctx.business.billing),
		invoices,
		payments,
		paidSen,
		// Voided and not-yet-issued instalments are no longer due after cancellation.
		// Paid amounts stay visible for a separate refund decision.
		balanceSen:
			ctx.quote.status === "cancelled" ? 0 : ctx.quote.totalSen - paidSen,
	};
}

// --- Payment reminders ---------------------------------------------------------------------

/** Schedules the next reminder for an unpaid invoice, within the business's limits. */
export async function planReminder(invoiceId: string) {
	const db = getDb();
	const invoice = await db.query.invoices.findFirst({
		where: eq(schema.invoices.id, invoiceId),
	});
	if (!invoice) return null;
	await db
		.update(schema.quoteFollowUps)
		.set({ status: "cancelled" })
		.where(
			and(
				eq(schema.quoteFollowUps.invoiceId, invoice.id),
				eq(schema.quoteFollowUps.status, "scheduled"),
			),
		);
	if (invoice.status !== "sent" || invoice.remindersPaused) return null;
	const ctx = await loadQuote(db, invoice.quoteId);
	if (!ctx) return null;
	const { business, request, conversation } = ctx;
	const sent = await db
		.select()
		.from(schema.quoteFollowUps)
		.where(
			and(
				eq(schema.quoteFollowUps.invoiceId, invoice.id),
				eq(schema.quoteFollowUps.status, "sent"),
			),
		)
		.orderBy(desc(schema.quoteFollowUps.sentAt));
	if (sent.length >= business.followUpMax) return null;

	const now = new Date();
	const ai = await planPaymentReminder({
		businessName: business.name,
		invoice: `${invoice.number} · ${invoice.label} · ${formatMYR(invoice.amountSen)}`,
		daysSinceIssued: (now.getTime() - invoice.issuedAt.getTime()) / DAY,
		daysUntilDue: (invoice.dueAt.getTime() - now.getTime()) / DAY,
		remindersSent: sent.length,
		maxReminders: business.followUpMax,
		recentChat: await recentChat(conversation.id),
		now: myTime(now),
	}).catch(() => ({
		waitHours: Math.max(
			24,
			(invoice.dueAt.getTime() - now.getTime()) / HOUR - 24,
		),
		reason: "Default timing: a day before it's due (the AI was unavailable).",
	}));

	// The AI suggests; the business's rules decide.
	const notes: string[] = [];
	let due = new Date(
		now.getTime() + Math.min(Math.max(ai.waitHours, 1), 24 * 30) * HOUR,
	);
	const last = new Date(
		Math.max(invoice.issuedAt.getTime(), sent[0]?.sentAt?.getTime() ?? 0),
	);
	const earliest = new Date(last.getTime() + business.followUpGapDays * DAY);
	if (due < earliest) {
		due = earliest;
		notes.push(`kept ${business.followUpGapDays} days after the last message`);
	}
	const inHours = intoWorkingHours(due, business);
	if (inHours.getTime() !== due.getTime())
		notes.push("moved into working hours");
	due = inHours;
	const reason = `${ai.reason}${notes.length ? ` (${notes.join("; ")})` : ""}`;
	const [row] = await db
		.insert(schema.quoteFollowUps)
		.values({
			businessId: business.id,
			quoteId: invoice.quoteId,
			invoiceId: invoice.id,
			conversationId: conversation.id,
			kind: "payment_reminder",
			dueAt: due,
			reason,
		})
		.returning();
	await emitOrbyteEvent(db, {
		businessId: business.id,
		requestId: request.id,
		type: "followup.scheduled",
		actor: "quora-chat",
		summary: `Payment reminder ${sent.length + 1}/${business.followUpMax} for ${invoice.number} set for ${myTime(due)}: ${reason}`,
	});
	return row;
}

async function sendPaymentReminder(followUpId: string, byStaff?: string) {
	const db = getDb();
	const fu = await db.query.quoteFollowUps.findFirst({
		where: eq(schema.quoteFollowUps.id, followUpId),
	});
	if (!fu?.invoiceId || fu.status !== "scheduled") return;
	const invoice = await db.query.invoices.findFirst({
		where: eq(schema.invoices.id, fu.invoiceId),
	});
	if (!invoice || invoice.status !== "sent" || invoice.remindersPaused) {
		await db
			.update(schema.quoteFollowUps)
			.set({ status: "cancelled" })
			.where(eq(schema.quoteFollowUps.id, fu.id));
		return;
	}
	const ctx = await loadQuote(db, invoice.quoteId);
	if (!ctx) return;
	const { business, request, conversation } = ctx;
	const reminderNumber =
		(
			await db
				.select({ id: schema.quoteFollowUps.id })
				.from(schema.quoteFollowUps)
				.where(
					and(
						eq(schema.quoteFollowUps.invoiceId, invoice.id),
						eq(schema.quoteFollowUps.status, "sent"),
					),
				)
		).length + 1;
	const overdue = invoice.dueAt < new Date();
	const body =
		(await writePaymentReminder({
			businessName: business.name,
			customerName: conversation.customerName,
			language: request.brief.language,
			invoice: `${invoice.number} (${invoice.label}, ${formatMYR(invoice.amountSen)}, due ${myDate(invoice.dueAt)})`,
			overdue,
			reminderNumber,
			recentChat: await recentChat(conversation.id),
		}).catch(() => "")) ||
		reminderFallback(request.brief.language, invoice.number, overdue);
	const sentNow = await db.transaction(async (tx) => {
		const [claimed] = await tx
			.update(schema.quoteFollowUps)
			.set({ status: "sent", sentAt: new Date(), body })
			.where(
				and(
					eq(schema.quoteFollowUps.id, fu.id),
					eq(schema.quoteFollowUps.status, "scheduled"),
				),
			)
			.returning();
		if (!claimed) return false;
		const [msg] = await tx
			.insert(schema.messages)
			.values({
				conversationId: conversation.id,
				sender: "assistant",
				body,
			})
			.returning();
		await tx
			.update(schema.quoteFollowUps)
			.set({ messageId: msg.id })
			.where(eq(schema.quoteFollowUps.id, fu.id));
		await emitOrbyteEvent(tx, {
			businessId: business.id,
			requestId: request.id,
			type: "followup.sent",
			actor: byStaff ?? "quora-chat",
			summary: `Payment reminder ${reminderNumber}/${business.followUpMax} for ${invoice.number} sent${overdue ? " (overdue)" : ""}`,
		});
		return true;
	});
	if (sentNow) await planReminder(invoice.id);
}

let running = false;

/** Sends payment reminders that are due. Runs with the follow-up scheduler. */
export async function runPaymentReminders(businessId?: string) {
	if (running) return;
	running = true;
	try {
		const due = await getDb()
			.select({ id: schema.quoteFollowUps.id })
			.from(schema.quoteFollowUps)
			.where(
				and(
					eq(schema.quoteFollowUps.kind, "payment_reminder"),
					eq(schema.quoteFollowUps.status, "scheduled"),
					lte(schema.quoteFollowUps.dueAt, new Date()),
					businessId
						? eq(schema.quoteFollowUps.businessId, businessId)
						: undefined,
				),
			)
			.orderBy(asc(schema.quoteFollowUps.dueAt));
		for (const r of due) await sendPaymentReminder(r.id);
	} catch (err) {
		console.error("[billing] reminders", err);
	} finally {
		running = false;
	}
}

/** Staff controls on an invoice's reminders. */
export async function reminderAction(input: {
	invoiceId: string;
	staffId: string;
	action: "pause" | "resume" | "send_now";
}) {
	const db = getDb();
	const invoice = await db.query.invoices.findFirst({
		where: eq(schema.invoices.id, input.invoiceId),
	});
	const member = await db.query.staff.findFirst({
		where: eq(schema.staff.id, input.staffId),
	});
	if (!invoice || !member || member.businessId !== invoice.businessId)
		throw new Error("Invoice not found");
	if (invoice.status !== "sent")
		throw new Error("This invoice is already settled");
	if (input.action === "send_now") {
		const fu =
			(await db.query.quoteFollowUps.findFirst({
				where: and(
					eq(schema.quoteFollowUps.invoiceId, invoice.id),
					eq(schema.quoteFollowUps.status, "scheduled"),
				),
			})) ??
			(
				await db
					.insert(schema.quoteFollowUps)
					.values({
						businessId: invoice.businessId,
						quoteId: invoice.quoteId,
						invoiceId: invoice.id,
						conversationId: invoice.conversationId,
						kind: "payment_reminder",
						dueAt: new Date(),
						reason: `Sent now by ${member.name}`,
					})
					.returning()
			)[0];
		await sendPaymentReminder(fu.id, member.name);
		return;
	}
	await db
		.update(schema.invoices)
		.set({ remindersPaused: input.action === "pause" })
		.where(eq(schema.invoices.id, invoice.id));
	if (input.action === "pause")
		await db
			.update(schema.quoteFollowUps)
			.set({ status: "cancelled" })
			.where(
				and(
					eq(schema.quoteFollowUps.invoiceId, invoice.id),
					eq(schema.quoteFollowUps.status, "scheduled"),
				),
			);
	else await planReminder(invoice.id);
}

// --- Overview for Orbyte ---------------------------------------------------------------------

/** Unpaid totals for the Home page. */
export async function outstanding(businessId: string) {
	const rows = await getDb()
		.select({
			amountSen: schema.invoices.amountSen,
			dueAt: schema.invoices.dueAt,
		})
		.from(schema.invoices)
		.where(
			and(
				eq(schema.invoices.businessId, businessId),
				eq(schema.invoices.status, "sent"),
			),
		);
	const now = new Date();
	const overdue = rows.filter((r) => r.dueAt < now);
	return {
		outstandingSen: rows.reduce((s, r) => s + r.amountSen, 0),
		count: rows.length,
		overdueSen: overdue.reduce((s, r) => s + r.amountSen, 0),
		overdueCount: overdue.length,
	};
}
