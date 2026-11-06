-- =============================================================================
-- Modelos de papel por função
-- =============================================================================
-- Catálogo global (igual para todas as empresas) de onde o administrador cria
-- um papel e depois edita à vontade. Não cria papéis sozinho: nada muda para
-- quem não usar. Papéis equivalentes já existentes continuam sendo o ponto de
-- partida para Administrador, Comercial (Vendedor), Atendimento (Atendente) e
-- Financeiro. "Próprios" = o que é da pessoa + os clientes associados a ela
-- (Equipe do cliente ou squad).
-- Criar a partir do modelo passa pela trava de autoelevação: quem não é
-- Administrador só cria se tiver tudo o que o modelo concede.
-- =============================================================================

create table public.role_templates (
  key          text primary key check (key ~ '^[a-z_]{2,40}$'),
  name         text not null,
  description  text not null default '',
  permissions  jsonb not null,  -- [{"key": "tasks.read", "scope": "own"}, ...]
  position     int not null default 0
);

alter table public.role_templates enable row level security;
revoke all on public.role_templates from anon, authenticated;
grant select on public.role_templates to authenticated;
create policy role_templates_select on public.role_templates for select to authenticated using (true);

insert into public.role_templates (key, name, description, permissions, position) values
  ('gestor_operacional', 'Gestor operacional',
   'Acompanha clientes, tarefas, agenda, conteúdo, anúncios e atendimento de toda a equipe, sem valores financeiros.',
   '[{"key":"clients.read","scope":"all"},{"key":"tasks.read","scope":"all"},{"key":"tasks.create","scope":"all"},{"key":"tasks.update","scope":"all"},
     {"key":"tasks.delete","scope":"all"},{"key":"tasks.board.configure","scope":"all"},{"key":"calendar.read","scope":"all"},{"key":"calendar.manage","scope":"all"},
     {"key":"content.read","scope":"all"},{"key":"ads.read","scope":"all"},{"key":"inbox.read","scope":"all"},{"key":"tags.manage","scope":"all"},
     {"key":"finance.personal.manage","scope":"own"}]', 10),
  ('gestor_trafego', 'Gestor de tráfego',
   'Anúncios, campanhas, relatórios e tarefas dos clientes em que trabalha.',
   '[{"key":"ads.read","scope":"own"},{"key":"ads.manage","scope":"own"},{"key":"clients.read","scope":"own"},{"key":"content.read","scope":"own"},
     {"key":"tasks.read","scope":"own"},{"key":"tasks.create","scope":"own"},{"key":"tasks.update","scope":"own"},
     {"key":"calendar.read","scope":"own"},{"key":"calendar.manage","scope":"own"},{"key":"finance.personal.manage","scope":"own"}]', 20),
  ('social_media', 'Social media',
   'Conteúdo, aprovações e agenda de publicações dos clientes em que trabalha.',
   '[{"key":"content.read","scope":"own"},{"key":"content.manage","scope":"own"},{"key":"content.publish","scope":"own"},{"key":"clients.read","scope":"own"},
     {"key":"tasks.read","scope":"own"},{"key":"tasks.create","scope":"own"},{"key":"tasks.update","scope":"own"},
     {"key":"calendar.read","scope":"own"},{"key":"calendar.manage","scope":"own"},{"key":"finance.personal.manage","scope":"own"}]', 30),
  ('designer_video', 'Designer e vídeo',
   'Briefings, peças, revisões e entregas das tarefas e dos clientes em que trabalha.',
   '[{"key":"tasks.read","scope":"own"},{"key":"tasks.create","scope":"own"},{"key":"tasks.update","scope":"own"},{"key":"clients.read","scope":"own"},
     {"key":"content.read","scope":"own"},{"key":"content.manage","scope":"own"},{"key":"calendar.read","scope":"own"},{"key":"finance.personal.manage","scope":"own"}]', 40),
  ('desenvolvimento_web', 'Desenvolvimento e web',
   'Projetos de site, tarefas técnicas e anexos dos clientes em que trabalha.',
   '[{"key":"tasks.read","scope":"own"},{"key":"tasks.create","scope":"own"},{"key":"tasks.update","scope":"own"},{"key":"clients.read","scope":"own"},
     {"key":"calendar.read","scope":"own"},{"key":"calendar.manage","scope":"own"},{"key":"finance.personal.manage","scope":"own"}]', 50),
  ('dados_relatorios', 'Dados e relatórios',
   'Indicadores, painéis e relatórios da empresa, sem valores de contrato nem financeiro.',
   '[{"key":"dashboards.commercial","scope":"all"},{"key":"ads.read","scope":"all"},{"key":"clients.read","scope":"all"},{"key":"crm.leads.read","scope":"all"},
     {"key":"tasks.read","scope":"own"},{"key":"tasks.create","scope":"own"},{"key":"tasks.update","scope":"own"},{"key":"calendar.read","scope":"own"},
     {"key":"finance.personal.manage","scope":"own"}]', 60);

-- Todo modelo só usa permissões que existem no catálogo.
do $$
begin
  if exists (
    select 1 from public.role_templates t, jsonb_array_elements(t.permissions) p
    where not exists (select 1 from public.permissions k where k.key = p ->> 'key')
       or (p ->> 'scope') not in ('own', 'team', 'all')
  ) then
    raise exception 'Modelo de papel com permissão ou escopo inválido.';
  end if;
end;
$$;

create or replace function public.admin_create_role_from_template(p_template text, p_name text, p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tpl public.role_templates;
  v_id uuid;
begin
  if not private.has_perm('admin.roles') then
    raise exception 'Você não tem permissão para gerenciar papéis.' using errcode = '42501';
  end if;
  select * into v_tpl from public.role_templates where key = p_template;
  if v_tpl.key is null then
    raise exception 'Modelo não encontrado.' using errcode = 'P0002';
  end if;
  v_id := public.admin_create_role(coalesce(nullif(trim(p_name), ''), v_tpl.name), coalesce(nullif(trim(p_description), ''), v_tpl.description), null);
  -- Cada inserção passa pela trava (quem não é Administrador só concede o que tem).
  insert into public.role_permissions (role_id, permission_key, scope)
  select v_id, p ->> 'key', (p ->> 'scope')::public.permission_scope
  from jsonb_array_elements(v_tpl.permissions) p;
  return v_id;
end;
$$;

revoke execute on function public.admin_create_role_from_template(text, text, text) from public, anon;
grant execute on function public.admin_create_role_from_template(text, text, text) to authenticated;
