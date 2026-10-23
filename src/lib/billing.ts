/**
 * Payment schedules: which instalments a signed quotation has, what triggers each
 * one, and how much each is. Shared by the server, Orbyte and the customer's view.
 */
import type {
	BillingSettings,
	Instalment,
	InstalmentTrigger,
	QuoteTerms,
} from "#/db/schema";

export const defaultBilling = (): BillingSettings => ({
	schedule: [{ label: "Full payment", percent: 100, when: "completed" }],
	dueDays: 7,
	statement: false,
	completionReport: true,
});

export type ResolvedInstalment = Instalment & {
	index: number;
	when: InstalmentTrigger;
	phase: string | null;
	amountSen: number;
};

/**
 * The quote's own schedule (custom items' price lists set one), else the business
 * default. Old schedules without triggers: the first part on signing, the rest on
 * completion. A phase the quote doesn't have falls back to completion.
 */
export function instalmentsFor(
	quote: { totalSen: number; terms: QuoteTerms | null },
	billing: BillingSettings | null,
): ResolvedInstalment[] {
	const own = quote.terms?.payments ?? [];
	const fallback = billing?.schedule.length
		? billing.schedule
		: defaultBilling().schedule;
	const schedule = own.length ? own : fallback;
	const phases = new Set((quote.terms?.phases ?? []).map((p) => p.name));
	let left = quote.totalSen;
	return schedule.map((p, index) => {
		let when: InstalmentTrigger =
			p.when ?? (schedule.length > 1 && index === 0 ? "signed" : "completed");
		let phase = when === "phase" ? (p.phase ?? null) : null;
		if (when === "phase" && (!phase || !phases.has(phase))) {
			when = "completed";
			phase = null;
		}
		const last = index === schedule.length - 1;
		const amountSen = last
			? left
			: Math.round((quote.totalSen * p.percent) / 100);
		left -= amountSen;
		return { ...p, index, when, phase, amountSen };
	});
}

export function triggerLabel(i: {
	when?: InstalmentTrigger;
	phase?: string | null;
}) {
	if (i.when === "signed") return "on signing";
	if (i.when === "phase" && i.phase) return `after ${i.phase}`;
	return "on completion";
}

export const scheduleProblem = (schedule: Instalment[]) => {
	if (!schedule.length) return "Add at least one payment";
	const sum = schedule.reduce((s, p) => s + p.percent, 0);
	return sum === 100 ? null : `Payments add up to ${sum}%, not 100%`;
};

/**
 * Every quotation states how it's paid: its own schedule (custom price lists set
 * one), else the business default, fixed at the time it's drafted.
 */
export function withSchedule(
	terms: QuoteTerms | null,
	billing: BillingSettings | null,
): QuoteTerms {
	if (terms?.payments.length) return terms;
	return {
		phases: terms?.phases ?? [],
		payments: (billing?.schedule.length ? billing : defaultBilling()).schedule,
		assumptions: terms?.assumptions ?? [],
		exclusions: terms?.exclusions ?? [],
	};
}
