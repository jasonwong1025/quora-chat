import { AlertTriangle, ArrowLeft, PenLine, RotateCcw } from "lucide-react";
import { ActivityFeed } from "#/components/activity-feed";
import { FollowUpPanel } from "#/components/orbyte/follow-up-panel";
import { NextActionBanner } from "#/components/orbyte/next-action";
import { RequirementBrief } from "#/components/orbyte/requirement-brief";
import { useWorkspace } from "#/components/orbyte/workspace";
import { QuoteEditor } from "#/components/quote-editor";
import { StatusBadge } from "#/components/status-badge";
import { Button } from "#/components/ui/button";
import { agreementChanges, quoteAgreementIssue } from "#/lib/agreements";
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

	return (
		<div className="space-y-4 p-4">
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
				<StatusBadge status={request.status} />
			</div>

			<NextActionBanner request={request} />
			<RequirementBrief request={request} />
			{request.baselineQuote && (
				<section className="space-y-2 rounded-lg border bg-status-review/5 p-3">
					<h3 className="text-sm font-semibold">
						Changes from {request.baselineQuote.number}
						{request.baselineQuote.signedAt ? " (signed agreement)" : ""}
					</h3>
					<p className="text-xs text-muted-foreground">
						The earlier agreement stays in effect until the revised quotation is
						approved and signed. The PIC must review outstanding work after a
						signed project change.
					</p>
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

			{request.flags.length > 0 && drafted && (
				<section>
					<h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Needs staff attention
					</h3>
					<ul className="space-y-1">
						{request.flags.map((f, i) => (
							<li
								key={`${f.kind}-${i}`}
								className={cn(
									"flex items-start gap-2 rounded-md px-3 py-2 text-sm",
									f.kind === "custom_pricing"
										? "bg-secondary"
										: "bg-status-review/10",
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
				</section>
			)}

			{request.quote && (
				<section>
					{!!draftChanges.length && (
						<div className="mb-3 rounded-md border p-3 text-sm">
							<p className="mb-1 font-medium">
								Changes since this draft was prepared
							</p>
							<ul>
								{draftChanges.map((c) => (
									<li key={c.label}>
										{c.label}: {c.before} → {c.after}
									</li>
								))}
							</ul>
						</div>
					)}
					<h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Quotation · requirements version{" "}
						{request.quote.requirementVersion ?? "not captured"}
					</h3>
					{request.quote.revision > 1 && (
						<p className="mb-2 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
							<RotateCcw className="size-4 text-muted-foreground" />
							Revision {request.quote.revision}: replaces the quotation sent
							earlier once approved.
						</p>
					)}
					{request.quote.status === "approved" && (
						<p className="mb-2 flex items-center gap-2 rounded-md bg-status-draft/10 px-3 py-2 text-sm">
							<PenLine className="size-4 text-status-draft" />
							Sent on WhatsApp — waiting for the customer to sign
							{request.quote.viewedAt ? " (opened)" : ""}.
						</p>
					)}
					{(request.quote.status === "approved" ||
						request.quote.status === "lost") && (
						<div className="mb-2">
							<FollowUpPanel quote={request.quote} />
						</div>
					)}
					{request.quote.status === "accepted" && (
						<p className="mb-2 flex items-center gap-2 rounded-md bg-status-approved/10 px-3 py-2 text-sm">
							<PenLine className="size-4 text-status-approved" />
							Signed by {request.quote.signerName} on{" "}
							{request.quote.signedAt?.toLocaleString("en-MY")}.
						</p>
					)}
					<QuoteEditor
						key={`${request.quote.id}:${JSON.stringify(request.quote.lineItems)}:${request.quote.notes}:${request.quote.status}`}
						business={business}
						quote={request.quote}
						actingAs={actingAs}
						onHold={
							request.quote.status === "draft"
								? quoteAgreementIssue(request.quote, request)
								: null
						}
					/>
				</section>
			)}

			{props.showActivity !== false && (
				<section>
					<h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						Activity
					</h3>
					<ActivityFeed businessId={business.id} requestId={request.id} />
				</section>
			)}
		</div>
	);
}
