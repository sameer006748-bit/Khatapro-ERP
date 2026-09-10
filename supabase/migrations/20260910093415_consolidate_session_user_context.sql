-- Batch 3A: consolidate the fresh server-side SessionUser database context.
-- Supabase Auth Admin identity verification remains a separate, authoritative
-- call before this service-role-only RPC is invoked by the application.

create or replace function public.load_session_user_context(p_user_id uuid)
returns table (
  profile_id text,
  business_id text,
  role_id text,
  role_name text,
  display_name text,
  phone text,
  permission_codes text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    profile.id as profile_id,
    profile.business_id,
    role.id as role_id,
    role.name as role_name,
    profile.display_name,
    profile.phone,
    coalesce(
      array_agg(permission.code order by permission.code)
        filter (where permission.code is not null),
      '{}'::text[]
    ) as permission_codes
  from public.profiles profile
  join public.roles role
    on role.id = profile.role_id
   and role.business_id = profile.business_id
  left join public.role_permissions role_permission
    on role_permission.role_id = role.id
  left join public.permissions permission
    on permission.id = role_permission.permission_id
  where profile.user_id = p_user_id
    and profile.is_active
  group by
    profile.id,
    profile.business_id,
    role.id,
    role.name,
    profile.display_name,
    profile.phone
$$;

revoke execute on function public.load_session_user_context(uuid)
from public, anon, authenticated;

grant execute on function public.load_session_user_context(uuid)
to service_role;
