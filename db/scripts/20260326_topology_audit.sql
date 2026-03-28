select
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.table_schema = tc.table_schema
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema in ('public', 'solo')
  and tc.table_name in ('events', 'expenses', 'contacts', 'booking_requests', 'musicians', 'musician_registry_profiles')
order by tc.table_schema, tc.table_name, kcu.column_name;

select 'public.musicians' as entity, count(*)::text as total from public.musicians
union all
select 'public.musician_registry_profiles' as entity, count(*)::text as total from public.musician_registry_profiles
union all
select 'public.events' as entity, count(*)::text as total from public.events
union all
select 'public.expenses' as entity, count(*)::text as total from public.expenses
union all
select 'public.contacts' as entity, count(*)::text as total from public.contacts
union all
select 'public.booking_requests' as entity, count(*)::text as total from public.booking_requests
union all
select 'public.app_state_snapshots' as entity, count(*)::text as total from public.app_state_snapshots;

select
  'registry_without_public_musician' as section,
  r.id::text as registry_profile_id,
  coalesce(r.musician_code, '') as musician_code,
  coalesce(r.email, '') as email,
  coalesce(r.auth_user_id::text, '') as auth_user_id
from public.musician_registry_profiles r
left join public.musicians m on m.id = r.id
where m.id is null
order by r.updated_at desc nulls last, r.created_at desc nulls last
limit 50;

select
  'public_musician_without_registry' as section,
  m.id::text as public_musician_id,
  coalesce(m.code, '') as musician_code,
  coalesce(m.first_name, '') as first_name,
  coalesce(m.last_name, '') as last_name,
  coalesce(m.owner_user_id::text, '') as owner_user_id
from public.musicians m
left join public.musician_registry_profiles r on r.id = m.id
where r.id is null
order by m.created_at desc nulls last
limit 50;

select
  'licenses' as section,
  l.app_key,
  l.status,
  coalesce(l.affiliation_code, '') as affiliation_code,
  coalesce(l.recipient_email, l.subject_key, '') as account_ref,
  coalesce(l.auth_user_id::text, '') as auth_user_id,
  count(*)::text as total
from public.app_licenses l
group by l.app_key, l.status, l.affiliation_code, coalesce(l.recipient_email, l.subject_key, ''), l.auth_user_id
order by l.app_key, account_ref;
