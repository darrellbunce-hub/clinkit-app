-- Stage 3.5 migration preflight — Development ONLY (read-only)
-- Migration: supabase/migrations/20260720100000_chain_intelligence_timing.sql
--
-- Run this ENTIRE file as ONE query in the Supabase SQL Editor.
-- Returns a SINGLE result row with all checks + recommended_action.
--
-- Interpretation (recommended_action column):
--   ROLLED_BACK           → safe to run the full fixed migration file
--   PARTIAL_APPLY         → tables/functions applied, view failed; re-run full fixed migration (idempotent)
--   ALREADY_COMPLETE      → do not re-run migration; proceed to backfill when ready
--   UNEXPECTED_STATE      → review column counts / flags manually before retrying

with checks as (
  select
    -- Table: stage clocks
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'properties'
        and column_name = 'stage_entered_at'
    ) as properties_stage_entered_at,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'chain_nodes'
        and column_name = 'stage_entered_at'
    ) as chain_nodes_stage_entered_at,

    -- Table: chain_operational_summary extensions
    coalesce(
      (
        select c.is_nullable = 'YES'
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'chain_operational_summary'
          and c.column_name = 'confidence_score'
      ),
      false
    ) as cos_confidence_score_nullable,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'chain_operational_summary'
        and column_name = 'confidence_band'
    ) as cos_confidence_band,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'chain_operational_summary'
        and column_name = 'confidence_unavailable'
    ) as cos_confidence_unavailable,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'chain_operational_summary'
        and column_name = 'data_coverage_status'
    ) as cos_data_coverage_status,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'chain_operational_summary'
        and column_name = 'coverage_label'
    ) as cos_coverage_label,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'chain_operational_summary'
        and column_name = 'estimated_completion_window'
    ) as cos_estimated_completion_window,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'chain_operational_summary'
        and column_name = 'next_recalculation_at'
    ) as cos_next_recalculation_at,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'chain_operational_summary'
        and column_name = 'confidence_algorithm_version'
    ) as cos_confidence_algorithm_version,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'chain_operational_summary'
        and column_name = 'eta_algorithm_version'
    ) as cos_eta_algorithm_version,

    exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'chain_operational_summary'
        and indexname = 'chain_operational_summary_next_recalc_idx'
    ) as cos_next_recalc_index,

    -- Functions introduced/updated by this migration
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'list_chain_intelligence_refresh_candidates'
    ) as fn_list_chain_intelligence_refresh_candidates,

    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'upsert_operational_summaries_service'
    ) as fn_upsert_operational_summaries_service,

    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'upsert_operational_summaries'
        and pg_get_functiondef(p.oid) ilike '%confidence_band%'
    ) as fn_upsert_operational_summaries_updated,

    -- View: column inventory
    (
      select count(*)::integer
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_branch_property_summaries'
    ) as view_column_count,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_branch_property_summaries'
        and column_name = 'claim_status'
    ) as view_claim_status,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_branch_property_summaries'
        and column_name = 'invitation_lifecycle_status'
    ) as view_invitation_lifecycle_status,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_branch_property_summaries'
        and column_name = 'confidence_band'
    ) as view_confidence_band,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_branch_property_summaries'
        and column_name = 'confidence_unavailable'
    ) as view_confidence_unavailable,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_branch_property_summaries'
        and column_name = 'estimated_completion_window'
    ) as view_estimated_completion_window,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_branch_property_summaries'
        and column_name = 'data_coverage_status'
    ) as view_data_coverage_status,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_branch_property_summaries'
        and column_name = 'coverage_label'
    ) as view_coverage_label,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_branch_property_summaries'
        and column_name = 'next_recalculation_at'
    ) as view_next_recalculation_at,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_branch_property_summaries'
        and column_name = 'confidence_algorithm_version'
    ) as view_confidence_algorithm_version,

    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'agent_branch_property_summaries'
        and column_name = 'eta_algorithm_version'
    ) as view_eta_algorithm_version
)
select
  c.*,

  (
    c.properties_stage_entered_at
    and c.chain_nodes_stage_entered_at
    and c.cos_confidence_score_nullable
    and c.cos_confidence_band
    and c.cos_confidence_unavailable
    and c.cos_data_coverage_status
    and c.cos_coverage_label
    and c.cos_estimated_completion_window
    and c.cos_next_recalculation_at
    and c.cos_confidence_algorithm_version
    and c.cos_eta_algorithm_version
    and c.cos_next_recalc_index
    and c.fn_list_chain_intelligence_refresh_candidates
    and c.fn_upsert_operational_summaries_service
    and c.fn_upsert_operational_summaries_updated
  ) as table_and_function_layer_applied,

  (
    c.view_confidence_band
    and c.view_confidence_unavailable
    and c.view_estimated_completion_window
    and c.view_data_coverage_status
    and c.view_coverage_label
    and c.view_next_recalculation_at
    and c.view_confidence_algorithm_version
    and c.view_eta_algorithm_version
    and c.view_column_count = 38
  ) as view_layer_applied,

  -- Expected counts: 30 columns pre-migration, 38 after successful apply
  30 as expected_view_columns_before_migration,
  38 as expected_view_columns_after_migration,

  case
    when c.view_column_count = 38
      and c.view_confidence_band
      and c.view_eta_algorithm_version
      and c.properties_stage_entered_at
      and c.chain_nodes_stage_entered_at
      and c.cos_confidence_band
      and c.fn_list_chain_intelligence_refresh_candidates
      and c.fn_upsert_operational_summaries_service
      then 'ALREADY_COMPLETE'

    when c.properties_stage_entered_at
      and c.chain_nodes_stage_entered_at
      and c.cos_confidence_band
      and c.fn_list_chain_intelligence_refresh_candidates
      and not (
        c.view_confidence_band
        and c.view_column_count = 38
      )
      then 'PARTIAL_APPLY'

    when not c.properties_stage_entered_at
      and not c.chain_nodes_stage_entered_at
      and not c.cos_confidence_band
      and not c.fn_list_chain_intelligence_refresh_candidates
      and c.view_column_count <= 30
      and c.view_claim_status
      and c.view_invitation_lifecycle_status
      then 'ROLLED_BACK'

    else 'UNEXPECTED_STATE'
  end as recommended_action,

  case
    when c.view_column_count = 38
      and c.view_confidence_band
      then 'Migration appears complete. Do not re-run. Proceed to backfill when ready.'
    when c.properties_stage_entered_at
      and not c.view_confidence_band
      then 'Partial apply likely (view failed with 42P16). Re-run the FULL fixed migration file.'
    when not c.properties_stage_entered_at
      and not c.cos_confidence_band
      then 'Failed run likely rolled back. Re-run the FULL fixed migration file.'
    else 'Manual review required before retrying migration.'
  end as recommended_action_detail

from checks c;

-- Optional second query (run separately if you need column names):
-- select ordinal_position, column_name
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'agent_branch_property_summaries'
-- order by ordinal_position;
