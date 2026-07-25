import type { ReactNode } from "react";

import {
  AUTH_CARD_CLASS,
  AUTH_PAGE_CLASS,
} from "@/components/auth/authStyles";

type AuthPageShellProps = {
  children: ReactNode;
};

export default function AuthPageShell({
  children,
}: AuthPageShellProps) {
  return (
    <main className={AUTH_PAGE_CLASS}>
      <div className={AUTH_CARD_CLASS}>{children}</div>
    </main>
  );
}
