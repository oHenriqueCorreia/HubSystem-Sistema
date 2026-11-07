-- =============================================================================
-- Índices nas chaves estrangeiras usadas em filtros e ligações
-- =============================================================================
-- O Supabase apontou chaves estrangeiras sem índice. Com poucos dados isso não
-- pesa, mas cresce junto com o volume: as regras de acesso filtram por empresa
-- (organization_id), as telas ligam registros por negócio, cliente, contrato e
-- etapa, e apagar um registro pai varre as tabelas filhas sem índice.
--
-- Ficam de fora as colunas de auditoria (created_by, updated_by, deleted_by,
-- moved_by etc.): raramente filtradas, e os usuários são desativados, não apagados.
-- =============================================================================

create index if not exists ad_insights_ad_daily_organization_id_fk_idx on public.ad_insights_ad_daily (organization_id);

create index if not exists ad_insights_daily_organization_id_fk_idx on public.ad_insights_daily (organization_id);
create index if not exists ad_insights_daily_campaign_id_fk_idx on public.ad_insights_daily (campaign_id);

create index if not exists ad_campaigns_organization_id_fk_idx on public.ad_campaigns (organization_id);

create index if not exists ad_sets_organization_id_fk_idx on public.ad_sets (organization_id);

create index if not exists ads_organization_id_fk_idx on public.ads (organization_id);

create index if not exists activities_organization_id_fk_idx on public.activities (organization_id);
create index if not exists activities_client_id_fk_idx on public.activities (client_id);
create index if not exists activities_deal_id_fk_idx on public.activities (deal_id);
create index if not exists activities_contract_id_fk_idx on public.activities (contract_id);

create index if not exists attachments_organization_id_fk_idx on public.attachments (organization_id);

create index if not exists automation_runs_organization_id_fk_idx on public.automation_runs (organization_id);
create index if not exists automation_runs_event_id_fk_idx on public.automation_runs (event_id);

create index if not exists cadence_enrollments_organization_id_fk_idx on public.cadence_enrollments (organization_id);
create index if not exists cadence_enrollments_template_id_fk_idx on public.cadence_enrollments (template_id);
create index if not exists cadence_enrollments_owner_id_fk_idx on public.cadence_enrollments (owner_id);
create index if not exists cadence_enrollments_deal_id_fk_idx on public.cadence_enrollments (deal_id);

create index if not exists cadence_runs_enrollment_id_fk_idx on public.cadence_runs (enrollment_id);

create index if not exists cadence_steps_move_to_stage_id_fk_idx on public.cadence_steps (move_to_stage_id);
create index if not exists cadence_steps_add_tag_id_fk_idx on public.cadence_steps (add_tag_id);

create index if not exists cadence_templates_organization_id_fk_idx on public.cadence_templates (organization_id);

create index if not exists calendar_events_deal_id_fk_idx on public.calendar_events (deal_id);
create index if not exists calendar_events_contract_id_fk_idx on public.calendar_events (contract_id);

create index if not exists campaign_recipients_lead_id_fk_idx on public.campaign_recipients (lead_id);

create index if not exists campaigns_number_id_fk_idx on public.campaigns (number_id);

create index if not exists categorization_rules_owner_user_id_fk_idx on public.categorization_rules (owner_user_id);
create index if not exists categorization_rules_category_id_fk_idx on public.categorization_rules (category_id);

create index if not exists charge_messages_organization_id_fk_idx on public.charge_messages (organization_id);

create index if not exists client_members_organization_id_fk_idx on public.client_members (organization_id);

create index if not exists clients_owner_id_fk_idx on public.clients (owner_id);

create index if not exists content_assets_organization_id_fk_idx on public.content_assets (organization_id);

create index if not exists content_items_ad_campaign_id_fk_idx on public.content_items (ad_campaign_id);

create index if not exists content_review_links_organization_id_fk_idx on public.content_review_links (organization_id);

create index if not exists content_reviews_organization_id_fk_idx on public.content_reviews (organization_id);

create index if not exists content_schedules_account_id_fk_idx on public.content_schedules (account_id);

create index if not exists contracts_deal_id_fk_idx on public.contracts (deal_id);
create index if not exists contracts_service_id_fk_idx on public.contracts (service_id);

create index if not exists conversation_tags_tag_id_fk_idx on public.conversation_tags (tag_id);

create index if not exists conversion_events_lead_id_fk_idx on public.conversion_events (lead_id);
create index if not exists conversion_events_conversation_id_fk_idx on public.conversion_events (conversation_id);

create index if not exists cost_centers_organization_id_fk_idx on public.cost_centers (organization_id);

create index if not exists deal_stage_history_from_stage_id_fk_idx on public.deal_stage_history (from_stage_id);
create index if not exists deal_stage_history_to_stage_id_fk_idx on public.deal_stage_history (to_stage_id);

create index if not exists deals_organization_id_fk_idx on public.deals (organization_id);
create index if not exists deals_lost_reason_id_fk_idx on public.deals (lost_reason_id);

create index if not exists financial_accounts_owner_user_id_fk_idx on public.financial_accounts (owner_user_id);

create index if not exists financial_categories_owner_user_id_fk_idx on public.financial_categories (owner_user_id);
create index if not exists financial_categories_parent_id_fk_idx on public.financial_categories (parent_id);

create index if not exists financial_recurrences_organization_id_fk_idx on public.financial_recurrences (organization_id);
create index if not exists financial_recurrences_owner_user_id_fk_idx on public.financial_recurrences (owner_user_id);

create index if not exists financial_scope_transfers_organization_id_fk_idx on public.financial_scope_transfers (organization_id);

create index if not exists financial_transactions_owner_user_id_fk_idx on public.financial_transactions (owner_user_id);
create index if not exists financial_transactions_client_id_fk_idx on public.financial_transactions (client_id);
create index if not exists financial_transactions_cost_center_id_fk_idx on public.financial_transactions (cost_center_id);
create index if not exists financial_transactions_transfer_account_id_fk_idx on public.financial_transactions (transfer_account_id);

create index if not exists financial_txn_events_organization_id_fk_idx on public.financial_txn_events (organization_id);

create index if not exists google_calendar_connections_organization_id_fk_idx on public.google_calendar_connections (organization_id);

create index if not exists hub_events_organization_id_fk_idx on public.hub_events (organization_id);
create index if not exists hub_events_lead_id_fk_idx on public.hub_events (lead_id);
create index if not exists hub_events_deal_id_fk_idx on public.hub_events (deal_id);
create index if not exists hub_events_conversation_id_fk_idx on public.hub_events (conversation_id);

create index if not exists imports_organization_id_fk_idx on public.imports (organization_id);

create index if not exists inbound_hooks_organization_id_fk_idx on public.inbound_hooks (organization_id);
create index if not exists inbound_hooks_pipeline_id_fk_idx on public.inbound_hooks (pipeline_id);
create index if not exists inbound_hooks_owner_id_fk_idx on public.inbound_hooks (owner_id);

create index if not exists invitations_user_id_fk_idx on public.invitations (user_id);
create index if not exists invitations_role_id_fk_idx on public.invitations (role_id);

create index if not exists lost_reasons_organization_id_fk_idx on public.lost_reasons (organization_id);

create index if not exists message_templates_organization_id_fk_idx on public.message_templates (organization_id);
create index if not exists message_templates_stage_id_fk_idx on public.message_templates (stage_id);

create index if not exists messages_organization_id_fk_idx on public.messages (organization_id);

create index if not exists notifications_organization_id_fk_idx on public.notifications (organization_id);

create index if not exists payment_profiles_owner_user_id_fk_idx on public.payment_profiles (owner_user_id);

create index if not exists pipelines_organization_id_fk_idx on public.pipelines (organization_id);

create index if not exists stages_organization_id_fk_idx on public.stages (organization_id);

create index if not exists statement_imports_organization_id_fk_idx on public.statement_imports (organization_id);

create index if not exists statement_lines_import_id_fk_idx on public.statement_lines (import_id);
create index if not exists statement_lines_txn_id_fk_idx on public.statement_lines (txn_id);

create index if not exists task_deliveries_maker_id_fk_idx on public.task_deliveries (maker_id);

create index if not exists task_delivery_files_organization_id_fk_idx on public.task_delivery_files (organization_id);

create index if not exists task_delivery_links_organization_id_fk_idx on public.task_delivery_links (organization_id);

create index if not exists task_delivery_review_files_organization_id_fk_idx on public.task_delivery_review_files (organization_id);

create index if not exists task_delivery_reviews_organization_id_fk_idx on public.task_delivery_reviews (organization_id);

create index if not exists task_tags_tag_id_fk_idx on public.task_tags (tag_id);

create index if not exists tasks_deal_id_fk_idx on public.tasks (deal_id);
create index if not exists tasks_cadence_step_id_fk_idx on public.tasks (cadence_step_id);

create index if not exists team_clients_organization_id_fk_idx on public.team_clients (organization_id);

create index if not exists teams_leader_id_fk_idx on public.teams (leader_id);

create index if not exists utm_links_ad_client_id_fk_idx on public.utm_links (ad_client_id);

create index if not exists webhook_deliveries_organization_id_fk_idx on public.webhook_deliveries (organization_id);
create index if not exists webhook_deliveries_event_id_fk_idx on public.webhook_deliveries (event_id);

create index if not exists webhook_endpoints_organization_id_fk_idx on public.webhook_endpoints (organization_id);

create index if not exists whatsapp_imports_organization_id_fk_idx on public.whatsapp_imports (organization_id);

create index if not exists whatsapp_numbers_organization_id_fk_idx on public.whatsapp_numbers (organization_id);

create index if not exists encoding_fix_batches_organization_id_fk_idx on private.encoding_fix_batches (organization_id);
