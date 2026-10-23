import assert from "node:assert/strict";
import { test } from "node:test";
import { isExplicitOrderCancellation } from "../../src/lib/cancellation";

for (const message of [
	"Please cancel my order.",
	"We have decided to terminate the agreement",
	"Batalkan pesanan saya",
	"Kami sudah memutuskan untuk batal",
	"请取消我的订单",
	"我们决定取消订单",
])
	test(`explicit cancellation: ${message}`, () => {
		assert.equal(isExplicitOrderCancellation(message), true);
	});

for (const message of [
	"Can I cancel my order?",
	"What happens if we cancel",
	"Maybe cancel next week",
	"Boleh saya batalkan pesanan?",
	"Kalau batal macam mana?",
	"可以取消订单吗",
	"如果取消订单会怎样",
	"Please change one item",
])
	test(`non-destructive cancellation mention: ${message}`, () => {
		assert.equal(isExplicitOrderCancellation(message), false);
	});
