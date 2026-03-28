begin;

create temporary table if not exists pg_temp.mm_deleted_named_profiles (
  musician_code text primary key
);

truncate table pg_temp.mm_deleted_named_profiles;

insert into pg_temp.mm_deleted_named_profiles(musician_code)
values
  ('MU0031'),
  ('MU0028'),
  ('MU0024'),
  ('MU0021'),
  ('MU0018'),
  ('MU0001')
on conflict do nothing;

delete from public.archive_directory a
where a.entity_type = 'musician'
  and upper(coalesce(a.entity_code, '')) in (
    select upper(musician_code) from pg_temp.mm_deleted_named_profiles
  );

delete from public.musician_registry_profiles r
where upper(coalesce(r.musician_code, '')) in (
    select upper(musician_code) from pg_temp.mm_deleted_named_profiles
  )
  and not exists (
    select 1 from public.app_licenses l
    where upper(coalesce(l.affiliation_code, '')) = upper(r.musician_code)
  )
  and not exists (
    select 1 from public.mm_events e where e.musician_id = r.id
  )
  and not exists (
    select 1 from public.mm_expenses e where e.musician_id = r.id
  )
  and not exists (
    select 1 from public.mm_contacts c where c.musician_id = r.id
  )
  and not exists (
    select 1 from public.mm_booking_requests b where b.musician_id = r.id
  )
  and not exists (
    select 1 from public.mm_state_snapshots s where s.musician_id = r.id
  );

commit;

select musician_code
from pg_temp.mm_deleted_named_profiles
order by musician_code desc;
