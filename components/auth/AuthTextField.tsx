import type { ReactNode } from "react";

import { AUTH_INPUT_CLASS, AUTH_LABEL_CLASS } from "@/components/auth/authStyles";

type AuthTextFieldProps = {
  id: string;
  name?: string;
  label: ReactNode;
  type?: "text" | "password";
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  autoComplete?: string;
  placeholder?: string;
  labelAccessory?: ReactNode;
};

export default function AuthTextField({
  id,
  name,
  label,
  type = "text",
  value,
  onChange,
  disabled = false,
  readOnly = false,
  autoComplete,
  placeholder,
  labelAccessory,
}: AuthTextFieldProps) {
  return (
    <div>
      {labelAccessory ? (
        <div className="flex items-center justify-between gap-4">
          <label htmlFor={id} className={AUTH_LABEL_CLASS}>
            {label}
          </label>

          {labelAccessory}
        </div>
      ) : (
        <label htmlFor={id} className={AUTH_LABEL_CLASS}>
          {label}
        </label>
      )}

      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        disabled={disabled}
        readOnly={readOnly}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={AUTH_INPUT_CLASS}
      />
    </div>
  );
}
