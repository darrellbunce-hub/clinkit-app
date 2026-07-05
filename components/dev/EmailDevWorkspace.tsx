"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { EMAIL_SAMPLE_DATA } from "@/lib/communications/sampleData";
import type {
  EmailTemplateDefinition,
  EmailTemplateId,
} from "@/lib/communications/types";
import { isEmailTemplateId } from "@/lib/communications/templateRegistry";

type PreviewFormat = "preview" | "html-source" | "text";
type PreviewBackground = "light" | "dark";
type PreviewWidth = "desktop" | "mobile";

type EmailDevWorkspaceProps = {
  initialTemplateId?: string;
  availableTemplates: EmailTemplateDefinition[];
  futureTemplates: EmailTemplateDefinition[];
  emailSendingEnabled: boolean;
};

type RenderResponse = {
  subject: string;
  content: string;
  format: string;
};

const PREVIEW_WIDTHS: Record<PreviewWidth, number> = {
  desktop: 680,
  mobile: 390,
};

export default function EmailDevWorkspace({
  initialTemplateId,
  availableTemplates,
  futureTemplates,
  emailSendingEnabled,
}: EmailDevWorkspaceProps) {
  const defaultTemplateId =
    initialTemplateId &&
    isEmailTemplateId(initialTemplateId)
      ? initialTemplateId
      : availableTemplates[0]?.id;

  const [selectedTemplateId, setSelectedTemplateId] =
    useState<EmailTemplateId | undefined>(
      defaultTemplateId as EmailTemplateId | undefined
    );
  const [previewBackground, setPreviewBackground] =
    useState<PreviewBackground>("light");
  const [previewWidth, setPreviewWidth] =
    useState<PreviewWidth>("desktop");
  const [previewFormat, setPreviewFormat] =
    useState<PreviewFormat>("preview");
  const [renderedEmail, setRenderedEmail] =
    useState<RenderResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [loadError, setLoadError] = useState("");

  const loadRenderedEmail = useCallback(async () => {
    if (!selectedTemplateId) {
      return;
    }

    setIsLoading(true);
    setLoadError("");

    const formatParam =
      previewFormat === "preview"
        ? "html"
        : previewFormat;

    try {
      const response = await fetch(
        `/api/dev/emails/render?template=${selectedTemplateId}&format=${formatParam}`
      );

      if (!response.ok) {
        throw new Error("Could not render the selected template.");
      }

      const payload = (await response.json()) as RenderResponse;
      setRenderedEmail(payload);
    } catch (error) {
      setRenderedEmail(null);
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not render the selected template."
      );
    } finally {
      setIsLoading(false);
    }
  }, [previewFormat, selectedTemplateId]);

  useEffect(() => {
    void loadRenderedEmail();
  }, [loadRenderedEmail]);

  async function handleCopyInvitationUrl() {
    try {
      await navigator.clipboard.writeText(
        EMAIL_SAMPLE_DATA.invitationLink
      );
      setCopyMessage("Sample invitation URL copied.");
    } catch {
      setCopyMessage("Could not copy the sample invitation URL.");
    }
  }

  async function handleCopyRenderedContent() {
    if (!renderedEmail?.content) {
      return;
    }

    try {
      await navigator.clipboard.writeText(renderedEmail.content);
      setCopyMessage(
        previewFormat === "text"
          ? "Plain text copied."
          : "HTML source copied."
      );
    } catch {
      setCopyMessage("Could not copy rendered content.");
    }
  }

  const previewCanvasBackground =
    previewBackground === "light" ? "#F3F5F6" : "#1F2933";

  return (
    <main className="min-h-screen bg-surface-stone px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-primary">
              Developer workspace
            </p>
            <h1 className="mt-2 text-3xl font-bold text-text-charcoal">
              Email Development Workspace
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-text-muted">
              Preview Keynetic transactional email templates with shared sample
              data. This page never sends email.
            </p>
          </div>

          <div className="rounded-xl bg-surface-card px-4 py-3 ring-1 ring-surface-card-border">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Sending status
            </p>
            <p className="mt-1 text-sm font-medium text-text-charcoal">
              {emailSendingEnabled
                ? "Resend configured"
                : "Real sending disabled"}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Set{" "}
              <code className="rounded bg-surface-mist px-1 py-0.5">
                EMAIL_SENDING_ENABLED=false
              </code>{" "}
              to force copy-link fallback during development.
            </p>
          </div>
        </div>

        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
            Transactional templates
          </h2>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {availableTemplates.map((template) => {
              const isSelected = template.id === selectedTemplateId;

              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() =>
                    setSelectedTemplateId(template.id as EmailTemplateId)
                  }
                  className={`rounded-2xl border px-4 py-4 text-left transition ${
                    isSelected
                      ? "border-brand-primary bg-surface-mist ring-2 ring-brand-primary/20"
                      : "border-surface-card-border bg-surface-card hover:border-brand-primary/40"
                  }`}
                >
                  <p className="text-base font-semibold text-text-charcoal">
                    {template.title}
                  </p>
                  <p className="mt-2 text-sm text-text-muted">
                    {template.description}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mb-8 rounded-2xl bg-surface-card p-4 ring-1 ring-surface-card-border sm:p-5">
          <div className="flex flex-wrap gap-3">
            <ToggleGroup
              label="Background"
              value={previewBackground}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              onChange={(value) =>
                setPreviewBackground(value as PreviewBackground)
              }
            />

            <ToggleGroup
              label="Width"
              value={previewWidth}
              options={[
                { value: "desktop", label: "Desktop" },
                { value: "mobile", label: "Mobile" },
              ]}
              onChange={(value) =>
                setPreviewWidth(value as PreviewWidth)
              }
            />

            <ToggleGroup
              label="View"
              value={previewFormat}
              options={[
                { value: "preview", label: "Preview" },
                { value: "html-source", label: "HTML source" },
                { value: "text", label: "Plain text" },
              ]}
              onChange={(value) =>
                setPreviewFormat(value as PreviewFormat)
              }
            />

            <button
              type="button"
              onClick={() => void handleCopyInvitationUrl()}
              className="rounded-lg border border-brand-primary px-3 py-2 text-sm font-medium text-brand-primary"
            >
              Copy invitation URL
            </button>

            {previewFormat !== "preview" ? (
              <button
                type="button"
                onClick={() => void handleCopyRenderedContent()}
                className="rounded-lg border border-brand-primary px-3 py-2 text-sm font-medium text-brand-primary"
              >
                Copy rendered content
              </button>
            ) : null}
          </div>

          {copyMessage ? (
            <p className="mt-3 text-sm text-green-700">{copyMessage}</p>
          ) : null}
        </section>

        <section className="rounded-2xl bg-surface-card p-4 ring-1 ring-surface-card-border sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                Preview
              </p>
              <h2 className="mt-1 text-xl font-semibold text-text-charcoal">
                {availableTemplates.find(
                  (template) => template.id === selectedTemplateId
                )?.title ?? "Email template"}
              </h2>
              {renderedEmail?.subject ? (
                <p className="mt-1 text-sm text-text-muted">
                  Subject: {renderedEmail.subject}
                </p>
              ) : null}
            </div>

            {selectedTemplateId === "homeowner-invitation" ? (
              <Link
                href="/dev/emails?template=homeowner-invitation"
                className="text-sm font-medium text-brand-primary underline"
              >
                Direct link to this template
              </Link>
            ) : null}
          </div>

          {isLoading ? (
            <p className="text-sm text-text-muted">Rendering template...</p>
          ) : null}

          {loadError ? (
            <p className="text-sm text-red-700">{loadError}</p>
          ) : null}

          {!isLoading && renderedEmail && previewFormat === "preview" ? (
            <div
              className="overflow-auto rounded-xl p-6"
              style={{ backgroundColor: previewCanvasBackground }}
            >
              <div
                className="mx-auto transition-all"
                style={{ maxWidth: PREVIEW_WIDTHS[previewWidth] }}
              >
                <iframe
                  title="Email preview"
                  srcDoc={renderedEmail.content}
                  className="w-full rounded-lg bg-white shadow-lg"
                  style={{ minHeight: 720, border: 0 }}
                />
              </div>
            </div>
          ) : null}

          {!isLoading && renderedEmail && previewFormat !== "preview" ? (
            <pre className="max-h-[720px] overflow-auto rounded-xl bg-surface-stone p-4 text-xs leading-6 text-text-charcoal">
              {renderedEmail.content}
            </pre>
          ) : null}
        </section>

        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
            Future templates
          </h2>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {futureTemplates.map((template) => (
              <div
                key={template.id}
                className="rounded-2xl border border-dashed border-surface-card-border bg-surface-card/70 px-4 py-4 opacity-80"
              >
                <p className="text-base font-semibold text-text-charcoal">
                  {template.title}
                </p>
                <p className="mt-2 text-sm text-text-muted">
                  {template.description}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function ToggleGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="rounded-lg border border-surface-card-border px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-md px-2.5 py-1 text-sm font-medium ${
              value === option.value
                ? "bg-brand-primary text-white"
                : "bg-surface-mist text-text-charcoal"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
