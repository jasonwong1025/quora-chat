import { spawn } from "node:child_process";

// One always-on host can supervise both processes; either failure restarts the deployment.
const children = [
	spawn(
		process.execPath,
		["--env-file-if-exists=.env", ".output/server/index.mjs"],
		{ stdio: "inherit" },
	),
	spawn(
		process.execPath,
		["--env-file-if-exists=.env", "--import", "tsx", "scripts/worker.ts"],
		{ stdio: "inherit" },
	),
];
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
