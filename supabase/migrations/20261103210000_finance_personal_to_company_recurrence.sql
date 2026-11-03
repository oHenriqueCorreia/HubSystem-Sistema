-- Move uma receita pessoal para a empresa e passa a repeti-la mensalmente.
-- A chamada inteira é uma transação: se a recorrência falhar, o lançamento permanece no pessoal.
create or replace function public.transfer_personal_to_company_recurring(p_id uuid, p_category uuid, p_account uuid)
returns public.finance_scope
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_txn public.financial_transactions;
  v_rec_id uuid;
begin
  select * into v_txn from public.financial_transactions
   where id = p_id and scope = 'pessoal' and owner_user_id = auth.uid()
     and organization_id = private.org_id() and deleted_at is null
   for update;
  if v_txn.id is null then
    raise exception 'Receita pessoal não encontrada.' using errcode = 'P0002';
  end if;
  if v_txn.kind <> 'receita' or v_txn.recurrence_id is not null or v_txn.contract_id is not null
     or v_txn.installment_group_id is not null or v_txn.status = 'cancelado' then
    raise exception 'Escolha uma receita pessoal avulsa e ativa para criar a recorrência.' using errcode = 'P0001';
  end if;
  if not private.has_perm('finance.company.create') or not private.has_perm('finance.company.update') then
    raise exception 'Você não tem permissão para criar e editar receitas na empresa.' using errcode = '42501';
  end if;

  perform public.transfer_transaction_scope(p_id, p_category, p_account);

  insert into public.financial_recurrences
    (organization_id, scope, owner_user_id, frequency, start_date, generated_until, template)
  values
    (v_txn.organization_id, 'empresa', null, 'mensal', v_txn.due_date, v_txn.due_date,
     jsonb_build_object(
       'kind', 'receita', 'description', v_txn.description, 'amount_cents', v_txn.amount_cents,
       'category_id', coalesce(p_category::text, ''), 'account_id', coalesce(p_account::text, ''),
       'payment_method', coalesce(v_txn.payment_method::text, ''),
       'counterparty', coalesce(v_txn.counterparty, ''), 'notes', coalesce(v_txn.notes, '')
     ))
  returning id into v_rec_id;

  update public.financial_transactions set recurrence_id = v_rec_id where id = p_id;
  perform public.generate_recurrences(null);
  return 'empresa'::public.finance_scope;
end;
$$;
revoke execute on function public.transfer_personal_to_company_recurring(uuid, uuid, uuid) from public, anon;
grant execute on function public.transfer_personal_to_company_recurring(uuid, uuid, uuid) to authenticated;
