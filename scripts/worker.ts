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
		const worked = await runNextTask();
		if (!worked && once) break;
		if (!worked) await setTimeout(1000);
	}
} finally {
	await getDb().$client.end();
}
