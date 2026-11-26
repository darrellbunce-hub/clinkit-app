/**
 * Batch 2 soft-launch check: homeowner Create account deep link and
 * login-mode password checklist gating.
 *
 * Run: npx tsx scripts/verify-homeowner-login-create-mode-batch2.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildHomeownerLoginHref,
  HOMEOWNER_LOGIN_CREATE_MODE,
  isHomeownerCreateAccountMode,
  ROUTES,
} from "../lib/auth/routes";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  ROUTES.homeownerCreateAccount === "/login?mode=create",
  "ROUTES.homeownerCreateAccount must deep-link create mode"
);

assert(
  isHomeownerCreateAccountMode(HOMEOWNER_LOGIN_CREATE_MODE),
  "create mode helper must recognise mode=create"
);

assert(
  !isHomeownerCreateAccountMode(null) &&
    !isHomeownerCreateAccountMode("login"),
  "create mode helper must reject non-create values"
);

assert(
  buildHomeownerLoginHref() === "/login",
  "default login href must be /login"
);

assert(
  buildHomeownerLoginHref({ mode: "create" }) ===
    "/login?mode=create",
  "create mode href must set mode=create"
);

assert(
  buildHomeownerLoginHref({
    mode: "create",
    next: "/start-move",
  }) === "/login?mode=create&next=%2Fstart-move",
  "create mode href must preserve next"
);

assert(
  buildHomeownerLoginHref({
    mode: "login",
    next: "/join-chain",
  }) === "/login?next=%2Fjoin-chain",
  "login mode href must preserve next without mode"
);

const loginPage = read("app/login/page.tsx");
const navbar = read("components/Navbar.tsx");

assert(
  loginPage.includes("isHomeownerCreateAccountMode"),
  "login page must derive create mode from the URL"
);
assert(
  loginPage.includes("showRequirements={isCreateAccountMode}"),
  "password checklist must be gated to create-account mode"
);
assert(
  loginPage.includes('setAuthMode("create")'),
  "login page must support switching into create mode"
);
assert(
  loginPage.includes('setAuthMode("login")'),
  "login page must support switching back to login mode"
);
assert(
  navbar.includes("ROUTES.homeownerCreateAccount"),
  "Navbar Create account CTA must use create-account deep link"
);
assert(
  navbar.includes("ROUTES.homeownerLogin"),
  "Navbar Log in CTA must use homeowner login route"
);
assert(
  !navbar.includes('href="/login"'),
  "Navbar must not hard-code bare /login for create-account CTA"
);

console.log(
  "verify-homeowner-login-create-mode-batch2: create-account entry and checklist gating OK"
);
