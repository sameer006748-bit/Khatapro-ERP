-- 00034 â€” Readable code words + authoritative transaction identity registry.
--
-- Two additive sections, one migration. Nothing existing is renamed or erased;
-- historical identities stay exactly as issued.
--
-- SECTION A â€” transaction identity prefix registry
--   Aligns the user-facing identity registry with
--   docs/ACCOUNTING_CODES_AND_IDENTITIES.md Â§3:
--     INV, SRT, PUR, PRT, EXP, REC, PAY, CON, JRV, STA, STM, OPS, RDS, COM
--   Legacy prefixes (SR, PRN, RV, PV, JV, CTB, SA, OS, RCS, CMS, CAP, DRW,
--   CS, DO) remain valid: existing rows keep their numbers and the allocator
--   still accepts them, so nothing deployed breaks and no sequence resets.
--   New documents are issued under the readable registry prefixes.
--
-- SECTION B â€” account subcategory readable code words
--   Adds an optional-then-backfilled `code` column to account_subcategories,
--   validates format (uppercase letters/numbers/hyphens), enforces per-business
--   uniqueness, and extends the management RPC to require/accept code words.
--   Relational IDs remain the foreign keys; renaming a code word never breaks
--   historical vouchers or assignments.
--
-- ROLLBACK (manual, only if ever needed):
--   drop function if exists public.manage_account_subcategory(
--     uuid, uuid, text, text, uuid, text, uuid, text);
--   drop function if exists public.normalize_subcategory_code_word(text);
--   drop index if exists public.account_subcategories_business_code_key;
--   alter table public.account_subcategories drop column if exists code;
--   -- Section A is CREATE OR REPLACE: re-run 00020/00027 definitions to restore.
--
-- NOT applied by this repository change; requires explicit preflight/approval.
begin;

do $$
begin
  if to_regclass('public.businesses') is null
     or to_regclass('public.identity_sequences') is null
     or to_regclass('public.ledger_voucher_sequences') is null
     or to_regclass('public.account_subcategories') is null then
    raise exception '00034 requires businesses, identity_sequences, ledger_voucher_sequences and account_subcategories';
  end if;
end $$;

-- ============================================================================
-- SECTION A â€” transaction identity prefix registry
-- ============================================================================

create or replace function public.transaction_prefix(p_transaction_type text)
returns text
language sql immutable
set search_path = public
as $$
  select case upper(trim(coalesce(p_transaction_type, '')))
    when 'COUNTER_SALE' then 'INV'
    when 'ONLINE_SALE' then 'INV'
    when 'OFC_SALE' then 'INV'
    when 'OTHER_SALE' then 'INV'
    when 'SALE_RETURN' then 'SRT'
    when 'PURCHASE' then 'PUR'
    when 'PURCHASE_RETURN' then 'PRT'
    when 'RECEIPT_VOUCHER' then 'REC'
    when 'PAYMENT_VOUCHER' then 'PAY'
    when 'JOURNAL_VOUCHER' then 'JRV'
    when 'CONTRA_BATCH' then 'CON'
    when 'CAPITAL_INTRODUCED' then 'CAP'
    when 'OWNER_DRAWING' then 'DRW'
    when 'STOCK_ADJUSTMENT' then 'STA'
    when 'STOCK_TRANSFER' then 'STM'
    when 'OPENING_STOCK' then 'OPS'
    when 'RIDER_COD_SETTLEMENT' then 'RDS'
    when 'RIDER_COD_SUBMISSION' then 'CS'
    when 'COMMISSION_SETTLEMENT' then 'COM'
    when 'EXPENSE_BATCH' then 'EXP'
    when 'DELIVERY_OUTCOME' then 'DO'
    else null
  end
$$;
-- Supports both the readable registry prefixes and the legacy prefixes so
-- historical callers and re-plays keep allocating without error.
create or replace function public.allocate_readable_identity(
  p_business_id uuid, p_prefix text
) returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix text := upper(trim(coalesce(p_prefix, '')));
  v_seq int;
begin
  if v_prefix not in (
    'INV', 'SRT', 'PUR', 'PRT', 'EXP', 'REC', 'PAY', 'CON', 'JRV',
    'STA', 'STM', 'OPS', 'RDS', 'COM',
    'SR', 'PRN', 'RV', 'PV', 'JV', 'CTB', 'SA', 'OS', 'RCS', 'CMS',
    'CAP', 'DRW', 'CS', 'DO'
  ) then
    raise exception 'Unsupported transaction identity prefix';
  end if;
  if not exists (select 1 from public.businesses b where b.id = p_business_id) then
    raise exception 'Identity business does not exist';
  end if;

  -- INSERT .. ON CONFLICT UPDATE takes the sequence row lock. The increment is
  -- part of the caller transaction, so a rollback rolls the allocation back.
  insert into public.identity_sequences (business_id, prefix, last_seq)
  values (p_business_id, v_prefix, 1)
  on conflict (business_id, prefix)
  do update set last_seq = public.identity_sequences.last_seq + 1
  returning last_seq into v_seq;
  return v_prefix || '-' || lpad(v_seq::text, 6, '0');
end $$;

create or replace function public.allocate_transaction_identity(
  p_business_id uuid, p_transaction_type text
) returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_prefix text;
begin
  v_prefix := public.transaction_prefix(p_transaction_type);
  if v_prefix is null then
    raise exception 'Unsupported transaction type %', p_transaction_type;
  end if;
  return public.allocate_readable_identity(p_business_id, v_prefix);
end $$;

-- Ledger voucher engine prefix map (00027) â€” same registry targets. Legacy
-- readable numbers (RV-â€¦, PV-â€¦, CTB-â€¦) remain accepted by post_ledger_voucher.
create or replace function public.ledger_voucher_prefix(p_voucher_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case upper(trim(coalesce(p_voucher_type, '')))
    when 'SI' then 'INV' when 'SALE' then 'INV'
    when 'SR' then 'SRT'
    when 'PU' then 'PUR' when 'PURCHASE' then 'PUR'
    when 'PR' then 'PRT'
    when 'RC' then 'REC' when 'RV' then 'REC'
    when 'PM' then 'PAY' when 'PV' then 'PAY'
    when 'JV' then 'JRV'
    when 'CT' then 'CON' when 'CONTRA' then 'CON'
    when 'CAPITAL' then 'CAP'
    when 'DRAWING' then 'DRW'
    when 'OP' then 'OPS'
    when 'EXP' then 'EXP'
    when 'SA' then 'STA'
    when 'COD' then 'RDS'
    when 'CMS' then 'COM'
    else 'JRV'
  end
$$;

-- ============================================================================
-- SECTION B â€” account subcategory readable code words
-- ============================================================================

alter table public.account_subcategories add column if not exists code text;

-- Uppercase letters, numbers and single internal hyphens; 2-40 characters.
-- Nullable only so the safe backfill below can run first.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.account_subcategories')
      and conname = 'account_subcategories_code_format'
  ) then
    alter table public.account_subcategories
      add constraint account_subcategories_code_format
      check (code is null or (
        char_length(code) between 2 and 40
        and code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
      ));
  end if;
end $$;

-- Code word is unique per business. Partial because the backfilled legacy rows
-- may transiently be null until the backfill below completes.
create unique index if not exists account_subcategories_business_code_key
  on public.account_subcategories(business_id, code)
  where code is not null;

-- Canonicalizer shared by the backfill and the management RPC.
create or replace function public.normalize_subcategory_code_word(p_raw text)
returns text
language sql immutable
set search_path = public
as $$
  select case
    when v.word ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
         and char_length(v.word) between 2 and 40 then v.word
    else null
  end
  from (
    select nullif(
      trim(both '-' from
        regexp_replace(upper(trim(coalesce(p_raw, ''))), '[^A-Z0-9]+', '-', 'g')
      ), ''
    ) as word
  ) v
$$;

-- Safe backfill: derive from the subcategory name only where no code exists;
-- resolve collisions deterministically with a numeric suffix. Never overwrites
-- an existing code word and never touches other tables.
do $$
declare
  v_row record;
  v_candidate text;
  v_suffix int;
begin
  for v_row in
    select s.id, s.business_id, s.name
    from public.account_subcategories s
    where s.code is null
    order by s.business_id, s.id
  loop
    v_candidate := public.normalize_subcategory_code_word(v_row.name);
    if v_candidate is null then
      v_candidate := 'SC-' || substr(v_row.id::text, 1, 8);
    end if;
    if not exists (
      select 1 from public.account_subcategories c
      where c.business_id = v_row.business_id and c.code = v_candidate
    ) then
      update public.account_subcategories
      set code = v_candidate where id = v_row.id;
    else
      v_suffix := 2;
      while exists (
        select 1 from public.account_subcategories c
        where c.business_id = v_row.business_id
          and c.code = v_candidate || '-' || v_suffix::text
      ) loop
        v_suffix := v_suffix + 1;
      end loop;
      update public.account_subcategories
      set code = v_candidate || '-' || v_suffix::text where id = v_row.id;
    end if;
  end loop;
end $$;

-- The backfill above supplies every legacy row, so code words become required
-- for all future rows without a destructive rewrite.
alter table public.account_subcategories alter column code set not null;

-- Listing returns the readable code word alongside the display name.
create or replace function public.list_account_subcategories(
  p_business_id uuid, p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.phase21_assert_actor(p_business_id, p_actor_id, false);
  return jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'parentCode', s.parent_code,
        'name', s.name,
        'code', s.code,
        'reportClass', public.account_parent_report_class(s.parent_code),
        'isActive', s.is_active,
        'archivedAt', s.archived_at
      ) order by s.parent_code, s.is_active desc, s.name)
      from public.account_subcategories s
      where s.business_id = p_business_id
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'accountId', a.account_id,
        'parentCode', a.parent_code,
        'subcategoryId', a.subcategory_id
      ) order by la.account_code)
      from public.account_subcategory_assignments a
      join public.ledger_accounts la
        on la.business_id = a.business_id and la.id = a.account_id
      where a.business_id = p_business_id
    ), '[]'::jsonb)
  );
end $$;

drop function if exists public.manage_account_subcategory(
  uuid, uuid, text, text, uuid, text, uuid
);

-- p_code: required for `create`, optional for `rename` (updates the code word
-- when supplied). Codes are canonicalized; duplicates inside the business are
-- rejected with a clear message. Only the code word changes â€” IDs, hierarchy
-- and historical vouchers are untouched.
create function public.manage_account_subcategory(
  p_business_id uuid,
  p_actor_id uuid,
  p_action text,
  p_parent_code text default null,
  p_subcategory_id uuid default null,
  p_name text default null,
  p_account_id uuid default null,
  p_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_sub public.account_subcategories%rowtype;
  v_account public.ledger_accounts%rowtype;
  v_before jsonb;
  v_old_assignment public.account_subcategory_assignments%rowtype;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_expected_class text;
  v_code text;
begin
  v_profile := public.phase21_assert_actor(p_business_id, p_actor_id, true);
  v_expected_class := public.account_parent_report_class(p_parent_code);
  if p_parent_code is not null and v_expected_class is null then
    raise exception 'Unsupported parent category';
  end if;

  if v_action = 'create' then
    if nullif(trim(coalesce(p_name, '')), '') is null or p_parent_code is null then
      raise exception 'Parent, name and code word are required';
    end if;
    v_code := public.normalize_subcategory_code_word(p_code);
    if v_code is null then
      raise exception 'DUPLICATE_OR_INVALID_CODE: a readable code word using letters, numbers and hyphens is required (e.g. EXP-COMM)';
    end if;
    if exists (
      select 1 from public.account_subcategories c
      where c.business_id = p_business_id and c.code = v_code
    ) then
      raise exception 'DUPLICATE_CODE_WORD: code word % is already used in this business', v_code;
    end if;
    insert into public.account_subcategories (
      business_id, parent_code, name, normalized_name, code,
      created_by, updated_by
    ) values (
      p_business_id, p_parent_code, trim(p_name), lower(trim(p_name)), v_code,
      v_profile.id, v_profile.id
    ) returning * into v_sub;
  elsif v_action = 'rename' then
    select * into v_sub
    from public.account_subcategories
    where id = p_subcategory_id and business_id = p_business_id
    for update;
    if not found then raise exception 'Subcategory not found'; end if;
    if nullif(trim(coalesce(p_name, '')), '') is null then
      raise exception 'Category name is required';
    end if;
    v_code := public.normalize_subcategory_code_word(p_code);
    if v_code is not null and v_code <> v_sub.code then
      if exists (
        select 1 from public.account_subcategories c
        where c.business_id = p_business_id and c.code = v_code and c.id <> v_sub.id
      ) then
        raise exception 'DUPLICATE_CODE_WORD: code word % is already used in this business', v_code;
      end if;
    end if;
    v_before := to_jsonb(v_sub);
    update public.account_subcategories
    set name = trim(p_name),
        normalized_name = lower(trim(p_name)),
        code = coalesce(v_code, code),
        updated_by = v_profile.id,
        updated_at = now()
    where id = v_sub.id
    returning * into v_sub;

  elsif v_action = 'archive' then
    select * into v_sub
    from public.account_subcategories
    where id = p_subcategory_id and business_id = p_business_id
    for update;
    if not found then raise exception 'Subcategory not found'; end if;
    v_before := to_jsonb(v_sub);
    update public.account_subcategories
    set is_active = false,
        archived_at = now(),
        updated_by = v_profile.id,
        updated_at = now()
    where id = v_sub.id
    returning * into v_sub;
  elsif v_action in ('assign', 'move', 'uncategorize') then
    if p_account_id is null or p_parent_code is null then
      raise exception 'Canonical ledger account and parent are required';
    end if;
    select * into v_account
    from public.ledger_accounts
    where id = p_account_id and business_id = p_business_id and is_active
    for update;
    if not found then
      raise exception 'Active same-business ledger account is required';
    end if;
    if v_account.report_class <> v_expected_class then
      raise exception 'Account cannot move between Balance Sheet and Profit and Loss report classes';
    end if;
    if p_subcategory_id is not null then
      select * into v_sub
      from public.account_subcategories
      where id = p_subcategory_id
        and business_id = p_business_id
        and parent_code = p_parent_code
        and is_active;
      if not found then
        raise exception 'Active one-level subcategory is required';
      end if;
    end if;
    select * into v_old_assignment
    from public.account_subcategory_assignments
    where business_id = p_business_id and account_id = p_account_id
    for update;
    insert into public.account_subcategory_assignments (
      business_id, account_ref, account_id, parent_code,
      subcategory_id, assigned_by
    ) values (
      p_business_id, p_account_id::text, p_account_id, p_parent_code,
      p_subcategory_id, v_profile.id
    )
    on conflict (business_id, account_id) where account_id is not null do update
      set account_ref = excluded.account_ref,
          parent_code = excluded.parent_code,
          subcategory_id = excluded.subcategory_id,
          assigned_by = excluded.assigned_by,
          assigned_at = now();
    v_action := case
      when p_subcategory_id is null then 'uncategorize'
      when v_old_assignment.account_id is null then 'assign'
      else 'move'
    end;
  else
    raise exception 'Unsupported subcategory action';
  end if;

  insert into public.account_classification_audit (
    business_id, actor_id, action, subcategory_id, account_ref, account_id,
    before_value, after_value
  ) values (
    p_business_id, v_profile.id, v_action,
    coalesce(v_sub.id, p_subcategory_id),
    case when p_account_id is null then null else p_account_id::text end,
    p_account_id,
    coalesce(v_before, to_jsonb(v_old_assignment)),
    case
      when v_action in ('assign', 'move', 'uncategorize') then
        jsonb_build_object(
          'parentCode', p_parent_code,
          'subcategoryId', p_subcategory_id,
          'reportClass', v_account.report_class
        )
      else to_jsonb(v_sub)
    end
  );
  return jsonb_build_object(
    'ok', true, 'action', v_action,
    'subcategoryId', coalesce(v_sub.id, p_subcategory_id),
    'accountId', p_account_id
  );
end $$;

revoke all on function public.list_account_subcategories(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.manage_account_subcategory(
  uuid, uuid, text, text, uuid, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.list_account_subcategories(uuid, uuid) to service_role;
grant execute on function public.manage_account_subcategory(
  uuid, uuid, text, text, uuid, text, uuid, text
) to service_role;
revoke all on function public.transaction_prefix(text) from public, anon;
revoke all on function public.allocate_readable_identity(uuid, text) from public, anon, authenticated;
revoke all on function public.allocate_transaction_identity(uuid, text) from public, anon, authenticated;
revoke all on function public.ledger_voucher_prefix(text) from public, anon;
grant execute on function public.transaction_prefix(text) to authenticated, service_role;
grant execute on function public.allocate_readable_identity(uuid, text) to service_role;
grant execute on function public.allocate_transaction_identity(uuid, text) to service_role;
grant execute on function public.ledger_voucher_prefix(text) to service_role;

commit;
notify pgrst, 'reload schema';
