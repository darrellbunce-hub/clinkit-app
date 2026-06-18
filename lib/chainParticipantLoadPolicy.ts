import { requiresParticipantData } from "@/lib/requiresParticipantData";

export type AuthEventDecision =
  | { action: "ignore" }
  | { action: "signed_out" }
  | { action: "user_changed"; userId: string }
  | { action: "signed_in"; userId: string };

export function resolveAuthEventDecision(params: {
  event: string;
  bootstrapComplete: boolean;
  previousUserId: string | null;
  nextUserId: string | null;
}): AuthEventDecision {
  const {
    event,
    bootstrapComplete,
    previousUserId,
    nextUserId,
  } = params;

  if (
    event === "INITIAL_SESSION" &&
    !bootstrapComplete
  ) {
    return { action: "ignore" };
  }

  if (
    event === "SIGNED_OUT" &&
    !nextUserId &&
    (!bootstrapComplete ||
      previousUserId !== null)
  ) {
    return { action: "signed_out" };
  }

  if (nextUserId === previousUserId) {
    return { action: "ignore" };
  }

  if (
    previousUserId &&
    nextUserId &&
    nextUserId !== previousUserId
  ) {
    return {
      action: "user_changed",
      userId: nextUserId,
    };
  }

  if (!nextUserId) {
    return { action: "signed_out" };
  }

  return {
    action: "signed_in",
    userId: nextUserId,
  };
}

export function shouldApplyBootstrapAuthResult(
  capturedGeneration: number,
  currentGeneration: number
): boolean {
  return (
    capturedGeneration === currentGeneration
  );
}

export function nextAuthGenerationAfterMeaningfulEvent(
  currentGeneration: number
): number {
  return currentGeneration + 1;
}

export function isMeaningfulAuthEventDecision(
  decision: AuthEventDecision
): boolean {
  return decision.action !== "ignore";
}

export type ParticipantLoadTransitionDecision =
  | { action: "none" }
  | { action: "clear" }
  | { action: "load" };

export function resolveParticipantLoadTransition(params: {
  authLoading: boolean;
  userId: string | null;
  shouldLoad: boolean;
  previousShouldLoad: boolean;
  previousUserId: string | null;
  participantDataLoadedForUserId: string | null;
}): ParticipantLoadTransitionDecision {
  if (params.authLoading) {
    return { action: "none" };
  }

  const {
    userId,
    shouldLoad,
    previousShouldLoad,
    previousUserId,
    participantDataLoadedForUserId,
  } = params;

  if (previousShouldLoad && !shouldLoad) {
    return { action: "clear" };
  }

  if (!shouldLoad) {
    return { action: "none" };
  }

  if (!userId) {
    return { action: "none" };
  }

  if (!previousShouldLoad && shouldLoad) {
    return { action: "load" };
  }

  if (
    userId !== previousUserId ||
    participantDataLoadedForUserId !== userId
  ) {
    return { action: "load" };
  }

  return { action: "none" };
}

export { requiresParticipantData };
