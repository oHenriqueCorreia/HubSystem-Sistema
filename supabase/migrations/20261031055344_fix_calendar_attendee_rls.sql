-- FOR ALL also applied the write policy to SELECT. Its subquery read
-- calendar_events, whose SELECT policy read event_attendees again.
-- Keep attendee reads separate from mutations to avoid recursive RLS.
drop policy if exists event_attendees_write on public.event_attendees;

create policy event_attendees_insert on public.event_attendees for insert to authenticated
  with check (exists (
    select 1 from public.calendar_events e
    where e.id = event_id and e.organization_id = (select private.org_id())
      and e.deleted_at is null and private.can('calendar.manage', e.owner_id)
  ));

create policy event_attendees_update on public.event_attendees for update to authenticated
  using (exists (
    select 1 from public.calendar_events e
    where e.id = event_id and e.organization_id = (select private.org_id())
      and e.deleted_at is null and private.can('calendar.manage', e.owner_id)
  ))
  with check (exists (
    select 1 from public.calendar_events e
    where e.id = event_id and e.organization_id = (select private.org_id())
      and e.deleted_at is null and private.can('calendar.manage', e.owner_id)
  ));

create policy event_attendees_delete on public.event_attendees for delete to authenticated
  using (exists (
    select 1 from public.calendar_events e
    where e.id = event_id and e.organization_id = (select private.org_id())
      and e.deleted_at is null and private.can('calendar.manage', e.owner_id)
  ));
