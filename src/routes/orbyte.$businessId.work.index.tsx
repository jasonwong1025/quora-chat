import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	Briefcase,
	Loader2,
	MessageCircleQuestion,
} from "lucide-react";
import { useState } from "react";
import { JobStatusChip, KindChip } from "#/components/orbyte/job-bits";
import { PageHeader, useWorkspace } from "#/components/orbyte/workspace";
import { ago, avatarHue, initials } from "#/lib/time";
import type { JobRow } from "#/lib/types";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

export const Route = createFileRoute("/orbyte/$businessId/work/")({
	component: Work,
});

const columns = [
	{ key: "upcoming", label: "Upcoming", match: ["preparing", "upcoming"] },
	{ key: "active", label: "Active", match: ["active"] },
	{ key: "completed", label: "Completed", match: ["completed"] },
	{
		key: "closed",
		label: "Closed / cancelled",
		match: ["closed", "cancelled"],
	},
] as const;

function Work() {
	const { business, me } = useWorkspace();
	const jobs = useQuery({
		...orpc.jobs.list.queryOptions({ input: { businessId: business.id } }),
		refetchInterval: 4000,
	});
	const [picked, setScope] = useState<"mine" | "all" | null>(null);
	const [showClosed, setShowClosed] = useState(false);
	const all = jobs.data ?? [];
	// Mine: I'm the PIC or a member of the job's team group.
	const mine = all.filter(
		(j) => j.picId === me?.id || (me && j.memberIds.includes(me.id)),
	);
	// Start on "My jobs" only if there are any.
	const scope = picked ?? (mine.length > 0 ? "mine" : "all");
	const list = scope === "mine" ? mine : all;
	const visible = columns.filter((c) => c.key !== "closed" || showClosed);

	return (
		<div className="flex h-full flex-col p-4 sm:p-6">
			<PageHeader
				title="Work"
				description="Jobs handed over from signed quotations. Each one has the customer's full context and a team chat with an AI that knows it (tag @AI)."
			/>
			<div className="mb-4 flex flex-wrap items-center gap-3">
				<div className="flex rounded-lg border bg-card p-0.5">
					{(
						[
							["mine", `My jobs (${mine.length})`],
							["all", `All jobs (${all.length})`],
						] as const
					).map(([k, label]) => (
						<button
							key={k}
							type="button"
							onClick={() => setScope(k)}
							className={cn(
								"rounded-md px-3 py-1.5 text-sm",
								scope === k && "bg-secondary font-medium text-primary",
							)}
						>
							{label}
						</button>
					))}
				</div>
				<label className="flex items-center gap-2 text-sm text-muted-foreground">
					<input
						type="checkbox"
						checked={showClosed}
						onChange={(e) => setShowClosed(e.target.checked)}
						className="accent-[var(--primary)]"
					/>
					Show closed
				</label>
			</div>

			{jobs.isPending ? (
				<p className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading jobs…
				</p>
			) : list.length === 0 ? (
				<div className="rounded-xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
					<Briefcase className="mx-auto mb-2 size-8" />
					{scope === "mine" && all.length > 0 ? (
						"Nothing assigned to you. Switch to All jobs to see the team's."
					) : (
						<div className="mx-auto max-w-md space-y-3">
							<p>
								No jobs yet. A job appears here as soon as a customer signs a
								quotation. Open it to see the handover pack and the{" "}
								<span className="font-medium text-foreground">team chat</span>,
								where the PIC, assigned workers and the AI (tag @AI) work
								together.
							</p>
							<ol className="list-decimal space-y-1 pl-5 text-left text-xs">
								<li>
									In{" "}
									<a
										href={`/whatsapp?chat=${business.id}`}
										target="_blank"
										rel="noreferrer"
										className="text-primary hover:underline"
									>
										WhatsApp
									</a>
									, send {business.name} an enquiry and answer its questions.
								</li>
								<li>
									In{" "}
									<Link
										to="/orbyte/$businessId/quotes"
										params={{ businessId: business.id }}
										className="text-primary hover:underline"
									>
										Quotes
									</Link>
									, approve the draft (price custom items first).
								</li>
								<li>
									Back in WhatsApp, tap <em>Review &amp; sign</em> and sign.
								</li>
							</ol>
						</div>
					)}
				</div>
			) : (
				<div
					className={cn(
						"grid min-h-0 flex-1 gap-4",
						showClosed ? "lg:grid-cols-4" : "lg:grid-cols-3",
					)}
				>
					{visible.map((col) => {
						const items = list.filter((j) =>
							(col.match as readonly string[]).includes(j.status),
						);
						return (
							<section
								key={col.key}
								className="flex min-h-0 flex-col rounded-xl bg-muted/50"
							>
								<h2 className="flex items-center justify-between px-3 py-2.5 text-sm font-semibold">
									{col.label}
									<span className="text-xs font-normal text-muted-foreground">
										{items.length}
									</span>
								</h2>
								<ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
									{items.map((j) => (
										<li key={j.id}>
											<JobCard job={j} />
										</li>
									))}
									{items.length === 0 && (
										<li className="px-2 py-4 text-center text-xs text-muted-foreground">
											Nothing here
										</li>
									)}
								</ul>
							</section>
						);
					})}
				</div>
			)}
		</div>
	);
}

function JobCard({ job }: { job: JobRow }) {
	const { business } = useWorkspace();
	const pct = job.tasksTotal
		? Math.round((job.tasksDone / job.tasksTotal) * 100)
		: 0;
	return (
		<Link
			to="/orbyte/$businessId/work/$jobId"
			params={{ businessId: business.id, jobId: job.id }}
			className="block rounded-lg border bg-card p-3 shadow-xs hover:border-primary/40"
		>
			<div className="flex items-center justify-between gap-2">
				<KindChip kind={job.kind} />
				{job.status === "cancelled" ? (
					<JobStatusChip status="cancelled" />
				) : (
					<span className="font-mono text-[11px] text-muted-foreground">
						{job.number}
					</span>
				)}
			</div>
			<p className="mt-1.5 line-clamp-2 text-sm font-medium">{job.title}</p>
			<p className="text-xs text-muted-foreground">{job.clientName}</p>
			{job.status === "preparing" ? (
				<p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
					<Loader2 className="size-3 animate-spin" /> AI is writing the
					handover…
				</p>
			) : (
				job.tasksTotal > 0 && (
					<div className="mt-2 flex items-center gap-2">
						<div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full bg-status-approved"
								style={{ width: `${pct}%` }}
							/>
						</div>
						<span className="text-[11px] text-muted-foreground tabular-nums">
							{job.tasksDone}/{job.tasksTotal}
						</span>
					</div>
				)
			)}
			<div className="mt-2 flex flex-wrap items-center gap-1.5">
				{job.blocked > 0 && (
					<span className="inline-flex items-center gap-1 bg-status-review/10 px-1.5 py-0.5 text-[11px] text-status-review">
						<AlertTriangle className="size-3" /> {job.blocked} blocked
					</span>
				)}
				{job.waitingOnCustomer > 0 && (
					<span className="inline-flex items-center gap-1 bg-status-clarify/20 px-1.5 py-0.5 text-[11px] text-[#9a6a00]">
						<MessageCircleQuestion className="size-3" /> Waiting on customer
					</span>
				)}
				<span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
					{ago(job.updatedAt)}
					{job.picName && <Avatar name={job.picName} />}
				</span>
			</div>
		</Link>
	);
}

export function Avatar({
	name,
	className,
}: {
	name: string;
	className?: string;
}) {
	const hue = avatarHue(name);
	return (
		<span
			title={name}
			className={cn(
				"flex size-6 items-center justify-center rounded-full text-[10px] font-semibold",
				className,
			)}
			style={{
				background: `hsl(${hue} 70% 92%)`,
				color: `hsl(${hue} 50% 30%)`,
			}}
		>
			{initials(name)}
		</span>
	);
}
