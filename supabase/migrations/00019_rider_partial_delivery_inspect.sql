-- Run after 00019_rider_partial_delivery.sql in the target SQL console.
-- Expected: every row has ok = true. Stop rollout if any row is false.
select 'delivery_line_progress' object_name,
       to_regclass('public.delivery_line_progress') is not null ok
union all
select 'delivery_outcome_batches',
       to_regclass('public.delivery_outcome_batches') is not null
union all
select 'delivery_outcome_lines',
       to_regclass('public.delivery_outcome_lines') is not null
union all
select 'delivery progress quantity constraint',
       exists (
         select 1 from pg_constraint
         where conname = 'delivery_line_progress_total_check'
           and conrelid = to_regclass('public.delivery_line_progress')
       )
union all
select 'business idempotency constraint',
       exists (
         select 1 from pg_constraint
         where conname = 'delivery_outcome_batches_idempotency_key'
           and conrelid = to_regclass('public.delivery_outcome_batches')
       )
union all
select 'record_delivery_outcome security definer',
       exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'record_delivery_outcome'
           and p.prosecdef
       )
union all
select 'record_delivery_outcome public denied',
       not has_function_privilege(
         'public',
         'public.record_delivery_outcome(uuid,text,jsonb,numeric,text,text,uuid)',
         'EXECUTE'
       )
union all
select 'record_delivery_outcome anon denied',
       not has_function_privilege(
         'anon',
         'public.record_delivery_outcome(uuid,text,jsonb,numeric,text,text,uuid)',
         'EXECUTE'
       )
union all
select 'record_delivery_outcome service role',
       has_function_privilege(
         'service_role',
         'public.record_delivery_outcome(uuid,text,jsonb,numeric,text,text,uuid)',
         'EXECUTE'
       );
