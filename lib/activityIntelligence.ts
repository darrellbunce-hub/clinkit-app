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

export function isDelayReportUpdate(
  update: string
): boolean {
  return update.includes(DELAY_REPORTED_PREFIX);
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
  activities: OperationalActivity[] | null | undefined
): boolean {
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
}): number {
  const propertyDelayCount =
    params.propertyActivitiesList.filter(
      (activities) =>
        hasActiveDelayReport(activities)
    ).length;

  const buyerReadyDelayCount =
    params.buyerReadyActivities &&
    hasActiveDelayReport(
      params.buyerReadyActivities
    )
      ? 1
      : 0;

  return propertyDelayCount + buyerReadyDelayCount;
}
