import assert from "node:assert/strict";
import { test } from "node:test";
import { demoKnowledge } from "../../src/data/demo-knowledge";
import { passages, searchKnowledge, terms } from "../../src/lib/knowledge";

const docs = demoKnowledge["kilat-print"].map((d, i) => ({
	id: `d${i}`,
	...d,
}));

test("terms ignore filler words and handle plurals and Chinese", () => {
	assert.deepEqual(terms("What is the bleed for flyers?"), ["bleed", "flyer"]);
	assert.deepEqual(terms("出血多少"), ["出血", "血多", "多少"]);
});

test("search finds the procedure that answers the question", () => {
	const [top] = searchKnowledge(docs, "how much bleed does the artwork need?");
	assert.equal(top.title, "Artwork pre-flight checks");
	assert.match(top.text, /3mm/);
	const [rush] = searchKnowledge(docs, "can we do a rush order next day");
	assert.equal(rush.title, "Production lead times");
});

test("search returns nothing rather than guessing", () => {
	assert.deepEqual(searchKnowledge(docs, "the of and"), []);
	assert.deepEqual(searchKnowledge(docs, "quantum blockchain"), []);
	assert.deepEqual(searchKnowledge([], "bleed"), []);
});

test("long documents are split into passages that keep their title", () => {
	const long = {
		id: "x",
		title: "Long",
		category: "SOP",
		body: Array.from(
			{ length: 10 },
			(_, i) => `Paragraph ${i} ${"word ".repeat(30)}`,
		).join("\n\n"),
	};
	const parts = passages(long);
	assert.ok(parts.length > 1);
	assert.ok(parts.every((p) => p.title === "Long" && p.text.length <= 900));
});
