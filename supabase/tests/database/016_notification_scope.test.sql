begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- Administrador (A), Gestor (G, conteúdo "todos"), social associado ao cliente X (S)
-- e social sem associação (R). S e R têm conteúdo com escopo "próprios".
insert into public.organizations (id, name) values ('b8000000-0000-4000-8000-00000000000a', 'Avisos A');
insert into public.roles (id, organization_id, key, name) values
  ('b8000000-0000-4000-8000-0000000000e1', 'b8000000-0000-4000-8000-00000000000a', 'social_t', 'Social media');
insert into public.role_permissions (role_id, permission_key, scope) values
  ('b8000000-0000-4000-8000-0000000000e1', 'content.read', 'own'), ('b8000000-0000-4000-8000-0000000000e1', 'content.manage', 'own'),
  ('b8000000-0000-4000-8000-0000000000e1', 'ads.read', 'own');

create or replace function pg_temp.mk_user(p_id uuid, p_email text, p_role uuid)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
begin
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, 'b8000000-0000-4000-8000-00000000000a', p_email, 'equipe', p_role, 'hash-' || v_inv);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, jsonb_build_object('invitation_id', v_inv), now(), now());
  update public.invitations set user_id = p_id where id = v_inv;
  perform public.finalize_invitation(v_inv, split_part(p_email, '@', 1));
end;
$$;
create or replace function pg_temp.role(p_key text) returns uuid language sql as $$
  select id from public.roles where organization_id = 'b8000000-0000-4000-8000-00000000000a' and key = p_key;
$$;
create or replace function pg_temp.got(p_key text) returns text[] language sql as $$
  select coalesce(array_agg(split_part(p.email, '@', 1) order by p.email), '{}')
  from public.notifications n join public.profiles p on p.id = n.user_id where n.dedupe_key = p_key;
$$;

select pg_temp.mk_user('b8000000-0000-4000-8000-000000000001', 'a@avisos.t', pg_temp.role('admin'));
select pg_temp.mk_user('b8000000-0000-4000-8000-000000000002', 'g@avisos.t', pg_temp.role('gestor'));
select pg_temp.mk_user('b8000000-0000-4000-8000-000000000003', 's@avisos.t', 'b8000000-0000-4000-8000-0000000000e1');
select pg_temp.mk_user('b8000000-0000-4000-8000-000000000004', 'r@avisos.t', 'b8000000-0000-4000-8000-0000000000e1');

insert into public.leads (id, organization_id, name) values ('b8000000-0000-4000-8000-0000000000a1', 'b8000000-0000-4000-8000-00000000000a', 'Hamburgueria X');
insert into public.clients (id, organization_id, lead_id) values ('b8000000-0000-4000-8000-0000000000c1', 'b8000000-0000-4000-8000-00000000000a', 'b8000000-0000-4000-8000-0000000000a1');
insert into public.client_members (client_id, user_id, organization_id) values
  ('b8000000-0000-4000-8000-0000000000c1', 'b8000000-0000-4000-8000-000000000003', 'b8000000-0000-4000-8000-00000000000a');

-- Aviso de registro: quem tem "todos", e quem trabalha no cliente.
select public.notify_users('b8000000-0000-4000-8000-00000000000a', 'content.manage', 'teste', 'Post do cliente X', null, null, 'k-reg',
  p_client => 'b8000000-0000-4000-8000-0000000000c1', p_owner => 'b8000000-0000-4000-8000-000000000001', p_record => true);
select is(pg_temp.got('k-reg'), array['a', 'g', 's'], 'aviso de registro vai para escopo "todos" e para quem trabalha no cliente');

-- Aviso geral da empresa (sem contexto): todos com a permissão, como antes.
select public.notify_users('b8000000-0000-4000-8000-00000000000a', 'content.manage', 'teste', 'Conexão expirada', null, null, 'k-geral');
select is(pg_temp.got('k-geral'), array['a', 'g', 'r', 's'], 'aviso geral vai para todos com a permissão');

-- Autor com escopo "próprios" recebe o aviso do próprio registro.
select public.notify_users('b8000000-0000-4000-8000-00000000000a', 'content.manage', 'teste', 'Seu post', null, null, 'k-autor',
  p_owner => 'b8000000-0000-4000-8000-000000000004', p_record => true);
select is(pg_temp.got('k-autor'), array['a', 'g', 'r'], 'autor com escopo próprio recebe; quem não é autor nem trabalha no cliente, não');

-- Conta de anúncio sem cliente ligado: só escopo "todos".
select public.notify_users('b8000000-0000-4000-8000-00000000000a', 'ads.read', 'teste', 'Saldo baixo', null, null, 'k-ads', p_record => true);
select is(pg_temp.got('k-ads'), array['a', 'g'], 'alerta de conta sem cliente vai só para escopo "todos"');

-- Chamada antiga, com 7 argumentos posicionais (funções do Atendimento), continua funcionando.
select lives_ok($$ select public.notify_users('b8000000-0000-4000-8000-00000000000a', 'content.read', 'teste', 'x', null, null, 'k-antiga') $$,
  'chamada antiga com 7 argumentos continua válida');

-- Fluxo real (tarefa sem responsável, então o aviso vai para a equipe): o cliente aprova
-- pelo link e o aviso respeita o escopo do conteúdo. Com responsável, só ele é avisado.
insert into public.tasks (id, organization_id, title, owner_id, client_id) values
  ('b8000000-0000-4000-8000-0000000000b1', 'b8000000-0000-4000-8000-00000000000a', 'Post X', null, 'b8000000-0000-4000-8000-0000000000c1');
insert into public.content_items (id, organization_id, task_id, client_id, caption, status, created_by) values
  ('b8000000-0000-4000-8000-0000000000d1', 'b8000000-0000-4000-8000-00000000000a', 'b8000000-0000-4000-8000-0000000000b1',
   'b8000000-0000-4000-8000-0000000000c1', 'Combo de sexta', 'aguardando_aprovacao', 'b8000000-0000-4000-8000-000000000001');
insert into public.content_review_links (id, organization_id, content_id, version, token_hash, expires_at) values
  ('b8000000-0000-4000-8000-0000000000f1', 'b8000000-0000-4000-8000-00000000000a', 'b8000000-0000-4000-8000-0000000000d1', 1, 'hash-link-x', now() + interval '1 day');
select lives_ok($$ select public.content_decide('hash-link-x', 'aprovado', '', 'Dono da hamburgueria') $$, 'cliente aprova pelo link');
select is(pg_temp.got('conteudo:b8000000-0000-4000-8000-0000000000f1'), array['a', 'g', 's'], 'aviso da aprovação não chega a quem não trabalha no cliente');

-- "Negar" individual continua valendo junto com o escopo.
insert into public.user_permission_overrides (user_id, permission_key, effect) values ('b8000000-0000-4000-8000-000000000002', 'content.manage', 'deny');
select public.notify_users('b8000000-0000-4000-8000-00000000000a', 'content.manage', 'teste', 'Outro post', null, null, 'k-negar',
  p_client => 'b8000000-0000-4000-8000-0000000000c1', p_record => true);
select is(pg_temp.got('k-negar'), array['a', 's'], '"negar" tira o gestor mesmo com escopo "todos"');

select * from finish();
rollback;
