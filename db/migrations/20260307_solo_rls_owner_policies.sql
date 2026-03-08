create schema if not exists solo;

alter table if exists solo.musicians
  add column if not exists owner_user_id uuid default auth.uid();

create index if not exists idx_musicians_owner_user_id on solo.musicians(owner_user_id);

alter table if exists solo.musicians enable row level security;
alter table if exists solo.events enable row level security;
alter table if exists solo.expenses enable row level security;

drop policy if exists musicians_select_own on solo.musicians;
create policy musicians_select_own
  on solo.musicians
  for select
  using (owner_user_id = auth.uid());

drop policy if exists musicians_insert_own on solo.musicians;
create policy musicians_insert_own
  on solo.musicians
  for insert
  with check (owner_user_id = auth.uid());

drop policy if exists musicians_update_own on solo.musicians;
create policy musicians_update_own
  on solo.musicians
  for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists musicians_delete_own on solo.musicians;
create policy musicians_delete_own
  on solo.musicians
  for delete
  using (owner_user_id = auth.uid());

drop policy if exists events_select_own on solo.events;
create policy events_select_own
  on solo.events
  for select
  using (
    exists (
      select 1
      from solo.musicians m
      where m.id = solo.events.musician_id
        and m.owner_user_id = auth.uid()
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
        and m.owner_user_id = auth.uid()
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
        and m.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from solo.musicians m
      where m.id = solo.events.musician_id
        and m.owner_user_id = auth.uid()
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
        and m.owner_user_id = auth.uid()
    )
  );

drop policy if exists expenses_select_own on solo.expenses;
create policy expenses_select_own
  on solo.expenses
  for select
  using (
    exists (
      select 1
      from solo.musicians m
      where m.id = solo.expenses.musician_id
        and m.owner_user_id = auth.uid()
    )
  );

drop policy if exists expenses_insert_own on solo.expenses;
create policy expenses_insert_own
  on solo.expenses
  for insert
  with check (
    exists (
      select 1
      from solo.musicians m
      where m.id = solo.expenses.musician_id
        and m.owner_user_id = auth.uid()
    )
  );

drop policy if exists expenses_update_own on solo.expenses;
create policy expenses_update_own
  on solo.expenses
  for update
  using (
    exists (
      select 1
      from solo.musicians m
      where m.id = solo.expenses.musician_id
        and m.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from solo.musicians m
      where m.id = solo.expenses.musician_id
        and m.owner_user_id = auth.uid()
    )
  );

drop policy if exists expenses_delete_own on solo.expenses;
create policy expenses_delete_own
  on solo.expenses
  for delete
  using (
    exists (
      select 1
      from solo.musicians m
      where m.id = solo.expenses.musician_id
        and m.owner_user_id = auth.uid()
    )
  );
