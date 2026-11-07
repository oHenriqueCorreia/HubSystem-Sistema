-- =============================================================================
-- Anúncios · relatórios por cliente com horário, mensal e modelos editáveis
-- =============================================================================
--   * send_time: horário dos envios (padrão 08h30, em São Paulo).
--   * Semanal às segundas; mensal (últimos 30 dias) no dia escolhido.
--   * templates: textos editáveis de cada relatório e alerta ({variáveis}).
--   * ad_accounts.is_prepay: conta pré-paga; o saldo passa a ser o disponível.
--   * O banco chama o site a cada 15 minutos (pg_cron + pg_net) quando há
--     relatório no horário, e de hora em hora para conferir saldos e gastos.
-- =============================================================================

alter table public.ad_accounts add column is_prepay boolean;

alter table public.ads_report_settings
  add column send_time       time not null default '08:30' check (extract(minute from send_time)::int % 15 = 0 and extract(second from send_time) = 0),
  add column monthly_enabled boolean not null default true,
  add column monthly_day     smallint not null default 1 check (monthly_day between 1 and 28),
  add column templates       jsonb not null default '{}'::jsonb check (jsonb_typeof(templates) = 'object' and octet_length(templates::text) <= 20000);

-- O relatório diário passa a ser opcional (o padrão agora é semanal + mensal).
alter table public.ads_report_settings alter column daily_enabled set default false;

alter table public.ads_report_log drop constraint ads_report_log_kind_check;
alter table public.ads_report_log add constraint ads_report_log_kind_check check (kind in ('teste', 'alerta', 'diario', 'semanal', 'mensal'));

drop trigger if exists audit_ads_report_settings on public.ads_report_settings;
create trigger audit_ads_report_settings after insert or update on public.ads_report_settings
  for each row execute function private.audit_row('', 'whatsapp_number_id,group_id,group_name,alerts_enabled,daily_enabled,weekly_enabled,monthly_enabled,monthly_day,send_time,templates');

-- Organizações com relatório no horário agora (janela de 15 minutos, horário de São Paulo).
create or replace function private.ads_reports_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ads_report_settings s
    where s.group_id is not null
      and (s.daily_enabled or s.weekly_enabled or s.monthly_enabled)
      and (now() at time zone 'America/Sao_Paulo')::time >= s.send_time
      and (now() at time zone 'America/Sao_Paulo')::time < s.send_time + interval '15 minutes'
  );
$$;

-- Há conta com alerta configurado (vale conferir saldo e gasto).
create or replace function private.ads_alerts_configured()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ad_accounts a
    where a.is_selected
      and (a.alert_balance_below_cents is not null or a.alert_daily_spend_above_cents is not null)
  );
$$;

create or replace function private.ads_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := (select value from private.app_settings where key = 'site_url');
  v_token text := (select value from private.app_settings where key = 'tick_token');
  v_minute int := extract(minute from now())::int;
begin
  if v_url is null or v_token is null then
    return;
  end if;
  if private.ads_reports_due() then
    perform net.http_post(
      url := v_url || '/api/ads/tick',
      headers := jsonb_build_object('content-type', 'application/json', 'x-hub-tick', v_token),
      body := jsonb_build_object('job', 'relatorios'),
      timeout_milliseconds := 120000);
  end if;
  -- Saldos e gastos: de hora em hora, das 7h às 22h.
  if v_minute < 15
     and extract(hour from now() at time zone 'America/Sao_Paulo')::int between 7 and 22
     and private.ads_alerts_configured() then
    perform net.http_post(
      url := v_url || '/api/ads/tick',
      headers := jsonb_build_object('content-type', 'application/json', 'x-hub-tick', v_token),
      body := jsonb_build_object('job', 'alertas'),
      timeout_milliseconds := 120000);
  end if;
end;
$$;
revoke execute on function private.ads_tick() from public, anon, authenticated;
revoke execute on function private.ads_reports_due() from public, anon, authenticated;
revoke execute on function private.ads_alerts_configured() from public, anon, authenticated;

select cron.unschedule('hub-anuncios') where exists (select 1 from cron.job where jobname = 'hub-anuncios');
select cron.schedule('hub-anuncios', '*/15 * * * *', 'select private.ads_tick()');

-- Totais por conta agora com alcance (relatórios por cliente).
drop function public.ad_report_accounts(uuid[], date, date);
create function public.ad_report_accounts(p_accounts uuid[], p_from date, p_to date)
returns table (account_id uuid, impressions bigint, reach bigint, clicks bigint, spend_cents bigint, conversions numeric, conversion_value_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.account_id, sum(i.impressions)::bigint, sum(coalesce(i.reach, 0))::bigint, sum(i.clicks)::bigint, sum(i.spend_cents)::bigint,
         sum(coalesce(i.conversions, 0)), sum(coalesce(i.conversion_value_cents, 0))::bigint
  from public.ad_insights_daily i
  where i.account_id = any (p_accounts) and i.day between p_from and p_to
  group by i.account_id;
$$;
revoke execute on function public.ad_report_accounts(uuid[], date, date) from public, anon;
grant execute on function public.ad_report_accounts(uuid[], date, date) to authenticated, service_role;
