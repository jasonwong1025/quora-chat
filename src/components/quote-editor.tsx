import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	Check,
	ExternalLink,
	Loader2,
	Plus,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import type { Charge, LineItem, QuoteTerms } from "#/db/schema";
import { quoteReviewToken } from "#/lib/agreements";
import { formatMYR, parseMYR } from "#/lib/money";
import {
	chargeLabel,
	chargeOf,
	chargeSuffix,
	groupLines,
	hasTerms,
	sumOf,
	totals,
	totalWeeks,
} from "#/lib/quote-lines";
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
	cancelled: "Cancelled by customer",
};

// Client-side React keys for editable lines, so removing a line doesn't reuse another line's inputs.
let lineKeySeq = 0;
const newLineKey = () => `line-${++lineKeySeq}`;

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
	const [lineKeys, setLineKeys] = useState<string[]>(() =>
		quote.lineItems.map(newLineKey),
	);
	const [notes, setNotes] = useState(quote.notes ?? "");
	const [terms, setTerms] = useState<QuoteTerms | null>(quote.terms ?? null);
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
	const t = totals(lines, business.sstRateBps, business.sstRegistered);
	const subtotal = t.subtotalSen;
	const sst = t.sstSen;
	const monthly = sumOf(lines, "monthly");
	const yearly = sumOf(lines, "yearly");
	const optional = sumOf(lines, "optional");
	const estimates = lines.filter((l) => l.source === "ai_estimate").length;
	const termsProblem =
		terms?.payments.length &&
		terms.payments.reduce((s, p) => s + p.percent, 0) !== 100
			? "Payments must add up to 100%"
			: null;

	function patchTerms(change: Partial<QuoteTerms>) {
		setDirty(true);
		setTerms((t) => ({
			phases: [],
			payments: [],
			assumptions: [],
			exclusions: [],
			...t,
			...change,
		}));
	}

	function patch(i: number, change: Partial<LineItem>) {
		setDirty(true);
		setLines((ls) =>
			ls.map((l, idx) => {
				if (idx !== i) return l;
				const next = { ...l, ...change };
				// Editing qty or price recalculates the amount (drops minimum-charge adjustments).
				if ("quantity" in change || "unitPriceSen" in change) {
					next.amountSen = next.unitPriceSen * next.quantity;
					// Staff have now set this number themselves: no longer an AI estimate.
					if (next.source === "ai_estimate") {
						delete next.source;
						delete next.estimate;
					}
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
		if (termsProblem) {
			toast.error(termsProblem);
			return;
		}
		const cleanTerms =
			terms && hasTerms(terms)
				? {
						phases: terms.phases.filter((p) => p.name.trim() && p.weeks > 0),
						payments: terms.payments.filter(
							(p) => p.label.trim() && p.percent > 0,
						),
						assumptions: terms.assumptions.map((a) => a.trim()).filter(Boolean),
						exclusions: terms.exclusions.map((a) => a.trim()).filter(Boolean),
					}
				: null;
		const saved = await update.mutateAsync({
			quoteId: quote.id,
			staffId: actingAs.id,
			lineItems: lines,
			notes: notes.trim() || null,
			terms: cleanTerms,
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
		<div className="border">
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
						<li key={lineKeys[i]} className="space-y-2 px-3 py-2.5">
							<div>
								<div className="flex gap-1">
									<Input
										aria-label={`Line ${i + 1} description`}
										value={l.description}
										onChange={(e) => patch(i, { description: e.target.value })}
										className="h-8 min-w-0 flex-1"
									/>
									<Button
										variant="ghost"
										size="icon"
										className="size-8 shrink-0"
										aria-label={`Remove line ${i + 1}`}
										onClick={() => {
											setDirty(true);
											setLines((ls) => ls.filter((_, idx) => idx !== i));
											setLineKeys((ks) => ks.filter((_, idx) => idx !== i));
										}}
									>
										<Trash2 className="size-4" />
									</Button>
								</div>
								{l.source === "ai_estimate" && (
									<p className="mt-1 flex items-start gap-1.5 bg-muted/60 px-2 py-1 text-xs">
										<Sparkles className="mt-0.5 size-3 shrink-0 text-status-review" />
										<span>
											<span className="font-medium">
												AI estimate, please check.
											</span>{" "}
											{l.estimate?.reasoning}
										</span>
									</p>
								)}

								{l.notes && (
									<p className="mt-1 text-xs text-muted-foreground">
										{l.notes}
									</p>
								)}
							</div>
							<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2">
								<div className="min-w-0 space-y-0.5 text-xs text-muted-foreground">
									<label htmlFor={`${quote.id}-qty-${i}`}>
										Qty{l.unit ? ` · ${l.unit}` : ""}
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
										{chargeSuffix[chargeOf(l)]}
									</p>
									<Select
										value={chargeOf(l)}
										onValueChange={(v) => patch(i, { charge: v as Charge })}
									>
										<SelectTrigger
											size="sm"
											className="ml-auto h-6 w-auto gap-1 border-0 px-1 text-xs text-muted-foreground shadow-none"
											aria-label={`Line ${i + 1} charged`}
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent position="popper" align="end">
											{(Object.keys(chargeLabel) as Charge[]).map((c) => (
												<SelectItem key={c} value={c}>
													{chargeLabel[c]}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
						</li>
					))}
					{lines.length === 0 && (
						<li className="px-3 py-4 text-center text-xs text-muted-foreground">
							No lines yet
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
							{groupLines(lines).flatMap((group) => [
								group.charge === "one_time" ? null : (
									<tr key={group.charge} className="border-b bg-muted/40">
										<td colSpan={4} className="px-3 py-1 text-xs font-medium">
											{group.charge === "optional"
												? "Optional add-ons (not in total)"
												: `${chargeLabel[group.charge]} (not in total)`}
										</td>
									</tr>
								),
								...group.lines.map(({ line: l, index: i }) => (
									<tr
										key={lineKeys[i]}
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
											{chargeSuffix[group.charge]}
										</td>
									</tr>
								)),
							])}
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
							setLineKeys((ks) => [...ks, newLineKey()]);
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
				{monthly > 0 && (
					<Row label="Plus monthly" value={`${formatMYR(monthly)} / month`} />
				)}
				{yearly > 0 && (
					<Row label="Plus yearly" value={`${formatMYR(yearly)} / year`} />
				)}
				{optional > 0 && (
					<Row
						label="Optional add-ons (not in total)"
						value={formatMYR(optional)}
					/>
				)}
				{editable && estimates > 0 && (
					<p className="pt-1 text-xs text-status-review">
						{estimates} AI estimate{estimates === 1 ? "" : "s"} to check
					</p>
				)}
			</div>

			{(terms || editable) && (
				<TermsEditor
					terms={terms}
					editable={editable}
					problem={termsProblem}
					onChange={patchTerms}
					onClear={() => {
						setDirty(true);
						setTerms(null);
					}}
				/>
			)}

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
								Only approvers can approve
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

const splitLines = (text: string) => text.split("\n");

/** Timeline, payment schedule and terms. Starts from the price list; staff can change it. */
function TermsEditor(props: {
	terms: QuoteTerms | null;
	editable: boolean;
	problem: string | null;
	onChange: (change: Partial<QuoteTerms>) => void;
	onClear: () => void;
}) {
	const t = props.terms;
	if (!props.editable) {
		if (!t || !hasTerms(t)) return null;
		return (
			<div className="space-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
				{t.phases.length > 0 && (
					<p>
						<span className="font-medium text-foreground">
							Timeline ~{totalWeeks(t)} wk:
						</span>{" "}
						{t.phases.map((p) => `${p.name} ${p.weeks}w`).join(" → ")}
					</p>
				)}
				{t.payments.length > 0 && (
					<p>
						<span className="font-medium text-foreground">Payments:</span>{" "}
						{t.payments.map((p) => `${p.percent}% ${p.label}`).join(", ")}
					</p>
				)}
			</div>
		);
	}
	if (!t)
		return (
			<div className="border-t px-3 py-2">
				<Button
					variant="ghost"
					size="sm"
					onClick={() =>
						props.onChange({
							phases: [],
							payments: [],
							assumptions: [],
							exclusions: [],
						})
					}
				>
					<Plus className="size-4" /> Add timeline & payment terms
				</Button>
			</div>
		);
	const setPhase = (i: number, change: Partial<QuoteTerms["phases"][number]>) =>
		props.onChange({
			phases: t.phases.map((p, idx) => (idx === i ? { ...p, ...change } : p)),
		});
	const setPayment = (
		i: number,
		change: Partial<QuoteTerms["payments"][number]>,
	) =>
		props.onChange({
			payments: t.payments.map((p, idx) =>
				idx === i ? { ...p, ...change } : p,
			),
		});
	return (
		<div className="space-y-3 border-t px-3 py-3 text-sm">
			<div className="flex items-center justify-between">
				<p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Timeline & terms
				</p>
				<Button variant="ghost" size="sm" onClick={props.onClear}>
					Remove
				</Button>
			</div>
			<div className="space-y-1.5">
				<p className="text-xs text-muted-foreground">
					Timeline{t.phases.length ? ` · about ${totalWeeks(t)} weeks` : ""}
				</p>
				{t.phases.map((p, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: rows have no id; order is the identity
					<div key={i} className="flex gap-2">
						<Input
							aria-label={`Phase ${i + 1} name`}
							value={p.name}
							onChange={(e) => setPhase(i, { name: e.target.value })}
							className="h-8 flex-1"
						/>
						<Input
							aria-label={`Phase ${i + 1} weeks`}
							type="number"
							min={1}
							value={p.weeks}
							onChange={(e) =>
								setPhase(i, {
									weeks: Math.max(1, Math.round(Number(e.target.value)) || 1),
								})
							}
							className="h-8 w-16 text-right"
						/>
						<span className="self-center text-xs text-muted-foreground">
							wk
						</span>
						<Button
							variant="ghost"
							size="icon"
							className="size-8"
							aria-label={`Remove phase ${i + 1}`}
							onClick={() =>
								props.onChange({
									phases: t.phases.filter((_, idx) => idx !== i),
								})
							}
						>
							<Trash2 className="size-4" />
						</Button>
					</div>
				))}
				<Button
					variant="outline"
					size="sm"
					onClick={() =>
						props.onChange({
							phases: [...t.phases, { name: "New phase", weeks: 1 }],
						})
					}
				>
					<Plus className="size-4" /> Phase
				</Button>
			</div>
			<div className="space-y-1.5">
				<p className="text-xs text-muted-foreground">Payment schedule</p>
				{t.payments.map((p, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: rows have no id; order is the identity
					<div key={i} className="flex gap-2">
						<Input
							aria-label={`Payment ${i + 1} percent`}
							type="number"
							min={1}
							max={100}
							value={p.percent}
							onChange={(e) =>
								setPayment(i, {
									percent: Math.min(
										100,
										Math.max(1, Math.round(Number(e.target.value)) || 1),
									),
								})
							}
							className="h-8 w-16 text-right"
						/>
						<span className="self-center text-xs text-muted-foreground">%</span>
						<Input
							aria-label={`Payment ${i + 1} name`}
							value={p.label}
							onChange={(e) => setPayment(i, { label: e.target.value })}
							className="h-8 min-w-0 flex-1"
						/>
						<Select
							value={
								p.when === "phase" && p.phase
									? `phase:${p.phase}`
									: (p.when ??
										(i === 0 && t.payments.length > 1 ? "signed" : "completed"))
							}
							onValueChange={(v) =>
								setPayment(
									i,
									v.startsWith("phase:")
										? { when: "phase", phase: v.slice(6) }
										: { when: v as "signed" | "completed", phase: null },
								)
							}
						>
							<SelectTrigger
								size="sm"
								className="w-36 shrink-0"
								aria-label={`Payment ${i + 1} due`}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent position="popper">
								<SelectItem value="signed">On signing</SelectItem>
								{t.phases
									.filter((ph) => ph.name.trim())
									.map((ph) => (
										<SelectItem key={ph.name} value={`phase:${ph.name}`}>
											After {ph.name}
										</SelectItem>
									))}
								<SelectItem value="completed">On completion</SelectItem>
							</SelectContent>
						</Select>
						<Button
							variant="ghost"
							size="icon"
							className="size-8"
							aria-label={`Remove payment ${i + 1}`}
							onClick={() =>
								props.onChange({
									payments: t.payments.filter((_, idx) => idx !== i),
								})
							}
						>
							<Trash2 className="size-4" />
						</Button>
					</div>
				))}
				<Button
					variant="outline"
					size="sm"
					onClick={() =>
						props.onChange({
							payments: [
								...t.payments,
								{
									label: "On completion",
									percent: Math.max(
										1,
										100 - t.payments.reduce((s, x) => s + x.percent, 0),
									),
								},
							],
						})
					}
				>
					<Plus className="size-4" /> Payment
				</Button>
				{props.problem && (
					<p className="text-xs text-destructive">{props.problem}</p>
				)}
			</div>
			<div className="grid gap-2 sm:grid-cols-2">
				<div className="space-y-1 text-xs text-muted-foreground">
					Assumptions (one per line)
					<Textarea
						aria-label="Assumptions"
						rows={3}
						value={t.assumptions.join("\n")}
						onChange={(e) =>
							props.onChange({ assumptions: splitLines(e.target.value) })
						}
						className="text-sm text-foreground"
					/>
				</div>
				<div className="space-y-1 text-xs text-muted-foreground">
					Not included (one per line)
					<Textarea
						aria-label="Not included"
						rows={3}
						value={t.exclusions.join("\n")}
						onChange={(e) =>
							props.onChange({ exclusions: splitLines(e.target.value) })
						}
						className="text-sm text-foreground"
					/>
				</div>
			</div>
		</div>
	);
}
