/**
 * Automated policy tests for Step 2 route-gated participant loading.
 * Run: npx tsx scripts/verify-participant-data-gating.ts
 *
 * These are static/runtime simulations of load/auth decisions — not browser tests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  resolveAuthEventDecision,
  resolveParticipantLoadTransition,
  requiresParticipantData,
  shouldApplyBootstrapAuthResult,
  nextAuthGenerationAfterMeaningfulEvent,
  isMeaningfulAuthEventDecision,
} from "../lib/chainParticipantLoadPolicy";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertAuthDecision(
  label: string,
  params: Parameters<
    typeof resolveAuthEventDecision
  >[0],
  expected: ReturnType<
    typeof resolveAuthEventDecision
  >["action"]
) {
  const decision =
    resolveAuthEventDecision(params);

  assert(
    decision.action === expected,
    `${label}: expected ${expected}, got ${decision.action}`
  );
}

function assertLoadTransition(
  label: string,
  params: Parameters<
    typeof resolveParticipantLoadTransition
  >[0],
  expected: ReturnType<
    typeof resolveParticipantLoadTransition
  >["action"]
) {
  const decision =
    resolveParticipantLoadTransition(params);

  assert(
    decision.action === expected,
    `${label}: expected ${expected}, got ${decision.action}`
  );
}

type SimState = {
  authLoading: boolean;
  userId: string | null;
  pathname: string;
  previousShouldLoad: boolean;
  previousUserId: string | null;
  participantDataLoadedForUserId: string | null;
  participantLoadCount: number;
  propertiesLength: number;
};

function simulateAuthOnly(
  state: SimState,
  authEvent: {
    event: string;
    nextUserId: string | null;
    bootstrapComplete: boolean;
  }
): SimState {
  const decision = resolveAuthEventDecision({
    event: authEvent.event,
    bootstrapComplete:
      authEvent.bootstrapComplete,
    previousUserId: state.userId,
    nextUserId: authEvent.nextUserId,
  });

  if (decision.action === "ignore") {
    return state;
  }

  if (decision.action === "signed_out") {
    return {
      ...state,
      userId: null,
      propertiesLength: 0,
      participantDataLoadedForUserId: null,
    };
  }

  if (decision.action === "user_changed") {
    return {
      ...state,
      userId: decision.userId,
      propertiesLength: 0,
      participantDataLoadedForUserId: null,
    };
  }

  return {
    ...state,
    userId: decision.userId,
  };
}

function simulateLoadOnly(
  state: SimState
): SimState {
  const shouldLoad = requiresParticipantData(
    state.pathname
  );

  const loadDecision =
    resolveParticipantLoadTransition({
      authLoading: state.authLoading,
      userId: state.userId,
      shouldLoad,
      previousShouldLoad:
        state.previousShouldLoad,
      previousUserId: state.previousUserId,
      participantDataLoadedForUserId:
        state.participantDataLoadedForUserId,
    });

  let propertiesLength =
    state.propertiesLength;
  let participantLoadCount =
    state.participantLoadCount;
  let participantDataLoadedForUserId =
    state.participantDataLoadedForUserId;

  if (loadDecision.action === "clear") {
    propertiesLength = 0;
    participantDataLoadedForUserId = null;
  }

  if (loadDecision.action === "load") {
    participantLoadCount += 1;
    participantDataLoadedForUserId =
      state.userId;
    propertiesLength = 3;
  }

  return {
    ...state,
    previousShouldLoad: shouldLoad,
    previousUserId: state.userId,
    participantDataLoadedForUserId,
    participantLoadCount,
    propertiesLength,
  };
}

function simulateTransition(
  state: SimState,
  next: Partial<
    Pick<
      SimState,
      "authLoading" | "userId" | "pathname"
    >
  > & {
    authEvent?: {
      event: string;
      nextUserId: string | null;
      bootstrapComplete: boolean;
    };
  }
): SimState {
  let nextState: SimState = {
    ...state,
    authLoading:
      next.authLoading ?? state.authLoading,
    userId: next.userId ?? state.userId,
    pathname: next.pathname ?? state.pathname,
  };

  if (next.authEvent) {
    nextState = simulateAuthOnly(
      nextState,
      next.authEvent
    );
  }

  return simulateLoadOnly(nextState);
}

// --- requiresParticipantData ---

for (const route of [
  "/dashboard",
  "/my-chains",
  "/chain/42",
  "/property/7",
  "/buyer-ready/42",
]) {
  assert(
    requiresParticipantData(route),
    `participant route: ${route}`
  );
}

for (const route of [
  "/",
  "/login",
  "/account",
  "/start-move",
  "/join-chain",
  "/estate-agents/login",
]) {
  assert(
    !requiresParticipantData(route),
    `non-participant route: ${route}`
  );
}

// --- auth event decisions ---

assertAuthDecision(
  "INITIAL_SESSION before bootstrap",
  {
    event: "INITIAL_SESSION",
    bootstrapComplete: false,
    previousUserId: null,
    nextUserId: "user-a",
  },
  "ignore"
);

assertAuthDecision(
  "TOKEN_REFRESHED same user",
  {
    event: "TOKEN_REFRESHED",
    bootstrapComplete: true,
    previousUserId: "user-a",
    nextUserId: "user-a",
  },
  "ignore"
);

assertAuthDecision(
  "SIGNED_OUT",
  {
    event: "SIGNED_OUT",
    bootstrapComplete: true,
    previousUserId: "user-a",
    nextUserId: null,
  },
  "signed_out"
);

assertAuthDecision(
  "user A to user B",
  {
    event: "SIGNED_IN",
    bootstrapComplete: true,
    previousUserId: "user-a",
    nextUserId: "user-b",
  },
  "user_changed"
);

assertAuthDecision(
  "signed in from anonymous",
  {
    event: "SIGNED_IN",
    bootstrapComplete: true,
    previousUserId: null,
    nextUserId: "user-a",
  },
  "signed_in"
);

// --- load transition decisions ---

assertLoadTransition(
  "auth still loading",
  {
    authLoading: true,
    userId: "user-a",
    shouldLoad: true,
    previousShouldLoad: false,
    previousUserId: null,
    participantDataLoadedForUserId: null,
  },
  "none"
);

assertLoadTransition(
  "enter participant route",
  {
    authLoading: false,
    userId: "user-a",
    shouldLoad: true,
    previousShouldLoad: false,
    previousUserId: null,
    participantDataLoadedForUserId: null,
  },
  "load"
);

assertLoadTransition(
  "dashboard to chain same user",
  {
    authLoading: false,
    userId: "user-a",
    shouldLoad: true,
    previousShouldLoad: true,
    previousUserId: "user-a",
    participantDataLoadedForUserId: "user-a",
  },
  "none"
);

assertLoadTransition(
  "leave participant route",
  {
    authLoading: false,
    userId: "user-a",
    shouldLoad: false,
    previousShouldLoad: true,
    previousUserId: "user-a",
    participantDataLoadedForUserId: "user-a",
  },
  "clear"
);

assertLoadTransition(
  "anonymous public page",
  {
    authLoading: false,
    userId: null,
    shouldLoad: false,
    previousShouldLoad: false,
    previousUserId: null,
    participantDataLoadedForUserId: null,
  },
  "none"
);

assertLoadTransition(
  "authenticated public page",
  {
    authLoading: false,
    userId: "user-a",
    shouldLoad: false,
    previousShouldLoad: false,
    previousUserId: "user-a",
    participantDataLoadedForUserId: null,
  },
  "none"
);

// --- simulated scenarios (automated runtime, not browser) ---

let sim: SimState = {
  authLoading: true,
  userId: null,
  pathname: "/",
  previousShouldLoad: false,
  previousUserId: null,
  participantDataLoadedForUserId: null,
  participantLoadCount: 0,
  propertiesLength: 0,
};

sim = simulateTransition(sim, {
  authLoading: false,
  userId: null,
  pathname: "/",
});
assert(
  sim.participantLoadCount === 0,
  "1 anonymous public: zero participant loads"
);

sim = simulateTransition(sim, {
  authLoading: false,
  userId: "user-a",
  pathname: "/",
});
assert(
  sim.participantLoadCount === 0,
  "2 authenticated public: zero participant loads"
);

sim = simulateTransition(sim, {
  pathname: "/dashboard",
});
assert(
  sim.participantLoadCount === 1,
  "3 initial dashboard: one participant load"
);

sim = simulateTransition(sim, {
  pathname: "/chain/1",
});
assert(
  sim.participantLoadCount === 1,
  "6 dashboard to chain: no additional load"
);

sim = simulateTransition(sim, {
  pathname: "/property/2",
});
assert(
  sim.participantLoadCount === 1,
  "6 chain to property: no additional load"
);

sim = simulateTransition(sim, {
  authEvent: {
    event: "TOKEN_REFRESHED",
    nextUserId: "user-a",
    bootstrapComplete: true,
  },
});
assert(
  sim.participantLoadCount === 1,
  "5 TOKEN_REFRESHED same user: no additional load"
);

sim = simulateTransition(sim, {
  pathname: "/",
});
assert(
  sim.participantLoadCount === 1 &&
    sim.propertiesLength === 0,
  "8 dashboard to public: state cleared"
);

sim = simulateTransition(sim, {
  pathname: "/dashboard",
});
assert(
  sim.participantLoadCount === 2,
  "7 public to dashboard: one participant load"
);

let loginSim: SimState = {
  authLoading: false,
  userId: null,
  pathname: "/login",
  previousShouldLoad: false,
  previousUserId: null,
  participantDataLoadedForUserId: null,
  participantLoadCount: 0,
  propertiesLength: 0,
};

loginSim = simulateTransition(loginSim, {
  authEvent: {
    event: "SIGNED_IN",
    nextUserId: "user-a",
    bootstrapComplete: true,
  },
});
assert(
  loginSim.participantLoadCount === 0,
  "4 login on non-participant route: no participant load yet"
);

loginSim = simulateTransition(loginSim, {
  pathname: "/dashboard",
});
assert(
  loginSim.participantLoadCount === 1,
  "4 login targeting dashboard: exactly one participant load"
);

sim = {
  authLoading: false,
  userId: "user-a",
  pathname: "/dashboard",
  previousShouldLoad: true,
  previousUserId: "user-a",
  participantDataLoadedForUserId: "user-a",
  participantLoadCount: 1,
  propertiesLength: 3,
};

sim = simulateAuthOnly(sim, {
  event: "SIGNED_IN",
  nextUserId: "user-b",
  bootstrapComplete: true,
});
assert(
  sim.propertiesLength === 0,
  "9 user A to B: user A state cleared before load"
);

sim = simulateLoadOnly(sim);
assert(
  sim.participantLoadCount === 2,
  "9 user A to B: user B load triggered once"
);

sim = simulateTransition(sim, {
  authEvent: {
    event: "SIGNED_OUT",
    nextUserId: null,
    bootstrapComplete: true,
  },
  userId: null,
});
assert(
  sim.propertiesLength === 0 &&
    sim.participantDataLoadedForUserId === null,
  "10 logout: private state cleared"
);

const navbarSource = readFileSync(
  join(process.cwd(), "components/Navbar.tsx"),
  "utf8"
);

assert(
  !navbarSource.includes("auth.getUser"),
  "Navbar must not call auth.getUser()"
);

type BootstrapRaceState = {
  authGeneration: number;
  bootstrapComplete: boolean;
  userId: string | null;
  bootstrapCapturedGeneration: number | null;
};

function startBootstrap(
  state: BootstrapRaceState
): BootstrapRaceState {
  return {
    ...state,
    bootstrapCapturedGeneration:
      state.authGeneration,
  };
}

function finishBootstrap(
  state: BootstrapRaceState,
  bootstrapUserId: string | null
): BootstrapRaceState {
  const nextState: BootstrapRaceState = {
    ...state,
    bootstrapComplete: true,
    bootstrapCapturedGeneration: null,
  };

  if (
    state.bootstrapCapturedGeneration === null
  ) {
    return nextState;
  }

  if (
    !shouldApplyBootstrapAuthResult(
      state.bootstrapCapturedGeneration,
      state.authGeneration
    )
  ) {
    return nextState;
  }

  return {
    ...nextState,
    userId: bootstrapUserId,
  };
}

function applyMeaningfulAuthEvent(
  state: BootstrapRaceState,
  authEvent: {
    event: string;
    nextUserId: string | null;
    bootstrapComplete: boolean;
  }
): BootstrapRaceState {
  const decision = resolveAuthEventDecision({
    event: authEvent.event,
    bootstrapComplete:
      authEvent.bootstrapComplete,
    previousUserId: state.userId,
    nextUserId: authEvent.nextUserId,
  });

  if (!isMeaningfulAuthEventDecision(decision)) {
    return state;
  }

  const authGeneration =
    nextAuthGenerationAfterMeaningfulEvent(
      state.authGeneration
    );

  if (decision.action === "signed_out") {
    return {
      ...state,
      authGeneration,
      userId: null,
    };
  }

  if (
    decision.action === "user_changed" ||
    decision.action === "signed_in"
  ) {
    return {
      ...state,
      authGeneration,
      userId: decision.userId,
    };
  }

  return state;
}

let race: BootstrapRaceState = {
  authGeneration: 0,
  bootstrapComplete: false,
  userId: null,
  bootstrapCapturedGeneration: null,
};

race = startBootstrap(race);
race = applyMeaningfulAuthEvent(race, {
  event: "SIGNED_IN",
  nextUserId: "user-a",
  bootstrapComplete: false,
});
race = finishBootstrap(race, null);
assert(
  race.userId === "user-a",
  "bootstrap race 1: SIGNED_IN wins over stale anonymous bootstrap"
);

race = {
  authGeneration: 0,
  bootstrapComplete: false,
  userId: null,
  bootstrapCapturedGeneration: null,
};

race = startBootstrap(race);
race = applyMeaningfulAuthEvent(race, {
  event: "SIGNED_OUT",
  nextUserId: null,
  bootstrapComplete: false,
});
race = finishBootstrap(race, "user-a");
assert(
  race.userId === null,
  "bootstrap race 2: SIGNED_OUT wins over stale authenticated bootstrap"
);

race = {
  authGeneration: 0,
  bootstrapComplete: false,
  userId: "user-a",
  bootstrapCapturedGeneration: null,
};

race = startBootstrap(race);
race = applyMeaningfulAuthEvent(race, {
  event: "SIGNED_IN",
  nextUserId: "user-b",
  bootstrapComplete: false,
});
race = finishBootstrap(race, "user-a");
assert(
  race.userId === "user-b",
  "bootstrap race 3: User B wins over stale User A bootstrap"
);

assert(
  applyMeaningfulAuthEvent(
    {
      authGeneration: 0,
      bootstrapComplete: false,
      userId: null,
      bootstrapCapturedGeneration: 0,
    },
    {
      event: "INITIAL_SESSION",
      nextUserId: "user-a",
      bootstrapComplete: false,
    }
  ).authGeneration === 0,
  "INITIAL_SESSION before bootstrap does not invalidate bootstrap generation"
);

console.log(
  "verify-participant-data-gating: all policy and simulation checks passed"
);
