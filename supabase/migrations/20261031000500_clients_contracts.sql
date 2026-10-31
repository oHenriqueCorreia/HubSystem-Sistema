-- =============================================================================
-- Fase 4 · Serviços, clientes, contratos, anexos e conversão de lead
-- O cliente É o lead convertido (clients.lead_id único): contatos, etiquetas e
-- linha do tempo continuam no lead, sem duplicar dados.
-- =============================================================================

create type public.service_kind as enum ('site', 'manutencao', 'meta_ads', 'google_ads', 'outro');
create type public.contract_status as enum ('rascunho', 'ativo', 'pausado', 'encerrado', 'cancelado');
create type public.recurrence as enum ('unica', 'mensal', 'trimestral', 'semestral', 'anual');
create type public.payment_method as enum ('pix', 'boleto', 'cartao_credito', 'cartao_debito', 'transferencia', 'dinheiro', 'outro');

create table public.services (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  name                 text not null check (char_length(name) between 2 and 80),
  kind                 public.service_kind not null default 'outro',
  is_recurring         boolean not null default false,
  default_price_cents  bigint check (default_price_cents >= 0),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now()
);
create unique index services_org_name_uq on public.services (organization_id, lower(name));

create table public.clients (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  lead_id             uuid not null unique references public.leads (id) on delete restrict,
  legal_name          text check (char_length(legal_name) <= 200),
  document            text check (document ~ '^([0-9]{11}|[0-9]{14})$'),
  billing_email       text check (billing_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  billing_phone_e164  text check (billing_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  owner_id            uuid default auth.uid() references public.profiles (id) on delete set null,
  status              text not null default 'ativo' check (status in ('ativo', 'inativo')),
  notes               text check (char_length(notes) <= 10000),
  converted_at        timestamptz not null default now(),
  converted_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create index clients_org_owner_idx on public.clients (organization_id, owner_id) where deleted_at is null;
create trigger clients_updated_at before update on public.clients
  for each row execute function private.set_updated_at();

create table public.contracts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  client_id         uuid not null references public.clients (id) on delete restrict,
  service_id        uuid references public.services (id) on delete set null,
  deal_id           uuid references public.deals (id) on delete set null,
  owner_id          uuid default auth.uid() references public.profiles (id) on delete set null,
  title             text not null check (char_length(title) between 2 and 160),
  description       text check (char_length(description) <= 10000),
  amount_cents      bigint not null check (amount_cents >= 0),
  payment_method    public.payment_method not null default 'pix',
  recurrence        public.recurrence not null default 'unica',
  start_date        date not null,
  end_date          date,
  due_day           int check (due_day between 1 and 31),
  status            public.contract_status not null default 'ativo',
  notes             text check (char_length(notes) <= 10000),
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  check (end_date is null or end_date >= start_date)
);
create index contracts_client_idx on public.contracts (client_id) where deleted_at is null;
create index contracts_org_status_idx on public.contracts (organization_id, status) where deleted_at is null;
create index contracts_owner_idx on public.contracts (owner_id);
create trigger contracts_updated_at before update on public.contracts
  for each row execute function private.set_updated_at();

-- Vínculos opcionais de tarefas e eventos com cliente/contrato.
alter table public.tasks add column client_id uuid references public.clients (id) on delete set null;
alter table public.tasks add column contract_id uuid references public.contracts (id) on delete set null;
alter table public.calendar_events add column client_id uuid references public.clients (id) on delete set null;
alter table public.calendar_events add column contract_id uuid references public.contracts (id) on delete set null;
alter table public.activities add column client_id uuid references public.clients (id) on delete set null;
alter table public.activities add column contract_id uuid references public.contracts (id) on delete set null;
create index tasks_client_idx on public.tasks (client_id) where deleted_at is null;
create index tasks_contract_idx on public.tasks (contract_id) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Acesso
-- -----------------------------------------------------------------------------
create or replace function private.can_read_client(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clients c
    where c.id = p_client and c.organization_id = private.org_id() and c.deleted_at is null
      and (private.can('clients.read', c.owner_id) or private.can_read_lead(c.lead_id))
  );
$$;

create or replace function private.can_read_contract(p_contract uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.contracts k
    where k.id = p_contract and k.organization_id = private.org_id() and k.deleted_at is null
      and (private.can('contracts.read', k.owner_id)
           or (private.perm_scope('contracts.read') is not null and private.can_read_client(k.client_id)))
  );
$$;

grant execute on function private.can_read_client(uuid), private.can_read_contract(uuid) to authenticated;

-- Contratos: auditoria completa (valores, datas, situação, responsável).
create trigger audit_contracts after insert or update or delete on public.contracts
  for each row execute function private.audit_row();
create trigger audit_clients after update or delete on public.clients
  for each row execute function private.audit_row('document,billing_email,billing_phone_e164', 'owner_id,status,deleted_at,legal_name,document');

create or replace function private.contracts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or current_setting('hub.trusted_op', true) = 'on' then
    return new;
  end if;
  if not private.can_read_client(new.client_id) then
    raise exception 'Cliente não encontrado.' using errcode = '42501';
  end if;
  if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null)
     and not private.can('contracts.delete', coalesce(old.owner_id, new.owner_id)) then
    raise exception 'Você não tem permissão para excluir contratos.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger contracts_guard before insert or update on public.contracts
  for each row execute function private.contracts_guard();

-- -----------------------------------------------------------------------------
-- Conversão de lead em cliente (transação única)
-- -----------------------------------------------------------------------------
create or replace function public.convert_lead(
  p_lead uuid,
  p_deal uuid,
  p_legal_name text,
  p_document text,
  p_billing_email text,
  p_billing_phone text,
  p_contract jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := private.org_id();
  v_client uuid;
  v_contract uuid;
  v_won uuid;
  v_lead record;
begin
  if not private.has_perm('clients.create') then
    raise exception 'Você não tem permissão para converter leads.' using errcode = '42501';
  end if;
  select id, name, owner_id, status into v_lead from public.leads where id = p_lead and deleted_at is null;
  if v_lead.id is null then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.clients where lead_id = p_lead) then
    raise exception 'Este lead já é cliente.' using errcode = 'P0001', hint = 'already_client';
  end if;

  insert into public.clients (organization_id, lead_id, legal_name, document, billing_email, billing_phone_e164, owner_id)
  values (v_org, p_lead, nullif(trim(p_legal_name), ''), nullif(regexp_replace(coalesce(p_document, ''), '\D', '', 'g'), ''),
          nullif(lower(trim(p_billing_email)), ''), nullif(trim(p_billing_phone), ''), coalesce(v_lead.owner_id, auth.uid()))
  returning id into v_client;

  update public.leads set status = 'cliente' where id = p_lead;

  -- Negócio vai para a etapa de ganho do seu funil.
  if p_deal is not null then
    select s.id into v_won from public.deals d join public.stages s on s.pipeline_id = d.pipeline_id and s.kind = 'won'
     where d.id = p_deal order by s.position limit 1;
    if v_won is not null then
      update public.deals set stage_id = v_won where id = p_deal and stage_id <> v_won;
    end if;
  end if;

  if p_contract is not null then
    insert into public.contracts (organization_id, client_id, service_id, deal_id, owner_id, title, description, amount_cents,
                                  payment_method, recurrence, start_date, end_date, due_day, status)
    values (v_org, v_client, nullif(p_contract ->> 'service_id', '')::uuid, p_deal, coalesce(v_lead.owner_id, auth.uid()),
            p_contract ->> 'title', nullif(p_contract ->> 'description', ''), (p_contract ->> 'amount_cents')::bigint,
            coalesce(nullif(p_contract ->> 'payment_method', ''), 'pix')::public.payment_method,
            coalesce(nullif(p_contract ->> 'recurrence', ''), 'unica')::public.recurrence,
            (p_contract ->> 'start_date')::date, nullif(p_contract ->> 'end_date', '')::date,
            nullif(p_contract ->> 'due_day', '')::int, 'ativo')
    returning id into v_contract;
  end if;

  insert into public.activities (organization_id, lead_id, deal_id, client_id, contract_id, type, content)
  values (v_org, p_lead, p_deal, v_client, v_contract, 'sistema', 'Convertido em cliente');

  perform private.log_event('convert_lead', 'leads', p_lead::text,
                            jsonb_build_object('client_id', v_client, 'contract_id', v_contract, 'deal_id', p_deal));

  return jsonb_build_object('client_id', v_client, 'contract_id', v_contract);
end;
$$;

grant execute on function public.convert_lead(uuid, uuid, text, text, text, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Anexos (metadados) + Storage privado
-- Caminho: {organization_id}/{entity_type}/{entity_id}/{uuid}-{nome}
-- -----------------------------------------------------------------------------
create table public.attachments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default private.org_id() references public.organizations (id) on delete cascade,
  entity_type      text not null check (entity_type in ('lead', 'client', 'contract', 'task', 'transaction')),
  entity_id        uuid not null,
  storage_path     text not null unique,
  file_name        text not null check (char_length(file_name) between 1 and 200),
  mime_type        text not null,
  size_bytes       bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  uploaded_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index attachments_entity_idx on public.attachments (entity_type, entity_id) where deleted_at is null;

-- Substituída na Fase 5 para incluir lançamentos financeiros.
create or replace function private.can_access_entity(p_type text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'lead' then private.can_read_lead(p_id)
    when 'client' then private.can_read_client(p_id)
    when 'contract' then private.can_read_contract(p_id)
    when 'task' then private.can_read_task(p_id)
    else false
  end;
$$;

grant execute on function private.can_access_entity(text, uuid) to authenticated;

create trigger audit_attachments after update or delete on public.attachments
  for each row execute function private.audit_row('', 'deleted_at');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 15728640, array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'text/plain'
])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Extrai a entidade do caminho do arquivo e reaproveita a mesma regra de acesso.
create or replace function private.storage_entity_ok(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (storage.foldername(p_name))[1] = private.org_id()::text
     and (storage.foldername(p_name))[3] ~ '^[0-9a-f-]{36}$'
     and private.can_access_entity((storage.foldername(p_name))[2], ((storage.foldername(p_name))[3])::uuid);
$$;

grant execute on function private.storage_entity_ok(text) to authenticated;

create policy attachments_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and private.storage_entity_ok(name));
create policy attachments_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and private.storage_entity_ok(name));
create policy attachments_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and private.storage_entity_ok(name) and owner_id = (select auth.uid())::text);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.services enable row level security;
alter table public.clients enable row level security;
alter table public.contracts enable row level security;
alter table public.attachments enable row level security;

create policy services_select on public.services for select to authenticated
  using (organization_id = (select private.org_id()));
create policy services_write on public.services for all to authenticated
  using (organization_id = (select private.org_id()) and (select private.has_perm('admin.settings')))
  with check (organization_id = (select private.org_id()) and (select private.has_perm('admin.settings')));

create policy clients_select on public.clients for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null
         and (private.can('clients.read', owner_id) or private.can_read_lead(lead_id)));
create policy clients_insert on public.clients for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('clients.create'))
              and private.can_read_lead(lead_id));
create policy clients_update on public.clients for update to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('clients.update', owner_id) or private.can('clients.delete', owner_id)))
  with check (organization_id = (select private.org_id()));

create policy contracts_select on public.contracts for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null
         and (private.can('contracts.read', owner_id)
              or ((select private.perm_scope('contracts.read')) is not null and private.can_read_client(client_id))));
create policy contracts_insert on public.contracts for insert to authenticated
  with check (organization_id = (select private.org_id()) and (select private.has_perm('contracts.create')));
create policy contracts_update on public.contracts for update to authenticated
  using (organization_id = (select private.org_id())
         and (private.can('contracts.update', owner_id) or private.can('contracts.delete', owner_id)))
  with check (organization_id = (select private.org_id()));

create policy attachments_select on public.attachments for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is null and private.can_access_entity(entity_type, entity_id));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (organization_id = (select private.org_id()) and private.can_access_entity(entity_type, entity_id)
              and uploaded_by = (select auth.uid())
              and storage_path like (select private.org_id())::text || '/' || entity_type || '/' || entity_id::text || '/%');
create policy attachments_update on public.attachments for update to authenticated
  using (organization_id = (select private.org_id()) and private.can_access_entity(entity_type, entity_id)
         and (uploaded_by = (select auth.uid()) or (select private.has_perm('admin.data_export'))));

-- -----------------------------------------------------------------------------
-- Serviços iniciais
-- -----------------------------------------------------------------------------
insert into public.services (organization_id, name, kind, is_recurring)
select o.id, s.name, s.kind::public.service_kind, s.rec
from public.organizations o
cross join (values
  ('Criação de site', 'site', false),
  ('Manutenção de site', 'manutencao', true),
  ('Meta Ads', 'meta_ads', true),
  ('Google Ads', 'google_ads', true),
  ('Google Meu Negócio', 'outro', false),
  ('Outros serviços', 'outro', false)
) as s(name, kind, rec)
on conflict do nothing;
