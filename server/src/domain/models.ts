import type { Player } from '../../../shared/auth-contract.js';

export interface Account {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly verifiedAt: Date | null;
  readonly authVersion: number;
}

export type SessionKind = 'access' | 'recovery';
export type TokenPurpose = 'email' | 'recovery';
export interface IssuedToken {
  readonly raw: string;
  readonly digest: string;
}
export interface TokenGrant extends IssuedToken {
  readonly expiresAt: Date;
}
export interface StoredSession {
  readonly digest: string;
  readonly user: Player;
  readonly kind: SessionKind;
  readonly expiresAt: Date;
}
export interface SessionGrant {
  readonly token: TokenGrant;
  readonly user: Player;
  readonly kind: SessionKind;
}
export interface MailContent {
  readonly to: string;
  readonly token: string;
  readonly purpose: TokenPurpose;
}

export const authPolicy = Object.freeze({
  maximumSessions: 20,
  verificationLifetimeMs: 24 * 60 * 60 * 1000,
  resetLinkLifetimeMs: 60 * 60 * 1000,
  recoverySessionLifetimeMs: 15 * 60 * 1000,
  sessionLifetimeMs: 14 * 24 * 60 * 60 * 1000,
});
