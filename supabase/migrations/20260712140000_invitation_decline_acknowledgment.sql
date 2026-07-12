-- Invitation decline acknowledgment for Requires Action dashboard visibility.

alter table public.property_claim_invitations
  add column if not exists invitation_rejection_acknowledged_at timestamptz null,
  add column if not exists invitation_rejection_acknowledged_by_user_id uuid null
    references auth.users (id);

comment on column public.property_claim_invitations.invitation_rejection_acknowledged_at is
  'When the assigned estate agent acknowledged a homeowner decline in the command centre.';
comment on column public.property_claim_invitations.invitation_rejection_acknowledged_by_user_id is
  'Estate agent user who acknowledged the decline.';

-- ---------------------------------------------------------------------------
-- RPC: acknowledge_property_claim_invitation_decline
-- ---------------------------------------------------------------------------

create or replace function public.acknowledge_property_claim_invitation_decline(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_ea_assigned_to_property(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select pci.id
  into v_invitation_id
  from public.property_claim_invitations pci
  where pci.property_id = p_property_id
    and pci.invitation_rejected_at is not null
    and pci.invitation_rejection_acknowledged_at is null
  order by pci.invitation_rejected_at desc
  limit 1;

  if v_invitation_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_unacknowledged_decline');
  end if;

  update public.property_claim_invitations
  set
    invitation_rejection_acknowledged_at = now(),
    invitation_rejection_acknowledged_by_user_id = auth.uid(),
    updated_at = now()
  where id = v_invitation_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.acknowledge_property_claim_invitation_decline(bigint) from public;
grant execute on function public.acknowledge_property_claim_invitation_decline(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- View: agent_branch_property_summaries (decline acknowledgment fields)
-- New columns are appended at the end to preserve CREATE OR REPLACE column order.
-- ---------------------------------------------------------------------------

create or replace view public.agent_branch_property_summaries
with (security_invoker = false)
as
select
  pea.id as assignment_id,
  pea.property_id,
  pea.branch_id,
  pea.status as assignment_status,
  pea.homeowner_only_updates,
  pea.assigned_at,
  p.chain_id,
  p.address,
  p.postcode,
  p.stage,
  p.status as property_status,
  ch.completion_lifecycle_status,
  ch.completion_scheduled_date,
  ch.completed_at,
  pos.needs_attention,
  pos.stale_update,
  pos.days_since_last_update,
  pos.operational_alerts,
  pos.next_recommended_action,
  cos.confidence_score,
  cos.health_status,
  coalesce(pcm.claim_status, 'claimed') as claim_status,
  coalesce(pcm.origin_type, 'homeowner') as origin_type,
  case
    when coalesce(pcm.claim_status, 'claimed') = 'claimed' then 'claimed'
    when active_invitation.id is not null then 'invitation_active'
    when latest_invitation.invitation_rejected_at is not null then 'invitation_declined'
    when latest_invitation.id is not null
      and latest_invitation.invitation_revoked_at is null
      and latest_invitation.invitation_used_at is null
      and latest_invitation.invitation_expires_at <= now() then 'invitation_expired'
    when coalesce(pcm.invitation_deferred, false) then 'invitation_deferred'
    else 'awaiting_claim'
  end as invitation_lifecycle_status,
  active_invitation.invitation_expires_at,
  active_invitation.invitation_version,
  latest_invitation.invitation_rejected_at,
  latest_invitation.invitation_rejection_reason,
  nullif(trim(pcm.invite_email), '') as invite_email,
  latest_invitation.invitation_rejection_acknowledged_at
from public.property_ea_assignments pea
inner join public.properties p
  on p.id = pea.property_id
inner join public.chains ch
  on ch.id = p.chain_id
left join public.property_operational_summary pos
  on pos.property_id = pea.property_id
left join public.chain_operational_summary cos
  on cos.chain_id = p.chain_id
left join public.property_claim_metadata pcm
  on pcm.property_id = pea.property_id
left join lateral (
  select pci.*
  from public.property_claim_invitations pci
  where pci.property_id = pea.property_id
    and pci.invitation_revoked_at is null
    and pci.invitation_used_at is null
    and pci.invitation_expires_at > now()
  order by pci.invitation_created_at desc
  limit 1
) active_invitation on true
left join lateral (
  select pci.*
  from public.property_claim_invitations pci
  where pci.property_id = pea.property_id
  order by pci.invitation_created_at desc
  limit 1
) latest_invitation on true
where
  auth.uid() is not null
  and exists (
    select 1
    from public.ea_branch_members bm
    where bm.branch_id = pea.branch_id
      and bm.user_id = auth.uid()
  )
  and pea.status in ('active', 'revoked');

revoke all on public.agent_branch_property_summaries from public;
revoke all on public.agent_branch_property_summaries from anon;
grant select on public.agent_branch_property_summaries to authenticated;
