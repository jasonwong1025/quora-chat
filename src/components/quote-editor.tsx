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
	draft: "Draft",
	approved: "Approved · awaiting signature",
	rejected: "Rejected",
	accepted: "Signed by customer",
	superseded: "Replaced by a newer revision",
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
		if (!actingAs) return toast.error("Choose who you are acting as first");
		try {
			const reviewed = dirty ? await save() : quote;
			if (!reviewed) return;
			await decide.mutateAsync({
				quoteId: quote.id,
				staffId: actingAs.id,
				decision,
				reviewToken: quoteReviewToken(reviewed),
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
						· {editable ? "Draft" : quoteStatusLabel[quote.status]}
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

			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="text-xs text-muted-foreground">
						<tr className="border-b">
							<th className="px-3 py-1.5 text-left font-medium">Item</th>
							<th className="w-20 px-1 py-1.5 text-right font-medium">Qty</th>
							<th className="w-24 px-1 py-1.5 text-right font-medium">
								Unit (RM)
							</th>
							<th className="w-24 px-3 py-1.5 text-right font-medium">
								Amount
							</th>
							{editable && <th className="w-8" />}
						</tr>
					</thead>
					<tbody>
						{lines.map((l, i) => (
							<tr
								key={`${quote.id}-${i}`}
								className="border-b align-top last:border-0"
							>
								<td className="min-w-44 px-3 py-1.5">
									{editable ? (
										<Input
											value={l.description}
											onChange={(e) =>
												patch(i, { description: e.target.value })
											}
											className="h-8"
										/>
									) : (
										l.description
									)}
									{l.notes && (
										<p className="mt-0.5 text-xs text-muted-foreground">
											{l.notes}
										</p>
									)}
								</td>
								<td className="px-1 py-1.5 text-right">
									{editable ? (
										<Input
											type="number"
											min={1}
											value={l.quantity}
											onChange={(e) =>
												patch(i, {
													quantity: Math.max(1, Number(e.target.value) || 1),
												})
											}
											className="h-8 text-right"
										/>
									) : (
										`${l.quantity} ${l.unit}`
									)}
								</td>
								<td className="px-1 py-1.5 text-right">
									{editable ? (
										<Input
											type="number"
											min={0}
											step="0.01"
											value={(l.unitPriceSen / 100).toFixed(2)}
											onChange={(e) =>
												patch(i, {
													unitPriceSen: parseMYR(e.target.value) ?? 0,
												})
											}
											className={`h-8 text-right ${l.unitPriceSen === 0 ? "border-status-review" : ""}`}
										/>
									) : (
										formatMYR(l.unitPriceSen)
									)}
								</td>
								<td className="px-3 py-1.5 text-right tabular-nums">
									{formatMYR(l.amountSen)}
								</td>
								{editable && (
									<td className="py-1.5 pr-2">
										<Button
											variant="ghost"
											size="icon"
											className="size-8"
											onClick={() => {
												setDirty(true);
												setLines((ls) => ls.filter((_, idx) => idx !== i));
											}}
										>
											<Trash2 className="size-4" />
										</Button>
									</td>
								)}
							</tr>
						))}
						{lines.length === 0 && (
							<tr>
								<td
									colSpan={5}
									className="px-3 py-4 text-center text-xs text-muted-foreground"
								>
									No priced lines yet — add them manually after assessment.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>

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
							onClick={() => act("rejected")}
							disabled={decide.isPending || !actingAs?.canApprove}
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
