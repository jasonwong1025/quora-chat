import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, openSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

if (process.env.QUORA_ISOLATED_DB_TEST !== "1")
	throw new Error("Use the isolated database UI runner");
const listener = createServer();
await new Promise((done) => listener.listen(0, "127.0.0.1", done));
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const artifacts =
	process.env.UI_ARTIFACTS || mkdtempSync(join(tmpdir(), "quora-ui-review-"));
const output = openSync(join(artifacts, "server.log"), "w");
const production = process.env.QUORA_UI_PRODUCTION === "1";
const server = spawn(
	production ? process.execPath : resolve("node_modules/.bin/vite"),
	production
		? ["scripts/start-with-worker.mjs"]
		: ["dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
	{
		env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
		stdio: ["ignore", output, output],
		detached: true,
	},
);
try {
	let ready = false;
	for (let i = 0; i < 60; i++) {
		if (server.exitCode !== null)
			throw new Error(`Dev server exited; see ${artifacts}/server.log`);
		try {
			if (
				(
					await fetch(`http://127.0.0.1:${port}/api/health`, {
						signal: AbortSignal.timeout(2000),
					})
				).ok
			) {
				ready = true;
				break;
			}
		} catch {
			/* wait for startup */
		}
		await setTimeout(1000);
	}
	if (!ready)
		throw new Error(`Dev server did not start; see ${artifacts}/server.log`);
	const result = spawnSync(
		process.env.PLAYWRIGHT_PYTHON || "python3",
		["tests/browser/agreements.py"],
		{
			env: {
				...process.env,
				QUORA_UI_URL: `http://127.0.0.1:${port}`,
				UI_ARTIFACTS: artifacts,
			},
			stdio: "inherit",
		},
	);
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(`Browser checks failed; see ${artifacts}`);
	console.log(`Browser artifacts: ${artifacts}`);
} finally {
	if (server.pid && server.exitCode === null) {
		process.kill(-server.pid, "SIGTERM");
		await new Promise((done) => {
			server.once("exit", done);
			setTimeout(12_000, undefined, { ref: false }).then(() => {
				if (server.exitCode === null) process.kill(-server.pid, "SIGKILL");
				done();
			});
		});
	}
}
