import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

function createDb() {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
	}
	return drizzle({ connection: { connectionString: url }, schema });
}

let instance: ReturnType<typeof createDb> | undefined;

/** Lazily connect so importing this module never crashes without env vars. */
export function getDb() {
	instance ??= createDb();
	return instance;
}

export { schema };
