import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { TokenIssuer } from '../../application/ports.js';

export class SecurityTokens implements TokenIssuer {
  constructor(private readonly secret: Buffer) {}
  issue() {
    const raw = randomBytes(32).toString('base64url');
    return { raw, digest: this.digest(raw) };
  }
  digest(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
  csrf(raw: string): string {
    return createHmac('sha256', this.secret)
      .update(`csrf:${raw}`)
      .digest('base64url');
  }
  matchesCsrf(raw: string, provided: string): boolean {
    const expected = Buffer.from(this.csrf(raw));
    const actual = Buffer.from(provided);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
  privateKey(namespace: string, subject: string): string {
    return createHmac('sha256', this.secret)
      .update(`${namespace}:${subject}`)
      .digest('hex');
  }
}
