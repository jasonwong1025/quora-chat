# Run and publish Quora Chat on your own Replit account

These steps set up a working copy of Quora Chat on Replit with the Replit PostgreSQL database and Replit-managed OpenAI. The team's own copy is at https://replit.com/@RyanLau7/quora-chat and is published at https://quora-chat.replit.app/. To run locally instead, see [How to Run](../README.md#how-to-run) in the README.

## 1. Get the code

Import https://github.com/jasonwong1025/quora-chat with **Create Repl → Import from GitHub**, using the `main` branch.

Check that `package.json` says `"packageManager": "pnpm@10.26.1"`. The app uses Node.js 22, and `.replit` already loads the `nodejs-22` and `postgresql-16` modules.

## 2. Database

Create a database with **Tools → Database**. Replit provides the connection string to the app as `DATABASE_URL` at runtime. Never copy the connection string into chat or source code.

## 3. Turn on Replit-managed OpenAI

Ask Replit Agent:

> Enable Replit AI Integrations for OpenAI in this project. Do not change any code.

Phone verification may be required first. The integration provides `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY`. No OpenRouter or personal OpenAI key is needed. The default model is `gpt-5-mini`, and AI usage is billed through Replit.

## 4. Run the setup script

In the Shell:

```sh
bash scripts/replit-setup.sh
```

The script checks the database and AI settings, installs dependencies, and builds the app. On an empty development database it also creates the tables, records the migrations and seeds the five demo businesses. On a database that is already set up, it only applies pending migrations. If a prerequisite is missing, the script stops with a message that says what to fix.

`bash scripts/replit-setup.sh --reset` deletes all development data. Use it only when you deliberately want to wipe this disposable demo. Never use it against production.

## 5. Try it

Press **Run**. The app and the background handover worker start together, with the web app on port 5000.

The console should print:

```text
[ai] mode=live provider=replit-ai-integrations/openai model=gpt-5-mini configured=true
```

- Staff: `/orbyte/kilat-print`
- Customer: `/whatsapp`
- Health check: `/api/health`

If the start-up log says `configured=false`, the UI loads but live AI conversations will not work until the managed integration is connected.

For a predictable live presentation, set `AI_MODE=replay` in Secrets. The AI's wording is then scripted for the flagship demo, while pricing, approvals, signing and jobs run for real. To clear one business's chats, quotes and jobs between rehearsals, stop the app and run `pnpm demo:reset kilat-print`.

## 6. Publish only when ready

Publishing is a separate action. Running setup does not publish.

- Use an always-on **Reserved VM** so the background worker keeps running. The deployment in `.replit` builds with `pnpm build` and runs `pnpm start:with-worker`.
- Restrict access. The staff selector is a demo feature, not authentication.
- Check current hosting prices and region options in Publishing.
- Replit's Publish flow applies managed production schema changes. Do not run schema pushes or seeds against production, and do not add schema writes to start-up.
- For a fresh demo, consider Publishing's option to copy development data so that the five synthetic businesses are available in production.
- After publishing, check that `/api/health` returns `{"ok":true}`.

Unpublish when the demo is over to stop the hosting charges.

## Upgrading an existing database

1. Back up the database and confirm you can restore it.
2. Stop the web and worker processes so old code cannot write during the upgrade.
3. Run `pnpm db:migrate` against the target `DATABASE_URL`. Each SQL migration in `migrations/` is applied with its checksum under an advisory lock. Running it again is safe. Editing a migration that has already been applied is rejected.
4. Start the web server and worker from the new version.

Do not use `pnpm db:seed` or `pnpm db:push` to upgrade: seeding resets the demo data, and the migration history includes SQL-managed indexes that Drizzle's schema does not fully describe.
