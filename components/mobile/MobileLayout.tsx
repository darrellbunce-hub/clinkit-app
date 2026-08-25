import Link from "next/link";
import type { ReactNode } from "react";

import {
  MODAL_ACTIONS_CLASS,
  MODAL_OVERLAY_CLASS,
  MODAL_PANEL_CLASS,
  MOBILE_ACTION_HEADER_CLASS,
  MOBILE_ALERT_STACK_CLASS,
  MOBILE_NAV_LINK_CLASS,
  MOBILE_PAGE_NAV_ROW_CLASS,
  MOBILE_PANEL_HEADER_CLASS,
  TOUCH_TARGET_CLASS,
} from "@/components/mobileStandards";

type MobileActionHeaderProps = {
  title: ReactNode;
  meta?: ReactNode;
  action: ReactNode;
};

/** Card or section header that stacks title and action on mobile. */
export function MobileActionHeader({
  title,
  meta,
  action,
}: MobileActionHeaderProps) {
  return (
    <div className={MOBILE_ACTION_HEADER_CLASS}>
      <div className="min-w-0 flex-1">
        {title}
        {meta}
      </div>

      <div className="shrink-0 w-full sm:w-auto [&_a]:w-full [&_a]:sm:w-auto [&_button]:w-full [&_button]:sm:w-auto">
        {action}
      </div>
    </div>
  );
}

type MobilePanelHeaderProps = {
  children: ReactNode;
  aside?: ReactNode;
};

/** Section with primary content and a badge/stat that stacks on mobile. */
export function MobilePanelHeader({
  children,
  aside,
}: MobilePanelHeaderProps) {
  return (
    <div className={MOBILE_PANEL_HEADER_CLASS}>
      <div className="min-w-0 flex-1">{children}</div>

      {aside ? (
        <div className="shrink-0 self-start">{aside}</div>
      ) : null}
    </div>
  );
}

type MobileAlertProps = {
  variant: "success" | "warning";
  children: ReactNode;
};

export function MobileAlert({
  variant,
  children,
}: MobileAlertProps) {
  const classes =
    variant === "success"
      ? "rounded-2xl border border-green-200 bg-green-50 px-5 py-4 text-green-700 font-medium"
      : "rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-700 font-medium";

  return (
    <div role="status" className={classes}>
      {children}
    </div>
  );
}

type MobileAlertStackProps = {
  children: ReactNode;
};

export function MobileAlertStack({
  children,
}: MobileAlertStackProps) {
  return (
    <div className={MOBILE_ALERT_STACK_CLASS}>{children}</div>
  );
}

type MobilePageNavLink = {
  href: string;
  label: string;
};

type MobilePageNavRowProps = {
  links: MobilePageNavLink[];
};

/** Back links row — stacks vertically on mobile. */
export function MobilePageNavRow({
  links,
}: MobilePageNavRowProps) {
  return (
    <nav
      aria-label="Page navigation"
      className={MOBILE_PAGE_NAV_ROW_CLASS}
    >
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`${MOBILE_NAV_LINK_CLASS} ${TOUCH_TARGET_CLASS} !w-auto font-medium text-slate-600 hover:text-slate-900`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

type MobileModalProps = {
  children: ReactNode;
  onClose?: () => void;
  ariaLabelledBy?: string;
};

/** Accessible modal shell for short mobile viewports. */
export function MobileModal({
  children,
  onClose,
  ariaLabelledBy,
}: MobileModalProps) {
  return (
    <div
      className={MODAL_OVERLAY_CLASS}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        className={MODAL_PANEL_CLASS}
        onClick={(event) =>
          event.stopPropagation()
        }
      >
        {children}
      </div>
    </div>
  );
}

export { MODAL_ACTIONS_CLASS };
