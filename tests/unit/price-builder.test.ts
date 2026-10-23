import assert from "node:assert/strict";
import { test } from "node:test";
import { demoPriceLists } from "../../src/data/demo-price-lists";
import type { Answer, BriefItem } from "../../src/db/schema";
import { emptyBrief } from "../../src/lib/intake";
import {
	addWeeks,
	builderWarnings,
	countFrom,
	priceWithBuilder,
	termsFrom,
} from "../../src/lib/price-builder";
import { paymentAmounts, sumOf, totals } from "../../src/lib/quote-lines";
import { priceBrief } from "../../src/server/pricing";

const ans = (...values: string[]): Answer => ({
	values,
	source: "customer",
	messageId: undefined,
	at: "2026-10-23T00:00:00Z",
});

const app = demoPriceLists["kd-mobile-app"];
const appItem = (answers: Record<string, Answer>): BriefItem => ({
	id: "i1",
	productId: "kd-mobile-app",
	match: "exact",
	candidateProductIds: [],
	rawText: "mobile app",
	quantity: null,
	answers,
});
const appProduct = {
	id: "kd-mobile-app",
	name: "Mobile app",
	unit: "project",
	category: "Systems",
	unitPriceSen: 0,
	pricingMode: "custom" as const,
	priceBuilder: app,
};

test("counts come from answers: plain, ranges (upper end) and areas", () => {
	assert.equal(countFrom(["about 12"]), 12);
	assert.equal(countFrom(["10-15"]), 15);
	assert.equal(countFrom(["4ft x 10ft"]), 40);
	assert.equal(countFrom(["1,200"]), 1200);
	assert.equal(countFrom(["not sure"]), null);
});

test("the price list prices only the parts the answers call for", () => {
	const r = priceWithBuilder({
		product: appProduct,
		builder: app,
		item: appItem({
			features: ans("payments", "booking"),
			screen_count: ans("around 12"),
			after_launch: ans("hosting + maintenance"),
		}),
	});
	const labels = r.lines.map((l) => l.description);
	assert.ok(labels.includes("Payment gateway (FPX & cards)"));
	assert.ok(labels.includes("Booking & scheduling"));
	assert.ok(!labels.includes("In-app chat"));
	const screens = r.lines.find((l) => l.unit === "screen");
	assert.equal(screens?.quantity, 12);
	assert.equal(screens?.amountSen, 12 * 90000);
	assert.equal(sumOf(r.lines, "monthly"), 25000 + 120000);
	assert.deepEqual(r.unpriced, []);
});

test("a per-answer part without a number is reported, not guessed", () => {
	const r = priceWithBuilder({
		product: appProduct,
		builder: app,
		item: appItem({ screen_count: ans("not sure yet") }),
	});
	assert.equal(r.unpriced.length, 1);
	assert.ok(!r.lines.some((l) => l.unit === "screen"));
});

test("per-sqft parts multiply by how many pieces were ordered", () => {
	const banner = demoPriceLists["kp-banner-custom"];
	const r = priceWithBuilder({
		product: { id: "b", name: "Banner", unit: "pc" },
		builder: banner,
		item: {
			answers: { size: ans("4 x 10"), placement: ans("indoor") },
			quantity: 2,
		},
	});
	assert.equal(r.lines.find((l) => l.unit === "sqft")?.quantity, 80);
	assert.equal(r.lines.find((l) => l.unit === "pc")?.quantity, 2);
});

test("only one-time lines count towards the total", () => {
	const t = totals(
		[
			{
				productId: null,
				description: "Build",
				quantity: 1,
				unit: "lot",
				unitPriceSen: 100000,
				amountSen: 100000,
			},
			{
				productId: null,
				description: "Hosting",
				quantity: 1,
				unit: "month",
				unitPriceSen: 25000,
				amountSen: 25000,
				charge: "monthly",
			},
			{
				productId: null,
				description: "Extra",
				quantity: 1,
				unit: "lot",
				unitPriceSen: 5000,
				amountSen: 5000,
				charge: "optional",
			},
		],
		800,
		true,
	);
	assert.equal(t.subtotalSen, 100000);
	assert.equal(t.totalSen, 108000);
});

test("extra weeks go to the longest phase; payments add up exactly", () => {
	const terms = termsFrom(app, 3);
	assert.ok(terms);
	assert.equal(terms.phases.find((p) => p.name === "Development")?.weeks, 9);
	assert.equal(
		addWeeks(terms, 2)?.phases.find((p) => p.name === "Development")?.weeks,
		11,
	);
	const pays = paymentAmounts(terms, 1000001);
	assert.equal(
		pays.reduce((s, p) => s + p.amountSen, 0),
		1000001,
	);
});

test("a trade without timelines gets no terms section", () => {
	const banner = demoPriceLists["kp-banner-custom"];
	const t = termsFrom({ ...banner, assumptions: [] }, 0);
	assert.equal(t, null);
});

test("warnings catch parts that depend on questions the AI never asks", () => {
	const w = builderWarnings(app, [
		{
			key: "features",
			label: "Features",
			type: "multi",
			options: ["payments"],
		},
	]);
	assert.ok(w.some((x) => x.includes("screen_count")));
	assert.ok(w.some((x) => x.includes("booking")));
});

test("custom items with a price list are drafted, flagged for review, and offered to the AI for gaps", () => {
	const brief = {
		...emptyBrief(),
		items: [appItem({ features: ans("chat"), screen_count: ans("8") })],
	};
	const r = priceBrief(brief, [appProduct], [], []);
	assert.equal(r.outcome, "needs_review");
	assert.ok(r.lineItems.length >= 4);
	assert.equal(r.gaps.length, 1);
	assert.equal(r.gaps[0].rate.amountSen, 12000);
	assert.ok(r.terms?.phases.length);
});
