type HomeownerInvitationNoticeProps = {
  variant: "success" | "warning" | "neutral";
  children: React.ReactNode;
};

const NOTICE_CLASSES: Record<
  HomeownerInvitationNoticeProps["variant"],
  string
> = {
  success:
    "bg-status-success-soft text-status-success-text ring-1 ring-status-success/20",
  warning:
    "bg-status-warning-soft text-status-warning-text ring-1 ring-status-warning/20",
  neutral:
    "bg-surface-mist text-text-charcoal ring-1 ring-surface-card-border",
};

export default function HomeownerInvitationNotice({
  variant,
  children,
}: HomeownerInvitationNoticeProps) {
  return (
    <p
      role="status"
      className={`rounded-lg px-3 py-2 text-sm ${NOTICE_CLASSES[variant]}`}
    >
      {children}
    </p>
  );
}
