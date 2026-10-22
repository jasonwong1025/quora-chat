import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "#/db";
import router from "#/orpc/router";
import { startFollowUpScheduler } from "./followups";
import { renderQuotePdf } from "./quote-pdf";

// Reminders for unsigned quotes: checked every minute.
startFollowUpScheduler();

const rpc = new RPCHandler(router, {
	interceptors: [
		onError((error) => {
			// A missing record (e.g. an old link after `pnpm db:seed`) is an expected
			// answer for the client, not a server fault; log it briefly.
			if (error instanceof ORPCError && error.code === "NOT_FOUND")
				console.warn("[orpc] not found:", error.message);
			// The browser gave up on the request; nothing went wrong on our side.
			else if ((error as { code?: string })?.code === "ECONNRESET") return;
			else console.error("[orpc]", error);
		}),
	],
});

/** All /api/* traffic. Mounted by src/routes/api.$.ts. */
export const app = new Hono().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));

app.use("/rpc/*", async (c, next) => {
	const { matched, response } = await rpc.handle(c.req.raw, {
		prefix: "/api/rpc",
		context: {},
	});
	if (matched) return c.newResponse(response.body, response);
	await next();
});

app.get("/products/:id/image", async (c) => {
	const product = await getDb().query.products.findFirst({
		where: eq(schema.products.id, c.req.param("id")),
		columns: { image: true },
	});
	const match = product?.image?.match(/^data:(image\/[a-z]+);base64,(.+)$/);
	if (!match) return c.notFound();
	return c.body(Buffer.from(match[2], "base64"), 200, {
		"Content-Type": match[1],
		// The URL carries a version hash, so it can be cached for a long time.
		"Cache-Control": "public, max-age=31536000, immutable",
	});
});

app.get("/messages/:id/attachment", async (c) => {
	const message = await getDb().query.messages.findFirst({
		where: eq(schema.messages.id, c.req.param("id")),
		columns: { attachment: true, attachmentData: true },
	});
	const match = message?.attachmentData?.match(/^data:([^;]+);base64,(.+)$/);
	if (!message?.attachment || !match) return c.notFound();
	const name = message.attachment.name.replace(/["\\\r\n]/g, "_");
	return c.body(Buffer.from(match[2], "base64"), 200, {
		"Content-Type": match[1],
		"Content-Disposition": `inline; filename="${name}"`,
		"Cache-Control": "private, max-age=31536000, immutable",
	});
});

app.get("/quotes/:id/pdf", async (c) => {
	const db = getDb();
	const quote = await db.query.quotes.findFirst({
		where: eq(schema.quotes.id, c.req.param("id")),
	});
	if (!quote) return c.notFound();
	const business = await db.query.businesses.findFirst({
		where: eq(schema.businesses.id, quote.businessId),
	});
	const request = await db.query.quoteRequests.findFirst({
		where: eq(schema.quoteRequests.id, quote.requestId),
	});
	const conversation = request
		? await db.query.conversations.findFirst({
				where: eq(schema.conversations.id, request.conversationId),
			})
		: undefined;
	if (!business) return c.notFound();

	const pdf = await renderQuotePdf({
		quote,
		business,
		customerName: conversation?.customerName ?? "Customer",
	});
	return c.body(new Uint8Array(pdf), 200, {
		"Content-Type": "application/pdf",
		"Content-Disposition": `inline; filename="${quote.number}.pdf"`,
	});
});
