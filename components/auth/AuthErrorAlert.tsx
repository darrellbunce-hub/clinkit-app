import { AUTH_ERROR_CLASS } from "@/components/auth/authStyles";

type AuthErrorAlertProps = {
  message: string;
  className?: string;
};

export default function AuthErrorAlert({
  message,
  className = "",
}: AuthErrorAlertProps) {
  return (
    <p role="alert" className={`${AUTH_ERROR_CLASS} ${className}`.trim()}>
      {message}
    </p>
  );
}
