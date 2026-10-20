import { cn } from "#/lib/utils";

const styles = {
	needs_clarification: {
		label: "Needs info",
		className: "bg-status-clarify/20 text-status-clarify",
	},
	needs_review: {
		label: "Needs review",
		className: "bg-status-review/15 text-status-review",
	},
	draft_ready: {
		label: "Draft ready",
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
} as const;

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
				"inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
				s.className,
				className,
			)}
		>
			{s.label}
		</span>
	);
}
