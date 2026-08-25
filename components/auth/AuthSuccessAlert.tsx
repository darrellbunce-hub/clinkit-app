import { AUTH_SUCCESS_CLASS } from "@/components/auth/authStyles";

type AuthSuccessAlertProps = {
  message: string;
  className?: string;
};

export default function AuthSuccessAlert({
  message,
  className = "",
}: AuthSuccessAlertProps) {
  return (
    <p role="status" className={`${AUTH_SUCCESS_CLASS} ${className}`.trim()}>
      {message}
    </p>
  );
}
