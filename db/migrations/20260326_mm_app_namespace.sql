create table if not exists public.mm_events (
  id uuid primary key default gen_random_uuid(),
  musician_id uuid not null references public.musician_registry_profiles(id) on delete cascade,
  source_id text not null,
  title text not null,
  date date not null,
  type text not null,
  time_start text null,
  time_end text null,
  venue text null,
  address text null,
  gross_fee numeric(10,2) null,
  net_fee numeric(10,2) null,
  compens_type text null,
  notes text null,
  status text null,
  band jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_mm_events_musician_source
  on public.mm_events(musician_id, source_id);

create index if not exists idx_mm_events_musician_date
  on public.mm_events(musician_id, date desc, created_at desc);

insert into public.mm_events (
  musician_id, source_id, title, date, type, time_start, time_end, venue, address,
  gross_fee, net_fee, compens_type, notes, status, band, created_at
)
select
  e.musician_id, coalesce(nullif(btrim(e.source_id), ''), e.id::text), e.title, e.date, e.type, e.time_start, e.time_end, e.venue, e.address,
  e.gross_fee, e.net_fee, e.compens_type, e.notes, e.status, coalesce(e.band, '[]'::jsonb), coalesce(e.created_at, now())
from public.events e
where exists (
  select 1
  from public.musician_registry_profiles r
  where r.id = e.musician_id
)
on conflict (musician_id, source_id) do nothing;

alter table public.mm_events enable row level security;

drop policy if exists mm_events_authenticated_select on public.mm_events;
create policy mm_events_authenticated_select
on public.mm_events
for select
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_events.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists mm_events_authenticated_insert on public.mm_events;
create policy mm_events_authenticated_insert
on public.mm_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_events.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists mm_events_authenticated_update on public.mm_events;
create policy mm_events_authenticated_update
on public.mm_events
for update
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_events.musician_id
      and m.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_events.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists mm_events_authenticated_delete on public.mm_events;
create policy mm_events_authenticated_delete
on public.mm_events
for delete
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_events.musician_id
      and m.auth_user_id = auth.uid()
  )
);

create table if not exists public.mm_expenses (
  id uuid primary key default gen_random_uuid(),
  musician_id uuid not null references public.musician_registry_profiles(id) on delete cascade,
  source_id text not null,
  event_source_id text null,
  date date not null,
  origin text not null,
  destination text not null,
  origin_lat double precision null,
  origin_lon double precision null,
  dest_lat double precision null,
  dest_lon double precision null,
  distance_km numeric(10,2) not null,
  fuel_cost_per_km numeric(10,3) not null,
  fuel_price_per_liter numeric(6,3) null,
  vehicle_consumption numeric(6,2) null,
  extras jsonb not null default '[]'::jsonb,
  total_fuel numeric(10,2) not null,
  total_extras numeric(10,2) not null,
  total_expense numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_mm_expenses_musician_source
  on public.mm_expenses(musician_id, source_id);

create index if not exists idx_mm_expenses_musician_date
  on public.mm_expenses(musician_id, date desc, created_at desc);

insert into public.mm_expenses (
  musician_id, source_id, event_source_id, date, origin, destination, origin_lat, origin_lon,
  dest_lat, dest_lon, distance_km, fuel_cost_per_km, fuel_price_per_liter, vehicle_consumption,
  extras, total_fuel, total_extras, total_expense, created_at
)
select
  e.musician_id, coalesce(nullif(btrim(e.source_id), ''), e.id::text), e.event_source_id, e.date, e.origin, e.destination, e.origin_lat, e.origin_lon,
  e.dest_lat, e.dest_lon, e.distance_km, e.fuel_cost_per_km, e.fuel_price_per_liter, e.vehicle_consumption,
  coalesce(e.extras, '[]'::jsonb), e.total_fuel, e.total_extras, e.total_expense, coalesce(e.created_at, now())
from public.expenses e
where exists (
  select 1
  from public.musician_registry_profiles r
  where r.id = e.musician_id
)
on conflict (musician_id, source_id) do nothing;

alter table public.mm_expenses enable row level security;

drop policy if exists mm_expenses_authenticated_select on public.mm_expenses;
create policy mm_expenses_authenticated_select
on public.mm_expenses
for select
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_expenses.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists mm_expenses_authenticated_insert on public.mm_expenses;
create policy mm_expenses_authenticated_insert
on public.mm_expenses
for insert
to authenticated
with check (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_expenses.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists mm_expenses_authenticated_update on public.mm_expenses;
create policy mm_expenses_authenticated_update
on public.mm_expenses
for update
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_expenses.musician_id
      and m.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_expenses.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists mm_expenses_authenticated_delete on public.mm_expenses;
create policy mm_expenses_authenticated_delete
on public.mm_expenses
for delete
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_expenses.musician_id
      and m.auth_user_id = auth.uid()
  )
);

create table if not exists public.mm_contacts (
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

create unique index if not exists idx_mm_contacts_musician_source
  on public.mm_contacts(musician_id, source_id);

create index if not exists idx_mm_contacts_musician_priority_name
  on public.mm_contacts(musician_id, priority, display_name);

insert into public.mm_contacts (
  musician_id, source_id, type, display_name, phone, email, priority, average_fee,
  billing_mode, payment_cadence, monthly_settlement, city, address, notes, payload, created_at, updated_at
)
select
  c.musician_id,
  coalesce(nullif(btrim(c.source_id), ''), c.id::text),
  coalesce(nullif(btrim(c.type), ''), 'band'),
  coalesce(nullif(btrim(c.display_name), ''), 'Contatto'),
  c.phone,
  c.email,
  coalesce(c.priority, 3),
  coalesce(c.average_fee, 0),
  c.billing_mode,
  c.payment_cadence,
  c.monthly_settlement,
  c.city,
  c.address,
  c.notes,
  coalesce(c.payload, '{}'::jsonb),
  coalesce(c.created_at, now()),
  coalesce(c.updated_at, c.created_at, now())
from public.contacts c
where exists (
  select 1
  from information_schema.columns ic
  where ic.table_schema = 'public'
    and ic.table_name = 'contacts'
    and ic.column_name = 'musician_id'
)
  and exists (
    select 1
    from public.musician_registry_profiles r
    where r.id = c.musician_id
)
on conflict (musician_id, source_id) do nothing;

alter table public.mm_contacts enable row level security;

drop policy if exists mm_contacts_authenticated_select on public.mm_contacts;
create policy mm_contacts_authenticated_select
on public.mm_contacts
for select
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_contacts.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists mm_contacts_authenticated_insert on public.mm_contacts;
create policy mm_contacts_authenticated_insert
on public.mm_contacts
for insert
to authenticated
with check (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_contacts.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists mm_contacts_authenticated_update on public.mm_contacts;
create policy mm_contacts_authenticated_update
on public.mm_contacts
for update
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_contacts.musician_id
      and m.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_contacts.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists mm_contacts_authenticated_delete on public.mm_contacts;
create policy mm_contacts_authenticated_delete
on public.mm_contacts
for delete
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_contacts.musician_id
      and m.auth_user_id = auth.uid()
  )
);

create table if not exists public.mm_booking_requests (
  id uuid primary key default gen_random_uuid(),
  musician_id uuid null references public.musician_registry_profiles(id) on delete cascade,
  source_id text not null,
  batch_id text null,
  musician_slug text not null,
  musician_name text null,
  role text not null default 'musician',
  role_label text null,
  affiliation_code text null,
  source_type text not null default 'link',
  allow_band_invites boolean not null default true,
  customer_name text not null,
  band_name text null,
  customer_email text null,
  customer_phone text null,
  event_city text null,
  event_province text null,
  event_date text null,
  event_time text null,
  event_type text null,
  booking_code text null,
  message text null,
  created_at timestamptz not null default now(),
  status text not null default 'new',
  status_updated_at timestamptz null,
  confirmed_at timestamptz null,
  confirmation_sent_at timestamptz null,
  receipt_sent_at timestamptz null,
  declined_at timestamptz null,
  contact_id text null,
  internal_notes text null,
  payload jsonb not null default '{}'::jsonb
);

create unique index if not exists idx_mm_booking_requests_source_id
  on public.mm_booking_requests(source_id);

create index if not exists idx_mm_booking_requests_musician_created_at
  on public.mm_booking_requests(musician_id, created_at desc);

create index if not exists idx_mm_booking_requests_affiliation_created_at
  on public.mm_booking_requests(affiliation_code, created_at desc);

insert into public.mm_booking_requests (
  musician_id, source_id, batch_id, musician_slug, musician_name, role, role_label, affiliation_code,
  source_type, allow_band_invites, customer_name, band_name, customer_email, customer_phone, event_city,
  event_province, event_date, event_time, event_type, booking_code, message, created_at, status,
  status_updated_at, confirmed_at, confirmation_sent_at, receipt_sent_at, declined_at, contact_id,
  internal_notes, payload
)
select
  b.musician_id, coalesce(nullif(btrim(b.source_id), ''), b.id::text), b.batch_id, b.musician_slug, b.musician_name, b.role, b.role_label, b.affiliation_code,
  b.source_type, coalesce(b.allow_band_invites, true), b.customer_name, b.band_name, b.customer_email, b.customer_phone, b.event_city,
  b.event_province, b.event_date, b.event_time, b.event_type, b.booking_code, b.message, coalesce(b.created_at, now()), b.status,
  b.status_updated_at, b.confirmed_at, b.confirmation_sent_at, b.receipt_sent_at, b.declined_at, b.contact_id,
  b.internal_notes, coalesce(b.payload, '{}'::jsonb)
from public.booking_requests b
on conflict (source_id) do nothing;

alter table public.mm_booking_requests enable row level security;

drop policy if exists mm_booking_requests_anon_insert on public.mm_booking_requests;
create policy mm_booking_requests_anon_insert
on public.mm_booking_requests
for insert
to anon, authenticated
with check (
  nullif(btrim(musician_slug), '') is not null
  and nullif(btrim(customer_name), '') is not null
  and nullif(btrim(source_id), '') is not null
);

drop policy if exists mm_booking_requests_authenticated_select on public.mm_booking_requests;
create policy mm_booking_requests_authenticated_select
on public.mm_booking_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_booking_requests.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists mm_booking_requests_authenticated_update on public.mm_booking_requests;
create policy mm_booking_requests_authenticated_update
on public.mm_booking_requests
for update
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_booking_requests.musician_id
      and m.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_booking_requests.musician_id
      and m.auth_user_id = auth.uid()
  )
);

create table if not exists public.mm_state_snapshots (
  id uuid primary key default gen_random_uuid(),
  musician_id uuid not null references public.musician_registry_profiles(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_mm_state_snapshots_musician
  on public.mm_state_snapshots(musician_id);

insert into public.mm_state_snapshots (musician_id, payload, created_at, updated_at)
select musician_id, payload, coalesce(created_at, now()), coalesce(updated_at, now())
from public.app_state_snapshots
on conflict (musician_id) do update
set payload = excluded.payload,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

alter table public.mm_state_snapshots enable row level security;

drop policy if exists mm_state_snapshots_authenticated_select on public.mm_state_snapshots;
create policy mm_state_snapshots_authenticated_select
on public.mm_state_snapshots
for select
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_state_snapshots.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists mm_state_snapshots_authenticated_insert on public.mm_state_snapshots;
create policy mm_state_snapshots_authenticated_insert
on public.mm_state_snapshots
for insert
to authenticated
with check (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_state_snapshots.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists mm_state_snapshots_authenticated_update on public.mm_state_snapshots;
create policy mm_state_snapshots_authenticated_update
on public.mm_state_snapshots
for update
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_state_snapshots.musician_id
      and m.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = mm_state_snapshots.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop function if exists public.claim_musician_booking_requests(uuid, text, text);
drop function if exists public.claim_musician_booking_requests(uuid, text);
drop function if exists public.sync_my_booking_requests(text, text);
drop function if exists public.sync_my_booking_requests(text);

create function public.claim_musician_booking_requests(
  p_musician_id uuid,
  p_musician_slug text default null,
  p_affiliation_code text default null
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_slug text;
  v_code text;
  v_count integer := 0;
begin
  v_slug := lower(nullif(btrim(coalesce(p_musician_slug, '')), ''));
  v_code := upper(nullif(btrim(coalesce(p_affiliation_code, '')), ''));

  if auth.uid() is null or p_musician_id is null or (v_slug is null and v_code is null) then
    return 0;
  end if;

  if not exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = p_musician_id
      and m.auth_user_id = auth.uid()
  ) then
    return 0;
  end if;

  update public.mm_booking_requests b
  set musician_id = p_musician_id
  where b.musician_id is null
    and (
      (v_slug is not null and lower(btrim(coalesce(b.musician_slug, ''))) = v_slug)
      or (v_code is not null and upper(btrim(coalesce(b.affiliation_code, ''))) = v_code)
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.claim_musician_booking_requests(uuid, text, text) to authenticated;

create function public.sync_my_booking_requests(
  p_musician_slug text default null,
  p_affiliation_code text default null
)
returns setof public.mm_booking_requests
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_slug text;
  v_code text;
  v_profile_id uuid;
begin
  v_slug := lower(nullif(btrim(coalesce(p_musician_slug, '')), ''));
  v_code := upper(nullif(btrim(coalesce(p_affiliation_code, '')), ''));

  if auth.uid() is null then
    return;
  end if;

  select m.id
  into v_profile_id
  from public.musician_registry_profiles m
  where m.auth_user_id = auth.uid()
  order by m.updated_at desc nulls last, m.created_at desc nulls last
  limit 1;

  if v_profile_id is not null and (v_slug is not null or v_code is not null) then
    update public.mm_booking_requests b
    set musician_id = v_profile_id
    where b.musician_id is null
      and (
        (v_slug is not null and lower(btrim(coalesce(b.musician_slug, ''))) = v_slug)
        or (v_code is not null and upper(btrim(coalesce(b.affiliation_code, ''))) = v_code)
      );
  end if;

  if v_profile_id is null then
    return;
  end if;

  return query
  select b.*
  from public.mm_booking_requests b
  where b.musician_id = v_profile_id
  order by b.created_at desc;
end;
$$;

grant execute on function public.sync_my_booking_requests(text, text) to authenticated;
