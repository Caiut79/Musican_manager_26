create schema if not exists solo;

create sequence if not exists solo.musician_code_seq start with 1 increment by 1;

create or replace function solo.generate_musician_code()
returns text
language sql
as $$
  select 'MU' || to_char(nextval('solo.musician_code_seq'), 'FM0000');
$$;

create table if not exists solo.musicians (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default solo.generate_musician_code(),
  first_name text not null,
  last_name text not null,
  empals_position text,
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
  created_at timestamptz not null default now()
);

create index if not exists idx_musicians_code on solo.musicians(code);
create index if not exists idx_musicians_search_styles on solo.musicians using gin(searchable_styles);
create index if not exists idx_musicians_styles on solo.musicians using gin(styles_played);

create table if not exists solo.events (
  id uuid primary key default gen_random_uuid(),
  musician_id uuid not null references solo.musicians(id) on delete cascade,
  title text not null,
  date date not null,
  type text not null check (type in ('lesson','concert')),
  created_at timestamptz not null default now()
);

create index if not exists idx_events_musician on solo.events(musician_id);
create index if not exists idx_events_date on solo.events(date);
