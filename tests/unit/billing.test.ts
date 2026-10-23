import assert from "node:assert/strict";
import { test } from "node:test";
import type { BillingSettings, QuoteTerms } from "../../src/db/schema";
import {
	instalmentsFor,
	scheduleProblem,
	triggerLabel,
	withSchedule,
} from "../../src/lib/billing";

const terms = (payments: QuoteTerms["payments"], phases: string[] = []) => ({
	phases: phases.map((name) => ({ name, weeks: 1 })),
	payments,
	assumptions: [],
	exclusions: [],
});
const business: BillingSettings = {
	schedule: [
		{ label: "Deposit", percent: 50, when: "signed" },
		{ label: "Balance", percent: 50, when: "completed" },
	],
	dueDays: 7,
	statement: true,
	completionReport: true,
};

test("instalments add up to the quote total exactly", () => {
	const plan = instalmentsFor(
		{
			totalSen: 1000001,
			terms: terms([
				{ label: "A", percent: 40, when: "signed" },
				{ label: "B", percent: 40, when: "completed" },
				{ label: "C", percent: 20, when: "completed" },
			]),
		},
		null,
	);
	assert.equal(
		plan.reduce((s, p) => s + p.amountSen, 0),
		1000001,
	);
});

test("a quote's own schedule wins over the business default", () => {
	const plan = instalmentsFor(
		{
			totalSen: 10000,
			terms: terms([{ label: "Upfront", percent: 100, when: "signed" }]),
		},
		business,
	);
	assert.deepEqual(
		plan.map((p) => [p.label, p.when]),
		[["Upfront", "signed"]],
	);
});

test("without its own schedule, the business default applies", () => {
	const plan = instalmentsFor({ totalSen: 10000, terms: null }, business);
	assert.deepEqual(
		plan.map((p) => [p.when, p.amountSen]),
		[
			["signed", 5000],
			["completed", 5000],
		],
	);
});

test("a phase trigger needs a phase the quote actually has", () => {
	const plan = instalmentsFor(
		{
			totalSen: 10000,
			terms: terms(
				[
					{ label: "Deposit", percent: 40, when: "signed" },
					{ label: "After UAT", percent: 40, when: "phase", phase: "UAT" },
					{ label: "Gone", percent: 20, when: "phase", phase: "Missing" },
				],
				["Build", "UAT"],
			),
		},
		null,
	);
	assert.equal(plan[1].when, "phase");
	assert.equal(triggerLabel(plan[1]), "after UAT");
	assert.equal(plan[2].when, "completed");
});

test("old schedules without triggers: first on signing, rest on completion", () => {
	const plan = instalmentsFor(
		{
			totalSen: 10000,
			terms: terms([
				{ label: "Deposit", percent: 30 },
				{ label: "Balance", percent: 70 },
			]),
		},
		null,
	);
	assert.deepEqual(
		plan.map((p) => p.when),
		["signed", "completed"],
	);
});

test("every drafted quote states how it's paid", () => {
	const t = withSchedule(null, business);
	assert.equal(t.payments.length, 2);
	const own = terms([{ label: "Upfront", percent: 100, when: "signed" }]);
	assert.equal(withSchedule(own, business), own);
	assert.equal(
		scheduleProblem([{ label: "x", percent: 90 }]),
		"Payments add up to 90%, not 100%",
	);
});
