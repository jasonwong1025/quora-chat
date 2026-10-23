-- Price lists for custom-priced items, and the timeline/payment terms they put on a quotation.
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_builder jsonb;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS terms jsonb;
