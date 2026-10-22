-- Job team group chat: the PIC, assigned workers and the AI (tagged with @AI).
CREATE TABLE IF NOT EXISTS job_members (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  staff_id text NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  added_by_id text REFERENCES staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS job_members_job_staff ON job_members (job_id, staff_id);

ALTER TABLE job_chat ADD COLUMN IF NOT EXISTS author_id text REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE job_chat ADD COLUMN IF NOT EXISTS mentions jsonb NOT NULL DEFAULT '[]';

-- Every existing PIC joins their job's group.
INSERT INTO job_members (id, job_id, staff_id, created_at)
SELECT 'pic:' || j.id, j.id, j.pic_id, j.created_at
FROM jobs j
WHERE j.pic_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- The old one-to-one assistant chat becomes the start of the group: PIC questions were
-- always addressed to the assistant, so they count as tagging it.
UPDATE job_chat c
SET role = 'staff',
    mentions = '["ai"]',
    author_id = (
      SELECT s.id FROM staff s JOIN jobs j ON j.business_id = s.business_id
      WHERE j.id = c.job_id AND s.name = c.author_name
      LIMIT 1
    )
WHERE c.role = 'pic';
