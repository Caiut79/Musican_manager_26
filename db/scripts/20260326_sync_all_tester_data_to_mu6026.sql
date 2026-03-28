begin;

create temporary table if not exists pg_temp.sync_summary (
  section text,
  total text
);

truncate table pg_temp.sync_summary;

do $$
declare
  v_tester_auth_id uuid;
  v_license_ref text;
  v_target_profile_id uuid;
begin
  select u.id
  into v_tester_auth_id
  from auth.users u
  where lower(u.email) = 'claudio.zampa@libero.it'
  order by u.created_at desc
  limit 1;

  select l.invite_ref
  into v_license_ref
  from public.app_licenses l
  where l.app_key = 'musician_manager'
    and lower(coalesce(l.recipient_email, l.subject_key, l.metadata->>'email', l.metadata->>'user_email', '')) = 'claudio.zampa@libero.it'
  order by l.updated_at desc nulls last, l.created_at desc nulls last
  limit 1;

  select m.id
  into v_target_profile_id
  from public.musician_registry_profiles m
  where m.musician_code = 'MU6026'
  order by m.updated_at desc nulls last, m.created_at desc nulls last
  limit 1;

  if v_target_profile_id is null then
    raise exception 'Profilo MU6026 non trovato';
  end if;

  if to_regclass('public.events') is not null then
    delete from public.events dst
    using public.events src
    join public.musician_registry_profiles m on m.id = src.musician_id
    where dst.musician_id = v_target_profile_id
      and coalesce(dst.source_id, '') <> ''
      and dst.source_id = src.source_id
      and m.musician_code <> 'MU6026'
      and (
        lower(coalesce(m.email, '')) = 'claudio.zampa@libero.it'
        or (v_tester_auth_id is not null and m.auth_user_id = v_tester_auth_id)
        or (v_license_ref is not null and m.license_key = v_license_ref)
      )
      and src.musician_id <> v_target_profile_id;

    update public.events e
    set musician_id = v_target_profile_id
    from public.musician_registry_profiles m
    where m.id = e.musician_id
      and m.musician_code <> 'MU6026'
      and (
        lower(coalesce(m.email, '')) = 'claudio.zampa@libero.it'
        or (v_tester_auth_id is not null and m.auth_user_id = v_tester_auth_id)
        or (v_license_ref is not null and m.license_key = v_license_ref)
      );
  end if;

  if to_regclass('public.expenses') is not null then
    delete from public.expenses dst
    using public.expenses src
    join public.musician_registry_profiles m on m.id = src.musician_id
    where dst.musician_id = v_target_profile_id
      and coalesce(dst.source_id, '') <> ''
      and dst.source_id = src.source_id
      and m.musician_code <> 'MU6026'
      and (
        lower(coalesce(m.email, '')) = 'claudio.zampa@libero.it'
        or (v_tester_auth_id is not null and m.auth_user_id = v_tester_auth_id)
        or (v_license_ref is not null and m.license_key = v_license_ref)
      )
      and src.musician_id <> v_target_profile_id;

    update public.expenses e
    set musician_id = v_target_profile_id
    from public.musician_registry_profiles m
    where m.id = e.musician_id
      and m.musician_code <> 'MU6026'
      and (
        lower(coalesce(m.email, '')) = 'claudio.zampa@libero.it'
        or (v_tester_auth_id is not null and m.auth_user_id = v_tester_auth_id)
        or (v_license_ref is not null and m.license_key = v_license_ref)
      );
  end if;

  if to_regclass('public.contacts') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'contacts'
         and column_name = 'musician_id'
     ) then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'contacts'
        and column_name = 'source_id'
    ) then
      execute $sql$
        delete from public.contacts dst
        using public.contacts src
        join public.musician_registry_profiles m on m.id = src.musician_id
        where dst.musician_id = $1
          and coalesce(dst.source_id, '') <> ''
          and dst.source_id = src.source_id
          and m.musician_code <> 'MU6026'
          and (
            lower(coalesce(m.email, '')) = 'claudio.zampa@libero.it'
            or ($2 is not null and m.auth_user_id = $2)
            or ($3 is not null and m.license_key = $3)
          )
          and src.musician_id <> $1
      $sql$
      using v_target_profile_id, v_tester_auth_id, v_license_ref;
    end if;

    execute $sql$
      update public.contacts c
      set musician_id = $1
      from public.musician_registry_profiles m
      where m.id = c.musician_id
        and m.musician_code <> 'MU6026'
        and (
          lower(coalesce(m.email, '')) = 'claudio.zampa@libero.it'
          or ($2 is not null and m.auth_user_id = $2)
          or ($3 is not null and m.license_key = $3)
        )
    $sql$
    using v_target_profile_id, v_tester_auth_id, v_license_ref;
  end if;

  if to_regclass('public.booking_requests') is not null then
    update public.booking_requests b
    set
      musician_id = v_target_profile_id,
      affiliation_code = 'MU6026',
      musician_slug = coalesce(nullif(btrim(b.musician_slug), ''), 'maria-bianca')
    where (
      upper(coalesce(b.affiliation_code, '')) = 'MU6026'
      or (v_license_ref is not null and upper(coalesce(b.affiliation_code, '')) = upper(v_license_ref))
      or b.musician_id in (
        select m.id
        from public.musician_registry_profiles m
        where m.musician_code <> 'MU6026'
          and (
            lower(coalesce(m.email, '')) = 'claudio.zampa@libero.it'
            or (v_tester_auth_id is not null and m.auth_user_id = v_tester_auth_id)
            or (v_license_ref is not null and m.license_key = v_license_ref)
          )
      )
    );
  end if;
end $$;

commit;

do $$
begin
  if to_regclass('public.events') is not null then
    insert into pg_temp.sync_summary(section, total)
    select 'events', count(*)::text
    from public.events e
    join public.musician_registry_profiles m on m.id = e.musician_id
    where m.musician_code = 'MU6026';
  end if;

  if to_regclass('public.expenses') is not null then
    insert into pg_temp.sync_summary(section, total)
    select 'expenses', count(*)::text
    from public.expenses e
    join public.musician_registry_profiles m on m.id = e.musician_id
    where m.musician_code = 'MU6026';
  end if;

  if to_regclass('public.contacts') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'contacts'
         and column_name = 'musician_id'
     ) then
    insert into pg_temp.sync_summary(section, total)
    select 'contacts', count(*)::text
    from public.contacts c
    join public.musician_registry_profiles m on m.id = c.musician_id
    where m.musician_code = 'MU6026';
  end if;

  if to_regclass('public.booking_requests') is not null then
    insert into pg_temp.sync_summary(section, total)
    select 'booking_requests', count(*)::text
    from public.booking_requests b
    join public.musician_registry_profiles m on m.id = b.musician_id
    where m.musician_code = 'MU6026';
  end if;
end $$;

select section, total
from pg_temp.sync_summary
order by section;
