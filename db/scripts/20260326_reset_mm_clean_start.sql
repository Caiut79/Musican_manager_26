begin;

truncate table
  public.mm_state_snapshots,
  public.mm_booking_requests,
  public.mm_contacts,
  public.mm_expenses,
  public.mm_events
restart identity;

commit;

select 'mm_events' as table_name, count(*)::text as total from public.mm_events
union all
select 'mm_expenses', count(*)::text from public.mm_expenses
union all
select 'mm_contacts', count(*)::text from public.mm_contacts
union all
select 'mm_booking_requests', count(*)::text from public.mm_booking_requests
union all
select 'mm_state_snapshots', count(*)::text from public.mm_state_snapshots;
