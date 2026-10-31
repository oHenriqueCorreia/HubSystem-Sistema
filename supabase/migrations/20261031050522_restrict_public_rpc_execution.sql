-- Funções SECURITY DEFINER devem ser executadas apenas por usuários autenticados.
-- Os GRANTs explícitos a authenticated das migrações anteriores permanecem.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', fn.signature);
  end loop;
end;
$$;

alter default privileges in schema public revoke execute on functions from public, anon;
