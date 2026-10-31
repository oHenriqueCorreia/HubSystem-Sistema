-- Cross-table subqueries in attendee write policies still recurse through
-- calendar_events SELECT. Evaluate the same organization/permission check
-- inside a private, narrowly scoped function owned by the database role.
create or replace function private.can_manage_event(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.calendar_events e
    where e.id = p_event and e.organization_id = private.org_id()
      and e.deleted_at is null and private.can('calendar.manage', e.owner_id)
  );
$$;

revoke all on function private.can_manage_event(uuid) from public, anon;
grant execute on function private.can_manage_event(uuid) to authenticated;

drop policy if exists event_attendees_insert on public.event_attendees;
drop policy if exists event_attendees_update on public.event_attendees;
drop policy if exists event_attendees_delete on public.event_attendees;

create policy event_attendees_insert on public.event_attendees for insert to authenticated
  with check (private.can_manage_event(event_id));
create policy event_attendees_update on public.event_attendees for update to authenticated
  using (private.can_manage_event(event_id))
  with check (private.can_manage_event(event_id));
create policy event_attendees_delete on public.event_attendees for delete to authenticated
  using (private.can_manage_event(event_id));
