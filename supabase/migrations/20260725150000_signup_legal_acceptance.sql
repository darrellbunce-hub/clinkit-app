-- Signup legal acceptance audit trail (Terms + Privacy Policy).
-- Records versioned acceptance at account creation; existing users are not backfilled.

create table if not exists public.legal_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  document_type text not null,
  document_version text not null,
  accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint legal_acceptances_document_type_check check (
    document_type in (
      'terms_of_use',
      'estate_agent_terms',
      'privacy_policy'
    )
  ),
  constraint legal_acceptances_document_version_check check (
    char_length(trim(document_version)) > 0
  ),
  constraint legal_acceptances_user_document_version_key unique (
    user_id,
    document_type,
    document_version
  )
);

create index if not exists legal_acceptances_user_id_idx
  on public.legal_acceptances (user_id);

comment on table public.legal_acceptances is
  'Append-only audit of legal document acceptance events keyed by user and document version.';

alter table public.legal_acceptances enable row level security;

drop policy if exists legal_acceptances_select_own
  on public.legal_acceptances;

create policy legal_acceptances_select_own
  on public.legal_acceptances
  for select
  to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.legal_acceptances
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: record_signup_legal_acceptances
-- Inserts terms + privacy acceptance rows for the authenticated user.
-- ---------------------------------------------------------------------------

create or replace function public.record_signup_legal_acceptances(
  p_terms_document text,
  p_terms_version text,
  p_privacy_version text,
  p_accepted_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_accepted_at timestamptz;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_terms_document is null
     or p_terms_document not in ('terms_of_use', 'estate_agent_terms') then
    return jsonb_build_object('ok', false, 'error', 'invalid_terms_document');
  end if;

  if nullif(trim(p_terms_version), '') is null
     or nullif(trim(p_privacy_version), '') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_version');
  end if;

  v_accepted_at := coalesce(p_accepted_at, now());

  insert into public.legal_acceptances (
    user_id,
    document_type,
    document_version,
    accepted_at
  )
  values
    (
      v_user_id,
      p_terms_document,
      trim(p_terms_version),
      v_accepted_at
    ),
    (
      v_user_id,
      'privacy_policy',
      trim(p_privacy_version),
      v_accepted_at
    )
  on conflict (user_id, document_type, document_version) do nothing;

  return jsonb_build_object('ok', true);
exception
  when others then
    return jsonb_build_object('ok', false, 'error', 'record_failed');
end;
$$;

comment on function public.record_signup_legal_acceptances(
  text,
  text,
  text,
  timestamptz
) is
  'Records signup Terms and Privacy Policy acceptance for auth.uid(). Idempotent per user/document/version.';

revoke all on function public.record_signup_legal_acceptances(
  text,
  text,
  text,
  timestamptz
) from public;

grant execute on function public.record_signup_legal_acceptances(
  text,
  text,
  text,
  timestamptz
) to authenticated;
