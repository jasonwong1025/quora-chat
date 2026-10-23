import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FileText, MessagesSquare, Settings2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { FollowUpRules } from "#/components/orbyte/follow-up-rules";
import { RequestDetail } from "#/components/orbyte/request-detail";
import { useWorkspace } from "#/components/orbyte/workspace";
import { quoteBadge, StatusBadge } from "#/components/status-badge";
import { formatMYR } from "#/lib/money";
import { ago } from "#/lib/time";
import type { RequestRow } from "#/lib/types";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

export const Route = createFileRoute("/orbyte/$businessId/quotes")({
	validateSearch: z.object({ r: z.string().optional() }),
	component: Quotes,
});

const filters = {
	all: { label: "All", test: () => true },
	action: {
		label: "Needs action",
		test: (r: RequestRow) => ["needs_review", "draft_ready"].includes(r.status),
	},
	waiting: {
		label: "Waiting on customer",
		test: (r: RequestRow) =>
			r.status === "gathering" ||
			r.status === "confirming" ||
			r.quote?.status === "approved",
	},
	signed: {
		label: "Signed",
		test: (r: RequestRow) => r.quote?.status === "accepted",
	},
	lost: {
		label: "Lost",
		test: (r: RequestRow) => r.quote?.status === "lost",
	},
	rejected: {
		label: "Rejected",
		test: (r: RequestRow) => r.status === "rejected",
	},
} as const;

function Quotes() {
	const { business } = useWorkspace();
	const { r } = Route.useSearch();
	const navigate = Route.useNavigate();
	const [filter, setFilter] = useState<keyof typeof filters>("all");
	const [rules, setRules] = useState(false);
	const requests = useQuery({
		...orpc.requests.list.queryOptions({ input: { businessId: business.id } }),
		refetchInterval: 3000,
	});
	const rows = (requests.data ?? []).filter(filters[filter].test);
	const selected = requests.data?.find((x) => x.id === r);

	return (
		<div className="flex h-full min-h-0">
			<aside
				className={cn(
					"flex w-full shrink-0 flex-col border-r bg-card md:w-96",
					selected && "hidden md:flex",
				)}
			>
				<div className="border-b px-4 pt-3 pb-2">
					<div className="flex items-center justify-between">
						<h1 className="font-semibold">Quotes</h1>
						<button
							type="button"
							onClick={() => setRules(true)}
							className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
						>
							<Settings2 className="size-3.5" /> Follow-up rules
						</button>
					</div>
					{rules && <FollowUpRules onClose={() => setRules(false)} />}
					<div className="mt-2 flex gap-1 overflow-x-auto pb-1">
						{Object.entries(filters).map(([key, f]) => {
							const n = (requests.data ?? []).filter(f.test).length;
							return (
								<button
									key={key}
									type="button"
									onClick={() => setFilter(key as keyof typeof filters)}
									className={cn(
										"shrink-0 border px-2.5 py-1 text-xs",
										filter === key
											? "border-primary bg-primary text-primary-foreground"
											: "hover:bg-muted",
									)}
								>
									{f.label} {n > 0 && <span className="opacity-70">{n}</span>}
								</button>
							);
						})}
					</div>
				</div>
				<ul className="min-h-0 flex-1 divide-y overflow-y-auto">
					{rows.map((x) => (
						<li key={x.id}>
							<button
								type="button"
								onClick={() => navigate({ search: { r: x.id } })}
								className={cn(
									"flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/60",
									x.id === r && "bg-secondary",
								)}
							>
								<FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
								<div className="min-w-0 flex-1">
									<div className="flex items-center justify-between gap-2">
										<p className="truncate text-sm font-medium">
											{x.quote?.number ?? "No quote yet"}
										</p>
										<span className="shrink-0 text-xs text-muted-foreground">
											{ago(x.updatedAt)}
										</span>
									</div>
									<p className="truncate text-xs text-muted-foreground">
										{x.customerName} · {x.brief.summary || "New enquiry"}
									</p>
									<div className="mt-1.5 flex items-center gap-2">
										<StatusBadge
											status={
												x.quote && x.quote.status !== "draft"
													? quoteBadge(x.quote.status)
													: x.status
											}
										/>
										{x.quote && (
											<span className="text-xs font-medium tabular-nums">
												{formatMYR(x.quote.totalSen)}
											</span>
										)}
									</div>
								</div>
							</button>
						</li>
					))}
					{rows.length === 0 && (
						<li className="p-6 text-center text-sm text-muted-foreground">
							No quotes here.
						</li>
					)}
				</ul>
			</aside>

			{selected ? (
				<div className="min-w-0 flex-1 overflow-y-auto">
					<div>
						<div className="flex items-center justify-between border-b bg-card px-4 py-2 md:hidden">
							<button
								type="button"
								onClick={() => navigate({ search: {} })}
								className="-my-1 py-1 text-sm text-primary"
							>
								← Quotes
							</button>
						</div>
						<RequestDetail key={selected.id} request={selected} />
						<div className="px-4 pb-6">
							<Link
								to="/orbyte/$businessId/inbox"
								params={{ businessId: business.id }}
								search={{ c: selected.conversationId }}
								className="inline-flex items-center gap-1.5 text-sm text-primary"
							>
								<MessagesSquare className="size-4" /> Open the WhatsApp chat
							</Link>
						</div>
					</div>
				</div>
			) : (
				<div className="hidden flex-1 items-center justify-center text-sm text-muted-foreground md:flex">
					Select a quote to review it.
				</div>
			)}
		</div>
	);
}
