import { createFileRoute } from "@tanstack/react-router";
import { DemoNote } from "#/components/orbyte/demo-note";
import { PageHeader, useWorkspace } from "#/components/orbyte/workspace";
import { avatarHue, initials } from "#/lib/time";

export const Route = createFileRoute("/orbyte/$businessId/people")({
	component: People,
});

/** The company directory (an existing Orbyte module, shown for context). */
function People() {
	const { business } = useWorkspace();
	return (
		<div className="p-4 sm:p-6">
			<PageHeader title="People" description="The company directory." />
			<DemoNote />
			<div className="grid border-t border-l sm:grid-cols-2 lg:grid-cols-3">
				{business.staff.map((s) => {
					const hue = avatarHue(s.name);
					return (
						<div
							key={s.id}
							className="flex items-center gap-3 border-r border-b bg-card p-4"
						>
							<span
								className="flex size-11 items-center justify-center rounded-full text-sm font-semibold"
								style={{
									background: `hsl(${hue} 70% 92%)`,
									color: `hsl(${hue} 50% 30%)`,
								}}
							>
								{initials(s.name)}
							</span>
							<div className="min-w-0">
								<p className="truncate font-medium">{s.name}</p>
								<p className="text-sm text-muted-foreground">{s.role}</p>
								{s.canApprove && (
									<p className="text-xs text-primary">Can approve quotations</p>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
