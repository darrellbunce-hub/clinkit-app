import { CHAIN_CONFIDENCE_LOW_THRESHOLD } from "@/lib/operationalSummary/constants";
import type {
  OperationalAlert,
  PropertyAlertEvaluationContext,
} from "@/lib/operationalAlerts/types";

export type OperationalAlertRule = {
  code: OperationalAlert["code"];
  evaluate: (
    context: PropertyAlertEvaluationContext
  ) => OperationalAlert | null;
};

const staleUpdateRule: OperationalAlertRule = {
  code: "stale_update",
  evaluate: (context) => {
    if (
      context.scheduledCompletionMode ||
      !context.staleUpdate
    ) {
      return null;
    }

    return {
      code: "stale_update",
      severity:
        context.daysSinceLastUpdate > 21
          ? "critical"
          : "warning",
    };
  },
};

const delayReportedRule: OperationalAlertRule = {
  code: "delay_reported",
  evaluate: (context) => {
    if (!context.hasActivePropertyDelay) {
      return null;
    }

    return {
      code: "delay_reported",
      severity: "warning",
    };
  },
};

const buyerReadyStaleRule: OperationalAlertRule = {
  code: "buyer_ready_stale",
  evaluate: (context) => {
    if (
      context.scheduledCompletionMode ||
      !context.buyerReadyStale
    ) {
      return null;
    }

    return {
      code: "buyer_ready_stale",
      severity: "warning",
    };
  },
};

const buyerReadyDelayedRule: OperationalAlertRule = {
  code: "buyer_ready_delayed",
  evaluate: (context) => {
    if (!context.buyerReadyDelayed) {
      return null;
    }

    return {
      code: "buyer_ready_delayed",
      severity: "warning",
    };
  },
};

const completionAwaitingConfirmationRule: OperationalAlertRule =
  {
    code: "completion_awaiting_confirmation",
    evaluate: (context) => {
      if (
        !context.completionAwaitingConfirmation
      ) {
        return null;
      }

      return {
        code: "completion_awaiting_confirmation",
        severity: "warning",
      };
    },
  };

const chainConfidenceLowRule: OperationalAlertRule = {
  code: "chain_confidence_low",
  evaluate: (context) => {
    if (
      context.chainConfidenceScore == null ||
      context.chainConfidenceScore >=
        CHAIN_CONFIDENCE_LOW_THRESHOLD
    ) {
      return null;
    }

    return {
      code: "chain_confidence_low",
      severity: "warning",
    };
  },
};

const brokenConnectionRule: OperationalAlertRule = {
  code: "broken_connection",
  evaluate: (context) => {
    if (
      context.propertyStatus !==
      "broken_connection"
    ) {
      return null;
    }

    return {
      code: "broken_connection",
      severity: "critical",
    };
  },
};

const propertyBlockedRule: OperationalAlertRule = {
  code: "property_blocked",
  evaluate: (context) => {
    if (context.propertyStatus !== "blocked") {
      return null;
    }

    return {
      code: "property_blocked",
      severity: "critical",
    };
  },
};

export const OPERATIONAL_ALERT_RULES: OperationalAlertRule[] =
  [
    brokenConnectionRule,
    propertyBlockedRule,
    staleUpdateRule,
    delayReportedRule,
    buyerReadyDelayedRule,
    buyerReadyStaleRule,
    completionAwaitingConfirmationRule,
    chainConfidenceLowRule,
  ];

export function evaluateOperationalAlerts(
  context: PropertyAlertEvaluationContext
): OperationalAlert[] {
  return OPERATIONAL_ALERT_RULES.flatMap(
    (rule) => {
      const alert = rule.evaluate(context);

      return alert ? [alert] : [];
    }
  );
}
