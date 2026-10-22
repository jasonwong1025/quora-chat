import type { Answer, Brief } from "#/db/schema";

function answers(values: Record<string, Answer>) {
	return Object.fromEntries(
		Object.entries(values)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, a]) => [
				key,
				{
					values: a.values.map((v) => v.trim()),
					state: a.state ?? "known",
					waived: a.source === "skipped",
					waiverReason: a.waiverReason ?? null,
				},
			]),
	);
}

/** Ignore presentation, ask history and attribution; compare the actual requirements. */
export function agreementContent(brief: Brief) {
	return JSON.stringify({
		items: brief.items.map((i) => ({
			id: i.id,
			match: i.match,
			productId: i.productId,
			candidates: [...i.candidateProductIds].sort(),
			quantity: i.quantity,
			rawText: i.match === "none" ? i.rawText : null,
			answers: answers(i.answers),
		})),
		general: answers(brief.general),
		followUps: brief.followUps.map((f) => ({
			id: f.id,
			question: f.question,
			answer: f.answer,
			waivedBy: f.waivedBy ?? null,
			waiverReason: f.waiverReason ?? null,
		})),
	});
}

export function quoteAgreementIssue(
	quote: {
		requirementVersion: number | null;
		requirementsSnapshot: Brief | null;
	},
	request: {
		brief: Brief;
		briefVersion: number;
		status: string;
		flags?: { kind: string }[];
	},
) {
	if (!quote.requirementsSnapshot || quote.requirementVersion === null) {
		return "Prepare a new draft to capture the requirements for this quotation.";
	}
	if (
		quote.requirementVersion !== request.briefVersion ||
		agreementContent(quote.requirementsSnapshot) !==
			agreementContent(request.brief)
	) {
		return "Requirements changed after this draft was prepared. Review the changes and prepare a new draft.";
	}
	if (!["draft_ready", "needs_review"].includes(request.status)) {
		return "Finish clarifying the requirements and prepare a new draft before approval.";
	}
	if (request.flags?.some((f) => f.kind === "ai_uncertain")) {
		return "Resolve the uncertain requirements and prepare a new draft before approval.";
	}
	return null;
}

export function quoteReviewToken(quote: {
	requirementVersion: number | null;
	lineItems: unknown;
	notes: string | null;
	totalSen: number;
	status: string;
}) {
	return JSON.stringify({
		version: quote.requirementVersion,
		lines: quote.lineItems,
		notes: quote.notes,
		total: quote.totalSen,
		status: quote.status,
	});
}

/** Customer-visible scope, independent of today's catalog and question definitions. */
export function agreementLines(brief: Brief) {
	const lines = brief.items.flatMap((item) => [
		`${item.productName ?? item.rawText}${item.quantity !== null ? ` x ${item.quantity}` : ""}`,
		...Object.entries(item.answers).map(
			([key, a]) =>
				`${a.label ?? key}: ${a.source === "skipped" ? `Waived - ${a.waiverReason ?? "not recorded"}` : a.values.join(", ")}`,
		),
	]);
	for (const [key, a] of Object.entries(brief.general))
		lines.push(
			`${a.label ?? key}: ${a.source === "skipped" ? `Waived - ${a.waiverReason ?? "not recorded"}` : a.values.join(", ")}`,
		);
	for (const f of brief.followUps)
		lines.push(
			`${f.question}: ${f.waivedBy ? `Waived - ${f.waiverReason}` : (f.answer ?? "Unresolved")}`,
		);
	return lines;
}

export function agreementChanges(before: Brief, after: Brief) {
	function fields(brief: Brief) {
		const entries: [
			string,
			{ label: string; value: string; identity?: string },
		][] = [];
		for (const item of brief.items) {
			const name = item.productName ?? item.rawText;
			entries.push(
				[
					`${item.id}:product`,
					{
						label: "Offering",
						value: name,
						identity: item.productId ?? item.rawText,
					},
				],
				[
					`${item.id}:quantity`,
					{
						label: `${name}: quantity`,
						value: String(item.quantity ?? "Not specified"),
					},
				],
			);
			for (const [key, a] of Object.entries(item.answers))
				entries.push([
					`${item.id}:${key}`,
					{
						label: `${name}: ${a.label ?? key}`,
						value:
							a.source === "skipped"
								? `Waived: ${a.waiverReason ?? "No reason"}`
								: `${a.values.join(", ")}${a.state && a.state !== "known" ? ` (${a.state})` : ""}`,
					},
				]);
		}
		for (const [key, a] of Object.entries(brief.general))
			entries.push([
				`general:${key}`,
				{
					label: a.label ?? key,
					value:
						a.source === "skipped"
							? `Waived: ${a.waiverReason ?? "No reason"}`
							: a.values.join(", "),
				},
			]);
		for (const f of brief.followUps)
			entries.push([
				`followup:${f.id}`,
				{
					label: f.question,
					value: f.waivedBy
						? `Waived: ${f.waiverReason}`
						: (f.answer ?? "Unresolved"),
				},
			]);
		return new Map(entries);
	}
	const previous = fields(before);
	const current = fields(after);
	return [...new Set([...previous.keys(), ...current.keys()])].flatMap(
		(key) => {
			const a = previous.get(key);
			const b = current.get(key);
			return (a?.identity ?? a?.value) === (b?.identity ?? b?.value)
				? []
				: [
						{
							label: a?.label ?? b?.label ?? "Requirement",
							before: a?.value ?? "Not specified",
							after: b?.value ?? "Removed",
						},
					];
		},
	);
}
