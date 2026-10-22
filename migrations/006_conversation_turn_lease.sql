-- One AI turn per chat at a time. A lease (not a lock) so a crashed turn frees itself.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS processing_until timestamptz;
