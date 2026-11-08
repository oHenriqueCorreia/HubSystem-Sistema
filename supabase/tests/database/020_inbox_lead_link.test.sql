begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into public.organizations (id, name) values
  ('aa000000-0000-4000-8000-00000000000a', 'Atendimento A'),
  ('aa000000-0000-4000-8000-00000000000b', 'Atendimento B');

create or replace function pg_temp.mk_user(p_id uuid, p_email text, p_role uuid)
returns void language plpgsql as $$
declare
  v_inv uuid := gen_random_uuid();
begin
  insert into public.invitations (id, organization_id, email, mode, role_id, token_hash)
  values (v_inv, 'aa000000-0000-4000-8000-00000000000a', p_email, 'equipe', p_role, 'hash-' || v_inv);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, jsonb_build_object('invitation_id', v_inv), now(), now());
  update public.invitations set user_id = p_id where id = v_inv;
  perform public.finalize_invitation(v_inv, split_part(p_email, '@', 1));
end;
$$;
select pg_temp.mk_user('aa000000-0000-4000-8000-000000000001', 'adm@atd.t',
  (select id from public.roles where organization_id = 'aa000000-0000-4000-8000-00000000000a' and key = 'admin'));

select is(private.br_phone_variants('+5548999990000'), array['+5548999990000', '+554899990000'], 'celular com 9: também sem o 9');
select is(private.br_phone_variants('+554899990000'), array['+554899990000', '+5548999990000'], 'celular sem 9: também com o 9');
select is(private.br_phone_variants('+554833330000'), array['+554833330000'], 'fixo fica como está');

insert into public.whatsapp_numbers (id, organization_id, provider, waha_url, waha_session, webhook_secret_enc, token_enc, status) values
  ('aa000000-0000-4000-8000-0000000000b1', 'aa000000-0000-4000-8000-00000000000a', 'waha', 'https://waha.t', 'hub_a1', 'x', 'x', 'ativo'),
  ('aa000000-0000-4000-8000-0000000000b2', 'aa000000-0000-4000-8000-00000000000b', 'waha', 'https://waha.t', 'hub_b1', 'x', 'x', 'ativo');
-- Conversa chegou antes do lead existir (registrada sem o 9º dígito).
insert into public.conversations (id, organization_id, number_id, contact_e164, contact_name) values
  ('aa000000-0000-4000-8000-0000000000c1', 'aa000000-0000-4000-8000-00000000000a', 'aa000000-0000-4000-8000-0000000000b1', '+554899990000', 'Contato'),
  ('aa000000-0000-4000-8000-0000000000c2', 'aa000000-0000-4000-8000-00000000000b', 'aa000000-0000-4000-8000-0000000000b2', '+554899990000', 'Outra empresa');

insert into public.leads (id, organization_id, name, phone_e164, owner_id) values
  ('aa000000-0000-4000-8000-0000000000d1', 'aa000000-0000-4000-8000-00000000000a', 'Pizzaria Nova', '+5548999990000', 'aa000000-0000-4000-8000-000000000001');

select is((select lead_id::text from public.conversations where id = 'aa000000-0000-4000-8000-0000000000c1'), 'aa000000-0000-4000-8000-0000000000d1', 'lead novo assume a conversa antiga do mesmo número');
select is((select assignee_id::text from public.conversations where id = 'aa000000-0000-4000-8000-0000000000c1'), 'aa000000-0000-4000-8000-000000000001', 'responsável do lead vira responsável da conversa');
select is((select lead_id from public.conversations where id = 'aa000000-0000-4000-8000-0000000000c2'), null, 'conversa de outra empresa não é tocada');

-- Foto: quem usa o sistema não troca; o servidor troca.
update public.conversations set avatar_url = 'https://pps.whatsapp.net/a.jpg' where id = 'aa000000-0000-4000-8000-0000000000c1';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'aa000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
update public.conversations set avatar_url = 'https://evil.t/x.png' where id = 'aa000000-0000-4000-8000-0000000000c1';
reset role;
select is((select avatar_url from public.conversations where id = 'aa000000-0000-4000-8000-0000000000c1'), 'https://pps.whatsapp.net/a.jpg', 'usuário não troca a foto da conversa');

select * from finish();
rollback;
