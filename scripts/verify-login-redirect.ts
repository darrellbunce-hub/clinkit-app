import {
  buildLoginRedirectUrl,
  buildProtectedRouteNextDestination,
  resolveLoginNextDestination,
} from "../lib/auth/redirects";
import { ROUTES } from "../lib/auth/routes";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function testProtectedRouteNextDestination() {
  const requestUrl = new URL(
    "https://app.example.com/claim?token=ABC&propertyId=208"
  );

  assert(
    buildProtectedRouteNextDestination(
      requestUrl,
      "/claim"
    ) === "/claim?token=ABC&propertyId=208",
    "next destination should preserve search params"
  );
}

function testBuildLoginRedirectUrl() {
  const requestUrl = new URL(
    "https://app.example.com/claim?token=ABC"
  );

  const loginUrl = buildLoginRedirectUrl(
    requestUrl,
    ROUTES.homeownerLogin,
    buildProtectedRouteNextDestination(
      requestUrl,
      "/claim"
    )
  );

  assert(
    loginUrl.pathname === ROUTES.homeownerLogin,
    "login redirect should target login page"
  );

  assert(
    loginUrl.searchParams.get("next") ===
      "/claim?token=ABC",
    "login redirect should encode full next destination"
  );
}

function testResolveLoginNextDestination() {
  assert(
    resolveLoginNextDestination(
      "/claim?token=ABC",
      ROUTES.homeownerDashboard
    ) === "/claim?token=ABC",
    "valid next should be preserved"
  );

  assert(
    resolveLoginNextDestination(
      null,
      ROUTES.homeownerDashboard
    ) === ROUTES.homeownerDashboard,
    "missing next should use fallback"
  );

  assert(
    resolveLoginNextDestination(
      "https://evil.example/claim",
      ROUTES.homeownerDashboard
    ) === ROUTES.homeownerDashboard,
    "absolute next URLs should be rejected"
  );

  assert(
    resolveLoginNextDestination(
      "//evil.example/claim",
      ROUTES.homeownerDashboard
    ) === ROUTES.homeownerDashboard,
    "protocol-relative next URLs should be rejected"
  );
}

function main() {
  const tests = [
    ["protected route next destination", testProtectedRouteNextDestination],
    ["build login redirect url", testBuildLoginRedirectUrl],
    ["resolve login next destination", testResolveLoginNextDestination],
  ] as const;

  for (const [name, run] of tests) {
    run();
    console.log(`PASS ${name}`);
  }

  console.log(`\n${tests.length}/${tests.length} login redirect checks passed.`);
}

main();
