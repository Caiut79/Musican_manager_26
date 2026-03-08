create schema if not exists solo;

alter table if exists solo.musicians
  add column if not exists phone text,
  add column if not exists birth_date date,
  add column if not exists birth_place text,
  add column if not exists fiscal_code text,
  add column if not exists residence text,
  add column if not exists worker_type text,
  add column if not exists enpals_category text,
  add column if not exists exempt_employer text,
  add column if not exists exempt_employer_type text,
  add column if not exists inps_number text,
  add column if not exists inps_start_date date,
  add column if not exists inps_end_date date,
  add column if not exists signature_data text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'solo_musicians_worker_type_check'
  ) then
    alter table solo.musicians
      add constraint solo_musicians_worker_type_check
      check (worker_type in ('cooperativa', 'libero_professionista', 'insegnante_piva', 'esente'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'solo_musicians_exempt_employer_type_check'
  ) then
    alter table solo.musicians
      add constraint solo_musicians_exempt_employer_type_check
      check (exempt_employer_type in ('dipendente', 'pensionato', 'altro'));
  end if;
end $$;

alter table if exists solo.events
  add column if not exists source_id text,
  add column if not exists time_start text,
  add column if not exists time_end text,
  add column if not exists venue text,
  add column if not exists address text,
  add column if not exists gross_fee numeric(10, 2),
  add column if not exists net_fee numeric(10, 2),
  add column if not exists compens_type text,
  add column if not exists notes text,
  add column if not exists status text,
  add column if not exists band jsonb not null default '[]'::jsonb;

alter table if exists solo.events
  alter column time_end drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'solo_events_compens_type_check'
  ) then
    alter table solo.events
      add constraint solo_events_compens_type_check
      check (compens_type in ('fuori_fattura', 'in_fattura'));
  end if;
end $$;

create unique index if not exists idx_events_musician_source on solo.events(musician_id, source_id);

create table if not exists solo.expenses (
  id uuid primary key default gen_random_uuid(),
  musician_id uuid not null references solo.musicians(id) on delete cascade,
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

alter table if exists solo.expenses
  add column if not exists fuel_price_per_liter numeric(6, 3),
  add column if not exists vehicle_consumption numeric(6, 2);

create index if not exists idx_expenses_musician on solo.expenses(musician_id);
create index if not exists idx_expenses_date on solo.expenses(date);
create unique index if not exists idx_expenses_musician_source on solo.expenses(musician_id, source_id);
