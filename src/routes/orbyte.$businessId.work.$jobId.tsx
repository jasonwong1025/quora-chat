import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowLeft,
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
	UserRound,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
	JobStatusChip,
	jobStatuses,
	KindChip,
} from "#/components/orbyte/job-bits";
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
import { Textarea } from "#/components/ui/textarea";
import type { BotAction, BotSource } from "#/db/schema";
import { answerText, assess } from "#/lib/intake";
import { formatMYR } from "#/lib/money";
import { clock, dayLabel } from "#/lib/time";
import type { JobDetail } from "#/lib/types";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

export const Route = createFileRoute("/orbyte/$businessId/work/$jobId")({
	validateSearch: z.object({
		tab: z.enum(["handover", "tasks", "chat", "quote", "assistant"]).optional(),
	}),
	component: JobPage,
});

type Tab = "handover" | "tasks" | "chat" | "quote" | "assistant";

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
		refetchInterval: (q) =>
			q.state.data?.status === "preparing" ? 2000 : 5000,
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
		return <p className="p-6 text-sm text-muted-foreground">Job not found.</p>;
	const j = job.data;

	const showMessage = (id: string) => {
		setTab("chat");
		setHighlight(id);
	};

	return (
		<div className="flex h-full min-h-0">
			<div className="flex min-w-0 flex-1 flex-col">
				<JobHeader job={j} onAsk={() => setAsking("")} />
				<nav className="flex gap-1 overflow-x-auto border-b bg-card px-4">
					{(
						[
							["handover", "Handover"],
							[
								"tasks",
								`Tasks (${j.tasks.filter((t) => t.status !== "done").length})`,
							],
							["chat", "Customer chat"],
							["quote", "Quote & files"],
							["assistant", "Assistant"],
						] as const
					).map(([k, label]) => (
						<button
							key={k}
							type="button"
							onClick={() => setTab(k)}
							className={cn(
								"-mb-px border-b-2 border-transparent px-3 py-2.5 text-sm whitespace-nowrap text-muted-foreground",
								tab === k && "border-primary font-medium text-foreground",
								k === "assistant" && "xl:hidden",
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
					{tab === "chat" && (
						<ChatTab
							job={j}
							highlight={highlight}
							onSeen={() => setHighlight(null)}
						/>
					)}
					{tab === "quote" && <QuoteTab job={j} businessName={business.name} />}
					{tab === "assistant" && (
						<div className="flex h-full min-h-[480px] rounded-xl border bg-card xl:hidden">
							<Assistant
								job={j}
								onShowMessage={showMessage}
								onAskCustomer={setAsking}
							/>
						</div>
					)}
				</div>
			</div>
			<aside className="hidden w-[420px] shrink-0 border-l bg-card xl:flex">
				<Assistant
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
				</div>
				<div className="flex flex-wrap items-end gap-2">
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
					<Labeled label="Person in charge">
						<Select
							value={job.picId ?? "none"}
							disabled={update.isPending}
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
					<Button size="sm" variant="outline" onClick={onAsk}>
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
						None yet. Use "Ask the customer" or ask the assistant. Sales approve
						every message before it's sent.
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
		<span
			className={cn(
				"shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
				s[1],
			)}
		>
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

	return (
		<div className="mx-auto max-w-3xl space-y-3">
			<form
				className="flex gap-2"
				onSubmit={async (e) => {
					e.preventDefault();
					if (!title.trim() || !me) return;
					await add.mutateAsync({ jobId: job.id, staffId: me.id, title });
					setTitle("");
				}}
			>
				<Input
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="Add a task…"
					className="bg-card"
				/>
				<Button disabled={!title.trim() || add.isPending}>
					<Plus className="size-4" /> Add
				</Button>
			</form>
			<ul className="divide-y rounded-xl border bg-card">
				{job.tasks.map((t) => {
					const Icon = taskIcon[t.status];
					return (
						<li key={t.id} className="flex items-start gap-3 px-4 py-3">
							<button
								type="button"
								title={t.status === "done" ? "Mark not done" : "Mark done"}
								onClick={() =>
									update.mutate({
										taskId: t.id,
										status: t.status === "done" ? "todo" : "done",
									})
								}
								className="mt-0.5"
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
								onClick={() => remove.mutate({ taskId: t.id })}
								className="mt-1.5 text-muted-foreground hover:text-foreground"
							>
								<Trash2 className="size-3.5" />
							</button>
						</li>
					);
				})}
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
			<p className="mb-2 self-center rounded-full bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">
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
							<p className="my-2 self-center rounded-full bg-card px-3 py-0.5 text-xs text-muted-foreground shadow-sm">
								{dayLabel(m.createdAt)}
							</p>
						)}
						<div
							ref={(el) => {
								if (el) refs.current.set(m.id, el);
							}}
							className={cn(
								"max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm transition-shadow",
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
								<td className="px-4 py-2 text-right tabular-nums">
									{formatMYR(l.amountSen)}
								</td>
							</tr>
						))}
					</tbody>
					<tfoot className="text-sm">
						<tr className="border-t">
							<td colSpan={2} className="px-4 py-2 text-right font-semibold">
								Total (incl. SST)
							</td>
							<td className="px-4 py-2 text-right font-semibold tabular-nums">
								{formatMYR(q.totalSen)}
							</td>
						</tr>
					</tfoot>
				</table>
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

// --- The PIC's assistant ------------------------------------------------------------------

const starters = [
	"What exactly does the customer want?",
	"What did we promise them in the chat?",
	"Anything unclear I should check first?",
];

function Assistant({
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
	const ask = useMutation(
		orpc.jobs.ask.mutationOptions({ onSuccess: refresh }),
	);
	const addTask = useMutation(
		orpc.jobs.tasks.add.mutationOptions({ onSuccess: refresh }),
	);
	const updateTask = useMutation(
		orpc.jobs.tasks.update.mutationOptions({ onSuccess: refresh }),
	);
	const [draft, setDraft] = useState("");
	const [pending, setPending] = useState<string | null>(null);
	const [applied, setApplied] = useState<Set<string>>(new Set());
	const bottom = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll when new messages arrive
	useEffect(() => {
		bottom.current?.scrollIntoView({ block: "end" });
	}, [job.chat.length, pending]);

	async function send(question: string) {
		if (!me) return toast.error("Choose who you are signed in as first");
		if (!question.trim()) return;
		setPending(question);
		setDraft("");
		try {
			await ask.mutateAsync({ jobId: job.id, staffId: me.id, question });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "The assistant failed");
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
			<div className="border-b px-4 py-3">
				<p className="flex items-center gap-2 font-semibold">
					<span className="flex size-7 items-center justify-center rounded-full bg-[var(--orb-royal)] text-white">
						<Bot className="size-4" />
					</span>
					Job assistant
				</p>
				<p className="mt-1 text-xs text-muted-foreground">
					Uses the signed quotation, captured requirements, agreement
					conversation and file references. If the customer never said, it can
					ask them for you through sales.
				</p>
			</div>
			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
				{job.chat.length === 0 && !pending && (
					<div className="space-y-2">
						<p className="text-xs text-muted-foreground">Try asking:</p>
						{starters.map((s) => (
							<button
								key={s}
								type="button"
								disabled={job.status === "preparing"}
								onClick={() => send(s)}
								className="block w-full rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
							>
								{s}
							</button>
						))}
					</div>
				)}
				{job.chat.map((m) =>
					m.role === "pic" ? (
						<div
							key={m.id}
							className="ml-8 rounded-2xl rounded-tr-sm bg-[var(--orb-navy)] px-3 py-2 text-sm text-white"
						>
							{m.body}
						</div>
					) : (
						<div key={m.id} className="mr-4 space-y-1.5">
							<div className="rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
								{m.body}
							</div>
							{m.sources.length > 0 && (
								<Sources sources={m.sources} onShowMessage={onShowMessage} />
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
												disabled={done}
												onClick={() => apply(key, a)}
												className={cn(
													"inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-left text-xs hover:bg-muted disabled:opacity-60",
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
					),
				)}
				{pending && (
					<>
						<div className="ml-8 rounded-2xl rounded-tr-sm bg-[var(--orb-navy)] px-3 py-2 text-sm text-white">
							{pending}
						</div>
						<p className="flex items-center gap-2 text-xs text-muted-foreground">
							<Loader2 className="size-3.5 animate-spin" /> Looking through the
							chat and brief…
						</p>
					</>
				)}
				<div ref={bottom} />
			</div>
			<form
				className="flex items-end gap-2 border-t p-3"
				onSubmit={(e) => {
					e.preventDefault();
					send(draft);
				}}
			>
				<Textarea
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							e.currentTarget.form?.requestSubmit();
						}
					}}
					rows={1}
					disabled={job.status === "preparing"}
					placeholder={
						job.status === "preparing"
							? "Available once the handover is ready…"
							: "Ask about this job…"
					}
					className="max-h-32 min-h-10 resize-none"
				/>
				<Button
					type="submit"
					size="icon"
					disabled={!draft.trim() || pending !== null}
				>
					<SendHorizontal className="size-4" />
				</Button>
			</form>
		</div>
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
};

function Sources({
	sources,
	onShowMessage,
}: {
	sources: BotSource[];
	onShowMessage: (id: string) => void;
}) {
	return (
		<div className="flex flex-wrap gap-1">
			{sources.map((s, i) => {
				const Icon = sourceIcon[s.kind];
				const clickable = Boolean(s.ref);
				return (
					<button
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
