create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  musician_id uuid not null references public.musician_registry_profiles(id) on delete cascade,
  source_id text not null,
  type text not null default 'band',
  display_name text not null,
  phone text null,
  email text null,
  priority integer not null default 3,
  average_fee numeric(12,2) not null default 0,
  billing_mode text null,
  payment_cadence text null,
  monthly_settlement text null,
  city text null,
  address text null,
  notes text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.contacts
  add column if not exists musician_id uuid null references public.musician_registry_profiles(id) on delete cascade,
  add column if not exists source_id text,
  add column if not exists type text not null default 'band',
  add column if not exists display_name text,
  add column if not exists phone text null,
  add column if not exists email text null,
  add column if not exists priority integer not null default 3,
  add column if not exists average_fee numeric(12,2) not null default 0,
  add column if not exists billing_mode text null,
  add column if not exists payment_cadence text null,
  add column if not exists monthly_settlement text null,
  add column if not exists city text null,
  add column if not exists address text null,
  add column if not exists notes text null,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.contacts
set
  source_id = coalesce(nullif(btrim(source_id), ''), id::text),
  type = coalesce(nullif(btrim(type), ''), 'band'),
  display_name = coalesce(nullif(btrim(display_name), ''), nullif(btrim(email), ''), nullif(btrim(phone), ''), 'Contatto'),
  priority = coalesce(priority, 3),
  average_fee = coalesce(average_fee, 0),
  payload = coalesce(payload, '{}'::jsonb),
  updated_at = coalesce(updated_at, created_at, now())
where source_id is null
   or type is null
   or display_name is null
   or priority is null
   or average_fee is null
   or payload is null
   or updated_at is null;

create unique index if not exists idx_contacts_musician_source
  on public.contacts(musician_id, source_id);

create index if not exists idx_contacts_musician_priority_name
  on public.contacts(musician_id, priority, display_name);

do $$
declare
  v_con record;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.contacts'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ilike '%billing_mode%'
        or pg_get_constraintdef(oid) ilike '%payment_cadence%'
        or pg_get_constraintdef(oid) ilike '%monthly_settlement%'
      )
  loop
    execute format('alter table public.contacts drop constraint if exists %I', v_con.conname);
  end loop;

  alter table public.contacts
    add constraint contacts_billing_mode_check
    check (billing_mode is null or billing_mode in ('in_fattura', 'fuori_fattura'));

  alter table public.contacts
    add constraint contacts_payment_cadence_check
    check (payment_cadence is null or payment_cadence in ('prestazione', 'mensile'));

  alter table public.contacts
    add constraint contacts_monthly_settlement_check
    check (monthly_settlement is null or monthly_settlement in ('acconto', 'bonifico'));
end $$;

alter table public.contacts enable row level security;

drop policy if exists contacts_authenticated_select on public.contacts;
create policy contacts_authenticated_select
on public.contacts
for select
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = contacts.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists contacts_authenticated_insert on public.contacts;
create policy contacts_authenticated_insert
on public.contacts
for insert
to authenticated
with check (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = contacts.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists contacts_authenticated_update on public.contacts;
create policy contacts_authenticated_update
on public.contacts
for update
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = contacts.musician_id
      and m.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = contacts.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists contacts_authenticated_delete on public.contacts;
create policy contacts_authenticated_delete
on public.contacts
for delete
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = contacts.musician_id
      and m.auth_user_id = auth.uid()
  )
);
