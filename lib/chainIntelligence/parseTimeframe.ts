export type ParsedTimeframe = {
  minDays: number | null;
  maxDays: number | null;
  unit: "days" | "weeks" | "variable" | "complete" | "unknown";
  raw: string;
};

export type StageTimingDefinition = {
  value: string;
  label: string;
  nextStep: string;
  expectedTimeframe: ParsedTimeframe;
};

/** Parse display strings such as "1–2 weeks" into day bounds. */
export function parseExpectedTimeframe(raw: string): ParsedTimeframe {
  const normalized = raw.trim();

  if (normalized === "Variable") {
    return {
      minDays: null,
      maxDays: null,
      unit: "variable",
      raw,
    };
  }

  if (normalized === "Complete") {
    return {
      minDays: 0,
      maxDays: 0,
      unit: "complete",
      raw,
    };
  }

  const match = normalized.match(
    /^(\d+)(?:–(\d+))?\s+(day|days|week|weeks)$/i
  );

  if (!match) {
    return {
      minDays: null,
      maxDays: null,
      unit: "unknown",
      raw,
    };
  }

  const min = Number(match[1]);
  const max = Number(match[2] ?? match[1]);
  const unitWord = match[3].toLowerCase();
  const multiplier = unitWord.startsWith("week") ? 7 : 1;

  return {
    minDays: min * multiplier,
    maxDays: max * multiplier,
    unit: unitWord.startsWith("week") ? "weeks" : "days",
    raw,
  };
}
