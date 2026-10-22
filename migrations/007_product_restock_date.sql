-- When the next stock is expected (YYYY-MM-DD). The AI only tells customers this date.
ALTER TABLE products ADD COLUMN IF NOT EXISTS restock_date text;
