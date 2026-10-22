import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import type { LineItem } from "#/db/schema";
import { quoteReviewToken } from "#/lib/agreements";
import { formatMYR, parseMYR } from "#/lib/money";
import type { BusinessDetail, RequestRow, Staff } from "#/lib/types";
import { orpc } from "#/orpc/client";

type Quote = NonNullable<RequestRow["quote"]>;

const quoteStatusLabel: Record<Quote["status"], string> = {
	draft: "Draft · pending approval",
	approved: "Sent · awaiting signature",
	rejected: "Rejected",
	accepted: "Signed by customer",
	superseded: "Superseded by a newer revision",
	lost: "Lost",
};

/** Render with a `key` that changes when the server version changes, to reset local edits. */
export function QuoteEditor(props: {
	business: BusinessDetail;
	quote: Quote;
	actingAs: Staff | undefined;
	onHold?: string | null;
}) {
	const { business, quote, actingAs } = props;
	const queryClient = useQueryClient();
	const [lines, setLines] = useState<LineItem[]>(quote.lineItems);
	const [notes, setNotes] = useState(quote.notes ?? "");
	const [dirty, setDirty] = useState(false);
	// What staff are typing in each price box, so it isn't reformatted mid-keystroke.
	const [priceText, setPriceText] = useState<Record<number, string>>({});
	const [rejecting, setRejecting] = useState(false);
	const [reason, setReason] = useState("");
	const decidedBy = business.staff.find((s) => s.id === quote.decidedBy)?.name;

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.key() });
	const update = useMutation(
		orpc.quotes.update.mutationOptions({ onSuccess: invalidate }),
	);
	const decide = useMutation(
		orpc.quotes.decide.mutationOptions({ onSuccess: invalidate }),
	);

	const editable = quote.status === "draft" && !props.onHold;
	const subtotal = lines.reduce((s, l) => s + l.amountSen, 0);
	const sst = business.sstRegistered
		? Math.round((subtotal * business.sstRateBps) / 10000)
		: 0;

	function patch(i: number, change: Partial<LineItem>) {
		setDirty(true);
		setLines((ls) =>
			ls.map((l, idx) => {
				if (idx !== i) return l;
				const next = { ...l, ...change };
				// Editing qty or price recalculates the amount (drops minimum-charge adjustments).
				if ("quantity" in change || "unitPriceSen" in change) {
					next.amountSen = next.unitPriceSen * next.quantity;
				}
				return next;
			}),
		);
	}

	async function save() {
		if (!actingAs) {
			toast.error("Choose who you are acting as first");
			return;
		}
		const saved = await update.mutateAsync({
			quoteId: quote.id,
			staffId: actingAs.id,
			lineItems: lines,
			notes: notes.trim() || null,
			reviewToken: quoteReviewToken(quote),
		});
		setDirty(false);
		return saved;
	}

	async function act(decision: "approved" | "rejected") {
		if (decision === "rejected" && !reason.trim())
			return toast.error("Give a reason for rejecting");
		if (!actingAs) return toast.error("Choose who you are acting as first");
		try {
			const reviewed = dirty ? await save() : quote;
			if (!reviewed) return;
			await decide.mutateAsync({
				quoteId: quote.id,
				staffId: actingAs.id,
				decision,
				reviewToken: quoteReviewToken(reviewed),
				...(decision === "rejected" ? { reason: reason.trim() } : {}),
			});
			toast.success(
				decision === "approved"
					? `${quote.number} approved and sent`
					: `${quote.number} rejected`,
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Action failed");
		}
	}

	return (
		<div className="rounded-lg border">
			{props.onHold && (
				<output className="block border-b bg-status-review/10 p-3 text-sm">
					{props.onHold}
				</output>
			)}
			<div className="flex items-center justify-between border-b px-3 py-2">
				<p className="text-sm font-semibold">
					{quote.number}{" "}
					<span className="font-normal text-muted-foreground">
						·{" "}
						{editable ? quoteStatusLabel.draft : quoteStatusLabel[quote.status]}
					</span>
				</p>
				<a
					href={`/api/quotes/${quote.id}/pdf`}
					target="_blank"
					rel="noreferrer"
					className="flex items-center gap-1 text-xs text-primary hover:underline"
				>
					PDF <ExternalLink className="size-3" />
				</a>
			</div>

			{editable ? (
				// Editing: one card per line, so the fields stay usable in a narrow side panel.
				<ul className="divide-y">
					{lines.map((l, i) => (
						<li key={`${quote.id}-${i}`} className="space-y-2 px-3 py-2.5">
							<div>
								<Input
									aria-label={`Line ${i + 1} description`}
									value={l.description}
									onChange={(e) => patch(i, { description: e.target.value })}
									className="h-8"
								/>
								{l.notes && (
									<p className="mt-1 text-xs text-muted-foreground">
										{l.notes}
									</p>
								)}
							</div>
							<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-end gap-2">
								<div className="min-w-0 space-y-0.5 text-xs text-muted-foreground">
									<label htmlFor={`${quote.id}-qty-${i}`}>
										Qty{l.unit ? ` (${l.unit})` : ""}
									</label>
									<Input
										id={`${quote.id}-qty-${i}`}
										type="number"
										min={1}
										value={l.quantity}
										onChange={(e) =>
											patch(i, {
												quantity: Math.max(1, Number(e.target.value) || 1),
											})
										}
										className="h-8 text-right text-sm text-foreground"
									/>
								</div>
								<div className="min-w-0 space-y-0.5 text-xs text-muted-foreground">
									<label htmlFor={`${quote.id}-price-${i}`}>Unit (RM)</label>
									<Input
										id={`${quote.id}-price-${i}`}
										type="number"
										min={0}
										step="0.01"
										value={priceText[i] ?? (l.unitPriceSen / 100).toFixed(2)}
										onChange={(e) => {
											const text = e.target.value;
											setPriceText((t) => ({ ...t, [i]: text }));
											patch(i, { unitPriceSen: parseMYR(text) ?? 0 });
										}}
										onBlur={() =>
											setPriceText(({ [i]: _done, ...rest }) => rest)
										}
										className={`h-8 text-right text-sm text-foreground ${l.unitPriceSen === 0 ? "border-status-review" : ""}`}
									/>
								</div>
								<div className="space-y-0.5 text-right">
									<span className="text-xs text-muted-foreground">Amount</span>
									<p className="flex h-8 items-center justify-end text-sm font-medium whitespace-nowrap tabular-nums">
										{formatMYR(l.amountSen)}
									</p>
								</div>
								<Button
									variant="ghost"
									size="icon"
									className="size-8"
									aria-label={`Remove line ${i + 1}`}
									onClick={() => {
										setDirty(true);
										setLines((ls) => ls.filter((_, idx) => idx !== i));
									}}
								>
									<Trash2 className="size-4" />
								</Button>
							</div>
						</li>
					))}
					{lines.length === 0 && (
						<li className="px-3 py-4 text-center text-xs text-muted-foreground">
							No priced lines yet — add them manually after assessment.
						</li>
					)}
				</ul>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead className="text-xs text-muted-foreground">
							<tr className="border-b">
								<th className="px-3 py-1.5 text-left font-medium">Item</th>
								<th className="px-1 py-1.5 text-right font-medium">Qty</th>
								<th className="px-1 py-1.5 text-right font-medium">Unit</th>
								<th className="px-3 py-1.5 text-right font-medium">Amount</th>
							</tr>
						</thead>
						<tbody>
							{lines.map((l, i) => (
								<tr
									key={`${quote.id}-${i}`}
									className="border-b align-top last:border-0"
								>
									<td className="px-3 py-1.5">
										{l.description}
										{l.notes && (
											<p className="mt-0.5 text-xs text-muted-foreground">
												{l.notes}
											</p>
										)}
									</td>
									<td className="px-1 py-1.5 text-right whitespace-nowrap">
										{l.quantity} {l.unit}
									</td>
									<td className="px-1 py-1.5 text-right whitespace-nowrap tabular-nums">
										{formatMYR(l.unitPriceSen)}
									</td>
									<td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
										{formatMYR(l.amountSen)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{editable && (
				<div className="px-3 py-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							setDirty(true);
							setLines((ls) => [
								...ls,
								{
									productId: null,
									description: "Custom item",
									quantity: 1,
									unit: "job",
									unitPriceSen: 0,
									amountSen: 0,
								},
							]);
						}}
					>
						<Plus className="size-4" /> Add line
					</Button>
				</div>
			)}

			<div className="space-y-0.5 border-t px-3 py-2 text-sm">
				<Row label="Subtotal" value={formatMYR(subtotal)} />
				{business.sstRegistered && (
					<Row
						label={`SST (${business.sstRateBps / 100}%)`}
						value={formatMYR(sst)}
					/>
				)}
				<Row label="Total" value={formatMYR(subtotal + sst)} bold />
			</div>

			{quote.status === "rejected" && (
				<p className="border-t px-3 py-2 text-sm">
					<span className="font-medium">
						Rejected{decidedBy ? ` by ${decidedBy}` : ""}:
					</span>{" "}
					{quote.decisionReason ?? "no reason recorded"}
				</p>
			)}
			{editable && (
				<div className="space-y-2 border-t p-3">
					<Textarea
						value={notes}
						onChange={(e) => {
							setDirty(true);
							setNotes(e.target.value);
						}}
						placeholder="Notes shown on the quotation (optional)"
						rows={2}
					/>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							onClick={() => act("approved")}
							disabled={
								decide.isPending || update.isPending || !actingAs?.canApprove
							}
						>
							{decide.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Check className="size-4" />
							)}
							Approve & send
						</Button>
						<Button
							variant="outline"
							onClick={() => setRejecting((r) => !r)}
							disabled={decide.isPending || !actingAs?.canApprove}
							aria-expanded={rejecting}
						>
							<X className="size-4" /> Reject
						</Button>
						{dirty && (
							<Button
								variant="ghost"
								onClick={save}
								disabled={update.isPending || !actingAs}
							>
								Save draft
							</Button>
						)}
						{rejecting && (
							<form
								className="flex w-full gap-2"
								onSubmit={(e) => {
									e.preventDefault();
									act("rejected");
								}}
							>
								<Input
									autoFocus
									value={reason}
									onChange={(e) => setReason(e.target.value)}
									maxLength={500}
									placeholder="Why? e.g. price needs a site visit first"
									aria-label="Reason for rejecting"
									className="h-9"
								/>
								<Button
									type="submit"
									variant="destructive"
									disabled={!reason.trim() || decide.isPending}
								>
									Reject quote
								</Button>
							</form>
						)}
						{actingAs && !actingAs.canApprove && (
							<p className="text-xs text-muted-foreground">
								{actingAs.name} ({actingAs.role}) can edit but not approve.
							</p>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function Row({
	label,
	value,
	bold,
}: {
	label: string;
	value: string;
	bold?: boolean;
}) {
	return (
		<div
			className={`flex justify-between ${bold ? "font-semibold" : "text-muted-foreground"}`}
		>
			<span>{label}</span>
			<span className="tabular-nums">{value}</span>
		</div>
	);
}
