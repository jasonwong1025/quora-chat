import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BellRing,
	CalendarClock,
	CircleSlash,
	Loader2,
	Pause,
	Play,
	SendHorizontal,
	Sparkles,
	TimerReset,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "#/components/orbyte/workspace";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { ago } from "#/lib/time";
import type { RequestRow } from "#/lib/types";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

type Quote = NonNullable<RequestRow["quote"]>;

export const lostLabel = {
	price: "Price",
	timing: "Timing",
	competitor: "Went elsewhere",
	not_needed: "Not needed",
	no_reply: "No reply",
	other: "Other",
} as const;

const when = (d: Date) =>
	d.toLocaleString("en-MY", {
		timeZone: "Asia/Kuala_Lumpur",
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "numeric",
		minute: "2-digit",
	});

/** Reminders for a sent quote that isn't signed yet: what's planned, what was sent, and controls. */
export function FollowUpPanel({ quote }: { quote: Quote }) {
	const { business, me } = useWorkspace();
	const queryClient = useQueryClient();
	const list = useQuery({
		...orpc.quotes.followUps.queryOptions({ input: { quoteId: quote.id } }),
		refetchInterval: 4000,
	});
	const act = useMutation(
		orpc.quotes.followUp.mutationOptions({
			onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.key() }),
		}),
	);
	const [losing, setLosing] = useState(false);
	const [reason, setReason] = useState<keyof typeof lostLabel>("price");
	const [note, setNote] = useState("");

	if (quote.status === "lost")
		return (
			<div className="flex items-start gap-2 rounded-md bg-status-rejected/10 px-3 py-2 text-sm">
				<CircleSlash className="mt-0.5 size-4 shrink-0 text-status-rejected" />
				<span>
					<b>Lost: {lostLabel[quote.lostReason ?? "other"]}</b>
					{quote.lostNote && <> · {quote.lostNote}</>}
					{quote.lostAt && (
						<span className="text-muted-foreground">
							{" "}
							· {ago(quote.lostAt)}
						</span>
					)}
				</span>
			</div>
		);
	if (quote.status !== "approved") return null;

	const items = list.data ?? [];
	const next = items.find((f) => f.status === "scheduled");
	const sent = items.filter((f) => f.status === "sent");
	const reminders = sent.filter((f) => f.kind === "reminder").length;

	async function run(
		action: "pause" | "resume" | "send_now" | "mark_lost",
		extra: { reason?: keyof typeof lostLabel; note?: string } = {},
	) {
		if (!me) return toast.error("Choose who you are signed in as first");
		try {
			await act.mutateAsync({
				quoteId: quote.id,
				staffId: me.id,
				action,
				...extra,
			});
			toast.success(
				{
					pause: "Follow-ups paused",
					resume: "Follow-ups resumed",
					send_now: "Follow-up sent",
					mark_lost: "Marked as lost",
				}[action],
			);
			setLosing(false);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		}
	}

	return (
		<div className="space-y-2 rounded-lg border p-3 text-sm">
			<div className="flex items-center justify-between gap-2">
				<p className="flex items-center gap-1.5 font-medium">
					<BellRing className="size-4 text-[var(--orb-royal)]" /> Follow-ups
				</p>
				<span className="text-xs text-muted-foreground">
					{reminders}/{business.followUpMax} sent · valid until{" "}
					{quote.validUntil.toLocaleDateString("en-MY")}
					{quote.extendedAt && " (extended)"}
				</span>
			</div>

			{quote.followUpsPaused ? (
				<p className="flex items-start gap-2 rounded-md bg-status-clarify/15 px-2.5 py-2 text-xs">
					<Pause className="mt-px size-3.5 shrink-0" /> Paused. No reminders
					until someone resumes them.
				</p>
			) : next ? (
				<div className="rounded-md bg-secondary/60 px-2.5 py-2 text-xs">
					<p className="flex items-center gap-1.5 font-medium">
						<CalendarClock className="size-3.5" /> Next: {when(next.dueAt)}
					</p>
					<p className="mt-0.5 flex gap-1.5 text-muted-foreground">
						<Sparkles className="mt-px size-3 shrink-0 text-[var(--orb-royal)]" />
						{next.reason}
					</p>
				</div>
			) : (
				<p className="text-xs text-muted-foreground">
					{reminders >= business.followUpMax
						? "All reminders sent. If it isn't signed, it's extended once at expiry, then marked lost."
						: "No reminder planned before it expires."}
				</p>
			)}

			{sent.length > 0 && (
				<ol className="space-y-1 border-l pl-3 text-xs">
					{sent.map((f) => (
						<li key={f.id} className="text-muted-foreground">
							<span className="font-medium text-foreground">
								{f.kind === "extension" ? "Validity extended" : "Reminder sent"}
							</span>{" "}
							· {f.sentAt ? when(f.sentAt) : ""}
							{f.body && <p className="line-clamp-2 italic">“{f.body}”</p>}
						</li>
					))}
				</ol>
			)}

			{losing ? (
				<div className="space-y-2 rounded-md bg-muted/60 p-2">
					<div className="flex gap-2">
						<Select
							value={reason}
							onValueChange={(v) => setReason(v as "price")}
						>
							<SelectTrigger size="sm" className="w-40 bg-card">
								<SelectValue />
							</SelectTrigger>
							<SelectContent position="popper">
								{Object.entries(lostLabel).map(([k, label]) => (
									<SelectItem key={k} value={k}>
										{label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Input
							value={note}
							onChange={(e) => setNote(e.target.value)}
							placeholder="Note (optional)"
							className="h-8 bg-card text-xs"
						/>
					</div>
					<div className="flex gap-2">
						<Button
							size="sm"
							variant="destructive"
							disabled={act.isPending}
							onClick={() =>
								run("mark_lost", { reason, note: note || undefined })
							}
						>
							Mark lost
						</Button>
						<Button size="sm" variant="ghost" onClick={() => setLosing(false)}>
							Cancel
						</Button>
					</div>
				</div>
			) : (
				<div className="flex flex-wrap gap-1.5">
					{quote.followUpsPaused ? (
						<SmallAction
							icon={Play}
							label="Resume"
							busy={act.isPending}
							onClick={() => run("resume")}
						/>
					) : (
						<SmallAction
							icon={Pause}
							label="Pause"
							busy={act.isPending}
							onClick={() => run("pause")}
						/>
					)}
					<SmallAction
						icon={act.isPending ? Loader2 : SendHorizontal}
						label="Send now"
						busy={act.isPending}
						onClick={() => run("send_now")}
					/>
					<SmallAction
						icon={CircleSlash}
						label="Mark lost"
						busy={act.isPending}
						onClick={() => setLosing(true)}
					/>
				</div>
			)}
			{quote.pausedUntil &&
				quote.pausedUntil > new Date() &&
				!quote.followUpsPaused && (
					<p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
						<TimerReset className="size-3" /> Customer asked for time until{" "}
						{quote.pausedUntil.toLocaleDateString("en-MY")}
					</p>
				)}
		</div>
	);
}

function SmallAction(props: {
	icon: typeof Pause;
	label: string;
	busy: boolean;
	onClick: () => void;
}) {
	const Icon = props.icon;
	return (
		<Button
			size="sm"
			variant="outline"
			disabled={props.busy}
			onClick={props.onClick}
			className="h-7 text-xs"
		>
			<Icon className={cn("size-3.5", Icon === Loader2 && "animate-spin")} />
			{props.label}
		</Button>
	);
}
