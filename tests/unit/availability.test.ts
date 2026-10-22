import assert from "node:assert/strict";
import { test } from "node:test";
import type { BriefItem } from "../../src/db/schema";
import { availabilityIssues, recapNote } from "../../src/lib/availability";
import { assess, emptyBrief } from "../../src/lib/intake";
import { priceBrief } from "../../src/server/pricing";

const today = "2026-10-23";
const stand = {
	id: "stand",
	name: "X-banner stand",
	category: "Stands",
	unit: "pc",
	unitPriceSen: 2800,
	pricingMode: "fixed" as const,
	type: "stock" as const,
	active: true,
	stockOnHand: 5,
	stockReserved: 2,
	restockDate: "2026-10-29",
};
const wash = {
	...stand,
	id: "wash",
	name: "Waterproofing",
	type: "service" as const,
	active: false,
	stockOnHand: 0,
	stockReserved: 0,
	restockDate: null,
};

const item = (productId: string, quantity: number | null): BriefItem => ({
	id: `i-${productId}`,
	productId,
	match: "exact",
	candidateProductIds: [],
	rawText: productId,
	quantity,
	answers: {},
});
const briefWith = (...items: BriefItem[]) => ({ ...emptyBrief(), items });

test("enough stock is not an issue", () => {
	assert.deepEqual(
		availabilityIssues(briefWith(item("stand", 3)), [stand], today),
		[],
	);
});

test("short stock reports what is free (on hand minus reserved) and the restock date", () => {
	const [issue] = availabilityIssues(
		briefWith(item("stand", 10)),
		[stand],
		today,
	);
	assert.equal(issue.kind, "short");
	assert.ok(issue.kind === "short");
	assert.equal(issue.available, 3);
	assert.equal(issue.wanted, 10);
	assert.equal(issue.restockDate, "2026-10-29");
	assert.match(
		recapNote(issue),
		/^part now, the rest after restock \(expected/,
	);
});

test("a past restock date is never told to the customer", () => {
	const [issue] = availabilityIssues(
		briefWith(item("stand", 10)),
		[{ ...stand, restockDate: "2026-10-01" }],
		today,
	);
	assert.ok(issue.kind === "short");
	assert.equal(issue.restockDate, null);
});

test("no quantity yet means nothing to tell", () => {
	assert.deepEqual(
		availabilityIssues(briefWith(item("stand", null)), [stand], today),
		[],
	);
});

test("a new quantity is a new thing to tell", () => {
	const a = availabilityIssues(briefWith(item("stand", 10)), [stand], today);
	const b = availabilityIssues(briefWith(item("stand", 20)), [stand], today);
	assert.notEqual(a[0].key, b[0].key);
});

test("a switched-off service is unavailable and asks nothing", () => {
	const brief = briefWith(item("wash", null));
	const [issue] = availabilityIssues(brief, [wash], today);
	assert.equal(issue.kind, "unavailable");
	const a = assess(brief, [wash], []);
	assert.deepEqual(a.missing, []);
});

test("pricing leaves unavailable items off and backorders short stock", () => {
	const result = priceBrief(
		briefWith(item("stand", 10), item("wash", 1)),
		[stand, wash],
		[],
		[],
		today,
	);
	assert.equal(result.outcome, "needs_review");
	assert.deepEqual(result.flags.map((f) => f.kind).sort(), [
		"insufficient_stock",
		"unavailable",
	]);
	assert.equal(result.lineItems.length, 1);
	assert.equal(result.lineItems[0].backorder, 7);
	assert.match(
		result.lineItems[0].notes ?? "",
		/^Part now, the rest after restock/,
	);
});

test("customer-facing wording never shows stock counts", () => {
	const [some] = availabilityIssues(
		briefWith(item("stand", 10)),
		[stand],
		today,
	);
	const [none] = availabilityIssues(
		briefWith(item("stand", 10)),
		[{ ...stand, stockReserved: 5 }],
		today,
	);
	for (const i of [some, none]) {
		assert.ok(i.kind === "short");
		assert.doesNotMatch(recapNote(i), /\d+ (in stock|pc)|\b(3|7|10)\b/);
	}
	assert.match(recapNote(none), /^out of stock/);
});
