ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS brief_version integer NOT NULL DEFAULT 1;
ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS processed_message_id text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS requirement_version integer;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS requirements_snapshot jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS agreement_review_required boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS requirement_versions (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  version integer NOT NULL,
  brief jsonb NOT NULL,
  actor text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS requirement_versions_request_version ON requirement_versions(request_id, version);
INSERT INTO requirement_versions(id, request_id, version, brief, actor, reason)
SELECT id || ':initial', id, brief_version, brief, 'migration', 'Existing brief retained; earlier agreement not inferred'
FROM quote_requests ON CONFLICT (request_id, version) DO NOTHING;

-- A duplicate existing quote/job relationship requires reconciliation, not deletion.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_quote_unique ON jobs(quote_id);

CREATE TABLE IF NOT EXISTS workflow_tasks (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  kind text NOT NULL,
  entity_id text NOT NULL,
  generation text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  claim_token text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stock_reservations (
  id text PRIMARY KEY,
  quote_id text NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity integer NOT NULL,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_reservations_quote_product ON stock_reservations(quote_id, product_id);

-- Resume unfinished handovers created by the previous implementation.
INSERT INTO workflow_tasks(id, key, kind, entity_id, generation)
SELECT 'prepare:' || id, 'prepare_handover:' || id || ':' || quote_id, 'prepare_handover', id, quote_id
FROM jobs WHERE handover IS NULL ON CONFLICT (key) DO NOTHING;

INSERT INTO workflow_tasks(id, key, kind, entity_id)
SELECT 'create:' || q.id, 'create_handover:' || q.id, 'create_handover', q.id
FROM quotes q WHERE q.status = 'accepted' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.quote_id = q.id)
ON CONFLICT (key) DO NOTHING;
