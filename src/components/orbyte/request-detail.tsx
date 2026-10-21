import {
	AlertTriangle,
	ArrowLeft,
	HelpCircle,
	MessageSquare,
	PenLine,
} from "lucide-react";
import { ActivityFeed } from "#/components/activity-feed";
import { useWorkspace } from "#/components/orbyte/workspace";
import { QuoteEditor } from "#/components/quote-editor";
import { StatusBadge } from "#/components/status-badge";
import { Button } from "#/components/ui/button";
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
	const productName = (id: string | null) =>
		business.products.find((p) => p.id === id)?.name;

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
					{request.quote.status === "approved" && (
						<p className="mb-2 flex items-center gap-2 rounded-md bg-status-draft/10 px-3 py-2 text-sm">
							<PenLine className="size-4 text-status-draft" />
							Sent on WhatsApp — waiting for the customer to sign
							{request.quote.viewedAt ? " (opened)" : ""}.
						</p>
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
