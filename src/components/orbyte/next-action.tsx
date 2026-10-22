import {
	CheckCircle2,
	Clock3,
	Hand,
	type LucideIcon,
	TriangleAlert,
} from "lucide-react";
import { useWorkspace } from "#/components/orbyte/workspace";
import { quoteAgreementIssue } from "#/lib/agreements";
import { assess } from "#/lib/intake";
import { formatMYR } from "#/lib/money";
import type { BusinessDetail, RequestRow, Staff } from "#/lib/types";
import { cn } from "#/lib/utils";

export type NextAction = {
	/** Who has to move next. */
	turn: "you" | "approver" | "customer" | "ai" | "done";
	title: string;
	detail?: string;
	tone: "action" | "waiting" | "warn" | "done";
};

function describe(m: ReturnType<typeof assess>["missing"][number]) {
	switch (m.kind) {
		case "need":
			return "what they need";
		case "identify":
			return `which product "${m.item.rawText}" is`;
		case "quantity":
			return `the quantity of ${m.product.name}`;
		case "question":
			return m.question.label.replace(/\?$/, "");
		case "follow_up":
			return m.followUp.question.replace(/\?$/, "");
	}
}

/** The one thing that should happen next for this request, and whose move it is. */
export function nextAction(
	request: RequestRow,
	business: BusinessDetail,
	me: Staff | undefined,
): NextAction {
	const quote = request.quote;
	const customer = request.customerName;
	const approvers = business.staff
		.filter((s) => s.canApprove)
		.map((s) => s.name)
		.join(", ");
	if (request.status === "rejected")
		return {
			turn: "done",
			tone: "done",
			title: "Closed: the quotation was rejected",
			detail: quote?.decisionReason ?? undefined,
		};
	if (request.status === "approved") {
		if (quote?.status === "accepted")
			return {
				turn: "done",
				tone: "done",
				title: `Signed by ${quote.signerName ?? customer}. Handed over to Work.`,
			};
		if (quote?.status === "lost")
			return {
				turn: "done",
				tone: "done",
				title: "Lost",
				detail: [quote.lostReason?.replace("_", " "), quote.lostNote]
					.filter(Boolean)
					.join(": "),
			};
		return {
			turn: "customer",
			tone: "waiting",
			title: `Sent. Waiting for ${customer} to sign ${quote?.number ?? "the quotation"}.`,
			detail: quote?.viewedAt
				? "They opened it. Follow-ups are scheduled automatically."
				: "Not opened yet. Follow-ups are scheduled automatically.",
		};
	}
	const a = assess(request.brief, business.products, business.questions);
	if (request.status === "gathering") {
		const next = a.missing[0];
		return {
			turn: "ai",
			tone: "waiting",
			title: next
				? `AI is asking ${customer}: ${describe(next)}`
				: `AI is gathering details from ${customer}`,
			detail: `${a.requiredAnswered}/${a.requiredTotal} required details in. Nothing to do unless they get stuck: use Ask now, or Take over.`,
		};
	}
	if (request.status === "confirming")
		return {
			turn: "customer",
			tone: "waiting",
			title: `Waiting for ${customer} to confirm the summary`,
			detail:
				"Nothing is priced or sent until they confirm and an approver approves.",
		};
	// Drafted (draft_ready / needs_review).
	const issue =
		quote?.status === "draft" ? quoteAgreementIssue(quote, request) : null;
	if (issue)
		return {
			turn: "you",
			tone: "warn",
			title: "The draft is out of date",
			detail: issue,
		};
	if (!quote)
		return {
			turn: "you",
			tone: "action",
			title: "Prepare a draft",
			detail: "All required details are in. Use Draft now.",
		};
	const flags = request.flags.length;
	const what = flags
		? `Check ${flags} flagged item${flags === 1 ? "" : "s"}, then approve ${quote.number}`
		: `Review and approve ${quote.number} (${formatMYR(quote.totalSen)})`;
	if (!me?.canApprove)
		return {
			turn: "approver",
			tone: "waiting",
			title: `Waiting for an approver: ${what.toLowerCase()}`,
			detail: approvers ? `Approvers: ${approvers}` : undefined,
		};
	return {
		turn: "you",
		tone: "action",
		title: what,
		detail: flags
			? request.flags[0].message
			: "Prices come from the catalog and pricing rules. Nothing is sent until you approve.",
	};
}

const look: Record<
	NextAction["tone"],
	{ icon: LucideIcon; className: string; label: string }
> = {
	action: {
		icon: Hand,
		className: "border-[var(--orb-royal)]/40 bg-secondary",
		label: "Your move",
	},
	warn: {
		icon: TriangleAlert,
		className: "border-status-review/40 bg-status-review/10",
		label: "Needs attention",
	},
	waiting: {
		icon: Clock3,
		className: "border-border bg-muted/50",
		label: "Waiting",
	},
	done: {
		icon: CheckCircle2,
		className: "border-status-approved/30 bg-status-approved/10",
		label: "Done",
	},
};

/** The banner at the top of a request: what happens next, and who does it. */
export function NextActionBanner({ request }: { request: RequestRow }) {
	const { business, me } = useWorkspace();
	const next = nextAction(request, business, me);
	const l = look[next.tone];
	return (
		<output
			className={cn(
				"flex items-start gap-2.5 rounded-lg border p-3",
				l.className,
			)}
		>
			<l.icon className="mt-0.5 size-4 shrink-0" />
			<span className="min-w-0">
				<span className="block text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
					Next · {l.label}
				</span>
				<span className="block text-sm font-medium">{next.title}</span>
				{next.detail && (
					<span className="block text-xs text-muted-foreground">
						{next.detail}
					</span>
				)}
			</span>
		</output>
	);
}
