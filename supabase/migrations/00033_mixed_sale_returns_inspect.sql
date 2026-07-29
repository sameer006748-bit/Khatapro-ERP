-- ============================================================================
-- 00033 INSPECT — catalog-only verification for mixed sale returns
-- ============================================================================
-- Read-only. Writes nothing, posts nothing, mutates nothing. Run this BEFORE
-- applying 00033 to confirm every dependency exists, and AFTER applying it to
-- confirm the new entry point landed with the right signature and grants.
--
-- Expected BEFORE apply: rows 1-9 present = true, row 10 present = false.
-- Expected AFTER  apply: every row present = true.
-- ============================================================================

select 'dependency' as kind,
       'invoice_items.returned_qty' as object,
       exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'invoice_items'
            and column_name = 'returned_qty'
       ) as present,
       coalesce((
         select data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'invoice_items'
            and column_name = 'returned_qty'
       ), '-') as detail

union all
select 'dependency', 'products.commission_rate',
       exists (
         select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'products'
            and column_name = 'commission_rate'
       ),
       coalesce((
         select data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'products'
            and column_name = 'commission_rate'
       ), '-')

union all
select 'dependency', 'public.sale_return_documents',
       to_regclass('public.sale_return_documents') is not null,
       coalesce(to_regclass('public.sale_return_documents')::text, '-')

union all
select 'dependency', 'public.sale_return_lines',
       to_regclass('public.sale_return_lines') is not null,
       coalesce(to_regclass('public.sale_return_lines')::text, '-')

union all
select 'dependency', 'sale_return_lines_returned_qty_positive',
       exists (
         select 1 from pg_constraint
          where conname = 'sale_return_lines_returned_qty_positive'
            and conrelid = to_regclass('public.sale_return_lines')
       ),
       coalesce((
         select pg_get_constraintdef(oid) from pg_constraint
          where conname = 'sale_return_lines_returned_qty_positive'
            and conrelid = to_regclass('public.sale_return_lines')
       ), '-')

union all
select 'dependency', 'public.commission_events',
       to_regclass('public.commission_events') is not null,
       coalesce(to_regclass('public.commission_events')::text, '-')

union all
select 'dependency',
       'public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid,numeric,text,numeric,numeric,numeric)',
       to_regprocedure(
         'public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid,numeric,text,numeric,numeric,numeric)'
       ) is not null,
       coalesce(pg_get_function_result(to_regprocedure(
         'public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid,numeric,text,numeric,numeric,numeric)'
       )), '-')

union all
select 'dependency',
       'public.post_sale_phase2_ledger(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)',
       to_regprocedure(
         'public.post_sale_phase2_ledger(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)'
       ) is not null,
       coalesce(pg_get_function_result(to_regprocedure(
         'public.post_sale_phase2_ledger(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)'
       )), '-')

union all
select 'dependency',
       'public.post_sale_return_ledger(uuid,text,jsonb,text,text,text,uuid)',
       to_regprocedure('public.post_sale_return_ledger(uuid,text,jsonb,text,text,text,uuid)') is not null,
       coalesce(pg_get_function_result(
         to_regprocedure('public.post_sale_return_ledger(uuid,text,jsonb,text,text,text,uuid)')
       ), '-')

-- ── The object 00033 introduces ───────────────────────────────────────────
union all
select 'introduced',
       'public.post_sale_with_returns_ledger(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)',
       to_regprocedure(
         'public.post_sale_with_returns_ledger(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)'
       ) is not null,
       coalesce(pg_get_function_result(to_regprocedure(
         'public.post_sale_with_returns_ledger(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)'
       )), '-')

union all
select 'introduced', 'post_sale_with_returns_ledger is security definer',
       coalesce((
         select p.prosecdef from pg_proc p
          where p.oid = to_regprocedure(
            'public.post_sale_with_returns_ledger(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)'
          )
       ), false),
       coalesce((
         select array_to_string(p.proconfig, ', ') from pg_proc p
          where p.oid = to_regprocedure(
            'public.post_sale_with_returns_ledger(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)'
          )
       ), '-')

-- ── Grants: service_role only, never anon/authenticated ───────────────────
union all
select 'grant', 'service_role may execute post_sale_with_returns_ledger',
       coalesce(has_function_privilege('service_role',
         'public.post_sale_with_returns_ledger(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)',
         'EXECUTE'), false),
       'expected true'

union all
select 'grant', 'authenticated must NOT execute post_sale_with_returns_ledger',
       coalesce(not has_function_privilege('authenticated',
         'public.post_sale_with_returns_ledger(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)',
         'EXECUTE'), false),
       'expected true'

union all
select 'grant', 'anon must NOT execute post_sale_with_returns_ledger',
       coalesce(not has_function_privilege('anon',
         'public.post_sale_with_returns_ledger(uuid,text,date,jsonb,jsonb,uuid,text,text,text,text,text,text,uuid,text)',
         'EXECUTE'), false),
       'expected true'

-- ── Non-regression: 00033 must not have replaced anything ─────────────────
union all
select 'non-regression',
       'post_sale is still the single 18-argument core (no unwanted overload)',
       (select count(*) = 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'post_sale'),
       coalesce((
         select string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'post_sale'
       ), '-')

union all
select 'non-regression',
       'commission collection/initial-sale contract untouched',
       exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'post_sale_phase2_ledger'
            and pg_get_functiondef(p.oid) like '%initial-sale%'
       ),
       'expected true'

order by kind, object;
