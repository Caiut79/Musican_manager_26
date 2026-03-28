create table if not exists public.app_state_snapshots (
  id uuid primary key default gen_random_uuid(),
  musician_id uuid not null references public.musician_registry_profiles(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_app_state_snapshots_musician_id
  on public.app_state_snapshots(musician_id);

alter table public.app_state_snapshots enable row level security;

drop policy if exists app_state_snapshots_authenticated_select on public.app_state_snapshots;
create policy app_state_snapshots_authenticated_select
on public.app_state_snapshots
for select
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = app_state_snapshots.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists app_state_snapshots_authenticated_insert on public.app_state_snapshots;
create policy app_state_snapshots_authenticated_insert
on public.app_state_snapshots
for insert
to authenticated
with check (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = app_state_snapshots.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists app_state_snapshots_authenticated_update on public.app_state_snapshots;
create policy app_state_snapshots_authenticated_update
on public.app_state_snapshots
for update
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = app_state_snapshots.musician_id
      and m.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = app_state_snapshots.musician_id
      and m.auth_user_id = auth.uid()
  )
);
