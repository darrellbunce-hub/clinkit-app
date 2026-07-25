import { AUTH_INPUT_CLASS, AUTH_LABEL_CLASS } from "@/components/auth/authStyles";

type AuthEmailFieldProps = {
  id: string;
  name?: string;
  label?: "Email" | "Work email";
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  autoComplete?: string;
  inputMode?: "email";
};

export default function AuthEmailField({
  id,
  name = "email",
  label = "Email",
  value,
  defaultValue,
  onChange,
  disabled = false,
  readOnly = false,
  autoComplete = "email",
  inputMode = "email",
}: AuthEmailFieldProps) {
  return (
    <div>
      <label htmlFor={id} className={AUTH_LABEL_CLASS}>
        {label}
      </label>

      <input
        id={id}
        name={name}
        type="email"
        autoComplete={autoComplete}
        inputMode={inputMode}
        disabled={disabled}
        readOnly={readOnly}
        value={value}
        defaultValue={defaultValue}
        onChange={
          onChange
            ? (event) => onChange(event.target.value)
            : undefined
        }
        className={AUTH_INPUT_CLASS}
      />
    </div>
  );
}
