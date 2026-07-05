import {
  Activity,
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Home,
  Link2,
  Mail,
  Search,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export const WORKSPACE_ICON_CLASS =
  "h-5 w-5 shrink-0";

export const WorkspaceIcons = {
  operationalHealth: Activity,
  managedProperties: Home,
  invitations: Mail,
  buyerReady: ShieldCheck,
  completion: CalendarCheck,
  searching: Search,
  awaitingConnection: Link2,
  success: CheckCircle2,
  attention: AlertTriangle,
} as const satisfies Record<string, LucideIcon>;

export type WorkspaceIconName =
  keyof typeof WorkspaceIcons;

export function WorkspaceIcon({
  name,
  className = WORKSPACE_ICON_CLASS,
}: {
  name: WorkspaceIconName;
  className?: string;
}) {
  const Icon = WorkspaceIcons[name];
  return <Icon className={className} aria-hidden />;
}
