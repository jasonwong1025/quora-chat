# Quora Chat

A chat-based quotation assistant for Malaysian micro and small businesses, built as a reusable workflow in the Orbyte ecosystem (hackathon demo).

Customers send messages in English, Bahasa Melayu, Chinese, or a mix. Like a good salesperson, Quora Chat gathers requirements first and quotes after:

1. **Works out what they want** from the business's catalog (asks if it's unclear).
2. **Gathers the details** the business needs, a question or two at a time, in a natural tone and the customer's own language. Each business sets these as **preset questions** per product, per category, or for every enquiry (text, number, date, choices, yes/no, photo or file, and follow-ups that only appear after a certain answer). The AI can also draft these questions for the business.
3. **Recaps** the requirements and waits for the customer to confirm.
4. **Drafts the quotation.** Fixed-price items are priced by deterministic code from the catalog and pricing rules; the AI never sets a price. Custom-priced work (software, audits…) goes to staff with a structured requirement brief to price.
5. Staff review and approve in Orbyte. The quote goes back on WhatsApp as a PDF with a **Review & sign** link (**Orbyte eSign**).
6. If the customer asks for changes, the AI confirms them and drafts a **revision** (`-R2`); unsigned quotes are replaced on approval. A signed custom project keeps its current agreement until the replacement is signed.
7. **Following up unsigned quotes.** Customers often take days to sign. The AI picks when to nudge (opened or not, their deadline, the chat) and writes a short, friendly reminder; code enforces the business's limits (max reminders, days apart, working hours, never after expiry). Replies are routed: "later" snoozes until their date, a price concern pauses reminders and alerts staff (the AI never discounts), "no thanks" marks the quote **Lost** with the reason. At expiry it's extended once, then marked Lost. Staff can pause, resume, send now or mark lost. A **demo clock** in the sidebar (+1d / +3d / +7d) shows the multi-day flow live.
8. **Handover after signing.** Quora Chat creates the Client and a job in **Orbyte Work**, named by what was bought (Delivery order / Job order / Project), assigns the category's default **PIC**, and the AI writes a handover pack: briefing, scope, key requirements, what we promised in chat, watch-outs and starting tasks. The PIC is notified (simulated Orbyte app + email). Completing a delivery order hands over its reserved stock.
9. **A team chat per job; the team never talks to the customer.** Each job has an internal group with the PIC, any other workers the PIC or an approver adds, and the AI. The customer is never in it. Teammates talk to each other and tag each other (`@Name`, which sends a notification). The AI only answers when tagged **`@AI`**: it answers from the signed brief, quote, agreement conversation and file references, shows where it found each answer, and suggests actions (add task, flag a blocker, ask the customer). It opens the group with the handover briefing. "Ask the customer" drafts a friendly WhatsApp message that **sales approve** in the Quotation inbox; each step shows in the group, and the customer's reply comes back to the group with the team notified.

**Company knowledge base.** Each business keeps its SOPs, policies and specs in **Knowledge**. Documents are **Internal** (the team AI only) or **Public** (the WhatsApp assistant may answer customers from them). Code decides which documents each AI receives, so a customer can't talk the WhatsApp assistant into revealing internal content. The team AI cites the document it used, and the handover pack follows the matching SOPs. The "Who can read what" panel shows what each AI would be given for a question.

Throughout, staff can see the live **requirement brief** (answers, their source, what's missing), fill in answers or, as an approver, waive them with a reason, add their own question for the AI to ask, press **Ask now** or **Draft now**, read the AI's reasoning ("AI thinking"), or **take over** the chat. The code decides what to ask and when to draft; the AI reads answers and words the messages. Every step is recorded as a **simulated Orbyte activity event**.

Products also carry a SKU, a type (stock item or service) and stock levels: a quote that needs more than is available is flagged, and signing reserves the stock.

## Requirements and signed agreements

Requirements are versioned. Unclear/conflicting answers and unresolved follow-ups block drafting; an approver can explicitly waive a requirement with a recorded reason. Quotes capture their exact requirement version. Changed requirements and unread customer messages block approval, and customers see the captured scope and waivers before signing.

Signing and stock reservations commit together. A database-backed worker creates the job and handover with retries. Signed revisions for active custom projects reuse the project, preserve completed tasks, and require PIC review of the changed scope. See [implementation, migration and operations](docs/requirements-agreement-workflow.md).

## Billing after signing

Every quotation states its payment schedule. Each instalment has a trigger: **on signing** (deposit or pay upfront), **after a phase** (when every task in that quotation phase is done) or **on completion**. Custom items take the schedule from their price list; everything else uses the business's **Billing rules** (Quotes → Billing rules, with an AI "suggest for my trade").

It runs on its own: signing invoices the on-signing part; finishing a phase's tasks invoices that phase; ticking the last task completes the job and sends the completion report, the final invoice and the statement of account (as the business chooses). The customer pays in WhatsApp from the invoice card (**Review and pay → Proceed to pay → Send payment**, a simulated saved card, no real gateway), or staff record a bank transfer or cash payment on the job's **Billing** tab. Every payment gets an official receipt PDF. Unpaid invoices get polite AI-timed reminders within the business's limits; once everything is paid the job closes.

## Two sides of the demo

| URL | Who you are | What it is |
| --- | --- | --- |
| `/whatsapp` | The customer | A simulated WhatsApp Web. Chats are the 5 businesses. Send text, photos or documents. Switch customer from the top-left menu. |
| `/orbyte` | The business | An Orbyte workspace: Home, People, **Work** (jobs handed over after signing), eSign, Connect, plus the new **Products** and **Quotation** (Inbox, Quotes) modules. Notifications in the sidebar bell. Switch company and signed-in user from the sidebar. |
| `/sign/:quoteId` | The customer | The eSign page linked from WhatsApp. |

Open `/whatsapp` and `/orbyte` in two tabs side by side. People and Connect show sample data only (`src/data/orbyte-static.ts`); everything else uses the database.

> All businesses, people, prices and messages are **synthetic, team-created demo data**. SST rates are illustrative.

## Stack

- [TanStack Start](https://tanstack.com/start): React SSR app and routing
- [Hono](https://hono.dev): HTTP layer, mounted at `/api/*` inside Start
- [oRPC](https://orpc.unnoq.com): typed RPC at `/api/rpc`, with streaming workflow progress
- [Drizzle ORM](https://orm.drizzle.team) on [Replit Database](https://replit.com/products/database) (Postgres)
- Replit-managed OpenAI (Replit AI Integrations) for message parsing and replies
- Tailwind CSS v4 and shadcn/ui, plus `@react-pdf/renderer` for quotation PDFs

## Getting started

```bash
pnpm install
cp .env.example .env      # fill in DATABASE_URL and the AI keys
pnpm db:push              # create tables
pnpm db:seed              # load the 5 demo businesses (new disposable DB only)
pnpm dev                  # http://localhost:3000, plus the signing → handover worker
```

See [SETUP.md](SETUP.md) for the Replit setup. AI uses Replit-managed OpenAI through `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY`, with no fallback provider. `AI_MODEL` defaults to `gpt-5-mini` and must support strict structured outputs and `reasoning_effort: "minimal"`. Use Node.js 22 and pnpm 10.26.1. The Replit preview runs on port 5000.

## Demo businesses

| Business | Industry | Shows off |
| --- | --- | --- |
| Kilat Print Studio | Printing | quantity tiers, double-sided surcharges, minimum charge, custom-size review, low stock (only 3 X-banner stands) |
| SejukMax Aircon Services | Aircon servicing | per-unit tiers, ceiling-cassette surcharge, repairs needing diagnosis, selling stocked aircon units |
| Rumah Rapi Renovation | Renovation & handyman | site-visit flags (tiling, large rooms), paint-supply surcharge, materials from stock |
| Kodkraf Digital | Software & web development | long custom-priced intakes (custom systems, apps, online shops), multi-choice and conditional questions, file uploads, website surcharges by answer |
| Amanah Kira & Co. | Accounting, tax & audit | audit scoping by revenue and volume bands, tax and bookkeeping fees priced from answers, trial-balance upload |

Each business has sample customer messages. Open an empty WhatsApp chat to tap one.

## Project layout

```
src/
  data/demo.ts          synthetic businesses, catalogs, pricing rules, sample messages
  db/                   Drizzle schema, client, seed script
  server/
    ai.ts               reads messages into the brief, writes replies, suggests questions (Replit-managed OpenAI)
    pricing.ts          deterministic pricing engine
    workflow.ts         message → brief → ask / confirm / draft → approval → revision → signing
    followups.ts        reminders for unsigned quotes, reply routing, extension, lost, demo clock
    jobs.ts             handover after signing: client, job, PIC, team chat (@AI), relayed questions, notifications
  lib/mentions.ts       @AI / @Name tags in the team chat (shared by server and UI)
  lib/knowledge.ts      knowledge-base search (keyword ranking, also handles Chinese)
  server/knowledge.ts   which AI may read which documents; editing (approvers)
  data/demo-knowledge.ts synthetic SOPs, policies and FAQs per business
    orbyte.ts           simulated Orbyte activity events
    hono.ts             /api app: oRPC handler, quote PDF, product images, health
    quote-pdf.tsx       PDF layout
  lib/intake.ts         what's still missing and what to ask next (shared by server and UI)
  orpc/                 oRPC router and isomorphic client
  data/orbyte-static.ts sample data for People / Work / Connect
  routes/               / (landing), /whatsapp, /sign/$quoteId, /orbyte/$businessId/*, /api/$
  components/
    whatsapp/           WhatsApp Web lookalike (chat list, chat window)
    orbyte/             workspace, requirement brief, question editor, AI thinking, request detail
    quote-editor.tsx    edit / approve drafts
    quote-document.tsx  web view of a quotation
```

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Dev server on port 3000 and the background worker (`pnpm dev:web` for the web server alone) |
| `pnpm build` / `pnpm start` | Production build and run |
| `pnpm typecheck` | TypeScript check |
| `pnpm check` | Biome lint and format check |
| `pnpm worker` | Run only the background handover worker |
| `pnpm start:with-worker` | Run production web and worker on one always-on host |
| `pnpm test` / `pnpm test:db` | Unit checks / disposable PostgreSQL integration tests |
| `pnpm test:ui` | Disposable database and browser signing/PDF checks |
| `pnpm db:migrate` | Apply checksummed upgrades to an existing database |
| `pnpm db:push` | Create schema for a new disposable database |
| `pnpm db:seed` | Reset the database to the demo data |
| `pnpm db:studio` | Browse the database |

## Deploying on Replit

The checked-in `.replit` uses an always-on Reserved VM with `pnpm start:with-worker` because handovers require a continuously running worker. Do not rely on web requests to finish handovers. Publishing is a separate, user-approved action. Restrict access: the staff selector is not authentication.

For an existing development database, back it up, stop web and worker processes, run `pnpm db:migrate`, and start the new version. **Do not run `db:seed` on an existing database**; it resets demo data. Fresh disposable development demos can use `db:push` and `db:seed`. Replit's Publish flow manages production schema changes; never run schema pushes or seeds against production.

Replit provides `DATABASE_URL`; connect Replit-managed OpenAI to supply the `AI_INTEGRATIONS_OPENAI_*` settings. Set `AI_MODEL` only to override the default. Keep the repository, `scripts/`, dependencies (including `tsx`) and bundled PDF font available to the runtime. See the [rollout guide](docs/requirements-agreement-workflow.md) for legacy records, recovery and remaining limitations; its manual production migration steps are not applicable to Replit-managed production databases.
