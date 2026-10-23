/**
 * WhatsApp-style payments (modelled on WhatsApp Pay): an invoice card in the chat,
 * "Review and pay" opens the invoice details, then a confirm sheet with a saved
 * card. Simulated: no real payment gateway, nothing is charged.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	Check,
	CheckCircle2,
	Clock3,
	CreditCard,
	FileText,
	List,
	Loader2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatMYR } from "#/lib/money";
import type { ConversationDetail } from "#/lib/types";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";
import { WaAvatar } from "./avatar";

export type InvoiceInfo = ConversationDetail["invoices"][number];
export type PaymentInfo = ConversationDetail["payments"][number];
type Doc = NonNullable<ConversationDetail["messages"][number]["document"]>;

/** The demo's saved card, as in WhatsApp Pay. */
const CARD = "Visa •1234";

const day = (d: Date) =>
	d.toLocaleDateString("en-MY", { day: "numeric", month: "short" });

/** The invoice inside its chat bubble (like WhatsApp's order card). */
export function InvoiceCard({ invoice }: { invoice: InvoiceInfo }) {
	const paid = invoice.status === "paid";
	return (
		<div className="mb-1.5 min-w-64">
			<p className="text-[11px] font-medium tracking-wider text-[var(--wa-muted)] uppercase">
				Invoice #{invoice.number}
			</p>
			<p className="mt-1.5">{invoice.label}</p>
			<p className="text-xs text-[var(--wa-muted)]">
				{invoice.percent}% of quotation {invoice.quoteNumber}
			</p>
			<dl className="mt-2.5 space-y-1 border-t border-white/10 pt-2 text-sm">
				<div className="flex justify-between gap-4">
					<dt className="text-[var(--wa-muted)]">Status</dt>
					<dd
						className={cn(
							"flex items-center gap-1",
							paid ? "text-[var(--wa-green)]" : "text-[var(--wa-muted)]",
						)}
					>
						{paid ? (
							<>
								<CheckCircle2 className="size-3.5" /> Paid
							</>
						) : (
							<>
								<Clock3 className="size-3.5" /> Payment pending
							</>
						)}
					</dd>
				</div>
				{!paid && (
					<div className="flex justify-between gap-4">
						<dt className="text-[var(--wa-muted)]">Due</dt>
						<dd>{day(invoice.dueAt)}</dd>
					</div>
				)}
				<div className="flex justify-between gap-4">
					<dt className="text-[var(--wa-muted)]">Total</dt>
					<dd className="font-medium tabular-nums">
						{formatMYR(invoice.amountSen)}
					</dd>
				</div>
			</dl>
		</div>
	);
}

/** The button row under the card. */
export function PayButton(props: { invoice: InvoiceInfo; onPay: () => void }) {
	const paid = props.invoice.status === "paid";
	return (
		<div className="mt-0.5 flex rounded-lg bg-[var(--wa-in)]">
			{paid ? (
				<a
					href={`/api/documents/invoice/${props.invoice.id}`}
					target="_blank"
					rel="noreferrer"
					className="flex flex-1 items-center justify-center gap-2 py-2.5 text-sm text-[var(--wa-muted)] hover:bg-white/5"
				>
					<Check className="size-4" /> Paid · view invoice
				</a>
			) : (
				<button
					type="button"
					onClick={props.onPay}
					className="flex flex-1 items-center justify-center gap-2 py-2.5 text-sm text-[var(--wa-green)] hover:bg-white/5"
				>
					Review and pay
				</button>
			)}
		</div>
	);
}

/** The customer's own payment, in their (green) bubble. */
export function PaymentCard(props: {
	payment: PaymentInfo;
	invoice: InvoiceInfo | undefined;
	businessName: string;
}) {
	return (
		<div className="mb-1 min-w-60">
			<div className="rounded-md border-l-4 border-[#06cf9c] bg-black/20 px-2.5 py-1.5 text-[13px]">
				<p className="font-medium text-[#06cf9c]">{props.businessName}</p>
				<p className="flex items-center gap-1 text-white/70">
					<FileText className="size-3.5" /> {props.invoice?.number ?? "Invoice"}
					{props.invoice ? ` · ${props.invoice.label}` : ""}
				</p>
			</div>
			<p className="py-4 text-center text-3xl font-semibold tabular-nums">
				{formatMYR(props.payment.amountSen)}
			</p>
			<p className="flex items-center gap-1.5 text-xs text-white/70">
				<span className="flex size-5 items-center justify-center rounded-full bg-[#06cf9c] text-[10px] font-bold text-black">
					RM
				</span>
				<span>
					Sent to {props.businessName}
					<span className="block text-[#06cf9c]">Completed</span>
				</span>
			</p>
		</div>
	);
}

const docLabel: Record<Doc["kind"], string> = {
	receipt: "Official receipt",
	statement: "Statement of account",
	completion_report: "Completion report",
};

/** A PDF the business sent (receipt, statement, completion report). */
export function DocLink({ doc }: { doc: Doc }) {
	return (
		<a
			href={`/api/documents/${doc.kind}/${doc.id}`}
			target="_blank"
			rel="noreferrer"
			className="mb-1.5 flex min-w-64 items-center gap-3 rounded-md bg-black/25 p-3 hover:bg-black/35"
		>
			<span className="flex h-11 w-9 shrink-0 items-end justify-center rounded-sm bg-[#e5493a] pb-1 text-[9px] font-bold text-white">
				PDF
			</span>
			<span className="min-w-0">
				<span className="block truncate">{doc.name}</span>
				<span className="block text-xs text-white/60">
					{docLabel[doc.kind]} · PDF
				</span>
			</span>
		</a>
	);
}

/**
 * Invoice details → Proceed to pay → Confirm payment (saved card) → done.
 * Covers the chat like WhatsApp's in-app screens.
 */
export function PaySheet(props: {
	invoice: InvoiceInfo;
	businessName: string;
	onClose: () => void;
}) {
	const { invoice } = props;
	const queryClient = useQueryClient();
	const [step, setStep] = useState<"details" | "confirm" | "done">("details");
	const [sending, setSending] = useState(false);
	const pay = useMutation(
		orpc.billing.pay.mutationOptions({
			onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.key() }),
		}),
	);

	async function send() {
		setSending(true);
		try {
			// A short pause, like a real payment being authorised.
			await new Promise((r) => setTimeout(r, 900));
			await pay.mutateAsync({ invoiceId: invoice.id, card: CARD });
			setStep("done");
			setTimeout(props.onClose, 1400);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Payment failed");
			setStep("details");
		} finally {
			setSending(false);
		}
	}

	return (
		<div className="absolute inset-0 z-30 flex flex-col bg-[var(--wa-app)]">
			<header className="flex h-14 shrink-0 items-center gap-4 bg-[var(--wa-panel)] px-4">
				<button
					type="button"
					onClick={props.onClose}
					className="rounded-full p-1.5 hover:bg-[var(--wa-hover)]"
				>
					<ArrowLeft className="size-5" />
					<span className="sr-only">Back to chat</span>
				</button>
				<p className="text-lg font-medium">Invoice details</p>
			</header>

			<div className="flex-1 overflow-y-auto">
				<div className="flex flex-col items-center gap-2 px-6 pt-8 pb-6">
					<WaAvatar name={props.businessName} size={56} />
					<p className="text-lg font-medium">{props.businessName}</p>
					<span className="flex items-center gap-1.5 rounded-full border border-[var(--wa-border)] px-3 py-0.5 text-xs text-[var(--wa-muted)]">
						<Clock3 className="size-3.5" /> Payment pending
					</span>
				</div>
				<div className="mx-auto max-w-lg px-6">
					<div className="flex items-start gap-3 border-b border-[var(--wa-border)] py-3">
						<span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[var(--wa-in)]">
							<List className="size-5 text-[var(--wa-muted)]" />
						</span>
						<div className="min-w-0 flex-1">
							<p>{invoice.label}</p>
							<p className="text-xs text-[var(--wa-muted)]">
								{invoice.number} · {invoice.percent}% of {invoice.quoteNumber}
							</p>
						</div>
						<p className="tabular-nums">{formatMYR(invoice.amountSen)}</p>
					</div>
					{invoice.items.length > 0 && (
						<div className="border-b border-[var(--wa-border)] py-3 text-sm">
							<p className="mb-1 text-xs text-[var(--wa-muted)] uppercase">
								Quotation covers
							</p>
							<ul className="space-y-0.5 text-[var(--wa-muted)]">
								{invoice.items.map((it, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: quote lines have no id
									<li key={i} className="truncate">
										{it.description}
										{it.quantity > 1 && !["hour", "day"].includes(it.unit)
											? ` × ${it.quantity}`
											: ""}
									</li>
								))}
							</ul>
						</div>
					)}
					<div className="flex justify-between py-3 text-sm text-[var(--wa-muted)]">
						<span>Subtotal</span>
						<span className="tabular-nums">{formatMYR(invoice.amountSen)}</span>
					</div>
				</div>
			</div>

			<footer className="shrink-0 border-t border-[var(--wa-border)] bg-[var(--wa-panel)] px-6 py-4">
				<div className="mx-auto flex max-w-lg items-center justify-between pb-3">
					<span>Total</span>
					<span className="font-medium tabular-nums">
						{formatMYR(invoice.amountSen)}
					</span>
				</div>
				<button
					type="button"
					onClick={() => setStep("confirm")}
					className="mx-auto block w-full max-w-lg rounded-full bg-[var(--wa-green)] py-3 font-medium text-black hover:brightness-110"
				>
					Proceed to pay
				</button>
			</footer>

			{step !== "details" && (
				<div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/60">
					<div className="rounded-t-2xl bg-[var(--wa-panel)] px-6 pt-4 pb-6">
						{step === "done" ? (
							<div className="flex flex-col items-center gap-2 py-8">
								<CheckCircle2 className="size-14 text-[var(--wa-green)]" />
								<p className="text-lg font-medium">Payment sent</p>
								<p className="text-sm text-[var(--wa-muted)]">
									{formatMYR(invoice.amountSen)} to {props.businessName}
								</p>
							</div>
						) : (
							<div className="mx-auto max-w-lg">
								<div className="relative flex items-center justify-center pb-4">
									<button
										type="button"
										onClick={() => setStep("details")}
										disabled={sending}
										className="absolute left-0 rounded-full p-1.5 hover:bg-[var(--wa-hover)]"
									>
										<ArrowLeft className="size-5" />
										<span className="sr-only">Back</span>
									</button>
									<p className="font-medium">Confirm payment</p>
								</div>
								<div className="flex items-center gap-3 border-y border-[var(--wa-border)] py-3">
									<span className="flex h-8 w-11 items-center justify-center rounded bg-[#1a4fb4]">
										<CreditCard className="size-4 text-white" />
									</span>
									<div className="flex-1">
										<p className="text-xs text-[var(--wa-muted)]">
											Payment method
										</p>
										<p>{CARD}</p>
									</div>
								</div>
								<div className="flex justify-between py-4">
									<span>Total</span>
									<span className="font-medium tabular-nums">
										{formatMYR(invoice.amountSen)}
									</span>
								</div>
								<button
									type="button"
									onClick={send}
									disabled={sending}
									className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--wa-green)] py-3 font-medium text-black hover:brightness-110 disabled:opacity-70"
								>
									{sending && <Loader2 className="size-4 animate-spin" />}
									{sending ? "Sending…" : "Send payment"}
								</button>
								<p className="pt-3 text-center text-[11px] text-[var(--wa-muted)]">
									Demo payment: no money is charged.
								</p>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
