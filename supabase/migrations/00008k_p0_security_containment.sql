-- P0 emergency security containment for the exact pre-00009 schema.
-- The preflight accepts only the captured baseline or this file's exact contained state.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $p0_preflight$
DECLARE
  v_signature text;
  v_required record;
  v_expected record;
  v_proc record;
  v_trigger record;
  v_rpc_baseline integer := 0;
  v_rpc_contained integer := 0;
  v_function_count integer;
  v_trigger_count integer;
  v_profile_acl text;
  v_profile_baseline boolean;
  v_profile_contained boolean;
  v_objects_baseline boolean;
  v_objects_contained boolean;
  v_definition_fingerprint text;
  v_policy_fingerprint text;
  v_other_table_acl_fingerprint text;
  v_profiles_rls boolean;
  v_profiles_force_rls boolean;
  v_full_trigger_def text;
  v_payment_body_hash constant text := 'd4ee508288a85060b6a0f600dd534267';
  v_return_header_body_hash constant text := 'a9b4a7a876c8b0733a88a283c6a661c1';
  v_return_item_body_hash constant text := '5d5ebd9777bdba45810fa164824cfecf';
  v_baseline_rpc_acl constant text := '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}';
  v_contained_rpc_acl constant text := '{postgres=X/postgres,service_role=X/postgres}';
  v_baseline_profile_acl constant text := '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}';
  v_contained_profile_acl constant text := '{postgres=arwdDxtm/postgres}';
BEGIN
  -- Migration 00009 must remain wholly absent.
  IF to_regclass('public.receipt_allocations') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('invoices', 'receipts')
         AND column_name = 'idempotency_key'
     )
     OR EXISTS (
       SELECT 1 FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN (
           '_block_receipt_allocation_update', '_block_receipt_allocation_delete',
           '_post_salesman_collection_commission', '_require_posting_auth'
         )
     ) THEN
    RAISE EXCEPTION 'P0 containment requires migration 00009 to remain unapplied';
  END IF;

  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'P0 containment must be owned and applied by postgres, not %', current_user;
  END IF;

  FOR v_signature IN SELECT unnest(ARRAY[
    'anon', 'authenticated', 'service_role'
  ]) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_signature) THEN
      RAISE EXCEPTION 'Required role is missing: %', v_signature;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p')) <> 39
     OR (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relnamespace = 'public'::regnamespace) <> 54 THEN
    RAISE EXCEPTION 'Public table or policy inventory differs from the approved pre-00009 schema';
  END IF;

  -- Fingerprint profiles RLS state: relrowsecurity must be TRUE, relforcerowsecurity must be FALSE.
  SELECT relrowsecurity, relforcerowsecurity
    INTO v_profiles_rls, v_profiles_force_rls
  FROM pg_class WHERE oid = 'public.profiles'::regclass;
  IF v_profiles_rls IS DISTINCT FROM true OR v_profiles_force_rls IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'profiles RLS state is not the expected baseline (relrowsecurity=true, relforcerowsecurity=false)';
  END IF;

  FOR v_required IN
    SELECT * FROM (VALUES
      ('profiles','display_name','text',true), ('profiles','phone','text',false),
      ('profiles','role_id','text',true), ('profiles','business_id','text',true),
      ('profiles','is_active','boolean',true), ('profiles','user_id','uuid',true),
      ('vendors','id','text',true), ('vendors','business_id','text',true), ('vendors','is_active','boolean',true),
      ('accounts','id','text',true), ('accounts','business_id','text',true), ('accounts','is_active','boolean',true),
      ('purchases','id','text',true), ('purchases','business_id','text',true), ('purchases','vendor_id','text',true),
      ('purchases','total','numeric(20,0)',true), ('purchases','paid_amount','numeric(20,0)',true),
      ('purchases','outstanding_amount','numeric(20,0)',true),
      ('purchase_payments','id','text',true), ('purchase_payments','business_id','text',true),
      ('purchase_payments','purchase_id','text',false), ('purchase_payments','vendor_id','text',true),
      ('purchase_payments','account_id','text',true), ('purchase_payments','amount','numeric(20,0)',true),
      ('purchase_payments','payment_date','date',true), ('purchase_payments','payment_type','text',true),
      ('purchase_payments','voucher_id','text',false), ('purchase_payments','notes','text',false),
      ('purchase_payments','created_by','uuid',false), ('purchase_payments','created_at','timestamp with time zone',true),
      ('purchase_returns','id','text',true), ('purchase_returns','business_id','text',true),
      ('purchase_returns','purchase_id','text',true), ('purchase_returns','vendor_id','text',true),
      ('purchase_returns','return_no','text',true), ('purchase_returns','return_date','date',true),
      ('purchase_returns','total_amount','numeric(20,0)',true), ('purchase_returns','settlement_type','text',true),
      ('purchase_returns','settlement_account_id','text',false), ('purchase_returns','voucher_id','text',false),
      ('purchase_returns','notes','text',false), ('purchase_returns','created_by','uuid',false),
      ('purchase_returns','created_at','timestamp with time zone',true),
      ('purchase_items','id','text',true), ('purchase_items','business_id','text',true),
      ('purchase_items','purchase_id','text',true), ('purchase_items','product_id','text',false),
      ('purchase_items','product_name','text',true), ('purchase_items','quantity','integer',true),
      ('purchase_items','unit_cost','numeric(20,0)',true), ('purchase_items','returned_quantity','integer',true),
      ('purchase_return_items','id','text',true), ('purchase_return_items','business_id','text',true),
      ('purchase_return_items','purchase_return_id','text',true), ('purchase_return_items','purchase_item_id','text',true),
      ('purchase_return_items','product_id','text',false), ('purchase_return_items','product_name','text',true),
      ('purchase_return_items','quantity','integer',true), ('purchase_return_items','unit_cost','numeric(20,0)',true),
      ('purchase_return_items','line_total','numeric(20,0)',true),
      ('purchase_return_items','stock_movement_id','text',false),
      ('purchase_return_items','created_at','timestamp with time zone',true)
    ) AS x(table_name, column_name, data_type, is_not_null)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relname = v_required.table_name
        AND c.relkind IN ('r','p')
        AND a.attname = v_required.column_name
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND format_type(a.atttypid, a.atttypmod) = v_required.data_type
        AND a.attnotnull = v_required.is_not_null
    ) THEN
      RAISE EXCEPTION 'Required column definition drifted: public.%.%', v_required.table_name, v_required.column_name;
    END IF;
  END LOOP;

  -- Exhaustive Phase-9 marker check: detect any Phase-9 column, index, constraint or RPC signature.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('invoices', 'receipts', 'purchases', 'purchase_payments', 'accounts', 'vendors')
      AND column_name IN (
        'discount_paisas', 'discount_amount', 'discount_percent',
        'allocation_id', 'idempotency_key',
        'commission_id', 'net_collected', 'product_advance', 'delivery_advance',
        'collection_commission_paid'
      )
  ) THEN
    RAISE EXCEPTION 'Phase-9 column marker detected — containment refused';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('post_sale', 'post_receipt_voucher')
      AND p.pronargs > 13
  ) THEN
    RAISE EXCEPTION 'post_sale or post_receipt_voucher has more arguments than pre-Phase-9 (Phase-9 signature detected)';
  END IF;

  FOR v_signature IN SELECT unnest(ARRAY[
    'public.account_ledger(text,text,date,date)',
    'public.day_book(text,date,date,text)',
    'public.negative_stock_report(text)',
    'public.pending_stock_report(text)',
    'public.report_balance_sheet(text,date)',
    'public.report_cash_flow(text,date,date)',
    'public.report_customer_outstanding(text)',
    'public.report_expense_summary(text,date,date)',
    'public.report_inventory_valuation(text)',
    'public.report_profit_loss(text,date,date)',
    'public.report_sales_summary(text,date,date)',
    'public.report_vendor_outstanding(text)',
    'public.rider_dashboard_summary(text,text)',
    'public.rider_ledger(text,text,date,date)',
    'public.trial_balance(text,date,date)',
    'public.vendor_ledger(text,text,date,date)',
    'public.assign_rider_to_order(text,text,text,uuid)',
    'public.cancel_voucher(text,uuid,text)',
    'public.confirm_cod_submission(text,text,numeric,text,numeric,text,uuid)',
    'public.create_cod_submission(text,text,jsonb,text,numeric,text,uuid)',
    'public.create_stock_movement(text,text,text,integer,text,date,uuid,numeric)',
    'public.mark_order_delivered(text,text,numeric,text,text,uuid)',
    'public.mark_order_returned(text,text,text,uuid)',
    'public.post_advance_application(text,text,text,numeric,date,text,uuid)',
    'public.post_contra_entry(text,date,text,text,numeric,text,text,uuid)',
    'public.post_expense_batch(text,date,text,jsonb,text,text,uuid)',
    'public.post_journal_voucher(text,date,text,jsonb,text,uuid)',
    'public.post_payment_voucher(text,date,text,text,numeric,text,text,text,uuid)',
    'public.post_purchase(text,text,date,text,jsonb,jsonb,numeric,numeric,text,uuid)',
    'public.post_purchase_replacement(text,text,jsonb,date,text,uuid)',
    'public.post_purchase_return(text,text,jsonb,text,text,date,text,uuid)',
    'public.post_receipt_voucher(text,date,text,text,numeric,text,text,text,uuid)',
    'public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid)',
    'public.post_sales_return(text,text,date,text,uuid)',
    'public.post_vendor_advance(text,text,text,numeric,date,text,uuid)',
    'public.post_vendor_payment(text,text,text,numeric,date,text,text,uuid)',
    'public.post_voucher(text,text,date,text,jsonb,text,text,uuid)',
    'public.recalculate_product_cost(text)',
    'public.reject_cod_submission(text,text,uuid,text)',
    'public.reverse_voucher_safe(text,text,uuid,text)',
    'public.update_delivery_status(text,text,text,text,uuid)'
  ]) LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Required target RPC signature is missing: %', v_signature;
    END IF;
    -- Semantic ACL comparison using has_function_privilege (order-independent)
    IF (SELECT p.proowner = 'postgres'::regrole FROM pg_proc p WHERE p.oid = to_regprocedure(v_signature)) IS NOT TRUE THEN
      RAISE EXCEPTION 'Target RPC owner drifted: %', v_signature;
    END IF;
    -- Baseline: all five roles have EXECUTE (public, anon, authenticated, service_role, postgres)
    IF has_function_privilege('public', to_regprocedure(v_signature), 'EXECUTE')
       AND has_function_privilege('anon', to_regprocedure(v_signature), 'EXECUTE')
       AND has_function_privilege('authenticated', to_regprocedure(v_signature), 'EXECUTE')
       AND has_function_privilege('service_role', to_regprocedure(v_signature), 'EXECUTE') THEN
      v_rpc_baseline := v_rpc_baseline + 1;
    -- Contained: only postgres and service_role have EXECUTE
    ELSIF has_function_privilege('service_role', to_regprocedure(v_signature), 'EXECUTE')
      AND NOT has_function_privilege('public', to_regprocedure(v_signature), 'EXECUTE')
      AND NOT has_function_privilege('anon', to_regprocedure(v_signature), 'EXECUTE')
      AND NOT has_function_privilege('authenticated', to_regprocedure(v_signature), 'EXECUTE') THEN
      v_rpc_contained := v_rpc_contained + 1;
    ELSE
      RAISE EXCEPTION 'Target RPC ACL drifted: %', v_signature;
    END IF;
  END LOOP;
  IF NOT ((v_rpc_baseline = 41 AND v_rpc_contained = 0) OR (v_rpc_baseline = 0 AND v_rpc_contained = 41)) THEN
    RAISE EXCEPTION 'Target RPC ACLs are in a mixed containment state';
  END IF;

  SELECT md5(string_agg(
           p.oid::regprocedure::text || chr(31) || r.rolname || chr(31) || p.prosecdef::text || chr(31) ||
           l.lanname || chr(31) || coalesce(array_to_string(p.proconfig, ','), '<null>') || chr(31) || pg_get_functiondef(p.oid),
           chr(30) ORDER BY p.oid::regprocedure::text))
    INTO v_definition_fingerprint
  FROM pg_proc p
  JOIN pg_roles r ON r.oid = p.proowner
  JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname NOT IN ('_contain_purchase_payment_tenant','_contain_purchase_return_header','_contain_purchase_return_item','_reconcile_return_header_total');
  IF v_definition_fingerprint <> '33f363f3c36314225f3c23edc37e4e1b' THEN
    RAISE EXCEPTION 'Pre-00009 public function definition/signature fingerprint drifted';
  END IF;

  SELECT md5(string_agg(
           c.relname::text || chr(31) || p.polname::text || chr(31) || p.polpermissive::text || chr(31) ||
           p.polcmd::text || chr(31) || array_to_string(p.polroles, ',') || chr(31) ||
           coalesce(pg_get_expr(p.polqual,p.polrelid), '<null>') || chr(31) ||
           coalesce(pg_get_expr(p.polwithcheck,p.polrelid), '<null>'),
           chr(30) ORDER BY c.relname::text,p.polname::text))
    INTO v_policy_fingerprint
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relnamespace = 'public'::regnamespace;
  IF v_policy_fingerprint <> '280321e95c723186da6026315ad43596' THEN
    RAISE EXCEPTION 'Public policy fingerprint drifted';
  END IF;

  SELECT md5(string_agg(c.relname::text || chr(31) || coalesce(c.relacl::text,'<null>'), chr(30) ORDER BY c.relname::text))
    INTO v_other_table_acl_fingerprint
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND c.relname <> 'profiles';
  IF v_other_table_acl_fingerprint <> 'ba46cbf9185a528e2c7d82e1e7bf09d2' THEN
    RAISE EXCEPTION 'Non-profile public table ACL fingerprint drifted';
  END IF;

  -- Semantic profile ACL check (order-independent)
  v_profile_baseline := has_table_privilege('postgres','public.profiles','UPDATE')
    AND has_table_privilege('anon','public.profiles','UPDATE')
    AND has_table_privilege('authenticated','public.profiles','UPDATE')
    AND has_table_privilege('service_role','public.profiles','UPDATE')
    AND NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = 'public.profiles'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
    );
  SELECT c.relacl::text INTO v_profile_acl FROM pg_class c WHERE c.oid = 'public.profiles'::regclass;
  v_profile_contained := v_profile_acl = v_contained_profile_acl
    AND (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid = 'public.profiles'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL) = 2
    AND (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid = 'public.profiles'::regclass AND a.attname IN ('display_name','phone')
           AND a.attacl::text = '{authenticated=w/postgres}') = 2;
  IF NOT (v_profile_baseline OR v_profile_contained) THEN
    RAISE EXCEPTION 'Profile table or column ACL drifted';
  END IF;

  SELECT count(*) INTO v_function_count
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('_contain_purchase_payment_tenant','_contain_purchase_return_header','_contain_purchase_return_item','_reconcile_return_header_total');
  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger t
  WHERE NOT t.tgisinternal
    AND t.tgname IN ('contain_purchase_payment_tenant','contain_purchase_return_header','contain_purchase_return_item','reconcile_return_header_total_on_item_insert');

  v_objects_baseline := v_function_count = 0 AND v_trigger_count = 0;
  v_objects_contained := v_function_count = 4 AND v_trigger_count = 4;

  IF v_objects_contained THEN
    FOR v_expected IN SELECT * FROM (VALUES
      ('_contain_purchase_payment_tenant','contain_purchase_payment_tenant','purchase_payments',v_payment_body_hash),
      ('_contain_purchase_return_header','contain_purchase_return_header','purchase_returns',v_return_header_body_hash),
      ('_contain_purchase_return_item','contain_purchase_return_item','purchase_return_items',v_return_item_body_hash)
    ) AS x(function_name, trigger_name, table_name, body_hash)
    LOOP
      SELECT p.* INTO v_proc
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_expected.function_name;
      IF NOT FOUND
         OR v_proc.pronargs <> 0
         OR v_proc.proowner <> 'postgres'::regrole
         OR v_proc.prolang <> (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
         OR v_proc.prorettype <> 'trigger'::regtype
         OR NOT v_proc.prosecdef
         OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
         OR v_proc.provolatile <> 'v'
         OR v_proc.proparallel <> 'u'
         OR v_proc.procost <> 100
         OR v_proc.proleakproof <> false
         OR v_proc.proisstrict <> false
         OR md5(v_proc.prosrc) <> v_expected.body_hash
         OR v_proc.proacl::text <> '{postgres=X/postgres}' THEN
        RAISE EXCEPTION 'Containment function definition, metadata or ACL drifted: %', v_expected.function_name;
      END IF;

      SELECT t.* INTO v_trigger
      FROM pg_trigger t
      WHERE NOT t.tgisinternal AND t.tgname = v_expected.trigger_name;
      -- Verify the full trigger definition including WHEN clause (must be absent)
      v_full_trigger_def := pg_get_triggerdef(v_trigger.oid);
      IF NOT FOUND
         OR v_trigger.tgrelid <> format('public.%I',v_expected.table_name)::regclass
         OR v_trigger.tgfoid <> format('public.%I()',v_expected.function_name)::regprocedure
         OR v_trigger.tgtype <> 23
         OR v_trigger.tgenabled <> 'O'
         OR v_trigger.tgnargs <> 0
         OR v_trigger.tgqual IS NOT NULL
         OR v_full_trigger_def NOT LIKE 'CREATE TRIGGER ' || v_expected.trigger_name || ' BEFORE INSERT OR UPDATE ON public.' || v_expected.table_name || ' FOR EACH ROW EXECUTE FUNCTION _' || v_expected.trigger_name || '()' THEN
        RAISE EXCEPTION 'Containment trigger definition drifted: %', v_expected.trigger_name;
      END IF;
    END LOOP;
  END IF;

  IF NOT (v_objects_baseline OR v_objects_contained) THEN
    RAISE EXCEPTION 'Containment functions/triggers are absent, partial, overloaded or mixed';
  END IF;

  IF v_objects_baseline THEN
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) <> 89
       OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal) <> 21
       OR v_rpc_baseline <> 41 OR NOT v_profile_baseline THEN
      RAISE EXCEPTION 'Database is not the exact approved pre-containment baseline';
    END IF;
  ELSE
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) <> 93
       OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal) <> 25
       OR v_rpc_contained <> 41 OR NOT v_profile_contained THEN
      RAISE EXCEPTION 'Database is not the exact state created by this containment migration';
    END IF;
  END IF;
END;
$p0_preflight$;

-- Reports and ledger RPCs remain available only through the service-role server boundary.
REVOKE EXECUTE ON FUNCTION public.account_ledger(text,text,date,date),public.day_book(text,date,date,text),public.negative_stock_report(text),public.pending_stock_report(text),public.report_balance_sheet(text,date),public.report_cash_flow(text,date,date),public.report_customer_outstanding(text),public.report_expense_summary(text,date,date),public.report_inventory_valuation(text),public.report_profit_loss(text,date,date),public.report_sales_summary(text,date,date),public.report_vendor_outstanding(text),public.rider_dashboard_summary(text,text),public.rider_ledger(text,text,date,date),public.trial_balance(text,date,date),public.vendor_ledger(text,text,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_ledger(text,text,date,date),public.day_book(text,date,date,text),public.negative_stock_report(text),public.pending_stock_report(text),public.report_balance_sheet(text,date),public.report_cash_flow(text,date,date),public.report_customer_outstanding(text),public.report_expense_summary(text,date,date),public.report_inventory_valuation(text),public.report_profit_loss(text,date,date),public.report_sales_summary(text,date,date),public.report_vendor_outstanding(text),public.rider_dashboard_summary(text,text),public.rider_ledger(text,text,date,date),public.trial_balance(text,date,date),public.vendor_ledger(text,text,date,date) TO service_role;

-- Privileged mutations remain available only through the service-role server boundary.
REVOKE EXECUTE ON FUNCTION public.assign_rider_to_order(text,text,text,uuid),public.cancel_voucher(text,uuid,text),public.confirm_cod_submission(text,text,numeric,text,numeric,text,uuid),public.create_cod_submission(text,text,jsonb,text,numeric,text,uuid),public.create_stock_movement(text,text,text,integer,text,date,uuid,numeric),public.mark_order_delivered(text,text,numeric,text,text,uuid),public.mark_order_returned(text,text,text,uuid),public.post_advance_application(text,text,text,numeric,date,text,uuid),public.post_contra_entry(text,date,text,text,numeric,text,text,uuid),public.post_expense_batch(text,date,text,jsonb,text,text,uuid),public.post_journal_voucher(text,date,text,jsonb,text,uuid),public.post_payment_voucher(text,date,text,text,numeric,text,text,text,uuid),public.post_purchase(text,text,date,text,jsonb,jsonb,numeric,numeric,text,uuid),public.post_purchase_replacement(text,text,jsonb,date,text,uuid),public.post_purchase_return(text,text,jsonb,text,text,date,text,uuid),public.post_receipt_voucher(text,date,text,text,numeric,text,text,text,uuid),public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid),public.post_sales_return(text,text,date,text,uuid),public.post_vendor_advance(text,text,text,numeric,date,text,uuid),public.post_vendor_payment(text,text,text,numeric,date,text,text,uuid),public.post_voucher(text,text,date,text,jsonb,text,text,uuid),public.recalculate_product_cost(text),public.reject_cod_submission(text,text,uuid,text),public.reverse_voucher_safe(text,text,uuid,text),public.update_delivery_status(text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_rider_to_order(text,text,text,uuid),public.cancel_voucher(text,uuid,text),public.confirm_cod_submission(text,text,numeric,text,numeric,text,uuid),public.create_cod_submission(text,text,jsonb,text,numeric,text,uuid),public.create_stock_movement(text,text,text,integer,text,date,uuid,numeric),public.mark_order_delivered(text,text,numeric,text,text,uuid),public.mark_order_returned(text,text,text,uuid),public.post_advance_application(text,text,text,numeric,date,text,uuid),public.post_contra_entry(text,date,text,text,numeric,text,text,uuid),public.post_expense_batch(text,date,text,jsonb,text,text,uuid),public.post_journal_voucher(text,date,text,jsonb,text,uuid),public.post_payment_voucher(text,date,text,text,numeric,text,text,text,uuid),public.post_purchase(text,text,date,text,jsonb,jsonb,numeric,numeric,text,uuid),public.post_purchase_replacement(text,text,jsonb,date,text,uuid),public.post_purchase_return(text,text,jsonb,text,text,date,text,uuid),public.post_receipt_voucher(text,date,text,text,numeric,text,text,text,uuid),public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid),public.post_sales_return(text,text,date,text,uuid),public.post_vendor_advance(text,text,text,numeric,date,text,uuid),public.post_vendor_payment(text,text,text,numeric,date,text,text,uuid),public.post_voucher(text,text,date,text,jsonb,text,text,uuid),public.recalculate_product_cost(text),public.reject_cod_submission(text,text,uuid,text),public.reverse_voucher_safe(text,text,uuid,text),public.update_delivery_status(text,text,text,text,uuid) TO service_role;

-- Profile notes: only display_name and phone are deliberately mutable by authenticated users.
-- Revoke table-level UPDATE from anon/authenticated; grant only column-level UPDATE on display_name and phone to authenticated.
REVOKE UPDATE ON TABLE public.profiles FROM anon, authenticated;
GRANT UPDATE (display_name, phone) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public._contain_purchase_payment_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_purchase public.purchases%ROWTYPE;
  v_existing_initial numeric(20,0);
  v_existing_total numeric(20,0);
  v_is_notes_only boolean;
BEGIN
  -- Determine if this is a notes-only UPDATE (only the notes column changed)
  v_is_notes_only := TG_OP = 'UPDATE'
    AND OLD.id IS NOT DISTINCT FROM NEW.id
    AND OLD.business_id IS NOT DISTINCT FROM NEW.business_id
    AND OLD.purchase_id IS NOT DISTINCT FROM NEW.purchase_id
    AND OLD.vendor_id IS NOT DISTINCT FROM NEW.vendor_id
    AND OLD.account_id IS NOT DISTINCT FROM NEW.account_id
    AND OLD.amount IS NOT DISTINCT FROM NEW.amount
    AND OLD.payment_date IS NOT DISTINCT FROM NEW.payment_date
    AND OLD.payment_type IS NOT DISTINCT FROM NEW.payment_type
    AND OLD.voucher_id IS NOT DISTINCT FROM NEW.voucher_id
    AND OLD.created_by IS NOT DISTINCT FROM NEW.created_by
    AND OLD.created_at IS NOT DISTINCT FROM NEW.created_at;

  IF TG_OP = 'UPDATE' AND NOT v_is_notes_only THEN
    RAISE EXCEPTION 'Purchase payment posting fields are immutable; only notes may change';
  END IF;
  -- For notes-only UPDATE, skip revalidation of posting fields against current outstanding
  IF v_is_notes_only THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_type IS NULL OR NEW.payment_type NOT IN (
    'purchase_payment', 'later_payment', 'vendor_advance', 'advance_application'
  ) THEN
    RAISE EXCEPTION 'Unknown purchase payment type';
  END IF;
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Purchase payment amount must be positive';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = NEW.vendor_id AND v.business_id = NEW.business_id AND v.is_active
  ) THEN
    RAISE EXCEPTION 'Purchase payment vendor is invalid, inactive or cross-business';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.id = NEW.account_id AND a.business_id = NEW.business_id AND a.is_active
  ) THEN
    RAISE EXCEPTION 'Purchase payment account is invalid, inactive or cross-business';
  END IF;

  IF NEW.payment_type = 'vendor_advance' THEN
    IF NEW.purchase_id IS NOT NULL THEN
      RAISE EXCEPTION 'Vendor advance must not reference a purchase';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.purchase_id IS NULL THEN
    RAISE EXCEPTION 'Only vendor_advance may omit purchase_id';
  END IF;

  SELECT * INTO v_purchase
  FROM public.purchases
  WHERE id = NEW.purchase_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked purchase not found';
  END IF;
  IF v_purchase.business_id IS DISTINCT FROM NEW.business_id
     OR v_purchase.vendor_id IS DISTINCT FROM NEW.vendor_id THEN
    RAISE EXCEPTION 'Purchase payment tenant/vendor mismatch';
  END IF;

  IF NEW.payment_type = 'purchase_payment' THEN
    SELECT coalesce(sum(pp.amount),0)::numeric(20,0) INTO v_existing_initial
    FROM public.purchase_payments pp
    WHERE pp.purchase_id = NEW.purchase_id
      AND pp.payment_type = 'purchase_payment'
      AND pp.id IS DISTINCT FROM NEW.id;
    IF v_existing_initial + NEW.amount > v_purchase.paid_amount
       OR v_existing_initial + NEW.amount > v_purchase.total THEN
      RAISE EXCEPTION 'Initial purchase payments exceed the locked purchase totals';
    END IF;
  ELSE
    -- Aggregate all purchase-linked payment types (later_payment, advance_application) for cumulative outstanding check
    SELECT coalesce(sum(pp.amount),0)::numeric(20,0) INTO v_existing_total
    FROM public.purchase_payments pp
    WHERE pp.purchase_id = NEW.purchase_id
      AND pp.payment_type IN ('later_payment', 'advance_application')
      AND pp.id IS DISTINCT FROM NEW.id;
    IF NEW.amount > v_purchase.outstanding_amount - v_existing_total THEN
      RAISE EXCEPTION 'Purchase-linked settlement exceeds available outstanding amount after accounting for existing linked payments';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._contain_purchase_payment_tenant() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS contain_purchase_payment_tenant ON public.purchase_payments;
CREATE TRIGGER contain_purchase_payment_tenant
BEFORE INSERT OR UPDATE ON public.purchase_payments
FOR EACH ROW EXECUTE FUNCTION public._contain_purchase_payment_tenant();

CREATE OR REPLACE FUNCTION public._contain_purchase_return_header()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_purchase public.purchases%ROWTYPE;
  v_is_notes_only boolean;
  v_item_total numeric(20,0);
BEGIN
  v_is_notes_only := TG_OP = 'UPDATE'
    AND OLD.id IS NOT DISTINCT FROM NEW.id
    AND OLD.business_id IS NOT DISTINCT FROM NEW.business_id
    AND OLD.purchase_id IS NOT DISTINCT FROM NEW.purchase_id
    AND OLD.vendor_id IS NOT DISTINCT FROM NEW.vendor_id
    AND OLD.return_no IS NOT DISTINCT FROM NEW.return_no
    AND OLD.return_date IS NOT DISTINCT FROM NEW.return_date
    AND OLD.total_amount IS NOT DISTINCT FROM NEW.total_amount
    AND OLD.settlement_type IS NOT DISTINCT FROM NEW.settlement_type
    AND OLD.settlement_account_id IS NOT DISTINCT FROM NEW.settlement_account_id
    AND OLD.voucher_id IS NOT DISTINCT FROM NEW.voucher_id
    AND OLD.created_by IS NOT DISTINCT FROM NEW.created_by
    AND OLD.created_at IS NOT DISTINCT FROM NEW.created_at;

  IF TG_OP = 'UPDATE' AND NOT v_is_notes_only THEN
    RAISE EXCEPTION 'Purchase return posting fields are immutable; only notes may change';
  END IF;
  -- For notes-only UPDATE, skip revalidation
  IF v_is_notes_only THEN
    RETURN NEW;
  END IF;

  IF NEW.total_amount IS NULL OR NEW.total_amount <= 0 THEN
    RAISE EXCEPTION 'Purchase return total must be positive';
  END IF;
  IF NEW.settlement_type IS NULL OR NEW.settlement_type NOT IN (
    'reduce_payable', 'vendor_refund', 'vendor_credit'
  ) THEN
    RAISE EXCEPTION 'Unknown purchase return settlement type';
  END IF;

  SELECT * INTO v_purchase
  FROM public.purchases
  WHERE id = NEW.purchase_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase return source purchase not found';
  END IF;
  IF v_purchase.business_id IS DISTINCT FROM NEW.business_id
     OR v_purchase.vendor_id IS DISTINCT FROM NEW.vendor_id THEN
    RAISE EXCEPTION 'Purchase return tenant/vendor mismatch';
  END IF;
  -- Allow historical returns against an inactive vendor provided the tenant/vendor linkage is valid
  IF NOT EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = NEW.vendor_id AND v.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'Purchase return vendor is invalid or cross-business';
  END IF;

  IF NEW.settlement_type = 'vendor_refund' THEN
    IF NEW.settlement_account_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = NEW.settlement_account_id AND a.business_id = NEW.business_id AND a.is_active
    ) THEN
      RAISE EXCEPTION 'Vendor refund requires an active same-business settlement account';
    END IF;
  ELSIF NEW.settlement_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'reduce_payable and vendor_credit must not supply a settlement account';
  END IF;

  -- Reconcile header total against persisted items (allow for postgres numeric precision)
  -- This is a DEFERRED check to accommodate RPC ordering (header may be inserted before items).
  -- The check is performed here as an immediate guard for direct INSERT/UPDATE, and the deferred
  -- constraint trigger re-evaluates at COMMIT.
  IF TG_OP = 'INSERT' THEN
    -- For INSERT, items may not yet exist; rely on the deferred constraint.
    NULL;
  ELSE
    SELECT coalesce(sum(pri.line_total),0)::numeric(20,0) INTO v_item_total
    FROM public.purchase_return_items pri
    WHERE pri.purchase_return_id = NEW.id;
    IF NEW.total_amount IS DISTINCT FROM v_item_total AND v_item_total > 0 THEN
      RAISE EXCEPTION 'Purchase return header total does not match sum of items';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._contain_purchase_return_header() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS contain_purchase_return_header ON public.purchase_returns;
CREATE TRIGGER contain_purchase_return_header
BEFORE INSERT OR UPDATE ON public.purchase_returns
FOR EACH ROW EXECUTE FUNCTION public._contain_purchase_return_header();

CREATE OR REPLACE FUNCTION public._contain_purchase_return_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_header public.purchase_returns%ROWTYPE;
  v_purchase public.purchases%ROWTYPE;
  v_source public.purchase_items%ROWTYPE;
  v_persisted_returned integer;
  v_already_returned integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Posted purchase return items are immutable';
  END IF;
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'Purchase return quantity must be positive';
  END IF;

  SELECT * INTO v_header
  FROM public.purchase_returns
  WHERE id = NEW.purchase_return_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase return header not found';
  END IF;

  SELECT * INTO v_purchase
  FROM public.purchases
  WHERE id = v_header.purchase_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_purchase.business_id IS DISTINCT FROM v_header.business_id
     OR v_purchase.vendor_id IS DISTINCT FROM v_header.vendor_id THEN
    RAISE EXCEPTION 'Purchase return header no longer matches its purchase';
  END IF;

  SELECT * INTO v_source
  FROM public.purchase_items
  WHERE id = NEW.purchase_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source purchase item not found';
  END IF;
  IF NEW.business_id IS DISTINCT FROM v_header.business_id
     OR v_source.business_id IS DISTINCT FROM v_header.business_id
     OR v_source.purchase_id IS DISTINCT FROM v_header.purchase_id THEN
    RAISE EXCEPTION 'Purchase return item tenant/purchase mismatch';
  END IF;
  IF NEW.product_id IS DISTINCT FROM v_source.product_id
     OR NEW.product_name IS DISTINCT FROM v_source.product_name THEN
    RAISE EXCEPTION 'Purchase return product differs from immutable source item';
  END IF;
  IF NEW.unit_cost IS DISTINCT FROM v_source.unit_cost THEN
    RAISE EXCEPTION 'Purchase return unit cost differs from immutable source item';
  END IF;
  IF NEW.line_total IS DISTINCT FROM (NEW.unit_cost * NEW.quantity)::numeric(20,0) THEN
    RAISE EXCEPTION 'Purchase return line total is invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.purchase_return_items pri
    WHERE pri.purchase_return_id = NEW.purchase_return_id
      AND pri.purchase_item_id = NEW.purchase_item_id
  ) THEN
    RAISE EXCEPTION 'Duplicate source item in purchase return';
  END IF;

  SELECT coalesce(sum(pri.quantity),0)::integer INTO v_persisted_returned
  FROM public.purchase_return_items pri
  JOIN public.purchase_returns pr ON pr.id = pri.purchase_return_id
  WHERE pri.purchase_item_id = NEW.purchase_item_id
    AND pr.purchase_id = v_source.purchase_id;
  v_already_returned := greatest(coalesce(v_source.returned_quantity,0), v_persisted_returned);
  IF v_already_returned + NEW.quantity > v_source.quantity THEN
    RAISE EXCEPTION 'Purchase return quantity exceeds source quantity';
  END IF;

  -- Validate line_total for the individual item
  IF NEW.line_total <= 0 THEN
    RAISE EXCEPTION 'Purchase return line total must be positive';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._contain_purchase_return_item() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS contain_purchase_return_item ON public.purchase_return_items;
CREATE TRIGGER contain_purchase_return_item
BEFORE INSERT OR UPDATE ON public.purchase_return_items
FOR EACH ROW EXECUTE FUNCTION public._contain_purchase_return_item();

-- Deferred constraint to reconcile return header total against items at COMMIT time
-- This allows the normal RPC ordering (header inserted before items) to proceed
CREATE OR REPLACE FUNCTION public._reconcile_return_header_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_item_total numeric(20,0);
BEGIN
  SELECT coalesce(sum(pri.line_total),0)::numeric(20,0) INTO v_item_total
  FROM public.purchase_return_items pri
  WHERE pri.purchase_return_id = COALESCE(NEW.id, OLD.id);
  IF v_item_total IS DISTINCT FROM (SELECT total_amount FROM public.purchase_returns WHERE id = COALESCE(NEW.id, OLD.id)) THEN
    RAISE EXCEPTION 'Purchase return header total does not match sum of items at commit';
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._reconcile_return_header_total() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS reconcile_return_header_total_on_item_insert ON public.purchase_return_items;
CREATE CONSTRAINT TRIGGER reconcile_return_header_total_on_item_insert
AFTER INSERT OR UPDATE OR DELETE ON public.purchase_return_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public._reconcile_return_header_total();

-- Fail the transaction if the intended contained privilege and object state was not reached.
DO $p0_postflight$
DECLARE
  v_signature text;
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace) <> 93
     OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal) <> 25
     OR (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='public'::regnamespace) <> 54 THEN
    RAISE EXCEPTION 'P0 containment postflight object inventory mismatch';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a
      WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL) <> 2
     OR (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid='public.profiles'::regclass AND a.attname IN ('display_name','phone')
           AND a.attacl::text='{authenticated=w/postgres}') <> 2 THEN
    RAISE EXCEPTION 'P0 containment postflight profile privilege mismatch';
  END IF;
  FOR v_signature IN SELECT unnest(ARRAY[
    'public.report_profit_loss(text,date,date)',
    'public.report_balance_sheet(text,date)',
    'public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid)',
    'public.post_vendor_payment(text,text,text,numeric,date,text,text,uuid)',
    'public.post_purchase_return(text,text,jsonb,text,text,date,text,uuid)',
    'public.post_voucher(text,text,date,text,jsonb,text,text,uuid)'
  ]) LOOP
    IF has_function_privilege('anon',v_signature,'EXECUTE')
       OR has_function_privilege('authenticated',v_signature,'EXECUTE')
       OR NOT has_function_privilege('service_role',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'P0 containment postflight RPC privilege mismatch: %', v_signature;
    END IF;
  END LOOP;
END;
$p0_postflight$;

COMMIT;