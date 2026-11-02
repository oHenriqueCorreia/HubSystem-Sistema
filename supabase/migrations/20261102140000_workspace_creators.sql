-- =============================================================================
-- Convite de "ambiente próprio" (empresa nova) só para contas autorizadas
-- =============================================================================
-- Antes: qualquer administrador podia criar empresas novas por convite, inclusive
-- quem acabou de ganhar um ambiente próprio.
-- Agora só quem está em private.workspace_creators convida nesse modo. Convites
-- de equipe continuam liberados para os administradores de cada organização.
-- A regra fica no banco: vale mesmo para um servidor com código antigo.
-- =============================================================================

create table private.workspace_creators (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Dono da plataforma. Em bancos sem essa conta (local, testes) não insere nada.
insert into private.workspace_creators (user_id)
select id from auth.users where id = 'b7259480-e625-4d53-9507-da0487bed085';

create or replace function public.can_create_workspaces()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.workspace_creators c where c.user_id = auth.uid());
$$;

revoke execute on function public.can_create_workspaces() from public, anon;
grant execute on function public.can_create_workspaces() to authenticated;

create or replace function private.invitations_check_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.mode = 'ambiente'
     and not exists (select 1 from private.workspace_creators c where c.user_id = new.invited_by) then
    raise exception 'Sem autorização para criar empresas novas por convite.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger invitations_check_mode before insert or update of mode, invited_by on public.invitations
  for each row execute function private.invitations_check_mode();
