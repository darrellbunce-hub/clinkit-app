"use client";

import {
  useEffect,
  useState,
} from "react";

import type { EaBranchDirectoryEntry } from "@/lib/estateAgent/assignmentTypes";
import {
  assignPropertyToBranch,
  EA_BRANCH_DIRECTORY_MIN_QUERY_LENGTH,
  EA_BRANCH_DIRECTORY_SEARCH_LIMIT,
  loadAssignmentWithBranchDirectory,
  searchEaBranchDirectory,
  updatePropertyEaDelegation,
} from "@/lib/estateAgent/assignments";
import {
  BRANCH_ACCESS_ENDED_NOTICE,
  loadBranchAccessEndedNotice,
} from "@/lib/estateAgent/branchAccessNotice";
import { getAgentAssignmentAccessLabel } from "@/lib/estateAgent/delegatedUpdates";
import { supabase } from "@/lib/supabase";

const inputClassName =
  "w-full border border-slate-300 rounded-2xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300";

const MIN_SEARCH_LENGTH =
  EA_BRANCH_DIRECTORY_MIN_QUERY_LENGTH;

const SEARCH_DEBOUNCE_MS = 250;

type SearchState = {
  query: string;
  branches: EaBranchDirectoryEntry[];
  error: string | null;
};

export default function PropertyEstateAgentAssignment({
  propertyId,
}: {
  propertyId: number;
}) {
  const [searchQuery, setSearchQuery] =
    useState("");
  const [searchState, setSearchState] =
    useState<SearchState | null>(null);
  const [selectedBranch, setSelectedBranch] =
    useState<EaBranchDirectoryEntry | null>(
      null
    );
  const [
    homeownerOnlyUpdates,
    setHomeownerOnlyUpdates,
  ] = useState(true);
  const [currentAssignmentId, setCurrentAssignmentId] =
    useState<string | null>(null);
  const [errorMessage, setErrorMessage] =
    useState("");
  const [successMessage, setSuccessMessage] =
    useState("");
  const [isSaving, setIsSaving] =
    useState(false);
  const [isLoading, setIsLoading] =
    useState(true);
  const [branchAccessEnded, setBranchAccessEnded] =
    useState(false);

  useEffect(() => {
    async function loadExistingAssignment() {
      const { assignment, branch } =
        await loadAssignmentWithBranchDirectory(
          supabase,
          propertyId
        );

      if (assignment) {
        setCurrentAssignmentId(assignment.id);
        setHomeownerOnlyUpdates(
          assignment.homeowner_only_updates
        );

        if (branch) {
          setSelectedBranch(branch);
        }
      } else {
        setBranchAccessEnded(
          await loadBranchAccessEndedNotice(
            supabase,
            propertyId
          )
        );
      }

      setIsLoading(false);
    }

    loadExistingAssignment();
  }, [propertyId]);

  const trimmedSearchQuery = searchQuery.trim();

  const showSearchPrompt =
    trimmedSearchQuery.length <
    MIN_SEARCH_LENGTH;

  useEffect(() => {
    if (showSearchPrompt) {
      return;
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      const result =
        await searchEaBranchDirectory(
          supabase,
          trimmedSearchQuery
        );

      if (!cancelled) {
        setSearchState({
          query: trimmedSearchQuery,
          branches: result.branches,
          error: result.error,
        });
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showSearchPrompt, trimmedSearchQuery]);

  const currentSearch =
    searchState?.query === trimmedSearchQuery
      ? searchState
      : null;

  const isSearching =
    !showSearchPrompt && currentSearch === null;

  const matchingBranches =
    currentSearch?.branches ?? [];

  const searchError =
    currentSearch?.error ?? null;

  function handleSelectBranch(
    branch: EaBranchDirectoryEntry
  ) {
    setSelectedBranch(branch);
    setSearchQuery("");
    setErrorMessage("");
    setSuccessMessage("");
  }

  async function handleAssign() {
    setErrorMessage("");
    setSuccessMessage("");

    if (!selectedBranch) {
      setErrorMessage(
        "Select a registered estate agent branch from the search results."
      );

      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setErrorMessage(
        "You must be logged in to assign an estate agent."
      );

      return;
    }

    setIsSaving(true);

    try {
      const result =
        await assignPropertyToBranch(
          supabase,
          {
            propertyId,
            branchId: selectedBranch.branch_id,
            homeownerOnlyUpdates,
          }
        );

      if (result.error) {
        setErrorMessage(result.error);

        return;
      }

      const { assignment } =
        await loadAssignmentWithBranchDirectory(
          supabase,
          propertyId
        );

      if (assignment) {
        setCurrentAssignmentId(assignment.id);
      }

      setSuccessMessage(
        "Estate agent branch assigned to this property."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelegationToggle(
    checked: boolean
  ) {
    setHomeownerOnlyUpdates(checked);
    setErrorMessage("");
    setSuccessMessage("");

    if (!currentAssignmentId) {
      return;
    }

    setIsSaving(true);

    try {
      const result =
        await updatePropertyEaDelegation(
          supabase,
          propertyId,
          checked
        );

      if (result.error) {
        setErrorMessage(result.error);
        setHomeownerOnlyUpdates(!checked);

        return;
      }

      setSuccessMessage(
        checked
          ? "Only you can update this property."
          : "Your estate agent may also post updates."
      );
    } finally {
      setIsSaving(false);
    }
  }

  const accessLabel =
    getAgentAssignmentAccessLabel(
      currentAssignmentId
        ? {
            status: "active",
            homeowner_only_updates:
              homeownerOnlyUpdates,
          }
        : null
    );

  if (isLoading) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-600">
        Loading estate agent assignment...
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-8">
      <h2 className="text-2xl font-bold text-slate-900">
        Estate Agent
      </h2>

      <p className="mt-2 text-slate-500">
        Search registered estate agent branches and select
        one to assign to this property. Assignments are
        property-specific, not chain-wide.
      </p>

      {!currentAssignmentId && branchAccessEnded && (
        <div
          role="status"
          className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
        >
          <p className="font-semibold text-slate-900">
            {BRANCH_ACCESS_ENDED_NOTICE.title}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {BRANCH_ACCESS_ENDED_NOTICE.body}
          </p>
        </div>
      )}

      {selectedBranch && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-sm font-medium text-slate-500">
            {currentAssignmentId
              ? "Assigned branch"
              : "Selected branch"}
          </p>

          <p className="mt-2 font-semibold text-slate-900">
            {selectedBranch.company_name} ·{" "}
            {selectedBranch.branch_name} ·{" "}
            {selectedBranch.town_or_city}
          </p>

          <p className="mt-1 text-sm text-slate-600">
            {selectedBranch.postcode}
          </p>

          {currentAssignmentId && (
            <p className="mt-2 text-sm text-slate-600">
              Agent access:{" "}
              {accessLabel === "delegated_updates"
                ? "View and delegated updates"
                : "View only"}
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setSelectedBranch(null);
              setSearchQuery("");
            }}
            className="mt-4 text-sm font-semibold text-slate-700 underline"
          >
            Change branch
          </button>
        </div>
      )}

      {!selectedBranch && (
        <div className="mt-6 space-y-3">
          <label
            htmlFor={`ea-search-${propertyId}`}
            className="block text-sm font-medium text-slate-700"
          >
            Search registered branches
          </label>

          <input
            id={`ea-search-${propertyId}`}
            type="search"
            value={searchQuery}
            onChange={(event) =>
              setSearchQuery(
                event.target.value
              )
            }
            placeholder="Search by company, branch, or town"
            className={inputClassName}
            autoComplete="off"
          />

          {showSearchPrompt ? (
            <p className="text-sm text-slate-500">
              Type at least {MIN_SEARCH_LENGTH}{" "}
              characters to search registered estate
              agent branches.
            </p>
          ) : isSearching ? (
            <p className="text-sm text-slate-500">
              Searching registered branches...
            </p>
          ) : searchError ? (
            <p
              role="alert"
              className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
            >
              Could not search registered branches:{" "}
              {searchError}
            </p>
          ) : matchingBranches.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              No registered branches match your search.
            </p>
          ) : (
            <>
              <ul
                className="max-h-64 overflow-y-auto rounded-2xl border border-slate-200 divide-y divide-slate-100"
                role="listbox"
                aria-label="Matching estate agent branches"
              >
                {matchingBranches.map((branch) => (
                  <li key={branch.branch_id}>
                    <button
                      type="button"
                      role="option"
                      onClick={() =>
                        handleSelectBranch(branch)
                      }
                      className="w-full px-4 py-4 text-left hover:bg-slate-50 transition"
                    >
                      <p className="font-semibold text-slate-900">
                        {branch.company_name}
                      </p>

                      <p className="mt-1 text-sm text-slate-700">
                        {branch.branch_name} ·{" "}
                        {branch.town_or_city},{" "}
                        {branch.postcode}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>

              {matchingBranches.length >=
                EA_BRANCH_DIRECTORY_SEARCH_LIMIT && (
                <p className="text-sm text-slate-500">
                  Showing the first{" "}
                  {EA_BRANCH_DIRECTORY_SEARCH_LIMIT}{" "}
                  matches. Add a town or postcode to
                  narrow your search.
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={homeownerOnlyUpdates}
            onChange={(event) => {
              const checked =
                event.target.checked;

              if (currentAssignmentId) {
                void handleDelegationToggle(
                  checked
                );

                return;
              }

              setHomeownerOnlyUpdates(checked);
            }}
            disabled={isSaving}
            className="mt-1"
          />

          <span className="text-sm text-slate-700">
            Only I can update my transaction
          </span>
        </label>

        <p className="mt-3 text-xs text-slate-500">
          Checked by default. Uncheck only if you want
          your assigned estate agent to post updates on
          your behalf. All updates remain fully auditable.
        </p>
      </div>

      {errorMessage && (
        <p
          role="alert"
          className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          {errorMessage}
        </p>
      )}

      {successMessage && (
        <p className="mt-4 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          {successMessage}
        </p>
      )}

      <button
        type="button"
        onClick={handleAssign}
        disabled={
          isSaving || !selectedBranch
        }
        className="mt-6 w-full bg-slate-900 text-white rounded-2xl py-4 font-semibold hover:bg-slate-800 disabled:bg-slate-400"
      >
        {isSaving
          ? "Saving..."
          : currentAssignmentId
            ? "Update assignment"
            : "Assign estate agent"}
      </button>
    </div>
  );
}
