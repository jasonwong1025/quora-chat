import assert from "node:assert/strict";
import { test } from "node:test";
import { nextAction } from "../../src/components/orbyte/next-action";
import { emptyBrief } from "../../src/lib/intake";
import type { BusinessDetail, RequestRow, Staff } from "../../src/lib/types";

const owner = { id: "s1", name: "Aina", canApprove: true } as Staff;
const counter = { id: "s2", name: "Lim", canApprove: false } as Staff;
const business = {
	staff: [owner, counter],
	products: [
		{
			id: "p1",
			name: "Flyer A5",
			category: "Flyers",
			unit: "pc",
			pricingMode: "fixed",
		},
	],
	questions: [],
} as unknown as BusinessDetail;
const brief = {
	...emptyBrief(),
	items: [
		{
			id: "i1",
			productId: "p1",
			match: "exact" as const,
			candidateProductIds: [],
			rawText: "flyer",
			quantity: null,
			answers: {},
		},
	],
};
const request = (patch: Partial<RequestRow>) =>
	({
		id: "r1",
		customerName: "Kak Ros",
		status: "gathering",
		brief,
		briefVersion: 1,
		flags: [],
		quote: null,
		...patch,
	}) as unknown as RequestRow;
const draft = {
	id: "q1",
	number: "KP-Q-0001",
	status: "draft",
	totalSen: 18360,
	requirementVersion: 1,
	requirementsSnapshot: brief,
};

test("gathering: the AI's move, naming what it is asking", () => {
	const next = nextAction(request({}), business, owner);
	assert.equal(next.turn, "ai");
	assert.match(next.title, /quantity of Flyer A5/);
});

test("a current draft is the approver's move; others see who can approve", () => {
	const r = request({ status: "draft_ready", quote: draft } as never);
	assert.equal(nextAction(r, business, owner).turn, "you");
	assert.match(
		nextAction(r, business, owner).title,
		/Review and approve KP-Q-0001/,
	);
	const waiting = nextAction(r, business, counter);
	assert.equal(waiting.turn, "approver");
	assert.match(waiting.detail ?? "", /Aina/);
});

test("an outdated draft is flagged instead of offered for approval", () => {
	const r = request({
		status: "draft_ready",
		briefVersion: 2,
		quote: draft,
	} as never);
	const next = nextAction(r, business, owner);
	assert.equal(next.tone, "warn");
	assert.match(next.detail ?? "", /Requirements changed/);
});

test("sent and signed are waiting / done", () => {
	const sent = request({
		status: "approved",
		quote: { ...draft, status: "approved", viewedAt: null },
	} as never);
	assert.equal(nextAction(sent, business, owner).turn, "customer");
	const signed = request({
		status: "approved",
		quote: { ...draft, status: "accepted", signerName: "Kak Ros" },
	} as never);
	assert.equal(nextAction(signed, business, owner).turn, "done");
});
