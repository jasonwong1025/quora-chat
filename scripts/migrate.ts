import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { getDb } from "../src/db/index";

const db = getDb();
try {
	await db.execute(
		sql`CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
	);
	for (const name of (await readdir(new URL("../migrations/", import.meta.url)))
		.filter((n) => n.endsWith(".sql"))
		.sort()) {
		const source = await readFile(
			new URL(`../migrations/${name}`, import.meta.url),
			"utf8",
		);
		const checksum = createHash("sha256").update(source).digest("hex");
		await db.transaction(async (tx) => {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(72416382)`);
			const existing = await tx.execute(
				sql`SELECT checksum FROM app_migrations WHERE name = ${name}`,
			);
			if (existing.rows.length) {
				if (existing.rows[0].checksum !== checksum)
					throw new Error(`Applied migration changed: ${name}`);
				return;
			}
			await tx.execute(sql.raw(source));
			await tx.execute(
				sql`INSERT INTO app_migrations(name, checksum) VALUES (${name}, ${checksum})`,
			);
			console.log(`Applied ${name}`);
		});
	}
} finally {
	await db.$client.end();
}
