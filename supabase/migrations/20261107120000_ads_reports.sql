-- =============================================================================
-- Anúncios · alertas e relatórios no WhatsApp
-- =============================================================================
--   * ads_report_settings: um destino por organização (número conectado por
--     QR Code + grupo do WhatsApp) e o que é enviado para ele.
--   * ads_report_log: histórico do que foi enviado. A chave única impede que o
--     mesmo alerta ou relatório saia duas vezes no mesmo dia.
--   * ad_accounts.alert_no_spend: avisa quando uma conta nos relatórios não
--     gastou nada no dia anterior (cartão recusado, campanha pausada…).
--   * Leitura: ads.read. Configuração: ads.manage. O envio é só do servidor.
-- =============================================================================

alter table public.ad_accounts add column alert_no_spend boolean not null default false;
grant update (alert_no_spend) on public.ad_accounts to authenticated;

drop trigger if exists audit_ad_accounts on public.ad_accounts;
create trigger audit_ad_accounts after update on public.ad_accounts
  for each row execute function private.audit_row('', 'is_selected,alert_balance_below_cents,alert_daily_spend_above_cents,alert_no_spend');

create table public.ads_report_settings (
  organization_id     uuid primary key default private.org_id() references public.organizations (id) on delete cascade,
  whatsapp_number_id  uuid references public.whatsapp_numbers (id) on delete set null,
  group_id            text check (group_id ~ '^[0-9A-Za-z.:_-]{3,80}@g\.us$'),
  group_name          text check (char_length(group_name) <= 200),
  alerts_enabled      boolean not null default true,
  daily_enabled       boolean not null default true,
  weekly_enabled      boolean not null default true,
  updated_by          uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at          timestamptz not null default now()
);
create index ads_report_settings_number_idx on public.ads_report_settings (whatsapp_number_id);
create index ads_report_settings_updated_by_idx on public.ads_report_settings (updated_by);

alter table public.ads_report_settings enable row level security;
create policy ads_report_settings_select on public.ads_report_settings for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.read')));
create policy ads_report_settings_insert on public.ads_report_settings for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('ads.manage')));
create policy ads_report_settings_update on public.ads_report_settings for update to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.manage')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('ads.manage')));
revoke delete on public.ads_report_settings from authenticated;

-- O número escolhido precisa ser da mesma organização.
create or replace function private.ads_report_number_same_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.whatsapp_number_id is not null
     and not exists (select 1 from public.whatsapp_numbers n where n.id = new.whatsapp_number_id and n.organization_id = new.organization_id) then
    raise exception 'Número de outra organização.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger ads_report_settings_guard before insert or update on public.ads_report_settings
  for each row execute function private.ads_report_number_same_org();

create trigger audit_ads_report_settings after insert or update on public.ads_report_settings
  for each row execute function private.audit_row('', 'whatsapp_number_id,group_id,group_name,alerts_enabled,daily_enabled,weekly_enabled');

create table public.ads_report_log (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  kind             text not null check (kind in ('teste', 'alerta', 'diario', 'semanal')),
  dedupe_key       text not null check (char_length(dedupe_key) <= 200),
  title            text not null check (char_length(title) <= 200),
  body             text not null check (char_length(body) <= 4000),
  status           text not null check (status in ('enviado', 'falhou')),
  error            text check (char_length(error) <= 500),
  sent_at          timestamptz not null default now(),
  unique (organization_id, dedupe_key)
);
create index ads_report_log_org_sent_idx on public.ads_report_log (organization_id, sent_at desc);

-- Totais por conta no período (security invoker: a RLS de quem chama vale).
create or replace function public.ad_report_accounts(p_accounts uuid[], p_from date, p_to date)
returns table (account_id uuid, impressions bigint, clicks bigint, spend_cents bigint, conversions numeric, conversion_value_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.account_id, sum(i.impressions)::bigint, sum(i.clicks)::bigint, sum(i.spend_cents)::bigint,
         sum(coalesce(i.conversions, 0)), sum(coalesce(i.conversion_value_cents, 0))::bigint
  from public.ad_insights_daily i
  where i.account_id = any (p_accounts) and i.day between p_from and p_to
  group by i.account_id;
$$;
revoke execute on function public.ad_report_accounts(uuid[], date, date) from public, anon;
grant execute on function public.ad_report_accounts(uuid[], date, date) to authenticated, service_role;

alter table public.ads_report_log enable row level security;
create policy ads_report_log_select on public.ads_report_log for select to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('ads.read')));
revoke insert, update, delete on public.ads_report_log from authenticated;
