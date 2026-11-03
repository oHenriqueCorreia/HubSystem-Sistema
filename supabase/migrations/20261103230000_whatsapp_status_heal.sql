-- O relógio também confere número parado em "aguardando QR Code": depois de uma reconexão, ele pode já estar conectado.
create or replace function private.inbox_jobs_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.hub_events where claimed_at is null)
      or exists (select 1 from public.automation_runs where status = 'pendente' and run_after <= now())
      or exists (select 1 from public.webhook_deliveries where status = 'pendente' and next_try_at <= now())
      or exists (select 1 from public.conversion_events where status = 'pendente')
      or exists (select 1 from public.campaigns where status = 'enviando' and (scheduled_at is null or scheduled_at <= now()))
      or exists (select 1 from public.inbox_settings where billing_enabled)
      or exists (select 1 from public.content_schedules where status in ('agendado', 'publicando') and scheduled_at <= now())
      or exists (select 1 from public.whatsapp_imports where status in ('importando', 'aguardando') and not_before <= now())
      or exists (select 1 from public.whatsapp_numbers where provider = 'waha' and status = 'aguardando_qr');
$$;
revoke execute on function private.inbox_jobs_pending() from public, anon, authenticated;
