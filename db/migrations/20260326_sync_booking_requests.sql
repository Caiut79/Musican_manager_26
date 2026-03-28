create table if not exists public.booking_requests (
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

alter table if exists public.booking_requests
  add column if not exists musician_id uuid null references public.musician_registry_profiles(id) on delete cascade,
  add column if not exists source_id text,
  add column if not exists batch_id text null,
  add column if not exists musician_slug text,
  add column if not exists musician_name text null,
  add column if not exists role text not null default 'musician',
  add column if not exists role_label text null,
  add column if not exists affiliation_code text null,
  add column if not exists source_type text not null default 'link',
  add column if not exists allow_band_invites boolean not null default true,
  add column if not exists customer_name text,
  add column if not exists band_name text null,
  add column if not exists customer_email text null,
  add column if not exists customer_phone text null,
  add column if not exists event_city text null,
  add column if not exists event_province text null,
  add column if not exists event_date text null,
  add column if not exists event_time text null,
  add column if not exists event_type text null,
  add column if not exists booking_code text null,
  add column if not exists message text null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists status text not null default 'new',
  add column if not exists status_updated_at timestamptz null,
  add column if not exists confirmed_at timestamptz null,
  add column if not exists confirmation_sent_at timestamptz null,
  add column if not exists receipt_sent_at timestamptz null,
  add column if not exists declined_at timestamptz null,
  add column if not exists contact_id text null,
  add column if not exists internal_notes text null,
  add column if not exists payload jsonb not null default '{}'::jsonb;

update public.booking_requests
set
  source_id = coalesce(nullif(btrim(source_id), ''), id::text),
  musician_slug = coalesce(nullif(btrim(musician_slug), ''), 'legacy-booking'),
  customer_name = coalesce(nullif(btrim(customer_name), ''), 'Richiesta'),
  role = coalesce(nullif(btrim(role), ''), 'musician'),
  source_type = coalesce(nullif(btrim(source_type), ''), 'link'),
  status = coalesce(nullif(btrim(status), ''), 'new'),
  payload = coalesce(payload, '{}'::jsonb)
where source_id is null
   or musician_slug is null
   or customer_name is null
   or role is null
   or source_type is null
   or status is null
   or payload is null;

create unique index if not exists idx_booking_requests_source_id
  on public.booking_requests(source_id);

create index if not exists idx_booking_requests_musician_id_created_at
  on public.booking_requests(musician_id, created_at desc);

create index if not exists idx_booking_requests_slug_created_at
  on public.booking_requests(musician_slug, created_at desc);

create index if not exists idx_booking_requests_affiliation_code_created_at
  on public.booking_requests(affiliation_code, created_at desc);

do $$
declare
  v_con record;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.booking_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.booking_requests drop constraint if exists %I', v_con.conname);
  end loop;

  alter table public.booking_requests
    add constraint booking_requests_status_check
    check (status in ('new', 'confirmed', 'receipt_sent', 'declined'));
end $$;

alter table public.booking_requests enable row level security;

drop policy if exists booking_requests_anon_insert on public.booking_requests;
create policy booking_requests_anon_insert
on public.booking_requests
for insert
to anon, authenticated
with check (
  nullif(btrim(musician_slug), '') is not null
  and nullif(btrim(customer_name), '') is not null
  and nullif(btrim(source_id), '') is not null
);

drop policy if exists booking_requests_authenticated_select on public.booking_requests;
create policy booking_requests_authenticated_select
on public.booking_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = booking_requests.musician_id
      and m.auth_user_id = auth.uid()
  )
);

drop policy if exists booking_requests_authenticated_update on public.booking_requests;
create policy booking_requests_authenticated_update
on public.booking_requests
for update
to authenticated
using (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = booking_requests.musician_id
      and m.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.musician_registry_profiles m
    where m.id = booking_requests.musician_id
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

  update public.booking_requests b
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
returns setof public.booking_requests
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
    update public.booking_requests b
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
  from public.booking_requests b
  where b.musician_id = v_profile_id
  order by b.created_at desc;
end;
$$;

grant execute on function public.sync_my_booking_requests(text, text) to authenticated;
