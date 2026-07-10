-- Add low_stock_threshold column to products table
-- Default: 5 pieces
-- Must not be negative
alter table public.products add column if not exists low_stock_threshold integer not null default 5;

-- Refresh PostgREST schema cache so the new column is immediately available
NOTIFY pgrst, 'reload schema';
