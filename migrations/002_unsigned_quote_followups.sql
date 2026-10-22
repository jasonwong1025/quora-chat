-- Support both the original schema and databases already synced to the team's follow-up feature.
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'lost';

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS follow_up_max integer NOT NULL DEFAULT 3;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS follow_up_gap_days integer NOT NULL DEFAULT 2;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS work_start text NOT NULL DEFAULT '09:00';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS work_end text NOT NULL DEFAULT '19:00';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS work_days jsonb NOT NULL DEFAULT '[1,2,3,4,5,6]';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS extend_days integer NOT NULL DEFAULT 7;

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS follow_ups_paused boolean NOT NULL DEFAULT false;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS paused_until timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS extended_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lost_reason text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lost_note text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lost_at timestamptz;

CREATE TABLE IF NOT EXISTS quote_follow_ups (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quote_id text NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'reminder',
  status text NOT NULL DEFAULT 'scheduled',
  due_at timestamptz NOT NULL,
  reason text,
  body text,
  message_id text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
