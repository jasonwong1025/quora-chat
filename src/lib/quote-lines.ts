/**
 * Quote lines by how they're charged. Only one-time lines make the quotation
 * total; monthly/yearly fees and optional add-ons are listed apart from it.
 * Shared by the server, the staff editor and the customer's view, so they agree.
 */
import type { Charge, LineItem, QuoteTerms } from "#/db/schema";

export const chargeOf = (l: Pick<LineItem, "charge">): Charge =>
	l.charge ?? "one_time";

export const chargeLabel: Record<Charge, string> = {
	one_time: "One-time",
	monthly: "Monthly",
	yearly: "Yearly",
	optional: "Optional add-on",
};

/** "/ month" after a recurring amount. */
export const chargeSuffix: Record<Charge, string> = {
	one_time: "",
	monthly: " / month",
	yearly: " / year",
	optional: "",
};

export function totals(
	lineItems: LineItem[],
	sstRateBps: number,
	sstRegistered: boolean,
) {
	const subtotalSen = lineItems
		.filter((l) => chargeOf(l) === "one_time")
		.reduce((sum, l) => sum + l.amountSen, 0);
	const sstSen = sstRegistered
		? Math.round((subtotalSen * sstRateBps) / 10000)
		: 0;
	return { subtotalSen, sstSen, totalSen: subtotalSen + sstSen };
}

/** Lines grouped for display, in the order a customer reads them. */
export function groupLines(lineItems: LineItem[]) {
	const groups: {
		charge: Charge;
		lines: { line: LineItem; index: number }[];
	}[] = [];
	for (const charge of ["one_time", "monthly", "yearly", "optional"] as const) {
		const lines = lineItems
			.map((line, index) => ({ line, index }))
			.filter(({ line }) => chargeOf(line) === charge);
		if (lines.length) groups.push({ charge, lines });
	}
	return groups;
}

export function sumOf(lineItems: LineItem[], charge: Charge) {
	return lineItems
		.filter((l) => chargeOf(l) === charge)
		.reduce((sum, l) => sum + l.amountSen, 0);
}

/** Payment schedule in ringgit; the last payment takes the rounding. */
export function paymentAmounts(terms: QuoteTerms, totalSen: number) {
	let left = totalSen;
	return terms.payments.map((p, i) => {
		const amountSen =
			i === terms.payments.length - 1
				? left
				: Math.round((totalSen * p.percent) / 100);
		left -= amountSen;
		return { ...p, amountSen };
	});
}

export const totalWeeks = (terms: QuoteTerms) =>
	terms.phases.reduce((sum, p) => sum + p.weeks, 0);

export const hasTerms = (t: QuoteTerms | null | undefined): t is QuoteTerms =>
	Boolean(
		t &&
			(t.phases.length ||
				t.payments.length ||
				t.assumptions.length ||
				t.exclusions.length),
	);
