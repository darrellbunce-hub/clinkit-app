import { getAppBaseUrl } from "@/lib/communications/config";

export function buildDormancyWarningPropertyUrl(propertyId: number): string {
  const url = new URL(`/property/${propertyId}`, getAppBaseUrl());
  url.searchParams.set("lifecycle", "dormancy-warning");
  return url.toString();
}
