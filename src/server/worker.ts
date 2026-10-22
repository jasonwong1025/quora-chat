import { eq } from "drizzle-orm";
import { getDb, schema } from "#/db";
import { buildHandover, startHandover } from "./jobs";
import { claimTask, failTask, finishTask } from "./tasks";

/** Process one persisted task. Safe to run from multiple worker processes. */
export async function runNextTask() {
	const task = await claimTask();
	if (!task) return false;
	const claim = { id: task.id, token: task.token };
	try {
		if (task.kind === "create_handover") {
			const quote = await getDb().query.quotes.findFirst({
				where: eq(schema.quotes.id, task.entityId),
			});
			if (!quote) throw new Error("Accepted quotation not found");
			if (quote.status === "superseded") {
				await getDb().transaction((db) => finishTask(db, claim));
				return true;
			}
			const request = await getDb().query.quoteRequests.findFirst({
				where: eq(schema.quoteRequests.id, quote.requestId),
			});
			if (!request) throw new Error("Requirements not found");
			await startHandover(quote, request, claim);
		} else if (task.kind === "prepare_handover") {
			await buildHandover(task.entityId, claim, task.generation);
		} else {
			throw new Error(`Unsupported workflow task: ${task.kind}`);
		}
	} catch (error) {
		await failTask(claim, error);
		console.error(
			`[worker] ${task.kind} failed (attempt ${task.attempts})`,
			error instanceof Error ? error.message : error,
		);
	}
	return true;
}
