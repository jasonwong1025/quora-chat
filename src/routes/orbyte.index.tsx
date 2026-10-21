import { createFileRoute, redirect } from "@tanstack/react-router";
import { orpc } from "#/orpc/client";

/** /orbyte → the first company's workspace. */
export const Route = createFileRoute("/orbyte/")({
	loader: async ({ context }) => {
		const businesses = await context.queryClient.ensureQueryData(
			orpc.businesses.list.queryOptions(),
		);
		const first = businesses[0];
		if (!first) throw new Error("No businesses yet. Run pnpm db:seed.");
		throw redirect({
			to: "/orbyte/$businessId",
			params: { businessId: first.id },
		});
	},
});
