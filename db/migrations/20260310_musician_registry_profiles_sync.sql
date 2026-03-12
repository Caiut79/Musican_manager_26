create extension if not exists pgcrypto;

create sequence if not exists public.musician_registry_code_seq start with 1 increment by 1;

create or replace function public.generate_musician_registry_code()
returns text
language sql
as $$
  select 'MU' || to_char(nextval('public.musician_registry_code_seq'), 'FM0000');
$$;

create or replace function public.generate_next_available_musician_registry_code()
returns text
language plpgsql
as $$
declare
  v_code text;
  v_exists boolean;
begin
  loop
    v_code := public.generate_musician_registry_code();
    execute
      'select exists(select 1 from public.musician_registry_profiles m where m.musician_code = $1)'
    into v_exists
    using v_code;
    exit when not coalesce(v_exists, false);
  end loop;
  return v_code;
end;
$$;

create table if not exists public.musician_registry_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid null,
  license_key text null,
  musician_code text unique not null default public.generate_musician_registry_code(),
  first_name text not null,
  last_name text not null,
  email text null,
  phone text null,
  instrument text null,
  role text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint musician_registry_profiles_code_format check (musician_code ~ '^MU[0-9]{4}$')
);

create unique index if not exists idx_musician_registry_profiles_auth_user on public.musician_registry_profiles(auth_user_id) where auth_user_id is not null;
create unique index if not exists idx_musician_registry_profiles_license_key on public.musician_registry_profiles(license_key) where license_key is not null;
create index if not exists idx_musician_registry_profiles_code on public.musician_registry_profiles(musician_code);

drop trigger if exists trg_musician_registry_profiles_updated_at on public.musician_registry_profiles;
create trigger trg_musician_registry_profiles_updated_at
before update on public.musician_registry_profiles
for each row
execute function public.set_updated_at_timestamp();

create or replace function public.normalize_musician_code(p_code text)
returns text
language sql
as $$
  select nullif(
    regexp_replace(upper(btrim(coalesce(p_code, ''))), '[\s\-_]+', '', 'g'),
    ''
  );
$$;

create or replace function public.ensure_registry_musician_code()
returns trigger
language plpgsql
as $$
begin
  new.musician_code := public.normalize_musician_code(new.musician_code);
  if new.musician_code is null then
    new.musician_code := public.generate_next_available_musician_registry_code();
  end if;
  if new.musician_code !~ '^MU[0-9]{4}$' then
    raise exception 'musician_code format non valido: %', new.musician_code;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ensure_registry_musician_code on public.musician_registry_profiles;
create trigger trg_ensure_registry_musician_code
before insert or update on public.musician_registry_profiles
for each row
execute function public.ensure_registry_musician_code();

create or replace function public.upsert_musician_registry_profile(
  p_license_key text default null,
  p_musician_code text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_email text default null,
  p_phone text default null,
  p_instrument text default null,
  p_role text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(id uuid, musician_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid;
  v_license_key text;
  v_musician_code text;
  v_id uuid;
  v_try_count integer;
begin
  v_auth_user_id := auth.uid();
  v_license_key := nullif(btrim(coalesce(p_license_key, '')), '');
  v_musician_code := public.normalize_musician_code(p_musician_code);
  if v_musician_code is not null and v_musician_code !~ '^MU[0-9]{4}$' then
    raise exception 'Formato musician_code non valido: %', v_musician_code;
  end if;

  select m.id, m.musician_code
    into v_id, musician_code
  from public.musician_registry_profiles m
  where
    (v_auth_user_id is not null and m.auth_user_id = v_auth_user_id)
    or (v_license_key is not null and m.license_key = v_license_key)
    or (v_musician_code is not null and m.musician_code = v_musician_code)
  order by m.updated_at desc
  limit 1;

  if v_id is null then
    if v_musician_code is null then
      v_musician_code := public.generate_next_available_musician_registry_code();
    end if;
    v_try_count := 0;
    loop
      v_try_count := v_try_count + 1;
      begin
        insert into public.musician_registry_profiles (
          auth_user_id, license_key, musician_code, first_name, last_name, email, phone, instrument, role, metadata
        )
        values (
          v_auth_user_id,
          v_license_key,
          v_musician_code,
          coalesce(nullif(btrim(coalesce(p_first_name, '')), ''), 'Musicista'),
          coalesce(nullif(btrim(coalesce(p_last_name, '')), ''), 'Singolo'),
          nullif(btrim(coalesce(p_email, '')), ''),
          nullif(btrim(coalesce(p_phone, '')), ''),
          nullif(btrim(coalesce(p_instrument, '')), ''),
          nullif(btrim(coalesce(p_role, '')), ''),
          coalesce(p_metadata, '{}'::jsonb)
        )
        returning public.musician_registry_profiles.id, public.musician_registry_profiles.musician_code
        into id, musician_code;
        exit;
      exception
        when unique_violation then
          if v_try_count >= 8 then
            raise;
          end if;
          v_musician_code := public.generate_next_available_musician_registry_code();
      end;
    end loop;
    return;
  end if;

  update public.musician_registry_profiles m
  set
    auth_user_id = coalesce(v_auth_user_id, m.auth_user_id),
    license_key = coalesce(v_license_key, m.license_key),
    musician_code = coalesce(v_musician_code, m.musician_code),
    first_name = coalesce(nullif(btrim(coalesce(p_first_name, '')), ''), m.first_name),
    last_name = coalesce(nullif(btrim(coalesce(p_last_name, '')), ''), m.last_name),
    email = coalesce(nullif(btrim(coalesce(p_email, '')), ''), m.email),
    phone = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), m.phone),
    instrument = coalesce(nullif(btrim(coalesce(p_instrument, '')), ''), m.instrument),
    role = coalesce(nullif(btrim(coalesce(p_role, '')), ''), m.role),
    metadata = coalesce(m.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
  where m.id = v_id
  returning m.id, m.musician_code into id, musician_code;
end;
$$;

create or replace function public.resolve_band_registry_code(
  p_band_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_social jsonb;
  v_code text;
begin
  if p_band_id is null then
    return null;
  end if;

  if to_regclass('public.bands') is not null then
    execute 'select social_links from public.bands where id = $1'
      into v_social
      using p_band_id;
    v_code := upper(coalesce(v_social -> '_bandSettings' ->> 'bandRegistryCode', ''));
    if v_code ~ '^BD[0-9]{4}$' then
      return v_code;
    end if;
  end if;

  return 'BD' || lpad(abs(mod(hashtext(p_band_id::text), 10000))::text, 4, '0');
end;
$$;

create or replace function public.attach_band_to_musician_registry(
  p_musician_code text,
  p_band_id uuid default null,
  p_band_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_band_code text;
  v_profile public.musician_registry_profiles%rowtype;
  v_history_entry jsonb;
  v_history jsonb;
begin
  v_code := public.normalize_musician_code(p_musician_code);
  if v_code is null then
    return false;
  end if;

  select *
  into v_profile
  from public.musician_registry_profiles
  where musician_code = v_code
  limit 1;

  if v_profile.id is null then
    return false;
  end if;

  v_band_code := upper(nullif(btrim(coalesce(p_band_code, '')), ''));
  if v_band_code is null then
    v_band_code := public.resolve_band_registry_code(p_band_id);
  end if;
  if v_band_code is null then
    return false;
  end if;

  v_history_entry := jsonb_build_object(
    'at', now(),
    'bandId', p_band_id,
    'bandRegistryCode', v_band_code
  );
  v_history := coalesce(v_profile.metadata -> 'history', '[]'::jsonb);

  update public.musician_registry_profiles
  set metadata = jsonb_set(
      jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{bandRegistryCode}',
        to_jsonb(v_band_code),
        true
      ),
      '{bandId}',
      to_jsonb(p_band_id::text),
      true
    ) || jsonb_build_object('history', v_history || jsonb_build_array(v_history_entry))
  where id = v_profile.id;

  return true;
end;
$$;

alter table if exists public.musicians
  add column if not exists exemption_data jsonb default '{}'::jsonb;

create or replace function public.import_musician_registry_to_band(
  p_musician_code text,
  p_imported_source_band_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_profile public.musician_registry_profiles%rowtype;
  v_member_id uuid;
begin
  v_code := public.normalize_musician_code(p_musician_code);
  if v_code is null then
    return null;
  end if;

  select *
  into v_profile
  from public.musician_registry_profiles
  where musician_code = v_code
  limit 1;

  if v_profile.id is null and to_regclass('public.musicians') is not null then
    begin
      execute
      'select id, first_name, last_name, phone, instrument
       from public.musicians
       where code = $1
       order by created_at desc
       limit 1'
      into v_profile.id, v_profile.first_name, v_profile.last_name, v_profile.phone, v_profile.instrument
      using v_code;
    exception
      when others then
        null;
    end;
  end if;

  if v_profile.id is null then
    return null;
  end if;

  select m.id
    into v_member_id
  from public.musicians m
  where upper(coalesce(m.exemption_data ->> 'importedFromCode', '')) = v_code
    and (
      p_imported_source_band_id is null
      or coalesce(m.exemption_data ->> 'importedSourceBandId', '') = p_imported_source_band_id::text
    )
  order by m.created_at desc
  limit 1;

  if v_member_id is not null then
    return v_member_id;
  end if;

  insert into public.musicians (
    first_name,
    last_name,
    phone,
    instrument,
    exemption_data
  )
  values (
    coalesce(v_profile.first_name, 'Musicista'),
    coalesce(v_profile.last_name, 'Importato'),
    v_profile.phone,
    v_profile.instrument,
    jsonb_build_object(
      'importedFromCode', v_code,
      'importedSourceBandId', p_imported_source_band_id
    )
  )
  returning id into v_member_id;

  return v_member_id;
end;
$$;

create or replace function public.search_band_registry_codes(
  p_query text default ''
)
returns table(
  band_id uuid,
  band_code text,
  band_name text,
  musician_code text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text;
begin
  v_query := lower(btrim(coalesce(p_query, '')));
  if to_regclass('public.bands') is null then
    return;
  end if;

  return query
  with base as (
    select
      b.id as band_id,
      coalesce(
        nullif(upper(coalesce(b.social_links -> '_bandSettings' ->> 'bandRegistryCode', '')), ''),
        public.resolve_band_registry_code(b.id)
      ) as band_code,
      coalesce(nullif(btrim(coalesce(b.name, '')), ''), 'Band') as band_name,
      b.created_at
    from public.bands b
  )
  select
    base.band_id,
    base.band_code,
    base.band_name,
    (
      select mrp.musician_code
      from public.musician_registry_profiles mrp
      where upper(coalesce(mrp.metadata ->> 'bandRegistryCode', '')) = base.band_code
      order by mrp.updated_at desc
      limit 1
    ) as musician_code,
    base.created_at
  from base
  where v_query = ''
     or lower(base.band_code) like '%' || v_query || '%'
     or lower(base.band_name) like '%' || v_query || '%'
  order by base.created_at desc
  limit 80;
end;
$$;

do $$
declare
  has_portal_username boolean;
  v_max_num bigint;
begin
  if to_regclass('public.musicians') is null then
    return;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'musicians'
      and column_name = 'portal_username'
  ) into has_portal_username;

  if has_portal_username then
    execute $sql$
      insert into public.musician_registry_profiles (
        first_name,
        last_name,
        phone,
        instrument,
        musician_code,
        metadata
      )
      select
        coalesce(nullif(btrim(coalesce(m.first_name, '')), ''), 'Musicista'),
        coalesce(nullif(btrim(coalesce(m.last_name, '')), ''), 'Importato'),
        m.phone,
        m.instrument,
        public.normalize_musician_code(
          coalesce(
            m.exemption_data ->> 'musicianRegistryCode',
            m.exemption_data ->> 'registryCode',
            m.exemption_data ->> 'archiveCode',
            m.portal_username
          )
        ),
        jsonb_build_object('legacyBackfill', true)
      from public.musicians m
      where public.normalize_musician_code(
        coalesce(
          m.exemption_data ->> 'musicianRegistryCode',
          m.exemption_data ->> 'registryCode',
          m.exemption_data ->> 'archiveCode',
          m.portal_username
        )
      ) ~ '^MU[0-9]{4}$'
      on conflict (musician_code) do nothing
    $sql$;
  else
    execute $sql$
      insert into public.musician_registry_profiles (
        first_name,
        last_name,
        phone,
        instrument,
        musician_code,
        metadata
      )
      select
        coalesce(nullif(btrim(coalesce(m.first_name, '')), ''), 'Musicista'),
        coalesce(nullif(btrim(coalesce(m.last_name, '')), ''), 'Importato'),
        m.phone,
        m.instrument,
        public.normalize_musician_code(
          coalesce(
            m.exemption_data ->> 'musicianRegistryCode',
            m.exemption_data ->> 'registryCode',
            m.exemption_data ->> 'archiveCode'
          )
        ),
        jsonb_build_object('legacyBackfill', true)
      from public.musicians m
      where public.normalize_musician_code(
        coalesce(
          m.exemption_data ->> 'musicianRegistryCode',
          m.exemption_data ->> 'registryCode',
          m.exemption_data ->> 'archiveCode'
        )
      ) ~ '^MU[0-9]{4}$'
      on conflict (musician_code) do nothing
    $sql$;
  end if;

  select max((substring(musician_code from 3))::bigint)
    into v_max_num
  from public.musician_registry_profiles
  where musician_code ~ '^MU[0-9]{4}$';

  if v_max_num is not null then
    perform setval('public.musician_registry_code_seq', greatest(v_max_num + 1, 1), false);
  end if;
end;
$$;

grant execute on function public.upsert_musician_registry_profile(text, text, text, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.resolve_band_registry_code(uuid) to authenticated;
grant execute on function public.attach_band_to_musician_registry(text, uuid, text) to authenticated;
grant execute on function public.import_musician_registry_to_band(text, uuid) to authenticated;
grant execute on function public.search_band_registry_codes(text) to authenticated;
