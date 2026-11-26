/**
 * Static Batch 6 checks: disconnect confirmation, status update result
 * handling, and leave-vs-disconnect presentation.
 *
 *   npx tsx scripts/verify-property-transaction-safety-batch6.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

function read(rel: string) {
  return readFileSync(resolve(root, rel), "utf8");
}

let failed = 0;

function check(label: string, ok: boolean) {
  if (ok) {
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}

const propertyPage = read("app/property/[propertyId]/page.tsx");
const chainContext = read("context/ChainContext.tsx");
const modal = read("components/chain/DisconnectChainConfirmModal.tsx");
const delinkPresentation = read(
  "lib/ownership/participationDelinkPresentation.ts"
);
const delinkPanel = read(
  "components/participation/ParticipationDelinkPanel.tsx"
);
const permissions = read("lib/propertyPermissions.ts");

check(
  "PropertyMutationResult type exists",
  permissions.includes("export type PropertyMutationResult")
);

check(
  "updatePropertyStage returns PropertyMutationResult",
  /updatePropertyStage\([\s\S]*?\): Promise<PropertyMutationResult>/.test(
    chainContext
  ) &&
    chainContext.includes("return { ok: true }") &&
    !/async function updatePropertyStage[\s\S]*?alert\(/.test(
      chainContext.slice(
        chainContext.indexOf("async function updatePropertyStage"),
        chainContext.indexOf("async function addStructuredUpdate")
      )
    )
);

check(
  "breakChainConnection returns PropertyMutationResult",
  /breakChainConnection\([\s\S]*?\): Promise<PropertyMutationResult>/.test(
    chainContext
  )
);

check(
  "property page wires status result before success feedback",
  propertyPage.includes("const result = await updatePropertyStage") &&
    propertyPage.includes("if (!result.ok)") &&
    propertyPage.includes("isSavingStage") &&
    propertyPage.includes("Saving status…")
);

check(
  "property page does not show status success unconditionally after await",
  !/await updatePropertyStage\([\s\S]*?\);\s*showSectionFeedback\(\{\s*section: "status",\s*variant: "success"/.test(
    propertyPage
  )
);

check(
  "DisconnectChainConfirmModal requires reason and disables confirm",
  modal.includes("disabled={isSaving || !selectedReason}") &&
    modal.includes("Disconnect from chain?") &&
    modal.includes("This removes the MoveLoop link")
);

check(
  "property page opens disconnect modal instead of inline break",
  propertyPage.includes("DisconnectChainConfirmModal") &&
    propertyPage.includes("setIsDisconnectModalOpen(true)") &&
    !propertyPage.includes("Select disconnect reason")
);

check(
  "chain vs participation hierarchy copy present",
  propertyPage.includes("Chain connection") &&
    propertyPage.includes(
      "Disconnect this property from the chain"
    ) &&
    delinkPanel.includes("Participation") &&
    delinkPresentation.includes(
      "not the same as disconnecting the property from neighbouring chain links"
    )
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}

console.log("\nAll Batch 6 transaction-safety checks passed.");
