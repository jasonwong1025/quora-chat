import { cn } from "#/lib/utils";

export const jobKinds = {
	delivery_order: {
		label: "Delivery order",
		className: "bg-[var(--orb-cyan)]/20 text-[#047a77]",
	},
	job_order: {
		label: "Job order",
		className: "bg-status-draft/15 text-status-draft",
	},
	project: {
		label: "Project",
		className: "bg-[var(--orb-navy)] text-white",
	},
} as const;

export const jobStatuses = {
	preparing: {
		label: "Preparing handover",
		className: "bg-muted text-muted-foreground",
	},
	upcoming: {
		label: "Upcoming",
		className: "bg-status-clarify/20 text-[#9a6a00]",
	},
	active: {
		label: "Active",
		className: "bg-status-draft/15 text-status-draft",
	},
	completed: {
		label: "Completed",
		className: "bg-status-approved/15 text-status-approved",
	},
	closed: { label: "Closed", className: "bg-muted text-muted-foreground" },
} as const;

export function KindChip({
	kind,
	className,
}: {
	kind: keyof typeof jobKinds;
	className?: string;
}) {
	const k = jobKinds[kind];
	return (
		<span
			className={cn(
				"inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
				k.className,
				className,
			)}
		>
			{k.label}
		</span>
	);
}

export function JobStatusChip({
	status,
}: {
	status: keyof typeof jobStatuses;
}) {
	const s = jobStatuses[status];
	return (
		<span
			className={cn(
				"inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
				s.className,
			)}
		>
			{s.label}
		</span>
	);
}
