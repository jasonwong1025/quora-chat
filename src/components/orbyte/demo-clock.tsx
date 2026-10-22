import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FastForward, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AiModeBadge } from "#/components/ai-mode";
import { useWorkspace } from "#/components/orbyte/workspace";
import { orpc } from "#/orpc/client";

/** Demo only: skip ahead in time so follow-ups, extensions and expiry can be shown live. */
export function DemoClock() {
	const { business } = useWorkspace();
	const queryClient = useQueryClient();
	const skip = useMutation(orpc.demo.fastForward.mutationOptions());

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
		</div>
	);
}
