/**
 * Deterministic pricing. The AI only gathers what the customer asked for;
 * every number on a quote comes from the business's own catalog and rules.
 */
import type {
	Answer,
	Brief,
	Flag,
	LineItem,
	PricingRuleConfig,
} from "#/db/schema";
import { availableStock, formatDay, upcomingRestock } from "#/lib/availability";
import { isVisible, type Question, questionsFor } from "#/lib/intake";
import { formatMYR } from "#/lib/money";

export type CatalogProduct = {
	id: string;
	category: string;
	name: string;
	unit: string;
	unitPriceSen: number;
	pricingMode: "fixed" | "custom";
	/** Stock items are checked against what is available (on hand − reserved). */
	type?: "stock" | "service";
	stockOnHand?: number;
	stockReserved?: number;
	restockDate?: string | null;
	/** Switched off in Products: not available, so staff decide. */
	active?: boolean;
};

export { availableStock };

export type CatalogRule = {
	productId: string | null;
	config: PricingRuleConfig;
};

export type Outcome = "needs_review" | "draft_ready";

export type PricingResult = {
	outcome: Outcome;
	flags: Flag[];
	lineItems: LineItem[];
	/** How each line was worked out, in plain words. */
	explain: { itemIndex: number; lines: string[] }[];
};

function rulesFor(rules: CatalogRule[], productId: string) {
	return rules.filter((r) => r.productId === null || r.productId === productId);
}

/** Rule conditions match any of the answer's values (multi-choice can have several). */
function matchesWhen(
	when: { field: string; equals: string },
	answers: Record<string, Answer>,
) {
	const a = answers[when.field];
	if (!a || a.source === "skipped") return false;
	return a.values.some(
		(v) => v.trim().toLowerCase() === when.equals.trim().toLowerCase(),
	);
}

/** Answers marked "show on quotation" make the line description, e.g. "Flyer A5 (157gsm, double)". */
function lineDetails(
	product: CatalogProduct,
	answers: Record<string, Answer>,
	questions: Question[],
) {
	return questionsFor(product, questions)
		.filter((q) => q.onQuote && isVisible(q, answers))
		.map((q) => answers[q.key])
		.filter((a): a is Answer => a !== undefined && a.source !== "skipped")
		.flatMap((a) => a.values)
		.join(", ");
}

/**
 * Turns a confirmed brief into quote lines. Fixed-price items are priced by the
 * rules; custom-priced and unknown items are left for staff to price.
 */
export function priceBrief(
	brief: Brief,
	products: CatalogProduct[],
	rules: CatalogRule[],
	questions: Question[],
	today = new Date().toISOString().slice(0, 10),
): PricingResult {
	const byId = new Map(products.map((p) => [p.id, p]));
	const flags: Flag[] = [];
	const lineItems: LineItem[] = [];
	const explain: PricingResult["explain"] = [];

	brief.items.forEach((item, itemIndex) => {
		const product = item.productId ? byId.get(item.productId) : undefined;
		if (!product || item.match !== "exact") {
			flags.push({
				kind: "unknown_item",
				itemIndex,
				message:
					item.match === "ambiguous"
						? `"${item.rawText}": customer did not pick between the options.`
						: `"${item.rawText}" is not in the catalog.`,
			});
			return;
		}

		if (product.active === false) {
			flags.push({
				kind: "unavailable",
				itemIndex,
				message: `${product.name} is switched off in Products (customer was told it's not available). Add it back or leave it out.`,
			});
			explain.push({
				itemIndex,
				lines: [`${product.name}: not available right now, left off the quote`],
			});
			return;
		}

		const details = lineDetails(product, item.answers, questions);
		const description = details ? `${product.name} (${details})` : product.name;

		if (product.pricingMode === "custom") {
			const qty = item.quantity && item.quantity > 0 ? item.quantity : 1;
			flags.push({
				kind: "custom_pricing",
				itemIndex,
				message: `${product.name}: custom-priced. Set the price from the requirement brief.`,
			});
			explain.push({
				itemIndex,
				lines: [
					`${product.name}: custom-priced, so staff set the price from the brief`,
				],
			});
			lineItems.push({
				productId: product.id,
				description,
				quantity: qty,
				unit: product.unit,
				unitPriceSen: product.unitPriceSen,
				amountSen: product.unitPriceSen * qty,
				notes: "Custom: price from the requirement brief",
			});
			return;
		}

		const qty = item.quantity && item.quantity > 0 ? item.quantity : 1;
		const applicable = rulesFor(rules, product.id);

		let assessment: string | undefined;
		for (const { config } of applicable) {
			if (config.kind !== "requires_assessment") continue;
			const w = config.when;
			const hit =
				!w ||
				("quantityAbove" in w
					? qty > w.quantityAbove
					: matchesWhen(w, item.answers));
			if (hit) {
				assessment = config.reason;
				flags.push({
					kind: "needs_assessment",
					itemIndex,
					message: `${product.name}: ${config.reason}`,
				});
				break;
			}
		}

		// Base unit price: the highest tier the quantity reaches.
		let unitPriceSen = product.unitPriceSen;
		const log = [
			`${product.name}: catalog price ${formatMYR(product.unitPriceSen)}/${product.unit}`,
		];
		const tierRule = applicable.find((r) => r.config.kind === "tier");
		if (tierRule?.config.kind === "tier") {
			const tier = [...tierRule.config.tiers]
				.sort((a, b) => b.minQty - a.minQty)
				.find((t) => qty >= t.minQty);
			if (tier) {
				unitPriceSen = tier.unitPriceSen;
				log.push(
					`Quantity ${qty} reaches the ${tier.minQty}+ tier → ${formatMYR(tier.unitPriceSen)}/${product.unit}`,
				);
			}
		}

		const notes: string[] = [];
		let flatSen = 0;
		for (const { config } of applicable) {
			if (
				config.kind !== "surcharge" ||
				!matchesWhen(config.when, item.answers)
			)
				continue;
			if (config.perUnitSen) unitPriceSen += config.perUnitSen;
			if (config.amountSen) flatSen += config.amountSen;
			notes.push(config.label);
			log.push(
				`${config.label}: ${config.when.field} is "${config.when.equals}" → ${[
					config.perUnitSen &&
						`+${formatMYR(config.perUnitSen)}/${product.unit}`,
					config.amountSen && `+${formatMYR(config.amountSen)} flat`,
				]
					.filter(Boolean)
					.join(", ")}`,
			);
		}

		let amountSen = unitPriceSen * qty + flatSen;
		log.push(
			`${qty} × ${formatMYR(unitPriceSen)}${flatSen ? ` + ${formatMYR(flatSen)}` : ""} = ${formatMYR(amountSen)}`,
		);
		const minRule = applicable.find((r) => r.config.kind === "minimum_charge");
		if (
			minRule?.config.kind === "minimum_charge" &&
			amountSen < minRule.config.minSen
		) {
			amountSen = minRule.config.minSen;
			notes.push("Minimum charge applied");
			log.push(`Below the minimum charge → ${formatMYR(amountSen)}`);
		}
		if (assessment) {
			notes.push("Price to be confirmed after assessment");
			log.push(`Needs assessment: ${assessment}`);
		}
		let backorder: number | undefined;
		if (product.type === "stock") {
			const available = Math.max(availableStock(product), 0);
			if (qty > available) {
				backorder = qty - available;
				const restock = upcomingRestock(
					{ restockDate: product.restockDate ?? null },
					today,
				);
				// The customer sees this note: no stock counts, just when it comes.
				const when = restock
					? `after restock (expected ${formatDay(restock)})`
					: "after restock";
				notes.push(
					available > 0 ? `Part now, the rest ${when}` : `Available ${when}`,
				);
				flags.push({
					kind: "insufficient_stock",
					itemIndex,
					message: `${product.name}: only ${available} ${product.unit} available, customer wants ${qty} (customer was told). ${
						restock
							? `Restock expected ${formatDay(restock)}.`
							: "No restock date set: confirm when the rest can come."
					}`,
				});
				log.push(
					`Stock: only ${available} available for ${qty} needed — ${backorder} on backorder, flagged for staff`,
				);
			} else {
				log.push(`Stock: ${available} available, enough for ${qty}`);
			}
		}
		explain.push({ itemIndex, lines: log });

		lineItems.push({
			productId: product.id,
			description,
			quantity: qty,
			unit: product.unit,
			unitPriceSen,
			amountSen,
			notes: notes.length ? notes.join(" · ") : undefined,
			...(backorder ? { backorder } : {}),
		});
	});

	return {
		outcome: flags.length > 0 ? "needs_review" : "draft_ready",
		flags,
		lineItems,
		explain,
	};
}

export function totals(
	lineItems: LineItem[],
	sstRateBps: number,
	sstRegistered: boolean,
) {
	const subtotalSen = lineItems.reduce((sum, l) => sum + l.amountSen, 0);
	const sstSen = sstRegistered
		? Math.round((subtotalSen * sstRateBps) / 10000)
		: 0;
	return { subtotalSen, sstSen, totalSen: subtotalSen + sstSen };
}

export { formatMYR };
