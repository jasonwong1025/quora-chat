-- Why a quotation was rejected, kept on the quote itself (also in the activity log).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS decision_reason text;
