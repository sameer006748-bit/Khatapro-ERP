-- P0 emergency security containment.
-- Targets the exact pre-00009 schema and is safe to re-run after a successful apply.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Abort before any privilege or schema change if the production assumptions drifted.
DO $p0_preflight$
DECLARE
  v_signature text;
  v_required text;
  v_role text;
  v_trigger record;
  v_trigger_count integer;
BEGIN
  IF to_regclass('public.receipt_allocations') IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('invoices', 'receipts')
         AND column_name = 'idempotency_key'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN (
           '_block_receipt_allocation_update',
           '_block_receipt_allocation_delete',
           '_post_salesman_collection_commission',
           '_require_posting_auth'
         )
     ) THEN
    RAISE EXCEPTION 'P0 containment requires migration 00009 to remain unapplied';
  END IF;

  IF to_regprocedure('public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid)') IS NULL
     OR (
       SELECT count(*)
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'post_sale'
     ) <> 1 THEN
    RAISE EXCEPTION 'Expected the single pre-00009 13-argument post_sale signature';
  END IF;

  IF to_regprocedure('public.post_receipt_voucher(text,date,text,text,numeric,text,text,text,uuid)') IS NULL
     OR (
       SELECT count(*)
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'post_receipt_voucher'
     ) <> 1 THEN
    RAISE EXCEPTION 'Expected the single pre-00009 9-argument post_receipt_voucher signature';
  END IF;

  FOR v_required IN
    SELECT unnest(ARRAY[
      'profiles.display_name',
      'profiles.phone',
      'purchases.id',
      'purchases.business_id',
      'purchases.vendor_id',
      'purchases.outstanding_amount',
      'purchase_payments.purchase_id',
      'purchase_payments.business_id',
      'purchase_payments.vendor_id',
      'purchase_payments.amount',
      'purchase_payments.payment_type',
      'purchase_returns.id',
      'purchase_returns.business_id',
      'purchase_returns.purchase_id',
      'purchase_returns.settlement_type',
      'purchase_returns.settlement_account_id',
      'purchase_items.id',
      'purchase_items.business_id',
      'purchase_items.purchase_id',
      'purchase_items.product_id',
      'purchase_items.unit_cost',
      'purchase_items.quantity',
      'purchase_items.returned_quantity',
      'purchase_return_items.purchase_return_id',
      'purchase_return_items.purchase_item_id',
      'purchase_return_items.product_id',
      'purchase_return_items.unit_cost',
      'purchase_return_items.quantity',
      'purchase_return_items.business_id',
      'accounts.id',
      'accounts.business_id',
      'accounts.is_active'
    ])
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = split_part(v_required, '.', 1)
        AND column_name = split_part(v_required, '.', 2)
    ) THEN
      RAISE EXCEPTION 'Required pre-containment column is missing: public.%', v_required;
    END IF;
  END LOOP;

  FOR v_role IN SELECT unnest(ARRAY['anon', 'authenticated', 'service_role'])
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      RAISE EXCEPTION 'Required role is missing: %', v_role;
    END IF;
  END LOOP;

  FOR v_signature IN
    SELECT unnest(ARRAY[
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
    ])
  LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'Required target RPC signature is missing: %', v_signature;
    END IF;
  END LOOP;

  FOR v_trigger IN
    SELECT *
    FROM (VALUES
      ('contain_purchase_payment_tenant', 'public.purchase_payments', 'public._contain_purchase_payment_tenant()'),
      ('contain_purchase_return_header', 'public.purchase_returns', 'public._contain_purchase_return_header()'),
      ('contain_purchase_return_item', 'public.purchase_return_items', 'public._contain_purchase_return_item()')
    ) AS expected(trigger_name, table_name, function_signature)
  LOOP
    SELECT count(*)
    INTO v_trigger_count
    FROM pg_trigger t
    WHERE NOT t.tgisinternal AND t.tgname = v_trigger.trigger_name;

    IF v_trigger_count > 0 AND (
      v_trigger_count <> 1
      OR NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        WHERE NOT t.tgisinternal
          AND t.tgname = v_trigger.trigger_name
          AND t.tgrelid = to_regclass(v_trigger.table_name)
          AND t.tgfoid = to_regprocedure(v_trigger.function_signature)
          AND t.tgtype = 7
          AND t.tgenabled = 'O'
      )
    ) THEN
      RAISE EXCEPTION 'Containment trigger name is already used by an unexpected object: %', v_trigger.trigger_name;
    END IF;
  END LOOP;
END;
$p0_preflight$;

-- Reports and ledger RPCs: the current NextAuth API calls these as service_role.
REVOKE EXECUTE ON FUNCTION public.account_ledger(text,text,date,date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.day_book(text,date,date,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.negative_stock_report(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pending_stock_report(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_balance_sheet(text,date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_cash_flow(text,date,date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_customer_outstanding(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_expense_summary(text,date,date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_inventory_valuation(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_profit_loss(text,date,date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_sales_summary(text,date,date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.report_vendor_outstanding(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rider_dashboard_summary(text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rider_ledger(text,text,date,date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trial_balance(text,date,date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.vendor_ledger(text,text,date,date) FROM PUBLIC, anon, authenticated;

-- Privileged mutation RPCs: preserve only the service_role server boundary.
REVOKE EXECUTE ON FUNCTION public.assign_rider_to_order(text,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_voucher(text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_cod_submission(text,text,numeric,text,numeric,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_cod_submission(text,text,jsonb,text,numeric,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_stock_movement(text,text,text,integer,text,date,uuid,numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_order_delivered(text,text,numeric,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_order_returned(text,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_advance_application(text,text,text,numeric,date,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_contra_entry(text,date,text,text,numeric,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_expense_batch(text,date,text,jsonb,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_journal_voucher(text,date,text,jsonb,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_payment_voucher(text,date,text,text,numeric,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_purchase(text,text,date,text,jsonb,jsonb,numeric,numeric,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_purchase_replacement(text,text,jsonb,date,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_purchase_return(text,text,jsonb,text,text,date,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_receipt_voucher(text,date,text,text,numeric,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_sales_return(text,text,date,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_vendor_advance(text,text,text,numeric,date,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_vendor_payment(text,text,text,numeric,date,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_voucher(text,text,date,text,jsonb,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalculate_product_cost(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_cod_submission(text,text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reverse_voucher_safe(text,text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_delivery_status(text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;

-- Explicitly retain every report and mutation privilege used by the application server.
GRANT EXECUTE ON FUNCTION public.account_ledger(text,text,date,date),public.day_book(text,date,date,text),public.negative_stock_report(text),public.pending_stock_report(text),public.report_balance_sheet(text,date),public.report_cash_flow(text,date,date),public.report_customer_outstanding(text),public.report_expense_summary(text,date,date),public.report_inventory_valuation(text),public.report_profit_loss(text,date,date),public.report_sales_summary(text,date,date),public.report_vendor_outstanding(text),public.rider_dashboard_summary(text,text),public.rider_ledger(text,text,date,date),public.trial_balance(text,date,date),public.vendor_ledger(text,text,date,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.assign_rider_to_order(text,text,text,uuid),public.cancel_voucher(text,uuid,text),public.confirm_cod_submission(text,text,numeric,text,numeric,text,uuid),public.create_cod_submission(text,text,jsonb,text,numeric,text,uuid),public.create_stock_movement(text,text,text,integer,text,date,uuid,numeric),public.mark_order_delivered(text,text,numeric,text,text,uuid),public.mark_order_returned(text,text,text,uuid),public.post_advance_application(text,text,text,numeric,date,text,uuid),public.post_contra_entry(text,date,text,text,numeric,text,text,uuid),public.post_expense_batch(text,date,text,jsonb,text,text,uuid),public.post_journal_voucher(text,date,text,jsonb,text,uuid),public.post_payment_voucher(text,date,text,text,numeric,text,text,text,uuid),public.post_purchase(text,text,date,text,jsonb,jsonb,numeric,numeric,text,uuid),public.post_purchase_replacement(text,text,jsonb,date,text,uuid),public.post_purchase_return(text,text,jsonb,text,text,date,text,uuid),public.post_receipt_voucher(text,date,text,text,numeric,text,text,text,uuid),public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid),public.post_sales_return(text,text,date,text,uuid),public.post_vendor_advance(text,text,text,numeric,date,text,uuid),public.post_vendor_payment(text,text,text,numeric,date,text,text,uuid),public.post_voucher(text,text,date,text,jsonb,text,text,uuid),public.recalculate_product_cost(text),public.reject_cod_submission(text,text,uuid,text),public.reverse_voucher_safe(text,text,uuid,text),public.update_delivery_status(text,text,text,text,uuid) TO service_role;

-- Narrow direct profile UPDATE without changing its policies or active-profile helpers.
REVOKE UPDATE ON TABLE public.profiles FROM anon, authenticated;
GRANT UPDATE (display_name, phone) ON public.profiles TO authenticated;

-- A failure here aborts the surrounding posting transaction, including its earlier voucher.
CREATE OR REPLACE FUNCTION public._contain_purchase_payment_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase public.purchases%ROWTYPE;
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;

  -- Unlinked rows are used by other payment types; linked rows must resolve and match.
  IF NEW.purchase_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_purchase
  FROM public.purchases
  WHERE id = NEW.purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked purchase not found';
  END IF;

  IF v_purchase.business_id IS DISTINCT FROM NEW.business_id
     OR v_purchase.vendor_id IS DISTINCT FROM NEW.vendor_id THEN
    RAISE EXCEPTION 'Purchase tenant/vendor mismatch';
  END IF;

  IF NEW.payment_type = 'later_payment'
     AND NEW.amount > v_purchase.outstanding_amount THEN
    RAISE EXCEPTION 'Payment exceeds purchase outstanding';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._contain_purchase_payment_tenant() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS contain_purchase_payment_tenant ON public.purchase_payments;
CREATE TRIGGER contain_purchase_payment_tenant
BEFORE INSERT ON public.purchase_payments
FOR EACH ROW EXECUTE FUNCTION public._contain_purchase_payment_tenant();

CREATE OR REPLACE FUNCTION public._contain_purchase_return_header()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.settlement_type IS DISTINCT FROM 'reduce_payable'
     AND (
       NEW.settlement_account_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.accounts a
         WHERE a.id = NEW.settlement_account_id
           AND a.business_id = NEW.business_id
           AND a.is_active = true
       )
     ) THEN
    RAISE EXCEPTION 'Invalid purchase-return settlement account';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._contain_purchase_return_header() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS contain_purchase_return_header ON public.purchase_returns;
CREATE TRIGGER contain_purchase_return_header
BEFORE INSERT ON public.purchase_returns
FOR EACH ROW EXECUTE FUNCTION public._contain_purchase_return_header();

CREATE OR REPLACE FUNCTION public._contain_purchase_return_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_header public.purchase_returns%ROWTYPE;
  v_source public.purchase_items%ROWTYPE;
  v_recorded integer;
BEGIN
  SELECT *
  INTO v_header
  FROM public.purchase_returns
  WHERE id = NEW.purchase_return_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase-return header not found';
  END IF;

  SELECT *
  INTO v_source
  FROM public.purchase_items
  WHERE id = NEW.purchase_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source purchase item not found';
  END IF;

  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'Return quantity must be positive';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.purchase_return_items x
    WHERE x.purchase_return_id = NEW.purchase_return_id
      AND x.purchase_item_id = NEW.purchase_item_id
  ) THEN
    RAISE EXCEPTION 'Duplicate source item in purchase return';
  END IF;

  IF v_header.business_id IS DISTINCT FROM NEW.business_id
     OR v_source.business_id IS DISTINCT FROM NEW.business_id
     OR v_header.purchase_id IS DISTINCT FROM v_source.purchase_id THEN
    RAISE EXCEPTION 'Return source tenant/purchase mismatch';
  END IF;

  IF NEW.product_id IS DISTINCT FROM v_source.product_id
     OR NEW.unit_cost IS DISTINCT FROM v_source.unit_cost THEN
    RAISE EXCEPTION 'Return product/cost must match source';
  END IF;

  SELECT coalesce(sum(x.quantity), 0)::integer
  INTO v_recorded
  FROM public.purchase_return_items x
  WHERE x.purchase_item_id = NEW.purchase_item_id;

  IF greatest(v_source.returned_quantity, v_recorded) + NEW.quantity > v_source.quantity THEN
    RAISE EXCEPTION 'Return quantity exceeds remaining source quantity';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._contain_purchase_return_item() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS contain_purchase_return_item ON public.purchase_return_items;
CREATE TRIGGER contain_purchase_return_item
BEFORE INSERT ON public.purchase_return_items
FOR EACH ROW EXECUTE FUNCTION public._contain_purchase_return_item();

COMMIT;
