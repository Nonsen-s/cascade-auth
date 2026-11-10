import { CircleAlert, CircleCheck } from 'lucide-react';
import type { AuthState } from '../../auth';
import type { AppError } from '../../shared/errors';

interface FeedbackProps {
  readonly error: AppError | null;
  readonly notice: AuthState['notice'];
}

export function Feedback({ error, notice }: FeedbackProps) {
  if (error) {
    return (
      <div className="feedback feedback-error" role="alert">
        <CircleAlert size={19} aria-hidden="true" />
        <p>{error.message}</p>
      </div>
    );
  }
  if (notice) {
    return (
      <div
        className={`feedback ${notice.kind === 'expired' ? 'feedback-info' : 'feedback-success'}`}
        role="status"
      >
        <CircleCheck size={19} aria-hidden="true" />
        <p>{notice.message}</p>
      </div>
    );
  }
  return null;
}
