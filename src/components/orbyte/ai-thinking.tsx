import {
	Brain,
	Calculator,
	ChevronDown,
	Eye,
	Lightbulb,
	ListChecks,
	Loader2,
	MessageSquareText,
	PackageSearch,
	PauseCircle,
	Scale,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import type { ThoughtStep } from "#/db/schema";
import type { AiRun } from "#/lib/types";
import { cn } from "#/lib/utils";

const stepIcon: Record<ThoughtStep["kind"], typeof Eye> = {
	read: Eye,
	understand: Lightbulb,
	match: PackageSearch,
	check: ListChecks,
	price: Calculator,
	decide: Scale,
	reply: MessageSquareText,
	held: PauseCircle,
	error: TriangleAlert,
};

// A run that never finished (e.g. the server restarted) stops spinning after this.
const STALE_MS = 3 * 60_000;

function headline(run: AiRun, running: boolean, stalled: boolean) {
	if (running) return "Thinking…";
	if (stalled) return "Stopped before finishing";
	if (run.status === "held") return "AI paused — staff handling";
	if (run.status === "failed") return "Couldn't read the message";
	const ms =
		(run.finishedAt?.getTime() ?? run.createdAt.getTime()) -
		run.createdAt.getTime();
	return `Thought for ${(ms / 1000).toFixed(1)}s`;
}

/** The AI's step-by-step reasoning for one turn, shown to staff only. */
export function AiThinking({
	run,
	defaultOpen,
}: {
	run: AiRun;
	defaultOpen: boolean;
}) {
	const stalled =
		run.status === "running" && Date.now() - run.createdAt.getTime() > STALE_MS;
	const running = run.status === "running" && !stalled;
	const [open, setOpen] = useState(defaultOpen || running);

	return (
		<div className="w-full max-w-[80%] self-end rounded-xl border border-dashed border-[var(--orb-royal)]/30 bg-card/70 text-xs">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-muted-foreground hover:text-foreground"
			>
				{running ? (
					<Loader2 className="size-3.5 animate-spin text-[var(--orb-royal)]" />
				) : (
					<Brain className="size-3.5 text-[var(--orb-royal)]" />
				)}
				<span className="font-medium">AI thinking</span>
				<span>· {headline(run, running, stalled)}</span>
				<span className="ml-auto text-[10px] opacity-70">Staff only</span>
				<ChevronDown
					className={cn("size-3.5 transition-transform", open && "rotate-180")}
				/>
			</button>
			{open && (
				<ol className="space-y-2.5 border-t px-3 py-2.5">
					{run.steps.map((s, i) => {
						const Icon = stepIcon[s.kind];
						return (
							<li key={`${s.kind}-${s.at}`} className="flex gap-2">
								<span
									className={cn(
										"mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--orb-gray)] text-[var(--orb-royal)]",
										s.kind === "error" && "bg-red-50 text-red-600",
										i === run.steps.length - 1 &&
											running &&
											"ring-2 ring-[var(--orb-sky)]/40",
									)}
								>
									<Icon className="size-3" />
								</span>
								<div className="min-w-0 flex-1">
									<p className="font-medium text-foreground">{s.title}</p>
									{s.detail && s.detail.length > 0 && (
										<ul className="mt-0.5 space-y-0.5 text-muted-foreground">
											{s.detail.map((d) => (
												<li key={d} className="break-words">
													· {d}
												</li>
											))}
										</ul>
									)}
								</div>
							</li>
						);
					})}
					{running && (
						<li className="flex items-center gap-2 text-muted-foreground">
							<span className="flex size-5 items-center justify-center">
								<Loader2 className="size-3 animate-spin" />
							</span>
							Working on the next step…
						</li>
					)}
					{!running && run.model && (
						<li className="pl-7 text-[10px] text-muted-foreground/70">
							Model: {run.model}
						</li>
					)}
				</ol>
			)}
		</div>
	);
}
