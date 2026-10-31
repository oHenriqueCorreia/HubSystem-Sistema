-- =============================================================================
-- Corrige a exclusão lógica (lixeira) de tarefas, eventos, clientes, contratos,
-- anexos e lançamentos financeiros.
-- =============================================================================
-- Problema: a exclusão é um UPDATE que preenche deleted_at. As políticas de
-- SELECT dessas tabelas exigem deleted_at is null, e o Postgres recusa um UPDATE
-- cuja linha nova deixa de ser visível para quem o executa ("new row violates
-- row-level security policy"). Resultado: nem o administrador conseguia excluir.
--
-- Correção: o mesmo padrão já usado em leads (leads_select_trash): registros
-- excluídos ficam visíveis somente para quem tem permissão de excluí-los. Isso
-- também permite restaurá-los. Todas as consultas do app e das funções SQL já
-- filtram deleted_at is null explicitamente, então nada excluído aparece nas listas.
-- =============================================================================

create policy tasks_select_trash on public.tasks for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is not null
         and private.can('tasks.delete', owner_id));

-- Não há permissão calendar.delete: excluir evento exige calendar.manage.
create policy events_select_trash on public.calendar_events for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is not null
         and private.can('calendar.manage', owner_id));

create policy clients_select_trash on public.clients for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is not null
         and private.can('clients.delete', owner_id));

create policy contracts_select_trash on public.contracts for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is not null
         and private.can('contracts.delete', owner_id));

create policy fin_txn_select_trash on public.financial_transactions for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is not null
         and private.fin_can(scope, owner_user_id, 'delete'));

-- Mesma regra de attachments_update: quem enviou ou quem administra dados.
create policy attachments_select_trash on public.attachments for select to authenticated
  using (organization_id = (select private.org_id()) and deleted_at is not null
         and private.can_access_entity(entity_type, entity_id)
         and (uploaded_by = (select auth.uid()) or (select private.has_perm('admin.data_export'))));
