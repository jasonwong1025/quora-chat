import { spawn } from "node:child_process";

// Runs the web app and the background worker together, so signing always leads
// to a job and its handover. `--dev` uses the Vite dev server (pnpm dev);
// otherwise the production build (pnpm start:with-worker). If either process
// stops, both stop.
const dev = process.argv.includes("--dev");
const web = dev
	? spawn(
			process.execPath,
			[
				"node_modules/vite/bin/vite.js",
				"dev",
				"--port",
				process.env.PORT || (process.env.REPL_ID ? "5000" : "3000"),
			],
			{ stdio: "inherit" },
		)
	: spawn(
			process.execPath,
			["--env-file-if-exists=.env", ".output/server/index.mjs"],
			{ stdio: "inherit" },
		);
const worker = spawn(
	process.execPath,
	["--env-file-if-exists=.env", "--import", "tsx", "scripts/worker.ts"],
	{ stdio: "inherit" },
);
const children = [web, worker];
let stopping = false;
function stop(code) {
	if (stopping) return;
	stopping = true;
	process.exitCode = code;
	for (const child of children)
		if (child.exitCode === null) child.kill("SIGTERM");
	const deadline = setTimeout(() => {
		for (const child of children)
			if (child.exitCode === null) child.kill("SIGKILL");
	}, 10_000);
	deadline.unref();
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
for (const child of children) {
	child.on("error", (error) => {
		console.error(error);
		stop(1);
	});
	child.on("exit", (code) => {
		if (!stopping) stop(code || 1);
	});
}
