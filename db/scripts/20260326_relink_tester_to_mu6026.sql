begin;

do $$
declare
  v_tester_auth_id uuid;
  v_license_id uuid;
  v_license_ref text;
  v_target_profile_id uuid;
begin
  select u.id
  into v_tester_auth_id
  from auth.users u
  where lower(u.email) = 'claudio.zampa@libero.it'
  order by u.created_at desc
  limit 1;

  select l.id, l.invite_ref
  into v_license_id, v_license_ref
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

  update public.musician_registry_profiles m
  set
    email = null,
    auth_user_id = null,
    license_key = null,
    metadata = coalesce(m.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'archivedDuplicate', true,
        'archivedAt', now(),
        'archivedReason', 'tester_relinked_to_mu6026',
        'originalEmail', 'claudio.zampa@libero.it',
        'canonicalMusicianCode', 'MU6026'
      )
  where m.musician_code <> 'MU6026'
    and (
      lower(coalesce(m.email, '')) = 'claudio.zampa@libero.it'
      or (v_tester_auth_id is not null and m.auth_user_id = v_tester_auth_id)
      or (v_license_ref is not null and m.license_key = v_license_ref)
    );

  if v_license_id is not null then
    update public.app_licenses l
    set
      recipient_email = 'claudio.zampa@libero.it',
      subject_type = 'email',
      subject_key = 'claudio.zampa@libero.it',
      affiliation_code = 'MU6026',
      auth_user_id = v_tester_auth_id,
      metadata = coalesce(l.metadata, '{}'::jsonb)
        || jsonb_build_object('canonicalProfile', 'MU6026', 'accountRole', 'tester')
    where l.id = v_license_id;
  end if;

  if v_target_profile_id is not null then
    update public.musician_registry_profiles m
    set
      email = 'claudio.zampa@libero.it',
      auth_user_id = v_tester_auth_id,
      license_key = v_license_ref,
      metadata = coalesce(m.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'canonicalProfile', true,
          'accountRole', 'tester',
          'authEmailLookup', 'claudio.zampa@libero.it'
        )
    where m.id = v_target_profile_id;

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

select id, email, musician_code, license_key, auth_user_id, metadata
from public.musician_registry_profiles
where musician_code in ('MU6026', 'MU0600')
order by musician_code desc;
