create extension if not exists pgcrypto;

create sequence if not exists public.musician_code_seq start with 1 increment by 1;

create or replace function public.generate_musician_code()
returns text
language sql
as $$
  select 'MU' || to_char(nextval('public.musician_code_seq'), 'FM0000');
$$;

create table if not exists public.musicians (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default public.generate_musician_code(),
  first_name text not null,
  last_name text not null,
  phone text,
  birth_date date,
  birth_place text,
  fiscal_code text,
  residence text,
  worker_type text check (worker_type in ('cooperativa', 'libero_professionista', 'insegnante_piva', 'esente')),
  empals_position text,
  enpals_category text,
  exempt_employer text,
  exempt_employer_type text check (exempt_employer_type in ('dipendente', 'pensionato', 'altro')),
  inps_number text,
  inps_start_date date,
  inps_end_date date,
  home_base text,
  instrument text,
  level text,
  styles_played text[] default array[]::text[],
  searchable_styles text[] default array[]::text[],
  social jsonb not null default '{}'::jsonb,
  inps_exempt boolean not null default false,
  inps_data jsonb,
  is_teacher boolean not null default false,
  lesson_color text,
  concert_color text,
  signature_data text,
  owner_user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);

alter table if exists public.musicians
  add column if not exists code text,
  add column if not exists owner_user_id uuid default auth.uid(),
  add column if not exists searchable_styles text[] default array[]::text[],
  add column if not exists styles_played text[] default array[]::text[];

alter table if exists public.musicians
  alter column code set default public.generate_musician_code();

update public.musicians
set code = public.generate_musician_code()
where code is null or btrim(code) = '';

create index if not exists idx_public_musicians_code on public.musicians(code);
create index if not exists idx_public_musicians_owner on public.musicians(owner_user_id);
create index if not exists idx_public_musicians_search_styles on public.musicians using gin(searchable_styles);
create index if not exists idx_public_musicians_styles on public.musicians using gin(styles_played);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  musician_id uuid not null references public.musicians(id) on delete cascade,
  source_id text,
  title text not null,
  date date not null,
  type text not null check (type in ('lesson', 'concert')),
  time_start text,
  time_end text,
  venue text,
  address text,
  gross_fee numeric(10, 2),
  net_fee numeric(10, 2),
  compens_type text check (compens_type in ('fuori_fattura', 'in_fattura')),
  notes text,
  status text,
  band jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table if exists public.events
  add column if not exists musician_id uuid,
  add column if not exists source_id text,
  add column if not exists title text,
  add column if not exists date date,
  add column if not exists type text,
  add column if not exists time_start text,
  add column if not exists time_end text,
  add column if not exists venue text,
  add column if not exists address text,
  add column if not exists gross_fee numeric(10, 2),
  add column if not exists net_fee numeric(10, 2),
  add column if not exists compens_type text,
  add column if not exists notes text,
  add column if not exists status text,
  add column if not exists band jsonb default '[]'::jsonb,
  add column if not exists created_at timestamptz default now();

create unique index if not exists idx_public_events_musician_source on public.events(musician_id, source_id);
create index if not exists idx_public_events_musician on public.events(musician_id);
create index if not exists idx_public_events_date on public.events(date);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  musician_id uuid not null references public.musicians(id) on delete cascade,
  source_id text,
  event_source_id text,
  date date not null,
  origin text not null,
  destination text not null,
  origin_lat double precision,
  origin_lon double precision,
  dest_lat double precision,
  dest_lon double precision,
  distance_km numeric(10, 2) not null,
  fuel_cost_per_km numeric(10, 3) not null,
  fuel_price_per_liter numeric(6, 3),
  vehicle_consumption numeric(6, 2),
  extras jsonb not null default '[]'::jsonb,
  total_fuel numeric(10, 2) not null,
  total_extras numeric(10, 2) not null,
  total_expense numeric(10, 2) not null,
  created_at timestamptz not null default now()
);

alter table if exists public.expenses
  add column if not exists musician_id uuid,
  add column if not exists source_id text,
  add column if not exists event_source_id text,
  add column if not exists date date,
  add column if not exists origin text,
  add column if not exists destination text,
  add column if not exists origin_lat double precision,
  add column if not exists origin_lon double precision,
  add column if not exists dest_lat double precision,
  add column if not exists dest_lon double precision,
  add column if not exists distance_km numeric(10, 2),
  add column if not exists fuel_cost_per_km numeric(10, 3),
  add column if not exists fuel_price_per_liter numeric(6, 3),
  add column if not exists vehicle_consumption numeric(6, 2),
  add column if not exists extras jsonb default '[]'::jsonb,
  add column if not exists total_fuel numeric(10, 2),
  add column if not exists total_extras numeric(10, 2),
  add column if not exists total_expense numeric(10, 2),
  add column if not exists created_at timestamptz default now();

create unique index if not exists idx_public_expenses_musician_source on public.expenses(musician_id, source_id);
create index if not exists idx_public_expenses_musician on public.expenses(musician_id);
create index if not exists idx_public_expenses_date on public.expenses(date);

do $$
begin
  if to_regclass('solo.musicians') is not null then
    begin
      insert into public.musicians (
        id, first_name, last_name, phone, birth_date, birth_place, fiscal_code, residence,
        worker_type, empals_position, enpals_category, exempt_employer, exempt_employer_type,
        inps_number, inps_start_date, inps_end_date, home_base, instrument, level, styles_played,
        searchable_styles, social, inps_exempt, inps_data, is_teacher, lesson_color, concert_color,
        signature_data, owner_user_id, created_at
      )
      select
        id, first_name, last_name, phone, birth_date, birth_place, fiscal_code, residence,
        worker_type, empals_position, enpals_category, exempt_employer, exempt_employer_type,
        inps_number, inps_start_date, inps_end_date, home_base, instrument, level, styles_played,
        searchable_styles, social, inps_exempt, inps_data, is_teacher, lesson_color, concert_color,
        signature_data, owner_user_id, created_at
      from solo.musicians
      on conflict (id) do nothing;
    exception
      when undefined_column then
        null;
    end;
  end if;

  if to_regclass('solo.events') is not null then
    begin
      insert into public.events (
        id, musician_id, source_id, title, date, type, time_start, time_end, venue, address,
        gross_fee, net_fee, compens_type, notes, status, band, created_at
      )
      select
        id, musician_id, source_id, title, date, type, time_start, time_end, venue, address,
        gross_fee, net_fee, compens_type, notes, status, band, created_at
      from solo.events
      on conflict (id) do nothing;
    exception
      when undefined_column then
        null;
    end;
  end if;

  if to_regclass('solo.expenses') is not null then
    begin
      insert into public.expenses (
        id, musician_id, source_id, event_source_id, date, origin, destination, origin_lat, origin_lon,
        dest_lat, dest_lon, distance_km, fuel_cost_per_km, fuel_price_per_liter, vehicle_consumption,
        extras, total_fuel, total_extras, total_expense, created_at
      )
      select
        id, musician_id, source_id, event_source_id, date, origin, destination, origin_lat, origin_lon,
        dest_lat, dest_lon, distance_km, fuel_cost_per_km, fuel_price_per_liter, vehicle_consumption,
        extras, total_fuel, total_extras, total_expense, created_at
      from solo.expenses
      on conflict (id) do nothing;
    exception
      when undefined_column then
        null;
    end;
  end if;
end $$;
