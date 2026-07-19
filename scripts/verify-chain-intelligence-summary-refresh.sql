-- Post-refresh verification for chain_operational_summary (Development read-only)
-- Run in Supabase SQL Editor after:
--   npx tsx scripts/refresh-chain-intelligence-summaries.ts --execute

with band_counts as (
  select
    coalesce(confidence_band, '(null)') as confidence_band,
    count(*)::integer as row_count
  from public.chain_operational_summary
  group by 1
),
confidence_version_counts as (
  select
    coalesce(confidence_algorithm_version, '(null)') as confidence_algorithm_version,
    count(*)::integer as row_count
  from public.chain_operational_summary
  group by 1
),
eta_version_counts as (
  select
    coalesce(eta_algorithm_version, '(null)') as eta_algorithm_version,
    count(*)::integer as row_count
  from public.chain_operational_summary
  group by 1
),
summary as (
  select
    count(*)::integer as total_rows,
    count(*) filter (
      where confidence_algorithm_version = 'timing_v1'
    )::integer as timing_v1_rows,
    count(*) filter (
      where eta_algorithm_version = 'critical_path_v1'
    )::integer as critical_path_v1_rows,
    count(*) filter (
      where confidence_unavailable is true
    )::integer as unavailable_rows,
    count(*) filter (
      where confidence_algorithm_version is distinct from 'timing_v1'
        or eta_algorithm_version is distinct from 'critical_path_v1'
    )::integer as rows_not_on_expected_versions
  from public.chain_operational_summary
)
select
  s.total_rows,
  s.timing_v1_rows,
  s.critical_path_v1_rows,
  s.unavailable_rows,
  s.rows_not_on_expected_versions,
  case
    when s.total_rows = 0 then 'NO_SUMMARIES'
    when s.rows_not_on_expected_versions = 0 then 'REFRESH_COMPLETE'
    else 'REFRESH_INCOMPLETE'
  end as refresh_status
from summary s;

-- Band distribution
select
  coalesce(confidence_band, '(null)') as confidence_band,
  count(*)::integer as row_count
from public.chain_operational_summary
group by 1
order by 1;

-- Algorithm version distribution
select
  coalesce(confidence_algorithm_version, '(null)') as confidence_algorithm_version,
  coalesce(eta_algorithm_version, '(null)') as eta_algorithm_version,
  count(*)::integer as row_count
from public.chain_operational_summary
group by 1, 2
order by 1, 2;
