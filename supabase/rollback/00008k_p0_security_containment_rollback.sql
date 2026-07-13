-- Roll back only the exact state produced by 00008k_p0_security_containment.sql.
-- This intentionally restores the captured pre-containment privileges.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $p0_rollback_preflight$
DECLARE
  v_signature text;
  v_expected record;
  v_proc record;
  v_trigger record;
  v_definition_fingerprint text;
  v_policy_fingerprint text;
  v_other_table_acl_fingerprint text;
  v_profile_acl text;
  v_payment_body_hash constant text := '614fcb75eecb4009c422f02e8e7a38c2';
  v_return_header_body_hash constant text := '0da9ea634b69a028a61ee634c8b165c7';
  v_return_item_body_hash constant text := '823587d7da2949e2a0d6aa9e48175bf4';
  v_contained_rpc_acl constant text := '{postgres=X/postgres,service_role=X/postgres}';
  v_contained_profile_acl constant text := '{postgres=arwdDxtm/postgres,anon=ardDxtm/postgres,authenticated=ardDxtm/postgres,service_role=arwdDxtm/postgres}';
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'P0 rollback must be owned and applied by postgres, not %', current_user;
  END IF;

  IF to_regclass('public.receipt_allocations') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('invoices','receipts') AND column_name = 'idempotency_key'
     )
     OR EXISTS (
       SELECT 1 FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN (
           '_block_receipt_allocation_update','_block_receipt_allocation_delete',
           '_post_salesman_collection_commission','_require_posting_auth'
         )
     ) THEN
    RAISE EXCEPTION 'P0 rollback requires migration 00009 to remain unapplied';
  END IF;

  IF (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p')) <> 39
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace) <> 56
     OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal) <> 24
     OR (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='public'::regnamespace) <> 54 THEN
    RAISE EXCEPTION 'Rollback refused: public object inventory is not the exact contained state';
  END IF;

  SELECT md5(string_agg(
           p.oid::regprocedure::text || chr(31) || r.rolname || chr(31) || p.prosecdef::text || chr(31) ||
           l.lanname || chr(31) || coalesce(array_to_string(p.proconfig, ','), '<null>') || chr(31) || pg_get_functiondef(p.oid),
           chr(30) ORDER BY p.oid::regprocedure::text))
    INTO v_definition_fingerprint
  FROM pg_proc p
  JOIN pg_roles r ON r.oid=p.proowner
  JOIN pg_language l ON l.oid=p.prolang
  WHERE p.pronamespace='public'::regnamespace
    AND p.proname NOT IN ('_contain_purchase_payment_tenant','_contain_purchase_return_header','_contain_purchase_return_item');
  IF v_definition_fingerprint <> 'c6e5c1a2f347475c8da90c3ec1009f95' THEN
    RAISE EXCEPTION 'Rollback refused: pre-00009 function definition/signature fingerprint drifted';
  END IF;

  SELECT md5(string_agg(
           c.relname::text || chr(31) || p.polname::text || chr(31) || p.polpermissive::text || chr(31) ||
           p.polcmd::text || chr(31) || array_to_string(p.polroles, ',') || chr(31) ||
           coalesce(pg_get_expr(p.polqual,p.polrelid), '<null>') || chr(31) ||
           coalesce(pg_get_expr(p.polwithcheck,p.polrelid), '<null>'),
           chr(30) ORDER BY c.relname::text,p.polname::text))
    INTO v_policy_fingerprint
  FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
  WHERE c.relnamespace='public'::regnamespace;
  IF v_policy_fingerprint <> '280321e95c723186da6026315ad43596' THEN
    RAISE EXCEPTION 'Rollback refused: public policy fingerprint drifted';
  END IF;

  SELECT md5(string_agg(c.relname::text || chr(31) || coalesce(c.relacl::text,'<null>'), chr(30) ORDER BY c.relname::text))
    INTO v_other_table_acl_fingerprint
  FROM pg_class c
  WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND c.relname <> 'profiles';
  IF v_other_table_acl_fingerprint <> 'eaccbab6c9a8d2df5bb66831ce7074f8' THEN
    RAISE EXCEPTION 'Rollback refused: non-profile public table ACL fingerprint drifted';
  END IF;

  SELECT c.relacl::text INTO v_profile_acl FROM pg_class c WHERE c.oid='public.profiles'::regclass;
  IF v_profile_acl <> v_contained_profile_acl
     OR (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL) <> 2
     OR (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid='public.profiles'::regclass AND a.attname IN ('display_name','phone')
           AND a.attacl::text='{authenticated=w/postgres}') <> 2 THEN
    RAISE EXCEPTION 'Rollback refused: contained profile table or column ACL drifted';
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
    IF to_regprocedure(v_signature) IS NULL
       OR (SELECT p.proowner <> 'postgres'::regrole OR p.proacl::text <> v_contained_rpc_acl
           FROM pg_proc p WHERE p.oid=to_regprocedure(v_signature)) THEN
      RAISE EXCEPTION 'Rollback refused: contained target RPC ACL/owner drifted: %', v_signature;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
      AND p.proname IN ('_contain_purchase_payment_tenant','_contain_purchase_return_header','_contain_purchase_return_item')) <> 3
     OR (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal
      AND t.tgname IN ('contain_purchase_payment_tenant','contain_purchase_return_header','contain_purchase_return_item')) <> 3 THEN
    RAISE EXCEPTION 'Rollback refused: containment objects are missing, overloaded, partial or duplicated';
  END IF;

  FOR v_expected IN SELECT * FROM (VALUES
    ('_contain_purchase_payment_tenant','contain_purchase_payment_tenant','purchase_payments',v_payment_body_hash),
    ('_contain_purchase_return_header','contain_purchase_return_header','purchase_returns',v_return_header_body_hash),
    ('_contain_purchase_return_item','contain_purchase_return_item','purchase_return_items',v_return_item_body_hash)
  ) AS x(function_name, trigger_name, table_name, body_hash)
  LOOP
    SELECT p.* INTO v_proc FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace AND p.proname=v_expected.function_name;
    IF NOT FOUND
       OR v_proc.pronargs <> 0
       OR v_proc.proowner <> 'postgres'::regrole
       OR v_proc.prolang <> (SELECT oid FROM pg_language WHERE lanname='plpgsql')
       OR v_proc.prorettype <> 'trigger'::regtype
       OR NOT v_proc.prosecdef
       OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
       OR md5(v_proc.prosrc) <> v_expected.body_hash
       OR v_proc.proacl::text <> '{postgres=X/postgres}' THEN
      RAISE EXCEPTION 'Rollback refused: containment function drifted: %', v_expected.function_name;
    END IF;

    SELECT t.* INTO v_trigger FROM pg_trigger t
    WHERE NOT t.tgisinternal AND t.tgname=v_expected.trigger_name;
    IF NOT FOUND
       OR v_trigger.tgrelid <> format('public.%I',v_expected.table_name)::regclass
       OR v_trigger.tgfoid <> format('public.%I()',v_expected.function_name)::regprocedure
       OR v_trigger.tgtype <> 23
       OR v_trigger.tgenabled <> 'O'
       OR v_trigger.tgnargs <> 0 THEN
      RAISE EXCEPTION 'Rollback refused: containment trigger drifted: %', v_expected.trigger_name;
    END IF;
  END LOOP;
END;
$p0_rollback_preflight$;

DROP TRIGGER contain_purchase_payment_tenant ON public.purchase_payments;
DROP FUNCTION public._contain_purchase_payment_tenant();
DROP TRIGGER contain_purchase_return_header ON public.purchase_returns;
DROP FUNCTION public._contain_purchase_return_header();
DROP TRIGGER contain_purchase_return_item ON public.purchase_return_items;
DROP FUNCTION public._contain_purchase_return_item();

-- Clear and rebuild only these exact ACLs to reproduce the captured raw item order.
REVOKE ALL ON FUNCTION public.account_ledger(text,text,date,date),public.day_book(text,date,date,text),public.negative_stock_report(text),public.pending_stock_report(text),public.report_balance_sheet(text,date),public.report_cash_flow(text,date,date),public.report_customer_outstanding(text),public.report_expense_summary(text,date,date),public.report_inventory_valuation(text),public.report_profit_loss(text,date,date),public.report_sales_summary(text,date,date),public.report_vendor_outstanding(text),public.rider_dashboard_summary(text,text),public.rider_ledger(text,text,date,date),public.trial_balance(text,date,date),public.vendor_ledger(text,text,date,date) FROM PUBLIC, postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_ledger(text,text,date,date),public.day_book(text,date,date,text),public.negative_stock_report(text),public.pending_stock_report(text),public.report_balance_sheet(text,date),public.report_cash_flow(text,date,date),public.report_customer_outstanding(text),public.report_expense_summary(text,date,date),public.report_inventory_valuation(text),public.report_profit_loss(text,date,date),public.report_sales_summary(text,date,date),public.report_vendor_outstanding(text),public.rider_dashboard_summary(text,text),public.rider_ledger(text,text,date,date),public.trial_balance(text,date,date),public.vendor_ledger(text,text,date,date) TO PUBLIC, postgres, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.assign_rider_to_order(text,text,text,uuid),public.cancel_voucher(text,uuid,text),public.confirm_cod_submission(text,text,numeric,text,numeric,text,uuid),public.create_cod_submission(text,text,jsonb,text,numeric,text,uuid),public.create_stock_movement(text,text,text,integer,text,date,uuid,numeric),public.mark_order_delivered(text,text,numeric,text,text,uuid),public.mark_order_returned(text,text,text,uuid),public.post_advance_application(text,text,text,numeric,date,text,uuid),public.post_contra_entry(text,date,text,text,numeric,text,text,uuid),public.post_expense_batch(text,date,text,jsonb,text,text,uuid),public.post_journal_voucher(text,date,text,jsonb,text,uuid),public.post_payment_voucher(text,date,text,text,numeric,text,text,text,uuid),public.post_purchase(text,text,date,text,jsonb,jsonb,numeric,numeric,text,uuid),public.post_purchase_replacement(text,text,jsonb,date,text,uuid),public.post_purchase_return(text,text,jsonb,text,text,date,text,uuid),public.post_receipt_voucher(text,date,text,text,numeric,text,text,text,uuid),public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid),public.post_sales_return(text,text,date,text,uuid),public.post_vendor_advance(text,text,text,numeric,date,text,uuid),public.post_vendor_payment(text,text,text,numeric,date,text,text,uuid),public.post_voucher(text,text,date,text,jsonb,text,text,uuid),public.recalculate_product_cost(text),public.reject_cod_submission(text,text,uuid,text),public.reverse_voucher_safe(text,text,uuid,text),public.update_delivery_status(text,text,text,text,uuid) FROM PUBLIC, postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_rider_to_order(text,text,text,uuid),public.cancel_voucher(text,uuid,text),public.confirm_cod_submission(text,text,numeric,text,numeric,text,uuid),public.create_cod_submission(text,text,jsonb,text,numeric,text,uuid),public.create_stock_movement(text,text,text,integer,text,date,uuid,numeric),public.mark_order_delivered(text,text,numeric,text,text,uuid),public.mark_order_returned(text,text,text,uuid),public.post_advance_application(text,text,text,numeric,date,text,uuid),public.post_contra_entry(text,date,text,text,numeric,text,text,uuid),public.post_expense_batch(text,date,text,jsonb,text,text,uuid),public.post_journal_voucher(text,date,text,jsonb,text,uuid),public.post_payment_voucher(text,date,text,text,numeric,text,text,text,uuid),public.post_purchase(text,text,date,text,jsonb,jsonb,numeric,numeric,text,uuid),public.post_purchase_replacement(text,text,jsonb,date,text,uuid),public.post_purchase_return(text,text,jsonb,text,text,date,text,uuid),public.post_receipt_voucher(text,date,text,text,numeric,text,text,text,uuid),public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid),public.post_sales_return(text,text,date,text,uuid),public.post_vendor_advance(text,text,text,numeric,date,text,uuid),public.post_vendor_payment(text,text,text,numeric,date,text,text,uuid),public.post_voucher(text,text,date,text,jsonb,text,text,uuid),public.recalculate_product_cost(text),public.reject_cod_submission(text,text,uuid,text),public.reverse_voucher_safe(text,text,uuid,text),public.update_delivery_status(text,text,text,text,uuid) TO PUBLIC, postgres, anon, authenticated, service_role;

REVOKE UPDATE (display_name, phone) ON public.profiles FROM authenticated;
GRANT UPDATE ON TABLE public.profiles TO anon, authenticated;

DO $p0_rollback_postflight$
DECLARE
  v_signature text;
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace) <> 53
     OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal) <> 21
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.profiles'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
     OR (SELECT c.relacl::text FROM pg_class c WHERE c.oid='public.profiles'::regclass) <>
        '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}' THEN
    RAISE EXCEPTION 'Rollback postflight failed to restore exact baseline object/profile state';
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
    IF (SELECT p.proacl::text <> '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
        FROM pg_proc p WHERE p.oid=to_regprocedure(v_signature)) THEN
      RAISE EXCEPTION 'Rollback postflight target RPC ACL mismatch: %', v_signature;
    END IF;
  END LOOP;
END;
$p0_rollback_postflight$;

COMMIT;
