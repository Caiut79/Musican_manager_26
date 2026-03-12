create table if not exists public.archive_directory (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('musician', 'band')),
  entity_code text not null,
  display_name text,
  linked_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(entity_type, entity_code)
);

create index if not exists idx_archive_entity_type on public.archive_directory(entity_type);
create index if not exists idx_archive_entity_code on public.archive_directory(entity_code);
create index if not exists idx_archive_linked_code on public.archive_directory(linked_code);

drop trigger if exists trg_archive_directory_updated_at on public.archive_directory;
create trigger trg_archive_directory_updated_at
before update on public.archive_directory
for each row
execute function public.set_updated_at_timestamp();

create or replace function public.sync_archive_codes(
  p_musician_code text,
  p_band_code text,
  p_musician_name text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_musician_code text;
  v_band_code text;
begin
  v_musician_code := upper(btrim(coalesce(p_musician_code, '')));
  v_band_code := upper(btrim(coalesce(p_band_code, '')));

  if v_musician_code = '' or v_band_code = '' then
    return false;
  end if;

  insert into public.archive_directory(entity_type, entity_code, display_name, linked_code)
  values ('musician', v_musician_code, nullif(btrim(coalesce(p_musician_name, '')), ''), v_band_code)
  on conflict (entity_type, entity_code)
  do update set
    display_name = coalesce(excluded.display_name, public.archive_directory.display_name),
    linked_code = excluded.linked_code,
    updated_at = now();

  insert into public.archive_directory(entity_type, entity_code, display_name, linked_code)
  values ('band', v_band_code, null, v_musician_code)
  on conflict (entity_type, entity_code)
  do update set
    linked_code = excluded.linked_code,
    updated_at = now();

  return true;
end;
$$;

grant execute on function public.sync_archive_codes(text, text, text) to authenticated;
