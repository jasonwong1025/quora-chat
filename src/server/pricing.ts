/**
 * Deterministic pricing. The AI only extracts what the customer asked for;
 * every number on a quote comes from the business's own catalog and rules.
 */
import type {
	ExtractedRequest,
	Flag,
	LineItem,
	PricingRuleConfig,
	RequiredField,
} from "#/db/schema";
import { formatMYR } from "#/lib/money";

export type CatalogProduct = {
	id: string;
	name: string;
	unit: string;
	unitPriceSen: number;
	requiredFields: RequiredField[];
	/** Stock items are checked against what is available (on hand − reserved). */
	type?: "stock" | "service";
	stockOnHand?: number;
	stockReserved?: number;
};

export function availableStock(p: {
	stockOnHand?: number;
	stockReserved?: number;
}) {
	return (p.stockOnHand ?? 0) - (p.stockReserved ?? 0);
}

export type CatalogRule = {
	productId: string | null;
	config: PricingRuleConfig;
};

export type Outcome = "needs_clarification" | "needs_review" | "draft_ready";

export type PricingResult = {
	outcome: Outcome;
	flags: Flag[];
	lineItems: LineItem[];
	/** How each priced line was worked out, in plain words. */
	explain: { itemIndex: number; lines: string[] }[];
};

function rulesFor(rules: CatalogRule[], productId: string) {
	return rules.filter((r) => r.productId === null || r.productId === productId);
}

function matchesWhen(
	when: { field: string; equals: string },
	fields: Record<string, string>,
) {
	return fields[when.field]?.toLowerCase() === when.equals.toLowerCase();
}

export function priceRequest(
	request: ExtractedRequest,
	products: CatalogProduct[],
	rules: CatalogRule[],
): PricingResult {
	const byId = new Map(products.map((p) => [p.id, p]));
	const flags: Flag[] = [];
	const lineItems: LineItem[] = [];
	const explain: PricingResult["explain"] = [];

	if (request.items.length === 0) {
		flags.push({
			kind: "missing_info",
			message: "Customer has not said what they need yet.",
		});
	}

	request.items.forEach((item, itemIndex) => {
		if (item.match === "ambiguous") {
			flags.push({
				kind: "missing_info",
				itemIndex,
				field: "product",
				message: `"${item.rawText}" could be several products.`,
				options: item.candidateProductIds
					.map((id) => byId.get(id)?.name)
					.filter((n): n is string => Boolean(n)),
			});
			return;
		}

		const product = item.productId ? byId.get(item.productId) : undefined;
		if (item.match === "none" || !product) {
			flags.push({
				kind: "unknown_item",
				itemIndex,
				message: `"${item.rawText}" is not in the catalog.`,
			});
			return;
		}

		let missing = false;
		if (item.quantity === null || item.quantity <= 0) {
			missing = true;
			flags.push({
				kind: "missing_info",
				itemIndex,
				field: "quantity",
				message: `How many ${product.unit} of ${product.name}?`,
			});
		}
		for (const f of product.requiredFields) {
			const value = item.fields[f.key];
			const valid =
				value !== undefined &&
				value !== "" &&
				(!f.options ||
					f.options.some((o) => o.toLowerCase() === value.toLowerCase()));
			if (!valid) {
				missing = true;
				flags.push({
					kind: "missing_info",
					itemIndex,
					field: f.key,
					message: `${product.name}: ${f.label} not given.`,
					options: f.options,
				});
			}
		}
		if (missing || item.quantity === null) return;

		const qty = item.quantity;
		const applicable = rulesFor(rules, product.id);

		let assessment: string | undefined;
		for (const { config } of applicable) {
			if (config.kind !== "requires_assessment") continue;
			const w = config.when;
			const hit =
				!w ||
				("quantityAbove" in w
					? qty > w.quantityAbove
					: matchesWhen(w, item.fields));
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
			if (config.kind !== "surcharge" || !matchesWhen(config.when, item.fields))
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
		if (product.type === "stock") {
			const available = availableStock(product);
			if (qty > available) {
				flags.push({
					kind: "insufficient_stock",
					itemIndex,
					message: `${product.name}: only ${Math.max(available, 0)} ${product.unit} available, customer wants ${qty}.`,
				});
				log.push(
					`Stock: only ${Math.max(available, 0)} available for ${qty} needed — flagged for staff`,
				);
			} else {
				log.push(`Stock: ${available} available, enough for ${qty}`);
			}
		}
		explain.push({ itemIndex, lines: log });

		const details = Object.values(item.fields).filter(Boolean).join(", ");
		lineItems.push({
			productId: product.id,
			description: details ? `${product.name} (${details})` : product.name,
			quantity: qty,
			unit: product.unit,
			unitPriceSen,
			amountSen,
			notes: notes.length ? notes.join(" · ") : undefined,
		});
	});

	const has = (k: Flag["kind"]) => flags.some((f) => f.kind === k);
	const outcome: Outcome = has("missing_info")
		? "needs_clarification"
		: flags.length > 0
			? "needs_review"
			: "draft_ready";

	return { outcome, flags, lineItems, explain };
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
