import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	Check,
	CheckCheck,
	Clock3,
	FileText,
	Lock,
	Mic,
	MoreVertical,
	PenLine,
	Plus,
	Search,
	SendHorizontal,
	Smile,
	Video,
	X,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAiMode } from "#/components/ai-mode";
import { fileToThumb } from "#/components/orbyte/product-image";
import { flagshipScenario, scriptKey } from "#/data/demo-scenario";
import { clock, dayLabel } from "#/lib/time";
import type { ConversationDetail, WhatsappChat } from "#/lib/types";
import { cn } from "#/lib/utils";
import type { WaProfile } from "#/lib/wa-profile";
import { client, orpc } from "#/orpc/client";
import { WaAvatar } from "./avatar";
import { DocLink, InvoiceCard, PayButton, PaymentCard, PaySheet } from "./pay";

type QuoteInfo = ConversationDetail["quotes"][number];
type Message = ConversationDetail["messages"][number];
type Outgoing = { name: string; mime: string; dataUrl: string };

const MAX_FILE = 4 * 1024 * 1024;

/** Photos are shrunk before sending; documents go as they are (up to 4 MB). */
async function readAttachment(file: File): Promise<Outgoing> {
	if (file.type.startsWith("image/")) {
		const dataUrl = await fileToThumb(file, 1280);
		return {
			name: `${file.name.replace(/\.[^.]+$/, "")}.jpg`,
			mime: "image/jpeg",
			dataUrl,
		};
	}
	if (file.size > MAX_FILE) throw new Error("File is too large (max 4 MB)");
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(new Error("Could not read the file"));
		reader.readAsDataURL(file);
	});
	return { name: file.name, mime: file.type, dataUrl };
}

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
	const [pending, setPending] = useState<{
		body: string;
		file: Outgoing | null;
	} | null>(null);
	const [file, setFile] = useState<Outgoing | null>(null);
	const [typing, setTyping] = useState(false);
	const [draft, setDraft] = useState("");
	const [payingId, setPayingId] = useState<string | null>(null);

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

	async function send(body: string, attachment: Outgoing | null = null) {
		setPending({ body, file: attachment });
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
				attachment,
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
	const aiInfo = useAiMode();
	// The flagship demo: offer the next scripted line (in order) for Kilat.
	const said = new Set(
		messages
			.filter((m) => m.sender === "customer")
			.map((m) => scriptKey(m.body)),
	);
	const nextStep =
		business.id === flagshipScenario.businessId
			? flagshipScenario.steps
					.map((s, index) => ({ ...s, index }))
					.find((s) => !said.has(scriptKey(s.say)))
			: undefined;

	const paying = payingId
		? conversation.data?.invoices.find((x) => x.id === payingId)
		: undefined;

	return (
		<div className="relative flex h-full min-w-0 flex-col">
			{paying && (
				<PaySheet
					invoice={paying}
					businessName={business.name}
					onClose={() => setPayingId(null)}
				/>
			)}
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
					{(
						[
							["video", Video],
							["search", Search],
							["menu", MoreVertical],
						] as const
					).map(([name, Icon]) => (
						<span
							key={name}
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
						{aiInfo?.aiMode === "replay" &&
							" Replay mode: the AI's replies are scripted for this demo."}
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
						const invoice = m.invoiceId
							? conversation.data?.invoices.find((x) => x.id === m.invoiceId)
							: undefined;
						const payment = m.paymentId
							? conversation.data?.payments.find((x) => x.id === m.paymentId)
							: undefined;
						return (
							<Fragment key={m.id}>
								{newDay && <DayChip label={dayLabel(m.createdAt)} />}
								{invoice ? (
									<div className="mt-2 flex max-w-[85%] flex-col self-start md:max-w-[65%]">
										<Bubble
											out={false}
											first
											time={clock(m.createdAt)}
											className="mt-0 max-w-none self-stretch md:max-w-none"
										>
											<InvoiceCard invoice={invoice} />
											{m.body}
										</Bubble>
										<PayButton
											invoice={invoice}
											onPay={() => setPayingId(invoice.id)}
										/>
									</div>
								) : payment ? (
									<Bubble
										out
										first
										time={clock(m.createdAt)}
										ticks={read ? "read" : "delivered"}
									>
										<PaymentCard
											payment={payment}
											invoice={conversation.data?.invoices.find(
												(x) => x.id === payment.invoiceId,
											)}
											businessName={business.name}
										/>
									</Bubble>
								) : m.document ? (
									<Bubble out={false} first={first} time={clock(m.createdAt)}>
										<DocLink doc={m.document} />
										{m.body}
									</Bubble>
								) : quote ? (
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
										{m.attachment && <AttachmentView message={m} />}
										{m.body}
									</Bubble>
								)}
							</Fragment>
						);
					})}

					{pending && (
						<Bubble out first time={clock(new Date())} ticks="pending">
							{pending.file && (
								<span className="mb-1 flex items-center gap-2 rounded-md bg-black/20 p-2 text-sm">
									<FileText className="size-4" /> {pending.file.name}
								</span>
							)}
							{pending.body}
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

			{nextStep && !file && (
				<div className="flex items-center gap-2 bg-[var(--wa-app)] px-4 pt-2">
					<span className="shrink-0 text-[11px] text-[var(--wa-muted)]">
						Demo script {nextStep.index + 1}/{flagshipScenario.steps.length}
					</span>
					<button
						type="button"
						disabled={busy}
						onClick={() => send(nextStep.say)}
						title={nextStep.note}
						className="min-w-0 truncate rounded-full border border-[var(--wa-border)] bg-[var(--wa-in)] px-3 py-1 text-left text-sm hover:bg-[var(--wa-hover)] disabled:opacity-50"
					>
						{nextStep.say}
					</button>
				</div>
			)}
			{file && (
				<div className="flex items-center gap-3 bg-[var(--wa-app)] px-6 pt-2">
					<div className="flex min-w-0 items-center gap-2 rounded-lg bg-[var(--wa-in)] px-3 py-2 text-sm">
						{file.mime.startsWith("image/") ? (
							<img
								src={file.dataUrl}
								alt=""
								className="size-10 rounded object-cover"
							/>
						) : (
							<FileText className="size-5 text-[var(--wa-muted)]" />
						)}
						<span className="truncate">{file.name}</span>
						<button
							type="button"
							onClick={() => setFile(null)}
							className="rounded-full p-1 text-[var(--wa-muted)] hover:bg-[var(--wa-hover)]"
						>
							<X className="size-4" />
							<span className="sr-only">Remove attachment</span>
						</button>
					</div>
					<span className="text-xs text-[var(--wa-muted)]">
						Add a caption, or just send
					</span>
				</div>
			)}
			<form
				className="flex items-end gap-1 bg-[var(--wa-app)] px-4 pt-1 pb-3"
				onSubmit={(e) => {
					e.preventDefault();
					const body = draft.trim();
					if ((!body && !file) || busy) return;
					setDraft("");
					setFile(null);
					send(body, file);
				}}
			>
				<div className="flex min-h-[52px] flex-1 items-end gap-1 rounded-[26px] bg-[var(--wa-in)] px-2 py-1.5">
					<label
						title="Attach a photo or document"
						className="cursor-pointer rounded-full p-2 text-[var(--wa-text)] hover:bg-[var(--wa-hover)]"
					>
						<Plus className="size-6" />
						<span className="sr-only">Attach a photo or document</span>
						<input
							type="file"
							accept="image/*,application/pdf,.docx,.xlsx"
							className="sr-only"
							onChange={async (e) => {
								const picked = e.target.files?.[0];
								e.target.value = "";
								if (!picked) return;
								try {
									setFile(await readAttachment(picked));
								} catch (err) {
									toast.error(
										err instanceof Error ? err.message : "Could not attach",
									);
								}
							}}
						/>
					</label>
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
					{draft.trim() || file ? (
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

function AttachmentView({ message }: { message: Message }) {
	const a = message.attachment;
	if (!a) return null;
	const url = `/api/messages/${message.id}/attachment`;
	if (a.mime.startsWith("image/")) {
		return (
			<a
				href={url}
				target="_blank"
				rel="noreferrer"
				className="-mx-1 mb-1 block"
			>
				<img
					src={url}
					alt={a.name}
					className="max-h-72 w-full max-w-72 rounded-md object-cover"
				/>
			</a>
		);
	}
	const ext = a.name.split(".").pop()?.toUpperCase().slice(0, 4) ?? "FILE";
	return (
		<a
			href={url}
			target="_blank"
			rel="noreferrer"
			className="mb-1.5 flex min-w-60 items-center gap-3 rounded-md bg-black/25 p-3 hover:bg-black/35"
		>
			<span className="flex h-11 w-9 shrink-0 items-end justify-center rounded-sm bg-[#5b8def] pb-1 text-[9px] font-bold text-white">
				{ext}
			</span>
			<span className="min-w-0">
				<span className="block truncate">{a.name}</span>
				<span className="block text-xs text-white/60">
					{Math.max(1, Math.round(a.size / 1024))} KB · {ext}
				</span>
			</span>
		</a>
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
	const cancelled = quote.status === "cancelled";
	return (
		<div className="mt-0.5 flex rounded-lg bg-[var(--wa-in)]">
			{signed ? (
				<span className="flex flex-1 items-center justify-center gap-2 py-2.5 text-sm text-[var(--wa-muted)]">
					<Check className="size-4" /> Signed
				</span>
			) : cancelled ? (
				<span className="flex flex-1 items-center justify-center gap-2 py-2.5 text-sm text-[var(--wa-muted)]">
					<X className="size-4" /> Order cancelled
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
