-- ============================================================================
-- 00033 — MIXED SALE + RETURN IN ONE BILL  (PREPARED, NOT APPLIED)
-- ============================================================================
-- Enables the approved "sale and return adjustment in the same bill" workflow
-- for Counter, Online, OFC and Other sales.
--
-- BUSINESS RULE ENCODED HERE (do not reinterpret):
--   net quantity      = sold quantity - returned quantity
--   stock effect      = -net quantity        (sold out, returned back in)
--   sales value       = gross sold value - return value
--   commission units  = net quantity
--
-- DESIGN — WHY THIS IS ADDITIVE AND NOT A REWRITE
-- ----------------------------------------------------------------------------
-- Every ingredient this feature needs is already deployed and proven:
--
--   * public.post_sale                          (00009, 18 params, text ids)
--       the invoice / invoice_items / stock / voucher writer
--   * public.post_sale_phase2                   (00016)
--       idempotency + server-side seller attribution
--   * public.post_sale_phase2_ledger            (00031)
--       canonical UUID ledger legs for the sale
--   * public.invoice_items.returned_qty         (00014)
--   * public.sale_return_documents / sale_return_lines  (00014)
--   * public.post_sale_return                   (00016)
--       cumulative-return guard, restock, commission return_adjustment
--   * public.post_sale_return_ledger            (00031)
--       canonical UUID ledger legs for the return
--
-- So this migration adds NO new table, NO new column, and REPLACES NO existing
-- function. It adds exactly one composing RPC that runs both halves inside a
-- single PostgreSQL transaction, which is what makes the mixed bill atomic.
--
-- invoice_items.qty deliberately stays GROSS (= sold quantity) and the returned
-- portion lives in invoice_items.returned_qty / sale_return_lines. That choice
-- is forced by existing consumers and is the only one that keeps them correct:
--   - public.post_sale raises 'Item qty must be positive', so a fully returned
--     line could not be expressed as a net-zero qty at all.
--   - 00016 derives the fully-returned flag from `returned_qty >= qty`; a netted
--     qty would mark partially returned bills as fully returned.
--   - 00031 computes sale COGS from `sum(unit_cost_paisas * qty)` and reverses
--     the returned portion separately from sale_return_lines; netting qty would
--     double-count the reversal.
--   - sale_return_lines is documented in 00014 as the auditable source of return
--     quantities, and returned_qty as a cached aggregate. Writing the same-bill
--     return through that machinery preserves the audit linkage rather than
--     hiding the return inside an opaque netted quantity.
--
-- Net arithmetic therefore emerges from two truthful documents instead of one
-- lossy one: the sale posts the gross, the linked return subtracts what came
-- back. Stock, revenue, COGS, receivable and commission all land on net.
--
-- COMMISSION
-- ----------------------------------------------------------------------------
-- The deployed invoice-item trigger (00016) snapshots eligibility as
-- `products.commission_rate * qty` on the GROSS quantity, and post_sale_return
-- inserts a negative 'return_adjustment' event of `rate * returned_qty`.
-- Summed, net eligibility is exactly `rate * net quantity` — the approved
-- Rs 20 x (10 sold - 2 returned) = Rs 160 result, with per-item rows preserved
-- rather than collapsed into one invoice-level figure.
--
-- The 'collection' / allocation_id = 'initial-sale' contract that 00031 reads
-- for the commission ledger legs is NOT touched, renamed or reinterpreted.
--
-- INVOICE STATUS
-- ----------------------------------------------------------------------------
-- post_sale_return sets the invoice to 'Partially Returned' (or 'Returned' when
-- every line came back in full). That is the truthful state of a mixed bill and
-- is exactly what the existing return, reporting and reconciliation code already
-- expects; no new status value is introduced.
--
-- AUTHORIZATION
-- ----------------------------------------------------------------------------
-- The sale half asserts 'can_create_sales'; the return half asserts
-- 'can_cancel_sales' (public.phase2_assert_actor, 00016). A mixed bill is both
-- operations, so both permissions genuinely apply. For the service-role API
-- path auth.uid() is NULL and phase2_assert_actor returns early by design; the
-- HTTP route performs the equivalent check. This function is granted to
-- service_role only, exactly like every other *_ledger wrapper in 00031.
--
-- PREFLIGHT
-- ----------------------------------------------------------------------------
-- The guarded DO block below aborts the transaction unless every dependency is
-- present with the exact expected signature, so applying this file against a
-- database that has not yet received 00014 / 00016 / 00031 fails loudly and
-- changes nothing.
--
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   begin;
--   drop function if exists public.post_sale_with_returns_ledger(
--     uuid, text, date, jsonb, jsonb, uuid, text, text, text, text, text,
--     text, uuid, text
--   );
--   commit;
--   notify pgrst, 'reload schema';
--
-- Dropping it restores the previous behaviour completely: nothing else is
-- modified, so mixed bills simply become unavailable again and the application
-- returns to its fail-closed message. No data written by this function needs to
-- be undone — every row it produces is an ordinary sale document plus an
-- ordinary linked return document, both of which the existing UI, reports and
-- reconciliation already understand.
--
-- MIGRATION 00013 IS NOT ALTERED OR DUPLICATED BY THIS FILE.
-- ============================================================================

begin;

-- ── PREFLIGHT ───────────────────────────────────────────────────────────────
do $$
declare
  v_missing text;
begin
  if to_regclass('public.invoices') is null
     or to_regclass('public.invoice_items') is null
     or to_regclass('public.sale_return_documents') is null
     or to_regclass('public.sale_return_lines') is null
     or to_regclass('public.commission_events') is null
     or to_regclass('public.products') is null then
    raise exception
      'Mixed sale returns require the Phase 1 foundation tables from migration 00014';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'invoice_items'
       and column_name = 'returned_qty'
  ) then
    raise exception 'invoice_items.returned_qty is missing; apply migration 00014 first';
  end if;

  select string_agg(signature, ', ' order by signature)
    into v_missing
  from (values
    ('public.post_sale_phase2_ledger(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)'),
    ('public.post_sale_return_ledger(uuid,text,jsonb,text,text,text,uuid)')
  ) expected(signature)
  where to_regprocedure(signature) is null;
  if v_missing is not null then
    raise exception
      'Mixed sale returns require the verified ledger wrappers from migration 00031; missing: %',
      v_missing;
  end if;

  if pg_get_function_result(to_regprocedure(
       'public.post_sale_phase2_ledger(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)'
     )) <> 'text' then
    raise exception 'post_sale_phase2_ledger must return text';
  end if;
  if pg_get_function_result(to_regprocedure(
       'public.post_sale_return_ledger(uuid,text,jsonb,text,text,text,uuid)'
     )) <> 'jsonb' then
    raise exception 'post_sale_return_ledger must return jsonb';
  end if;
end $$;

-- ── THE ONE NEW ENTRY POINT ─────────────────────────────────────────────────
-- Same argument list as post_sale_phase2_ledger, so the application posts every
-- channel through one shape. Each element of p_items may carry an optional
-- integer `returned_qty`; when all of them are zero or absent the behaviour is
-- byte-for-byte the existing sale path and no return document is created.
create or replace function public.post_sale_with_returns_ledger(
  p_business_id uuid,
  p_invoice_type text,
  p_invoice_date date,
  p_items jsonb,
  p_payments jsonb,
  p_salesman_id uuid,
  p_customer_id text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_customer_city text,
  p_memo text,
  p_created_by uuid,
  p_idempotency_key text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice_id text;
  v_item jsonb;
  v_sold int;
  v_returned int;
  v_product_id text;
  v_return_items jsonb := '[]'::jsonb;
  v_invoice_item_id text;
  v_match_count int;
  v_return_key text;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'Sale idempotency key is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Invoice must have at least 1 item';
  end if;

  -- ── VALIDATE THE MIXED SHAPE BEFORE ANY WRITE ────────────────────────────
  -- Returned may not exceed sold on a new bill. A historical return against a
  -- previously posted invoice is a different operation and stays on
  -- post_sale_return_ledger, where the cumulative remaining-quantity guard
  -- lives.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_sold := coalesce((v_item->>'qty')::int, 0);
    v_returned := coalesce((v_item->>'returned_qty')::int, 0);
    if v_returned < 0 then
      raise exception 'Returned quantity cannot be negative';
    end if;
    if v_returned > v_sold then
      raise exception
        'Returned quantity (%) cannot exceed sold quantity (%) on the same bill',
        v_returned, v_sold;
    end if;
    if v_returned > 0 then
      if coalesce((v_item->>'is_temporary')::boolean, false) then
        raise exception
          'A temporary (non-stock) item cannot carry a same-bill return';
      end if;
      if coalesce(v_item->>'product_id', '') = '' then
        raise exception
          'A same-bill return requires the product identity of the line';
      end if;
    end if;
  end loop;

  -- ── SALE HALF ────────────────────────────────────────────────────────────
  -- qty stays GROSS. post_sale ignores the extra returned_qty key, so the
  -- proven sale path is entered unchanged.
  v_invoice_id := public.post_sale_phase2_ledger(
    p_business_id, p_invoice_type, p_invoice_date, p_items, p_payments,
    p_salesman_id, p_customer_id, p_customer_name, p_customer_phone,
    p_customer_address, p_customer_city, p_memo, p_created_by,
    p_idempotency_key
  );

  -- ── RETURN HALF ──────────────────────────────────────────────────────────
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_returned := coalesce((v_item->>'returned_qty')::int, 0);
    continue when v_returned = 0;  -- sale_return_lines requires returned_qty > 0

    v_product_id := v_item->>'product_id';
    -- Column predicates mirror public.post_sale_return (00016) exactly, so the
    -- business_id comparison stays type-correct on the production schema.
    select count(*)
      into v_match_count
      from public.invoice_items ii
     where ii.business_id = p_business_id
       and ii.invoice_id = v_invoice_id
       and ii.product_id = v_product_id;

    if v_match_count = 0 then
      raise exception
        'Posted invoice has no line for product % to return against', v_product_id;
    end if;
    -- Fail loudly rather than guess which duplicate line the return belongs to.
    if v_match_count > 1 then
      raise exception
        'Product % appears on % lines of this bill; merge them before adding a same-bill return',
        v_product_id, v_match_count;
    end if;

    select ii.id::text
      into v_invoice_item_id
      from public.invoice_items ii
     where ii.business_id = p_business_id
       and ii.invoice_id = v_invoice_id
       and ii.product_id = v_product_id;

    v_return_items := v_return_items || jsonb_build_array(jsonb_build_object(
      'invoice_item_id', v_invoice_item_id,
      'qty', v_returned
    ));
  end loop;

  if jsonb_array_length(v_return_items) = 0 then
    return v_invoice_id;
  end if;

  -- CREDIT mode: the return value reduces the receivable the sale half just
  -- created. No cash leaves the drawer, because the customer only ever handed
  -- over the net amount. Deriving the return key from the sale key keeps the
  -- whole mixed bill idempotent under retry: replaying the request replays the
  -- sale through phase2_sale_idempotency and the return through
  -- sale_return_documents.idempotency_key.
  v_return_key := 'mixed-sale-return:' || p_idempotency_key;
  perform public.post_sale_return_ledger(
    p_business_id,
    v_invoice_id,
    v_return_items,
    'CREDIT',
    coalesce(nullif(trim(p_memo), ''), 'Same-bill return adjustment'),
    v_return_key,
    p_created_by
  );

  return v_invoice_id;
end $$;

revoke all on function public.post_sale_with_returns_ledger(
  uuid, text, date, jsonb, jsonb, uuid, text, text, text, text, text,
  text, uuid, text
) from public, anon, authenticated;

grant execute on function public.post_sale_with_returns_ledger(
  uuid, text, date, jsonb, jsonb, uuid, text, text, text, text, text,
  text, uuid, text
) to service_role;

commit;

notify pgrst, 'reload schema';
