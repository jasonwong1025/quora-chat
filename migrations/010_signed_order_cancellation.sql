-- Customer cancellation of a signed order, including an auditable stock release.
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS cancelled_by text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS cancellation_note text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE stock_reservations ADD COLUMN IF NOT EXISTS released_at timestamptz;
