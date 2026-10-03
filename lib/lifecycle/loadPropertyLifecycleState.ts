import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Dormancy warning status for one property, as the signed-in user may see it
 * (get_property_lifecycle_status). A warning is only ever reported to a user
 * on the placeholder's dependent side, who can also confirm it; everyone else
 * (and every managed row) gets inWarning = false.
 */
export type PropertyLifecycleStatus = {
  inWarning: boolean;
  canConfirm: boolean;
  confirmationDeadlineAt: string | null;
};

export const NO_LIFECYCLE_WARNING: PropertyLifecycleStatus = {
  inWarning: false,
  canConfirm: false,
  confirmationDeadlineAt: null,
};

export async function loadPropertyLifecycleStatus(params: {
  supabase: SupabaseClient;
  propertyId: number;
}): Promise<PropertyLifecycleStatus> {
  const { data, error } = await params.supabase.rpc(
    "get_property_lifecycle_status",
    { p_property_id: params.propertyId }
  );

  if (error) {
    throw new Error(error.message);
  }

  const payload = data as {
    ok?: boolean;
    in_warning?: boolean;
    can_confirm?: boolean;
    confirmation_deadline_at?: string | null;
  } | null;

  if (!payload?.ok || !payload.in_warning) {
    return NO_LIFECYCLE_WARNING;
  }

  return {
    inWarning: true,
    canConfirm: payload.can_confirm === true,
    confirmationDeadlineAt: payload.confirmation_deadline_at ?? null,
  };
}
