import { createFileRoute } from "@tanstack/react-router";
import { app } from "#/server/hono";

/** The browser gave up on the request (navigated away, or a refetch replaced it). */
function clientWentAway(request: Request, err: unknown) {
	const e = err as { code?: string; message?: string } | null;
	return (
		request.signal.aborted ||
		e?.code === "ECONNRESET" ||
		e?.message === "aborted"
	);
}

const handle = async ({ request }: { request: Request }) => {
	try {
		return await app.fetch(request);
	} catch (err) {
		// Nobody is waiting for this response. Answer quietly instead of surfacing
		// it as a server error (in dev, Vite would cover the page with an overlay).
		if (clientWentAway(request, err))
			return new Response(null, { status: 499 });
		throw err;
	}
};

export const Route = createFileRoute("/api/$")({
	server: {
		handlers: {
			HEAD: handle,
			GET: handle,
			POST: handle,
			PUT: handle,
			PATCH: handle,
			DELETE: handle,
		},
	},
});
