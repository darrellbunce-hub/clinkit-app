import type { PrivacyImpactAssessmentView } from "@/lib/privacyAdmin/types";
import { CARD_CLASS } from "@/lib/theme/themeTokens";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${CARD_CLASS} space-y-3`}>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

function KeyValueList({
  items,
}: {
  items: Array<{ label: string; value: string | number | boolean }>;
}) {
  return (
    <dl className="grid gap-2 text-sm md:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl bg-surface-inset px-4 py-3">
          <dt className="text-slate-500">{item.label}</dt>
          <dd className="mt-1 font-medium text-slate-900">{String(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function PrivacyImpactReportPanel({
  assessment,
}: {
  assessment: PrivacyImpactAssessmentView | null;
}) {
  if (!assessment) {
    return (
      <section className={CARD_CLASS}>
        <p className="text-sm text-slate-600">
          Impact assessment not available yet. Generate scope assessment to review proposed treatment.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {assessment.riskFlags.length > 0 ? (
        <section className={`${CARD_CLASS} border-amber-200 bg-amber-50`}>
          <h3 className="text-base font-semibold text-amber-950">Risk flags</h3>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-950">
            {assessment.riskFlags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <Section title="Account">
        <KeyValueList
          items={[
            { label: "Account exists", value: assessment.account.accountExists },
            { label: "Account type", value: assessment.account.accountType ?? "unknown" },
            { label: "Email verified", value: assessment.account.emailVerified },
          ]}
        />
      </Section>

      <Section title="Property relationships">
        <KeyValueList
          items={[
            { label: "Properties", value: assessment.propertyRelationships.totalProperties },
            {
              label: "Sole-participant properties",
              value: assessment.propertyRelationships.soleParticipantCount,
            },
            {
              label: "Shared dependencies",
              value: assessment.propertyRelationships.sharedDependencyCount,
            },
          ]}
        />
        {assessment.propertyRelationships.propertySummaries.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-2 py-2">Property ID</th>
                  <th className="px-2 py-2">Chain ID</th>
                  <th className="px-2 py-2">Roles</th>
                  <th className="px-2 py-2">Address treatment</th>
                  <th className="px-2 py-2">Shared score</th>
                </tr>
              </thead>
              <tbody>
                {assessment.propertyRelationships.propertySummaries.map((property) => (
                  <tr key={property.propertyId} className="border-t border-surface-divider">
                    <td className="px-2 py-2 font-mono">{property.propertyId}</td>
                    <td className="px-2 py-2 font-mono">{property.chainId ?? "—"}</td>
                    <td className="px-2 py-2">{property.roles.join(", ") || "—"}</td>
                    <td className="px-2 py-2">{property.addressTreatment}</td>
                    <td className="px-2 py-2">{property.sharedDependencyScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      <Section title="Communications">
        <KeyValueList
          items={[
            {
              label: "Communication records requiring treatment",
              value: assessment.communications.emailEventsCount,
            },
            {
              label: "Resend review required",
              value: assessment.communications.resendReviewRequired,
            },
          ]}
        />
      </Section>

      <Section title="Estate agent relationships">
        <pre className="overflow-x-auto rounded-2xl bg-surface-inset p-4 text-xs text-slate-700">
          {JSON.stringify(assessment.estateAgentRelationships, null, 2)}
        </pre>
      </Section>

      <Section title="Analytics">
        <KeyValueList
          items={[
            { label: "Linked snapshots", value: assessment.analytics.linkedSnapshots },
            {
              label: "Re-identification review required",
              value: assessment.analytics.reidentificationReviewRequired,
            },
          ]}
        />
      </Section>

      <Section title="Unknown / unstructured data">
        <KeyValueList
          items={[
            { label: "JSONB review required", value: assessment.unknownUnstructured.jsonbReviewRequired },
            {
              label: "Activity/free-text review required",
              value: assessment.unknownUnstructured.activityReviewRequired,
            },
          ]}
        />
      </Section>

      <Section title="Proposed erasure plan">
        <PlanGroup
          title="Automatic database actions"
          actions={assessment.proposedPlan.automaticDatabaseActions}
        />
        <PlanGroup
          title="Manual review required"
          actions={assessment.proposedPlan.manualReviewRequired}
        />
        <ProcessorGroup processors={assessment.proposedPlan.externalProcessorActions} />
        <PlanGroup
          title="Auth deletion — last"
          actions={assessment.proposedPlan.authDeletionLast}
        />
        <p className="text-sm text-slate-600">
          Approval records the proposed plan but fresh scope validation still runs immediately before execution.
        </p>
      </Section>
    </div>
  );
}

function PlanGroup({
  title,
  actions,
}: {
  title: string;
  actions: Array<{
    actionType: string;
    status: string;
    reasonCode: string;
    propertyId: number | null;
  }>;
}) {
  return (
    <div className="rounded-2xl bg-surface-inset p-4">
      <h4 className="font-medium text-slate-900">{title}</h4>
      {actions.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">None</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {actions.map((action) => (
            <li key={`${action.actionType}-${action.propertyId ?? "global"}`} className="rounded-xl bg-white px-3 py-2">
              <p className="font-medium text-slate-900">{action.actionType}</p>
              <p className="text-slate-600">
                Status: {action.status} · Reason: {action.reasonCode}
                {action.propertyId ? ` · Property ${action.propertyId}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProcessorGroup({
  processors,
}: {
  processors: Array<{
    processor: string;
    actionType: string;
    status: string;
    required: boolean;
  }>;
}) {
  return (
    <div className="rounded-2xl bg-surface-inset p-4">
      <h4 className="font-medium text-slate-900">External processor actions</h4>
      {processors.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">None recorded yet</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {processors.map((processor) => (
            <li key={processor.processor} className="rounded-xl bg-white px-3 py-2">
              <p className="font-medium text-slate-900">{processor.processor}</p>
              <p className="text-slate-600">
                {processor.actionType} · {processor.status}
                {processor.required ? " · required" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
