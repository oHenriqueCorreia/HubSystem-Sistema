-- Tarefa excluída ou cancelada não publica: o agendamento vira erro claro em vez de sair sozinho.
create or replace function public.content_claim_due(p_limit int default 10)
returns setof public.content_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select x.id from public.content_schedules x
      join public.content_items c on c.id = x.content_id
      join public.tasks t on t.id = c.task_id
     where x.status = 'agendado' and x.scheduled_at <= now() and (t.deleted_at is not null or t.status = 'cancelada')
  loop
    perform public.content_finish(r.id, 'erro', null, null, 'A tarefa foi excluída ou cancelada: a publicação não saiu.');
  end loop;
  return query
  update public.content_schedules s
     set status = 'publicando', attempts = s.attempts + 1
   where s.id in (
     select x.id from public.content_schedules x
       join public.content_items c on c.id = x.content_id
      where x.scheduled_at <= now() and x.attempts < 8 and c.approved_version = x.version
        and (x.status = 'agendado' or (x.status = 'publicando' and x.container_id is not null and x.updated_at < now() - interval '50 seconds'))
      order by x.scheduled_at limit p_limit for update of x skip locked)
  returning s.*;
end;
$$;
revoke execute on function public.content_claim_due(int) from public, anon, authenticated;
grant execute on function public.content_claim_due(int) to service_role;
