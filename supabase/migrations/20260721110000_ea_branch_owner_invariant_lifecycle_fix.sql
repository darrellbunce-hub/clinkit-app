-- Corrective fix: leave_branch ownership transfer + branch teardown lifecycle
--
-- 1) leave_branch transfer: demote outgoing Owner to agent before DELETE so the
--    deferred one-Owner invariant never observes a populated branch with zero
--    branch_admin rows during successor promotion.
-- 2) Invariant trigger: skip enforcement when the branch row no longer exists
--    (e.g. ON DELETE CASCADE during branch/company deletion).

create or replace function public._enforce_ea_branch_owner_invariant()
returns trigger
language plpgsql
as $$
declare
  v_branch_id uuid;
  v_owner_count integer;
begin
  v_branch_id := coalesce(new.branch_id, old.branch_id);

  if not exists (
    select 1
    from public.ea_branches b
    where b.id = v_branch_id
  ) then
    return null;
  end if;

  select count(*)
  into v_owner_count
  from public.ea_branch_members bm
  where bm.branch_id = v_branch_id
    and bm.role = 'branch_admin';

  if v_owner_count <> 1 then
    raise exception 'ea_branch_owner_invariant_violation: branch % has % owners', v_branch_id, v_owner_count
      using errcode = '23514';
  end if;

  return null;
end;
$$;

comment on function public._enforce_ea_branch_owner_invariant() is
  'Deferred constraint: populated branches must have exactly one branch_admin at commit. Skips when the branch row is gone (teardown cascade).';

create or replace function public.transfer_ea_branch_ownership(
  p_branch_id uuid,
  p_new_owner_member_id uuid,
  p_outgoing_action text default 'remain_staff'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_member public.ea_branch_members;
  v_target_member public.ea_branch_members;
  v_owner_count integer;
begin
  if p_outgoing_action not in ('remain_staff', 'leave_branch') then
    return jsonb_build_object('ok', false, 'error', 'invalid_outgoing_action');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_branch_id::text, 0)
  );

  if not public.is_ea_branch_admin(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_branch_admin');
  end if;

  select bm.*
  into v_caller_member
  from public.ea_branch_members bm
  where bm.branch_id = p_branch_id
    and bm.user_id = auth.uid();

  if not found or v_caller_member.role <> 'branch_admin' then
    return jsonb_build_object('ok', false, 'error', 'not_branch_admin');
  end if;

  select count(*)
  into v_owner_count
  from public.ea_branch_members bm
  where bm.branch_id = p_branch_id
    and bm.role = 'branch_admin';

  if v_owner_count <> 1 then
    return jsonb_build_object('ok', false, 'error', 'owner_invariant_violation');
  end if;

  select bm.*
  into v_target_member
  from public.ea_branch_members bm
  where bm.id = p_new_owner_member_id
    and bm.branch_id = p_branch_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'target_not_found');
  end if;

  if v_target_member.user_id = auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'cannot_transfer_to_self');
  end if;

  if v_target_member.role <> 'agent' then
    return jsonb_build_object('ok', false, 'error', 'target_must_be_staff');
  end if;

  update public.ea_branch_members
  set role = 'branch_admin'
  where id = v_target_member.id;

  if p_outgoing_action = 'remain_staff' then
    update public.ea_branch_members
    set role = 'agent'
    where id = v_caller_member.id;

    perform public._log_ea_branch_membership_event(
      'role_changed',
      p_branch_id,
      auth.uid(),
      v_caller_member.user_id,
      'branch_admin',
      'agent',
      jsonb_build_object('reason', 'ownership_transfer')
    );
  else
    update public.ea_branch_members
    set role = 'agent'
    where id = v_caller_member.id;

    perform public._log_ea_branch_membership_event(
      'owner_left_branch',
      p_branch_id,
      auth.uid(),
      v_caller_member.user_id,
      'branch_admin',
      'agent',
      jsonb_build_object('member_id', v_caller_member.id)
    );

    delete from public.ea_branch_members
    where id = v_caller_member.id;
  end if;

  perform public._log_ea_branch_membership_event(
    'ownership_transferred',
    p_branch_id,
    auth.uid(),
    v_target_member.user_id,
    'agent',
    'branch_admin',
    jsonb_build_object(
      'outgoing_action', p_outgoing_action,
      'previous_owner_user_id', v_caller_member.user_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'new_owner_user_id', v_target_member.user_id,
    'outgoing_action', p_outgoing_action
  );
end;
$$;

revoke all on function public.transfer_ea_branch_ownership(uuid, uuid, text) from public;
grant execute on function public.transfer_ea_branch_ownership(uuid, uuid, text) to authenticated;
