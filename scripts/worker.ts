import { setTimeout } from "node:timers/promises";
import { getDb } from "../src/db/index";
import { runNextTask } from "../src/server/worker";

const once = process.argv.includes("--once");
let running = true;
process.on("SIGINT", () => {
	running = false;
});
process.on("SIGTERM", () => {
	running = false;
});

try {
	while (running) {
		let worked = false;
		try {
			worked = await runNextTask();
		} catch (err) {
			// e.g. the database briefly unreachable: keep going rather than exit.
			console.error("[worker] could not run a task", err);
			if (once) throw err;
			await setTimeout(5000);
			continue;
		}
		if (!worked && once) break;
		if (!worked) await setTimeout(1000);
	}
} finally {
	await getDb().$client.end();
}
