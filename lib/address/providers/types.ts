import type {
  AddressResolveResult,
  AddressSuggestResult,
} from "@/lib/address/types";

/**
 * Address lookup provider adapter.
 * Swap Ideal Postcodes later without rewriting UI or API route contracts.
 */
export type AddressLookupProvider = {
  readonly name: string;
  suggest(query: string): Promise<AddressSuggestResult>;
  resolve(suggestionId: string): Promise<AddressResolveResult>;
};
