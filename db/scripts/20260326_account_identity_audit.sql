select 'licenses' as section, l.id::text as ref_1, l.app_key as ref_2, l.status as ref_3, coalesce(l.recipient_email, l.subject_key, '') as ref_4, coalesce(l.affiliation_code, '') as ref_5, coalesce(l.invite_ref, '') as ref_6, coalesce(l.auth_user_id::text, '') as ref_7, coalesce(l.metadata::text, '') as ref_8
from public.app_licenses l
where l.app_key = 'musician_manager'
  and lower(coalesce(l.recipient_email, l.subject_key, l.metadata->>'email', l.metadata->>'user_email', '')) in ('claudio.zampa79@gmail.com', 'claudio.zampa@libero.it')
order by lower(coalesce(l.recipient_email, l.subject_key, l.metadata->>'email', l.metadata->>'user_email', '')), l.updated_at desc nulls last, l.created_at desc nulls last;

select 'profiles' as section, m.id::text as ref_1, coalesce(m.email, '') as ref_2, coalesce(m.first_name, '') as ref_3, coalesce(m.last_name, '') as ref_4, coalesce(m.musician_code, '') as ref_5, coalesce(m.license_key, '') as ref_6, coalesce(m.auth_user_id::text, '') as ref_7, coalesce(m.metadata::text, '') as ref_8
from public.musician_registry_profiles m
where lower(coalesce(m.email, '')) in ('claudio.zampa79@gmail.com', 'claudio.zampa@libero.it')
order by lower(coalesce(m.email, '')), m.updated_at desc nulls last, m.created_at desc nulls last;

select 'booking_requests' as section, coalesce(b.musician_id::text, '') as ref_1, coalesce(b.customer_email, '') as ref_2, coalesce(b.musician_slug, '') as ref_3, coalesce(b.customer_name, '') as ref_4, coalesce(b.event_date::text, '') as ref_5, coalesce(b.event_time::text, '') as ref_6, coalesce(b.status, '') as ref_7, coalesce(b.source_id, b.id::text, '') as ref_8
from public.booking_requests b
where lower(coalesce(b.customer_email, '')) in ('claudio.zampa79@gmail.com', 'claudio.zampa@libero.it')
   or lower(coalesce(b.musician_slug, '')) in ('claudio-zampa79', 'claudio-zampa')
order by b.created_at desc nulls last;
