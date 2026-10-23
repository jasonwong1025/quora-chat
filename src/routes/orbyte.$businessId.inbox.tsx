import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Bot,
	FileText,
	Hand,
	Loader2,
	MessagesSquare,
	SendHorizontal,
	UserRound,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { AiThinking } from "#/components/orbyte/ai-thinking";
import { RelayApproval } from "#/components/orbyte/relay-approval";
import { RequestDetail } from "#/components/orbyte/request-detail";
import { useWorkspace } from "#/components/orbyte/workspace";
import { StatusBadge } from "#/components/status-badge";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import { avatarHue, clock, dayLabel, initials, listTime } from "#/lib/time";
import type { InboxRow } from "#/lib/types";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

export const Route = createFileRoute("/orbyte/$businessId/inbox")({
	validateSearch: z.object({ c: z.string().optional() }),
	component: Inbox,
});

function Inbox() {
	const { business } = useWorkspace();
	const { c } = Route.useSearch();
	const navigate = Route.useNavigate();
	const inbox = useQuery({
		...orpc.inbox.list.queryOptions({ input: { businessId: business.id } }),
		refetchInterval: 2000,
	});
	const selected = inbox.data?.find((x) => x.id === c);
	const pending = useQuery({
		...orpc.relays.pending.queryOptions({ input: { businessId: business.id } }),
		refetchInterval: 4000,
	});
	const needsApproval = new Set(pending.data?.map((r) => r.conversationId));

	return (
		<div className="flex h-full min-h-0">
			<aside
				className={cn(
					"flex w-full shrink-0 flex-col border-r bg-card md:w-72 2xl:w-80",
					selected && "hidden md:flex",
				)}
			>
				<div className="border-b px-4 py-3">
					<h1 className="font-semibold">Quotation inbox</h1>
					<p className="text-xs text-muted-foreground">
						WhatsApp chats with {business.name}
					</p>
				</div>
				<ul className="min-h-0 flex-1 divide-y overflow-y-auto">
					{inbox.data?.map((row) => (
						<li key={row.id}>
							<ChatRow
								row={row}
								needsApproval={needsApproval.has(row.id)}
								active={row.id === c}
								onClick={() => navigate({ search: { c: row.id } })}
							/>
						</li>
					))}
					{inbox.data?.length === 0 && (
						<li className="p-6 text-center text-sm text-muted-foreground">
							<MessagesSquare className="mx-auto mb-2 size-8" />
							No chats yet. Message {business.name} from the{" "}
							<a
								href="/whatsapp"
								target="_blank"
								className="text-primary"
								rel="noopener"
							>
								WhatsApp portal
							</a>
							.
						</li>
					)}
				</ul>
			</aside>

			{selected ? (
				<Conversation
					key={selected.id}
					row={selected}
					onBack={() => navigate({ search: {} })}
				/>
			) : (
				<div className="hidden flex-1 items-center justify-center text-sm text-muted-foreground md:flex">
					Select a chat to see the conversation and quote.
				</div>
			)}
		</div>
	);
}

function Avatar({ name, className }: { name: string; className?: string }) {
	const hue = avatarHue(name);
	return (
		<span
			className={cn(
				"flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
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

function ModePill({ row }: { row: InboxRow }) {
	return row.aiPaused ? (
		<span className="inline-flex items-center gap-1 rounded-full bg-[var(--orb-navy)] px-2 py-0.5 text-[11px] font-medium text-white">
			<UserRound className="size-3" /> {row.handledByName ?? "Staff"}
		</span>
	) : (
		<span className="inline-flex items-center gap-1 rounded-full bg-[var(--orb-cyan)]/20 px-2 py-0.5 text-[11px] font-medium text-[#047a77]">
			<Bot className="size-3" /> AI
		</span>
	);
}

function ChatRow(props: {
	row: InboxRow;
	needsApproval: boolean;
	active: boolean;
	onClick: () => void;
}) {
	const { row } = props;
	return (
		<button
			type="button"
			onClick={props.onClick}
			className={cn(
				"flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/60",
				props.active && "bg-secondary",
			)}
		>
			<Avatar name={row.customerName} />
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline justify-between gap-2">
					<p className="truncate text-sm font-medium">{row.customerName}</p>
					<span className="shrink-0 text-xs text-muted-foreground">
						{listTime(row.lastActivityAt)}
					</span>
				</div>
				<p className="truncate text-xs text-muted-foreground">
					{row.lastMessage?.body.split("\n")[0] ?? "No messages"}
				</p>
				<div className="mt-1.5 flex flex-wrap items-center gap-1">
					<ModePill row={row} />
					{row.latestRequest && (
						<StatusBadge status={row.latestRequest.status} />
					)}
					{props.needsApproval && (
						<span className="rounded-full bg-[var(--orb-royal)] px-2 py-0.5 text-[11px] font-medium text-white">
							Approve question
						</span>
					)}
					{row.awaitingReply && (
						<span className="ml-auto size-2 rounded-full bg-[var(--orb-royal)]" />
					)}
				</div>
			</div>
		</button>
	);
}

function Conversation({ row, onBack }: { row: InboxRow; onBack: () => void }) {
	const { business, me } = useWorkspace();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState("");
	const [view, setView] = useState<"chat" | "request">("chat");

	const conversation = useQuery({
		...orpc.conversations.get.queryOptions({
			input: { conversationId: row.id },
		}),
		refetchInterval: 2000,
	});
	const requests = useQuery({
		...orpc.requests.list.queryOptions({ input: { businessId: business.id } }),
		refetchInterval: 3000,
	});
	const request = requests.data?.find((r) => r.id === row.latestRequest?.id);

	const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.key() });
	const takeover = useMutation(
		orpc.conversations.takeover.mutationOptions({ onSuccess: refresh }),
	);
	const reply = useMutation(
		orpc.conversations.reply.mutationOptions({ onSuccess: refresh }),
	);

	const messages = conversation.data?.messages ?? [];
	const relays = conversation.data?.relays ?? [];
	const pendingRelays = relays.filter((r) => r.status === "pending");
	const runs = conversation.data?.runs ?? [];
	const latestRunId = runs.at(-1)?.id;
	const bottomRef = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll when new messages arrive
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ block: "end" });
	}, [messages.length, view]);

	const mine = row.aiPaused && row.handledBy === me?.id;
	// The customer spoke last and the AI is still on: it is working on a reply.
	// (The thinking card shows this itself once its run has started.)
	const lastCustomer = [...messages]
		.reverse()
		.find((m) => m.sender === "customer");
	const aiWorking =
		row.awaitingReply &&
		!row.aiPaused &&
		Boolean(lastCustomer) &&
		!runs.some((r) => r.messageId === lastCustomer?.id);

	async function toggle(takeOver: boolean) {
		if (!me) return toast.error("Choose who you are signed in as first");
		try {
			await takeover.mutateAsync({
				conversationId: row.id,
				staffId: me.id,
				takeOver,
			});
			toast.success(
				takeOver
					? "You're handling this chat. AI paused."
					: "Handed back to AI",
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		}
	}

	async function send() {
		const body = draft.trim();
		if (!body || !me) return;
		try {
			await reply.mutateAsync({ conversationId: row.id, staffId: me.id, body });
			setDraft("");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Not sent");
		}
	}

	const chat = (
		<section
			className={cn(
				"min-w-0 flex-1 flex-col bg-[var(--orb-gray)]",
				view === "request" ? "hidden @4xl:flex" : "flex",
			)}
		>
			<div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 @xl:px-6 @3xl:px-8">
				<div className="flex flex-col gap-1.5">
					{messages.map((m, i) => {
						const prev = messages[i - 1];
						const newDay =
							!prev ||
							prev.createdAt.toDateString() !== m.createdAt.toDateString();
						const out = m.sender !== "customer";
						const quote = conversation.data?.quotes.find(
							(q) => q.id === m.quoteId,
						);
						return (
							<Fragment key={m.id}>
								{newDay && (
									<p className="my-2 self-center rounded-full bg-card px-3 py-0.5 text-xs text-muted-foreground shadow-sm">
										{dayLabel(m.createdAt)}
									</p>
								)}
								<div
									className={cn(
										"max-w-[88%] rounded-2xl px-3.5 py-2 text-sm break-words shadow-sm @xl:max-w-[80%]",
										!out && "self-start rounded-tl-sm border bg-card",
										m.sender === "assistant" &&
											"self-end rounded-tr-sm bg-[#dff4ff]",
										m.sender === "staff" &&
											"self-end rounded-tr-sm bg-[var(--orb-navy)] text-white",
									)}
								>
									<p
										className={cn(
											"mb-0.5 flex items-center gap-1 text-[11px] font-semibold",
											m.sender === "customer" && "text-muted-foreground",
											m.sender === "assistant" && "text-[var(--orb-royal)]",
											m.sender === "staff" && "text-[var(--orb-cyan)]",
										)}
									>
										{m.sender === "customer" ? (
											row.customerName
										) : m.sender === "assistant" ? (
											<>
												<Bot className="size-3" /> AI assistant
											</>
										) : (
											<>
												<UserRound className="size-3" />{" "}
												{m.authorName ?? "Staff"}
												{(() => {
													const r = relays.find(
														(x) => x.status !== "pending" && x.draft === m.body,
													);
													return r ? (
														<span className="font-normal opacity-80">
															{" "}
															· for {r.askedBy ?? "PIC"} ({r.jobNumber})
														</span>
													) : null;
												})()}
											</>
										)}
									</p>
									{quote && (
										<a
											href={`/api/quotes/${quote.id}/pdf`}
											target="_blank"
											rel="noreferrer"
											className="mb-1.5 flex items-center gap-2 rounded-lg bg-white/10 px-2.5 py-2 text-xs hover:bg-white/20"
										>
											<FileText className="size-4" /> {quote.number}.pdf ·{" "}
											{quote.status === "accepted"
												? "Signed"
												: "Sent for signature"}
										</a>
									)}
									{m.attachment &&
										(m.attachment.mime.startsWith("image/") ? (
											<a
												href={`/api/messages/${m.id}/attachment`}
												target="_blank"
												rel="noreferrer"
												className="mb-1.5 block"
											>
												<img
													src={`/api/messages/${m.id}/attachment`}
													alt={m.attachment.name}
													className="max-h-60 rounded-lg object-cover"
												/>
											</a>
										) : (
											<a
												href={`/api/messages/${m.id}/attachment`}
												target="_blank"
												rel="noreferrer"
												className="mb-1.5 flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs hover:bg-muted/70"
											>
												<FileText className="size-4" /> {m.attachment.name}
											</a>
										))}
									{m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
									<p
										className={cn(
											"mt-0.5 text-right text-[10px]",
											m.sender === "staff"
												? "text-white/50"
												: "text-muted-foreground",
										)}
									>
										{clock(m.createdAt)}
									</p>
								</div>
								{runs
									.filter((r) => r.messageId === m.id)
									.map((r) => (
										<AiThinking
											key={r.id}
											run={r}
											defaultOpen={r.id === latestRunId}
										/>
									))}
							</Fragment>
						);
					})}
					{aiWorking && (
						<p className="flex items-center gap-1.5 self-end text-xs text-muted-foreground">
							<Loader2 className="size-3 animate-spin" /> AI is reading the
							message and preparing a reply…
						</p>
					)}
					<div ref={bottomRef} />
				</div>
			</div>

			{pendingRelays.length > 0 && (
				<div className="space-y-2 border-t bg-card px-3 pt-3">
					{pendingRelays.map((r) => (
						<RelayApproval key={r.id} relay={r} />
					))}
				</div>
			)}
			<div className="border-t bg-card p-3">
				{!mine && (
					<p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
						<Hand className="size-3.5" />
						{row.aiPaused
							? `${row.handledByName ?? "Someone"} is handling this chat. Sending will make you the handler.`
							: "The AI is replying to this chat. Sending a message takes over and pauses the AI."}
					</p>
				)}
				<form
					className="flex items-end gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						send();
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
						placeholder={`Reply to ${row.customerName} on WhatsApp…`}
						className="max-h-32 min-h-10 resize-none bg-card"
					/>
					<Button
						type="submit"
						size="icon"
						disabled={!draft.trim() || reply.isPending || !me}
					>
						{reply.isPending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<SendHorizontal className="size-4" />
						)}
					</Button>
				</form>
			</div>
		</section>
	);

	return (
		// Sized by the space this pane has (not the window), since the app sidebar
		// and chat list take a varying share of the screen.
		<div className="@container flex min-w-0 flex-1 flex-col">
			<header className="flex items-center gap-2 border-b bg-card px-3 py-2.5 @xl:gap-3 @xl:px-4">
				<button
					type="button"
					onClick={onBack}
					className="-my-1 shrink-0 py-1 text-sm text-primary md:hidden"
				>
					← Chats
				</button>
				<Avatar name={row.customerName} className="hidden size-9 @md:flex" />
				<div className="min-w-0 flex-1">
					<p className="flex min-w-0 items-center gap-2 font-medium">
						<span className="truncate">{row.customerName}</span>
						<span className="shrink-0">
							<ModePill row={row} />
						</span>
					</p>
					<p className="truncate text-xs text-muted-foreground">
						{row.customerPhone ?? "WhatsApp"}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<div
						role="tablist"
						aria-label="Show"
						className="flex rounded-lg border p-0.5 @4xl:hidden"
					>
						{(["chat", "request"] as const).map((v) => (
							<button
								key={v}
								type="button"
								role="tab"
								aria-selected={view === v}
								onClick={() => setView(v)}
								className={cn(
									"rounded-md px-2.5 py-1 text-xs capitalize",
									view === v && "bg-secondary font-medium",
								)}
							>
								{v}
							</button>
						))}
					</div>
					{row.aiPaused ? (
						<Button
							size="sm"
							variant="outline"
							disabled={takeover.isPending}
							aria-label="Hand back to AI"
							title="Hand back to AI"
							onClick={() => toggle(false)}
						>
							<Bot className="size-4" />
							<span className="hidden @lg:inline">Hand back to AI</span>
						</Button>
					) : (
						<Button
							size="sm"
							disabled={takeover.isPending}
							aria-label="Take over"
							title="Take over: pause the AI and reply yourself"
							onClick={() => toggle(true)}
						>
							<Hand className="size-4" />
							<span className="hidden @lg:inline">Take over</span>
						</Button>
					)}
				</div>
			</header>

			<div className="flex min-h-0 flex-1">
				{chat}
				<aside
					className={cn(
						"w-full min-w-0 shrink-0 overflow-y-auto bg-card @4xl:block @4xl:w-[400px] @4xl:border-l @6xl:w-[480px]",
						view === "chat" && "hidden",
					)}
				>
					{request ? (
						<RequestDetail key={request.id} request={request} showActivity />
					) : (
						<div className="p-6 text-sm text-muted-foreground">
							No quote request yet for this chat.
						</div>
					)}
					{request && (
						<div className="border-t px-4 py-3">
							<Link
								to="/orbyte/$businessId/quotes"
								params={{ businessId: business.id }}
								search={{ r: request.id }}
								className="text-sm text-primary"
							>
								Open in Quotes →
							</Link>
						</div>
					)}
				</aside>
			</div>
		</div>
	);
}
