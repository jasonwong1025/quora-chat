import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Plug } from "lucide-react";
import { DemoNote } from "#/components/orbyte/demo-note";
import { PageHeader } from "#/components/orbyte/workspace";
import { Button } from "#/components/ui/button";
import { integrations } from "#/data/orbyte-static";

export const Route = createFileRoute("/orbyte/$businessId/connect")({
	component: Connect,
});

function Connect() {
	return (
		<div className="mx-auto max-w-6xl p-4 sm:p-8">
			<PageHeader
				title="Connect"
				description="Link Orbyte to the tools and channels your business already uses."
			/>
			<DemoNote />
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{integrations.map((i) => (
					<div
						key={i.name}
						className="flex flex-col rounded-xl border bg-card p-4"
					>
						<div className="flex items-start justify-between gap-2">
							<span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-primary">
								<Plug className="size-5" />
							</span>
							<span className="text-xs text-muted-foreground">
								{i.category}
							</span>
						</div>
						<p className="mt-3 font-medium">{i.name}</p>
						<p className="mb-4 flex-1 text-sm text-muted-foreground">
							{i.description}
						</p>
						{i.status === "connected" ? (
							<p className="flex items-center gap-1.5 text-sm font-medium text-status-approved">
								<CheckCircle2 className="size-4" /> Connected
							</p>
						) : i.status === "available" ? (
							<Button variant="outline" size="sm" className="self-start">
								Connect
							</Button>
						) : (
							<p className="text-sm text-muted-foreground">Coming soon</p>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
