import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRelativeDate } from "../../src/lib/dates";

// Thursday 22 October 2026.
const today = "2026-10-22";

test("next <weekday> is that day in the following week, in three languages", () => {
	for (const phrase of [
		"next Friday",
		"Jumaat depan",
		"jumaat depan.",
		"下个星期五",
		"下周五",
	])
		assert.equal(resolveRelativeDate(phrase, today), "2026-10-30", phrase);
	assert.equal(resolveRelativeDate("next Monday", today), "2026-10-26");
});

test("this <weekday> and plain weekdays are the coming one", () => {
	assert.equal(resolveRelativeDate("this Friday", today), "2026-10-23");
	assert.equal(resolveRelativeDate("Jumaat ini", today), "2026-10-23");
	assert.equal(resolveRelativeDate("Saturday", today), "2026-10-24");
	assert.equal(resolveRelativeDate("Thursday", today), "2026-10-22");
});

test("today, tomorrow and the day after", () => {
	assert.equal(resolveRelativeDate("esok", today), "2026-10-23");
	assert.equal(resolveRelativeDate("明天", today), "2026-10-23");
	assert.equal(resolveRelativeDate("lusa", today), "2026-10-24");
});

test("anything else is left alone rather than guessed", () => {
	for (const phrase of [
		"2026-10-30",
		"end of March",
		"ASAP",
		"Friday or Saturday",
		"before Friday",
		"next Friday afternoon",
		"",
	])
		assert.equal(resolveRelativeDate(phrase, today), null, phrase);
});
