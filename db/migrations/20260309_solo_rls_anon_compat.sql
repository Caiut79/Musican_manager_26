create schema if not exists solo;

alter table if exists solo.musicians
  add column if not exists owner_user_id uuid default auth.uid();

create index if not exists idx_musicians_owner_user_id on solo.musicians(owner_user_id);

create or replace function solo.same_owner_or_anon(owner_id uuid)
returns boolean
language sql
stable
as $$
  select coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
$$;

drop policy if exists musicians_select_own on solo.musicians;
create policy musicians_select_own
  on solo.musicians
  for select
  using (solo.same_owner_or_anon(owner_user_id));

drop policy if exists musicians_insert_own on solo.musicians;
create policy musicians_insert_own
  on solo.musicians
  for insert
  with check (solo.same_owner_or_anon(owner_user_id));

drop policy if exists musicians_update_own on solo.musicians;
create policy musicians_update_own
  on solo.musicians
  for update
  using (solo.same_owner_or_anon(owner_user_id))
  with check (solo.same_owner_or_anon(owner_user_id));

drop policy if exists musicians_delete_own on solo.musicians;
create policy musicians_delete_own
  on solo.musicians
  for delete
  using (solo.same_owner_or_anon(owner_user_id));

drop policy if exists events_select_own on solo.events;
create policy events_select_own
  on solo.events
  for select
  using (
    exists (
      select 1
      from solo.musicians m
      where m.id = solo.events.musician_id
        and solo.same_owner_or_anon(m.owner_user_id)
    )
  );

drop policy if exists events_insert_own on solo.events;
create policy events_insert_own
  on solo.events
  for insert
  with check (
    exists (
      select 1
      from solo.musicians m
      where m.id = solo.events.musician_id
        and solo.same_owner_or_anon(m.owner_user_id)
    )
  );

drop policy if exists events_update_own on solo.events;
create policy events_update_own
  on solo.events
  for update
  using (
    exists (
      select 1
      from solo.musicians m
      where m.id = solo.events.musician_id
        and solo.same_owner_or_anon(m.owner_user_id)
    )
  )
  with check (
    exists (
      select 1
      from solo.musicians m
      where m.id = solo.events.musician_id
        and solo.same_owner_or_anon(m.owner_user_id)
    )
  );

drop policy if exists events_delete_own on solo.events;
create policy events_delete_own
  on solo.events
  for delete
  using (
    exists (
      select 1
      from solo.musicians m
      where m.id = solo.events.musician_id
        and solo.same_owner_or_anon(m.owner_user_id)
    )
  );

do $$
begin
  if to_regclass('solo.expenses') is not null then
    execute 'drop policy if exists expenses_select_own on solo.expenses';
    execute $sql$
      create policy expenses_select_own
        on solo.expenses
        for select
        using (
          exists (
            select 1
            from solo.musicians m
            where m.id = solo.expenses.musician_id
              and solo.same_owner_or_anon(m.owner_user_id)
          )
        )
    $sql$;

    execute 'drop policy if exists expenses_insert_own on solo.expenses';
    execute $sql$
      create policy expenses_insert_own
        on solo.expenses
        for insert
        with check (
          exists (
            select 1
            from solo.musicians m
            where m.id = solo.expenses.musician_id
              and solo.same_owner_or_anon(m.owner_user_id)
          )
        )
    $sql$;

    execute 'drop policy if exists expenses_update_own on solo.expenses';
    execute $sql$
      create policy expenses_update_own
        on solo.expenses
        for update
        using (
          exists (
            select 1
            from solo.musicians m
            where m.id = solo.expenses.musician_id
              and solo.same_owner_or_anon(m.owner_user_id)
          )
        )
        with check (
          exists (
            select 1
            from solo.musicians m
            where m.id = solo.expenses.musician_id
              and solo.same_owner_or_anon(m.owner_user_id)
          )
        )
    $sql$;

    execute 'drop policy if exists expenses_delete_own on solo.expenses';
    execute $sql$
      create policy expenses_delete_own
        on solo.expenses
        for delete
        using (
          exists (
            select 1
            from solo.musicians m
            where m.id = solo.expenses.musician_id
              and solo.same_owner_or_anon(m.owner_user_id)
          )
        )
    $sql$;
  end if;
end $$;
