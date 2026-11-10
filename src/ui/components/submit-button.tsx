import { ArrowRight, LoaderCircle } from 'lucide-react';

interface SubmitButtonProps {
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly children: string;
  readonly busyLabel: string;
}

export function SubmitButton({
  busy,
  disabled,
  children,
  busyLabel,
}: SubmitButtonProps) {
  return (
    <button
      className="button-primary"
      type="submit"
      disabled={disabled}
      aria-busy={busy}
    >
      <span>{busy ? busyLabel : children}</span>
      {busy ? (
        <LoaderCircle className="spinner" size={19} aria-hidden="true" />
      ) : (
        <ArrowRight size={19} aria-hidden="true" />
      )}
    </button>
  );
}
