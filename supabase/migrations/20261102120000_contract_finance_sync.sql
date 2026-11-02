-- =============================================================================
-- Contratos ↔ financeiro da empresa sempre em sincronia
-- =============================================================================
--   * sync_contract_finance(contrato): aplica o estado do contrato às cobranças.
--       - ativo: valor, título, forma de pagamento e término do contrato vão
--         para a recorrência e para as cobranças FUTURAS em aberto; retoma se
--         estava pausada.
--       - pausado/rascunho: pausa a recorrência (cobranças futuras saem).
--       - cancelado/encerrado/excluído: encerra a recorrência e cancela a
--         cobrança única em aberto.
--     Pagas, conciliadas e passadas nunca mudam.
--   * Quem não tem finance.company.update: nada muda no financeiro.
--   * security definer para ver o contrato mesmo excluído, com conferência de
--     organização e permissão; não gera ocorrências (o app chama
--     generate_recurrences no contexto do usuário).
-- =============================================================================

create or replace function public.sync_contract_finance(p_contract uuid, p_ended boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.contracts;
  r public.financial_recurrences;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into k from public.contracts where id = p_contract and organization_id = private.org_id();
  if k.id is null then
    return 'sem_contrato';
  end if;
  if not private.has_perm('finance.company.update') then
    return 'sem_permissao';
  end if;

  select * into r from public.financial_recurrences
   where organization_id = k.organization_id and scope = 'empresa'
     and template ->> 'contract_id' = k.id::text and ended_at is null
   order by created_at desc limit 1;

  perform set_config('hub.trusted_op', 'on', true);

  if p_ended or k.deleted_at is not null or k.status in ('cancelado', 'encerrado') then
    if r.id is not null then
      perform set_config('hub.trusted_op', 'off', true);
      perform public.set_recurrence_state(r.id, 'encerrada');
      perform set_config('hub.trusted_op', 'on', true);
    end if;
    update public.financial_transactions
       set status = 'cancelado'
     where contract_id = k.id and recurrence_id is null and status = 'previsto'
       and reconciled_at is null and deleted_at is null and due_date >= v_today;
    perform set_config('hub.trusted_op', 'off', true);
    return 'encerrada';
  end if;

  if k.status in ('pausado', 'rascunho') then
    perform set_config('hub.trusted_op', 'off', true);
    if r.id is not null and r.is_active then
      perform public.set_recurrence_state(r.id, 'pausada');
    end if;
    return 'pausada';
  end if;

  -- Ativo: o contrato manda nos valores das próximas cobranças.
  if r.id is not null then
    update public.financial_recurrences
       set template = template || jsonb_build_object('description', k.title, 'amount_cents', k.amount_cents, 'payment_method', k.payment_method::text),
           end_date = k.end_date
     where id = r.id;
    update public.financial_transactions
       set description = k.title, amount_cents = k.amount_cents, payment_method = k.payment_method
     where recurrence_id = r.id and status = 'previsto' and reconciled_at is null and deleted_at is null and due_date >= v_today;
    if k.end_date is not null then
      update public.financial_transactions
         set deleted_at = now()
       where recurrence_id = r.id and status = 'previsto' and reconciled_at is null and deleted_at is null and due_date > k.end_date;
    end if;
    perform set_config('hub.trusted_op', 'off', true);
    if not r.is_active then
      perform public.set_recurrence_state(r.id, 'ativa');
    end if;
  else
    update public.financial_transactions
       set description = k.title, amount_cents = k.amount_cents, payment_method = k.payment_method
     where contract_id = k.id and recurrence_id is null and status = 'previsto' and reconciled_at is null and deleted_at is null;
    perform set_config('hub.trusted_op', 'off', true);
  end if;
  return 'ativa';
end;
$$;

revoke execute on function public.sync_contract_finance(uuid, boolean) from public, anon;
grant execute on function public.sync_contract_finance(uuid, boolean) to authenticated;

-- Retomada: data a partir da qual as ocorrências voltam a ser criadas.
alter table public.financial_recurrences add column resume_from date;

-- Encerrar uma série que ainda não começou: o término não pode ficar antes do início.
-- Retomar: continua de onde parou, sem pular o mês atual e sem recriar o período pausado.
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
           end_date = case when p_state = 'encerrada' then greatest(v_today, v_rec.start_date) else end_date end
     where id = v_rec.id;
  elsif p_state = 'ativa' then
    -- Retoma a partir de hoje: a série continua de onde parou, mas só cria
    -- ocorrências com vencimento a partir de hoje (o mês atual não é pulado).
    update public.financial_recurrences
       set is_active = true,
           paused_at = null,
           resume_from = v_today,
           -- Sem nenhuma ocorrência restante, a geração recomeça do início da série.
           generated_until = (select max(due_date) from public.financial_transactions
                               where recurrence_id = v_rec.id and deleted_at is null)
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

-- Geração: ocorrências antes de resume_from (período pausado) não são criadas; a série só avança.
-- Materializa ocorrências das recorrências visíveis ao usuário até p_until.
create or replace function public.generate_recurrences(p_until date default null)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_until date := coalesce(p_until, ((now() at time zone 'America/Sao_Paulo')::date + interval '12 months')::date);
  v_rec record;
  v_date date;
  v_count int := 0;
  v_anchor int;
  v_step interval;
begin
  for v_rec in
    select * from public.financial_recurrences r
     where r.is_active and coalesce(r.generated_until, r.start_date - 1) < v_until
       and private.fin_can(r.scope, r.owner_user_id, 'create')
  loop
    v_anchor := extract(day from v_rec.start_date)::int;
    v_step := case v_rec.frequency when 'trimestral' then interval '3 months' when 'semestral' then interval '6 months' when 'anual' then interval '12 months' else interval '1 month' end;
    if v_rec.due_rule = 'dia_util' then
      if v_rec.generated_until is null then
        v_date := private.nth_business_day(v_rec.start_date, v_rec.business_day);
        -- O dia útil do mês inicial já passou da data de início: começa no período seguinte.
        if v_date < v_rec.start_date then
          v_date := private.nth_business_day((date_trunc('month', v_rec.start_date) + v_step)::date, v_rec.business_day);
        end if;
      else
        v_date := private.nth_business_day((date_trunc('month', v_rec.generated_until) + v_step)::date, v_rec.business_day);
      end if;
    else
      v_date := case when v_rec.generated_until is null then v_rec.start_date else private.next_date(v_rec.generated_until, v_rec.frequency, v_anchor) end;
    end if;

    while v_date <= v_until and (v_rec.end_date is null or v_date <= v_rec.end_date) loop
      if v_rec.resume_from is null or v_date >= v_rec.resume_from then
      insert into public.financial_transactions (
        scope, owner_user_id, kind, description, amount_cents, category_id, cost_center_id, account_id,
        payment_method, competence_date, due_date, status, recurrence_id, client_id, contract_id
      ) values (
        v_rec.scope, v_rec.owner_user_id, (v_rec.template ->> 'kind')::public.txn_kind, v_rec.template ->> 'description',
        (v_rec.template ->> 'amount_cents')::bigint, nullif(v_rec.template ->> 'category_id', '')::uuid,
        nullif(v_rec.template ->> 'cost_center_id', '')::uuid, nullif(v_rec.template ->> 'account_id', '')::uuid,
        nullif(v_rec.template ->> 'payment_method', '')::public.payment_method, v_date, v_date, 'previsto', v_rec.id,
        nullif(v_rec.template ->> 'client_id', '')::uuid, nullif(v_rec.template ->> 'contract_id', '')::uuid
      ) on conflict do nothing;
      v_count := v_count + 1;
      end if;
      update public.financial_recurrences set generated_until = v_date where id = v_rec.id;
      v_date := case
        when v_rec.due_rule = 'dia_util' then private.nth_business_day((date_trunc('month', v_date) + v_step)::date, v_rec.business_day)
        else private.next_date(v_date, v_rec.frequency, v_anchor)
      end;
    end loop;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.generate_recurrences(date) to authenticated;
