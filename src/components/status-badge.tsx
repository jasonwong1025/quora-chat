import { cn } from "#/lib/utils";

const styles = {
	gathering: {
		label: "Gathering info",
		className: "bg-status-clarify/20 text-status-clarify",
	},
	confirming: {
		label: "Confirming",
		className: "bg-status-clarify/20 text-status-clarify",
	},
	needs_review: {
		label: "Needs review",
		className: "bg-status-review/15 text-status-review",
	},
	draft_ready: {
		label: "Pending approval",
		className: "bg-status-draft/15 text-status-draft",
	},
	approved: {
		label: "Approved",
		className: "bg-status-approved/15 text-status-approved",
	},
	rejected: {
		label: "Rejected",
		className: "bg-status-rejected/15 text-status-rejected",
	},
	sent: {
		label: "Sent · awaiting signature",
		className: "bg-status-draft/15 text-status-draft",
	},
	accepted: {
		label: "Signed",
		className: "bg-status-approved/15 text-status-approved",
	},
	superseded: {
		label: "Superseded",
		className: "bg-muted text-muted-foreground",
	},
	lost: {
		label: "Lost",
		className: "bg-status-rejected/15 text-status-rejected",
	},
} as const;

/** Badge status for a quote row (draft / approved / rejected / accepted). */
export function quoteBadge(
	status:
		| "draft"
		| "approved"
		| "rejected"
		| "accepted"
		| "superseded"
		| "lost",
): RequestStatus {
	return status === "draft"
		? "draft_ready"
		: status === "approved"
			? "sent"
			: status;
}

export type RequestStatus = keyof typeof styles;

export function StatusBadge({
	status,
	className,
}: {
	status: RequestStatus;
	className?: string;
}) {
	const s = styles[status];
	return (
		<span
			className={cn(
				"inline-flex items-center px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
				s.className,
				className,
			)}
		>
			{s.label}
		</span>
	);
}
