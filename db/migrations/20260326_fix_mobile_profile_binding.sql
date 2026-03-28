alter table if exists public.app_licenses
  add column if not exists recipient_email text,
  add column if not exists invite_ref text,
  add column if not exists auth_user_id uuid,
  add column if not exists activated_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists suspended_until timestamptz,
  add column if not exists renewal_requested_at timestamptz,
  add column if not exists renewal_request_note text,
  add column if not exists last_renewed_at timestamptz,
  add column if not exists last_renewed_by uuid,
  add column if not exists last_renewed_days integer;

create unique index if not exists idx_app_licenses_invite_ref_unique
  on public.app_licenses(invite_ref)
  where invite_ref is not null and btrim(invite_ref) <> '';

create index if not exists idx_app_licenses_auth_user_app
  on public.app_licenses(app_key, auth_user_id)
  where auth_user_id is not null;

create index if not exists idx_app_licenses_recipient_email_app
  on public.app_licenses(app_key, lower(recipient_email))
  where recipient_email is not null;

do $$
declare
  v_con record;
begin
  if to_regclass('public.app_licenses') is null then
    return;
  end if;
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.app_licenses'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.app_licenses drop constraint if exists %I', v_con.conname);
  end loop;
  alter table public.app_licenses
    add constraint app_licenses_status_check
    check (status in ('pending', 'active', 'inactive', 'suspended'));
end $$;

drop function if exists public.repair_musician_identity_binding(text, text);
drop function if exists public.resolve_identity_context(text, uuid);
drop function if exists public.activate_invite_license(text, text, uuid, uuid, jsonb);
drop function if exists public.validate_invite_license(text, text);

create or replace function public.validate_invite_license(
  p_invite_ref text,
  p_app_key text default null
)
returns public.app_licenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text;
  v_row public.app_licenses%rowtype;
begin
  v_ref := upper(nullif(btrim(coalesce(p_invite_ref, '')), ''));
  if v_ref is null then
    return null;
  end if;

  select *
  into v_row
  from public.app_licenses l
  where upper(coalesce(l.invite_ref, '')) = v_ref
    and (p_app_key is null or l.app_key = p_app_key)
  order by l.updated_at desc nulls last, l.created_at desc nulls last
  limit 1;

  return v_row;
end;
$$;

create or replace function public.activate_invite_license(
  p_invite_ref text,
  p_app_key text default null,
  p_auth_user_id uuid default null,
  p_band_id uuid default null,
  p_activation_context jsonb default '{}'::jsonb
)
returns table(
  ok boolean,
  reason text,
  id uuid,
  app_key text,
  status text,
  invite_ref text,
  recipient_email text,
  subject_type text,
  subject_key text,
  affiliation_code text,
  auth_user_id uuid,
  musician_id uuid,
  musician_code text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_ref text;
  v_user_id uuid;
  v_email text;
  v_license public.app_licenses%rowtype;
  v_now timestamptz;
  v_profile_id uuid;
  v_profile_code text;
  v_subject_type text;
  v_subject_key text;
begin
  v_now := now();
  v_ref := upper(nullif(btrim(coalesce(p_invite_ref, '')), ''));
  v_user_id := coalesce(p_auth_user_id, auth.uid());

  if v_user_id is not null then
    select lower(nullif(btrim(u.email), ''))
    into v_email
    from auth.users u
    where u.id = v_user_id
    limit 1;
  end if;
  if v_email is null then
    v_email := lower(nullif(btrim(coalesce(p_activation_context ->> 'email', '')), ''));
  end if;

  if v_ref is null then
    return query select false, 'invalid_ref', null::uuid, coalesce(p_app_key, 'musician_manager'), null::text, null::text, null::text, null::text, null::text, null::text, v_user_id, null::uuid, null::text;
    return;
  end if;

  select *
  into v_license
  from public.app_licenses l
  where upper(coalesce(l.invite_ref, '')) = v_ref
    and (p_app_key is null or l.app_key = p_app_key)
  order by l.updated_at desc nulls last, l.created_at desc nulls last
  limit 1
  for update;

  if v_license.id is null then
    return query select false, 'invalid_ref', null::uuid, coalesce(p_app_key, 'musician_manager'), null::text, null::text, null::text, null::text, null::text, null::text, v_user_id, null::uuid, null::text;
    return;
  end if;

  if p_app_key is not null and v_license.app_key <> p_app_key then
    return query select false, 'app_mismatch', v_license.id, v_license.app_key, v_license.status, v_license.invite_ref, v_license.recipient_email, v_license.subject_type, v_license.subject_key, v_license.affiliation_code, v_license.auth_user_id, null::uuid, null::text;
    return;
  end if;

  if v_license.closed_at is not null then
    return query select false, 'closed', v_license.id, v_license.app_key, v_license.status, v_license.invite_ref, v_license.recipient_email, v_license.subject_type, v_license.subject_key, v_license.affiliation_code, v_license.auth_user_id, null::uuid, null::text;
    return;
  end if;

  if v_license.suspended_until is not null and v_license.suspended_until > v_now then
    return query select false, 'suspended', v_license.id, v_license.app_key, v_license.status, v_license.invite_ref, v_license.recipient_email, v_license.subject_type, v_license.subject_key, v_license.affiliation_code, v_license.auth_user_id, null::uuid, null::text;
    return;
  end if;

  if v_license.expires_at is not null and v_license.expires_at < v_now then
    return query select false, 'expired', v_license.id, v_license.app_key, v_license.status, v_license.invite_ref, v_license.recipient_email, v_license.subject_type, v_license.subject_key, v_license.affiliation_code, v_license.auth_user_id, null::uuid, null::text;
    return;
  end if;

  if v_license.auth_user_id is not null and v_user_id is not null and v_license.auth_user_id <> v_user_id then
    return query select false, 'bound_to_other_user', v_license.id, v_license.app_key, v_license.status, v_license.invite_ref, v_license.recipient_email, v_license.subject_type, v_license.subject_key, v_license.affiliation_code, v_license.auth_user_id, null::uuid, null::text;
    return;
  end if;

  v_subject_type := coalesce(nullif(btrim(v_license.subject_type), ''), case when v_email is not null then 'email' else 'musician' end);
  v_subject_key := nullif(btrim(v_license.subject_key), '');
  if v_subject_key is null and v_email is not null then
    v_subject_key := v_email;
  end if;

  update public.app_licenses l
  set
    auth_user_id = coalesce(l.auth_user_id, v_user_id),
    recipient_email = coalesce(nullif(btrim(l.recipient_email), ''), v_email),
    subject_type = v_subject_type,
    subject_key = coalesce(v_subject_key, l.subject_key),
    status = case when l.status = 'pending' then 'active' else l.status end,
    activated_at = coalesce(l.activated_at, case when l.status = 'pending' then v_now else null end),
    metadata = coalesce(l.metadata, '{}'::jsonb)
      || jsonb_build_object('lastActivationContext', coalesce(p_activation_context, '{}'::jsonb))
      || case when p_band_id is not null then jsonb_build_object('bandId', p_band_id) else '{}'::jsonb end
  where l.id = v_license.id
  returning * into v_license;

  v_profile_code := coalesce(
    nullif(btrim(v_license.affiliation_code), ''),
    case
      when v_license.subject_type = 'musician' and upper(coalesce(v_license.subject_key, '')) ~ '^MU[0-9]{4}$'
      then upper(v_license.subject_key)
      else null
    end
  );

  begin
    select x.id, x.musician_code
    into v_profile_id, v_profile_code
    from public.upsert_musician_registry_profile(
      p_license_key   => coalesce(nullif(btrim(v_license.invite_ref), ''), v_license.id::text),
      p_musician_code => v_profile_code,
      p_first_name    => nullif(btrim(coalesce(p_activation_context ->> 'firstName', '')), ''),
      p_last_name     => nullif(btrim(coalesce(p_activation_context ->> 'lastName', '')), ''),
      p_email         => coalesce(v_email, nullif(btrim(v_license.recipient_email), '')),
      p_phone         => nullif(btrim(coalesce(p_activation_context ->> 'phone', '')), ''),
      p_instrument    => nullif(btrim(coalesce(p_activation_context ->> 'instrument', '')), ''),
      p_role          => nullif(btrim(coalesce(p_activation_context ->> 'role', '')), ''),
      p_metadata      => coalesce(p_activation_context, '{}'::jsonb)
    ) as x
    limit 1;
  exception
    when unique_violation then
      select m.id, m.musician_code
      into v_profile_id, v_profile_code
      from public.musician_registry_profiles m
      where upper(btrim(coalesce(m.license_key, ''))) = upper(btrim(coalesce(v_license.invite_ref, v_license.id::text)))
         or (v_email is not null and lower(coalesce(m.email, '')) = v_email)
      order by m.updated_at desc nulls last, m.created_at desc nulls last
      limit 1;
  end;

  if v_profile_id is not null and v_user_id is not null then
    update public.musician_registry_profiles m
    set
      auth_user_id = coalesce(m.auth_user_id, v_user_id),
      email = coalesce(m.email, v_email)
    where m.id = v_profile_id;
  end if;

  return query
  select
    true,
    case when v_license.status = 'active' then 'already_active' else 'activated' end,
    v_license.id,
    v_license.app_key,
    v_license.status,
    v_license.invite_ref,
    v_license.recipient_email,
    v_license.subject_type,
    v_license.subject_key,
    v_license.affiliation_code,
    v_license.auth_user_id,
    v_profile_id,
    v_profile_code;
end;
$$;

create or replace function public.resolve_identity_context(
  p_app_key text default null,
  p_auth_user_id uuid default null
)
returns table(
  auth_user_id uuid,
  email text,
  app_key text,
  can_access_app boolean,
  reason text,
  license_id uuid,
  license_status text,
  invite_ref text,
  recipient_email text,
  subject_type text,
  subject_key text,
  affiliation_code text,
  musician_code text,
  registry_profile_id uuid,
  profile jsonb,
  license jsonb
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_app text;
  v_user_id uuid;
  v_email text;
  v_license public.app_licenses%rowtype;
  v_profile public.musician_registry_profiles%rowtype;
  v_code text;
begin
  v_app := coalesce(nullif(btrim(p_app_key), ''), 'musician_manager');
  v_user_id := coalesce(p_auth_user_id, auth.uid());

  if v_user_id is null then
    return query select null::uuid, null::text, v_app, false, 'no_auth', null::uuid, null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::uuid, null::jsonb, null::jsonb;
    return;
  end if;

  select lower(nullif(btrim(u.email), ''))
  into v_email
  from auth.users u
  where u.id = v_user_id
  limit 1;

  select *
  into v_license
  from public.app_licenses l
  where l.app_key = v_app
    and l.status in ('active', 'pending')
    and l.closed_at is null
    and (l.expires_at is null or l.expires_at >= now())
    and (
      l.auth_user_id = v_user_id
      or (v_email is not null and lower(coalesce(l.recipient_email, l.subject_key, l.metadata ->> 'email', l.metadata ->> 'user_email', '')) = v_email)
    )
  order by
    case when l.auth_user_id = v_user_id then 0 else 1 end,
    case when l.status = 'active' then 0 else 1 end,
    l.updated_at desc nulls last,
    l.created_at desc nulls last
  limit 1
  for update;

  if v_license.id is not null and v_license.auth_user_id is null then
    update public.app_licenses l
    set
      auth_user_id = v_user_id,
      recipient_email = coalesce(nullif(btrim(l.recipient_email), ''), v_email),
      status = case when l.status = 'pending' then 'active' else l.status end,
      activated_at = coalesce(l.activated_at, case when l.status = 'pending' then now() else null end)
    where l.id = v_license.id
    returning * into v_license;
  end if;

  v_code := coalesce(
    nullif(btrim(v_license.affiliation_code), ''),
    case
      when v_license.subject_type = 'musician' and upper(coalesce(v_license.subject_key, '')) ~ '^MU[0-9]{4}$'
      then upper(v_license.subject_key)
      else null
    end
  );

  if v_user_id is not null then
    select *
    into v_profile
    from public.musician_registry_profiles m
    where m.auth_user_id = v_user_id
    order by m.updated_at desc nulls last, m.created_at desc nulls last
    limit 1;
  end if;

  if v_profile.id is null and v_license.id is not null then
    select *
    into v_profile
    from public.musician_registry_profiles m
    where m.license_key = coalesce(nullif(btrim(v_license.invite_ref), ''), v_license.id::text)
    order by m.updated_at desc nulls last, m.created_at desc nulls last
    limit 1;
  end if;

  if v_profile.id is null and v_code is not null then
    select *
    into v_profile
    from public.musician_registry_profiles m
    where m.musician_code = v_code
    order by m.updated_at desc nulls last, m.created_at desc nulls last
    limit 1;
  end if;

  if v_profile.id is null and v_email is not null then
    select *
    into v_profile
    from public.musician_registry_profiles m
    where lower(coalesce(m.email, '')) = v_email
    order by m.updated_at desc nulls last, m.created_at desc nulls last
    limit 1;
  end if;

  if v_profile.id is null and v_license.id is not null then
    begin
      select m.*
      into v_profile
      from public.upsert_musician_registry_profile(
        p_license_key   => coalesce(nullif(btrim(v_license.invite_ref), ''), v_license.id::text),
        p_musician_code => v_code,
        p_first_name    => null,
        p_last_name     => null,
        p_email         => coalesce(v_email, nullif(btrim(v_license.recipient_email), '')),
        p_phone         => null,
        p_instrument    => null,
        p_role          => null,
        p_metadata      => '{}'::jsonb
      ) p
      join public.musician_registry_profiles m on m.id = p.id
      limit 1;
    exception
      when unique_violation then
        select *
        into v_profile
        from public.musician_registry_profiles m
        where upper(btrim(coalesce(m.license_key, ''))) = upper(btrim(coalesce(v_license.invite_ref, v_license.id::text)))
           or (v_email is not null and lower(coalesce(m.email, '')) = v_email)
        order by m.updated_at desc nulls last, m.created_at desc nulls last
        limit 1;
    end;
  end if;

  if v_profile.id is not null then
    update public.musician_registry_profiles m
    set
      auth_user_id = coalesce(m.auth_user_id, v_user_id),
      email = coalesce(m.email, v_email),
      license_key = coalesce(m.license_key, coalesce(nullif(btrim(v_license.invite_ref), ''), v_license.id::text))
    where m.id = v_profile.id
    returning * into v_profile;
  end if;

  return query
  select
    v_user_id,
    v_email,
    v_app,
    (v_license.id is not null),
    case when v_license.id is null then 'no_license' else 'ok' end,
    v_license.id,
    v_license.status,
    v_license.invite_ref,
    v_license.recipient_email,
    v_license.subject_type,
    v_license.subject_key,
    v_license.affiliation_code,
    coalesce(v_profile.musician_code, v_code),
    v_profile.id,
    case
      when v_profile.id is null then null
      else jsonb_build_object(
        'id', v_profile.id,
        'first_name', v_profile.first_name,
        'last_name', v_profile.last_name,
        'email', v_profile.email,
        'phone', v_profile.phone,
        'instrument', v_profile.instrument,
        'metadata', coalesce(v_profile.metadata, '{}'::jsonb),
        'musician_code', v_profile.musician_code
      )
    end,
    case
      when v_license.id is null then null
      else jsonb_build_object(
        'id', v_license.id,
        'app_key', v_license.app_key,
        'status', v_license.status,
        'invite_ref', v_license.invite_ref,
        'recipient_email', v_license.recipient_email,
        'subject_type', v_license.subject_type,
        'subject_key', v_license.subject_key,
        'affiliation_code', v_license.affiliation_code,
        'auth_user_id', v_license.auth_user_id
      )
    end;
end;
$$;

create or replace function public.repair_musician_identity_binding(
  p_email text,
  p_app_key text default 'musician_manager'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_user_id uuid;
  v_license public.app_licenses%rowtype;
  v_profile public.musician_registry_profiles%rowtype;
  v_auth_profile public.musician_registry_profiles%rowtype;
  v_license_key text;
  v_code text;
begin
  v_email := lower(nullif(btrim(coalesce(p_email, '')), ''));
  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_email');
  end if;

  select u.id
  into v_user_id
  from auth.users u
  where lower(u.email) = v_email
  order by u.created_at desc
  limit 1;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_user_not_found', 'email', v_email);
  end if;

  select *
  into v_license
  from public.app_licenses l
  where l.app_key = p_app_key
    and l.status in ('pending', 'active')
    and l.closed_at is null
    and (
      lower(coalesce(l.recipient_email, '')) = v_email
      or lower(coalesce(l.subject_key, '')) = v_email
      or lower(coalesce(l.metadata ->> 'email', '')) = v_email
      or lower(coalesce(l.metadata ->> 'user_email', '')) = v_email
    )
  order by l.updated_at desc nulls last, l.created_at desc nulls last
  limit 1;

  if v_license.id is null then
    return jsonb_build_object('ok', false, 'reason', 'license_not_found', 'email', v_email);
  end if;

  update public.app_licenses l
  set
    auth_user_id = v_user_id,
    recipient_email = coalesce(nullif(btrim(l.recipient_email), ''), v_email),
    subject_type = coalesce(nullif(btrim(l.subject_type), ''), 'email'),
    subject_key = coalesce(nullif(btrim(l.subject_key), ''), v_email),
    status = case when l.status = 'pending' then 'active' else l.status end,
    activated_at = coalesce(l.activated_at, now()),
    metadata = coalesce(l.metadata, '{}'::jsonb) || jsonb_build_object('repairSource', 'repair_musician_identity_binding')
  where l.id = v_license.id
  returning * into v_license;

  v_license_key := coalesce(nullif(btrim(v_license.invite_ref), ''), v_license.id::text);
  v_code := coalesce(
    nullif(btrim(v_license.affiliation_code), ''),
    case
      when v_license.subject_type = 'musician' and upper(coalesce(v_license.subject_key, '')) ~ '^MU[0-9]{4}$'
      then upper(v_license.subject_key)
      else null
    end
  );

  select *
  into v_profile
  from public.musician_registry_profiles m
  where upper(btrim(coalesce(m.license_key, ''))) = upper(btrim(v_license_key))
  order by m.updated_at desc nulls last, m.created_at desc nulls last
  limit 1;

  if v_profile.id is null then
    select *
    into v_profile
    from public.musician_registry_profiles m
    where m.auth_user_id = v_user_id
       or lower(coalesce(m.email, '')) = v_email
       or (v_code is not null and m.musician_code = v_code)
    order by
      case when m.auth_user_id = v_user_id then 0 else 1 end,
      case when lower(coalesce(m.email, '')) = v_email then 0 else 1 end,
      m.updated_at desc nulls last,
      m.created_at desc nulls last
    limit 1;
  end if;

  select *
  into v_auth_profile
  from public.musician_registry_profiles m
  where m.auth_user_id = v_user_id
  order by m.updated_at desc nulls last, m.created_at desc nulls last
  limit 1;

  if v_auth_profile.id is not null then
    if v_profile.id is not null and v_profile.id <> v_auth_profile.id then
      update public.musician_registry_profiles m
      set license_key = null
      where m.id = v_profile.id
        and upper(btrim(coalesce(m.license_key, ''))) = upper(btrim(v_license_key))
        and (m.auth_user_id is null or m.auth_user_id <> v_user_id);
    end if;
    v_profile := v_auth_profile;
  end if;

  if v_profile.id is null then
    insert into public.musician_registry_profiles (
      auth_user_id,
      license_key,
      musician_code,
      first_name,
      last_name,
      email,
      metadata
    )
    values (
      v_user_id,
      v_license_key,
      v_code,
      'Musicista',
      'Singolo',
      v_email,
      jsonb_build_object('repairSource', 'repair_musician_identity_binding')
    )
    returning * into v_profile;
  else
    update public.musician_registry_profiles m
    set license_key = null
    where m.id <> v_profile.id
      and upper(btrim(coalesce(m.license_key, ''))) = upper(btrim(v_license_key))
      and (m.auth_user_id is null or m.auth_user_id <> v_user_id);

    update public.musician_registry_profiles m
    set
      auth_user_id = v_user_id,
      email = coalesce(nullif(btrim(m.email), ''), v_email),
      license_key = coalesce(nullif(btrim(m.license_key), ''), v_license_key)
    where m.id = v_profile.id
    returning * into v_profile;
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', 'repaired',
    'invite_ref', v_license.invite_ref,
    'auth_user_id', v_license.auth_user_id,
    'musician_id', v_profile.id,
    'musician_code', v_profile.musician_code
  );
end;
$$;

grant execute on function public.validate_invite_license(text, text) to anon, authenticated;
grant execute on function public.activate_invite_license(text, text, uuid, uuid, jsonb) to authenticated;
grant execute on function public.resolve_identity_context(text, uuid) to authenticated;
grant execute on function public.repair_musician_identity_binding(text, text) to authenticated;
