# Run and publish Quora Chat on your own Replit account

Setup instructions from `replit/managed-openai-deploy`, adapted for this workspace's port 5000 preview.

## 1. Get the code

Import the repository from GitHub. Use the managed-OpenAI setup changes from
`replit/managed-openai-deploy`.

Check that `package.json` says `"packageManager": "pnpm@10.26.1"` and
`src/server/ai.ts` mentions `AI_INTEGRATIONS_OPENAI`. The app uses Node.js 22.

## 2. Database

The workspace has Replit PostgreSQL available through the runtime-managed
`DATABASE_URL`. Never copy the connection string into chat or source code.

## 3. Turn on Replit-managed OpenAI

Ask Replit Agent:

> Enable Replit AI Integrations for OpenAI in this project. Do not change any code.

Approve the connection prompt if offered. The integration supplies
`AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY`.
No OpenRouter or personal OpenAI key is used. The default model is `gpt-5-mini`.
AI usage is billed through Replit.

## 4. Run the setup script

In the Shell:

```sh
bash scripts/replit-setup.sh
```

It checks database and AI settings, installs dependencies, creates the tables
only on an empty development database, records migrations, seeds the five demo
businesses, and builds. Existing initialized databases get pending migrations
only. Missing prerequisites stop the script with a clear message.

`bash scripts/replit-setup.sh --reset` deletes all development data. Use it only
when you deliberately want to wipe this disposable demo. Never use it against
production.

## 5. Try it

Press **Run**. The app and background worker start together, with the web app
on port 5000.

The console should print:

```text
[ai] mode=live provider=replit-ai-integrations/openai model=gpt-5-mini configured=true
```

- Staff: `/orbyte/kilat-print`
- Customer: `/whatsapp`
- Health: `/api/health`

If the startup log says `configured=false`, the UI can load but live AI
conversations cannot work until the managed integration is connected.

## 6. Publish only when ready

Publishing is a separate action; running setup does not publish.

- Use an always-on Reserved VM so the background worker keeps running.
- Restrict access. The staff selector is demo functionality, not authentication.
- Review current hosting prices and region options in Publishing.
- Replit's Publish flow applies managed production schema changes. Do not run
  schema pushes or seeds against production, or add schema writes to startup.
- For a fresh demo, review Publishing's option to copy development data so the
  five synthetic businesses are available in production.
- After publishing, verify `/api/health` returns `{"ok":true}`.

Unpublish when the demo is over to stop the hosting service.
