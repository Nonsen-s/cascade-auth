import { z } from 'zod';
import type { OutboxRepository } from '../../application/ports.js';
import type { Database } from './database.js';

const jobSchema = z.object({
  id: z.uuid(),
  ciphertext: z.string(),
  attempts: z.number().int().positive(),
});

export class PostgresOutboxRepository implements OutboxRepository {
  constructor(private readonly db: Database) {}
  async claim(owner: string, now: Date) {
    const row = (
      await this.db.query(
        'WITH picked AS (SELECT id FROM accounts.email_outbox WHERE NOT failed AND available_at <= $1 AND expires_at > $1 AND (lease_expires_at IS NULL OR lease_expires_at <= $1) ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE accounts.email_outbox o SET lease_owner = $2, lease_expires_at = $3, attempts = attempts + 1 FROM picked WHERE o.id = picked.id RETURNING o.id, o.ciphertext, o.attempts',
        [now, owner, new Date(now.getTime() + 120_000)],
      )
    )[0];
    return row ? jobSchema.parse(row) : null;
  }
  async delivered(id: string, owner: string): Promise<void> {
    await this.db.query(
      'DELETE FROM accounts.email_outbox WHERE id = $1 AND lease_owner = $2',
      [id, owner],
    );
  }
  async failed(
    id: string,
    owner: string,
    retryAt: Date,
    permanent: boolean,
  ): Promise<void> {
    await this.db.query(
      'UPDATE accounts.email_outbox SET available_at = $3, failed = $4, lease_owner = NULL, lease_expires_at = NULL WHERE id = $1 AND lease_owner = $2',
      [id, owner, retryAt, permanent],
    );
  }
  async cleanup(now: Date): Promise<void> {
    // Bounded batches avoid long maintenance transactions on a busy API database.
    await this.db.query(
      'DELETE FROM accounts.tokens WHERE digest IN (SELECT digest FROM accounts.tokens WHERE expires_at <= $1 LIMIT 500)',
      [now],
    );
    await this.db.query(
      'DELETE FROM accounts.sessions WHERE digest IN (SELECT digest FROM accounts.sessions WHERE expires_at <= $1 LIMIT 500)',
      [now],
    );
    await this.db.query(
      'DELETE FROM accounts.rate_limits WHERE key IN (SELECT key FROM accounts.rate_limits WHERE expires_at <= $1 LIMIT 500)',
      [now],
    );
  }
}
