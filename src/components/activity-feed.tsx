import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { orpc } from "#/orpc/client";

const tone: Record<string, string> = {
	"quote.request.received": "bg-muted-foreground",
	"quote.request.parsed": "bg-status-draft",
	"quote.request.clarification_requested": "bg-status-clarify",
	"quote.request.flagged_for_review": "bg-status-review",
	"quote.processing_failed": "bg-destructive",
	"quote.draft.prepared": "bg-status-draft",
	"quote.draft.edited": "bg-status-draft",
	"quote.approved": "bg-status-approved",
	"quote.rejected": "bg-status-rejected",
	"quote.sent_to_customer": "bg-status-approved",
};

export function ActivityFeed({
	businessId,
	requestId,
}: {
	businessId: string;
	requestId?: string;
}) {
	const events = useQuery({
		...orpc.activity.list.queryOptions({ input: { businessId, requestId } }),
		refetchInterval: 5000,
	});

	if (events.data?.length === 0) {
		return (
			<p className="p-4 text-sm text-muted-foreground">No activity yet.</p>
		);
	}

	return (
		<div>
			{!requestId && (
				<p className="flex items-center gap-1.5 px-1 pb-2 text-xs text-muted-foreground">
					<Activity className="size-3.5" /> Orbyte activity records (simulated)
				</p>
			)}
			<ol className="relative space-y-3 border-l pl-4">
				{events.data?.map((e) => (
					<li key={e.id} className="relative">
						<span
							className={`absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-2 ring-card ${tone[e.type] ?? "bg-muted-foreground"}`}
						/>
						<p className="text-sm">{e.summary}</p>
						<p className="text-xs text-muted-foreground">
							<code className="rounded bg-muted px-1 py-0.5 text-[10px]">
								{e.type}
							</code>{" "}
							· {e.actor} ·{" "}
							{e.createdAt.toLocaleTimeString("en-MY", {
								hour: "2-digit",
								minute: "2-digit",
							})}
						</p>
					</li>
				))}
			</ol>
		</div>
	);
}
