import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The limits code enforces on the AI's follow-up timing. */
export function FollowUpRules({ onClose }: { onClose: () => void }) {
	const { business, me } = useWorkspace();
	const queryClient = useQueryClient();
	const save = useMutation(orpc.followUpRules.update.mutationOptions());
	const [form, setForm] = useState({
		followUpMax: business.followUpMax,
		followUpGapDays: business.followUpGapDays,
		workStart: business.workStart,
		workEnd: business.workEnd,
		workDays: business.workDays,
		extendDays: business.extendDays,
	});
	const set = (patch: Partial<typeof form>) =>
		setForm((f) => ({ ...f, ...patch }));
	const num = (v: string) => Math.max(0, Number(v.replace(/\D/g, "")) || 0);

	async function submit() {
		if (!me) return toast.error("Choose who you are signed in as first");
		try {
			await save.mutateAsync({
				businessId: business.id,
				staffId: me.id,
				...form,
			});
			await queryClient.invalidateQueries({ queryKey: orpc.businesses.key() });
			toast.success("Follow-up rules saved");
			onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Not saved");
		}
	}

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="orbyte max-w-md">
				<DialogHeader>
					<DialogTitle>Follow-up rules</DialogTitle>
					<DialogDescription>
						When a sent quotation isn't signed, the AI suggests when to nudge
						the customer. These limits always win.
					</DialogDescription>
				</DialogHeader>
				<div className="grid grid-cols-2 gap-3 text-sm">
					<Field label="Max reminders per quote">
						<Input
							inputMode="numeric"
							value={form.followUpMax}
							onChange={(e) =>
								set({ followUpMax: Math.min(10, num(e.target.value)) })
							}
						/>
					</Field>
					<Field label="At least … days apart">
						<Input
							inputMode="numeric"
							value={form.followUpGapDays}
							onChange={(e) =>
								set({ followUpGapDays: Math.max(1, num(e.target.value)) })
							}
						/>
					</Field>
					<Field label="Send from (Malaysia time)">
						<Input
							type="time"
							value={form.workStart}
							onChange={(e) => set({ workStart: e.target.value })}
						/>
					</Field>
					<Field label="Until">
						<Input
							type="time"
							value={form.workEnd}
							onChange={(e) => set({ workEnd: e.target.value })}
						/>
					</Field>
				</div>
				<Field label="On these days">
					<div className="flex flex-wrap gap-1">
						{days.map((d, i) => {
							const on = form.workDays.includes(i);
							return (
								<button
									key={d}
									type="button"
									onClick={() =>
										set({
											workDays: on
												? form.workDays.filter((x) => x !== i)
												: [...form.workDays, i].sort(),
										})
									}
									className={cn(
										"rounded-full border px-2.5 py-1 text-xs",
										on && "border-primary bg-primary text-primary-foreground",
									)}
								>
									{d}
								</button>
							);
						})}
					</div>
				</Field>
				<Field label="When it expires unsigned, extend once by … days (0 = don't)">
					<Input
						inputMode="numeric"
						value={form.extendDays}
						onChange={(e) =>
							set({ extendDays: Math.min(60, num(e.target.value)) })
						}
						className="w-24"
					/>
				</Field>
				<p className="text-xs text-muted-foreground">
					Reminders never offer discounts or change the quote. If the customer
					raises the price, reminders pause and approvers are notified. If they
					decline, or it expires after the extension, it's marked lost with the
					reason.
				</p>
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={
							save.isPending || !me?.canApprove || form.workDays.length === 0
						}
						onClick={submit}
					>
						{save.isPending && <Loader2 className="size-4 animate-spin" />}
						Save
					</Button>
				</div>
				{!me?.canApprove && (
					<p className="-mt-2 text-right text-xs text-muted-foreground">
						Only approvers can change these.
					</p>
				)}
			</DialogContent>
		</Dialog>
	);
}

function Field(props: { label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-1">
			<p className="text-xs text-muted-foreground">{props.label}</p>
			{props.children}
		</div>
	);
}
