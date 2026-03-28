begin;

with auth_map as (
  select lower(u.email) as email, u.id
  from auth.users u
  where lower(u.email) in ('claudio.zampa79@gmail.com', 'claudio.zampa@libero.it')
)
update public.app_licenses l
set auth_user_id = a.id
from auth_map a
where l.app_key = 'musician_manager'
  and lower(coalesce(l.recipient_email, l.subject_key, l.metadata->>'email', l.metadata->>'user_email', '')) = a.email;

with canonical as (
  select 'claudio.zampa79@gmail.com'::text as email, 'MU3593'::text as keep_code
  union all
  select 'claudio.zampa@libero.it'::text as email, 'MU0600'::text as keep_code
),
duplicates as (
  select
    m.id,
    m.email,
    m.musician_code,
    c.keep_code
  from public.musician_registry_profiles m
  join canonical c
    on lower(coalesce(m.email, '')) = c.email
  where coalesce(m.musician_code, '') <> c.keep_code
)
update public.musician_registry_profiles m
set
  email = null,
  auth_user_id = null,
  license_key = null,
  metadata = coalesce(m.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'archivedDuplicate', true,
      'archivedAt', now(),
      'archivedReason', 'email_conflict_cleanup',
      'originalEmail', d.email,
      'canonicalMusicianCode', d.keep_code
    )
from duplicates d
where m.id = d.id;

update public.musician_registry_profiles m
set
  email = 'claudio.zampa79@gmail.com',
  auth_user_id = (
    select u.id
    from auth.users u
    where lower(u.email) = 'claudio.zampa79@gmail.com'
    order by u.created_at desc
    limit 1
  ),
  license_key = 'LIC-MM-8D7370CA-C07AB34A',
  metadata = coalesce(m.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'canonicalProfile', true,
      'accountRole', 'primary',
      'authEmailLookup', 'claudio.zampa79@gmail.com'
    )
where m.musician_code = 'MU3593';

update public.musician_registry_profiles m
set
  email = 'claudio.zampa@libero.it',
  auth_user_id = (
    select u.id
    from auth.users u
    where lower(u.email) = 'claudio.zampa@libero.it'
    order by u.created_at desc
    limit 1
  ),
  license_key = 'LIC-MM-CUGH0N1P-WHVWZN1J',
  metadata = coalesce(m.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'canonicalProfile', true,
      'accountRole', 'tester',
      'authEmailLookup', 'claudio.zampa@libero.it'
    )
where m.musician_code = 'MU0600';

commit;

select id, email, musician_code, license_key, auth_user_id, metadata
from public.musician_registry_profiles
where musician_code in ('MU3593', 'MU0600', 'MU0055', 'MU0054', 'MU0053', 'MU0052', 'MU0051')
order by musician_code desc;
