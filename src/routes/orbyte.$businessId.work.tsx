import { createFileRoute } from "@tanstack/react-router";
import { DemoNote } from "#/components/orbyte/demo-note";
import { PageHeader, useWorkspace } from "#/components/orbyte/workspace";
import { getDailyStatus, getProjects } from "#/data/orbyte-static";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/orbyte/$businessId/work")({
	component: Work,
});

const stateStyle = {
	on_track: {
		label: "On track",
		className: "bg-status-draft/15 text-status-draft",
	},
	done: {
		label: "Done",
		className: "bg-status-approved/15 text-status-approved",
	},
	blocked: {
		label: "Blocked",
		className: "bg-status-review/15 text-status-review",
	},
} as const;

function Work() {
	const { business } = useWorkspace();
	const status = getDailyStatus(business.staff, business.industry);
	const projects = getProjects(business.staff);

	return (
		<div className="p-4 sm:p-6">
			<PageHeader
				title="Work"
				description="Today's status and this month's focus for the team."
			/>
			<DemoNote />
			<div className="grid gap-6 lg:grid-cols-2">
				<section className="rounded-xl border bg-card">
					<h2 className="border-b px-4 py-3 font-semibold">Today</h2>
					<ul className="divide-y">
						{status.map((s) => {
							const st = stateStyle[s.state];
							return (
								<li
									key={s.staffName}
									className="flex items-center gap-3 px-4 py-3"
								>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium">{s.staffName}</p>
										<p className="text-sm text-muted-foreground">{s.today}</p>
									</div>
									<span
										className={cn(
											"shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
											st.className,
										)}
									>
										{st.label}
									</span>
								</li>
							);
						})}
					</ul>
				</section>
				<section className="rounded-xl border bg-card">
					<h2 className="border-b px-4 py-3 font-semibold">Monthly focus</h2>
					<ul className="divide-y">
						{projects.map((p) => (
							<li key={p.name} className="px-4 py-3">
								<div className="flex items-baseline justify-between gap-2">
									<p className="text-sm font-medium">{p.name}</p>
									<span className="text-xs text-muted-foreground">
										due {p.due}
									</span>
								</div>
								<p className="text-xs text-muted-foreground">{p.owner}</p>
								<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
									<div
										className="h-full rounded-full"
										style={{
											width: `${p.progress}%`,
											background: "var(--orb-gradient)",
										}}
									/>
								</div>
							</li>
						))}
					</ul>
				</section>
			</div>
		</div>
	);
}
