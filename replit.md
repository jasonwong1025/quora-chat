# Quora Chat

Keep the existing TanStack Start / Hono / oRPC / Drizzle stack and repository layout.
Setup is based on the repository's `replit/managed-openai-deploy` branch.

## Run

- Runtime: Node.js 22; package manager: pnpm 10.26.1.
- Install: `CI=true pnpm install --frozen-lockfile`.
- Run button / workflow: `pnpm dev`, which starts both Vite on port 5000 and
  the background handover worker. Vite accepts the Replit preview host.
- Staff demo: `/orbyte/kilat-print`; customer demo: `/whatsapp`.
- Health: `/api/health` returns `{"ok":true}`.
- Build: `pnpm build`; checks: `pnpm typecheck` and `pnpm test`.

## Database and AI

Replit supplies `DATABASE_URL`. The empty development database has been
initialized with the schema, eight migrations, and five synthetic businesses.
Do not seed or reset it again unless the user deliberately requests a reset.

AI uses only Replit-managed OpenAI, default model `gpt-5-mini`. It requires
`AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY`.
Never invent credentials or replace the provider silently.

The managed OpenAI integration is enabled (provisioned with
`setupReplitAIIntegrations({ providerSlug: "openai" })`, after phone
verification) and a live strict-JSON call to `gpt-5-mini` succeeded.

`bash scripts/replit-setup.sh` preserves an already
initialized database and applies only pending development migrations.
Never run `db:push` on an initialized database: the migration history and
additional SQL-managed indexes are not all represented in Drizzle's schema.

## Verification and limits

Type checking, unit tests, and the production build passed. Both staff and
customer pages were visually checked, and the health endpoint succeeded.
Live AI was verified with a direct structured-output call.

The database integration test harness needs PostgreSQL binaries via
`PG_BIN="$(dirname "$(command -v initdb)")"` on Nix. It also reads a historical
schema from Git commit `5bce7a7`, which is absent from the shallow import.
The suite could not run without that history; do not claim it passed.

## Publishing

Do not publish automatically. Use a Reserved VM for the continuous worker.
The production start command runs web and worker without database schema writes;
Replit's Publish flow handles managed production schema changes.
The staff selector is not authentication: restrict access before publishing.
See `SETUP.md` for setup and publishing guidance.
