import { useSyncExternalStore } from 'react';
import {
  initialAuthState,
  type AuthService,
  type AuthState,
} from '../auth/application/auth-service';

const unavailableState: AuthState = {
  ...initialAuthState,
  status: 'anonymous',
};
const subscribeUnavailable = (): (() => void) => () => undefined;
const getUnavailableState = (): AuthState => unavailableState;

export function useAuth(auth: AuthService | null): AuthState {
  return useSyncExternalStore(
    auth?.subscribe ?? subscribeUnavailable,
    auth?.getSnapshot ?? getUnavailableState,
  );
}
