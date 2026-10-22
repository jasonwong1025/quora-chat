import assert from "node:assert/strict";
import { test } from "node:test";
import {
	findMentions,
	handlesFor,
	mentionsAi,
	withoutAiTag,
} from "../../src/lib/mentions";

const team = [
	{ id: "ravi", name: "Ravi Chandran" },
	{ id: "lim", name: "Lim Wei Jie" },
	{ id: "lim2", name: "Lim Mei Ling" },
];

test("@AI is a tag only when written as one", () => {
	assert.equal(mentionsAi("@AI what paper?"), true);
	assert.equal(mentionsAi("hey @ai, what paper?"), true);
	assert.equal(mentionsAi("(@AI) quick one"), true);
	assert.equal(mentionsAi("email me at someone@ai.com"), false);
	assert.equal(mentionsAi("@AIDAN can you help"), false);
	assert.equal(mentionsAi("no tag here, AI"), false);
});

test("teammates are tagged by full name, or a first name nobody else shares", () => {
	assert.deepEqual(
		handlesFor(team).map((h) => h.handle),
		["Ravi Chandran", "Ravi", "Lim Wei Jie", "Lim Mei Ling"],
	);
	assert.deepEqual(findMentions("@Ravi can you check?", team), ["ravi"]);
	assert.deepEqual(findMentions("@Lim can you check?", team), []);
	assert.deepEqual(findMentions("@lim wei jie and @AI please", team).sort(), [
		"ai",
		"lim",
	]);
	assert.deepEqual(findMentions("@Ravindra", team), []);
});

test("the AI reads the question without its tag", () => {
	assert.equal(
		withoutAiTag("@AI, what paper did they pick?"),
		"what paper did they pick?",
	);
	assert.equal(withoutAiTag("Ravi asks @AI: due date?"), "Ravi asks due date?");
});
