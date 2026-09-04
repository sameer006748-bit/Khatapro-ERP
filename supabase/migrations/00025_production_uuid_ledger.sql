-- KhataPro ERP: canonical production UUID ledger.
-- Additive only. This deliberately does not create or depend on the legacy
-- public.business/public.accounts/public.vouchers/public.voucher_lines model.
begin;

do $$
declare
  v_problem text;
begin
  if to_regclass('public.businesses') is null
     or to_regclass('public.profiles') is null then
    raise exception 'UUID ledger requires public.businesses and public.profiles';
  end if;

  select string_agg(format('%s.%s must be uuid', table_name, column_name), ', ')
    into v_problem
  from (values ('businesses', 'id'), ('profiles', 'id'), ('profiles', 'business_id'))
       expected(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = expected.table_name
      and c.column_name = expected.column_name
      and c.udt_name = 'uuid'
  );
  if v_problem is not null then
    raise exception 'UUID ledger identifier precondition failed: %', v_problem;
  end if;
end $$;

create table public.ledger_account_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  stable_code text not null,
  display_name text not null check (length(trim(display_name)) > 0),
  report_class text not null check (
    report_class in ('Asset', 'Liability', 'Equity', 'Income', 'Expense')
  ),
  statement_section text not null check (
    statement_section in (
      'CURRENT_ASSET', 'NON_CURRENT_ASSET', 'CURRENT_LIABILITY',
      'NON_CURRENT_LIABILITY', 'EQUITY', 'INCOME',
      'COST_OF_GOODS_SOLD', 'EXPENSE'
    )
  ),
  is_system boolean not null default false,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_account_categories_code_key unique (business_id, stable_code),
  constraint ledger_account_categories_business_id_key unique (business_id, id),
  constraint ledger_account_categories_archive_state check (
    (is_active and archived_at is null)
    or (not is_active and archived_at is not null)
  ),
  constraint ledger_account_categories_statement_class check (
    (report_class = 'Asset' and statement_section in ('CURRENT_ASSET', 'NON_CURRENT_ASSET'))
    or (report_class = 'Liability' and statement_section in ('CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY'))
    or (report_class = 'Equity' and statement_section = 'EQUITY')
    or (report_class = 'Income' and statement_section = 'INCOME')
    or (report_class = 'Expense' and statement_section in ('COST_OF_GOODS_SOLD', 'EXPENSE'))
  )
);

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  category_id uuid not null,
  account_code text not null check (account_code ~ '^[0-9A-Z][0-9A-Z._-]{1,31}$'),
  account_name text not null check (length(trim(account_name)) > 0),
  report_class text not null check (
    report_class in ('Asset', 'Liability', 'Equity', 'Income', 'Expense')
  ),
  account_class text not null check (
    account_class in (
      'asset', 'liability', 'equity', 'contra_equity', 'income',
      'cost_of_goods_sold', 'expense'
    )
  ),
  is_system boolean not null default false,
  is_postable boolean not null default true,
  operational_money_key text check (
    operational_money_key is null or operational_money_key in ('cash', 'bank', 'wallet')
  ),
  party_type text check (
    party_type is null or party_type in ('customer', 'vendor', 'rider', 'salesman')
  ),
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_accounts_code_key unique (business_id, account_code),
  constraint ledger_accounts_business_id_key unique (business_id, id),
  constraint ledger_accounts_operational_key unique (business_id, operational_money_key),
  constraint ledger_accounts_category_fkey foreign key (business_id, category_id)
    references public.ledger_account_categories(business_id, id) on delete restrict,
  constraint ledger_accounts_archive_state check (
    (is_active and archived_at is null)
    or (not is_active and archived_at is not null)
  ),
  constraint ledger_accounts_class_integrity check (
    (report_class = 'Asset' and account_class = 'asset')
    or (report_class = 'Liability' and account_class = 'liability')
    or (report_class = 'Equity' and account_class in ('equity', 'contra_equity'))
    or (report_class = 'Income' and account_class = 'income')
    or (report_class = 'Expense' and account_class in ('cost_of_goods_sold', 'expense'))
  )
);

create table public.ledger_voucher_sequences (
  business_id uuid not null references public.businesses(id) on delete restrict,
  prefix text not null check (prefix ~ '^[A-Z][A-Z0-9]{0,7}$'),
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  primary key (business_id, prefix)
);

create table public.ledger_vouchers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  readable_number text not null,
  voucher_type text not null check (length(trim(voucher_type)) between 1 and 40),
  transaction_date date not null,
  narration text,
  reference text,
  source_type text,
  source_id text,
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  posted_by uuid not null references public.profiles(id) on delete restrict,
  posted_at timestamptz not null default now(),
  posting_state text not null default 'posted' check (posting_state = 'posted'),
  total_debit_paisas numeric(20,0) not null check (total_debit_paisas > 0),
  total_credit_paisas numeric(20,0) not null check (total_credit_paisas > 0),
  reverses_voucher_id uuid,
  constraint ledger_vouchers_number_key unique (business_id, readable_number),
  constraint ledger_vouchers_idempotency_key unique (business_id, idempotency_key),
  constraint ledger_vouchers_source_key unique (business_id, source_type, source_id),
  constraint ledger_vouchers_business_id_key unique (business_id, id),
  constraint ledger_vouchers_balanced check (total_debit_paisas = total_credit_paisas),
  constraint ledger_vouchers_reversal_fkey foreign key (business_id, reverses_voucher_id)
    references public.ledger_vouchers(business_id, id) on delete restrict,
  constraint ledger_vouchers_source_shape check (
    (source_type is null and source_id is null)
    or (source_type is not null and source_id is not null)
  )
);

create table public.ledger_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  voucher_id uuid not null,
  account_id uuid not null,
  line_number integer not null check (line_number > 0),
  debit_paisas numeric(20,0) not null default 0 check (debit_paisas >= 0),
  credit_paisas numeric(20,0) not null default 0 check (credit_paisas >= 0),
  party_type text,
  party_id text,
  line_narration text,
  source_line_reference text,
  created_at timestamptz not null default now(),
  constraint ledger_voucher_lines_voucher_fkey foreign key (business_id, voucher_id)
    references public.ledger_vouchers(business_id, id) on delete restrict,
  constraint ledger_voucher_lines_account_fkey foreign key (business_id, account_id)
    references public.ledger_accounts(business_id, id) on delete restrict,
  constraint ledger_voucher_lines_number_key unique (voucher_id, line_number),
  constraint ledger_voucher_lines_one_side check (
    (debit_paisas > 0 and credit_paisas = 0)
    or (credit_paisas > 0 and debit_paisas = 0)
  ),
  constraint ledger_voucher_lines_party_shape check (
    (party_type is null and party_id is null)
    or (party_type in ('customer', 'vendor', 'rider', 'salesman') and party_id is not null)
  )
);

create index ledger_vouchers_business_date_idx
  on public.ledger_vouchers(business_id, transaction_date, readable_number);
create index ledger_voucher_lines_account_idx
  on public.ledger_voucher_lines(business_id, account_id, voucher_id);
create index ledger_accounts_business_class_idx
  on public.ledger_accounts(business_id, report_class, is_active);

create or replace function public.prevent_posted_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Posted ledger records are immutable; post a reversing voucher'
    using errcode = '55000';
end $$;

create trigger ledger_vouchers_immutable
before update or delete on public.ledger_vouchers
for each row execute function public.prevent_posted_ledger_mutation();

create trigger ledger_voucher_lines_immutable
before update or delete on public.ledger_voucher_lines
for each row execute function public.prevent_posted_ledger_mutation();

create or replace function public.protect_system_ledger_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.is_system and (
    new.business_id is distinct from old.business_id
    or new.account_code is distinct from old.account_code
    or new.category_id is distinct from old.category_id
    or new.report_class is distinct from old.report_class
    or new.account_class is distinct from old.account_class
    or new.is_system is distinct from true
    or new.is_postable is distinct from old.is_postable
    or new.is_active is distinct from true
    or new.archived_at is not null
  ) then
    raise exception 'Required system ledger accounts cannot be reclassified or archived'
      using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger ledger_accounts_protect_system
before update on public.ledger_accounts
for each row execute function public.protect_system_ledger_account();

alter table public.ledger_account_categories enable row level security;
alter table public.ledger_accounts enable row level security;
alter table public.ledger_voucher_sequences enable row level security;
alter table public.ledger_vouchers enable row level security;
alter table public.ledger_voucher_lines enable row level security;

revoke all on public.ledger_account_categories from public, anon, authenticated;
revoke all on public.ledger_accounts from public, anon, authenticated;
revoke all on public.ledger_voucher_sequences from public, anon, authenticated;
revoke all on public.ledger_vouchers from public, anon, authenticated;
revoke all on public.ledger_voucher_lines from public, anon, authenticated;
grant all on public.ledger_account_categories to service_role;
grant all on public.ledger_accounts to service_role;
grant all on public.ledger_voucher_sequences to service_role;
grant all on public.ledger_vouchers to service_role;
grant all on public.ledger_voucher_lines to service_role;

revoke all on function public.prevent_posted_ledger_mutation() from public, anon, authenticated;
revoke all on function public.protect_system_ledger_account() from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';
