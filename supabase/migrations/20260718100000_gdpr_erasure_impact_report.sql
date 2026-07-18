-- Phase 2 GDPR: read-only Right to Erasure impact report.
-- Discovery only — no INSERT/UPDATE/DELETE, no lifecycle/de-link/auth mutations.

-- ---------------------------------------------------------------------------
-- generate_erasure_impact_report(p_user_id uuid) -> jsonb
-- Service role only. SECURITY DEFINER for auth.users email lookup.
-- ---------------------------------------------------------------------------

create or replace function public.generate_erasure_impact_report(
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_exists boolean := false;
  v_email text := null;
  v_email_confirmed boolean := false;
  v_account_type text := null;
  v_has_contact_name boolean := false;
  v_report jsonb := '{}'::jsonb;
  v_direct jsonb := '{}'::jsonb;
  v_email_corr jsonb := '{}'::jsonb;
  v_property_relationships jsonb := '[]'::jsonb;
  v_shared jsonb := '{}'::jsonb;
  v_ea jsonb := '{}'::jsonb;
  v_invitations jsonb := '{}'::jsonb;
  v_communications jsonb := '{}'::jsonb;
  v_audit jsonb := '{}'::jsonb;
  v_analytics jsonb := '{}'::jsonb;
  v_jsonb_risk jsonb := '{}'::jsonb;
  v_external jsonb := '{}'::jsonb;
  v_proposed_actions jsonb := '[]'::jsonb;
  v_risk_flags text[] := array[]::text[];
  v_blocking_reasons text[] := array[]::text[];
  v_requires_manual_review boolean := true;
  v_sole_participant_count integer := 0;
  v_sole_property_ids bigint[] := array[]::bigint[];
  v_metadata_user_ref_count bigint := 0;
  v_analytics_snapshot_count bigint := 0;
  v_has_active_shared boolean := false;
  v_last_ea_branch_member boolean := false;
  v_last_ea_company_member boolean := false;
begin
  if p_user_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'user_id_required'
    );
  end if;

  select
    true,
    lower(trim(u.email)),
    u.email_confirmed_at is not null
  into v_user_exists, v_email, v_email_confirmed
  from auth.users u
  where u.id = p_user_id;

  if not coalesce(v_user_exists, false) then
    return jsonb_build_object(
      'ok', false,
      'error', 'user_not_found',
      'subject_user_id', p_user_id
    );
  end if;

  select p.account_type, (p.contact_name is not null)
  into v_account_type, v_has_contact_name
  from public.profiles p
  where p.id = p_user_id;

  -- Direct user-linked counts (confirmed schema columns only)
  select jsonb_build_object(
    'property_operational_identities_active',
      (select count(*)::int from public.property_operational_identities poi
       where poi.homeowner_user_id = p_user_id and poi.status = 'active'),
    'property_operational_identities_historic',
      (select count(*)::int from public.property_operational_identities poi
       where poi.homeowner_user_id = p_user_id and poi.status <> 'active'),
    'property_members',
      (select count(*)::int from public.property_members pm where pm.user_id = p_user_id),
    'property_counterparty_participants_active',
      (select count(*)::int from public.property_counterparty_participants pcp
       where pcp.user_id = p_user_id and pcp.status = 'active'),
    'property_counterparty_participants_historic',
      (select count(*)::int from public.property_counterparty_participants pcp
       where pcp.user_id = p_user_id and pcp.status <> 'active'),
    'property_delegates_as_delegate_active',
      (select count(*)::int from public.property_delegates pd
       where pd.delegate_user_id = p_user_id and pd.status = 'active'),
    'property_delegates_as_delegate_historic',
      (select count(*)::int from public.property_delegates pd
       where pd.delegate_user_id = p_user_id and pd.status <> 'active'),
    'property_delegates_as_inviter',
      (select count(*)::int from public.property_delegates pd
       where pd.invited_by_user_id = p_user_id),
    'property_ea_assignments_assigned_by',
      (select count(*)::int from public.property_ea_assignments pea
       where pea.assigned_by_user_id = p_user_id),
    'property_ea_assignments_active_on_member_branch',
      (select count(*)::int
       from public.property_ea_assignments pea
       inner join public.ea_branch_members bm on bm.branch_id = pea.branch_id
       where bm.user_id = p_user_id and pea.status = 'active'),
    'properties_created',
      (select count(*)::int from public.properties p where p.created_by_user_id = p_user_id),
    'chains_created',
      (select count(*)::int from public.chains c where c.created_by_user_id = p_user_id),
    'chains_completion_attribution',
      (select count(*)::int from public.chains c
       where c.completion_date_recorded_by_user_id = p_user_id
          or c.completion_date_updated_by_user_id = p_user_id
          or c.completion_confirmed_by_user_id = p_user_id),
    'property_claim_metadata_as_originator',
      (select count(*)::int from public.property_claim_metadata pcm
       where pcm.originated_by_user_id = p_user_id),
    'property_claim_metadata_as_claimant',
      (select count(*)::int from public.property_claim_metadata pcm
       where pcm.claimed_by_user_id = p_user_id),
    'property_claim_invitations_created',
      (select count(*)::int from public.property_claim_invitations pci
       where pci.created_by_user_id = p_user_id),
    'property_claim_invitations_rejection_acknowledged',
      (select count(*)::int from public.property_claim_invitations pci
       where pci.invitation_rejection_acknowledged_by_user_id = p_user_id),
    'property_delink_events_as_actor',
      (select count(*)::int from public.property_delink_events pde
       where pde.actor_user_id = p_user_id),
    'property_lifecycle_still_active_confirmations',
      (select count(*)::int from public.property_lifecycle_still_active_confirmations c
       where c.user_id = p_user_id),
    'chain_completion_events_as_actor',
      (select count(*)::int from public.chain_completion_events cce
       where cce.actor_user_id = p_user_id),
    'email_events_as_sender',
      (select count(*)::int from public.email_events ee where ee.sent_by = p_user_id),
    'ea_branch_memberships',
      (select count(*)::int from public.ea_branch_members ebm where ebm.user_id = p_user_id),
    'ea_companies_created',
      (select count(*)::int from public.ea_companies ec where ec.created_by_user_id = p_user_id),
    'ea_branch_invitations_created',
      (select count(*)::int from public.ea_branch_invitations ebi
       where ebi.created_by_user_id = p_user_id),
    'ea_branch_invitations_accepted',
      (select count(*)::int from public.ea_branch_invitations ebi
       where ebi.accepted_by_user_id = p_user_id)
  )
  into v_direct;

  -- Email-correlated counts (case-insensitive; no raw email in output)
  if v_email is not null and v_email <> '' then
    select jsonb_build_object(
      'claim_metadata_invite_email',
        (select count(*)::int from public.property_claim_metadata pcm
         where lower(trim(pcm.invite_email)) = v_email),
      'claim_metadata_as_claimed_email_match',
        (select count(*)::int
         from public.property_claim_metadata pcm
         inner join auth.users cu on cu.id = pcm.claimed_by_user_id
         where lower(trim(cu.email)) = v_email
           and pcm.claimed_by_user_id is distinct from p_user_id),
      'ea_branch_invitations_invite_email',
        (select count(*)::int from public.ea_branch_invitations ebi
         where lower(trim(ebi.invite_email)) = v_email),
      'email_events_recipient_email',
        (select count(*)::int from public.email_events ee
         where lower(trim(ee.recipient_email)) = v_email)
    )
    into v_email_corr;
  else
    v_email_corr := jsonb_build_object(
      'claim_metadata_invite_email', 0,
      'ea_branch_invitations_invite_email', 0,
      'email_events_recipient_email', 0,
      'note', 'auth_email_unavailable'
    );
  end if;

  -- Person-property relationship analysis
  with linked_properties as (
    select distinct property_id
    from (
      select poi.property_id from public.property_operational_identities poi
      where poi.homeowner_user_id = p_user_id
      union
      select pm.property_id from public.property_members pm where pm.user_id = p_user_id
      union
      select pcp.property_id from public.property_counterparty_participants pcp
      where pcp.user_id = p_user_id
      union
      select pd.property_id from public.property_delegates pd
      where pd.delegate_user_id = p_user_id or pd.invited_by_user_id = p_user_id
      union
      select pea.property_id from public.property_ea_assignments pea
      where pea.assigned_by_user_id = p_user_id
      union
      select pea.property_id
      from public.property_ea_assignments pea
      inner join public.ea_branch_members bm on bm.branch_id = pea.branch_id
      where bm.user_id = p_user_id
      union
      select p.id from public.properties p where p.created_by_user_id = p_user_id
      union
      select pcm.property_id from public.property_claim_metadata pcm
      where pcm.originated_by_user_id = p_user_id
         or pcm.claimed_by_user_id = p_user_id
    ) lp
  ),
  relationship_rows as (
    select
      lp.property_id,
      coalesce(pls.operational_state, 'active') as operational_state,
      p.chain_id,
      coalesce(p.is_searching, false) as is_searching,
      p.address,
      coalesce(p.buyer_connected, false) as buyer_connected,
      coalesce(p.seller_connected, false) as seller_connected,
      (
        select coalesce(jsonb_agg(sub.role_entry), '[]'::jsonb)
        from (
          select 'operational_homeowner'::text as role_entry
          from public.property_operational_identities poi
          where poi.property_id = lp.property_id
            and poi.homeowner_user_id = p_user_id
          union all
          select 'legacy_member'
          from public.property_members pm
          where pm.property_id = lp.property_id and pm.user_id = p_user_id
          union all
          select 'counterparty_' || pcp.counterparty_role
          from public.property_counterparty_participants pcp
          where pcp.property_id = lp.property_id and pcp.user_id = p_user_id
          union all
          select case when pd.delegate_user_id = p_user_id then 'delegate' else 'delegate_inviter' end
          from public.property_delegates pd
          where pd.property_id = lp.property_id
            and (pd.delegate_user_id = p_user_id or pd.invited_by_user_id = p_user_id)
          union all
          select 'estate_agent_assignment'
          from public.property_ea_assignments pea
          inner join public.ea_branch_members bm on bm.branch_id = pea.branch_id
          where pea.property_id = lp.property_id and bm.user_id = p_user_id
          union all
          select 'created_by'
          from public.properties pr
          where pr.id = lp.property_id and pr.created_by_user_id = p_user_id
          union all
          select 'claim_originator'
          from public.property_claim_metadata pcm
          where pcm.property_id = lp.property_id and pcm.originated_by_user_id = p_user_id
          union all
          select 'claim_claimant'
          from public.property_claim_metadata pcm
          where pcm.property_id = lp.property_id and pcm.claimed_by_user_id = p_user_id
        ) sub
      ) as roles,
      (
        select count(*)::int
        from public.property_operational_identities poi2
        where poi2.property_id = lp.property_id
          and poi2.status = 'active'
          and poi2.homeowner_user_id <> p_user_id
      ) as other_active_homeowners,
      (
        select count(*)::int
        from public.property_counterparty_participants pcp2
        where pcp2.property_id = lp.property_id
          and pcp2.status = 'active'
          and pcp2.user_id <> p_user_id
      ) as other_active_counterparties,
      (
        select count(*)::int
        from public.property_delegates pd2
        where pd2.property_id = lp.property_id
          and pd2.status = 'active'
          and pd2.delegate_user_id <> p_user_id
      ) as other_active_delegates,
      (
        select count(*)::int
        from public.property_ea_assignments pea2
        where pea2.property_id = lp.property_id and pea2.status = 'active'
      ) as active_ea_assignments,
      (
        select count(distinct pr2.id)::int
        from public.properties pr2
        where pr2.chain_id = p.chain_id
          and pr2.chain_id is not null
          and pr2.id <> lp.property_id
      ) as other_properties_on_chain,
      (
        select count(*)::int
        from public.property_members pm2
        where pm2.property_id = lp.property_id and pm2.user_id <> p_user_id
      ) as other_legacy_members
    from linked_properties lp
    inner join public.properties p on p.id = lp.property_id
    left join public.property_lifecycle_states pls on pls.property_id = lp.property_id
  ),
  classified as (
    select
      rr.*,
      (
        rr.other_active_homeowners
        + rr.other_active_counterparties
        + rr.other_active_delegates
        + case when rr.active_ea_assignments > 0 then 1 else 0 end
        + case when rr.other_properties_on_chain > 0 and rr.chain_id is not null then 1 else 0 end
      ) as shared_dependency_score,
      case
        when coalesce(pls_check.operational_state, rr.operational_state) = 'anonymised'
          or rr.address = '[Released property]' then 'already_anonymised'
        when coalesce(rr.is_searching, false) = true
          or nullif(trim(rr.address), '') is null then 'no_address'
        when (
          rr.other_active_homeowners
          + rr.other_active_counterparties
          + rr.other_active_delegates
          + rr.other_legacy_members
        ) > 0
          or rr.active_ea_assignments > 0
          or (rr.other_properties_on_chain > 0 and rr.chain_id is not null)
          or rr.buyer_connected
          or rr.seller_connected then 'retain_shared_operationally_review_required'
        when coalesce(pls_check.operational_state, rr.operational_state) in ('released', 'archived', 'dormant')
          then 'eligible_for_redaction_review'
        when coalesce(pls_check.operational_state, rr.operational_state) = 'active'
          then 'eligible_for_redaction_review'
        else 'legal_review_required'
      end as address_treatment,
      (
        rr.other_active_homeowners
        + rr.other_active_counterparties
        + rr.other_active_delegates
        + rr.other_legacy_members
        + case when rr.active_ea_assignments > 0 then 1 else 0 end
      ) = 0
      and not coalesce(rr.buyer_connected, false)
      and not coalesce(rr.seller_connected, false)
      and (
        rr.other_properties_on_chain = 0
        or rr.chain_id is null
      ) as is_sole_participant_candidate
    from relationship_rows rr
    left join public.property_lifecycle_states pls_check
      on pls_check.property_id = rr.property_id
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'property_id', c.property_id,
        'chain_id', c.chain_id,
        'roles', c.roles,
        'operational_state', c.operational_state,
        'is_searching', c.is_searching,
        'buyer_connected', c.buyer_connected,
        'seller_connected', c.seller_connected,
        'other_active_homeowners', c.other_active_homeowners,
        'other_active_counterparties', c.other_active_counterparties,
        'other_active_delegates', c.other_active_delegates,
        'active_ea_assignments', c.active_ea_assignments,
        'other_properties_on_chain', c.other_properties_on_chain,
        'other_legacy_members', c.other_legacy_members,
        'shared_dependency_score', c.shared_dependency_score,
        'address_treatment', c.address_treatment,
        'is_sole_participant_candidate', c.is_sole_participant_candidate,
        'affects_other_participants', c.shared_dependency_score > 0
      )
      order by c.property_id
    ), '[]'::jsonb),
    count(*) filter (where c.is_sole_participant_candidate)::int,
    coalesce(array_agg(c.property_id order by c.property_id)
      filter (where c.is_sole_participant_candidate), array[]::bigint[]),
    bool_or(c.shared_dependency_score > 0)
  into v_property_relationships, v_sole_participant_count, v_sole_property_ids, v_has_active_shared
  from classified c;

  v_shared := jsonb_build_object(
    'has_active_shared_transaction', coalesce(v_has_active_shared, false),
    'sole_participant_property_count', coalesce(v_sole_participant_count, 0),
    'sole_participant_property_ids', coalesce(to_jsonb(v_sole_property_ids), '[]'::jsonb),
    'requires_partial_erasure', coalesce(v_has_active_shared, false)
  );

  if coalesce(v_has_active_shared, false) then
    v_risk_flags := array_append(v_risk_flags, 'ACTIVE_SHARED_TRANSACTION');
    v_risk_flags := array_append(v_risk_flags, 'OTHER_PARTICIPANTS_PRESENT');
    v_blocking_reasons := array_append(v_blocking_reasons, 'shared_active_transaction');
  end if;

  if coalesce(v_sole_participant_count, 0) > 0 then
    v_risk_flags := array_append(v_risk_flags, 'SOLE_PARTICIPANT_PROPERTY');
  end if;

  if (v_direct ->> 'property_ea_assignments_active_on_member_branch')::int > 0
     or (v_direct ->> 'ea_branch_memberships')::int > 0 then
    v_risk_flags := array_append(v_risk_flags, 'EA_BRANCH_DEPENDENCY');
    v_blocking_reasons := array_append(v_blocking_reasons, 'ea_branch_dependency');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_property_relationships) elem
    where (elem ->> 'other_properties_on_chain')::int > 0
  ) then
    v_risk_flags := array_append(v_risk_flags, 'CONNECTED_CHAIN_DEPENDENCY');
    v_blocking_reasons := array_append(v_blocking_reasons, 'connected_chain_dependency');
  end if;

  if (v_direct ->> 'property_members')::int > 0
     and (v_direct ->> 'property_operational_identities_active')::int = 0 then
    v_risk_flags := array_append(v_risk_flags, 'LEGACY_OWNERSHIP_AMBIGUITY');
    v_blocking_reasons := array_append(v_blocking_reasons, 'legacy_ownership_ambiguity');
  end if;

  -- EA organisation analysis
  select exists (
    select 1
    from public.ea_branch_members ebm
    where ebm.user_id = p_user_id
      and not exists (
        select 1
        from public.ea_branch_members ebm2
        where ebm2.branch_id = ebm.branch_id
          and ebm2.user_id <> p_user_id
      )
  )
  into v_last_ea_branch_member;

  select exists (
    select 1
    from public.ea_companies ec
    where ec.created_by_user_id = p_user_id
      and not exists (
        select 1
        from public.ea_branch_members ebm
        inner join public.ea_branches eb on eb.id = ebm.branch_id
        where eb.company_id = ec.id
          and ebm.user_id <> p_user_id
      )
  )
  into v_last_ea_company_member;

  v_ea := jsonb_build_object(
    'branch_memberships_count', (v_direct ->> 'ea_branch_memberships')::int,
    'companies_created_count', (v_direct ->> 'ea_companies_created')::int,
    'assignments_on_member_branch', (v_direct ->> 'property_ea_assignments_active_on_member_branch')::int,
    'is_last_member_of_branch', coalesce(v_last_ea_branch_member, false),
    'is_last_member_of_company', coalesce(v_last_ea_company_member, false),
    'requires_org_admin_review',
      coalesce(v_last_ea_branch_member, false) or coalesce(v_last_ea_company_member, false),
    'personal_fields_on_org_records',
      jsonb_build_object(
        'profiles_contact_name', coalesce(v_has_contact_name, false),
        'ea_companies_created_by_user_id', (v_direct ->> 'ea_companies_created')::int > 0
      )
  );

  if coalesce(v_last_ea_branch_member, false) or coalesce(v_last_ea_company_member, false) then
    v_risk_flags := array_append(v_risk_flags, 'LAST_EA_MEMBER_REVIEW_REQUIRED');
    v_blocking_reasons := array_append(v_blocking_reasons, 'last_ea_member_review_required');
  end if;

  -- Invitations
  v_invitations := jsonb_build_object(
    'pending_property_claim_invitations_created_by_user',
      (select count(*)::int
       from public.property_claim_invitations pci
       where pci.created_by_user_id = p_user_id
         and pci.invitation_revoked_at is null
         and pci.invitation_used_at is null),
    'pending_ea_branch_invitations_created_by_user',
      (select count(*)::int
       from public.ea_branch_invitations ebi
       where ebi.created_by_user_id = p_user_id
         and ebi.invitation_revoked_at is null
         and ebi.invitation_accepted_at is null),
    'pending_ea_branch_invitations_to_user_email',
      case
        when v_email is null then 0
        else (
          select count(*)::int
          from public.ea_branch_invitations ebi
          where lower(trim(ebi.invite_email)) = v_email
            and ebi.invitation_revoked_at is null
            and ebi.invitation_accepted_at is null
        )
      end
  );

  -- Communications
  select jsonb_build_object(
    'email_events_as_recipient', coalesce((v_email_corr ->> 'email_events_recipient_email')::int, 0),
    'email_events_as_sender', (v_direct ->> 'email_events_as_sender')::int,
    'templates_as_recipient',
      coalesce((
        select jsonb_agg(distinct ee.template order by ee.template)
        from public.email_events ee
        where v_email is not null
          and lower(trim(ee.recipient_email)) = v_email
      ), '[]'::jsonb),
    'templates_as_sender',
      coalesce((
        select jsonb_agg(distinct ee.template order by ee.template)
        from public.email_events ee
        where ee.sent_by = p_user_id
      ), '[]'::jsonb)
  )
  into v_communications;

  if coalesce((v_email_corr ->> 'email_events_recipient_email')::int, 0) > 0
     or (v_direct ->> 'email_events_as_sender')::int > 0 then
    v_risk_flags := array_append(v_risk_flags, 'COMMUNICATIONS_REVIEW_REQUIRED');
  end if;

  -- Audit / history
  select count(*) into v_metadata_user_ref_count
  from (
    select 1
    from public.property_delink_events pde
    where pde.metadata::text like '%' || p_user_id::text || '%'
      and pde.actor_user_id is distinct from p_user_id
    union all
    select 1
    from public.property_lifecycle_events ple
    where ple.metadata::text like '%' || p_user_id::text || '%'
    union all
    select 1
    from public.property_lifecycle_states pls
    where pls.metadata::text like '%' || p_user_id::text || '%'
    union all
    select 1
    from public.chain_completion_events cce
    where cce.payload is not null
      and cce.payload::text like '%' || p_user_id::text || '%'
      and cce.actor_user_id is distinct from p_user_id
  ) meta_scan;

  v_audit := jsonb_build_object(
    'property_delink_events_as_actor', (v_direct ->> 'property_delink_events_as_actor')::int,
    'chain_completion_events_as_actor', (v_direct ->> 'chain_completion_events_as_actor')::int,
    'property_lifecycle_still_active_confirmations',
      (v_direct ->> 'property_lifecycle_still_active_confirmations')::int,
    'activities_on_linked_properties',
      (select count(*)::int
       from public.activities a
       where a.property_id in (
         select (elem ->> 'property_id')::bigint
         from jsonb_array_elements(v_property_relationships) elem
       )),
    'metadata_user_reference_hits', coalesce(v_metadata_user_ref_count, 0),
    'jsonb_review_status',
      case
        when coalesce(v_metadata_user_ref_count, 0) > 0 then 'manual_review_required'
        else 'no_additional_uuid_hits'
      end,
    'potential_treatments', jsonb_build_array(
      'NULL_USER_REFERENCE_REVIEW',
      'PSEUDONYMISE_ACTOR_REVIEW',
      'RETAIN_STRUCTURED_EVENT_REVIEW',
      'FREE_TEXT_PII_REVIEW_REQUIRED'
    )
  );

  if coalesce(v_metadata_user_ref_count, 0) > 0 then
    v_risk_flags := array_append(v_risk_flags, 'UNSTRUCTURED_METADATA_REVIEW_REQUIRED');
    v_blocking_reasons := array_append(v_blocking_reasons, 'unstructured_metadata_review_required');
  end if;

  if (v_audit ->> 'activities_on_linked_properties')::int > 0 then
    v_risk_flags := array_append(v_risk_flags, 'FREE_TEXT_PII_REVIEW_REQUIRED');
    v_blocking_reasons := array_append(v_blocking_reasons, 'activities_free_text_review');
  end if;

  -- Analytics re-identification
  select count(*)::int
  into v_analytics_snapshot_count
  from public.property_analytics_snapshots pas
  where pas.source_property_id in (
    select (elem ->> 'property_id')::bigint
    from jsonb_array_elements(v_property_relationships) elem
  );

  v_analytics := jsonb_build_object(
    'snapshots_linked_via_source_property_id', coalesce(v_analytics_snapshot_count, 0),
    'anonymity_classification', 'pseudonymous',
    're_identification_risk',
      case
        when coalesce(v_analytics_snapshot_count, 0) = 0 then 'none_detected'
        when coalesce(v_analytics_snapshot_count, 0) <= 2 then 'medium'
        else 'high'
      end,
    'retain_after_erasure_recommended', false,
    'risk_factors',
      case
        when coalesce(v_analytics_snapshot_count, 0) > 0 then
          jsonb_build_array(
            'source_property_id_present',
            'postcode_district_may_exist_in_payload',
            'timing_metrics_in_payload'
          )
        else '[]'::jsonb
      end,
    'snapshots_with_postcode_district',
      (select count(*)::int
       from public.property_analytics_snapshots pas
       where pas.source_property_id in (
         select (elem ->> 'property_id')::bigint
         from jsonb_array_elements(v_property_relationships) elem
       )
       and pas.payload ? 'postcodeDistrict'
       and nullif(pas.payload ->> 'postcodeDistrict', '') is not null)
  );

  if coalesce(v_analytics_snapshot_count, 0) > 0 then
    v_risk_flags := array_append(v_risk_flags, 'ANALYTICS_REIDENTIFICATION_REVIEW_REQUIRED');
    v_blocking_reasons := array_append(v_blocking_reasons, 'analytics_reidentification_review');
  end if;

  v_jsonb_risk := jsonb_build_object(
    'fields_scanned', jsonb_build_array(
      'property_delink_events.metadata',
      'property_lifecycle_events.metadata',
      'property_lifecycle_states.metadata',
      'chain_completion_events.payload',
      'email_events.provider_events'
    ),
    'email_events_provider_events_note',
      'provider_events not text-scanned — manual_review_if_present',
    'metadata_user_reference_hits', coalesce(v_metadata_user_ref_count, 0)
  );

  if (v_email_corr ->> 'email_events_recipient_email')::int > 0
     or (v_email_corr ->> 'claim_metadata_invite_email')::int > 0 then
    v_risk_flags := array_append(v_risk_flags, 'UNSTRUCTURED_METADATA_REVIEW_REQUIRED');
  end if;

  -- External processor flags (deterministic; no external calls)
  v_external := jsonb_build_object(
    'SUPABASE_AUTH_DELETION_REQUIRED', true,
    'RESEND_ERASURE_REVIEW_REQUIRED',
      coalesce((v_email_corr ->> 'email_events_recipient_email')::int, 0) > 0
      or coalesce((v_invitations ->> 'pending_ea_branch_invitations_to_user_email')::int, 0) > 0,
    'VERCEL_LOG_RETENTION_REVIEW', true,
    'UPSTASH_CACHE_PURGE_REVIEW', false,
    'STRIPE_ERASURE_REVIEW', (v_direct ->> 'ea_companies_created')::int > 0
  );

  -- Proposed actions (categories only — not executed)
  v_proposed_actions := jsonb_build_array(
    jsonb_build_object(
      'category', 'REMOVE_PERSON_PROPERTY_LINK',
      'target_type', 'operational_identity_and_participation',
      'count',
        (v_direct ->> 'property_operational_identities_active')::int
        + (v_direct ->> 'property_counterparty_participants_active')::int
        + (v_direct ->> 'property_delegates_as_delegate_active')::int,
      'requires_manual_review', coalesce(v_has_active_shared, false),
      'reason_code', case when v_has_active_shared then 'shared_active_transaction' else 'standard_participation_removal' end
    ),
    jsonb_build_object(
      'category', 'REDACT_EMAIL_REFERENCE',
      'target_type', 'email_events_and_invitations',
      'count',
        coalesce((v_email_corr ->> 'email_events_recipient_email')::int, 0)
        + coalesce((v_email_corr ->> 'claim_metadata_invite_email')::int, 0)
        + coalesce((v_email_corr ->> 'ea_branch_invitations_invite_email')::int, 0),
      'requires_manual_review', true,
      'reason_code', 'email_correlation_cleanup'
    ),
    jsonb_build_object(
      'category', 'REVIEW_SHARED_PROPERTY_ADDRESS',
      'target_type', 'properties',
      'count',
        (select count(*)::int
         from jsonb_array_elements(v_property_relationships) elem
         where elem ->> 'address_treatment' = 'retain_shared_operationally_review_required'),
      'requires_manual_review', true,
      'reason_code', 'contextual_address_assessment'
    ),
    jsonb_build_object(
      'category', 'NULL_HISTORICAL_ACTOR_REFERENCE',
      'target_type', 'audit_tables',
      'count',
        (v_direct ->> 'property_delink_events_as_actor')::int
        + (v_direct ->> 'chain_completion_events_as_actor')::int,
      'requires_manual_review', true,
      'reason_code', 'structured_audit_pseudonymisation'
    ),
    jsonb_build_object(
      'category', 'REVIEW_ANALYTICS_REIDENTIFICATION',
      'target_type', 'property_analytics_snapshots',
      'count', coalesce(v_analytics_snapshot_count, 0),
      'requires_manual_review', coalesce(v_analytics_snapshot_count, 0) > 0,
      'reason_code', 'pseudonymous_not_anonymous'
    ),
    jsonb_build_object(
      'category', 'DELETE_AUTH_IDENTITY_LAST',
      'target_type', 'auth.users',
      'count', 1,
      'requires_manual_review', true,
      'reason_code', 'final_step_after_db_erasure'
    ),
    jsonb_build_object(
      'category', 'PROPAGATE_PROCESSOR_ERASURE',
      'target_type', 'external_processors',
      'count', 1,
      'requires_manual_review', true,
      'reason_code', 'resend_vercel_upstash_review'
    )
  );

  if exists (
    select 1
    from jsonb_array_elements(v_property_relationships) elem
    where elem ->> 'address_treatment' = 'legal_review_required'
  ) then
    v_risk_flags := array_append(v_risk_flags, 'ADDRESS_RETENTION_REVIEW_REQUIRED');
    v_blocking_reasons := array_append(v_blocking_reasons, 'address_retention_review');
  end if;

  v_requires_manual_review := true;

  v_report := jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'report_version', 1,
    'subject_user_id', p_user_id,
    'subject', jsonb_build_object(
      'user_exists', true,
      'has_auth_identity', true,
      'has_profile', v_account_type is not null,
      'account_type', v_account_type,
      'email_verified', coalesce(v_email_confirmed, false)
    ),
    'direct_personal_data', v_direct,
    'email_correlated_records', v_email_corr,
    'property_relationships', v_property_relationships,
    'shared_transaction_dependencies', v_shared,
    'estate_agent_relationships', v_ea,
    'invitations_and_claims', v_invitations,
    'communications', v_communications,
    'audit_and_history', v_audit,
    'analytics', v_analytics,
    'jsonb_unknown_pii', v_jsonb_risk,
    'external_processor_actions', v_external,
    'risk_flags', to_jsonb(v_risk_flags),
    'proposed_actions', v_proposed_actions,
    'execution_readiness', jsonb_build_object(
      'ready_for_auto_execution', false,
      'requires_manual_review', v_requires_manual_review,
      'blocking_reasons', to_jsonb(
        case
          when coalesce(array_length(v_blocking_reasons, 1), 0) = 0
            then array['standard_manual_erasure_review']::text[]
          else v_blocking_reasons
        end
      )
    ),
    'read_only_guarantee', jsonb_build_object(
      'mutations_performed', false,
      'scope', 'discovery_only',
      'note', 'Does not perform de-link, lifecycle, or erasure actions'
    )
  );

  return v_report;
end;
$$;

comment on function public.generate_erasure_impact_report(uuid) is
  'Read-only GDPR Right to Erasure impact discovery. Returns structured counts and risk flags without raw PII. Does NOT mutate data.';

revoke all on function public.generate_erasure_impact_report(uuid) from public;
revoke all on function public.generate_erasure_impact_report(uuid) from anon;
revoke all on function public.generate_erasure_impact_report(uuid) from authenticated;

grant execute on function public.generate_erasure_impact_report(uuid) to service_role;
