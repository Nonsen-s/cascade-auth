import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

interface PasswordFieldProps {
  readonly id: string;
  readonly name: 'password' | 'confirmPassword';
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly autoComplete: 'current-password' | 'new-password';
  readonly disabled: boolean;
  readonly error: string | undefined;
  readonly hint?: string;
}

export function PasswordField({
  id,
  name,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  error,
  hint,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const toggleLabel =
    name === 'confirmPassword' ? 'подтверждение пароля' : label.toLowerCase();
  const descriptionId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`password-input ${error ? 'has-error' : ''}`}>
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="off"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={descriptionId}
          required
        />
        <button
          className="password-toggle"
          type="button"
          aria-label={`${visible ? 'Скрыть' : 'Показать'} ${toggleLabel}`}
          aria-controls={id}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
          disabled={disabled}
        >
          {visible ? (
            <EyeOff size={19} aria-hidden="true" />
          ) : (
            <Eye size={19} aria-hidden="true" />
          )}
        </button>
      </div>
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
      {!error && hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}
