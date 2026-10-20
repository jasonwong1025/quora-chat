import { useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowLeft,
	HelpCircle,
	Inbox,
	MessageSquare,
} from "lucide-react";
import { ActivityFeed } from "#/components/activity-feed";
import { QuoteEditor } from "#/components/quote-editor";
import { StatusBadge } from "#/components/status-badge";
import { Button } from "#/components/ui/button";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import type { BusinessDetail, RequestRow, Staff } from "#/lib/types";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

const languageName = {
	en: "English",
	ms: "Bahasa Melayu",
	zh: "Chinese",
	mixed: "Mixed",
} as const;

export function ReviewerPanel(props: {
	business: BusinessDetail;
	actingAs: Staff | undefined;
	requestId: string | undefined;
	onSelectRequest: (id: string | undefined, conversationId?: string) => void;
}) {
	const { business, actingAs, requestId, onSelectRequest } = props;
	const requests = useQuery({
		...orpc.requests.list.queryOptions({ input: { businessId: business.id } }),
		refetchInterval: 5000,
	});
	const selected = requests.data?.find((r) => r.id === requestId);
	const openCount =
		requests.data?.filter((r) =>
			["needs_review", "draft_ready"].includes(r.status),
		).length ?? 0;

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
			<Tabs defaultValue="queue" className="flex min-h-0 flex-1 flex-col gap-0">
				<div className="flex items-center justify-between border-b px-3 py-2">
					<p className="text-sm font-semibold">Staff review</p>
					<TabsList>
						<TabsTrigger value="queue">
							Queue{" "}
							{openCount > 0 && (
								<span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
									{openCount}
								</span>
							)}
						</TabsTrigger>
						<TabsTrigger value="activity">Activity</TabsTrigger>
					</TabsList>
				</div>

				<TabsContent value="queue" className="min-h-0 flex-1">
					<ScrollArea className="h-full">
						{selected ? (
							<RequestDetail
								business={business}
								request={selected}
								actingAs={actingAs}
								onBack={() => onSelectRequest(undefined)}
							/>
						) : (
							<RequestList
								requests={requests.data ?? []}
								onSelect={(r) => onSelectRequest(r.id, r.conversationId)}
							/>
						)}
					</ScrollArea>
				</TabsContent>

				<TabsContent value="activity" className="min-h-0 flex-1">
					<ScrollArea className="h-full">
						<div className="p-4">
							<ActivityFeed businessId={business.id} />
						</div>
					</ScrollArea>
				</TabsContent>
			</Tabs>
		</div>
	);
}

function RequestList({
	requests,
	onSelect,
}: {
	requests: RequestRow[];
	onSelect: (r: RequestRow) => void;
}) {
	if (requests.length === 0) {
		return (
			<div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
				<Inbox className="size-8" />
				No quote requests yet. Send a customer message to start.
			</div>
		);
	}
	return (
		<ul className="divide-y">
			{requests.map((r) => (
				<li key={r.id}>
					<button
						type="button"
						onClick={() => onSelect(r)}
						className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent/60"
					>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<p className="truncate text-sm font-medium">{r.customerName}</p>
								<StatusBadge status={r.status} />
							</div>
							<p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
								{r.extracted.summary}
							</p>
						</div>
						<div className="shrink-0 text-right text-xs text-muted-foreground">
							{r.quote && (
								<p className="font-medium text-foreground">{r.quote.number}</p>
							)}
							<p>
								{r.updatedAt.toLocaleTimeString("en-MY", {
									hour: "2-digit",
									minute: "2-digit",
								})}
							</p>
						</div>
					</button>
				</li>
			))}
		</ul>
	);
}

function RequestDetail(props: {
	business: BusinessDetail;
	request: RequestRow;
	actingAs: Staff | undefined;
	onBack: () => void;
}) {
	const { business, request, actingAs } = props;
	const productName = (id: string | null) =>
		business.products.find((p) => p.id === id)?.name;

	return (
		<div className="space-y-4 p-4">
			<div className="flex items-center gap-2">
				<Button
					variant="ghost"
					size="icon"
					className="size-8"
					onClick={props.onBack}
				>
					<ArrowLeft className="size-4" />
				</Button>
				<div className="min-w-0 flex-1">
					<p className="truncate font-semibold">{request.customerName}</p>
					<p className="text-xs text-muted-foreground">
						{languageName[request.extracted.language]}
						{request.extracted.location && ` · ${request.extracted.location}`}
						{request.extracted.neededBy &&
							` · needed by ${request.extracted.neededBy}`}
					</p>
				</div>
				<StatusBadge status={request.status} />
			</div>

			<section>
				<h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Structured request
				</h3>
				<p className="mb-2 text-sm">{request.extracted.summary}</p>
				<ul className="space-y-1.5">
					{request.extracted.items.map((item, i) => (
						<li
							key={`${item.rawText}-${i}`}
							className="rounded-md border px-3 py-2 text-sm"
						>
							<div className="flex justify-between gap-2">
								<span className="font-medium">
									{productName(item.productId) ?? (
										<em className="text-muted-foreground">No catalog match</em>
									)}
								</span>
								<span className="text-muted-foreground">
									qty {item.quantity ?? "?"}
								</span>
							</div>
							<p className="text-xs text-muted-foreground">“{item.rawText}”</p>
							{Object.keys(item.fields).length > 0 && (
								<div className="mt-1 flex flex-wrap gap-1">
									{Object.entries(item.fields).map(([k, v]) => (
										<span
											key={k}
											className="rounded bg-muted px-1.5 py-0.5 text-[11px]"
										>
											{k}: {v}
										</span>
									))}
								</div>
							)}
						</li>
					))}
				</ul>
			</section>

			{request.flags.length > 0 && (
				<section>
					<h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Flags
					</h3>
					<ul className="space-y-1">
						{request.flags.map((f, i) => (
							<li
								key={`${f.kind}-${i}`}
								className={cn(
									"flex items-start gap-2 rounded-md px-3 py-2 text-sm",
									f.kind === "missing_info"
										? "bg-status-clarify/15"
										: "bg-status-review/10",
								)}
							>
								{f.kind === "missing_info" ? (
									<HelpCircle className="mt-0.5 size-4 shrink-0 text-status-clarify" />
								) : (
									<AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-review" />
								)}
								<span>
									{f.message}
									{f.options && f.options.length > 0 && (
										<span className="block text-xs text-muted-foreground">
											Options: {f.options.join(" / ")}
										</span>
									)}
								</span>
							</li>
						))}
					</ul>
				</section>
			)}

			{request.status === "needs_clarification" && (
				<p className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
					<MessageSquare className="size-4" /> Waiting for the customer to reply
					with the missing details.
				</p>
			)}

			{request.quote && (
				<section>
					<h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Quotation
					</h3>
					<QuoteEditor
						key={`${request.quote.id}:${JSON.stringify(request.quote.lineItems)}:${request.quote.notes}:${request.quote.status}`}
						business={business}
						quote={request.quote}
						actingAs={actingAs}
					/>
				</section>
			)}

			<section>
				<h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Activity
				</h3>
				<ActivityFeed businessId={business.id} requestId={request.id} />
			</section>
		</div>
	);
}
