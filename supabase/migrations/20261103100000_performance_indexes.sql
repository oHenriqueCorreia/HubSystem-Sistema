-- =============================================================================
-- Otimização: índices das consultas frequentes e pg_net fora do schema public
-- =============================================================================
--   * Lembretes (rodam a cada minuto) buscam por responsável e por data.
--   * Funil e categorias do financeiro filtram por chaves sem índice próprio.
-- =============================================================================

create index if not exists tasks_reminders_idx on public.tasks (owner_id, due_at)
  where deleted_at is null and status in ('a_fazer', 'em_andamento') and due_at is not null;
create index if not exists calendar_events_reminders_idx on public.calendar_events (owner_id, starts_at) where deleted_at is null;
create index if not exists leads_reminders_idx on public.leads (owner_id, next_contact_at)
  where deleted_at is null and next_contact_at is not null;
create index if not exists fin_txn_open_due_idx on public.financial_transactions (organization_id, due_date)
  where deleted_at is null and status = 'previsto';
create index if not exists fin_txn_category_idx on public.financial_transactions (category_id) where deleted_at is null;
create index if not exists deals_stage_idx on public.deals (stage_id) where deleted_at is null;
create index if not exists contracts_end_idx on public.contracts (organization_id, end_date) where deleted_at is null and status = 'ativo';

-- pg_net nunca deve ficar exposto na API: o schema public é publicado pelo PostgREST.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
