# Quora Chat

A chat-based quotation assistant for Malaysian micro and small businesses, built as a reusable workflow in the Orbyte ecosystem (hackathon demo).

Customers send messages in English, Bahasa Melayu, Chinese, or a mix. Quora Chat then:

1. Turns the conversation into a **structured request** using AI.
2. Checks it against the business's **own catalog and pricing rules**. Pricing is deterministic code, so the AI never sets a price.
3. Picks one of three outcomes:
   - **Draft quotation**: everything matched and was priced.
   - **Ask for clarification**: details are missing.
   - **Flag for human review**: pricing is uncertain or the job needs a site assessment.
4. An authorised staff member reviews, edits, and approves the draft. The quote is then sent back into the chat and can be downloaded as a PDF.
5. Every step is recorded as a **simulated Orbyte activity event**.

> All businesses, people, prices and messages are **synthetic, team-created demo data**. SST rates are illustrative.

## Stack

- [TanStack Start](https://tanstack.com/start): React SSR app and routing
- [Hono](https://hono.dev): HTTP layer, mounted at `/api/*` inside Start
- [oRPC](https://orpc.unnoq.com): typed RPC at `/api/rpc`, with streaming workflow progress
- [Drizzle ORM](https://orm.drizzle.team) on [Replit Database](https://replit.com/products/database) (Postgres)
- OpenRouter (OpenAI-compatible API) for message parsing and replies
- Tailwind CSS v4 and shadcn/ui, plus `@react-pdf/renderer` for quotation PDFs

## Getting started

```bash
pnpm install
cp .env.example .env      # fill in DATABASE_URL and the AI keys
pnpm db:push              # create tables
pnpm db:seed              # load the 3 demo businesses
pnpm dev                  # http://localhost:3000
```

Set `OPENROUTER_API_KEY` (from https://openrouter.ai/keys). `AI_MODEL` takes an OpenRouter model id and defaults to `openai/gpt-5-mini`; it must support structured outputs.

## Demo businesses

| Business | Industry | Shows off |
| --- | --- | --- |
| Kilat Print Studio | Printing | quantity tiers, double-sided surcharges, minimum charge, custom-size review |
| SejukMax Aircon Services | Aircon servicing | per-unit tiers, ceiling-cassette surcharge, repairs needing diagnosis |
| Rumah Rapi Renovation | Renovation & handyman | site-visit flags (tiling, large rooms), paint-supply surcharge |

Each business has sample customer messages in the chat panel to start a demo quickly.

## Project layout

```
src/
  data/demo.ts          synthetic businesses, catalogs, pricing rules, sample messages
  db/                   Drizzle schema, client, seed script
  server/
    ai.ts               extraction and reply generation (OpenRouter)
    pricing.ts          deterministic pricing engine
    workflow.ts         message → request → outcome → approval
    orbyte.ts           simulated Orbyte activity events
    hono.ts             /api app: oRPC handler, quote PDF, health
    quote-pdf.tsx       PDF layout
  orpc/                 oRPC router and isomorphic client
  routes/               /, /quotes/$quoteId, /api/$
  components/           customer chat, reviewer panel, quote editor, activity feed
```

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Dev server on port 3000 |
| `pnpm build` / `pnpm start` | Production build and run |
| `pnpm typecheck` | TypeScript check |
| `pnpm check` | Biome lint and format check |
| `pnpm db:push` | Sync the schema to the database |
| `pnpm db:seed` | Reset the database to the demo data |
| `pnpm db:studio` | Browse the database |

## Deploying on Replit

Import the repo into Replit and add the **Database** tool (it sets `DATABASE_URL`), and add `OPENROUTER_API_KEY` in **Secrets**. Then run `pnpm db:push && pnpm db:seed` once. `.replit` already configures the build and run commands for deployments.
