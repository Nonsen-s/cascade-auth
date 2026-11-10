import type { PlayerIdentity } from '../domain/identity';
import type { Credentials } from '../domain/credentials';
import type { AppError } from '../../shared/errors';

export interface AuthSession {
  readonly user: PlayerIdentity | null;
  readonly recovery: boolean;
  readonly emailVerified?: true;
}

export type AuthEvent =
  | { readonly type: 'session'; readonly session: AuthSession }
  | { readonly type: 'signedOut' }
  | { readonly type: 'error'; readonly error: AppError };

export interface AuthGateway {
  initialize(): Promise<AuthSession>;
  subscribe(listener: (event: AuthEvent) => void): () => void;
  signIn(credentials: Credentials): Promise<PlayerIdentity>;
  signUp(credentials: Credentials): Promise<PlayerIdentity | null>;
  resendConfirmation(email: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<PlayerIdentity>;
  signOut(): Promise<void>;
  dispose(): void;
}
