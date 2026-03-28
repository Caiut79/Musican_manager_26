begin;

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

  insert into public.events (
    musician_id,
    source_id,
    title,
    date,
    type,
    time_start,
    time_end,
    venue,
    address,
    gross_fee,
    net_fee,
    compens_type,
    notes,
    status,
    band,
    created_at
  )
  select
    v_target_profile_id,
    e.source_id,
    e.title,
    e.date,
    e.type,
    e.time_start,
    e.time_end,
    e.venue,
    e.address,
    e.gross_fee,
    e.net_fee,
    e.compens_type,
    e.notes,
    e.status,
    e.band,
    e.created_at
  from public.events e
  join public.musician_registry_profiles m on m.id = e.musician_id
  where m.musician_code <> 'MU6026'
    and (
      lower(coalesce(m.email, '')) = 'claudio.zampa@libero.it'
      or (v_tester_auth_id is not null and m.auth_user_id = v_tester_auth_id)
      or (v_license_ref is not null and m.license_key = v_license_ref)
    )
  on conflict (musician_id, source_id)
  do update set
    title = excluded.title,
    date = excluded.date,
    type = excluded.type,
    time_start = excluded.time_start,
    time_end = excluded.time_end,
    venue = excluded.venue,
    address = excluded.address,
    gross_fee = excluded.gross_fee,
    net_fee = excluded.net_fee,
    compens_type = excluded.compens_type,
    notes = excluded.notes,
    status = excluded.status,
    band = excluded.band,
    created_at = excluded.created_at;

  delete from public.events e
  using public.musician_registry_profiles m
  where m.id = e.musician_id
    and m.musician_code <> 'MU6026'
    and (
      lower(coalesce(m.email, '')) = 'claudio.zampa@libero.it'
      or (v_tester_auth_id is not null and m.auth_user_id = v_tester_auth_id)
      or (v_license_ref is not null and m.license_key = v_license_ref)
    );
end $$;

commit;

select
  e.id,
  e.source_id,
  e.title,
  e.date,
  e.type,
  e.time_start,
  e.status,
  e.created_at
from public.events e
join public.musician_registry_profiles m on m.id = e.musician_id
where m.musician_code = 'MU6026'
order by e.date desc nulls last, e.created_at desc nulls last;
