-- =============================================================================
-- Fase 10 · Financeiro: controle das séries recorrentes (pausar, retomar,
-- encerrar) sem alterar o histórico, e rótulo opcional por série
-- =============================================================================
-- Regras:
--   * Ocorrências passadas, pagas ou conciliadas nunca são tocadas.
--   * Pausar/encerrar move para a lixeira só as ocorrências PREVISTAS a partir
--     de amanhã (restauráveis). Retomar volta a gerar a partir de hoje.
-- =============================================================================

alter table public.financial_recurrences
  add column paused_at timestamptz,
  add column ended_at timestamptz;

-- Só o financeiro da empresa entra na auditoria geral (ADR 0007).
create trigger audit_financial_recurrences after update on public.financial_recurrences
  for each row when (new.scope = 'empresa')
  execute function private.audit_row('template', 'is_active,end_date,frequency,paused_at,ended_at');

create or replace function public.set_recurrence_state(p_id uuid, p_state text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.financial_recurrences;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_count int := 0;
begin
  select * into v_rec from public.financial_recurrences where id = p_id and organization_id = private.org_id() for update;
  if v_rec.id is null or not private.fin_can(v_rec.scope, v_rec.owner_user_id, 'update') then
    raise exception 'Recorrência não encontrada.' using errcode = 'P0002';
  end if;
  if v_rec.ended_at is not null then
    raise exception 'Esta recorrência foi encerrada. Crie uma nova se precisar.' using errcode = 'P0001';
  end if;

  if p_state in ('pausada', 'encerrada') then
    -- Permissão já conferida acima (editar a série); o guard não precisa exigir "excluir".
    perform set_config('hub.trusted_op', 'on', true);
    update public.financial_transactions
       set deleted_at = now()
     where recurrence_id = v_rec.id and status = 'previsto' and reconciled_at is null
       and due_date > v_today and deleted_at is null;
    get diagnostics v_count = row_count;
    perform set_config('hub.trusted_op', 'off', true);
    update public.financial_recurrences
       set is_active = false,
           paused_at = case when p_state = 'pausada' then now() else paused_at end,
           ended_at = case when p_state = 'encerrada' then now() else null end,
           end_date = case when p_state = 'encerrada' then v_today else end_date end
     where id = v_rec.id;
  elsif p_state = 'ativa' then
    -- Retoma a partir de hoje: a próxima geração cria as ocorrências futuras.
    update public.financial_recurrences
       set is_active = true,
           paused_at = null,
           generated_until = greatest(coalesce((
             select max(due_date) from public.financial_transactions
              where recurrence_id = v_rec.id and deleted_at is null), v_rec.start_date - 1), v_today)
     where id = v_rec.id;
  else
    raise exception 'Situação inválida.' using errcode = 'P0001';
  end if;

  if v_rec.scope = 'empresa' then
    perform private.log_event('recurrence_' || p_state, 'financial_recurrences', v_rec.id::text,
      jsonb_build_object('ocorrencias_removidas', v_count), v_rec.organization_id);
  end if;
  return v_count;
end;
$$;

revoke execute on function public.set_recurrence_state(uuid, text) from public, anon;
grant execute on function public.set_recurrence_state(uuid, text) to authenticated;
