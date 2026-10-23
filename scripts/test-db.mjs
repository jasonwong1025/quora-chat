import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const pgBin = process.env.PG_BIN || "/usr/lib/postgresql/16/bin";
const temp = mkdtempSync(join(tmpdir(), "quora-agreements-test-"));
const data = join(temp, "data");
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const env = {
	...process.env,
	AI_INTEGRATIONS_OPENAI_API_KEY: "isolated-test-key",
	AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:1/v1",
	DATABASE_URL: `postgresql://quora_test@127.0.0.1:${port}/postgres`,
	QUORA_ISOLATED_DB_TEST: "1",
};
function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		env,
		stdio: "inherit",
		...options,
	});
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(`${command} exited with ${result.status}`);
}
let started = false;
try {
	run(
		join(pgBin, "initdb"),
		[
			"-D",
			data,
			"-U",
			"quora_test",
			"-A",
			"trust",
			"--no-locale",
			"--encoding=UTF8",
		],
		{ stdio: "pipe" },
	);
	run(
		join(pgBin, "pg_ctl"),
		[
			"-D",
			data,
			"-l",
			join(temp, "postgres.log"),
			"-o",
			`-h 127.0.0.1 -p ${port} -k ${temp}`,
			"-w",
			"start",
		],
		{ stdio: "pipe" },
	);
	started = true;
	// Upgrade a real copy of the schema before this branch, rather than only testing new installs.
	writeFileSync(
		join(temp, "legacy-schema.ts"),
		execFileSync("git", [
			"show",
			`${process.env.TEST_SCHEMA_REF || "5bce7a7"}:src/db/schema.ts`,
		]),
	);
	symlinkSync(resolve("node_modules"), join(temp, "node_modules"), "dir");
	run(resolve("node_modules/.bin/drizzle-kit"), [
		"push",
		"--schema",
		join(temp, "legacy-schema.ts"),
		"--dialect",
		"postgresql",
		"--url",
		env.DATABASE_URL,
		"--force",
	]);
	run(
		join(pgBin, "psql"),
		[
			env.DATABASE_URL,
			"-v",
			"ON_ERROR_STOP=1",
			"-c",
			`
INSERT INTO businesses(id,name,quote_prefix,industry) VALUES ('legacy','Legacy business','L','Software');
INSERT INTO conversations(id,business_id,customer_name) VALUES ('legacy-chat','legacy','Legacy client');
INSERT INTO quote_requests(id,business_id,conversation_id,status,brief) VALUES ('legacy-request','legacy','legacy-chat','draft_ready','{"language":"en","summary":"Legacy requirements","items":[],"general":{},"followUps":[],"reasoning":[],"asked":[]}');
INSERT INTO quotes(id,number,business_id,request_id,status,line_items,subtotal_sen,sst_sen,total_sen,valid_until) VALUES ('legacy-quote','L-Q-0001','legacy','legacy-request','draft','[]',0,0,0,now()+interval '1 day');
`,
		],
		{ stdio: "pipe" },
	);
	if (process.env.TEST_SCHEMA_REF === "ce1f526") {
		run(
			join(pgBin, "psql"),
			[
				env.DATABASE_URL,
				"-v",
				"ON_ERROR_STOP=1",
				"-c",
				`
UPDATE businesses SET follow_up_max = 5 WHERE id = 'legacy';
INSERT INTO quote_follow_ups(id,business_id,quote_id,conversation_id,due_at,reason) VALUES ('legacy-reminder','legacy','legacy-quote','legacy-chat',now()+interval '2 days','Existing team reminder');
`,
			],
			{ stdio: "pipe" },
		);
	}
	run(process.execPath, ["--import", "tsx", "scripts/migrate.ts"]);
	run(process.execPath, ["--import", "tsx", "scripts/migrate.ts"]);
	if (process.argv.includes("--ui")) {
		run(process.execPath, ["--import", "tsx", "scripts/ui-fixture.ts"]);
		run(process.execPath, ["scripts/test-ui.mjs"]);
	} else {
		const tests = readdirSync("tests/integration")
			.filter((f) => f.endsWith(".test.ts"))
			.map((f) => `tests/integration/${f}`);
		run(process.execPath, ["--import", "tsx", "--test", ...tests]);
	}
} finally {
	if (started)
		spawnSync(
			join(pgBin, "pg_ctl"),
			["-D", data, "-m", "immediate", "-w", "stop"],
			{ stdio: "pipe" },
		);
	rmSync(temp, { recursive: true, force: true });
}
