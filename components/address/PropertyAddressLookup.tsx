"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  ADDRESS_LOOKUP_DEBOUNCE_MS,
  ADDRESS_LOOKUP_MIN_QUERY_LENGTH,
  type AddressSuggestion,
} from "@/lib/address/types";
import { formatUkPostcodeForStorage } from "@/lib/address/normalize";

type PropertyAddressLookupProps = {
  address: string;
  postcode: string;
  onAddressChange: (address: string) => void;
  onPostcodeChange: (postcode: string) => void;
  label?: string;
  /** Optional id prefix for a11y when multiple instances appear on one page. */
  idPrefix?: string;
  className?: string;
};

type SuggestResponse =
  | { ok: true; suggestions: AddressSuggestion[] }
  | { ok: false; error?: string };

type ResolveResponse =
  | { ok: true; address: string; postcode: string }
  | { ok: false; error?: string };

const FALLBACK_MESSAGE =
  "Address lookup is temporarily unavailable. You can enter your address manually.";

const MANUAL_ENTRY_MATCH_WARNING =
  "Important: If you enter your address manually, those details must match exactly when someone else joins your property chain.";

const MANUAL_ENTRY_MATCH_TIP =
  "Tip: Note exactly how you entered the address and postcode, and share those details with your estate agent or solicitor so other parties can use the same wording.";

export default function PropertyAddressLookup({
  address,
  postcode,
  onAddressChange,
  onPostcodeChange,
  label = "Property address",
  idPrefix,
  className = "",
}: PropertyAddressLookupProps) {
  const reactId = useId();
  const prefix = idPrefix ?? `addr-${reactId}`;
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [manualMode, setManualMode] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const lastResolvedId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (manualMode) return;
    if (selectedLabel) return;

    const trimmed = query.trim();
    if (trimmed.length < ADDRESS_LOOKUP_MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setIsSuggesting(false);
      return;
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsSuggesting(true);
      setStatusMessage(null);

      try {
        const response = await fetch("/api/address/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed }),
          signal: controller.signal,
        });
        const data = (await response.json()) as SuggestResponse;

        if (!response.ok || !data.ok) {
          setSuggestions([]);
          if (response.status === 401) {
            setStatusMessage("Please sign in to use address lookup.");
          } else if (
            data.ok === false &&
            (data.error === "provider_unavailable" || response.status >= 500)
          ) {
            setStatusMessage(FALLBACK_MESSAGE);
            setManualMode(true);
          } else if (data.ok === false && data.error === "rate_limited") {
            setStatusMessage(
              "Too many address searches. Please wait a moment, or enter the address manually."
            );
          } else {
            setStatusMessage(null);
          }
          return;
        }

        setSuggestions(data.suggestions);
        if (data.suggestions.length === 0) {
          setStatusMessage(
            "No matching addresses found. Try a different postcode, or enter the address manually."
          );
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setSuggestions([]);
        setStatusMessage(FALLBACK_MESSAGE);
        setManualMode(true);
      } finally {
        setIsSuggesting(false);
      }
    }, ADDRESS_LOOKUP_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [query, manualMode, selectedLabel]);

  async function handleSelect(suggestion: AddressSuggestion) {
    if (lastResolvedId.current === suggestion.id && address && postcode) {
      setSelectedLabel(suggestion.label);
      setSuggestions([]);
      setQuery(suggestion.label);
      return;
    }

    setIsResolving(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/address/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: suggestion.id }),
      });
      const data = (await response.json()) as ResolveResponse;

      if (!response.ok || !data.ok) {
        setStatusMessage(FALLBACK_MESSAGE);
        setManualMode(true);
        return;
      }

      lastResolvedId.current = suggestion.id;
      setSelectedLabel(suggestion.label);
      setQuery(suggestion.label);
      setSuggestions([]);
      onAddressChange(data.address);
      onPostcodeChange(formatUkPostcodeForStorage(data.postcode));
    } catch {
      setStatusMessage(FALLBACK_MESSAGE);
      setManualMode(true);
    } finally {
      setIsResolving(false);
    }
  }

  function enableManual() {
    setManualMode(true);
    setSuggestions([]);
    setStatusMessage(null);
    setSelectedLabel(null);
  }

  function enableLookup() {
    setManualMode(false);
    setStatusMessage(null);
    setQuery("");
    setSuggestions([]);
    setSelectedLabel(null);
    lastResolvedId.current = null;
  }

  return (
    <div className={className}>
      <label
        htmlFor={`${prefix}-query`}
        className="block text-sm font-medium text-slate-900"
      >
        {label}
      </label>

      {!manualMode ? (
        <div className="relative mt-2">
          <input
            id={`${prefix}-query`}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            disabled={isResolving}
            onChange={(event) => {
              setSelectedLabel(null);
              lastResolvedId.current = null;
              setQuery(event.target.value);
              if (address || postcode) {
                onAddressChange("");
                onPostcodeChange("");
              }
            }}
            onBlur={() => {
              if (typeof window !== "undefined") {
                window.scrollTo(0, 0);
              }
            }}
            placeholder="Start typing your postcode or address"
            className="w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-4"
          />

          {(isSuggesting || isResolving) && (
            <p className="mt-2 text-sm text-slate-500" aria-live="polite">
              {isResolving ? "Confirming address…" : "Searching…"}
            </p>
          )}

          {suggestions.length > 0 && (
            <ul
              role="listbox"
              aria-label="Address suggestions"
              className="mt-2 max-h-60 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              {suggestions.map((suggestion) => (
                <li key={suggestion.id}>
                  <button
                    type="button"
                    role="option"
                    className="w-full min-h-11 px-4 py-3 text-left text-sm text-slate-800 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-400"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void handleSelect(suggestion)}
                  >
                    {suggestion.label}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {(address || postcode) && selectedLabel ? (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">{address}</p>
              <p className="mt-1">{postcode}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 space-y-4">
          <div
            role="note"
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          >
            <p className="font-medium leading-snug">
              {MANUAL_ENTRY_MATCH_WARNING}
            </p>
            <p className="mt-2 leading-snug text-amber-900/90">
              {MANUAL_ENTRY_MATCH_TIP}
            </p>
          </div>
          <input
            id={`${prefix}-address`}
            type="text"
            autoComplete="street-address"
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
            onBlur={() => {
              if (typeof window !== "undefined") {
                window.scrollTo(0, 0);
              }
            }}
            placeholder="Property address"
            className="w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-4"
          />
          <input
            id={`${prefix}-postcode`}
            type="text"
            autoComplete="postal-code"
            value={postcode}
            onChange={(event) => onPostcodeChange(event.target.value)}
            onBlur={(event) => {
              const formatted = formatUkPostcodeForStorage(event.target.value);
              if (formatted !== event.target.value) {
                onPostcodeChange(formatted);
              }
              if (typeof window !== "undefined") {
                window.scrollTo(0, 0);
              }
            }}
            placeholder="Postcode"
            className="w-full border border-slate-300 text-base text-slate-900 rounded-2xl px-4 py-4"
          />
        </div>
      )}

      {statusMessage ? (
        <p className="mt-2 text-sm text-slate-600" role="status">
          {statusMessage}
        </p>
      ) : null}

      <div className="mt-3">
        {!manualMode ? (
          <button
            type="button"
            onClick={enableManual}
            className="text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
          >
            Can&apos;t find your address? Enter it manually
          </button>
        ) : (
          <button
            type="button"
            onClick={enableLookup}
            className="text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
          >
            Search for address instead
          </button>
        )}
      </div>
    </div>
  );
}
