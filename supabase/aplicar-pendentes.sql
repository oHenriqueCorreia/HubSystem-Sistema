-- HubSystem · migrations pendentes (20261101100000 em diante) em um único script.
-- Como usar: Supabase → SQL Editor → New query → cole TODO este arquivo → Run.
-- Tudo roda numa transação: se algo falhar, nada é aplicado. Rode uma única vez.
-- Gerado a partir de supabase/migrations/. Não edite à mão.

begin;

-- ===== supabase/migrations/20261101100000_ad_referrals.sql
-- =============================================================================
-- Anúncios → WhatsApp → funil (origem dos leads)
-- =============================================================================
--   * ad_referrals: o anúncio de origem que a Meta envia na mensagem de quem
--     clicou num anúncio "Clique para WhatsApp" (campo referral do webhook).
--   * Atribuição pelo primeiro contato: cada conversa pertence ao primeiro
--     anúncio que a trouxe; o lead e os negócios ganhos depois desse contato
--     seguem a conversa.
--   * ad_report_crm agrega conversas, leads e vendas por anúncio. É security
--     definer para contar a equipe toda (como o investimento), mas confere a
--     organização e a permissão ads.read e devolve apenas totais.
-- =============================================================================

create table public.ad_referrals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  message_id       uuid unique references public.messages (id) on delete set null,
  source_type      text not null check (source_type in ('ad', 'post', 'outro')),
  source_id        text check (source_id ~ '^[0-9A-Za-z_.~:-]{1,100}$'),
  source_url       text check (source_url ~ '^https?://' and char_length(source_url) <= 2000),
  headline         text check (char_length(headline) <= 500),
  body             text check (char_length(body) <= 2000),
  ctwa_clid        text check (char_length(ctwa_clid) <= 500),
  created_at       timestamptz not null default now()
);
create index ad_referrals_conversation_idx on public.ad_referrals (conversation_id, created_at);
create index ad_referrals_org_source_idx on public.ad_referrals (organization_id, source_id);
create index ads_external_idx on public.ads (external_id);

alter table public.ad_referrals enable row level security;
create policy ad_referrals_select on public.ad_referrals for select to authenticated
  using (organization_id = (select private.org_id())
         and ((select private.has_perm('ads.read')) or (select private.has_perm('inbox.read'))));
-- Só o webhook (servidor) grava.
revoke insert, update, delete on public.ad_referrals from authenticated;

-- Grava a origem de uma mensagem recebida. Idempotente por mensagem.
create or replace function public.whatsapp_referral(
  p_message uuid, p_source_type text, p_source_id text, p_source_url text, p_headline text, p_body text, p_ctwa_clid text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_conv uuid;
  v_at timestamptz;
  v_lead uuid;
  v_ad text;
begin
  select organization_id, conversation_id, created_at into v_org, v_conv, v_at from public.messages where id = p_message;
  if v_conv is null then
    return;
  end if;

  insert into public.ad_referrals (organization_id, conversation_id, message_id, source_type, source_id, source_url, headline, body, ctwa_clid, created_at)
  values (v_org, v_conv, p_message,
          case when p_source_type in ('ad', 'post') then p_source_type else 'outro' end,
          case when p_source_id ~ '^[0-9A-Za-z_.~:-]{1,100}$' then p_source_id end,
          case when p_source_url ~ '^https?://' then left(p_source_url, 2000) end,
          left(p_headline, 500), left(p_body, 2000), left(p_ctwa_clid, 500), v_at)
  on conflict (message_id) do nothing;
  if not found then
    return;
  end if;

  select lead_id into v_lead from public.conversations where id = v_conv;
  if v_lead is not null then
    select name into v_ad from public.ads where organization_id = v_org and external_id = p_source_id limit 1;
    insert into public.activities (organization_id, lead_id, type, content, metadata, occurred_at, created_by)
    values (v_org, v_lead, 'sistema',
            'Chegou pelo anúncio: ' || coalesce(v_ad, nullif(left(p_headline, 200), ''), 'anúncio da Meta'),
            jsonb_build_object('conversation_id', v_conv, 'ad_external_id', p_source_id, 'origem', 'automatica'), v_at, null);
  end if;
end;
$$;
revoke execute on function public.whatsapp_referral(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_referral(uuid, text, text, text, text, text, text) to service_role;

-- Conversas, leads e vendas por anúncio, pela data do primeiro contato.
create or replace function public.ad_report_crm(p_accounts uuid[], p_from date, p_to date, p_statuses text[] default null)
returns table (ad_id uuid, campaign_id uuid, conversations bigint, leads bigint, won bigint, won_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with first_touch as (
    select distinct on (r.conversation_id) r.conversation_id, r.source_id, r.created_at
      from public.ad_referrals r
     where r.organization_id = (select private.org_id())
       and r.source_type = 'ad' and r.source_id is not null
     order by r.conversation_id, r.created_at
  ),
  touch as (
    select a.id as ad_id, a.campaign_id, ft.conversation_id, l.id as lead_id, ft.created_at
      from first_touch ft
      join public.ads a on a.external_id = ft.source_id and a.organization_id = (select private.org_id()) and a.account_id = any (p_accounts)
      join public.ad_campaigns c on c.id = a.campaign_id
      join public.conversations cv on cv.id = ft.conversation_id
      left join public.leads l on l.id = cv.lead_id and l.deleted_at is null
     where (select private.has_perm('ads.read'))
       and (ft.created_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
       and (p_statuses is null or c.status = any (p_statuses))
  ),
  per_ad as (
    select t.ad_id, t.campaign_id, count(*)::bigint as conversations, count(distinct t.lead_id)::bigint as leads
      from touch t
     group by t.ad_id, t.campaign_id
  ),
  -- Um lead pertence ao primeiro anúncio que o trouxe; contam as vendas ganhas depois desse contato.
  lead_ad as (
    select distinct on (t.lead_id) t.lead_id, t.ad_id, t.created_at
      from touch t
     where t.lead_id is not null
     order by t.lead_id, t.created_at
  ),
  won as (
    select la.ad_id, count(d.id)::bigint as won, coalesce(sum(d.amount_cents), 0)::bigint as won_cents
      from lead_ad la
      join public.deals d on d.lead_id = la.lead_id and d.won_at is not null and d.won_at >= la.created_at and d.deleted_at is null
     group by la.ad_id
  )
  select p.ad_id, p.campaign_id, p.conversations, p.leads, coalesce(w.won, 0)::bigint, coalesce(w.won_cents, 0)::bigint
    from per_ad p
    left join won w on w.ad_id = p.ad_id;
$$;
revoke execute on function public.ad_report_crm(uuid[], date, date, text[]) from public, anon;
grant execute on function public.ad_report_crm(uuid[], date, date, text[]) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261101100000', 'ad_referrals') on conflict do nothing;

commit;
