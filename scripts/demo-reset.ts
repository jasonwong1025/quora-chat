/**
 * Clears one demo business's chats, quotes, jobs and activity, keeping its
 * catalog, staff, questions and knowledge. Usage: pnpm demo:reset [businessId]
 * (default: kilat-print, the flagship demo). Stop `pnpm dev` first.
 */
import { getDb } from "../src/db/index";
import { resetDemoActivity } from "../src/server/demo-reset";

const businessId = process.argv[2] ?? "kilat-print";
try {
	const done = await resetDemoActivity(businessId);
	console.log(
		`Reset ${businessId}: cleared ${done.conversations} chats, ${done.quotes} quotes, ${done.jobs} jobs.`,
	);
} finally {
	await getDb().$client.end();
}
