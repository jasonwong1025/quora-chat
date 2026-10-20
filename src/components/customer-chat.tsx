import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, FileText, Loader2, Plus, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Textarea } from "#/components/ui/textarea";
import type { BusinessDetail } from "#/lib/types";
import { cn } from "#/lib/utils";
import { client, orpc } from "#/orpc/client";
import type { WorkflowStep } from "#/server/workflow";

const stepLabel: Record<WorkflowStep["step"], string> = {
	received: "Message received",
	parsed: "Request understood",
	priced: "Checked against catalog & pricing rules",
	replied: "Reply sent",
	failed: "Could not read message — sent to staff",
};

const outcomeLabel = {
	needs_clarification: "asking customer for missing details",
	needs_review: "flagged for human review",
	draft_ready: "draft quotation prepared",
} as const;

export function CustomerChat(props: {
	business: BusinessDetail;
	conversationId: string | undefined;
	onSelectConversation: (id: string | undefined) => void;
}) {
	const { business, conversationId, onSelectConversation } = props;
	const queryClient = useQueryClient();
	const [steps, setSteps] = useState<WorkflowStep[]>([]);
	const [pending, setPending] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [newName, setNewName] = useState("");

	const conversations = useQuery(
		orpc.conversations.list.queryOptions({
			input: { businessId: business.id },
		}),
	);
	const conversation = useQuery({
		...orpc.conversations.get.queryOptions({
			input: { conversationId: conversationId ?? "" },
		}),
		enabled: Boolean(conversationId),
	});

	const create = useMutation(orpc.conversations.create.mutationOptions());

	const bottomRef = useRef<HTMLDivElement>(null);
	const messageCount = conversation.data?.messages.length ?? 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll when content changes
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messageCount, steps.length, pending]);

	async function send(targetId: string, body: string) {
		setPending(body);
		setSteps([]);
		try {
			const stream = await client.conversations.send({
				conversationId: targetId,
				body,
			});
			for await (const step of stream) {
				setSteps((s) => [...s, step]);
				if (step.step === "received") {
					setPending(null);
					queryClient.invalidateQueries({ queryKey: orpc.conversations.key() });
				}
				if (step.step === "priced" || step.step === "failed") {
					queryClient.invalidateQueries({ queryKey: orpc.requests.key() });
					queryClient.invalidateQueries({ queryKey: orpc.activity.key() });
				}
			}
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to send message",
			);
		} finally {
			setPending(null);
			queryClient.invalidateQueries({ queryKey: orpc.key() });
		}
	}

	async function startConversation(
		customerName: string,
		firstMessage?: string,
	) {
		const row = await create.mutateAsync({
			businessId: business.id,
			customerName,
		});
		await queryClient.invalidateQueries({
			queryKey: orpc.conversations.list.key(),
		});
		onSelectConversation(row.id);
		if (firstMessage) await send(row.id, firstMessage);
	}

	const busy =
		pending !== null ||
		(steps.length > 0 &&
			!steps.some((s) => s.step === "replied" || s.step === "failed"));

	return (
		<div className="flex h-full min-h-0 overflow-hidden rounded-xl border bg-card">
			{/* Conversation list */}
			<aside className="hidden w-52 shrink-0 flex-col border-r sm:flex">
				<div className="border-b p-3">
					<p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Customer chats
					</p>
					<form
						className="mt-2 flex gap-1"
						onSubmit={(e) => {
							e.preventDefault();
							if (newName.trim()) {
								startConversation(newName.trim());
								setNewName("");
							}
						}}
					>
						<Input
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							placeholder="New customer"
							className="h-8 text-sm"
						/>
						<Button
							type="submit"
							size="icon"
							variant="outline"
							className="size-8 shrink-0"
						>
							<Plus className="size-4" />
						</Button>
					</form>
				</div>
				<ScrollArea className="min-h-0 flex-1">
					<ul className="p-1">
						{conversations.data?.map((c) => (
							<li key={c.id}>
								<button
									type="button"
									onClick={() => onSelectConversation(c.id)}
									className={cn(
										"w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
										c.id === conversationId && "bg-accent font-medium",
									)}
								>
									{c.customerName}
								</button>
							</li>
						))}
						{conversations.data?.length === 0 && (
							<li className="px-3 py-4 text-xs text-muted-foreground">
								No chats yet. Try a sample message →
							</li>
						)}
					</ul>
				</ScrollArea>
			</aside>

			{/* Chat window */}
			<section className="flex min-w-0 flex-1 flex-col">
				<header className="flex items-center gap-3 border-b px-4 py-3">
					<div className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
						{business.name.slice(0, 1)}
					</div>
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold">{business.name}</p>
						<p className="truncate text-xs text-muted-foreground">
							{conversation.data
								? `Chatting as ${conversation.data.customerName}`
								: "Simulated customer chat"}
						</p>
					</div>
				</header>

				<ScrollArea className="min-h-0 flex-1 bg-chat-bg">
					<div className="flex flex-col gap-2 p-4">
						{!conversationId && (
							<SamplePicker
								business={business}
								disabled={busy || create.isPending}
								onPick={(name, body) => startConversation(name, body)}
							/>
						)}

						{conversation.data?.messages.map((m) =>
							m.sender === "customer" ? (
								<Bubble key={m.id} side="right">
									{m.body}
								</Bubble>
							) : (
								<Bubble
									key={m.id}
									side="left"
									tag={m.sender === "assistant" ? "Auto-reply" : "Staff"}
								>
									{m.body}
									{m.quoteId && (
										<Link
											to="/quotes/$quoteId"
											params={{ quoteId: m.quoteId }}
											className="mt-2 flex items-center gap-2 rounded-md border bg-background/60 px-3 py-2 text-xs font-medium text-primary hover:bg-background"
										>
											<FileText className="size-4" /> View quotation
										</Link>
									)}
								</Bubble>
							),
						)}

						{pending && (
							<Bubble side="right" className="opacity-60">
								{pending}
							</Bubble>
						)}

						{steps.length > 0 && (
							<WorkflowProgress steps={steps} done={!busy} />
						)}
						<div ref={bottomRef} />
					</div>
				</ScrollArea>

				{conversationId && (
					<form
						className="flex items-end gap-2 border-t p-3"
						onSubmit={(e) => {
							e.preventDefault();
							const body = draft.trim();
							if (!body || busy) return;
							setDraft("");
							send(conversationId, body);
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
							placeholder="Type as the customer (EN / BM / 中文)…"
							className="max-h-32 min-h-10 resize-none"
						/>
						<Button type="submit" size="icon" disabled={busy || !draft.trim()}>
							{busy ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Send className="size-4" />
							)}
						</Button>
					</form>
				)}
			</section>
		</div>
	);
}

function Bubble(props: {
	side: "left" | "right";
	tag?: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div
			className={cn(
				"max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap shadow-sm",
				props.side === "right"
					? "self-end rounded-tr-none bg-bubble-customer"
					: "self-start rounded-tl-none bg-bubble-business",
				props.className,
			)}
		>
			{props.tag && (
				<p className="mb-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
					{props.tag}
				</p>
			)}
			{props.children}
		</div>
	);
}

function WorkflowProgress({
	steps,
	done,
}: {
	steps: WorkflowStep[];
	done: boolean;
}) {
	return (
		<div className="my-1 self-center rounded-lg border bg-background/80 px-3 py-2 text-xs shadow-sm">
			<p className="mb-1 flex items-center gap-1 font-semibold text-muted-foreground">
				<Sparkles className="size-3" /> Quora Chat workflow
			</p>
			<ul className="space-y-0.5">
				{steps.map((s, i) => (
					<li key={`${s.step}-${i}`} className="flex items-center gap-1.5">
						<Check className="size-3 text-status-approved" />
						<span>
							{stepLabel[s.step]}
							{s.step === "parsed" && ` — ${s.summary}`}
							{s.step === "priced" && ` — ${outcomeLabel[s.outcome]}`}
						</span>
					</li>
				))}
				{!done && (
					<li className="flex items-center gap-1.5 text-muted-foreground">
						<Loader2 className="size-3 animate-spin" /> Working…
					</li>
				)}
			</ul>
		</div>
	);
}

function SamplePicker(props: {
	business: BusinessDetail;
	disabled: boolean;
	onPick: (customerName: string, body: string) => void;
}) {
	return (
		<div className="mx-auto w-full max-w-md rounded-lg border bg-background/90 p-4 shadow-sm">
			<p className="text-sm font-semibold">Start a demo conversation</p>
			<p className="mb-3 text-xs text-muted-foreground">
				Pick a sample customer message, or add a customer on the left and type
				your own.
			</p>
			<div className="flex flex-col gap-2">
				{props.business.sampleMessages.map((s) => (
					<button
						key={s.label}
						type="button"
						disabled={props.disabled}
						onClick={() => props.onPick(s.customerName, s.body)}
						className="rounded-md border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
					>
						<span className="block text-xs font-semibold text-primary">
							{s.label}
						</span>
						<span className="line-clamp-2">{s.body}</span>
					</button>
				))}
			</div>
		</div>
	);
}
