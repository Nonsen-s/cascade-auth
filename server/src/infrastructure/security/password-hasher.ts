import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { PasswordHasher } from '../../application/ports.js';
import { AuthFailure } from '../../domain/errors.js';

const options = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});

/** Bounds CPU/memory use; unknown accounts still perform a genuine password verification. */
export class Argon2PasswordHasher implements PasswordHasher {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private constructor(
    private readonly dummyHash: string,
    private readonly concurrency: number,
  ) {}

  static async create(concurrency = 2): Promise<Argon2PasswordHasher> {
    const dummyHash = await argon2.hash(randomBytes(32), options);
    return new Argon2PasswordHasher(dummyHash, concurrency);
  }

  hash(password: string): Promise<string> {
    return this.run(() => argon2.hash(password, options));
  }
  verify(password: string, hash: string | null): Promise<boolean> {
    return this.run(async () => {
      const valid = await argon2.verify(hash ?? this.dummyHash, password);
      return hash !== null && valid;
    });
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= 8) throw new AuthFailure('unavailable', {}, 2);
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else this.active += 1;
    try {
      return await operation();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}
