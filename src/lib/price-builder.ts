/**
 * Prices a custom item from the business's own price list. Deterministic: the AI
 * never sets these numbers. Anything the list can't price is reported back, so the
 * AI can estimate it (effort × the business's rate) or staff can price it.
 */
import type {
	Answer,
	BriefItem,
	LineItem,
	PriceBuilder,
	PriceComponent,
	QuoteTerms,
} from "#/db/schema";
import { formatMYR } from "#/lib/money";
import { chargeSuffix } from "#/lib/quote-lines";

export const emptyBuilder = (): PriceBuilder => ({
	rate: null,
	components: [],
	phases: [],
	payments: [],
	assumptions: [],
	exclusions: [],
});

const same = (a: string, b: string) =>
	a.trim().toLowerCase() === b.trim().toLowerCase();

function answerFor(
	key: string,
	item: Pick<BriefItem, "answers">,
	general: Record<string, Answer>,
) {
	const a = item.answers[key] ?? general[key];
	return a && a.source !== "skipped" ? a : undefined;
}

export function componentApplies(
	c: PriceComponent,
	item: Pick<BriefItem, "answers">,
	general: Record<string, Answer> = {},
) {
	if (!c.when) return true;
	const { key, equals } = c.when;
	const a = answerFor(key, item, general);
	return Boolean(a?.values.some((v) => same(v, equals)));
}

/**
 * A count from an answer: "about 12" → 12, "10-15" → 15 (the safer upper end),
 * "4 x 10" / "4ft x 10ft" → 40 (an area). Null when there's no number.
 */
export function countFrom(values: string[]): number | null {
	const text = values.join(" ").replace(/,/g, "");
	const area = text.match(
		/(\d+(?:\.\d+)?)\s*(?:ft|feet|'|m)?\s*[x×*]\s*(\d+(?:\.\d+)?)/i,
	);
	if (area) return Math.ceil(Number(area[1]) * Number(area[2]));
	const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/i);
	if (range) return Math.ceil(Number(range[2]));
	const n = text.match(/\d+(?:\.\d+)?/);
	return n ? Math.ceil(Number(n[0])) : null;
}

export type BuilderResult = {
	lines: LineItem[];
	/** Plain-words working, for the AI-thinking card. */
	log: string[];
	/** Parts that apply but couldn't be priced (missing count). */
	unpriced: string[];
	/** Weeks the applied parts add to the timeline. */
	weeks: number;
};

export function priceWithBuilder(input: {
	product: { id: string; name: string; unit: string };
	builder: PriceBuilder;
	item: Pick<BriefItem, "answers" | "quantity">;
	general?: Record<string, Answer>;
	/** Prefix lines with the product name when a quote has several items. */
	labelPrefix?: string;
}): BuilderResult {
	const { product, builder, item } = input;
	const general = input.general ?? {};
	const out: BuilderResult = { lines: [], log: [], unpriced: [], weeks: 0 };
	for (const c of builder.components) {
		if (!componentApplies(c, item, general)) continue;
		let quantity = 1;
		let unit =
			c.charge === "monthly" ? "month" : c.charge === "yearly" ? "year" : "lot";
		if (c.per.kind === "quantity") {
			quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
			unit = product.unit;
		} else if (c.per.kind === "answer") {
			const a = answerFor(c.per.key, item, general);
			const n = a ? countFrom(a.values) : null;
			if (!n) {
				out.unpriced.push(`${c.label} (needs "${c.per.key}" as a number)`);
				continue;
			}
			// Per screen / per sqft is per piece: 2 banners of 4 x 10 ft = 80 sqft.
			quantity = n * (item.quantity && item.quantity > 0 ? item.quantity : 1);
			unit = c.per.unit;
		}
		const amountSen = c.amountSen * quantity;
		out.lines.push({
			productId: product.id,
			description: input.labelPrefix
				? `${input.labelPrefix}: ${c.label}`
				: c.label,
			quantity,
			unit,
			unitPriceSen: c.amountSen,
			amountSen,
			charge: c.charge,
			source: "builder",
			...(c.note ? { notes: c.note } : {}),
		});
		if (c.charge === "one_time" && c.weeks) out.weeks += c.weeks;
		out.log.push(
			`${c.label}: ${quantity > 1 ? `${quantity} ${unit} × ${formatMYR(c.amountSen)} = ` : ""}${formatMYR(amountSen)}${chargeSuffix[c.charge]}${
				c.charge === "optional" ? " (optional, not in total)" : ""
			}${c.when ? ` — because ${c.when.key} = ${c.when.equals}` : ""}`,
		);
	}
	return out;
}

/** The quotation's timeline and terms, with extra weeks added to the longest phase. */
export function termsFrom(
	builder: PriceBuilder,
	extraWeeks: number,
): QuoteTerms | null {
	const phases = builder.phases.map((p) => ({ ...p }));
	if (phases.length && extraWeeks > 0) {
		const longest = phases.reduce((a, b) => (b.weeks > a.weeks ? b : a));
		longest.weeks += Math.ceil(extraWeeks);
	}
	const terms = {
		phases,
		payments: builder.payments.map((p) => ({ ...p })),
		assumptions: [...builder.assumptions],
		exclusions: [...builder.exclusions],
	};
	return phases.length ||
		terms.payments.length ||
		terms.assumptions.length ||
		terms.exclusions.length
		? terms
		: null;
}

/** Answer keys the price list depends on. */
export function builderKeys(builder: PriceBuilder) {
	const keys = new Set<string>();
	for (const c of builder.components) {
		if (c.when) keys.add(c.when.key);
		if (c.per.kind === "answer") keys.add(c.per.key);
	}
	return [...keys];
}

/** Problems staff should fix before relying on the price list. */
export function builderWarnings(
	builder: PriceBuilder,
	questions: { key: string; label: string; type: string; options: string[] }[],
) {
	const byKey = new Map(questions.map((q) => [q.key, q]));
	const warnings: string[] = [];
	for (const c of builder.components) {
		if (c.when) {
			const q = byKey.get(c.when.key);
			if (!q)
				warnings.push(
					`"${c.label}" depends on "${c.when.key}", but the AI doesn't ask that. Add the question.`,
				);
			else if (
				q.options.length &&
				!q.options.some((o) => same(o, c.when?.equals ?? ""))
			)
				warnings.push(
					`"${c.label}": "${c.when.equals}" isn't one of the answers to "${q.label}".`,
				);
		}
		if (c.per.kind === "answer" && !byKey.has(c.per.key))
			warnings.push(
				`"${c.label}" counts from "${c.per.key}", but the AI doesn't ask that. Add the question.`,
			);
		if (c.amountSen <= 0 && c.charge !== "optional")
			warnings.push(`"${c.label}" has no price.`);
	}
	if (builder.payments.length) {
		const sum = builder.payments.reduce((s, p) => s + p.percent, 0);
		if (sum !== 100) warnings.push(`Payments add up to ${sum}%, not 100%.`);
	}
	return warnings;
}

/** Adds weeks (e.g. from AI-estimated work) to the longest phase. */
export function addWeeks(terms: QuoteTerms | null, weeks: number) {
	if (!terms?.phases.length || weeks <= 0) return terms;
	const phases = terms.phases.map((p) => ({ ...p }));
	const longest = phases.reduce((a, b) => (b.weeks > a.weeks ? b : a));
	longest.weeks += Math.ceil(weeks);
	return { ...terms, phases };
}
