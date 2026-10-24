import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowLeft,
	AtSign,
	BookOpen,
	Bot,
	CheckCircle2,
	Circle,
	CircleDot,
	ExternalLink,
	FileText,
	Flag,
	ListPlus,
	Loader2,
	MessageCircleQuestion,
	Plus,
	Quote,
	RotateCw,
	SendHorizontal,
	Sparkles,
	Trash2,
	UserPlus,
	UserRound,
	Users,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { BillingTab } from "#/components/orbyte/billing-tab";
import {
	JobStatusChip,
	jobStatuses,
	KindChip,
} from "#/components/orbyte/job-bits";
import { useWorkspace } from "#/components/orbyte/workspace";
import { QuoteTermsView } from "#/components/quote-document";
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
import { Textarea } from "#/components/ui/textarea";
import type { BotAction, BotSource } from "#/db/schema";
import { answerText, assess } from "#/lib/intake";
import {
	AI_HANDLE,
	AI_MENTION,
	escapeRegExp,
	handlesFor,
	mentionsAi,
} from "#/lib/mentions";
import { formatMYR } from "#/lib/money";
import { chargeOf, chargeSuffix, hasTerms } from "#/lib/quote-lines";
import { clock, dayLabel, initials } from "#/lib/time";
import type { JobDetail } from "#/lib/types";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

export const Route = createFileRoute("/orbyte/$businessId/work/$jobId")({
	validateSearch: z.object({
		tab: z
			.enum(["handover", "tasks", "billing", "chat", "quote", "team"])
			.optional(),
	}),
	component: JobPage,
});

type Tab = "handover" | "tasks" | "billing" | "chat" | "quote" | "team";

/** oRPC errors carry a code; checked by value so server- and client-side errors both match. */
const isNotFound = (err: unknown) =>
	(err as { code?: unknown } | null)?.code === "NOT_FOUND";

function useRefresh() {
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey: orpc.jobs.key() });
}

function JobPage() {
	const { jobId } = Route.useParams();
	const { tab = "handover" } = Route.useSearch();
	const navigate = Route.useNavigate();
	const { business } = useWorkspace();
	const job = useQuery({
		...orpc.jobs.get.queryOptions({ input: { jobId } }),
		// A job that doesn't exist (e.g. after `pnpm db:seed`) won't appear by retrying.
		retry: (count, err) => !isNotFound(err) && count < 3,
		refetchInterval: (q) =>
			isNotFound(q.state.error)
				? false
				: q.state.data?.status === "preparing"
					? 2000
					: 5000,
	});
	const [highlight, setHighlight] = useState<string | null>(null);
	const [asking, setAsking] = useState<string | null>(null);
	const setTab = (t: Tab) => navigate({ search: { tab: t }, replace: true });

	if (job.isPending)
		return (
			<p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Loading…
			</p>
		);
	if (job.isError || !job.data)
		return (
			<div className="p-6 text-sm text-muted-foreground">
				<p>
					{isNotFound(job.error)
						? "This job doesn't exist any more. If the demo data was reset (pnpm db:seed), old links stop working."
						: "Couldn't load this job. Check the server is running, then refresh."}
				</p>
				<Link
					to="/orbyte/$businessId/work"
					params={{ businessId: business.id }}
					className="mt-2 inline-block text-primary hover:underline"
				>
					← Back to Work
				</Link>
			</div>
		);
	const j = job.data;

	const showMessage = (id: string) => {
		setTab("chat");
		setHighlight(id);
	};

	return (
		<div className="flex h-full min-h-0">
			<div className="flex min-w-0 flex-1 flex-col">
				<JobHeader job={j} onAsk={() => setAsking("")} />
				<nav className="flex flex-wrap gap-x-1 border-b bg-card px-4 sm:flex-nowrap sm:overflow-x-auto">
					{(
						[
							["handover", "Handover"],
							[
								"tasks",
								`Tasks (${j.tasks.filter((t) => t.status !== "done").length})`,
							],
							["billing", "Billing"],
							["chat", "Customer chat"],
							["quote", "Quote & files"],
							["team", "Team chat"],
						] as const
					).map(([k, label]) => (
						<button
							key={k}
							type="button"
							onClick={() => setTab(k)}
							className={cn(
								"-mb-px border-b-2 border-transparent px-3 py-2.5 text-sm whitespace-nowrap text-muted-foreground",
								tab === k && "border-primary font-medium text-foreground",
								k === "team" && "xl:hidden",
							)}
						>
							{label}
						</button>
					))}
				</nav>
				<div className="min-h-0 flex-1 overflow-y-auto bg-[var(--orb-gray)] p-4 sm:p-6">
					{tab === "handover" && (
						<HandoverTab job={j} onShowMessage={showMessage} />
					)}
					{tab === "tasks" && <TasksTab job={j} />}
					{tab === "billing" && <BillingTab jobId={j.id} />}
					{tab === "chat" && (
						<ChatTab
							job={j}
							highlight={highlight}
							onSeen={() => setHighlight(null)}
						/>
					)}
					{tab === "quote" && <QuoteTab job={j} businessName={business.name} />}
					{tab === "team" && (
						<div className="flex h-full min-h-[480px] rounded-xl border bg-card xl:hidden">
							<TeamChat
								job={j}
								onShowMessage={showMessage}
								onAskCustomer={setAsking}
							/>
						</div>
					)}
				</div>
			</div>
			<aside className="hidden w-[420px] shrink-0 border-l bg-card xl:flex">
				<TeamChat
					job={j}
					onShowMessage={showMessage}
					onAskCustomer={setAsking}
				/>
			</aside>
			{asking !== null && (
				<AskCustomerDialog
					job={j}
					initial={asking}
					onClose={() => setAsking(null)}
				/>
			)}
		</div>
	);
}

// --- Header ---------------------------------------------------------------------------

function JobHeader({ job, onAsk }: { job: JobDetail; onAsk: () => void }) {
	const { business, me } = useWorkspace();
	const refresh = useRefresh();
	const update = useMutation(
		orpc.jobs.update.mutationOptions({ onSuccess: refresh }),
	);
	const save = async (patch: {
		status?: "upcoming" | "active" | "completed" | "closed";
		picId?: string | null;
		acknowledgeAgreement?: boolean;
	}) => {
		if (!me) return toast.error("Choose who you are signed in as first");
		try {
			await update.mutateAsync({ jobId: job.id, staffId: me.id, ...patch });
			if (patch.status === "completed")
				toast.success("Completed. Any reserved stock was delivered.");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Not saved");
		}
	};
	return (
		<header className="space-y-2 border-b bg-card px-4 py-3">
			{job.status === "cancelled" && (
				<output className="block rounded-md bg-status-rejected/10 p-3 text-sm">
					The customer cancelled this signed order. Work has stopped,
					undelivered reserved stock was released, and unpaid invoices were
					voided. Check the Billing tab for any payment that needs refund
					review.
				</output>
			)}
			{job.agreementReviewRequired && (
				<output className="block space-y-2 rounded-md bg-status-review/10 p-3 text-sm">
					<p>
						The customer signed a revised agreement. Review the new scope and
						outstanding tasks before resuming work. Completed tasks have been
						retained.
					</p>
					<Button
						size="sm"
						disabled={
							!job.handover ||
							update.isPending ||
							(!me?.canApprove && me?.id !== job.picId)
						}
						onClick={() => save({ acknowledgeAgreement: true })}
					>
						I reviewed the scope and tasks
					</Button>
				</output>
			)}
			<Link
				to="/orbyte/$businessId/work"
				params={{ businessId: business.id }}
				className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="size-3.5" /> Work
			</Link>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<KindChip kind={job.kind} />
						<span className="font-mono text-xs text-muted-foreground">
							{job.number}
						</span>
						{job.status === "preparing" && <JobStatusChip status="preparing" />}
						{job.status === "cancelled" && <JobStatusChip status="cancelled" />}
					</div>
					<h1 className="mt-1 text-lg font-semibold">{job.title}</h1>
					<p className="text-sm text-muted-foreground">
						{job.client.name}
						{job.client.contactName &&
						job.client.contactName !== job.client.name
							? ` · ${job.client.contactName}`
							: ""}{" "}
						· signed {job.quote.signedAt ? dayLabel(job.quote.signedAt) : ""}
					</p>
					<p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
						<Link
							to="/orbyte/$businessId/quotes"
							params={{ businessId: business.id }}
							search={{ r: job.requestId }}
							className="text-primary hover:underline"
						>
							Quotation {job.quote.number} →
						</Link>
						<Link
							to="/orbyte/$businessId/inbox"
							params={{ businessId: business.id }}
							search={{ c: job.conversationId }}
							className="text-primary hover:underline"
						>
							Sales chat with {job.client.contactName ?? job.client.name} →
						</Link>
					</p>
				</div>
				<div className="flex flex-wrap items-end gap-2">
					{job.status !== "cancelled" && (
						<Labeled label="Status">
							<Select
								value={job.status === "preparing" ? undefined : job.status}
								disabled={job.status === "preparing" || update.isPending}
								onValueChange={(v) => save({ status: v as "upcoming" })}
							>
								<SelectTrigger size="sm" className="w-36">
									<SelectValue placeholder="Preparing…" />
								</SelectTrigger>
								<SelectContent position="popper">
									{(["upcoming", "active", "completed", "closed"] as const).map(
										(s) => (
											<SelectItem key={s} value={s}>
												{jobStatuses[s].label}
											</SelectItem>
										),
									)}
								</SelectContent>
							</Select>
						</Labeled>
					)}
					<Labeled label="Person in charge">
						<Select
							value={job.picId ?? "none"}
							disabled={update.isPending || job.status === "cancelled"}
							onValueChange={(v) => save({ picId: v === "none" ? null : v })}
						>
							<SelectTrigger size="sm" className="w-48">
								<SelectValue />
							</SelectTrigger>
							<SelectContent position="popper">
								<SelectItem value="none">Unassigned</SelectItem>
								{business.staff.map((s) => (
									<SelectItem key={s.id} value={s.id}>
										{s.name} · {s.role}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Labeled>
					<Button
						size="sm"
						variant="outline"
						onClick={onAsk}
						disabled={
							job.status === "cancelled" ||
							(!me?.canApprove && !job.members.some((m) => m.id === me?.id))
						}
						title="Sales approve it before it reaches the customer"
					>
						<MessageCircleQuestion className="size-4" /> Ask the customer
					</Button>
				</div>
			</div>
		</header>
	);
}

function Labeled(props: { label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-0.5">
			<p className="text-[11px] text-muted-foreground">{props.label}</p>
			{props.children}
		</div>
	);
}

// --- Handover --------------------------------------------------------------------------

function Card(props: {
	title: string;
	tone?: "warn";
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<section
			className={cn(
				"rounded-xl border bg-card p-4",
				props.tone === "warn" && "border-status-clarify/50 bg-status-clarify/5",
				props.className,
			)}
		>
			<h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
				{props.title}
			</h2>
			{props.children}
		</section>
	);
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
	if (!items.length)
		return <p className="text-sm text-muted-foreground">{empty}</p>;
	return (
		<ul className="space-y-1.5 text-sm">
			{items.map((s) => (
				<li key={s} className="flex gap-2">
					<span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--orb-royal)]" />
					<span>{s}</span>
				</li>
			))}
		</ul>
	);
}

function HandoverTab({
	job,
	onShowMessage,
}: {
	job: JobDetail;
	onShowMessage: (id: string) => void;
}) {
	const { business } = useWorkspace();
	const retry = useMutation(orpc.jobs.retryHandover.mutationOptions());
	const h = job.handover;

	if (job.status === "cancelled")
		return (
			<div className="rounded-xl border border-status-rejected/30 bg-card p-8 text-center text-sm text-muted-foreground">
				This job was cancelled by the customer. Its existing handover and task
				history are retained for audit only.
			</div>
		);

	if (job.status === "preparing" || !h) {
		const failed = job.handoverTask?.status === "failed";
		const stuck = failed || Date.now() - job.updatedAt.getTime() > 90_000;
		return (
			<div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
				<Loader2 className="mx-auto mb-3 size-6 animate-spin text-[var(--orb-royal)]" />
				{failed
					? "The handover could not be prepared after several attempts. Retry it or ask your administrator to check the worker."
					: "Your handover is queued or being prepared from the agreed requirements and signed quotation."}
				{stuck && (
					<Button
						size="sm"
						variant="outline"
						className="mx-auto mt-4 flex"
						disabled={retry.isPending}
						onClick={() => retry.mutate({ jobId: job.id })}
					>
						<RotateCw className="size-4" /> Try again
					</Button>
				)}
			</div>
		);
	}

	const answered = job.relays.filter((r) => r.status === "answered");
	const a = assess(job.brief, business.products, business.questions);

	return (
		<div className="mx-auto max-w-5xl space-y-4">
			<section className="rounded-xl border bg-card p-5">
				<p className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[var(--orb-royal)] uppercase">
					<Sparkles className="size-3.5" /> Handover briefing
				</p>
				<p className="text-[15px] leading-relaxed">{h.summary}</p>
				{h.timeline && (
					<p className="mt-2 text-sm">
						<span className="text-muted-foreground">Timeline: </span>
						<b>{h.timeline}</b>
					</p>
				)}
			</section>

			<div className="grid gap-4 lg:grid-cols-2">
				<Card title="Scope">
					<Bullets items={h.scope} empty="See the quotation." />
				</Card>
				<Card title="Key requirements">
					{h.requirements.length ? (
						<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
							{h.requirements.map((r) => (
								<Fragment key={r.label}>
									<dt className="text-muted-foreground">{r.label}</dt>
									<dd className="font-medium">{r.value}</dd>
								</Fragment>
							))}
						</dl>
					) : (
						<p className="text-sm text-muted-foreground">None noted.</p>
					)}
				</Card>
				<Card title="What we told the customer">
					<Bullets
						items={h.promises}
						empty="No specific promises in the chat."
					/>
				</Card>
				<Card title="Watch out" tone="warn">
					<Bullets items={h.watchOuts} empty="Nothing flagged." />
				</Card>
			</div>

			{h.customerNotes && (
				<Card title="About the customer">
					<p className="text-sm">{h.customerNotes}</p>
				</Card>
			)}
			{!!h.suggestedTasks?.length && (
				<Card title="Suggested tasks for the revised scope">
					<p className="mb-2 text-xs text-muted-foreground">
						Review these suggestions alongside the retained task list before
						adding or changing work.
					</p>
					<Bullets items={h.suggestedTasks} empty="" />
				</Card>
			)}

			<Card title="Questions we asked the customer for you">
				{job.relays.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						None yet. Use "Ask the customer" or tag @AI in the team chat. Sales
						approve every message before it's sent.
					</p>
				) : (
					<ul className="divide-y text-sm">
						{job.relays.map((r) => (
							<li key={r.id} className="py-2">
								<div className="flex items-start justify-between gap-2">
									<p className="font-medium">{r.question}</p>
									<RelayStatus status={r.status} />
								</div>
								<p className="text-xs text-muted-foreground">
									Asked by {r.askedBy ?? "staff"}
									{r.reviewedBy &&
										` · ${r.status === "rejected" ? "declined" : "sent"} by ${r.reviewedBy}`}
									{r.rejectReason && `: ${r.rejectReason}`}
								</p>
								{r.answer && (
									<p className="mt-1 rounded-md bg-status-approved/10 px-2.5 py-1.5">
										{r.answer}
										{r.answerMessageId && (
											<button
												type="button"
												onClick={() =>
													onShowMessage(r.answerMessageId as string)
												}
												className="ml-2 text-xs text-primary hover:underline"
											>
												view in chat
											</button>
										)}
									</p>
								)}
							</li>
						))}
					</ul>
				)}
				{answered.length > 0 && (
					<p className="mt-2 text-[11px] text-muted-foreground">
						The assistant knows these answers too.
					</p>
				)}
			</Card>

			<Card title="Requirement snapshot from the signed quotation">
				<div className="grid gap-3 md:grid-cols-2">
					{a.items.map(({ item, product, questions }) => (
						<div key={item.id} className="rounded-lg border p-3 text-sm">
							<p className="font-medium">
								{product?.name ?? item.rawText}
								{item.quantity ? ` × ${item.quantity}` : ""}
							</p>
							<dl className="mt-1 space-y-1">
								{questions
									.filter((q) => item.answers[q.key])
									.map((q) => (
										<div key={q.key}>
											<dt className="text-xs text-muted-foreground">
												{q.label}
											</dt>
											<dd>{answerText(item.answers[q.key])}</dd>
										</div>
									))}
							</dl>
						</div>
					))}
					{(a.general.some((q) => job.brief.general[q.key]) ||
						job.brief.followUps.some((f) => f.answer)) && (
						<div className="rounded-lg border p-3 text-sm">
							<p className="font-medium">General</p>
							<dl className="mt-1 space-y-1">
								{a.general
									.filter((q) => job.brief.general[q.key])
									.map((q) => (
										<div key={q.key}>
											<dt className="text-xs text-muted-foreground">
												{q.label}
											</dt>
											<dd>{answerText(job.brief.general[q.key])}</dd>
										</div>
									))}
								{job.brief.followUps
									.filter((f) => f.answer)
									.map((f) => (
										<div key={f.id}>
											<dt className="text-xs text-muted-foreground">
												{f.question}
											</dt>
											<dd>{f.answer}</dd>
										</div>
									))}
							</dl>
						</div>
					)}
				</div>
			</Card>
		</div>
	);
}

function RelayStatus({
	status,
}: {
	status: JobDetail["relays"][number]["status"];
}) {
	const s = {
		pending: ["Waiting for sales approval", "bg-muted text-muted-foreground"],
		sent: ["Sent, waiting for reply", "bg-status-clarify/20 text-[#9a6a00]"],
		answered: ["Answered", "bg-status-approved/15 text-status-approved"],
		rejected: ["Not sent", "bg-status-review/10 text-status-review"],
	}[status];
	return (
		<span className={cn("shrink-0 px-2 py-0.5 text-[11px] font-medium", s[1])}>
			{s[0]}
		</span>
	);
}

// --- Tasks -------------------------------------------------------------------------------

const taskIcon = {
	todo: Circle,
	active: CircleDot,
	blocked: AlertTriangle,
	done: CheckCircle2,
} as const;

function TasksTab({ job }: { job: JobDetail }) {
	const { me } = useWorkspace();
	const refresh = useRefresh();
	const add = useMutation(
		orpc.jobs.tasks.add.mutationOptions({ onSuccess: refresh }),
	);
	const update = useMutation(
		orpc.jobs.tasks.update.mutationOptions({ onSuccess: refresh }),
	);
	const remove = useMutation(
		orpc.jobs.tasks.delete.mutationOptions({ onSuccess: refresh }),
	);
	const [title, setTitle] = useState("");
	const phases = (job.quote.terms?.phases ?? []).map((p) => p.name);
	const groups = phases.length
		? [
				...phases.map((name) => ({
					name,
					tasks: job.tasks.filter((t) => t.phase === name),
				})),
				{
					name: "Other",
					tasks: job.tasks.filter((t) => !t.phase || !phases.includes(t.phase)),
				},
			].filter((g) => g.tasks.length || g.name !== "Other")
		: [{ name: null, tasks: job.tasks }];
	// New tasks go into the first phase that isn't finished yet.
	const openPhase =
		phases.find((name) =>
			job.tasks.some((t) => t.phase === name && t.status !== "done"),
		) ?? phases[0];
	const [phase, setPhase] = useState<string | undefined>(undefined);
	const row = (t: JobDetail["tasks"][number]) => {
		const Icon = taskIcon[t.status];
		return (
			<li key={t.id} className="flex items-start gap-3 px-4 py-3">
				<button
					type="button"
					title={t.status === "done" ? "Mark not done" : "Mark done"}
					aria-label={t.status === "done" ? "Mark not done" : "Mark done"}
					onClick={() =>
						update.mutate({
							taskId: t.id,
							status: t.status === "done" ? "todo" : "done",
						})
					}
					className="-m-1.5 mt-[-0.25rem] rounded-md p-1.5 hover:bg-muted"
				>
					<Icon
						className={cn(
							"size-4",
							t.status === "done" && "text-status-approved",
							t.status === "blocked" && "text-status-review",
							t.status === "active" && "text-status-draft",
							t.status === "todo" && "text-muted-foreground",
						)}
					/>
				</button>
				<div className="min-w-0 flex-1">
					<p
						className={cn(
							"text-sm",
							t.status === "done" && "text-muted-foreground line-through",
						)}
					>
						{t.title}
					</p>
					{t.note && (
						<p className="mt-0.5 text-xs text-status-review">
							Blocked: {t.note}
						</p>
					)}
					{t.source !== "staff" && (
						<p className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-[var(--orb-royal)]">
							<Sparkles className="size-3" />
							{t.source === "ai"
								? "From the handover"
								: "Suggested by the assistant"}
						</p>
					)}
				</div>
				<Select
					value={t.status}
					onValueChange={(v) =>
						update.mutate({
							taskId: t.id,
							status: v as "todo",
							...(v !== "blocked" ? { note: null } : {}),
						})
					}
				>
					<SelectTrigger size="sm" className="w-28">
						<SelectValue />
					</SelectTrigger>
					<SelectContent position="popper">
						<SelectItem value="todo">To do</SelectItem>
						<SelectItem value="active">Active</SelectItem>
						<SelectItem value="blocked">Blocked</SelectItem>
						<SelectItem value="done">Done</SelectItem>
					</SelectContent>
				</Select>
				<button
					type="button"
					title="Delete task"
					aria-label="Delete task"
					onClick={() => remove.mutate({ taskId: t.id })}
					className="-m-1.5 mt-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
				>
					<Trash2 className="size-3.5" />
				</button>
			</li>
		);
	};

	return (
		<div className="mx-auto max-w-3xl space-y-3">
			<form
				className="flex gap-2"
				onSubmit={async (e) => {
					e.preventDefault();
					if (!title.trim() || !me) return;
					await add.mutateAsync({
						jobId: job.id,
						staffId: me.id,
						title,
						phase: phases.length ? (phase ?? openPhase ?? null) : null,
					});
					setTitle("");
				}}
			>
				<Input
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="Add a task…"
					className="bg-card"
				/>
				{phases.length > 0 && (
					<Select value={phase ?? openPhase} onValueChange={setPhase}>
						<SelectTrigger className="w-44 bg-card" aria-label="Phase">
							<SelectValue />
						</SelectTrigger>
						<SelectContent position="popper">
							{phases.map((name) => (
								<SelectItem key={name} value={name}>
									{name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
				<Button disabled={!title.trim() || add.isPending}>
					<Plus className="size-4" /> Add
				</Button>
			</form>
			<ul className="divide-y rounded-xl border bg-card">
				{groups.map((g) => (
					<Fragment key={g.name ?? "all"}>
						{g.name && (
							<li className="flex items-center justify-between bg-muted/40 px-4 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
								<span>{g.name}</span>
								<span className="font-normal tabular-nums normal-case">
									{g.tasks.filter((x) => x.status === "done").length}/
									{g.tasks.length} done
								</span>
							</li>
						)}
						{g.tasks.map(row)}
					</Fragment>
				))}
				{job.tasks.length === 0 && (
					<li className="p-6 text-center text-sm text-muted-foreground">
						No tasks yet.
					</li>
				)}
			</ul>
		</div>
	);
}

// --- Customer chat (read-only) ------------------------------------------------------------

function ChatTab({
	job,
	highlight,
	onSeen,
}: {
	job: JobDetail;
	highlight: string | null;
	onSeen: () => void;
}) {
	const refs = useRef(new Map<string, HTMLDivElement>());
	useEffect(() => {
		if (!highlight) return;
		refs.current
			.get(highlight)
			?.scrollIntoView({ block: "center", behavior: "smooth" });
		const t = setTimeout(onSeen, 2500);
		return () => clearTimeout(t);
	}, [highlight, onSeen]);

	return (
		<div className="mx-auto flex max-w-3xl flex-col gap-1.5">
			<p className="mb-2 self-center bg-card px-3 py-1 text-xs text-muted-foreground">
				Read-only. The PIC doesn't message the customer; use "Ask the customer".
			</p>
			{job.messages.map((m, i) => {
				const prev = job.messages[i - 1];
				const newDay =
					!prev || prev.createdAt.toDateString() !== m.createdAt.toDateString();
				const out = m.sender !== "customer";
				return (
					<Fragment key={m.id}>
						{newDay && (
							<p className="my-2 self-center bg-card px-3 py-0.5 text-xs text-muted-foreground">
								{dayLabel(m.createdAt)}
							</p>
						)}
						<div
							ref={(el) => {
								if (el) refs.current.set(m.id, el);
							}}
							className={cn(
								"max-w-[80%] rounded-2xl px-3.5 py-2 text-sm transition-shadow",
								out
									? "self-end rounded-tr-sm bg-[#dff4ff]"
									: "self-start rounded-tl-sm border bg-card",
								highlight === m.id && "ring-2 ring-[var(--orb-royal)]",
							)}
						>
							<p className="mb-0.5 text-[11px] font-semibold text-muted-foreground">
								{m.sender === "customer"
									? (job.client.contactName ?? "Customer")
									: m.sender === "staff"
										? (m.authorName ?? "Staff")
										: "Quora Chat"}
							</p>
							{m.attachment && (
								<a
									href={`/api/messages/${m.id}/attachment`}
									target="_blank"
									rel="noreferrer"
									className="mb-1 flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs hover:bg-muted/70"
								>
									<FileText className="size-4" /> {m.attachment.name}
								</a>
							)}
							{m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
							<p className="mt-0.5 text-right text-[10px] text-muted-foreground">
								{clock(m.createdAt)}
							</p>
						</div>
					</Fragment>
				);
			})}
		</div>
	);
}

// --- Quote & files --------------------------------------------------------------------------

function QuoteTab({
	job,
	businessName,
}: {
	job: JobDetail;
	businessName: string;
}) {
	const files = job.messages.filter((m) => m.attachment);
	const q = job.quote;
	return (
		<div className="mx-auto max-w-3xl space-y-4">
			<section className="rounded-xl border bg-card">
				<div className="flex items-center justify-between border-b px-4 py-3">
					<div>
						<p className="font-semibold">{q.number}</p>
						<p className="text-xs text-muted-foreground">
							{businessName} · signed by {q.signerName ?? "customer"}
							{q.signedAt
								? ` on ${q.signedAt.toLocaleDateString("en-MY")}`
								: ""}
						</p>
					</div>
					<a
						href={`/api/quotes/${q.id}/pdf`}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
					>
						PDF <ExternalLink className="size-3.5" />
					</a>
				</div>
				<table className="w-full text-sm">
					<thead className="text-xs text-muted-foreground">
						<tr className="border-b">
							<th className="px-4 py-2 text-left font-medium">Item</th>
							<th className="px-2 py-2 text-right font-medium">Qty</th>
							<th className="px-4 py-2 text-right font-medium">Amount</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{q.lineItems.map((l) => (
							<tr key={`${l.description}-${l.amountSen}`}>
								<td className="px-4 py-2">
									{l.description}
									{l.notes && (
										<p className="text-xs text-muted-foreground">{l.notes}</p>
									)}
								</td>
								<td className="px-2 py-2 text-right tabular-nums">
									{l.quantity} {l.unit}
								</td>
								<td className="px-4 py-2 text-right whitespace-nowrap tabular-nums">
									{formatMYR(l.amountSen)}
									{chargeOf(l) === "optional"
										? " (optional)"
										: chargeSuffix[chargeOf(l)]}
								</td>
							</tr>
						))}
					</tbody>
					<tfoot className="text-sm">
						<tr className="border-t">
							<td colSpan={2} className="px-4 py-2 text-right font-semibold">
								One-time total (incl. SST)
							</td>
							<td className="px-4 py-2 text-right font-semibold tabular-nums">
								{formatMYR(q.totalSen)}
							</td>
						</tr>
					</tfoot>
				</table>
				{hasTerms(q.terms) && (
					<div className="border-t px-4 pb-4">
						<QuoteTermsView terms={q.terms} totalSen={q.totalSen} />
					</div>
				)}
				{q.notes && (
					<p className="border-t px-4 py-2 text-sm">Notes: {q.notes}</p>
				)}
			</section>
			<section className="rounded-xl border bg-card p-4">
				<h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Files from the customer
				</h2>
				{files.length === 0 ? (
					<p className="text-sm text-muted-foreground">No files were sent.</p>
				) : (
					<ul className="space-y-1.5">
						{files.map((m) => (
							<li key={m.id}>
								<a
									href={`/api/messages/${m.id}/attachment`}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
								>
									<FileText className="size-4" /> {m.attachment?.name}
								</a>
								<span className="ml-2 text-xs text-muted-foreground">
									{dayLabel(m.createdAt)} {clock(m.createdAt)}
								</span>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

// --- Team chat: the PIC, assigned workers and the AI (answers when tagged @AI) ---------------

const starters = [
	"What exactly does the customer want?",
	"What did we promise them in the chat?",
	"Anything unclear I should check first?",
];

type Member = JobDetail["members"][number];
type Handle = { id: string; handle: string; label: string };

/** Splits a message so tags (@AI, @Ravi Chandran) can be shown highlighted. */
function MessageText({ body, handles }: { body: string; handles: Handle[] }) {
	const known = [...new Set(handles.map((h) => h.handle))].sort(
		(a, b) => b.length - a.length,
	);
	if (!known.length) return <>{body}</>;
	const re = new RegExp(
		`(@(?:${known.map(escapeRegExp).join("|")}))(?![\\p{L}\\p{N}_])`,
		"giu",
	);
	return (
		<>
			{body.split(re).map((part, i) =>
				i % 2 === 1 ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: parts of one static string
					<span key={i} className="font-semibold text-[var(--orb-royal)]">
						{part}
					</span>
				) : (
					part
				),
			)}
		</>
	);
}

function Avatar({
	name,
	ai,
	title,
}: {
	name: string;
	ai?: boolean;
	title?: string;
}) {
	return (
		<span
			title={title ?? name}
			className={cn(
				"flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
				ai ? "bg-[var(--orb-royal)]" : "bg-[var(--orb-navy)]",
			)}
		>
			{ai ? <Bot className="size-4" /> : initials(name)}
		</span>
	);
}

/** The "@..." being typed just before the cursor, if any. */
function tagAtCursor(text: string, cursor: number) {
	const m = /(^|\s)@([^\s@]*)$/u.exec(text.slice(0, cursor));
	return m ? { start: cursor - m[2].length - 1, query: m[2] } : null;
}

function TeamChat({
	job,
	onShowMessage,
	onAskCustomer,
}: {
	job: JobDetail;
	onShowMessage: (id: string) => void;
	onAskCustomer: (question: string) => void;
}) {
	const { me } = useWorkspace();
	const refresh = useRefresh();
	const post = useMutation(
		orpc.jobs.chat.post.mutationOptions({ onSuccess: refresh }),
	);
	const addTask = useMutation(
		orpc.jobs.tasks.add.mutationOptions({ onSuccess: refresh }),
	);
	const updateTask = useMutation(
		orpc.jobs.tasks.update.mutationOptions({ onSuccess: refresh }),
	);
	const [draft, setDraft] = useState("");
	const [cursor, setCursor] = useState(0);
	const [picked, setPicked] = useState(0);
	// Escape hides the picker until the message changes.
	const [dismissed, setDismissed] = useState<string | null>(null);
	const [pending, setPending] = useState<string | null>(null);
	const [applied, setApplied] = useState<Set<string>>(new Set());
	const [managing, setManaging] = useState(false);
	const bottom = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLTextAreaElement>(null);

	const isMember = Boolean(me && job.members.some((m) => m.id === me.id));
	const canManage = Boolean(me && (me.canApprove || me.id === job.picId));
	const handles: Handle[] = [
		{ id: AI_MENTION, handle: AI_HANDLE, label: "AI assistant" },
		...handlesFor(job.members).map((h) => ({
			...h,
			label: job.members.find((m) => m.id === h.id)?.name ?? h.handle,
		})),
	];
	// The picker offers each person once, by their full name (AI first).
	const tag = dismissed === draft ? null : tagAtCursor(draft, cursor);
	const suggestions = tag
		? [
				handles[0],
				...job.members
					.filter((m) => m.id !== me?.id)
					.map((m) => ({ id: m.id, handle: m.name, label: m.name })),
			].filter((h) =>
				h.handle
					.toLowerCase()
					.split(/\s+/)
					.some((w) => w.startsWith(tag.query.toLowerCase())),
			)
		: [];
	const onlyIntro = job.chat.every(
		(m) => m.role !== "staff" && m.role !== "pic",
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll when new messages arrive
	useEffect(() => {
		bottom.current?.scrollIntoView({ block: "end" });
	}, [job.chat.length, pending]);

	function insertTag(h: { handle: string }) {
		const at = tag?.start ?? cursor;
		const end = tag ? at + 1 + tag.query.length : cursor;
		const next = `${draft.slice(0, at)}@${h.handle} ${draft.slice(end)}`;
		const pos = at + h.handle.length + 2;
		setDraft(next);
		setCursor(pos);
		setPicked(0);
		requestAnimationFrame(() => {
			input.current?.focus();
			input.current?.setSelectionRange(pos, pos);
		});
	}

	async function send(body: string) {
		if (!me) return toast.error("Choose who you are signed in as first");
		if (!body.trim()) return;
		setPending(body);
		setDraft("");
		setCursor(0);
		try {
			await post.mutateAsync({ jobId: job.id, staffId: me.id, body });
		} catch (err) {
			setDraft(body);
			toast.error(err instanceof Error ? err.message : "Message not sent");
		} finally {
			setPending(null);
		}
	}

	async function apply(key: string, action: BotAction) {
		if (!me) return toast.error("Choose who you are signed in as first");
		try {
			if (action.kind === "ask_customer") return onAskCustomer(action.question);
			if (action.kind === "add_task") {
				await addTask.mutateAsync({
					jobId: job.id,
					staffId: me.id,
					title: action.title,
					source: "bot",
				});
				toast.success("Task added");
			} else if (action.taskId) {
				await updateTask.mutateAsync({
					taskId: action.taskId,
					status: "blocked",
					note: action.note,
				});
				toast.success("Task flagged as blocked");
			} else {
				const task = await addTask.mutateAsync({
					jobId: job.id,
					staffId: me.id,
					title: `Blocker: ${action.note}`,
					source: "bot",
				});
				await updateTask.mutateAsync({
					taskId: task.id,
					status: "blocked",
					note: action.note,
				});
				toast.success("Blocker added to tasks");
			}
			setApplied((s) => new Set(s).add(key));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		}
	}

	return (
		<div className="flex min-h-0 w-full flex-col">
			<div className="space-y-2 border-b px-4 py-3">
				<div className="flex items-center justify-between gap-2">
					<p className="flex items-center gap-2 font-semibold">
						<span className="flex size-7 items-center justify-center rounded-full bg-[var(--orb-royal)] text-white">
							<Users className="size-4" />
						</span>
						Team chat
					</p>
					<Button size="sm" variant="ghost" onClick={() => setManaging(true)}>
						<UserPlus className="size-4" /> People
					</Button>
				</div>
				<p className="text-xs text-muted-foreground">
					Internal: the customer can't see this. Tag{" "}
					<span className="font-semibold text-[var(--orb-royal)]">@AI</span> to
					ask the assistant. It knows the signed quotation, requirements and the
					whole customer chat.
				</p>
				<div className="flex flex-wrap items-center gap-1">
					<span title="AI assistant">
						<Avatar name="AI" ai />
					</span>
					{job.members.map((m) => (
						<span key={m.id} className="relative">
							<Avatar
								name={m.name}
								title={`${m.name}${m.id === job.picId ? " (PIC)" : ""}`}
							/>
							{m.id === job.picId && (
								<span className="absolute -right-1 -bottom-1 rounded bg-status-review px-0.5 text-[8px] font-bold text-white">
									PIC
								</span>
							)}
						</span>
					))}
				</div>
			</div>
			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
				{job.chat.map((m) => {
					if (m.role === "system")
						return (
							<p
								key={m.id}
								className="mx-auto max-w-[90%] text-center text-[11px] text-muted-foreground"
							>
								{m.body} · {clock(m.createdAt)}
							</p>
						);
					if (m.role === "assistant")
						return (
							<div key={m.id} className="flex gap-2">
								<Avatar name="AI" ai />
								<div className="mr-4 min-w-0 space-y-1.5">
									<p className="text-[11px] font-semibold text-muted-foreground">
										AI assistant · {clock(m.createdAt)}
									</p>
									<div className="rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
										<MessageText body={m.body} handles={handles} />
									</div>
									{m.sources.length > 0 && (
										<Sources
											sources={m.sources}
											onShowMessage={onShowMessage}
										/>
									)}
									{m.actions.length > 0 && (
										<div className="flex flex-wrap gap-1.5">
											{m.actions.map((a, i) => {
												const key = `${m.id}:${i}`;
												const done = applied.has(key);
												return (
													<button
														key={key}
														type="button"
														disabled={done || !isMember}
														onClick={() => apply(key, a)}
														className={cn(
															"inline-flex max-w-full items-center gap-1.5 border px-2.5 py-1 text-left text-xs hover:bg-muted disabled:opacity-60",
															a.kind === "ask_customer" &&
																"border-[var(--orb-royal)]/40 text-[var(--orb-royal)]",
														)}
													>
														{a.kind === "add_task" ? (
															<ListPlus className="size-3.5 shrink-0" />
														) : a.kind === "flag_blocker" ? (
															<Flag className="size-3.5 shrink-0" />
														) : (
															<MessageCircleQuestion className="size-3.5 shrink-0" />
														)}
														<span className="line-clamp-2">
															{done
																? "Done"
																: a.kind === "add_task"
																	? `Add task: ${a.title}`
																	: a.kind === "flag_blocker"
																		? `Flag blocker: ${a.note}`
																		: `Ask the customer: ${a.question}`}
														</span>
													</button>
												);
											})}
										</div>
									)}
								</div>
							</div>
						);
					// A teammate ("pic" rows come from the old one-to-one assistant).
					const mine = me && m.authorId === me.id;
					const name = m.authorName ?? "Staff";
					return mine ? (
						<div key={m.id} className="ml-8 space-y-0.5 text-right">
							<p className="text-[11px] text-muted-foreground">
								{clock(m.createdAt)}
							</p>
							<div className="inline-block rounded-2xl rounded-tr-sm bg-[var(--orb-navy)] px-3 py-2 text-left text-sm whitespace-pre-wrap text-white [&_span]:text-sky-200">
								<MessageText body={m.body} handles={handles} />
							</div>
						</div>
					) : (
						<div key={m.id} className="flex gap-2">
							<Avatar name={name} />
							<div className="mr-8 min-w-0 space-y-0.5">
								<p className="text-[11px] font-semibold text-muted-foreground">
									{name}
									{m.authorId && m.authorId === job.picId ? " · PIC" : ""} ·{" "}
									{clock(m.createdAt)}
								</p>
								<div className="rounded-2xl rounded-tl-sm border bg-card px-3 py-2 text-sm whitespace-pre-wrap">
									<MessageText body={m.body} handles={handles} />
								</div>
							</div>
						</div>
					);
				})}
				{onlyIntro && !pending && isMember && (
					<div className="space-y-2">
						<p className="text-xs text-muted-foreground">Try asking:</p>
						{starters.map((s) => (
							<button
								key={s}
								type="button"
								onClick={() => send(`@${AI_HANDLE} ${s}`)}
								className="block w-full rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted"
							>
								<span className="font-semibold text-[var(--orb-royal)]">
									@{AI_HANDLE}
								</span>{" "}
								{s}
							</button>
						))}
					</div>
				)}
				{pending && (
					<>
						<div className="ml-8 text-right">
							<div className="inline-block rounded-2xl rounded-tr-sm bg-[var(--orb-navy)] px-3 py-2 text-left text-sm whitespace-pre-wrap text-white opacity-70">
								{pending}
							</div>
						</div>
						{mentionsAi(pending) && (
							<p className="flex items-center gap-2 text-xs text-muted-foreground">
								<Loader2 className="size-3.5 animate-spin" /> AI is looking
								through the chat and brief…
							</p>
						)}
					</>
				)}
				<div ref={bottom} />
			</div>
			{isMember ? (
				<form
					className="relative border-t p-3"
					onSubmit={(e) => {
						e.preventDefault();
						send(draft);
					}}
				>
					{suggestions.length > 0 && (
						<div
							role="listbox"
							aria-label="Tag someone"
							className="absolute inset-x-3 bottom-full mb-1 overflow-hidden rounded-lg border bg-popover shadow-md"
						>
							{suggestions.map((s, i) => (
								<button
									key={s.id}
									type="button"
									role="option"
									aria-selected={i === picked}
									onMouseDown={(e) => {
										e.preventDefault();
										insertTag(s);
									}}
									className={cn(
										"flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted",
										i === picked && "bg-muted",
									)}
								>
									<Avatar name={s.label} ai={s.id === AI_MENTION} />
									<span>{s.label}</span>
									{s.id === job.picId && (
										<span className="text-xs text-muted-foreground">PIC</span>
									)}
								</button>
							))}
						</div>
					)}
					<div className="flex items-end gap-2">
						<Button
							type="button"
							size="icon"
							variant="ghost"
							title="Ask the AI"
							onClick={() => insertTag(handles[0])}
						>
							<AtSign className="size-4" />
						</Button>
						<Textarea
							ref={input}
							value={draft}
							aria-label="Message the team"
							onChange={(e) => {
								setDraft(e.target.value);
								setCursor(e.target.selectionStart);
								setPicked(0);
							}}
							onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
							onKeyDown={(e) => {
								if (suggestions.length) {
									if (e.key === "ArrowDown" || e.key === "ArrowUp") {
										e.preventDefault();
										const step = e.key === "ArrowDown" ? 1 : -1;
										setPicked(
											(p) =>
												(p + step + suggestions.length) % suggestions.length,
										);
										return;
									}
									if (e.key === "Enter" || e.key === "Tab") {
										e.preventDefault();
										insertTag(suggestions[picked] ?? suggestions[0]);
										return;
									}
									if (e.key === "Escape") {
										setDismissed(draft);
										return;
									}
								}
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									e.currentTarget.form?.requestSubmit();
								}
							}}
							rows={1}
							placeholder="Message the team… type @ to tag someone or @AI"
							className="max-h-32 min-h-10 resize-none"
						/>
						<Button
							type="submit"
							size="icon"
							disabled={!draft.trim() || pending !== null}
						>
							<SendHorizontal className="size-4" />
						</Button>
					</div>
				</form>
			) : (
				<div className="flex items-center justify-between gap-2 border-t p-3 text-xs text-muted-foreground">
					<span>
						You're not in this job's group.
						{canManage ? "" : " Ask the PIC or an approver to add you."}
					</span>
					{canManage && (
						<Button
							size="sm"
							variant="outline"
							onClick={() => setManaging(true)}
						>
							Add people
						</Button>
					)}
				</div>
			)}
			{managing && (
				<MembersDialog
					job={job}
					canManage={canManage}
					onClose={() => setManaging(false)}
				/>
			)}
		</div>
	);
}

function MembersDialog({
	job,
	canManage,
	onClose,
}: {
	job: JobDetail;
	canManage: boolean;
	onClose: () => void;
}) {
	const { business, me } = useWorkspace();
	const refresh = useRefresh();
	const add = useMutation(
		orpc.jobs.members.add.mutationOptions({ onSuccess: refresh }),
	);
	const remove = useMutation(
		orpc.jobs.members.remove.mutationOptions({ onSuccess: refresh }),
	);
	const [adding, setAdding] = useState<string>("");
	const others = business.staff.filter(
		(s) => !job.members.some((m) => m.id === s.id),
	);
	const run = async (fn: () => Promise<unknown>, done: string) => {
		try {
			await fn();
			toast.success(done);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		}
	};
	const removable = (m: Member) =>
		m.id !== job.picId && (canManage || m.id === me?.id);
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="orbyte max-w-md">
				<DialogHeader>
					<DialogTitle>People on {job.number}</DialogTitle>
					<DialogDescription>
						Everyone here can read and post in the team chat, tag @AI, and ask
						the customer a question through sales. The customer is never in this
						group.
					</DialogDescription>
				</DialogHeader>
				<ul className="divide-y rounded-lg border">
					<li className="flex items-center gap-2 px-3 py-2 text-sm">
						<Avatar name="AI" ai />
						<span className="flex-1">AI assistant</span>
						<span className="text-xs text-muted-foreground">Tag @AI</span>
					</li>
					{job.members.map((m) => (
						<li
							key={m.id}
							className="flex items-center gap-2 px-3 py-2 text-sm"
						>
							<Avatar name={m.name} />
							<span className="min-w-0 flex-1">
								<span className="block truncate">{m.name}</span>
								<span className="block text-xs text-muted-foreground">
									{m.id === job.picId ? "Person in charge" : m.role}
								</span>
							</span>
							{removable(m) && me && (
								<Button
									size="sm"
									variant="ghost"
									disabled={remove.isPending}
									onClick={() =>
										run(
											() =>
												remove.mutateAsync({
													jobId: job.id,
													staffId: me.id,
													memberId: m.id,
												}),
											m.id === me.id
												? "You left the group"
												: `Removed ${m.name}`,
										)
									}
								>
									{m.id === me.id ? "Leave" : "Remove"}
								</Button>
							)}
						</li>
					))}
				</ul>
				{canManage && me ? (
					<div className="flex gap-2">
						<Select value={adding} onValueChange={setAdding}>
							<SelectTrigger className="flex-1" aria-label="Add a teammate">
								<SelectValue
									placeholder={
										others.length ? "Add a teammate…" : "Everyone is in"
									}
								/>
							</SelectTrigger>
							<SelectContent position="popper">
								{others.map((s) => (
									<SelectItem key={s.id} value={s.id}>
										{s.name} · {s.role}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							disabled={!adding || add.isPending}
							onClick={() =>
								run(async () => {
									await add.mutateAsync({
										jobId: job.id,
										staffId: me.id,
										memberId: adding,
									});
									setAdding("");
								}, "Added to the group")
							}
						>
							Add
						</Button>
					</div>
				) : (
					<p className="text-xs text-muted-foreground">
						Only the PIC or an approver can add or remove people.
					</p>
				)}
			</DialogContent>
		</Dialog>
	);
}

const sourceIcon: Record<BotSource["kind"], typeof Quote> = {
	chat: Quote,
	file: FileText,
	brief: CheckCircle2,
	quote: FileText,
	handover: Sparkles,
	relay: MessageCircleQuestion,
	catalog: UserRound,
	knowledge: BookOpen,
};

function Sources({
	sources,
	onShowMessage,
}: {
	sources: BotSource[];
	onShowMessage: (id: string) => void;
}) {
	const { business } = useWorkspace();
	return (
		<div className="flex flex-wrap gap-1">
			{sources.map((s, i) => {
				const Icon = sourceIcon[s.kind];
				// A knowledge-base source opens its document; others jump to the chat.
				if (s.kind === "knowledge")
					return (
						<Link
							// biome-ignore lint/suspicious/noArrayIndexKey: read-only list that never reorders; entries can repeat, so the position is the identity
							key={`${s.kind}-${s.label}-${i}`}
							to="/orbyte/$businessId/knowledge"
							params={{ businessId: business.id }}
							search={{ d: s.ref }}
							className="inline-flex items-center gap-1 rounded-md bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border hover:text-primary hover:ring-primary/40"
							title="Open in the knowledge base"
						>
							<Icon className="size-3" /> {s.label}
						</Link>
					);
				const clickable = Boolean(s.ref);
				return (
					<button
						// biome-ignore lint/suspicious/noArrayIndexKey: read-only list that never reorders; entries can repeat, so the position is the identity
						key={`${s.kind}-${s.label}-${i}`}
						type="button"
						disabled={!clickable}
						onClick={() => s.ref && onShowMessage(s.ref)}
						className={cn(
							"inline-flex items-center gap-1 rounded-md bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border",
							clickable && "hover:text-primary hover:ring-primary/40",
						)}
						title={clickable ? "Show in the customer chat" : undefined}
					>
						<Icon className="size-3" /> {s.label}
					</button>
				);
			})}
		</div>
	);
}

// --- Ask the customer (goes to sales for approval) ----------------------------------------------

function AskCustomerDialog({
	job,
	initial,
	onClose,
}: {
	job: JobDetail;
	initial: string;
	onClose: () => void;
}) {
	const { me } = useWorkspace();
	const refresh = useRefresh();
	const create = useMutation(
		orpc.relays.create.mutationOptions({ onSuccess: refresh }),
	);
	const [question, setQuestion] = useState(initial);
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="orbyte max-w-lg">
				<DialogHeader>
					<DialogTitle>Ask the customer</DialogTitle>
					<DialogDescription>
						Write what you need to know. Quora Chat turns it into a friendly
						WhatsApp message in the customer's language. Sales approve it before
						it's sent, and the answer comes back to this job.
					</DialogDescription>
				</DialogHeader>
				<Textarea
					autoFocus
					rows={3}
					value={question}
					onChange={(e) => setQuestion(e.target.value)}
					placeholder="e.g. Which version of SQL Account do they use?"
				/>
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={!question.trim() || create.isPending || !me}
						onClick={async () => {
							if (!me) return;
							try {
								await create.mutateAsync({
									jobId: job.id,
									staffId: me.id,
									question,
								});
								toast.success("Sent to sales for approval");
								onClose();
							} catch (err) {
								toast.error(err instanceof Error ? err.message : "Failed");
							}
						}}
					>
						{create.isPending && <Loader2 className="size-4 animate-spin" />}
						Send for approval
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
