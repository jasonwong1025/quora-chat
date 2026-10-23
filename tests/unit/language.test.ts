import assert from "node:assert/strict";
import { test } from "node:test";
import { hasClearLanguage } from "../../src/server/workflow";

test("short acknowledgements keep the language we were using", () => {
	for (const t of [
		"ok",
		"OK!",
		"5",
		"500 pcs",
		"👍",
		"tq",
		"ok noted",
		"",
		"Yes.",
	])
		assert.equal(hasClearLanguage(t), false, t);
});

test("real sentences decide the language", () => {
	for (const t of [
		"boleh, saya nak 2 unit",
		"can deliver to Klang?",
		"好的",
		"ya betul semua",
	])
		assert.equal(hasClearLanguage(t), true, t);
});

test("product ids from the AI may be SKUs in any case", async () => {
	const { resolveProductId } = await import("../../src/server/workflow");
	const products = [{ id: "kd-mobile-app", sku: "KD-APP-MOBILE" }];
	assert.equal(resolveProductId("kd-mobile-app", products), "kd-mobile-app");
	assert.equal(resolveProductId("kd-app-mobile", products), "kd-mobile-app");
	assert.equal(resolveProductId("KD-APP-MOBILE", products), "kd-mobile-app");
	assert.equal(resolveProductId("kd-mobile", products), null);
});
