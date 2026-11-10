import { z } from 'zod';
import type { RateLimiter } from '../../application/ports.js';
import { AuthFailure } from '../../domain/errors.js';
import type { Database } from './database.js';

const bucketSchema = z.object({
  hits: z.number().int(),
  expires_at: z.coerce.date(),
});

export class PostgresRateLimiter implements RateLimiter {
  constructor(private readonly db: Database) {}
  async consume(
    key: string,
    limit: number,
    windowMs: number,
    now: Date,
  ): Promise<void> {
    const expires = new Date(now.getTime() + windowMs);
    const row = (
      await this.db.query(
        'INSERT INTO accounts.rate_limits(key, hits, expires_at) VALUES ($1, 1, $2) ON CONFLICT(key) DO UPDATE SET hits = CASE WHEN accounts.rate_limits.expires_at <= $3 THEN 1 ELSE LEAST(accounts.rate_limits.hits + 1, $4 + 1) END, expires_at = CASE WHEN accounts.rate_limits.expires_at <= $3 THEN $2 ELSE accounts.rate_limits.expires_at END RETURNING hits, expires_at',
        [key, expires, now, limit],
      )
    )[0];
    const bucket = bucketSchema.parse(row);
    if (bucket.hits > limit)
      throw new AuthFailure(
        'rateLimited',
        {},
        Math.max(
          1,
          Math.ceil((bucket.expires_at.getTime() - now.getTime()) / 1000),
        ),
      );
  }
}
