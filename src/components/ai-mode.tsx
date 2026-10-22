import { useQuery } from "@tanstack/react-query";
import { Bot, Clapperboard } from "lucide-react";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

/** Which AI is answering: the live model, or the clearly labelled replay script. */
export function useAiMode() {
	return useQuery({
		...orpc.system.info.queryOptions(),
		staleTime: 60_000,
	}).data;
}

export function AiModeBadge({ className }: { className?: string }) {
	const info = useAiMode();
	if (!info) return null;
	const replay = info.aiMode === "replay";
	return (
		<p
			className={cn("flex items-center gap-1.5 text-[11px]", className)}
			title={
				replay
					? "AI_MODE=replay: the AI's reading of the demo script and its wording are scripted. Pricing, approvals, signing and jobs run for real."
					: `Live model: ${info.model}`
			}
		>
			{replay ? (
				<Clapperboard className="size-3 shrink-0" />
			) : (
				<Bot className="size-3 shrink-0" />
			)}
			<span className="truncate">
				{replay ? "Replay mode: scripted AI" : `AI: ${info.model}`}
			</span>
		</p>
	);
}
