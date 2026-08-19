import "server-only";

import { createIdealPostcodesProvider } from "@/lib/address/providers/idealPostcodes";
import type { AddressLookupProvider } from "@/lib/address/providers/types";

let cached: AddressLookupProvider | null = null;

export function getAddressLookupProvider(): AddressLookupProvider {
  if (!cached) {
    cached = createIdealPostcodesProvider();
  }
  return cached;
}
