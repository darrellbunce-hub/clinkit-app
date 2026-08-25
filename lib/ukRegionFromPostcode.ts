/**
 * Derives a benchmarking region code from a UK postcode outward code.
 * Defaults to UK-OTHER when the area cannot be mapped.
 */
const POSTCODE_AREA_TO_REGION: Record<
  string,
  string
> = {
  PO: "UK-SOUTH-EAST",
  SO: "UK-SOUTH-EAST",
  GU: "UK-SOUTH-EAST",
  RH: "UK-SOUTH-EAST",
  BN: "UK-SOUTH-EAST",
  TN: "UK-SOUTH-EAST",
  CT: "UK-SOUTH-EAST",
  ME: "UK-SOUTH-EAST",
  SW: "UK-LONDON",
  SE: "UK-LONDON",
  EC: "UK-LONDON",
  WC: "UK-LONDON",
  E: "UK-LONDON",
  N: "UK-LONDON",
  NW: "UK-LONDON",
  W: "UK-LONDON",
  HA: "UK-LONDON",
  EN: "UK-LONDON",
  IG: "UK-LONDON",
  RM: "UK-LONDON",
  DA: "UK-LONDON",
  BR: "UK-LONDON",
  CR: "UK-LONDON",
  KT: "UK-LONDON",
  SM: "UK-LONDON",
  TW: "UK-LONDON",
  UB: "UK-LONDON",
  WD: "UK-LONDON",
  AL: "UK-EAST",
  CB: "UK-EAST",
  CM: "UK-EAST",
  CO: "UK-EAST",
  IP: "UK-EAST",
  NR: "UK-EAST",
  PE: "UK-EAST",
  SG: "UK-EAST",
  SS: "UK-EAST",
  BA: "UK-SOUTH-WEST",
  BS: "UK-SOUTH-WEST",
  DT: "UK-SOUTH-WEST",
  EX: "UK-SOUTH-WEST",
  GL: "UK-SOUTH-WEST",
  PL: "UK-SOUTH-WEST",
  SN: "UK-SOUTH-WEST",
  SP: "UK-SOUTH-WEST",
  TA: "UK-SOUTH-WEST",
  TQ: "UK-SOUTH-WEST",
  TR: "UK-SOUTH-WEST",
  B: "UK-WEST-MIDLANDS",
  CV: "UK-WEST-MIDLANDS",
  DY: "UK-WEST-MIDLANDS",
  HR: "UK-WEST-MIDLANDS",
  ST: "UK-WEST-MIDLANDS",
  TF: "UK-WEST-MIDLANDS",
  WR: "UK-WEST-MIDLANDS",
  WS: "UK-WEST-MIDLANDS",
  WV: "UK-WEST-MIDLANDS",
  DE: "UK-EAST-MIDLANDS",
  LE: "UK-EAST-MIDLANDS",
  LN: "UK-EAST-MIDLANDS",
  NG: "UK-EAST-MIDLANDS",
  NN: "UK-EAST-MIDLANDS",
  M: "UK-NORTH-WEST",
  L: "UK-NORTH-WEST",
  CH: "UK-NORTH-WEST",
  CW: "UK-NORTH-WEST",
  FY: "UK-NORTH-WEST",
  LA: "UK-NORTH-WEST",
  PR: "UK-NORTH-WEST",
  SK: "UK-NORTH-WEST",
  WA: "UK-NORTH-WEST",
  BB: "UK-NORTH-WEST",
  BL: "UK-NORTH-WEST",
  CA: "UK-NORTH-WEST",
  OL: "UK-NORTH-WEST",
  WN: "UK-NORTH-WEST",
  BD: "UK-YORKSHIRE",
  DN: "UK-YORKSHIRE",
  HD: "UK-YORKSHIRE",
  HG: "UK-YORKSHIRE",
  HU: "UK-YORKSHIRE",
  HX: "UK-YORKSHIRE",
  LS: "UK-YORKSHIRE",
  S: "UK-YORKSHIRE",
  WF: "UK-YORKSHIRE",
  YO: "UK-YORKSHIRE",
  NE: "UK-NORTH-EAST",
  DH: "UK-NORTH-EAST",
  DL: "UK-NORTH-EAST",
  SR: "UK-NORTH-EAST",
  TS: "UK-NORTH-EAST",
  EH: "UK-SCOTLAND",
  G: "UK-SCOTLAND",
  AB: "UK-SCOTLAND",
  DD: "UK-SCOTLAND",
  FK: "UK-SCOTLAND",
  IV: "UK-SCOTLAND",
  KY: "UK-SCOTLAND",
  ML: "UK-SCOTLAND",
  PA: "UK-SCOTLAND",
  PH: "UK-SCOTLAND",
  CF: "UK-WALES",
  NP: "UK-WALES",
  SA: "UK-WALES",
  LL: "UK-WALES",
  LD: "UK-WALES",
  BT: "UK-NORTHERN-IRELAND",
};

const UK_POSTCODE_PATTERN =
  /^[A-Z]{1,2}\d[A-Z\d]?/i;

export function normalizeUkPostcode(
  postcode: string
): string {
  return postcode
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

export function isValidUkPostcode(
  postcode: string
): boolean {
  const normalized =
    normalizeUkPostcode(postcode);

  return (
    normalized.length >= 5 &&
    UK_POSTCODE_PATTERN.test(normalized)
  );
}

export function deriveRegionCodeFromPostcode(
  postcode: string
): string {
  const normalized =
    normalizeUkPostcode(postcode);
  const outward =
    normalized.split(" ")[0] ?? normalized;

  const areaMatch =
    outward.match(/^[A-Z]{1,2}/i);

  if (!areaMatch) {
    return "UK-OTHER";
  }

  const area =
    areaMatch[0].toUpperCase();

  return (
    POSTCODE_AREA_TO_REGION[area] ??
    "UK-OTHER"
  );
}
