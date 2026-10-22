import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FastForward, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AiModeBadge } from "#/components/ai-mode";
import { useWorkspace } from "#/components/orbyte/workspace";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { orpc } from "#/orpc/client";

/** Demo only: skip ahead in time so follow-ups, extensions and expiry can be shown live. */
export function DemoClock() {
	const { business, me } = useWorkspace();
	const queryClient = useQueryClient();
	const skip = useMutation(orpc.demo.fastForward.mutationOptions());
	const [resetting, setResetting] = useState(false);

	async function go(days: number) {
		try {
			const r = await skip.mutateAsync({ businessId: business.id, days });
			await queryClient.invalidateQueries({ queryKey: orpc.key() });
			if (r.happened.length)
				toast.success(`+${days} day${days > 1 ? "s" : ""}`, {
					description: r.happened.join(" · "),
				});
			else toast(`+${days} day${days > 1 ? "s" : ""}: nothing was due yet`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		}
	}

	return (
		<div className="rounded-lg border border-dashed border-white/20 px-2.5 py-2">
			<AiModeBadge className="mb-1.5 text-white/70" />
			<p className="flex items-center gap-1.5 text-[11px] font-medium text-white/60">
				{skip.isPending ? (
					<Loader2 className="size-3 animate-spin" />
				) : (
					<FastForward className="size-3" />
				)}
				Demo clock
			</p>
			<div className="mt-1.5 flex gap-1.5">
				{[1, 3, 7].map((d) => (
					<button
						key={d}
						type="button"
						disabled={skip.isPending}
						onClick={() => go(d)}
						className="flex-1 rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20 disabled:opacity-50"
					>
						+{d}d
					</button>
				))}
			</div>
			{me?.canApprove && (
				<button
					type="button"
					onClick={() => setResetting(true)}
					className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-white/60 hover:bg-white/10 hover:text-white"
				>
					<RotateCcw className="size-3" /> Reset demo
				</button>
			)}
			{resetting && <ResetDialog onClose={() => setResetting(false)} />}
		</div>
	);
}

function ResetDialog({ onClose }: { onClose: () => void }) {
	const { business, me } = useWorkspace();
	const queryClient = useQueryClient();
	const reset = useMutation(orpc.demo.reset.mutationOptions());
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="orbyte max-w-md">
				<DialogHeader>
					<DialogTitle>Reset the {business.name} demo?</DialogTitle>
					<DialogDescription>
						This clears every chat, quotation, reminder, job, team chat,
						notification and activity entry for {business.name}, and returns
						stock they reserved. The catalog, staff, preset questions, pricing
						rules and knowledge base stay. Other businesses aren't touched. It
						can't be undone.
					</DialogDescription>
				</DialogHeader>
				<p className="text-xs text-muted-foreground">
					Customers' WhatsApp tabs keep their chosen name; reload them after
					resetting.
				</p>
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						disabled={reset.isPending || !me}
						onClick={async () => {
							if (!me) return;
							try {
								const r = await reset.mutateAsync({
									businessId: business.id,
									staffId: me.id,
								});
								await queryClient.invalidateQueries({ queryKey: orpc.key() });
								toast.success(`${business.name} demo reset`, {
									description: `Cleared ${r.conversations} chats, ${r.quotes} quotes and ${r.jobs} jobs.`,
								});
								onClose();
							} catch (err) {
								toast.error(err instanceof Error ? err.message : "Failed");
							}
						}}
					>
						{reset.isPending && <Loader2 className="size-4 animate-spin" />}
						Reset demo
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
