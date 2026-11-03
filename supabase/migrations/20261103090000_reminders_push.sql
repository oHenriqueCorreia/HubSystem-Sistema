-- =============================================================================
-- Lembretes automáticos e notificações no celular (Web Push)
-- =============================================================================
--   * private.generate_reminders: tarefas, agenda, contas, retornos de leads,
--     fim de contrato e convites parados, perto do horário e sem repetir
--     (dedupe_key). Respeita profiles.preferences -> 'notificacoes'.
--   * Gatilhos avisam na hora: tarefa/lead atribuído, mensagem recebida e
--     convite aceito.
--   * pg_cron roda a cada minuto, independente do plano da Vercel. Só chama o
--     site (pg_net) quando há notificação nova para um aparelho inscrito.
--   * /api/push/dispatch envia; as chaves VAPID ficam em private.app_settings.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.notifications add column pushed_at timestamptz;
update public.notifications set pushed_at = now();
create index notifications_pending_push_idx on public.notifications (created_at) where pushed_at is null;

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh      text not null check (char_length(p256dh) <= 300),
  auth        text not null check (char_length(auth) <= 100),
  user_agent  text check (char_length(user_agent) <= 300),
  created_at  timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update on public.push_subscriptions from authenticated;

-- O mesmo aparelho pode trocar de usuário: a inscrição passa para quem entrou.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  select auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300)
   where auth.uid() is not null
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
$$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- Configuração interna: endereço do site, token do minuto e chaves VAPID.
create table private.app_settings (
  key    text primary key,
  value  text not null
);
insert into private.app_settings (key, value) values
  ('site_url', 'https://hubsystem-phi.vercel.app'),
  ('tick_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

-- Somente o servidor (service_role).
create or replace function public.push_check_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.app_settings where key = 'tick_token' and value = p_token);
$$;

create or replace function public.push_get_keys()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'public', (select value from private.app_settings where key = 'vapid_public'),
    'private_enc', (select value from private.app_settings where key = 'vapid_private_enc'));
$$;

-- Primeira gravação vence (dois pedidos simultâneos não trocam a chave).
create or replace function public.push_set_keys(p_public text, p_private_enc text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.app_settings (key, value) values ('vapid_public', p_public), ('vapid_private_enc', p_private_enc)
  on conflict (key) do nothing;
$$;

-- Reserva o que falta enviar: cada notificação sai uma vez, mesmo com chamadas simultâneas.
create or replace function public.push_claim_pending()
returns table (id uuid, user_id uuid, kind text, title text, body text, href text)
language sql
security definer
set search_path = ''
as $$
  update public.notifications n
     set pushed_at = now()
   where n.pushed_at is null and n.created_at > now() - interval '1 day'
     and exists (select 1 from public.push_subscriptions s where s.user_id = n.user_id)
  returning n.id, n.user_id, n.kind, n.title, n.body, n.href;
$$;

revoke execute on function public.push_check_token(text) from public, anon, authenticated;
revoke execute on function public.push_get_keys() from public, anon, authenticated;
revoke execute on function public.push_set_keys(text, text) from public, anon, authenticated;
revoke execute on function public.push_claim_pending() from public, anon, authenticated;
grant execute on function public.push_check_token(text) to service_role;
grant execute on function public.push_get_keys() to service_role;
grant execute on function public.push_set_keys(text, text) to service_role;
grant execute on function public.push_claim_pending() to service_role;

-- Permissão de um usuário qualquer (mesma regra de private.perm_scope, que usa o usuário da sessão).
create or replace function private.user_has_perm(p_user uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.user_permission_overrides o where o.user_id = p_user and o.permission_key = p_key and o.effect = 'deny') then false
    when exists (select 1 from public.user_permission_overrides o where o.user_id = p_user and o.permission_key = p_key and o.effect = 'grant') then true
    else exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
                  where ur.user_id = p_user and rp.permission_key = p_key)
  end;
$$;

create or replace function private.notify(p_org uuid, p_user uuid, p_kind text, p_title text, p_body text, p_href text, p_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (organization_id, user_id, kind, title, body, href, dedupe_key)
  values (p_org, p_user, p_kind, left(p_title, 200), left(p_body, 1000), p_href, left(p_key, 200))
  on conflict (user_id, dedupe_key) do nothing;
$$;

-- Lembretes de todos os usuários ativos (ou de um só). Idempotente pela chave.
create or replace function private.generate_reminders(p_user uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u record;
  r record;
  v_prefs jsonb;
  v_now_local timestamp := now() at time zone 'America/Sao_Paulo';
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  -- Itens sem horário definido (dia inteiro, contas) avisam a partir das 8h.
  v_morning boolean := (now() at time zone 'America/Sao_Paulo')::time >= time '08:00';
  v_task_minutes int;
  v_event_minutes int;
  v_bill_days int;
begin
  for u in select id, organization_id, preferences from public.profiles where is_active and (p_user is null or id = p_user) loop
    v_prefs := coalesce(u.preferences -> 'notificacoes', '{}'::jsonb);
    v_task_minutes := coalesce((v_prefs ->> 'task_minutes')::int, 60);
    v_event_minutes := coalesce((v_prefs ->> 'event_minutes')::int, 30);
    v_bill_days := coalesce((v_prefs ->> 'bill_days')::int, 2);

    -- Tarefas: antes do horário, no dia (sem horário) e atrasadas.
    if coalesce((v_prefs ->> 'tarefas')::boolean, true) then
      for r in
        select t.id, t.title, t.due_at, t.has_time
          from public.tasks t
         where t.deleted_at is null and t.status in ('a_fazer', 'em_andamento') and t.due_at is not null
           and t.due_at > now() - interval '7 days' and t.due_at <= now() + make_interval(mins => v_task_minutes) + interval '1 day'
           and (t.owner_id = u.id or exists (select 1 from public.task_participants p where p.task_id = t.id and p.user_id = u.id))
      loop
        if r.has_time and r.due_at > now() and r.due_at <= now() + make_interval(mins => v_task_minutes) then
          perform private.notify(u.organization_id, u.id, 'tarefa_breve', 'Tarefa às ' || to_char(r.due_at at time zone 'America/Sao_Paulo', 'HH24:MI') || ': ' || r.title,
            null, '/tarefas?periodo=hoje', 'tarefa_breve:' || r.id || ':' || extract(epoch from r.due_at)::bigint);
        elsif not r.has_time and (r.due_at at time zone 'America/Sao_Paulo')::date = v_today and v_morning then
          perform private.notify(u.organization_id, u.id, 'tarefa_hoje', 'Vence hoje: ' || r.title,
            null, '/tarefas?periodo=hoje', 'tarefa_hoje:' || r.id || ':' || v_today);
        elsif (r.has_time and r.due_at < now()) or (not r.has_time and (r.due_at at time zone 'America/Sao_Paulo')::date < v_today) then
          perform private.notify(u.organization_id, u.id, 'tarefa_atrasada', 'Tarefa atrasada: ' || r.title,
            null, '/tarefas?periodo=atrasadas', 'tarefa_atrasada:' || r.id || ':' || extract(epoch from r.due_at)::bigint);
        end if;
      end loop;
    end if;

    -- Agenda: usa o lembrete escolhido no evento (vazio = sem lembrete); eventos vindos do Google usam a antecedência padrão.
    if coalesce((v_prefs ->> 'agenda')::boolean, true) then
      for r in
        select e.id, e.title, e.starts_at, e.all_day, e.location,
               -- O aviso mais próximo já alcançado (um evento pode ter vários: 60 e 10 minutos antes).
               (select min(m) from unnest(case when e.source = 'google' and e.reminder_minutes = '{}' then array[v_event_minutes] else e.reminder_minutes end) m
                 where e.starts_at <= now() + make_interval(mins => m)) as minutes
          from public.calendar_events e
         where e.deleted_at is null and e.starts_at > now() - interval '1 day' and e.starts_at <= now() + interval '8 days'
           and (e.owner_id = u.id or exists (select 1 from public.event_attendees a where a.event_id = e.id and a.user_id = u.id))
      loop
        if r.all_day then
          if (r.starts_at at time zone 'America/Sao_Paulo')::date = v_today and v_morning then
            perform private.notify(u.organization_id, u.id, 'evento_hoje', 'Hoje: ' || r.title, r.location, '/agenda', 'evento_hoje:' || r.id || ':' || v_today);
          end if;
        elsif r.starts_at > now() and r.minutes is not null then
          perform private.notify(u.organization_id, u.id, 'evento_breve', 'Às ' || to_char(r.starts_at at time zone 'America/Sao_Paulo', 'HH24:MI') || ': ' || r.title,
            r.location, '/agenda', 'evento_breve:' || r.id || ':' || extract(epoch from r.starts_at)::bigint || ':' || r.minutes);
        end if;
      end loop;
    end if;

    -- Contas: antes do vencimento, no dia e vencidas (empresa só para quem lê o financeiro da empresa).
    if coalesce((v_prefs ->> 'financeiro')::boolean, true) and v_morning then
      for r in
        select t.id, t.kind, t.scope, t.description, t.amount_cents, t.due_date
          from public.financial_transactions t
         where t.organization_id = u.organization_id and t.deleted_at is null and t.status = 'previsto' and t.kind in ('receita', 'despesa')
           and t.due_date between v_today - 30 and v_today + v_bill_days
           and ((t.scope = 'pessoal' and t.owner_user_id = u.id)
                or (t.scope = 'empresa' and private.user_has_perm(u.id, 'finance.company.read')))
      loop
        perform private.notify(u.organization_id, u.id,
          case when r.kind = 'receita' then 'receber' else 'pagar' end,
          case when r.kind = 'receita' then 'A receber ' else 'A pagar ' end
            || case when r.due_date < v_today then '(vencido): '
                    when r.due_date = v_today then 'hoje: '
                    when r.due_date = v_today + 1 then 'amanhã: '
                    else 'em ' || (r.due_date - v_today) || ' dias: ' end
            || r.description,
          'R$ ' || translate(to_char(r.amount_cents / 100.0, 'FM999,999,990.00'), ',.', '.,'),
          '/financeiro/' || r.scope || '/lancamentos',
          -- Avisa uma vez em cada fase: antes, no dia e depois de vencido.
          'fin:' || r.id || ':' || r.due_date || ':' || case when r.due_date > v_today then 'antes' when r.due_date = v_today then 'hoje' else 'vencido' end);
      end loop;
    end if;

    if coalesce((v_prefs ->> 'comercial')::boolean, true) then
      -- Retorno combinado com um lead.
      for r in
        select l.id, l.name, l.next_contact_at
          from public.leads l
         where l.owner_id = u.id and l.deleted_at is null
           and l.next_contact_at between now() - interval '1 day' and now() + interval '30 minutes'
      loop
        perform private.notify(u.organization_id, u.id, 'lead_retorno', 'Retornar para ' || r.name,
          to_char(r.next_contact_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'),
          '/crm/leads/' || r.id, 'lead_retorno:' || r.id || ':' || extract(epoch from r.next_contact_at)::bigint);
      end loop;

      -- Contrato perto do fim: 30 e 7 dias antes.
      if v_morning then
        for r in
          select k.id, k.title, k.end_date
            from public.contracts k
           where k.organization_id = u.organization_id and k.deleted_at is null and k.status = 'ativo'
             and k.end_date between v_today and v_today + 30
             and (k.owner_id = u.id or (k.owner_id is null and private.user_has_perm(u.id, 'contracts.read')))
        loop
          perform private.notify(u.organization_id, u.id, 'contrato_fim', 'Contrato termina em ' || to_char(r.end_date, 'DD/MM/YYYY') || ': ' || r.title, null,
            '/contratos/' || r.id, 'contrato_fim:' || r.id || ':' || r.end_date || ':' || case when r.end_date <= v_today + 7 then '7' else '30' end);
        end loop;
      end if;
    end if;

    if private.user_has_perm(u.id, 'admin.users') then
      for r in
        select i.id, i.email from public.invitations i
         where i.organization_id = u.organization_id and i.status = 'pendente' and i.expires_at > now() and i.created_at < now() - interval '2 days'
      loop
        perform private.notify(u.organization_id, u.id, 'convite', 'Convite ainda não aceito: ' || r.email, null, '/configuracoes/usuarios', 'convite:' || r.id);
      end loop;
    end if;
  end loop;

  -- Central enxuta: lidas há mais de 30 dias e qualquer uma com mais de 90 saem.
  delete from public.notifications where read_at < now() - interval '30 days' or created_at < now() - interval '90 days';
end;
$$;

-- A cada minuto: gera lembretes e só aciona o site se houver o que enviar.
create or replace function private.notifications_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.generate_reminders();
  if exists (select 1 from public.notifications n join public.push_subscriptions s on s.user_id = n.user_id
              where n.pushed_at is null and n.created_at > now() - interval '1 day') then
    perform net.http_post(
      url := (select value from private.app_settings where key = 'site_url') || '/api/push/dispatch',
      headers := jsonb_build_object('content-type', 'application/json', 'x-hub-tick', (select value from private.app_settings where key = 'tick_token')),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
end;
$$;
revoke execute on function private.notifications_tick() from public, anon, authenticated;
revoke execute on function private.generate_reminders(uuid) from public, anon, authenticated;

select cron.schedule('hub-notificacoes', '* * * * *', 'select private.notifications_tick()');

-- A geração agora é do servidor: abrir o sistema não precisa mais disparar nada.
drop function if exists public.refresh_my_notifications();

-- Avisos na hora -------------------------------------------------------------

create or replace function private.notify_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null and auth.uid() is not null and new.owner_id <> auth.uid() and new.deleted_at is null
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    perform private.notify(new.organization_id, new.owner_id, 'tarefa_atribuida', 'Nova tarefa para você: ' || new.title, null, '/tarefas', 'tarefa_atribuida:' || new.id || ':' || new.owner_id);
  end if;
  return null;
end;
$$;
create trigger notify_task_assigned after insert or update of owner_id on public.tasks
  for each row execute function private.notify_task_assigned();

create or replace function private.notify_lead_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null and auth.uid() is not null and new.owner_id <> auth.uid() and new.deleted_at is null and new.import_id is null
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    perform private.notify(new.organization_id, new.owner_id, 'lead_atribuido', 'Novo lead para você: ' || new.name, null, '/crm/leads/' || new.id, 'lead_atribuido:' || new.id || ':' || new.owner_id);
  end if;
  return null;
end;
$$;
create trigger notify_lead_assigned after insert or update of owner_id on public.leads
  for each row execute function private.notify_lead_assigned();

-- Mensagem recebida: para o responsável; sem responsável, para quem gerencia o atendimento. No máximo uma por hora por conversa.
create or replace function private.notify_inbound_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conversations;
  v_user uuid;
  v_title text;
  v_key text;
begin
  if new.direction <> 'entrada' then
    return null;
  end if;
  select * into c from public.conversations where id = new.conversation_id;
  if c.id is null then
    return null;
  end if;
  v_title := 'Mensagem de ' || coalesce(nullif(c.contact_name, ''), c.contact_e164);
  v_key := 'mensagem:' || c.id || ':' || to_char(new.created_at at time zone 'UTC', 'YYYYMMDDHH24');
  for v_user in
    select p.id from public.profiles p
     where p.organization_id = c.organization_id and p.is_active
       and (p.id = c.assignee_id or (c.assignee_id is null and private.user_has_perm(p.id, 'inbox.manage')))
  loop
    perform private.notify(c.organization_id, v_user, 'mensagem', v_title, left(new.body, 200), '/atendimento?conversa=' || c.id, v_key);
  end loop;
  return null;
end;
$$;
create trigger notify_inbound_message after insert on public.messages
  for each row execute function private.notify_inbound_message();

create or replace function private.notify_invitation_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if new.status = 'aceito' and old.status <> 'aceito' and new.invited_by is not null then
    select organization_id into v_org from public.profiles where id = new.invited_by;
    if v_org is not null then
      perform private.notify(v_org, new.invited_by, 'convite_aceito', 'Convite aceito: ' || coalesce(nullif(new.full_name, ''), new.email), null, '/configuracoes/usuarios', 'convite_aceito:' || new.id);
    end if;
  end if;
  return null;
end;
$$;
create trigger notify_invitation_accepted after update of status on public.invitations
  for each row execute function private.notify_invitation_accepted();

-- Sininho atualiza sozinho (a RLS define quem recebe o quê).
alter publication supabase_realtime add table public.notifications;
