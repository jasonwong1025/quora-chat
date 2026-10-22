import assert from "node:assert/strict";
import { test } from "node:test";
import type { Answer, Brief } from "../../src/db/schema";
import {
	agreementContent,
	quoteAgreementIssue,
} from "../../src/lib/agreements";
import type { Question } from "../../src/lib/intake";
import { assess, emptyBrief, isAnswered } from "../../src/lib/intake";

const answer = (value: string): Answer => ({
	values: [value],
	source: "customer",
	at: "2026-10-22T00:00:00Z",
});
const question: Question = {
	id: "q",
	businessId: "b",
	scope: "product",
	productId: "p",
	category: null,
	key: "users",
	label: "How many users?",
	type: "number",
	options: [],
	required: true,
	position: 0,
	hint: null,
	showIf: null,
	onQuote: true,
	source: "staff",
	createdAt: new Date(0),
};
const product = {
	id: "p",
	name: "Custom system",
	category: "Systems",
	pricingMode: "custom" as const,
	unit: "job",
};
const brief = (): Brief => ({
	...emptyBrief(),
	items: [
		{
			id: "item",
			productId: "p",
			match: "exact",
			candidateProductIds: [],
			rawText: "custom system",
			quantity: 1,
			answers: { users: answer("50") },
		},
	],
});

test("uncertain, conflicting, invalid numeric and invalid option answers remain unresolved", () => {
	for (const value of [
		"not sure",
		"不确定",
		"tak pasti",
		"(no clear answer)",
		"several people",
		"-5",
	])
		assert.equal(isAnswered(answer(value), question), false, value);
	assert.equal(
		isAnswered({ ...answer("50"), state: "conflicting" }, question),
		false,
	);
	assert.equal(isAnswered(answer("about 50–100"), question), true);
	assert.equal(
		isAnswered(answer("purple"), { type: "single", options: ["red", "blue"] }),
		false,
	);
});

test("a requirement can only be waived with an explicit reason", () => {
	assert.equal(
		isAnswered({ ...answer(""), source: "skipped" }, question),
		false,
	);
	assert.equal(
		isAnswered(
			{
				...answer(""),
				source: "skipped",
				waiverReason: "Owner will measure on site",
			},
			question,
		),
		true,
	);
});

test("an unanswered follow-up still blocks even after it was asked", () => {
	const b = brief();
	b.followUps = [
		{
			id: "f",
			question: "Which users?",
			from: "ai",
			answer: "(no clear answer)",
			asked: true,
			at: new Date().toISOString(),
		},
	];
	assert.equal(assess(b, [product], [question]).blocking.length, 1);
	b.followUps[0].waivedBy = "Owner";
	b.followUps[0].waiverReason = "Will agree this at kickoff";
	assert.equal(assess(b, [product], [question]).blocking.length, 0);
});

test("a summary, language or attribution update does not change the agreement", () => {
	const b = brief();
	const before = agreementContent(b);
	b.language = "ms";
	b.summary = "Rephrased";
	b.reasoning = ["Translated"];
	b.asked = ["users"];
	b.items[0].answers.users.messageId = "other-evidence";
	assert.equal(agreementContent(b), before);
	b.items[0].answers.users.values = ["100"];
	assert.notEqual(agreementContent(b), before);
});

test("an outdated or legacy draft cannot be approved", () => {
	const b = brief();
	const request = { brief: b, briefVersion: 2, status: "draft_ready" };
	assert.match(
		quoteAgreementIssue(
			{ requirementVersion: 1, requirementsSnapshot: b },
			request,
		) ?? "",
		/changed/,
	);
	assert.match(
		quoteAgreementIssue(
			{ requirementVersion: null, requirementsSnapshot: null },
			request,
		) ?? "",
		/new draft/,
	);
	assert.equal(
		quoteAgreementIssue(
			{ requirementVersion: 2, requirementsSnapshot: b },
			request,
		),
		null,
	);
});
