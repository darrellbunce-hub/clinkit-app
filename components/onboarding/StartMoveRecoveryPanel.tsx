import Link from "next/link";

import HelpLink from "@/components/help/HelpLink";
import { HELP_SECTION_IDS } from "@/lib/help/helpContent";
import {
  START_MOVE_RECOVERY_COPY,
  START_MOVE_RECOVERY_TITLE,
  type StartMoveRecovery,
} from "@/lib/onboarding/startMoveRecovery";

export default function StartMoveRecoveryPanel({
  recovery,
}: {
  recovery: StartMoveRecovery;
}) {
  return (
    <div role="alert">
      <h2 className="text-2xl font-bold text-slate-900">
        {START_MOVE_RECOVERY_TITLE}
      </h2>

      <div className="mt-4 space-y-3 text-slate-700">
        {START_MOVE_RECOVERY_COPY[recovery.reason].map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <p>
          For what to do next, see{" "}
          <HelpLink section={HELP_SECTION_IDS.somethingWentWrong} />.
        </p>
      </div>

      <Link
        href={`/chain/${recovery.chainId}`}
        className="mt-8 block w-full bg-slate-900 text-white rounded-2xl py-5 text-center text-lg font-semibold"
      >
        Open your chain
      </Link>
    </div>
  );
}
