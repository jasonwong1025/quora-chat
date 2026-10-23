import assert from "node:assert/strict";
import { test } from "node:test";
import type { BriefItem } from "../../src/db/schema";
import {
	assess,
	emptyBrief,
	type IntakeProduct,
	nextToAsk,
	type Question,
	topicOf,
} from "../../src/lib/intake";

const product: IntakeProduct = {
	id: "app",
	name: "Mobile app",
	category: "Systems",
	unit: "project",
	pricingMode: "custom",
};
let n = 0;
const q = (
	key: string,
	scope: Question["scope"],
	extra: Partial<Question> = {},
): Question =>
	({
		id: `q${++n}`,
		businessId: "b",
		scope,
		category: scope === "category" ? "Systems" : null,
		productId: scope === "product" ? "app" : null,
		key,
		label: key,
		type: "text",
		options: [],
		required: true,
		position: n,
		hint: null,
		showIf: null,
		onQuote: false,
		source: "staff",
		createdAt: new Date(),
		...extra,
	}) as Question;

const questions = [
	q("purpose", "product"),
	q("features", "product"),
	q("screens", "product"),
	q("admin", "product"),
	q("hosting", "product"),
	q("deadline", "category"),
	q("budget", "category"),
	q("company", "business"),
	q("heard_from", "business", { required: false }),
];
const item: BriefItem = {
	id: "i1",
	productId: "app",
	match: "exact",
	candidateProductIds: [],
	rawText: "mobile app",
	quantity: null,
	answers: {},
};

test("the item's own questions are asked together in one message", () => {
	const a = assess({ ...emptyBrief(), items: [item] }, [product], questions);
	const first = nextToAsk(a.missing);
	assert.deepEqual(
		first.map((m) => (m.kind === "question" ? m.question.key : m.kind)),
		["purpose", "features", "screens", "admin", "hosting"],
	);
	assert.ok(first.every((m) => topicOf(m) === "item:i1"));
});

test("then timing, budget and the customer's details together, optional ones included", () => {
	const answered = Object.fromEntries(
		["purpose", "features", "screens", "admin", "hosting"].map((k) => [
			k,
			{
				values: ["x"],
				source: "customer" as const,
				at: "",
				messageId: undefined,
			},
		]),
	);
	const a = assess(
		{ ...emptyBrief(), items: [{ ...item, answers: answered }] },
		[product],
		questions,
	);
	assert.deepEqual(
		nextToAsk(a.missing).map((m) =>
			m.kind === "question" ? m.question.key : m.kind,
		),
		["deadline", "budget", "company", "heard_from"],
	);
});

test("what they need is still asked on its own first", () => {
	const a = assess(emptyBrief(), [product], questions);
	assert.deepEqual(
		nextToAsk(a.missing).map((m) => m.kind),
		["need"],
	);
});
