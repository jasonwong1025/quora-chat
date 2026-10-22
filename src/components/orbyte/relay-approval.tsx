import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	Loader2,
	MessageCircleQuestion,
	SendHorizontal,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "#/components/orbyte/workspace";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import type { ConversationDetail } from "#/lib/types";
import { orpc } from "#/orpc/client";

type Relay = ConversationDetail["relays"][number];

/** A PIC wants to ask this customer something. Sales check the wording and send it, or don't. */
export function RelayApproval({ relay }: { relay: Relay }) {
	const { me } = useWorkspace();
	const queryClient = useQueryClient();
	const review = useMutation(
		orpc.relays.review.mutationOptions({
			onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.key() }),
		}),
	);
	const [draft, setDraft] = useState(relay.draft);
	const [rejecting, setRejecting] = useState(false);
	const [reason, setReason] = useState("");
	const canApprove = Boolean(me?.canApprove);

	async function act(action: "send" | "reject") {
		if (!me) return toast.error("Choose who you are signed in as first");
		try {
			await review.mutateAsync({
				relayId: relay.id,
				staffId: me.id,
				action,
				draft: action === "send" ? draft : undefined,
				reason: action === "reject" ? reason : undefined,
			});
			toast.success(
				action === "send"
					? "Sent to the customer"
					: "Not sent; the PIC was told",
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		}
	}

	return (
		<div className="space-y-2 rounded-lg border border-[var(--orb-royal)]/30 bg-[var(--orb-royal)]/5 p-3">
			<p className="flex items-start gap-2 text-sm">
				<MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-[var(--orb-royal)]" />
				<span>
					<b>{relay.askedBy ?? "A PIC"}</b> ({relay.jobNumber}) needs to ask the
					customer: <i>{relay.question}</i>
				</span>
			</p>
			<Textarea
				rows={2}
				value={draft}
				disabled={!canApprove}
				onChange={(e) => setDraft(e.target.value)}
				className="bg-card text-sm"
			/>
			{rejecting ? (
				<div className="flex gap-2">
					<Input
						autoFocus
						value={reason}
						onChange={(e) => setReason(e.target.value)}
						placeholder="Why not? (shown to the PIC)"
						className="h-8 bg-card text-sm"
					/>
					<Button
						size="sm"
						variant="outline"
						className="bg-card"
						disabled={review.isPending}
						onClick={() => act("reject")}
					>
						Don't send
					</Button>
					<Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
						Cancel
					</Button>
				</div>
			) : canApprove ? (
				<div className="flex gap-2">
					<Button
						size="sm"
						disabled={!draft.trim() || review.isPending}
						onClick={() => act("send")}
					>
						{review.isPending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<SendHorizontal className="size-4" />
						)}
						Send to customer
					</Button>
					<Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>
						<X className="size-4" /> Don't send
					</Button>
				</div>
			) : (
				<p className="text-xs text-muted-foreground">
					Waiting for someone who can approve to send it.
				</p>
			)}
		</div>
	);
}
