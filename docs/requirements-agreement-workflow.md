# Requirements, quotations and signed project changes

## Implemented behavior

1. The AI extracts answers with a customer message reference and explicit known, ambiguous or conflicting state. Answers without valid customer evidence remain ambiguous. Required answers are validated against the business's presets; unresolved follow-ups keep the request open.
2. Customer confirmation remains the normal route to drafting. Approvers can use **Draft now** after resolving the requirements, or waive individual requirements with a reason. A staff draft does not claim customer confirmation.
3. Substantive edits increment the requirement version and append its snapshot. Presentation-only changes do not. Concurrent edits from an old screen are rejected.
4. Every new quote freezes the requirements, question labels and offering names. Staff see differences from the prior agreement. Approval requires the current requirement version and review token, and blocks on customer messages that arrived but have not been processed.
5. The web quote, signing page and PDF include the captured scope and waivers. Signing validates that agreement again, commits acceptance and stock reservations atomically, and enqueues handover work. Repeating a successful signature does not create another reservation or job.
6. After a signed custom project changes, the old agreement stays active while the replacement is discussed. The replacement signature supersedes it. The existing project receives the revised handover; completed tasks remain, outstanding tasks are blocked, and suggested new tasks are shown separately. The PIC or an approver must acknowledge the revised scope before progressing work.

Signed revisions currently apply to active custom projects without stock items. Completed work and stock orders need a separately reviewed request. This avoids silently changing a delivered order or its stock ledger.

## Run locally

Use Node 22+ and the project's pinned pnpm version. Configure `.env` from `.env.example`.

```sh
pnpm install --frozen-lockfile
pnpm dev
# Second terminal, same database and AI settings:
pnpm worker
```

Production: `pnpm build`, then `pnpm start:with-worker` on one always-on host. Alternatively run `pnpm start` and `pnpm worker` as independently supervised services. The worker needs the source, `scripts/`, `tsx`, the same database and AI credentials. The PDF needs `public/fonts/` or `.output/public/fonts/`; the font and its license are included in the repository.

The existing `.replit` web-only autoscale configuration must be changed in the deployment setup before rollout. Choose an always-on deployment and set its run command to `pnpm start:with-worker`, or provision a separate persistent worker. Confirm the sponsored credit budget and expiry before provisioning. No deployment or sponsor spending is performed by this implementation.

## Upgrade an existing database

1. Back up the database and verify access to the backup. Stop the previous web and worker processes so the old code cannot write during the upgrade.
2. Use the target database's `DATABASE_URL` and run `pnpm db:migrate`. The SQL upgrade and its checksum record commit together under an advisory lock. Running it again is safe; editing already applied migration SQL is rejected.
3. Start web and worker from this version. Do not run `db:seed` or `db:push` as an upgrade procedure.
4. Check a migrated request, reprepare an unsigned legacy quote, and sign a synthetic test quote. Confirm that its handover appears and the queue completes.

For a brand-new disposable demo database only, use `pnpm db:push` then `pnpm db:seed` instead. Seeding is destructive.

### Legacy records

- Existing briefs are retained as version 1; the migration does not infer earlier agreed requirements.
- Existing quotes keep a null requirement snapshot. They cannot pass new agreement approval/signing checks. Reprepare drafts from the reviewed current brief. For an already sent legacy quote, capture a customer revision and send a new quote with a snapshot. Existing accepted records remain accepted.
- Unfinished legacy handovers are queued for recovery. Their original signed requirement snapshot may not exist; inspect them before operational use.
- Duplicate jobs for one quote cause the unique index migration to fail. Reconcile those records deliberately and rerun; the migration does not delete jobs.
- Historical stock reservations are not reconstructed. Legacy delivery jobs without the new reservation ledger require manual reconciliation before completion.
- Rollback requires restoring the backup and matching application version. Do not switch back to old writers after accepting new agreements.

## Worker recovery

Tasks live in `workflow_tasks`. Workers claim with a five-minute lease and a claim token. Effects and completion commit in the same transaction; replaced claims cannot commit stale results. A stopped worker's task becomes eligible when its lease expires. Failed attempts retry after 15 seconds, up to five attempts. A superseded quote generation is discarded instead of overwriting a newer handover.

The job page shows failed handover preparation and offers retry. Resolve the AI/provider error first, then retry from that page. If job creation itself repeatedly fails before a job exists, inspect the worker log and `workflow_tasks.last_error`, fix the underlying issue, and have an operator reset that failed task to pending with attempts 0 and empty claim/lease. Keep one task per existing unique key; do not insert a replacement task or delete the accepted quote.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm test:db
# Also verify an upgrade from the team's follow-up schema:
TEST_SCHEMA_REF=ce1f526 pnpm test:db
pnpm build
PLAYWRIGHT_PYTHON=/path/to/playwright/python pnpm test:ui
# Exercise the built web server and supervised worker too:
QUORA_UI_PRODUCTION=1 PLAYWRIGHT_PYTHON=/path/to/playwright/python pnpm test:ui
```

Database tests start and destroy their own PostgreSQL cluster, upgrade the original schema from commit `5bce7a7` (or the team schema from `ce1f526`), and mock the AI endpoint. The team-schema run verifies preservation of existing reminder data and custom rules. They never use the `.env` database or real model credits. Install PostgreSQL 16 tools or set `PG_BIN`. Browser checks also need Python Playwright with Chromium, `pdftotext` and `pdftoppm`. Screenshots/PDF are written to a temporary artifact directory printed by the runner.

Coverage includes legacy migration, stale review screens, concurrent edits, unread customer messages, unresolved follow-ups, reasoned waivers, stock rollback, duplicate signing, worker restart/retry, immutable handover context, rapid signed revisions, task preservation, PIC acknowledgement, mobile layout, customer signing and Chinese PDF text.

The merged unsigned-quote reminder feature preserves its controls, demo clock and expiry behavior. Signing cancels reminders in the acceptance transaction; reminder generation rechecks the quote and captured requirements before sending. Customer snoozes, price concerns and declines are handled without changing the captured scope. A handled reply updates the processed-message marker so a snoozed quote can still be signed. The follow-up scheduler continues to run in the web process; the separate durable worker handles handovers.

## Remaining boundaries

This is still a demo: the staff identity selector is not production authentication, and WhatsApp, Orbyte and email delivery are simulated. File references are available to the assistant; document content extraction is not implemented. Structured answer evidence and deterministic validation reduce mistaken scope, but real-provider multilingual evaluation and business-specific acceptance examples are still needed before customer rollout.
