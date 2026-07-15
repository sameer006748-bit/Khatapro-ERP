-- ============================================================================
-- KhataPro ERP â€” Phase 10: AI Provider Settings (Gemini API key storage)
--
-- This migration is NOT applied yet. It is a design document and future
-- migration script. Apply only after review and when Supabase is available.
--
-- Security model:
--   - encrypted_api_key is ALWAYS encrypted server-side before storage.
--   - RLS prevents direct browser/anon reads of encrypted data.
--   - Service-role access can bypass RLS, so Owner/Admin authorization is
--     also enforced INSIDE every API route before any database operation.
--   - Only the last 4 characters (key_last4) are shown in the UI for
--     masked display. The full encrypted ciphertext is never returned.
-- ============================================================================

-- begin; -- Uncomment when applying

-- ============================================================================
-- TABLE: public.ai_provider_settings
-- ============================================================================
create table if not exists public.ai_provider_settings (
  id                text primary key default gen_random_uuid()::text,
  business_id       text not null references public.business(id) on delete cascade,
  provider          text not null default 'gemini',
  encrypted_api_key text not null,
  key_last4         text not null,
  encryption_key_id text not null,
  connection_status text not null default 'not_tested'
                    check (connection_status in (
                      'not_tested', 'connected', 'invalid', 'failed', 'configuration_error'
                    )),
  last_tested_at    timestamptz,
  last_error_code   text,
  created_by        uuid references auth.users(id) on delete set null,
  updated_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ai_provider_settings_unique unique (business_id, provider)
);

-- â”€â”€ Indexes â”€â”€
create index if not exists ai_provider_settings_biz_idx
  on public.ai_provider_settings(business_id);

-- â”€â”€ Updated-at trigger â”€â”€
create or replace function public._update_ai_provider_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ai_provider_settings_updated_at on public.ai_provider_settings;
create trigger trg_ai_provider_settings_updated_at
  before update on public.ai_provider_settings
  for each row execute function public._update_ai_provider_settings_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.ai_provider_settings enable row level security;

-- NORMAL browser users (via anon/authenticated) should NEVER read the
-- encrypted_api_key. Only trusted server-side code (service_role) operates
-- on this table. RLS blocks all direct browser reads of the sensitive column.
--
-- However, because service_role bypasses RLS, Owner/Admin authorization MUST
-- also be enforced inside every API route handler before touching this table.

-- Deny all direct DML from anon and authenticated roles
revoke all on public.ai_provider_settings from anon;
revoke all on public.ai_provider_settings from authenticated;
revoke all on public.ai_provider_settings from public;

-- Service role (server-side) gets full access (bypasses RLS by default).
grant all on public.ai_provider_settings to service_role;

-- ============================================================================
-- Permission code for seed data (not applied automatically)
-- ============================================================================
-- INSERT INTO public.permissions (id, code, module, description)
-- VALUES (gen_random_uuid(), 'can_manage_ai_settings', 'ai', 'Can configure AI settings and API keys')
-- ON CONFLICT (code) DO NOTHING;
--
-- -- Link to Owner/Admin role (adjust role_id for your business)
-- INSERT INTO public.role_permissions (id, role_id, permission_id)
-- SELECT gen_random_uuid(), r.id, p.id
-- FROM public.roles r, public.permissions p
-- WHERE r.name = 'Owner/Admin' AND r.is_system = true
--   AND p.code = 'can_manage_ai_settings'
-- ON CONFLICT DO NOTHING;

-- commit; -- Uncomment when applying