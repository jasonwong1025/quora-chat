import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BellOff,
	BellRing,
	FileText,
	Loader2,
	Receipt,
	SendHorizontal,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "#/components/orbyte/workspace";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { triggerLabel } from "#/lib/billing";
import { formatMYR } from "#/lib/money";
import type { JobBilling } from "#/lib/types";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

type Billing = JobBilling;
type Line = Billing["plan"][number];

const day = (d: Date) =>
	d.toLocaleDateString("en-MY", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "Asia/Kuala_Lumpur",
	});
const when = (d: Date) =>
	d.toLocaleString("en-MY", {
		day: "numeric",
		month: "short",
		hour: "numeric",
		minute: "2-digit",
		timeZone: "Asia/Kuala_Lumpur",
	});

const docLabel = {
	receipt: "Receipt",
	statement: "Statement of account",
	completion_report: "Completion report",
} as const;

/** Instalments, invoices, payments, receipts and documents for one job. */
export function BillingTab({ jobId }: { jobId: string }) {
	const { me } = useWorkspace();
	const queryClient = useQueryClient();
	const billing = useQuery({
		...orpc.billing.job.queryOptions({ input: { jobId } }),
		refetchInterval: 4000,
	});
	const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.key() });
	const statement = useMutation(
		orpc.billing.statement.mutationOptions({ onSuccess: refresh }),
	);

	if (!billing.data)
		return (
			<p className="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Loading…
			</p>
		);
	const b = billing.data;

	return (
		<div className="mx-auto max-w-4xl space-y-5">
			{b.cancelled && (
				<div className="border border-status-rejected/30 bg-status-rejected/10 px-4 py-3 text-sm">
					This order is cancelled. Nothing further is due; paid amounts remain
					recorded for refund review.
				</div>
			)}
			<div className="grid grid-cols-3 gap-px border bg-border">
				{[
					["Quotation", formatMYR(b.totalSen), b.quoteNumber],
					[
						"Paid",
						formatMYR(b.paidSen),
						`${b.plan.filter((p) => p.invoice?.status === "paid").length} of ${b.plan.length} instalments`,
					],
					[
						"Balance",
						formatMYR(b.balanceSen),
						b.cancelled
							? "Nothing further due"
							: b.balanceSen <= 0
								? "Fully paid"
								: "Outstanding",
					],
				].map(([label, value, hint]) => (
					<div key={label} className="bg-card px-4 py-3">
						<p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
							{label}
						</p>
						<p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
						<p className="text-[11px] text-muted-foreground">{hint}</p>
					</div>
				))}
			</div>

			<section className="border bg-card">
				<h2 className="flex h-11 items-center border-b px-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Payment schedule
				</h2>
				<ul className="divide-y">
					{b.plan.map((p) => (
						<InstalmentRow
							key={p.index}
							line={p}
							cancelled={b.cancelled}
							staffId={me?.id}
							onDone={refresh}
						/>
					))}
				</ul>
			</section>

			<section className="border bg-card">
				<div className="flex h-11 items-center justify-between border-b px-4">
					<h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Documents sent
					</h2>
					<Button
						size="sm"
						variant="ghost"
						disabled={!me || statement.isPending || b.cancelled}
						title={b.cancelled ? "The order is cancelled" : undefined}
						onClick={() =>
							me &&
							statement
								.mutateAsync({ jobId, staffId: me.id })
								.then(() => toast.success("Statement sent on WhatsApp"))
								.catch((err) =>
									toast.error(err instanceof Error ? err.message : "Not sent"),
								)
						}
					>
						{statement.isPending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<SendHorizontal className="size-4" />
						)}
						Send statement
					</Button>
				</div>
				{b.documents.length === 0 ? (
					<p className="px-4 py-4 text-sm text-muted-foreground">None yet</p>
				) : (
					<ul className="divide-y">
						{b.documents.map((d) => (
							<li key={`${d.kind}:${d.id}:${d.at.getTime()}`}>
								<a
									href={`/api/documents/${d.kind}/${d.id}`}
									target="_blank"
									rel="noreferrer"
									className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40"
								>
									<FileText className="size-4 text-muted-foreground" />
									<span className="flex-1">{d.name}</span>
									<span className="text-xs text-muted-foreground">
										{docLabel[d.kind]} · {day(d.at)}
									</span>
								</a>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

function InstalmentRow(props: {
	line: Line;
	cancelled: boolean;
	staffId: string | undefined;
	onDone: () => void;
}) {
	const { line: p } = props;
	const inv = p.invoice;
	const [recording, setRecording] = useState(false);
	const overdue = inv?.status === "sent" && inv.dueAt < new Date();
	const next = p.reminders.find((r) => r.status === "scheduled");
	const sent = p.reminders.filter((r) => r.status === "sent").length;
	const reminder = useMutation(
		orpc.billing.reminder.mutationOptions({ onSuccess: props.onDone }),
	);
	const act = (action: "pause" | "resume" | "send_now") =>
		inv &&
		props.staffId &&
		reminder
			.mutateAsync({ invoiceId: inv.id, staffId: props.staffId, action })
			.then(() =>
				toast.success(
					action === "send_now"
						? "Reminder sent"
						: action === "pause"
							? "Reminders paused"
							: "Reminders resumed",
				),
			)
			.catch((err) =>
				toast.error(err instanceof Error ? err.message : "Failed"),
			);

	return (
		<li className="px-4 py-3">
			<div className="flex flex-wrap items-start gap-x-4 gap-y-1">
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium">
						{p.label}{" "}
						<span className="font-normal text-muted-foreground">
							· {p.percent}% · {triggerLabel(p)}
						</span>
					</p>
					<p className="text-xs text-muted-foreground">
						{!inv
							? props.cancelled
								? "Not invoiced · no longer due"
								: "Not invoiced yet"
							: inv.status === "paid"
								? `${inv.number} · paid ${inv.paidAt ? day(inv.paidAt) : ""}`
								: inv.status === "void"
									? `${inv.number} · cancelled with the order`
									: `${inv.number} · sent ${day(inv.issuedAt)} · due ${day(inv.dueAt)}`}
					</p>
				</div>
				<p className="text-sm font-semibold tabular-nums">
					{formatMYR(p.amountSen)}
				</p>
				<span
					className={cn(
						"px-1.5 py-0.5 text-[11px] font-medium",
						!inv && "bg-muted text-muted-foreground",
						inv?.status === "paid" &&
							"bg-status-approved/15 text-status-approved",
						inv?.status === "sent" &&
							(overdue
								? "bg-status-rejected/15 text-status-rejected"
								: "bg-status-draft/10 text-status-draft"),
						inv?.status === "void" &&
							"bg-status-rejected/10 text-status-rejected",
					)}
				>
					{!inv
						? props.cancelled
							? "Cancelled"
							: "Scheduled"
						: inv.status === "paid"
							? "Paid"
							: inv.status === "void"
								? "Cancelled"
								: overdue
									? "Overdue"
									: "Awaiting payment"}
				</span>
			</div>

			{inv && (
				<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
					<a
						href={`/api/documents/invoice/${inv.id}`}
						target="_blank"
						rel="noreferrer"
						className="flex items-center gap-1 text-primary hover:underline"
					>
						<FileText className="size-3.5" /> Invoice
					</a>
					{p.payments.map((pay) => (
						<a
							key={pay.id}
							href={`/api/documents/receipt/${pay.id}`}
							target="_blank"
							rel="noreferrer"
							className="flex items-center gap-1 text-primary hover:underline"
						>
							<Receipt className="size-3.5" /> {pay.receiptNumber} ·{" "}
							{pay.method === "card"
								? (pay.reference ?? "card")
								: pay.method === "cash"
									? "cash"
									: "bank transfer"}
						</a>
					))}
					{inv.status === "sent" && (
						<>
							<span className="text-muted-foreground">
								{inv.remindersPaused
									? "Reminders paused"
									: next
										? `Next reminder ${when(next.dueAt)} (${sent} sent)`
										: `${sent} reminder${sent === 1 ? "" : "s"} sent`}
							</span>
							<span className="ml-auto flex gap-1">
								<Button
									size="sm"
									variant="ghost"
									disabled={reminder.isPending || !props.staffId}
									onClick={() => act(inv.remindersPaused ? "resume" : "pause")}
								>
									{inv.remindersPaused ? (
										<BellRing className="size-3.5" />
									) : (
										<BellOff className="size-3.5" />
									)}
									{inv.remindersPaused ? "Resume" : "Pause"}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									disabled={reminder.isPending || !props.staffId}
									onClick={() => act("send_now")}
								>
									<SendHorizontal className="size-3.5" /> Remind now
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() => setRecording((r) => !r)}
								>
									Record payment
								</Button>
							</span>
						</>
					)}
				</div>
			)}
			{next &&
				inv?.status === "sent" &&
				!inv.remindersPaused &&
				next.reason && (
					<p className="mt-1 text-[11px] text-muted-foreground">
						{next.reason}
					</p>
				)}
			{recording && inv && (
				<RecordPayment
					invoiceId={inv.id}
					staffId={props.staffId}
					onDone={() => {
						setRecording(false);
						props.onDone();
					}}
				/>
			)}
		</li>
	);
}

/** Money received outside the chat (bank transfer, cash). A receipt goes out automatically. */
function RecordPayment(props: {
	invoiceId: string;
	staffId: string | undefined;
	onDone: () => void;
}) {
	const [method, setMethod] = useState<"bank_transfer" | "cash">(
		"bank_transfer",
	);
	const [reference, setReference] = useState("");
	const record = useMutation(orpc.billing.record.mutationOptions());
	return (
		<form
			className="mt-2 flex flex-wrap items-center gap-2 bg-muted/50 p-2"
			onSubmit={async (e) => {
				e.preventDefault();
				if (!props.staffId)
					return toast.error("Choose who you are signed in as first");
				try {
					await record.mutateAsync({
						invoiceId: props.invoiceId,
						staffId: props.staffId,
						method,
						reference: reference.trim() || null,
					});
					toast.success("Payment recorded; receipt sent on WhatsApp");
					props.onDone();
				} catch (err) {
					toast.error(err instanceof Error ? err.message : "Not recorded");
				}
			}}
		>
			<Select
				value={method}
				onValueChange={(v) => setMethod(v as typeof method)}
			>
				<SelectTrigger
					size="sm"
					className="w-36 bg-card"
					aria-label="Payment method"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent position="popper">
					<SelectItem value="bank_transfer">Bank transfer</SelectItem>
					<SelectItem value="cash">Cash</SelectItem>
				</SelectContent>
			</Select>
			<Input
				value={reference}
				onChange={(e) => setReference(e.target.value)}
				placeholder="Reference (optional)"
				aria-label="Payment reference"
				className="h-8 w-48 bg-card"
			/>
			<Button size="sm" disabled={record.isPending}>
				{record.isPending && <Loader2 className="size-4 animate-spin" />}
				Record
			</Button>
		</form>
	);
}
