create table if not exists public.app_licenses (
  id uuid primary key default gen_random_uuid(),
  app_key text not null,
  subject_type text not null,
  subject_key text not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
  starts_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_app_licenses_unique_subject
  on public.app_licenses(app_key, subject_type, subject_key);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_licenses_updated_at on public.app_licenses;
create trigger trg_app_licenses_updated_at
before update on public.app_licenses
for each row
execute function public.set_updated_at_timestamp();

create or replace function public.is_app_license_active(
  p_app_key text,
  p_subject_type text,
  p_subject_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_licenses l
    where l.app_key = p_app_key
      and l.subject_type = p_subject_type
      and l.subject_key = p_subject_key
      and l.status = 'active'
      and (l.starts_at is null or l.starts_at <= now())
      and (l.expires_at is null or l.expires_at >= now())
  );
$$;

grant execute on function public.is_app_license_active(text, text, text) to anon, authenticated;
