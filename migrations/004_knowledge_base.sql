-- Company knowledge base. Internal docs: team AI only. Public docs: customer AI too.
DO $$ BEGIN
  CREATE TYPE knowledge_visibility AS ENUM ('internal', 'public');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS knowledge_docs (
  id text PRIMARY KEY,
  business_id text NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL,
  visibility knowledge_visibility NOT NULL DEFAULT 'internal',
  body text NOT NULL,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_docs_business ON knowledge_docs (business_id, visibility);
