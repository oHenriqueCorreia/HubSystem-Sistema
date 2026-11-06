begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Administrador (A), social media com escopo "próprios" (S) e Somente leitura (L).
insert into public.organizations (id, name) values ('f1000000-0000-4000-8000-00000000000a', 'Conteúdo A');
insert into public.roles (id, organization_id, key, name) values
  ('f1000000-0000-4000-8000-0000000000e1', 'f1000000-0000-4000-8000-00000000000a', 'social_t', 'Social media');
insert into public.role_permissions (role_id, permission_key, scope) values
  ('f1000000-0000-4000-8000-0000000000e1', 'content.read', 'own'), ('f1000000-0000-4000-8000-0000000000e1', 'content.manage', 'own'),
  ('f1000000-0000-4000-8000-0000000000e1', 'content.publish', 'own'), ('f1000000-0000-4000-8000-0000000000e1', 'tasks.read', 'own'),
  ('f1000000-0000-4000-8000-0000000000e1', 'clients.read', 'own');

create or replace function pg_temp.mk_user(p_id uuid, p_email text, p_role uuid)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
begin
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, 'f1000000-0000-4000-8000-00000000000a', p_email, 'equipe', p_role, 'hash-' || v_inv);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, jsonb_build_object('invitation_id', v_inv), now(), now());
  update public.invitations set user_id = p_id where id = v_inv;
  perform public.finalize_invitation(v_inv, split_part(p_email, '@', 1));
end;
$$;
create or replace function pg_temp.role(p_key text) returns uuid language sql as $$
  select id from public.roles where organization_id = 'f1000000-0000-4000-8000-00000000000a' and key = p_key;
$$;
create or replace function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

select pg_temp.mk_user('f1000000-0000-4000-8000-000000000001', 'adm@conteudo.t', pg_temp.role('admin'));
select pg_temp.mk_user('f1000000-0000-4000-8000-000000000002', 'social@conteudo.t', 'f1000000-0000-4000-8000-0000000000e1');
select pg_temp.mk_user('f1000000-0000-4000-8000-000000000003', 'leitura@conteudo.t', pg_temp.role('leitura'));

insert into public.leads (id, organization_id, name, owner_id) values
  ('f1000000-0000-4000-8000-0000000000a1', 'f1000000-0000-4000-8000-00000000000a', 'Café X', 'f1000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-0000000000a2', 'f1000000-0000-4000-8000-00000000000a', 'Loja Y', 'f1000000-0000-4000-8000-000000000001');
insert into public.clients (id, organization_id, lead_id, owner_id) values
  ('f1000000-0000-4000-8000-0000000000c1', 'f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000000a1', 'f1000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-0000000000c2', 'f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000000a2', 'f1000000-0000-4000-8000-000000000001');
insert into public.client_members (client_id, user_id, organization_id) values
  ('f1000000-0000-4000-8000-0000000000c1', 'f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-00000000000a');
insert into public.tasks (id, organization_id, title, owner_id, client_id, created_by) values
  ('f1000000-0000-4000-8000-0000000000b1', 'f1000000-0000-4000-8000-00000000000a', 'Post X', 'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-0000000000c1', 'f1000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-0000000000b2', 'f1000000-0000-4000-8000-00000000000a', 'Post Y', 'f1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-0000000000c2', 'f1000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-0000000000b3', 'f1000000-0000-4000-8000-00000000000a', 'Post próprio', 'f1000000-0000-4000-8000-000000000002', null, 'f1000000-0000-4000-8000-000000000002');
insert into public.content_items (id, organization_id, task_id, client_id, caption, created_by) values
  ('f1000000-0000-4000-8000-0000000000d1', 'f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000000b1', 'f1000000-0000-4000-8000-0000000000c1', 'Promoção de café', 'f1000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-0000000000d2', 'f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000000b2', 'f1000000-0000-4000-8000-0000000000c2', 'Liquidação da loja', 'f1000000-0000-4000-8000-000000000001'),
  ('f1000000-0000-4000-8000-0000000000d3', 'f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000000b3', null, 'Bastidores', 'f1000000-0000-4000-8000-000000000002');
insert into public.content_assets (organization_id, content_id, kind, drive_url, drive_file_id, file_name) values
  ('f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-0000000000d2', 'video_drive', 'https://drive.google.com/file/d/abc/view', 'abc', 'Vídeo Y');

set local role authenticated;

select pg_temp.as_user('f1000000-0000-4000-8000-000000000002');
select is((select array_agg(caption order by caption) from public.content_items), array['Bastidores', 'Promoção de café'],
  'social vê o próprio conteúdo e o do cliente associado');
select is((select count(*)::int from public.content_assets where content_id = 'f1000000-0000-4000-8000-0000000000d2'), 0, 'social não vê arquivos de conteúdo de outro cliente');
update public.content_items set caption = 'invadido' where id = 'f1000000-0000-4000-8000-0000000000d2';
select is((select count(*)::int from public.content_items where caption = 'invadido'), 0, 'social não edita conteúdo de outro cliente');
select throws_ok($$ insert into public.content_assets (content_id, kind, drive_url, drive_file_id, file_name) values ('f1000000-0000-4000-8000-0000000000d2', 'video_drive', 'https://drive.google.com/file/d/x/view', 'x', 'x') $$,
  '42501', null, 'social não anexa arquivo em conteúdo de outro cliente');
select throws_ok($$ select public.content_submit_for_approval('f1000000-0000-4000-8000-0000000000d2', 'hash-y', now() + interval '1 day') $$,
  'P0002', null, 'social não envia para aprovação o conteúdo de outro cliente');
select throws_ok($$ select public.content_internal_approve('f1000000-0000-4000-8000-0000000000d2') $$,
  'P0002', null, 'social não aprova conteúdo de outro cliente');
select throws_ok($$ select public.content_schedule('f1000000-0000-4000-8000-0000000000d2', array[]::uuid[], now() + interval '1 day') $$,
  'P0002', null, 'social não agenda conteúdo de outro cliente');
select lives_ok($$ select public.content_submit_for_approval('f1000000-0000-4000-8000-0000000000d1', 'hash-x', now() + interval '1 day') $$,
  'social envia para aprovação o conteúdo do cliente associado');
select lives_ok($$ update public.content_items set caption = 'Bastidores da semana' where id = 'f1000000-0000-4000-8000-0000000000d3' $$,
  'social edita o próprio conteúdo');

-- Sem associação, o conteúdo do cliente some (só fica o próprio).
reset role;
select set_config('request.jwt.claims', '', true);
delete from public.client_members where user_id = 'f1000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.as_user('f1000000-0000-4000-8000-000000000002');
select is((select array_agg(caption) from public.content_items), array['Bastidores da semana'], 'sem associação o social vê só o próprio conteúdo');

-- Escopo "todos" continua vendo tudo.
select pg_temp.as_user('f1000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.content_items), 3, 'somente leitura (todos) vê todo o conteúdo');
select is((select count(*)::int from public.content_assets), 1, 'somente leitura vê os arquivos');
select pg_temp.as_user('f1000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.content_items), 3, 'administrador vê todo o conteúdo');
select lives_ok($$ select public.content_internal_approve('f1000000-0000-4000-8000-0000000000d3') $$, 'administrador aprova conteúdo criado por outra pessoa');

select * from finish();
rollback;
