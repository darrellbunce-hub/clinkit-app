import "server-only";

import {
  formatAddressLinesForStorage,
  formatUkPostcodeForStorage,
} from "@/lib/address/normalize";
import type { AddressLookupProvider } from "@/lib/address/providers/types";
import type {
  AddressResolveResult,
  AddressSuggestResult,
  AddressSuggestion,
} from "@/lib/address/types";

const IDEAL_BASE = "https://api.ideal-postcodes.co.uk/v1";
const PROVIDER_TIMEOUT_MS = 8_000;

type IdealHit = {
  id?: unknown;
  suggestion?: unknown;
};

type IdealSuggestBody = {
  code?: unknown;
  message?: unknown;
  result?: { hits?: IdealHit[] };
};

type IdealResolveBody = {
  code?: unknown;
  message?: unknown;
  result?: {
    line_1?: unknown;
    line_2?: unknown;
    line_3?: unknown;
    post_town?: unknown;
    postcode?: unknown;
  };
};

function getApiKey(): string | null {
  const key = process.env.IDEAL_POSTCODES_API_KEY?.trim();
  return key || null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function idealFetch(
  pathWithQuery: string
): Promise<
  | { ok: true; status: number; json: unknown }
  | { ok: false; error: "provider_timeout" | "provider_unavailable" | "misconfigured" }
> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: "misconfigured" };
  }

  const url = `${IDEAL_BASE}${pathWithQuery}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        // Prefer header auth so the key is less likely to appear in proxy URL logs.
        Authorization: `IDEALPOSTCODES api_key="${apiKey}"`,
      },
      signal: controller.signal,
      cache: "no-store",
    });

    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    return { ok: true, status: response.status, json };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "provider_timeout" };
    }
    // Never log request URLs or bodies — may contain query text / secrets.
    console.error("[address-lookup] provider request failed");
    return { ok: false, error: "provider_unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

function mapProviderHttpFailure(
  status: number
): AddressSuggestResult | AddressResolveResult {
  if (status === 404) {
    return { ok: false, error: "not_found" };
  }
  if (status === 401 || status === 403 || status === 402) {
    // Includes balance / auth failures — treat as unavailable for UX fallback.
    return { ok: false, error: "provider_unavailable" };
  }
  if (status === 429) {
    return { ok: false, error: "rate_limited" };
  }
  return { ok: false, error: "provider_unavailable" };
}

export function createIdealPostcodesProvider(): AddressLookupProvider {
  return {
    name: "ideal_postcodes",

    async suggest(query: string): Promise<AddressSuggestResult> {
      const params = new URLSearchParams({
        q: query,
      });
      const fetched = await idealFetch(
        `/autocomplete/addresses?${params.toString()}`
      );

      if (!fetched.ok) {
        return { ok: false, error: fetched.error };
      }

      if (fetched.status < 200 || fetched.status >= 300) {
        return mapProviderHttpFailure(fetched.status) as AddressSuggestResult;
      }

      const body = fetched.json as IdealSuggestBody;
      const hits = Array.isArray(body?.result?.hits)
        ? body.result!.hits!
        : [];

      const suggestions: AddressSuggestion[] = [];
      for (const hit of hits) {
        const id = asTrimmedString(hit?.id);
        const label = asTrimmedString(hit?.suggestion);
        if (!id || !label) continue;
        // Reject obviously oversized ids (abuse / unexpected payloads).
        if (id.length > 128 || label.length > 300) continue;
        suggestions.push({ id, label });
      }

      return { ok: true, suggestions };
    },

    async resolve(suggestionId: string): Promise<AddressResolveResult> {
      const id = suggestionId.trim();
      if (!id || id.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        return { ok: false, error: "invalid_request" };
      }

      const fetched = await idealFetch(
        `/autocomplete/addresses/${encodeURIComponent(id)}/gbr`
      );

      if (!fetched.ok) {
        return { ok: false, error: fetched.error };
      }

      if (fetched.status < 200 || fetched.status >= 300) {
        return mapProviderHttpFailure(fetched.status) as AddressResolveResult;
      }

      const body = fetched.json as IdealResolveBody;
      const result = body?.result;
      if (!result || typeof result !== "object") {
        return { ok: false, error: "provider_unavailable" };
      }

      const postcodeRaw = asTrimmedString(result.postcode);
      if (!postcodeRaw) {
        return { ok: false, error: "provider_unavailable" };
      }

      const address = formatAddressLinesForStorage({
        line1: asTrimmedString(result.line_1),
        line2: asTrimmedString(result.line_2),
        line3: asTrimmedString(result.line_3),
        postTown: asTrimmedString(result.post_town),
      });

      if (!address) {
        return { ok: false, error: "provider_unavailable" };
      }

      return {
        ok: true,
        address: {
          address,
          postcode: formatUkPostcodeForStorage(postcodeRaw),
        },
      };
    },
  };
}
