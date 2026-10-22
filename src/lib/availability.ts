/**
 * Is what the customer asked for actually available? Services use the product's
 * Active switch; stock items use the inventory (on hand − reserved).
 * Code decides this from the business's own data; the AI only says it nicely.
 */
import type { Brief } from "#/db/schema";

export type AvailabilityProduct = {
	id: string;
	name: string;
	unit: string;
	type: "stock" | "service";
	active: boolean;
	stockOnHand: number;
	stockReserved: number;
	restockDate: string | null;
};

export type AvailabilityIssue = {
	/** Stable per situation: a new quantity is a new thing to tell the customer. */
	key: string;
	itemId: string;
	productId: string;
	name: string;
	unit: string;
} & (
	| { kind: "unavailable" }
	| {
			kind: "short";
			wanted: number;
			available: number;
			/** Only a future date staff entered; never guessed. */
			restockDate: string | null;
	  }
);

export function availableStock(p: {
	stockOnHand?: number;
	stockReserved?: number;
}) {
	return (p.stockOnHand ?? 0) - (p.stockReserved ?? 0);
}

/** A restock date still worth mentioning (today or later, Malaysia date). */
export function upcomingRestock(
	p: { restockDate: string | null },
	today: string,
) {
	return p.restockDate && p.restockDate >= today ? p.restockDate : null;
}

export function availabilityIssues(
	brief: Pick<Brief, "items">,
	products: AvailabilityProduct[],
	today: string,
): AvailabilityIssue[] {
	const byId = new Map(products.map((p) => [p.id, p]));
	const issues: AvailabilityIssue[] = [];
	for (const item of brief.items) {
		const p =
			item.match === "exact" && item.productId
				? byId.get(item.productId)
				: undefined;
		if (!p) continue;
		const base = {
			itemId: item.id,
			productId: p.id,
			name: p.name,
			unit: p.unit,
		};
		if (!p.active) {
			issues.push({
				...base,
				key: `${item.id}:unavailable`,
				kind: "unavailable",
			});
			continue;
		}
		if (p.type !== "stock" || !item.quantity || item.quantity <= 0) continue;
		const available = Math.max(availableStock(p), 0);
		if (item.quantity <= available) continue;
		issues.push({
			...base,
			key: `${item.id}:short:${item.quantity}`,
			kind: "short",
			wanted: item.quantity,
			available,
			restockDate: upcomingRestock(p, today),
		});
	}
	return issues;
}

/** Today's date in Malaysia, YYYY-MM-DD (works in the browser too). */
export function todayInMalaysia() {
	return new Date().toLocaleDateString("en-CA", {
		timeZone: "Asia/Kuala_Lumpur",
	});
}

/** "5 Nov 2026" */
export function formatDay(iso: string) {
	return new Date(`${iso}T00:00:00+08:00`).toLocaleDateString("en-MY", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "Asia/Kuala_Lumpur",
	});
}

/** One plain line for staff (thinking card, notifications, flags). */
export function describeIssue(i: AvailabilityIssue) {
	if (i.kind === "unavailable")
		return `${i.name} is switched off (not available)`;
	return `${i.name}: customer wants ${i.wanted} ${i.unit}, only ${i.available} available${
		i.restockDate
			? `; restock expected ${formatDay(i.restockDate)}`
			: "; no restock date set"
	}`;
}

/** What the recap shows next to the item, so the customer confirms knowing it. */
export function recapNote(i: AvailabilityIssue) {
	if (i.kind === "unavailable")
		return "not available right now, our team will check";
	const when = i.restockDate
		? `after restock (expected ${formatDay(i.restockDate)})`
		: "once restocked (date to be confirmed by our team)";
	return i.available > 0
		? `part now, the rest ${when}`
		: `out of stock, ${when}`;
}

/**
 * Customers never see stock counts: just out of stock / not enough for the full
 * quantity. Exact numbers stay in Orbyte for staff.
 */
export function stockPhrase(i: { available: number }) {
	return i.available > 0
		? "we don't have enough in stock for the full quantity right now"
		: "it's out of stock right now";
}
