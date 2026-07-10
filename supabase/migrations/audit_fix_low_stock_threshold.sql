-- Add low_stock_threshold column to products table
alter table public.products add column if not exists low_stock_threshold integer not null default 5;
