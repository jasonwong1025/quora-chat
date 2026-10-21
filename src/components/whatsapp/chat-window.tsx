import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	Check,
	CheckCheck,
	Clock3,
	Lock,
	Mic,
	MoreVertical,
	PenLine,
	Plus,
	Search,
	SendHorizontal,
	Smile,
	Video,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { clock, dayLabel } from "#/lib/time";
import type { ConversationDetail, WhatsappChat } from "#/lib/types";
import { cn } from "#/lib/utils";
import type { WaProfile } from "#/lib/wa-profile";
import { client, orpc } from "#/orpc/client";
import { WaAvatar } from "./avatar";

type QuoteInfo = ConversationDetail["quotes"][number];

export function ChatWindow(props: {
	chat: WhatsappChat;
	conversationId: string | null;
	profile: WaProfile;
	onBack: () => void;
	onTyping: (typing: boolean) => void;
	onSeen: (conversationId: string) => void;
}) {
	const { chat, profile } = props;
	const business = chat.business;
	const queryClient = useQueryClient();
	const [conversationId, setConversationId] = useState(props.conversationId);
	const [pending, setPending] = useState<string | null>(null);
	const [typing, setTyping] = useState(false);
	const [draft, setDraft] = useState("");

	useEffect(
		() => setConversationId(props.conversationId),
		[props.conversationId],
	);

	const conversation = useQuery({
		...orpc.conversations.get.queryOptions({
			input: { conversationId: conversationId ?? "" },
		}),
		enabled: Boolean(conversationId),
		refetchInterval: 2000,
	});
	const messages = conversation.data?.messages ?? [];

	const detail = useQuery({
		...orpc.businesses.get.queryOptions({ input: { businessId: business.id } }),
		enabled: messages.length === 0,
	});

	const open = useMutation(orpc.whatsapp.open.mutationOptions());

	const { onSeen } = props;
	const bottomRef = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll and mark read when content changes
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ block: "end" });
		if (conversationId) onSeen(conversationId);
	}, [messages.length, typing, pending, conversationId]);

	async function send(body: string) {
		setPending(body);
		try {
			let id = conversationId;
			if (!id) {
				const row = await open.mutateAsync({
					businessId: business.id,
					phone: profile.phone,
					name: profile.name,
				});
				id = row.id;
				setConversationId(id);
			}
			const stream = await client.conversations.send({
				conversationId: id,
				body,
			});
			for await (const step of stream) {
				if (step.step === "received") {
					await queryClient.invalidateQueries({
						queryKey: orpc.conversations.get.key(),
					});
					setPending(null);
					// The business "reads" the message, then starts typing.
					setTyping(true);
					props.onTyping(true);
				}
				if (step.step === "held") {
					setTyping(false);
					props.onTyping(false);
				}
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Message not sent");
		} finally {
			setPending(null);
			setTyping(false);
			props.onTyping(false);
			queryClient.invalidateQueries({ queryKey: orpc.conversations.key() });
			queryClient.invalidateQueries({ queryKey: orpc.whatsapp.key() });
		}
	}

	const busy = pending !== null || typing;

	return (
		<div className="flex h-full min-w-0 flex-col">
			<header className="flex items-center gap-3 border-b border-[var(--wa-border)] bg-[var(--wa-panel)] px-4 py-2.5">
				<button
					type="button"
					onClick={props.onBack}
					className="-ml-1 rounded-full p-1 text-[var(--wa-muted)] md:hidden"
				>
					<ArrowLeft className="size-5" />
				</button>
				<WaAvatar name={business.name} size={40} />
				<div className="min-w-0 flex-1">
					<p className="truncate text-[16px]">{business.name}</p>
					<p
						className={cn(
							"truncate text-xs",
							typing ? "text-[var(--wa-green)]" : "text-[var(--wa-muted)]",
						)}
					>
						{typing ? "typing…" : "Business account"}
					</p>
				</div>
				<div className="flex items-center gap-1 text-[var(--wa-muted)]">
					{[Video, Search, MoreVertical].map((Icon, i) => (
						<span
							key={i}
							title="Not part of the demo"
							className="rounded-full p-2 hover:bg-[var(--wa-hover)]"
						>
							<Icon className="size-5" />
						</span>
					))}
				</div>
			</header>

			<div className="wa-doodle min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex max-w-4xl flex-col gap-0.5 px-4 py-3 md:px-12">
					<p className="mx-auto my-2 flex max-w-md items-start gap-1.5 rounded-lg bg-[var(--wa-in)] px-3 py-1.5 text-center text-xs text-[#ffd279]">
						<Lock className="mt-0.5 size-3 shrink-0" />
						Simulated WhatsApp for the Quora Chat demo. Messages go to{" "}
						{business.name} through Orbyte.
					</p>

					{messages.length === 0 && !pending && (
						<EmptyChat
							business={business}
							samples={detail.data?.sampleMessages ?? []}
							disabled={busy}
							onPick={send}
						/>
					)}

					{messages.map((m, i) => {
						const prev = messages[i - 1];
						const newDay =
							!prev ||
							prev.createdAt.toDateString() !== m.createdAt.toDateString();
						const out = m.sender === "customer";
						const first =
							newDay || !prev || (prev.sender === "customer") !== out;
						const read = messages
							.slice(i + 1)
							.some((n) => n.sender !== "customer");
						const quote = m.quoteId
							? conversation.data?.quotes.find((q) => q.id === m.quoteId)
							: undefined;
						return (
							<Fragment key={m.id}>
								{newDay && <DayChip label={dayLabel(m.createdAt)} />}
								{quote ? (
									<div className="mt-2 flex max-w-[85%] flex-col self-start md:max-w-[65%]">
										<Bubble
											out={false}
											first
											time={clock(m.createdAt)}
											className="mt-0 max-w-none self-stretch md:max-w-none"
										>
											<QuoteDoc quote={quote} />
											{m.body}
										</Bubble>
										<SignButton quote={quote} />
									</div>
								) : (
									<Bubble
										out={out}
										first={first}
										time={clock(m.createdAt)}
										ticks={out ? (read ? "read" : "delivered") : undefined}
									>
										{m.body}
									</Bubble>
								)}
							</Fragment>
						);
					})}

					{pending && (
						<Bubble out first time={clock(new Date())} ticks="pending">
							{pending}
						</Bubble>
					)}

					{typing && (
						<div className="mt-1 self-start rounded-lg rounded-tl-none bg-[var(--wa-in)] px-4 py-3">
							<span className="wa-typing flex gap-1">
								<span className="size-2 rounded-full bg-[var(--wa-muted)]" />
								<span className="size-2 rounded-full bg-[var(--wa-muted)]" />
								<span className="size-2 rounded-full bg-[var(--wa-muted)]" />
							</span>
						</div>
					)}
					<div ref={bottomRef} className="h-2" />
				</div>
			</div>

			<form
				className="flex items-end gap-1 bg-[var(--wa-app)] px-4 pt-1 pb-3"
				onSubmit={(e) => {
					e.preventDefault();
					const body = draft.trim();
					if (!body || busy) return;
					setDraft("");
					send(body);
				}}
			>
				<div className="flex min-h-[52px] flex-1 items-end gap-1 rounded-[26px] bg-[var(--wa-in)] px-2 py-1.5">
					<span className="rounded-full p-2 text-[var(--wa-text)]">
						<Plus className="size-6" />
					</span>
					<span className="rounded-full p-2 text-[var(--wa-text)]">
						<Smile className="size-6" />
					</span>
					<textarea
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								e.currentTarget.form?.requestSubmit();
							}
						}}
						rows={1}
						placeholder="Type a message"
						className="max-h-32 min-h-10 flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-[var(--wa-muted)]"
					/>
					{draft.trim() ? (
						<button
							type="submit"
							disabled={busy}
							className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--wa-green)] text-black disabled:opacity-50"
						>
							<SendHorizontal className="size-5" />
						</button>
					) : (
						<span className="rounded-full p-2 text-[var(--wa-text)]">
							<Mic className="size-6" />
						</span>
					)}
				</div>
			</form>
		</div>
	);
}

function DayChip({ label }: { label: string }) {
	return (
		<p className="mx-auto my-2 rounded-lg bg-[var(--wa-in)] px-3 py-1 text-xs text-[var(--wa-muted)]">
			{label}
		</p>
	);
}

function Bubble(props: {
	out: boolean;
	first: boolean;
	time: string;
	ticks?: "pending" | "delivered" | "read";
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div
			className={cn(
				"relative max-w-[85%] rounded-lg px-2.5 pt-1.5 pb-1 text-[14.5px] leading-snug shadow-sm md:max-w-[65%]",
				props.out
					? "self-end bg-[var(--wa-out)]"
					: "self-start bg-[var(--wa-in)]",
				props.first && "mt-2",
				props.first && (props.out ? "rounded-tr-none" : "rounded-tl-none"),
				props.className,
			)}
		>
			{props.first && (
				<svg
					viewBox="0 0 8 13"
					aria-hidden="true"
					className={cn(
						"absolute top-0 h-[13px] w-2",
						props.out
							? "-right-2 fill-[var(--wa-out)]"
							: "-left-2 -scale-x-100 fill-[var(--wa-in)]",
					)}
				>
					<path d="M0 0h8L1.5 9.5C1 10.2 0 9.8 0 9V0z" />
				</svg>
			)}
			<div className="whitespace-pre-wrap break-words">
				{props.children}
				{/* Spacer so the timestamp never overlaps the last line. */}
				<span className="inline-block w-[4.5rem]" />
			</div>
			<span className="absolute right-2 bottom-1 flex items-center gap-1 text-[11px] text-white/60">
				{props.time}
				{props.ticks === "pending" && <Clock3 className="size-3" />}
				{props.ticks === "delivered" && <CheckCheck className="size-4" />}
				{props.ticks === "read" && (
					<CheckCheck className="size-4 text-[var(--wa-tick-read)]" />
				)}
			</span>
		</div>
	);
}

function QuoteDoc({ quote }: { quote: QuoteInfo }) {
	return (
		<a
			href={`/api/quotes/${quote.id}/pdf`}
			target="_blank"
			rel="noreferrer"
			className="mb-1.5 flex min-w-64 items-center gap-3 rounded-md bg-black/25 p-3 hover:bg-black/35"
		>
			<span className="flex h-11 w-9 shrink-0 items-end justify-center rounded-sm bg-[#e5493a] pb-1 text-[9px] font-bold text-white">
				PDF
			</span>
			<span className="min-w-0">
				<span className="block truncate">{quote.number}.pdf</span>
				<span className="block text-xs text-white/60">1 page · PDF</span>
			</span>
		</a>
	);
}

function SignButton({ quote }: { quote: QuoteInfo }) {
	const signed = quote.status === "accepted";
	return (
		<div className="mt-0.5 flex rounded-lg bg-[var(--wa-in)]">
			{signed ? (
				<span className="flex flex-1 items-center justify-center gap-2 py-2.5 text-sm text-[var(--wa-muted)]">
					<Check className="size-4" /> Signed
				</span>
			) : (
				<a
					href={`/sign/${quote.id}`}
					target="_blank"
					rel="noreferrer"
					className="flex flex-1 items-center justify-center gap-2 py-2.5 text-sm text-[var(--wa-green)] hover:bg-white/5"
				>
					<PenLine className="size-4" /> Review & sign
				</a>
			)}
		</div>
	);
}

function EmptyChat(props: {
	business: WhatsappChat["business"];
	samples: { label: string; customerName: string; body: string }[];
	disabled: boolean;
	onPick: (body: string) => void;
}) {
	return (
		<div className="mx-auto my-6 w-full max-w-md rounded-xl bg-[var(--wa-panel)]/95 p-5 text-center">
			<div className="flex justify-center">
				<WaAvatar name={props.business.name} size={72} />
			</div>
			<p className="mt-3 text-lg">{props.business.name}</p>
			<p className="text-sm text-[var(--wa-muted)]">
				Business account · {props.business.industry}
			</p>
			{props.business.tagline && (
				<p className="mt-1 text-sm text-[var(--wa-muted)]">
					{props.business.tagline}
				</p>
			)}
			{props.samples.length > 0 && (
				<div className="mt-5 text-left">
					<p className="mb-2 text-xs font-semibold tracking-wide text-[var(--wa-green)] uppercase">
						Demo · tap a sample message
					</p>
					<div className="flex flex-col gap-2">
						{props.samples.map((s) => (
							<button
								key={s.label}
								type="button"
								disabled={props.disabled}
								onClick={() => props.onPick(s.body)}
								className="rounded-lg border border-[var(--wa-border)] px-3 py-2 text-left text-sm hover:bg-[var(--wa-hover)] disabled:opacity-50"
							>
								<span className="block text-xs text-[var(--wa-muted)]">
									{s.label}
								</span>
								<span className="line-clamp-2">{s.body}</span>
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
