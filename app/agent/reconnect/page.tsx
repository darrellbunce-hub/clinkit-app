"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AgentShell from "@/components/agent/AgentShell";
import {
  CARD_PADDING_CLASS,
  PAGE_TITLE_CLASS,
} from "@/components/mobileStandards";
import { ROUTES } from "@/lib/auth/routes";
import {
  listReconnectableProperties,
  reconnectReturningBranch,
  type ListReconnectablePropertiesResult,
  type ReconnectableProperty,
} from "@/lib/estateAgent/reconnectReturningBranch";
import {
  BTN_PRIMARY_SM_CLASS,
  FONT_HEADING_CLASS,
  SURFACE_PANEL_HOVER_CLASS,
} from "@/lib/theme/themeTokens";
import { supabase } from "@/lib/supabase";

function reconnectKey(item: ReconnectableProperty): string {
  return `${item.propertyId}:${item.branchId}`;
}

function formatEndedAt(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function AgentReconnectPage() {
  const [items, setItems] =
    useState<ReconnectableProperty[]>([]);
  const [isLoading, setIsLoading] =
    useState(true);
  const [loadError, setLoadError] =
    useState("");
  const [pendingKey, setPendingKey] =
    useState<string | null>(null);
  const [actionError, setActionError] =
    useState("");
  const [reconnectedPropertyId, setReconnectedPropertyId] =
    useState<number | null>(null);

  function applyList(
    result: ListReconnectablePropertiesResult
  ) {
    if (result.ok) {
      setItems(result.properties);
      setLoadError("");
    } else {
      setItems([]);
      setLoadError(result.error);
    }

    setIsLoading(false);
  }

  async function reload() {
    applyList(
      await listReconnectableProperties(supabase)
    );
  }

  useEffect(() => {
    let cancelled = false;

    void listReconnectableProperties(supabase).then(
      (result) => {
        if (!cancelled) {
          applyList(result);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleReconnect(
    item: ReconnectableProperty
  ) {
    setPendingKey(reconnectKey(item));
    setReconnectedPropertyId(null);
    setActionError("");

    const result = await reconnectReturningBranch(
      supabase,
      {
        propertyId: item.propertyId,
        branchId: item.branchId,
      }
    );

    setPendingKey(null);

    if (!result.ok) {
      setActionError(result.error);
      await reload();
      return;
    }

    setReconnectedPropertyId(item.propertyId);
    await reload();
  }

  return (
    <AgentShell>
      <section className="max-w-3xl mx-auto px-6 py-12">
        <div className="space-y-8">
          <div>
            <Link
              href={ROUTES.agentHome}
              className={`text-sm font-medium text-slate-600 ${SURFACE_PANEL_HOVER_CLASS}`}
            >
              ← Back to command centre
            </Link>

            <h1
              className={`mt-4 ${PAGE_TITLE_CLASS} ${FONT_HEADING_CLASS} text-text-charcoal`}
            >
              Reconnect to a property
            </h1>

            <p className="mt-3 text-slate-600">
              Your branch represented these sellers until
              the homeowner left MoveLoop. While no one else
              represents the seller, your branch can
              reconnect and continue managing the
              transaction.
            </p>
          </div>

          {reconnectedPropertyId != null ? (
            <p className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              Your branch is reconnected.{" "}
              <Link
                href={`/property/${reconnectedPropertyId}`}
                className="font-semibold underline"
              >
                Open the property
              </Link>
            </p>
          ) : null}

          {actionError ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {actionError}
            </p>
          ) : null}

          {isLoading ? (
            <div className="rounded-2xl bg-surface-card p-10 text-center text-text-muted shadow-sm ring-1 ring-surface-card-border">
              Loading...
            </div>
          ) : loadError ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {loadError}
            </p>
          ) : items.length === 0 ? (
            <div
              className={`rounded-2xl bg-surface-card text-text-muted shadow-sm ring-1 ring-surface-card-border ${CARD_PADDING_CLASS}`}
            >
              There are no properties your branch can
              reconnect to.
            </div>
          ) : (
            <ul className="space-y-4">
              {items.map((item) => {
                const key = reconnectKey(item);
                const endedAt = formatEndedAt(
                  item.assignmentEndedAt
                );

                return (
                  <li
                    key={key}
                    className={`rounded-2xl bg-surface-card shadow-sm ring-1 ring-surface-card-border ${CARD_PADDING_CLASS}`}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-text-charcoal">
                          {item.address}
                        </p>

                        <p className="mt-1 text-sm text-text-muted">
                          {item.postcode}
                          {item.branchName
                            ? ` · ${item.branchName}`
                            : ""}
                          {endedAt
                            ? ` · Disconnected ${endedAt}`
                            : ""}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={pendingKey !== null}
                        onClick={() =>
                          void handleReconnect(item)
                        }
                        className={`inline-flex shrink-0 items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${BTN_PRIMARY_SM_CLASS}`}
                      >
                        {pendingKey === key
                          ? "Reconnecting..."
                          : "Reconnect"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </AgentShell>
  );
}
