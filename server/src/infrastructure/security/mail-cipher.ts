import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { MailCipher } from '../../application/ports.js';
import type { MailContent } from '../../domain/models.js';

const mailSchema = z.strictObject({
  to: z.email(),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  purpose: z.enum(['email', 'recovery']),
});

/** The outbox contains bearer links, so its payload is encrypted separately from the database. */
export class AesMailCipher implements MailCipher {
  constructor(
    private readonly activeKeyId: string,
    private readonly keys: ReadonlyMap<string, Buffer>,
  ) {
    if (!keys.has(activeKeyId))
      throw new Error('Active mail encryption key is missing');
  }
  seal(message: MailContent): string {
    const key = this.keys.get(this.activeKeyId);
    if (!key) throw new Error('Mail encryption key is missing');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(this.activeKeyId));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(message), 'utf8'),
      cipher.final(),
    ]);
    return [
      this.activeKeyId,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join('.');
  }
  open(value: string): MailContent {
    const [keyId, iv, content, tag, extra] = value.split('.');
    if (!keyId || !iv || !content || !tag || extra !== undefined)
      throw new Error('Invalid encrypted mail payload');
    const key = this.keys.get(keyId);
    if (!key) throw new Error('Mail encryption key is unavailable');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from(keyId));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const decoded = Buffer.concat([
      decipher.update(Buffer.from(content, 'base64url')),
      decipher.final(),
    ]);
    const parsed: unknown = JSON.parse(decoded.toString('utf8'));
    return mailSchema.parse(parsed);
  }
}
