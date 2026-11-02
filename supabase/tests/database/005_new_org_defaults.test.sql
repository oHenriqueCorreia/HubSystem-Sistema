begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into public.organizations (id, name) values ('d0000000-0000-0000-0000-00000000000a', 'Org nova teste');

create or replace function pg_temp.has(p_role text, p_key text) returns boolean language sql as $$
  select exists (
    select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id
    where r.organization_id = 'd0000000-0000-0000-0000-00000000000a' and r.key = p_role and rp.permission_key = p_key
  );
$$;

select ok(pg_temp.has('gestor', 'inbox.manage'), 'empresa nova: gestor gerencia o atendimento');
select ok(pg_temp.has('gestor', 'ads.read'), 'empresa nova: gestor vê anúncios');
select ok(pg_temp.has('vendedor', 'inbox.reply'), 'empresa nova: vendedor responde conversas');
select ok(pg_temp.has('leitura', 'ads.read'), 'empresa nova: somente leitura vê anúncios');

select throws_ok($$
  delete from public.roles where organization_id = 'd0000000-0000-0000-0000-00000000000a' and key = 'gestor'
$$, 'P0001', null, 'papel padrão continua protegido contra exclusão direta');

delete from public.organizations where id = 'd0000000-0000-0000-0000-00000000000a';
select is((select count(*)::int from public.roles where organization_id = 'd0000000-0000-0000-0000-00000000000a'), 0,
  'excluir a empresa vazia remove os papéis dela');

select * from finish();
rollback;
