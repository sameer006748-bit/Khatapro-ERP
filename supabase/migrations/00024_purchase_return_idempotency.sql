-- Purchase Return idempotency, mirroring the Sale Return contract.
-- Root cause: post_purchase_return() has no idempotency parameter or
-- unique constraint, so a network retry of the same return request creates
-- a second purchase_returns row, decrements stock twice, and posts the
-- vendor settlement twice. Sale Return already requires an idempotencyKey
-- (src/app/api/sales/[id]/return/route.ts); this brings Purchase Return to
-- the same standard.
begin;

do $$
begin
  if to_regclass('public.purchase_returns') is null then
    raise exception 'Purchase return idempotency requires purchase_returns';
  end if;
end $$;

alter table public.purchase_returns add column if not exists idempotency_key text;
alter table public.purchase_returns add column if not exists request_fingerprint text;
create unique index if not exists purchase_returns_business_idempotency_idx
  on public.purchase_returns(business_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.post_purchase_return(
  p_business_id        text,
  p_purchase_id        text,
  p_return_items       jsonb,
  p_settlement_type    text default 'reduce_payable',
  p_settlement_account_id text default null,
  p_return_date        date default null,
  p_notes              text default null,
  p_created_by         uuid default null,
  p_idempotency_key    text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_return_id    text;
  v_return_no    text;
  v_total        numeric(20,0) := 0;
  v_item         jsonb;
  v_line_total   numeric(20,0);
  v_qty          integer;
  v_unit_cost    numeric(20,0);
  v_product_id   text;
  v_voucher_id   text;
  v_voucher_lines jsonb := '[]'::jsonb;
  v_inventory_acct text;
  v_payable_acct   text;
  v_purchase     record;
  v_stock_sm_id  text;
  v_date         date;
  v_existing     record;
  v_fingerprint  text;
begin
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Idempotency key is required';
  end if;

  v_fingerprint := encode(digest(concat_ws('|',
    p_purchase_id, p_return_items::text, coalesce(p_settlement_type, ''),
    coalesce(p_settlement_account_id, ''), coalesce(p_notes, '')
  ), 'sha256'), 'hex');

  select id, request_fingerprint into v_existing
  from public.purchase_returns
  where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'Idempotency key conflicts with a different purchase return request' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  select * into v_purchase from public.purchases
  where id = p_purchase_id and business_id = p_business_id;
  if not found then raise exception 'Purchase not found: %', p_purchase_id; end if;

  v_return_no := public.next_purchase_return_no(p_business_id);

  for v_item in select * from jsonb_array_elements(p_return_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    v_unit_cost := coalesce((v_item->>'unit_cost_paisas')::numeric, 0);
    v_line_total := v_qty * v_unit_cost;
    v_total := v_total + v_line_total;
  end loop;

  select id into v_inventory_acct from public.accounts
  where business_id = p_business_id and code = '1100' and is_active = true;
  if not found then raise exception 'Inventory account (1100) not found'; end if;

  select id into v_payable_acct from public.accounts
  where business_id = p_business_id and code = '2010' and is_active = true;
  if not found then raise exception 'Vendors Payable account (2010) not found'; end if;

  v_date := coalesce(p_return_date, (now() at time zone 'Asia/Karachi')::date);

  v_voucher_lines := v_voucher_lines || jsonb_build_object(
    'account_id', v_inventory_acct, 'debit', '0', 'credit', v_total::text
  );

  if p_settlement_type = 'vendor_refund' and p_settlement_account_id is not null then
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', p_settlement_account_id, 'debit', v_total::text, 'credit', '0'
    );
  else
    v_voucher_lines := v_voucher_lines || jsonb_build_object(
      'account_id', v_payable_acct, 'debit', v_total::text, 'credit', '0'
    );
  end if;

  v_voucher_id := public.post_voucher(
    p_business_id, 'PR', v_date, format('Purchase return %s', v_return_no),
    v_voucher_lines, p_purchase_id, 'purchase_return', p_created_by
  );

  insert into public.purchase_returns (
    business_id, purchase_id, vendor_id, return_no, return_date, total_amount,
    settlement_type, settlement_account_id, voucher_id, notes, created_by,
    idempotency_key, request_fingerprint
  ) values (
    p_business_id, p_purchase_id, v_purchase.vendor_id, v_return_no, v_date, v_total,
    p_settlement_type, p_settlement_account_id, v_voucher_id, p_notes, p_created_by,
    p_idempotency_key, v_fingerprint
  ) returning id into v_return_id;

  for v_item in select * from jsonb_array_elements(p_return_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    v_unit_cost := coalesce((v_item->>'unit_cost_paisas')::numeric, 0);
    v_product_id := v_item->>'product_id';

    if v_product_id is not null then
      v_stock_sm_id := public.create_stock_movement(
        p_business_id, v_product_id, 'adjustment_out', v_qty,
        format('Return %s', v_return_no), p_created_by
      );
    end if;

    insert into public.purchase_return_items (
      business_id, purchase_return_id, purchase_item_id, product_id, product_name,
      quantity, unit_cost, line_total, stock_movement_id
    ) values (
      p_business_id, v_return_id, v_item->>'purchase_item_id', v_product_id,
      v_item->>'product_name', v_qty, v_unit_cost, v_qty * v_unit_cost, v_stock_sm_id
    );

    update public.purchase_items
    set returned_quantity = coalesce(returned_quantity, 0) + v_qty
    where id = (v_item->>'purchase_item_id') and business_id = p_business_id;
  end loop;

  update public.purchases
  set status = case
    when (select coalesce(sum(pi.returned_quantity), 0) from public.purchase_items pi where pi.purchase_id = p_purchase_id)
         >= (select coalesce(sum(pi.quantity), 0) from public.purchase_items pi where pi.purchase_id = p_purchase_id)
    then 'returned' else 'partially_returned' end
  where id = p_purchase_id and business_id = p_business_id;

  return v_return_id;
end $$;

commit;
