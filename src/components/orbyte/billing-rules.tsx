import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "#/components/orbyte/workspace";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import type { BillingSettings } from "#/db/schema";
import { defaultBilling, scheduleProblem } from "#/lib/billing";
import { orpc } from "#/orpc/client";

type Row = { label: string; percent: number; when: "signed" | "completed" };

/**
 * How this business gets paid by default. Custom items' price lists can set their
 * own schedule (with phases); this covers everything else.
 */
export function BillingRules({ onClose }: { onClose: () => void }) {
	const { business, me } = useWorkspace();
	const queryClient = useQueryClient();
	const start: BillingSettings = business.billing ?? defaultBilling();
	const [schedule, setSchedule] = useState<Row[]>(
		start.schedule.map((p) => ({
			label: p.label,
			percent: p.percent,
			when: p.when === "signed" ? "signed" : "completed",
		})),
	);
	const [dueDays, setDueDays] = useState(start.dueDays);
	const [statement, setStatement] = useState(start.statement);
	const [report, setReport] = useState(start.completionReport);
	const [why, setWhy] = useState<string | null>(null);
	const save = useMutation(orpc.billing.rules.update.mutationOptions());
	const suggest = useMutation(orpc.billing.rules.suggest.mutationOptions());
	const problem = scheduleProblem(schedule);

	const setRow = (i: number, change: Partial<Row>) =>
		setSchedule((rows) =>
			rows.map((r, idx) => (idx === i ? { ...r, ...change } : r)),
		);

	async function ask() {
		try {
			const r = await suggest.mutateAsync({ businessId: business.id });
			setSchedule(r.schedule);
			setDueDays(r.dueDays);
			setStatement(r.statement);
			setReport(r.completionReport);
			setWhy(r.reason);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Couldn't suggest");
		}
	}

	async function submit() {
		if (!me) return toast.error("Choose who you are signed in as first");
		if (problem) return toast.error(problem);
		try {
			await save.mutateAsync({
				businessId: business.id,
				staffId: me.id,
				billing: { schedule, dueDays, statement, completionReport: report },
			});
			await queryClient.invalidateQueries({ queryKey: orpc.businesses.key() });
			toast.success("Billing rules saved");
			onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Not saved");
		}
	}

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="orbyte max-w-lg">
				<DialogHeader>
					<DialogTitle>Billing rules</DialogTitle>
					<DialogDescription>
						Default payment schedule for signed quotations. Custom items with a
						price list use their own schedule.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 text-sm">
					<Button
						variant="outline"
						size="sm"
						onClick={ask}
						disabled={suggest.isPending}
					>
						{suggest.isPending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Sparkles className="size-4" />
						)}
						Suggest for my trade
					</Button>
					{why && <p className="bg-muted/60 px-3 py-2 text-xs">{why}</p>}

					<section className="space-y-1.5">
						<p className="font-medium">Payment schedule</p>
						{schedule.map((r, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: rows have no id
							<div key={i} className="flex items-center gap-2">
								<Input
									aria-label={`Payment ${i + 1} percent`}
									type="number"
									min={1}
									max={100}
									value={r.percent}
									onChange={(e) =>
										setRow(i, {
											percent: Math.min(
												100,
												Math.max(1, Math.round(Number(e.target.value)) || 1),
											),
										})
									}
									className="h-8 w-16 text-right"
								/>
								<span className="text-xs text-muted-foreground">%</span>
								<Input
									aria-label={`Payment ${i + 1} name`}
									value={r.label}
									onChange={(e) => setRow(i, { label: e.target.value })}
									className="h-8 min-w-0 flex-1"
								/>
								<Select
									value={r.when}
									onValueChange={(v) => setRow(i, { when: v as Row["when"] })}
								>
									<SelectTrigger size="sm" className="w-36" aria-label="When">
										<SelectValue />
									</SelectTrigger>
									<SelectContent position="popper">
										<SelectItem value="signed">On signing</SelectItem>
										<SelectItem value="completed">On completion</SelectItem>
									</SelectContent>
								</Select>
								<Button
									variant="ghost"
									size="icon"
									className="size-8"
									aria-label={`Remove payment ${i + 1}`}
									disabled={schedule.length === 1}
									onClick={() =>
										setSchedule((rows) => rows.filter((_, idx) => idx !== i))
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
								setSchedule((rows) => [
									...rows,
									{
										label: "Balance",
										percent: Math.max(
											1,
											100 - rows.reduce((s, x) => s + x.percent, 0),
										),
										when: "completed",
									},
								])
							}
						>
							<Plus className="size-4" /> Payment
						</Button>
						{problem && <p className="text-xs text-destructive">{problem}</p>}
					</section>

					<div className="flex items-center justify-between gap-3">
						<span>Invoices are due after</span>
						<span className="flex items-center gap-2">
							<Input
								type="number"
								aria-label="Days until invoices are due"
								min={0}
								max={90}
								value={dueDays}
								onChange={(e) =>
									setDueDays(
										Math.max(0, Math.min(90, Number(e.target.value) || 0)),
									)
								}
								className="h-8 w-16 text-right"
							/>
							days
						</span>
					</div>

					<section className="space-y-1.5">
						<p className="font-medium">When a job is completed, also send</p>
						<label className="flex items-center gap-2">
							<input
								type="checkbox"
								checked={report}
								onChange={(e) => setReport(e.target.checked)}
								className="accent-[var(--primary)]"
							/>
							Completion report
						</label>
						<label className="flex items-center gap-2">
							<input
								type="checkbox"
								checked={statement}
								onChange={(e) => setStatement(e.target.checked)}
								className="accent-[var(--primary)]"
							/>
							Statement of account
						</label>
						<p className="text-xs text-muted-foreground">
							Invoices and receipts are always sent.
						</p>
					</section>
				</div>

				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						onClick={submit}
						disabled={save.isPending || Boolean(problem)}
					>
						{save.isPending && <Loader2 className="size-4 animate-spin" />}
						Save
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
