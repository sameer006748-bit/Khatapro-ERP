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
  v_payment_body_hash constant text := '614fcb75eecb4009c422f02e8e7a38c2';
  v_return_header_body_hash constant text := '0da9ea634b69a028a61ee634c8b165c7';
  v_return_item_body_hash constant text := '823587d7da2949e2a0d6aa9e48175bf4';
  v_baseline_rpc_acl constant text := '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}';
  v_contained_rpc_acl constant text := '{postgres=X/postgres,service_role=X/postgres}';
  v_baseline_profile_acl constant text := '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}';
  v_contained_profile_acl constant text := '{postgres=arwdDxtm/postgres,anon=ardDxtm/postgres,authenticated=ardDxtm/postgres,service_role=arwdDxtm/postgres}';
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
    SELECT p.proacl::text, p.proowner = 'postgres'::regrole
      INTO v_profile_acl, v_profile_baseline
    FROM pg_proc p WHERE p.oid = to_regprocedure(v_signature);
    IF NOT v_profile_baseline THEN
      RAISE EXCEPTION 'Target RPC owner drifted: %', v_signature;
    ELSIF v_profile_acl = v_baseline_rpc_acl THEN
      v_rpc_baseline := v_rpc_baseline + 1;
    ELSIF v_profile_acl = v_contained_rpc_acl THEN
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
    AND p.proname NOT IN ('_contain_purchase_payment_tenant','_contain_purchase_return_header','_contain_purchase_return_item');
  IF v_definition_fingerprint <> 'c6e5c1a2f347475c8da90c3ec1009f95' THEN
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
  IF v_other_table_acl_fingerprint <> 'eaccbab6c9a8d2df5bb66831ce7074f8' THEN
    RAISE EXCEPTION 'Non-profile public table ACL fingerprint drifted';
  END IF;

  SELECT c.relacl::text INTO v_profile_acl FROM pg_class c WHERE c.oid = 'public.profiles'::regclass;
  v_profile_baseline := v_profile_acl = v_baseline_profile_acl
    AND NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = 'public.profiles'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
    );
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
    AND p.proname IN ('_contain_purchase_payment_tenant','_contain_purchase_return_header','_contain_purchase_return_item');
  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger t
  WHERE NOT t.tgisinternal
    AND t.tgname IN ('contain_purchase_payment_tenant','contain_purchase_return_header','contain_purchase_return_item');

  v_objects_baseline := v_function_count = 0 AND v_trigger_count = 0;
  v_objects_contained := v_function_count = 3 AND v_trigger_count = 3;

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
         OR md5(v_proc.prosrc) <> v_expected.body_hash
         OR v_proc.proacl::text <> '{postgres=X/postgres}' THEN
        RAISE EXCEPTION 'Containment function definition, metadata or ACL drifted: %', v_expected.function_name;
      END IF;

      SELECT t.* INTO v_trigger
      FROM pg_trigger t
      WHERE NOT t.tgisinternal AND t.tgname = v_expected.trigger_name;
      IF NOT FOUND
         OR v_trigger.tgrelid <> format('public.%I',v_expected.table_name)::regclass
         OR v_trigger.tgfoid <> format('public.%I()',v_expected.function_name)::regprocedure
         OR v_trigger.tgtype <> 23
         OR v_trigger.tgenabled <> 'O'
         OR v_trigger.tgnargs <> 0 THEN
        RAISE EXCEPTION 'Containment trigger definition drifted: %', v_expected.trigger_name;
      END IF;
    END LOOP;
  END IF;

  IF NOT (v_objects_baseline OR v_objects_contained) THEN
    RAISE EXCEPTION 'Containment functions/triggers are absent, partial, overloaded or mixed';
  END IF;

  IF v_objects_baseline THEN
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) <> 53
       OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal) <> 21
       OR v_rpc_baseline <> 41 OR NOT v_profile_baseline THEN
      RAISE EXCEPTION 'Database is not the exact approved pre-containment baseline';
    END IF;
  ELSE
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) <> 56
       OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal) <> 24
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
REVOKE UPDATE ON TABLE public.profiles FROM anon, authenticated;
REVOKE UPDATE (id, user_id, business_id, role_id, display_name, phone, is_active, created_at, updated_at)
  ON public.profiles FROM anon, authenticated;
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
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.purchase_id IS DISTINCT FROM OLD.purchase_id
       OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
       OR NEW.account_id IS DISTINCT FROM OLD.account_id
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
       OR NEW.payment_type IS DISTINCT FROM OLD.payment_type
       OR NEW.voucher_id IS DISTINCT FROM OLD.voucher_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
     ) THEN
    RAISE EXCEPTION 'Purchase payment posting fields are immutable; only notes may change';
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
  ELSIF NEW.amount > v_purchase.outstanding_amount THEN
    RAISE EXCEPTION 'Purchase-linked settlement exceeds locked outstanding amount';
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
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.purchase_id IS DISTINCT FROM OLD.purchase_id
       OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
       OR NEW.return_no IS DISTINCT FROM OLD.return_no
       OR NEW.return_date IS DISTINCT FROM OLD.return_date
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.settlement_type IS DISTINCT FROM OLD.settlement_type
       OR NEW.settlement_account_id IS DISTINCT FROM OLD.settlement_account_id
       OR NEW.voucher_id IS DISTINCT FROM OLD.voucher_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
     ) THEN
    RAISE EXCEPTION 'Purchase return posting fields are immutable; only notes may change';
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
  IF NOT EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = NEW.vendor_id AND v.business_id = NEW.business_id AND v.is_active
  ) THEN
    RAISE EXCEPTION 'Purchase return vendor is invalid, inactive or cross-business';
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

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._contain_purchase_return_item() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS contain_purchase_return_item ON public.purchase_return_items;
CREATE TRIGGER contain_purchase_return_item
BEFORE INSERT OR UPDATE ON public.purchase_return_items
FOR EACH ROW EXECUTE FUNCTION public._contain_purchase_return_item();

-- Fail the transaction if the intended contained privilege and object state was not reached.
DO $p0_postflight$
DECLARE
  v_signature text;
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace) <> 56
     OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal) <> 24
     OR (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='public'::regnamespace) <> 54 THEN
    RAISE EXCEPTION 'P0 containment postflight object inventory mismatch';
  END IF;
  IF has_table_privilege('anon','public.profiles','UPDATE')
     OR has_table_privilege('authenticated','public.profiles','UPDATE')
     OR NOT has_column_privilege('authenticated','public.profiles','display_name','UPDATE')
     OR NOT has_column_privilege('authenticated','public.profiles','phone','UPDATE')
     OR has_column_privilege('authenticated','public.profiles','role_id','UPDATE')
     OR NOT has_table_privilege('service_role','public.profiles','UPDATE') THEN
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
