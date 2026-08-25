/** @deprecated Prefer DELAY_REPORTED_ACTIVITY_PREFIX from operationalDelays */
export const DELAY_REPORTED_PREFIX =
  "Delay Reported";

export const STALE_DAYS_CONFIDENCE = 21;

export const STALE_DAYS_PAGE_ALERT = 14;

export type OperationalActivity = {
  id?: number;
  timestamp: string;
  update: string;
  updated_by?: string;
};

/**
 * True when an activity text is a delay *report* event (legacy or lifecycle).
 * Resolve events ("Delay resolved — …") are not report events.
 */
export function isDelayReportUpdate(
  update: string
): boolean {
  const normalised = update.toLowerCase();

  if (normalised.includes("delay resolved")) {
    return false;
  }

  return (
    normalised.includes("delay reported") ||
    update.includes(DELAY_REPORTED_PREFIX)
  );
}

/**
 * Authoritative active-delay check when lifecycle state is known.
 * Falls back to legacy "latest activity is a delay report" only when
 * authoritativeActiveDelay is undefined/null (pre-lifecycle / unset).
 */
export function targetHasActiveOperationalDelay(params: {
  activities?: OperationalActivity[] | null;
  authoritativeActiveDelay?: boolean | null;
}): boolean {
  if (
    typeof params.authoritativeActiveDelay ===
    "boolean"
  ) {
    return params.authoritativeActiveDelay;
  }

  return hasActiveDelayReport(params.activities);
}

export function sortActivitiesNewestFirst<
  T extends OperationalActivity
>(activities: T[] | null | undefined): T[] {
  if (!activities?.length) {
    return [];
  }

  return [...activities].sort(
    (left, right) =>
      new Date(right.timestamp || 0).getTime() -
      new Date(left.timestamp || 0).getTime()
  );
}

export function getLatestActivity<
  T extends OperationalActivity
>(
  activities: T[] | null | undefined
): T | null {
  const sortedActivities =
    sortActivitiesNewestFirst(activities);

  return sortedActivities[0] ?? null;
}

export function getLatestDelayReport<
  T extends OperationalActivity
>(
  activities: T[] | null | undefined
): T | null {
  const sortedActivities =
    sortActivitiesNewestFirst(activities);

  return (
    sortedActivities.find((activity) =>
      isDelayReportUpdate(activity.update)
    ) ?? null
  );
}

export function hasActiveDelayReport(
  activities: OperationalActivity[] | null | undefined,
  options?: {
    authoritativeActiveDelay?: boolean | null;
  }
): boolean {
  if (
    typeof options?.authoritativeActiveDelay ===
    "boolean"
  ) {
    return options.authoritativeActiveDelay;
  }

  const latestActivity =
    getLatestActivity(activities);

  if (!latestActivity) {
    return false;
  }

  return isDelayReportUpdate(
    latestActivity.update
  );
}

export function daysSinceLastActivity(
  activities: OperationalActivity[] | null | undefined,
  referenceDate: Date = new Date()
): number {
  const latestActivity =
    getLatestActivity(activities);

  if (!latestActivity?.timestamp) {
    return 0;
  }

  const updatedDate = new Date(
    latestActivity.timestamp
  );

  if (Number.isNaN(updatedDate.getTime())) {
    return 0;
  }

  const difference =
    referenceDate.getTime() -
    updatedDate.getTime();

  return Math.floor(
    difference / (1000 * 60 * 60 * 24)
  );
}

export function countActiveDelayReports(params: {
  propertyActivitiesList: OperationalActivity[][];
  buyerReadyActivities?:
    | OperationalActivity[]
    | null;
  propertyAuthoritativeActiveDelays?:
    | Array<boolean | null | undefined>
    | null;
  buyerReadyAuthoritativeActiveDelay?:
    | boolean
    | null;
}): number {
  const propertyDelayCount =
    params.propertyActivitiesList.filter(
      (activities, index) =>
        hasActiveDelayReport(activities, {
          authoritativeActiveDelay:
            params.propertyAuthoritativeActiveDelays?.[
              index
            ],
        })
    ).length;

  const buyerReadyDelayCount =
    params.buyerReadyActivities &&
    hasActiveDelayReport(
      params.buyerReadyActivities,
      {
        authoritativeActiveDelay:
          params.buyerReadyAuthoritativeActiveDelay,
      }
    )
      ? 1
      : 0;

  return propertyDelayCount + buyerReadyDelayCount;
}
