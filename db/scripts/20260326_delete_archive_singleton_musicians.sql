begin;

create temporary table if not exists pg_temp.mm_deleted_singletons (
  musician_code text primary key
);

truncate table pg_temp.mm_deleted_singletons;

with candidate_profiles as (
  select
    r.id,
    r.musician_code
  from public.musician_registry_profiles r
  where upper(coalesce(r.first_name, '')) = 'MUSICISTA'
    and upper(coalesce(r.last_name, '')) = 'SINGOLO'
    and coalesce(nullif(btrim(r.email), ''), '') = ''
    and r.auth_user_id is null
    and coalesce(nullif(btrim(r.license_key), ''), '') = ''
    and coalesce(nullif(btrim(r.musician_code), ''), '') <> ''
    and coalesce(r.metadata ->> 'bandRegistryCode', '') = ''
    and coalesce((r.metadata ->> 'canonicalProfile')::boolean, false) = false
    and not exists (
      select 1
      from public.app_licenses l
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
    )
)
insert into pg_temp.mm_deleted_singletons(musician_code)
select musician_code
from candidate_profiles
on conflict do nothing;

delete from public.archive_directory a
where a.entity_type = 'musician'
  and upper(coalesce(a.entity_code, '')) in (
    select upper(musician_code) from pg_temp.mm_deleted_singletons
  );

delete from public.musician_registry_profiles r
where upper(coalesce(r.musician_code, '')) in (
  select upper(musician_code) from pg_temp.mm_deleted_singletons
);

commit;

select musician_code
from pg_temp.mm_deleted_singletons
order by musician_code desc;
