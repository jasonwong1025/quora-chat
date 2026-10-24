# Quora Chat

<p align="center">
  <a href="https://tanstack.com/start"><img src="https://img.shields.io/badge/TanStack-Start-FF4154?logo=reactquery&logoColor=white" alt="TanStack Start" /></a>
  <a href="https://hono.dev"><img src="https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white" alt="Hono" /></a>
  <a href="https://www.postgresql.org/"><img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL 16" /></a>
  <a href="https://replit.com/"><img src="https://img.shields.io/badge/Hosted%20on-Replit-F26207?logo=replit&logoColor=white" alt="Replit" /></a>
  <a href="https://orbyteglobal.com/"><img src="https://img.shields.io/badge/Ecosystem-Orbyte-1B2440" alt="Orbyte" /></a>
</p>

> An AI quotation assistant that takes a Malaysian small business from a WhatsApp enquiry to a signed quote, a handed-over job and a paid invoice, while business rules, not the AI, set every price.

---

## Team Information

| Field                  | Details                                              |
| ---------------------- | ---------------------------------------------------- |
| **Team Name**          | HTL                                                  |
| **Team Domain**        | Domain 2 — ALPHA RED                                 |
| **SDG Track (1–17)**   | SDG 8 — Decent Work and Economic Growth (Targets 8.2 and 8.3) |
| **Team Leader**        | Tng Kar Ming                                         |
| **University**         | Asia Pacific University of Technology & Innovation   |
| **Number of Members**  | 5                                                    |

## Links

| Resource          | Link                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| GitHub Repository | https://github.com/jasonwong1025/quora-chat                          |
| Replit Project    | https://replit.com/@RyanLau7/quora-chat                              |
| Live Demo         | https://quora-chat.replit.app/                                       |
| Slide Deck        | [docs/Quora Chat Pitch Deck.pdf](<docs/Quora Chat Pitch Deck.pdf>)   |
| Demo Video        | https://youtu.be/V8LL5Kc8StU                                          |

---

## Overview

### Problem

Micro, small and medium enterprises make up 96.1% of Malaysian business establishments (2024) and contribute 39.7% of GDP (2025), yet most run with very few staff. One employee often handles many WhatsApp enquiries at once, in English, Bahasa Melayu, Chinese or a mix. Requirements arrive in pieces, quotes are late or wrong, unsigned quotes are forgotten, and agreed details get lost when the job is passed to the team that does the work. Adopting several disconnected CRM and automation tools adds more work for businesses that are already short-handed.

### Solution

Quora Chat is a reusable quotation workflow for the [Orbyte](https://orbyteglobal.com/) SME ecosystem. It connects a customer-facing WhatsApp assistant to a staff workspace and covers the whole path from enquiry to completed job:

1. The AI works out what the customer wants from the business's catalog and asks the business's preset questions, a few at a time, in the customer's own language.
2. It recaps the requirements and waits for the customer to confirm.
3. Deterministic code prices the quote from the catalog and pricing rules. Custom work goes to staff with a structured requirement brief to price. The AI never sets a price.
4. Staff approve the quote. The customer receives a PDF and a **Review & sign** link (Orbyte eSign).
5. The AI follows up unsigned quotes within limits set by the business.
6. After signing, Quora Chat creates the client and job in Orbyte Work, assigns the person in charge (PIC), and writes a handover pack.
7. Billing runs from the quote's payment schedule: invoices, simulated in-chat payment, receipts and reminders.

The AI reads messages and writes the wording. Code decides what to ask, when to draft, what each price is and which documents each AI may read. Our Phase 2 target is a 30% reduction in active staff time per completed enquiry, compared with a manual baseline of 20 minutes. This is a target, not a measured result.

### Key Features

- **Multilingual requirement gathering.** The AI asks the business's preset questions (text, number, date, choices, yes/no, photo or file, and conditional follow-ups) and builds a live requirement brief that records where each answer came from.
- **Deterministic pricing.** Quantity tiers, surcharges, minimum charges and SST come from the catalog and pricing rules. Custom-priced work is routed to staff with a price builder.
- **Staff control.** Staff can see the brief and the AI's reasoning, fill in or waive answers (approvers only, with a reason), press **Ask now** or **Draft now**, or take over the chat.
- **Approval, eSign and revisions.** Quotes freeze the requirement version they were built from. Changed requirements or unread messages block approval. Customer changes create a revision (`-R2`).
- **Timed follow-ups.** The AI decides when to nudge and writes the reminder. Code enforces the maximum number of reminders, spacing, working hours and expiry. Replies are routed to snooze, pause and alert staff, or mark the quote as lost.
- **Handover and team chat.** Signing creates a job with a PIC and an AI-written handover pack. Each job has an internal team chat where the AI answers only when tagged `@AI`. It cites its sources and can draft a question to the customer, which sales must approve before it is sent.
- **Knowledge base with access control.** SOPs, policies and specs are marked **Internal** (team AI only) or **Public** (the WhatsApp assistant may use them). Code decides which documents each AI receives.
- **Stock, billing and cancellation.** Signing reserves stock. Invoices are raised on signing, after a phase or on completion. Customers pay in chat (simulated) and receive receipts. A cancelled order releases its stock reservations and voids unpaid invoices.

The full behaviour is described in [docs/WORKFLOW.md](docs/WORKFLOW.md).

### Tech Stack

| Layer           | Technology                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------- |
| Frontend        | [TanStack Start](https://tanstack.com/start) (React 19 SSR, TanStack Router), TypeScript 6  |
| UI              | Tailwind CSS 4, shadcn/ui (Radix UI), lucide-react                                          |
| Backend         | [Hono](https://hono.dev) at `/api/*`, [oRPC](https://orpc.unnoq.com) typed RPC at `/api/rpc`, Zod 4 |
| Database        | PostgreSQL 16 (Replit Database), [Drizzle ORM](https://orm.drizzle.team), SQL migrations    |
| AI              | GPT-5 mini via Replit-managed OpenAI (deployed) or OpenRouter (local), OpenAI JavaScript SDK |
| Documents       | `@react-pdf/renderer` for quotation, invoice and receipt PDFs (Noto Sans SC for Chinese text) |
| Background jobs | PostgreSQL-backed worker for signing → handover, with leases and retries                    |
| Hosting / Dev   | Replit (Reserved VM deployment, Replit Agent), Node.js 22, pnpm 10.26.1                     |

---

## Project Structure

```
.
├── docs/
│   ├── Quora Chat Pitch Deck.pdf  # Slide deck
│   ├── architecture.png           # Architecture figure
│   ├── WORKFLOW.md                # Detailed workflow and business rules
│   └── SETUP.md                   # Run and publish on your own Replit account
├── migrations/                    # Checksummed SQL upgrades (001–010)
├── public/fonts/                  # Noto Sans SC font for PDFs (OFL licence)
├── scripts/
│   ├── replit-setup.sh            # One-shot Replit development setup
│   ├── start-with-worker.mjs      # Starts the web server and handover worker together
│   ├── worker.ts                  # Background handover worker
│   ├── migrate.ts                 # Applies migrations/ to an existing database
│   ├── eval.ts                    # Synthetic end-to-end evaluation
│   ├── demo-reset.ts              # Clears one demo business's activity
│   └── test-db.mjs, test-ui.mjs   # Disposable-database and browser test runners
├── src/
│   ├── routes/                    # / , /whatsapp, /sign/$quoteId, /orbyte/$businessId/*, /api/$
│   ├── components/
│   │   ├── whatsapp/              # Simulated WhatsApp Web (chat list, chat window, pay)
│   │   ├── orbyte/                # Workspace, requirement brief, question editor, billing, follow-ups
│   │   └── ui/                    # shadcn/ui components
│   ├── server/
│   │   ├── ai.ts                  # Model calls: reading messages, replies, handovers, team answers
│   │   ├── ai-replay.ts           # Scripted AI stand-in for live demos (AI_MODE=replay)
│   │   ├── workflow.ts            # Message → brief → ask / confirm / draft → approval → signing
│   │   ├── pricing.ts             # Deterministic pricing engine
│   │   ├── followups.ts           # Unsigned-quote reminders and reply routing
│   │   ├── jobs.ts                # Handover, PIC, team chat (@AI), relayed customer questions
│   │   ├── knowledge.ts           # Which AI may read which documents
│   │   ├── billing.ts             # Invoices, payments, receipts, reminders
│   │   ├── worker.ts              # Durable task queue
│   │   ├── hono.ts                # /api app: oRPC handler, PDFs, images, health
│   │   └── quote-pdf.tsx, billing-pdf.tsx
│   ├── lib/                       # Shared logic (intake, knowledge search, mentions, billing, money)
│   ├── data/                      # Synthetic businesses, catalogs, knowledge and demo scenario
│   ├── db/                        # Drizzle schema, client and seed script
│   └── orpc/                      # oRPC router and isomorphic client
├── submission/
│   ├── SDC2026_HTL_Preliminary.pdf      # Preliminary submission
│   ├── SDC2026_HTL_TechDeclaration.pdf  # Technology declaration
│   └── SDC2026_HTL_Replit_POU.pdf       # Replit proof of use
├── tests/
│   ├── unit/                      # node:test unit checks
│   ├── integration/               # Workflow tests against a disposable PostgreSQL
│   └── browser/                   # Playwright signing and PDF checks
├── .env.example                   # Example environment variables
├── .replit                        # Replit run and deployment configuration
├── replit.md                      # Replit workspace notes (read by Replit Agent)
├── LICENSE
├── package.json
└── README.md
```

### Architecture

A customer enquiry moves left to right, from the AI chat to a signed quote and a job handover. Every module reads from and writes to the shared core. The AI only reads messages and writes wording; business rules in code decide prices, approvals and which knowledge each AI may see. A picture version of this diagram is in [docs/WORKFLOW.md](docs/WORKFLOW.md#architecture).

```mermaid
flowchart LR
    subgraph CUST["Customer side · /whatsapp, /sign/:quoteId"]
        C(["Customer"])
        AIC["AI Chat<br/>simulated WhatsApp"]
    end

    subgraph COMP["Company side · Orbyte workspace /orbyte/:businessId"]
        KB["Knowledge Base<br/>Public and Internal docs"]
        QI["Quotation Inbox<br/>requirement brief"]
        QE["Quotes & eSign<br/>approval, PDF, signing"]
        TC["Team Chat / Job Handover<br/>Orbyte Work, @AI"]
    end

    subgraph CORE["Shared core · TanStack Start + Hono/oRPC on Replit Reserved VM"]
        DB[("PostgreSQL<br/>Replit Database")]
        AIE["AI Engine<br/>GPT-5 mini via Replit AI Integrations / OpenRouter"]
        BR["Business Rules<br/>pricing, approvals, access control"]
        WK["Handover worker<br/>task queue with retries"]
    end

    subgraph EXT["External / simulated integrations"]
        MSG["Messaging"]
        ES["eSign"]
        OW["Orbyte Work"]
        NT["Notifications"]
    end

    C -- "Enquiry" --> AIC
    AIC -- "Requirements" --> QI
    QI -- "Quotation draft" --> QE
    QE -- "Approval & sign" --> TC

    KB -. "Public info" .-> AIC
    KB -. "Product info & rules" .-> QI
    KB -. "Guidelines" .-> QE
    KB -. "Internal SOPs" .-> TC

    CUST <--> CORE
    COMP <--> CORE
    WK --> TC
    CORE <-.-> EXT
```

### Demo businesses

| Business | Industry | Shows off |
| --- | --- | --- |
| Kilat Print Studio | Printing | Quantity tiers, double-sided surcharges, minimum charge, custom-size review, low stock |
| SejukMax Aircon Services | Aircon servicing | Per-unit tiers, ceiling-cassette surcharge, repairs needing diagnosis, stocked aircon units |
| Rumah Rapi Renovation | Renovation and handyman | Site-visit flags, paint-supply surcharge, materials from stock |
| Kodkraf Digital | Software and web development | Long custom-priced intakes, multi-choice and conditional questions, file uploads |
| Amanah Kira & Co. | Accounting, tax and audit | Audit scoping by revenue bands, fees priced from answers, trial-balance upload |

---

## How to Run

### Option 1 — Run on Replit (Recommended)

1. Open the [Replit Project](https://replit.com/@RyanLau7/quora-chat), or import this repository with **Create Repl → Import from GitHub**.
2. Create a database (**Tools → Database**). Replit provides `DATABASE_URL`.
3. Turn on Replit-managed OpenAI. Ask Replit Agent: *"Enable Replit AI Integrations for OpenAI in this project. Do not change any code."* This provides `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY`. No personal API key is needed.
4. In the Shell, run `bash scripts/replit-setup.sh`. It installs dependencies, creates the schema on an empty database, seeds the five demo businesses and builds.
5. Click **Run**. The `.replit` file starts `pnpm dev`, which runs the web app on port 5000 together with the handover worker.

Full steps, including publishing, are in [docs/SETUP.md](docs/SETUP.md).

### Option 2 — Run Locally

#### Prerequisites

- **Node.js 22** and **pnpm 10.26.1** (`corepack enable` picks up the pinned pnpm version from `package.json`).
- **PostgreSQL 16, running locally.** Outside Replit there is no managed database, so you need your own PostgreSQL server before the app can start. Install it with your package manager (for example `sudo apt install postgresql` or `brew install postgresql@16`) or run it in Docker:

  ```bash
  docker run -d --name quora-pg -p 5432:5432 \
    -e POSTGRES_USER=quora -e POSTGRES_PASSWORD=quora -e POSTGRES_DB=quora_chat \
    postgres:16
  ```

  If you installed PostgreSQL natively, start the service and create a database for the app, then use your own PostgreSQL user and password in `DATABASE_URL`:

  ```bash
  createdb quora_chat
  ```

- **An [OpenRouter](https://openrouter.ai/keys) API key** for the AI. The Replit-managed OpenAI integration is only available inside Replit.

#### Steps

```bash
# 1. Clone the repository
git clone https://github.com/jasonwong1025/quora-chat.git
cd quora-chat

# 2. Install dependencies
pnpm install

# 3. Configure environment variables
cp .env.example .env
#    Then edit .env:
#    DATABASE_URL=postgresql://quora:quora@localhost:5432/quora_chat   (Docker example above)
#    OPENROUTER_API_KEY=<your-key>

# 4. Create the tables and load the demo data (new, disposable database only)
pnpm db:push
pnpm db:seed

# 5. Run the app and the handover worker
pnpm dev                        # http://localhost:3000
```

A local database does not need `?sslmode=require`; that suffix in `.env.example` is for hosted databases such as Replit's.

Open `/whatsapp` (customer) and `/orbyte` (business) in two tabs side by side. On start-up the console prints the AI mode, for example `[ai] mode=live provider=... model=gpt-5-mini configured=true`.

> [!WARNING]
> `pnpm db:seed` resets the database to the demo data. To upgrade an existing database, back it up and run `pnpm db:migrate` instead.

### Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string. Replit provides it automatically. Locally, point it at your own PostgreSQL server. |
| `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY` | On Replit | Replit-managed OpenAI. Used first when present. |
| `OPENROUTER_API_KEY` | Locally | [OpenRouter](https://openrouter.ai/keys) key, used when the Replit integration is absent. |
| `AI_MODEL` | No | Model override. Defaults to `gpt-5-mini` (Replit) or `openai/gpt-5-mini` (OpenRouter). It must support strict structured outputs and `reasoning_effort: "minimal"`. |
| `AI_BASE_URL` | No | OpenAI-compatible endpoint override for OpenRouter mode. |
| `AI_MODE` | No | Set to `replay` for a scripted AI stand-in during live demos. Pricing, approvals, signing and jobs still run for real. |

### Run Tests

```bash
pnpm typecheck    # TypeScript
pnpm check        # Biome lint and format
pnpm test         # Unit tests
pnpm test:db      # Integration tests on a disposable PostgreSQL cluster (needs PostgreSQL 16 tools or PG_BIN)
pnpm test:ui      # Browser signing and PDF checks (needs Python Playwright, pdftotext and pdftoppm)
```

The database and browser tests start their own PostgreSQL cluster and mock the AI endpoint. They never touch the `.env` database or use model credits.

### Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Dev server (port 3000 locally, 5000 on Replit) plus the handover worker |
| `pnpm dev:web` | Web server only |
| `pnpm build` / `pnpm start` | Production build and run |
| `pnpm start:with-worker` | Production web server and worker on one always-on host |
| `pnpm worker` | Handover worker only |
| `pnpm db:push` | Create the schema on a new disposable database |
| `pnpm db:migrate` | Apply checksummed migrations to an existing database |
| `pnpm db:seed` | Reset the database to the demo data |
| `pnpm db:studio` | Browse the database |
| `pnpm demo:reset [businessId]` | Clear one business's chats, quotes and jobs (default `kilat-print`) |
| `pnpm eval` | Synthetic end-to-end evaluation (`QUORA_EVAL_DB=1`, disposable seeded database only) |

---

## How We Use Replit

- **Development:** We built, configured and debugged the project in Replit, using Replit Agent for AI-assisted implementation.
- **Hosting:** The app is deployed with Replit Deployments on an always-on **Reserved VM** at https://quora-chat.replit.app/. It runs `pnpm start:with-worker` so that the handover worker keeps running between requests.
- **Database:** Replit PostgreSQL stores customers, requirement briefs, quotations, approvals, jobs, stock, invoices, messages and activity records. Replit's Publish flow manages production schema changes.
- **AI:** Replit AI Integrations give the deployed app managed access to OpenAI GPT-5 mini, with no personal API key.
- **Secrets:** `DATABASE_URL` and the `AI_INTEGRATIONS_OPENAI_*` values are provided by Replit at runtime and are never stored in the code.

📄 Proof of use: [`submission/SDC2026_HTL_Replit_POU.pdf`](submission/SDC2026_HTL_Replit_POU.pdf)

---

## Challenges & Learnings

- **Keeping the AI away from prices.** Letting a model quote prices risks wrong and inconsistent numbers. We split the work: the AI reads messages into structured, schema-validated answers and writes the wording, while a deterministic pricing engine and approval rules decide every number and state change.
- **Mixed-language conversations.** Customers switch between English, Bahasa Melayu and Chinese within one chat. Each extracted answer keeps a reference to the customer message it came from, and unclear or conflicting answers stay open until they are clarified. Quote PDFs embed a CJK font so that Chinese text renders correctly.
- **Keeping internal knowledge private.** A customer could try to talk the WhatsApp assistant into revealing internal SOPs. Instead of relying on prompt instructions, code chooses which documents each AI receives, and an integration test checks that boundary.
- **Reliable handover.** Signing must not lose or duplicate a job. Signing and stock reservations commit in one transaction, and a PostgreSQL-backed worker creates the job with leases, retries and duplicate protection. This is also why we deploy on a Reserved VM instead of autoscale.
- **What we learned:** combining an LLM with plain business rules gave us a system we can test and explain. We also learned to design the human approval steps from the start rather than adding them at the end.

## Future Improvements

- [ ] Connect the real WhatsApp Business API and a payment gateway
- [ ] Add staff authentication and role-based authorisation in place of the demo user selector
- [ ] Support more trades and extract text from uploaded documents for the knowledge base
- [ ] Run a pilot to measure time to first reply, quote-to-signed rate and staff hours per quote
- [ ] Offer a monthly subscription plus a small fee per signed quote

## Team

| Name              | Role                          | GitHub                                         |
| ----------------- | ----------------------------- | ---------------------------------------------- |
| Tng Kar Ming      | Project Manager               | [@TngEr0425](https://github.com/TngEr0425)     |
| Wong Jia Sen      | Tech Leader                   | [@jasonwong1025](https://github.com/jasonwong1025) |
| Ong Jyong Vey     | AI Engineer                   | [@jayveeong05](https://github.com/jayveeong05) |
| Ong Jun Xian      | Data Analyst                  | [@junxian0208](https://github.com/junxian0208) |
| Ryan Lau Jun Hong | Software Engineer             | [@ryanlau1220](https://github.com/ryanlau1220) |

---

## Submission Checklist

- [x] Team name, domain (Domain 1 / Domain 2) and SDG track filled in
- [x] Slide deck link added
- [x] Demo video link added
- [x] Replit used, with proof of use in `submission/`
- [x] Preliminary submission completed (`SDC2026_HTL_Preliminary.pdf`)
- [x] Technology declaration completed (`SDC2026_HTL_TechDeclaration.pdf`)
- [x] Submission files renamed with your team name (replace `TeamName`)
- [x] "How to Run" steps verified
- [x] No API keys or secrets committed to the repository

## License

This project is licensed under the [Apache License 2.0](LICENSE).
