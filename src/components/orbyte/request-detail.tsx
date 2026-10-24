import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, FileText, PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ActivityFeed } from "#/components/activity-feed";
import { FollowUpPanel } from "#/components/orbyte/follow-up-panel";
import { NextActionBanner } from "#/components/orbyte/next-action";
import { RequirementBrief } from "#/components/orbyte/requirement-brief";
import { useWorkspace } from "#/components/orbyte/workspace";
import { QuoteEditor } from "#/components/quote-editor";
import { quoteBadge, StatusBadge } from "#/components/status-badge";
import { Button } from "#/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { agreementChanges, quoteAgreementIssue } from "#/lib/agreements";
import { assess } from "#/lib/intake";
import { formatMYR } from "#/lib/money";
import type { RequestRow } from "#/lib/types";
import { cn } from "#/lib/utils";

const languageName = {
	en: "English",
	ms: "Bahasa Melayu",
	zh: "Chinese",
	mixed: "Mixed",
} as const;

/** Structured request, flags, quote editor and activity for one quote request. */
export function RequestDetail(props: {
	request: RequestRow;
	onBack?: () => void;
	showActivity?: boolean;
}) {
	const { request } = props;
	const { business, me: actingAs } = useWorkspace();
	const changes = request.baselineQuote?.requirementsSnapshot
		? agreementChanges(
				request.baselineQuote.requirementsSnapshot,
				request.brief,
			)
		: [];
	const draftChanges =
		request.quote?.status === "draft" && request.quote.requirementsSnapshot
			? agreementChanges(request.quote.requirementsSnapshot, request.brief)
			: [];
	const drafted =
		request.status === "draft_ready" ||
		request.status === "needs_review" ||
		request.status === "approved" ||
		request.status === "rejected";

	const { quote } = request;
	const hasQuote = Boolean(quote);
	const [tab, setTab] = useState<Tab>(hasQuote ? "quote" : "brief");
	// Open the quotation as soon as a draft arrives.
	const quoteId = quote?.id;
	const seen = useRef(quoteId);
	useEffect(() => {
		if (quoteId && quoteId !== seen.current) setTab("quote");
		seen.current = quoteId;
	}, [quoteId]);
	const a = assess(request.brief, business.products, business.questions);
	const attention = request.flags.length > 0 && drafted;

	return (
		<Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-0">
			<div className="space-y-3 p-4 pb-3">
				<div className="flex items-center gap-2">
					{props.onBack && (
						<Button
							variant="ghost"
							size="icon"
							className="size-8"
							onClick={props.onBack}
						>
							<ArrowLeft className="size-4" />
						</Button>
					)}
					<div className="min-w-0 flex-1">
						<p className="truncate font-semibold">{request.customerName}</p>
						<p className="text-xs text-muted-foreground">
							{languageName[request.brief.language]}
						</p>
					</div>
					{/* Once signed, say so rather than the request's "approved" stage. */}
					<StatusBadge
						status={
							quote?.status === "accepted" ||
							quote?.status === "lost" ||
							quote?.status === "cancelled"
								? quoteBadge(quote.status)
								: request.status
						}
					/>
				</div>
				<NextActionBanner request={request} />
			</div>

			<div className="sticky top-0 z-10 bg-card px-1">
				<TabsList>
					<TabsTrigger value="brief">
						Requirements
						{a.requiredTotal > 0 && (
							<span className="text-[11px] text-muted-foreground tabular-nums">
								{a.requiredAnswered}/{a.requiredTotal}
							</span>
						)}
					</TabsTrigger>
					<TabsTrigger value="quote">
						Quotation
						{attention ? (
							<>
								<span className="size-1.5 bg-status-review" />
								<span className="sr-only">needs checking</span>
							</>
						) : quote ? (
							<span className="text-[11px] text-muted-foreground tabular-nums">
								{formatMYR(quote.totalSen)}
							</span>
						) : null}
					</TabsTrigger>
					{props.showActivity !== false && (
						<TabsTrigger value="activity">Activity</TabsTrigger>
					)}
				</TabsList>
			</div>

			<TabsContent value="brief" className="space-y-4 p-4">
				{request.baselineQuote && changes.length > 0 && (
					<section className="space-y-1.5 bg-muted/60 px-3 py-2.5">
						<h3 className="text-sm font-semibold">
							Changes from {request.baselineQuote.number}
							{request.baselineQuote.signedAt ? " (signed)" : ""}
						</h3>
						<ul className="space-y-1 text-sm">
							{changes.map((change) => (
								<li key={change.label}>
									<span className="font-medium">{change.label}</span>:{" "}
									{change.before} → {change.after}
								</li>
							))}
						</ul>
					</section>
				)}
				<RequirementBrief request={request} />
			</TabsContent>

			<TabsContent value="quote" className="space-y-3 p-4">
				{!quote ? (
					<div className="border border-dashed p-6 text-center text-sm text-muted-foreground">
						<FileText className="mx-auto mb-2 size-5" />
						No quotation yet
					</div>
				) : (
					<>
						{attention && (
							<ul className="space-y-1.5">
								{request.flags.map((f, i) => (
									<li
										// biome-ignore lint/suspicious/noArrayIndexKey: read-only list that never reorders; entries can repeat, so the position is the identity
										key={`${f.kind}-${i}`}
										className={cn(
											"flex items-start gap-2 bg-muted/60 px-3 py-2 text-sm",
										)}
									>
										<AlertTriangle
											className={cn(
												"mt-0.5 size-4 shrink-0",
												f.kind === "custom_pricing"
													? "text-primary"
													: "text-status-review",
											)}
										/>
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
						)}
						{!!draftChanges.length && (
							<div className="bg-muted/60 px-3 py-2 text-sm">
								<p className="mb-1 font-medium">Changed since this draft</p>
								<ul>
									{draftChanges.map((c) => (
										<li key={c.label}>
											{c.label}: {c.before} → {c.after}
										</li>
									))}
								</ul>
							</div>
						)}
						{quote.status === "accepted" && (
							<p className="flex flex-wrap items-center gap-2 bg-muted/60 px-3 py-2 text-sm">
								<PenLine className="size-4 text-status-approved" />
								Signed by {quote.signerName},{" "}
								{quote.signedAt?.toLocaleString("en-MY")}
								{request.job ? (
									<Link
										to="/orbyte/$businessId/work/$jobId"
										params={{ businessId: business.id, jobId: request.job.id }}
										className="font-medium text-primary hover:underline"
									>
										Job {request.job.number} →
									</Link>
								) : (
									<span className="text-muted-foreground">
										Creating the job…
									</span>
								)}
							</p>
						)}
						{quote.status === "cancelled" && (
							<p className="flex flex-wrap items-center gap-2 bg-status-rejected/10 px-3 py-2 text-sm">
								<AlertTriangle className="size-4 text-status-rejected" />
								Cancelled by {quote.cancelledBy ?? "the customer"}
								{quote.cancelledAt
									? ` on ${quote.cancelledAt.toLocaleString("en-MY")}`
									: ""}
								{quote.cancellationNote ? ` · ${quote.cancellationNote}` : ""}
								{request.job && (
									<Link
										to="/orbyte/$businessId/work/$jobId"
										params={{ businessId: business.id, jobId: request.job.id }}
										className="font-medium text-primary hover:underline"
									>
										Job {request.job.number} →
									</Link>
								)}
							</p>
						)}
						<QuoteEditor
							key={`${quote.id}:${JSON.stringify(quote.lineItems)}:${quote.notes}:${quote.status}`}
							business={business}
							quote={quote}
							actingAs={actingAs}
							onHold={
								quote.status === "draft"
									? quoteAgreementIssue(quote, request)
									: null
							}
						/>
						{(quote.status === "approved" || quote.status === "lost") && (
							<FollowUpPanel quote={quote} />
						)}
					</>
				)}
			</TabsContent>

			{props.showActivity !== false && (
				<TabsContent value="activity" className="p-4">
					<ActivityFeed businessId={business.id} requestId={request.id} />
				</TabsContent>
			)}
		</Tabs>
	);
}

type Tab = "brief" | "quote" | "activity";
