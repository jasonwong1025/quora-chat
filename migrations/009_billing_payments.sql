-- Billing after signing: payment schedules with triggers, invoices, payments and receipts.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS billing jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS invoice_id text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS payment_id text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS document jsonb;
ALTER TABLE job_tasks ADD COLUMN IF NOT EXISTS phase text;
ALTER TABLE job_tasks ADD COLUMN IF NOT EXISTS done_at timestamptz;
ALTER TABLE quote_follow_ups ADD COLUMN IF NOT EXISTS invoice_id text;

DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM ('sent', 'paid', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,
  number text NOT NULL UNIQUE,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quote_id text NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  instalment integer NOT NULL,
  label text NOT NULL,
  percent integer NOT NULL,
  amount_sen integer NOT NULL,
  status invoice_status NOT NULL DEFAULT 'sent',
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  reminders_paused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_quote_instalment ON invoices (quote_id, instalment);

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  receipt_number text NOT NULL UNIQUE,
  amount_sen integer NOT NULL,
  method text NOT NULL,
  reference text,
  recorded_by text NOT NULL,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
