create sequence if not exists public.musician_affiliation_code_seq start with 1 increment by 1;

create or replace function public.next_musician_affiliation_code()
returns text
language sql
as $$
  select 'MU' || to_char(nextval('public.musician_affiliation_code_seq'), 'FM0000');
$$;

alter table if exists public.app_licenses
  add column if not exists affiliation_code text;

create unique index if not exists idx_app_licenses_affiliation_code_unique
  on public.app_licenses(affiliation_code)
  where affiliation_code is not null;

create or replace function public.assign_affiliation_code_to_license()
returns trigger
language plpgsql
as $$
begin
  if new.app_key = 'musician_manager' and (new.affiliation_code is null or btrim(new.affiliation_code) = '') then
    new.affiliation_code = public.next_musician_affiliation_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_affiliation_code_to_license on public.app_licenses;
create trigger trg_assign_affiliation_code_to_license
before insert or update on public.app_licenses
for each row
execute function public.assign_affiliation_code_to_license();

update public.app_licenses
set affiliation_code = public.next_musician_affiliation_code()
where app_key = 'musician_manager'
  and (affiliation_code is null or btrim(affiliation_code) = '');

create or replace function public.get_or_create_musician_affiliation_code(
  p_app_key text default 'musician_manager'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_id uuid;
  v_code text;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_email = '' then
    return null;
  end if;

  select l.id, l.affiliation_code
  into v_id, v_code
  from public.app_licenses l
  where l.app_key = p_app_key
    and (
      lower(coalesce(l.subject_key, '')) = v_email
      or lower(coalesce(l.metadata ->> 'email', '')) = v_email
      or lower(coalesce(l.metadata ->> 'user_email', '')) = v_email
    )
  order by l.updated_at desc nulls last, l.created_at desc
  limit 1;

  if v_id is null then
    return null;
  end if;

  if v_code is null or btrim(v_code) = '' then
    v_code := public.next_musician_affiliation_code();
    update public.app_licenses
    set affiliation_code = v_code
    where id = v_id;
  end if;

  return v_code;
end;
$$;

grant execute on function public.get_or_create_musician_affiliation_code(text) to authenticated;
