import { randomUUID } from 'node:crypto';
import type {
  MailCipher,
  MailSender,
  OutboxRepository,
} from '../../application/ports.js';

export interface WorkerLogger {
  warn(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

export class MailWorker {
  private readonly owner = randomUUID();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active: Promise<boolean> | null = null;
  private stopped = true;
  private lastCleanup = 0;

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly cipher: MailCipher,
    private readonly sender: MailSender,
    private readonly now: () => Date,
    private readonly log: WorkerLogger,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
  }

  runOnce(): Promise<boolean> {
    if (this.active) return this.active;
    this.active = this.deliver().finally(() => {
      this.active = null;
    });
    return this.active;
  }

  private async deliver(): Promise<boolean> {
    const now = this.now();
    if (now.getTime() - this.lastCleanup >= 60_000) {
      await this.outbox.cleanup(now);
      this.lastCleanup = now.getTime();
    }
    const job = await this.outbox.claim(this.owner, now);
    if (!job) return false;
    let content;
    try {
      content = this.cipher.open(job.ciphertext);
    } catch {
      await this.outbox.failed(job.id, this.owner, now, true);
      this.log.error(
        { jobId: job.id, reason: 'mail_payload_unavailable' },
        'Email job requires operator attention',
      );
      return true;
    }
    try {
      await this.sender.send(job.id, content);
    } catch {
      const retryAt = new Date(
        this.now().getTime() + Math.min(3_600_000, 15_000 * 2 ** job.attempts),
      );
      await this.outbox.failed(job.id, this.owner, retryAt, job.attempts >= 8);
      this.log.warn(
        {
          jobId: job.id,
          attempts: job.attempts,
          reason: 'smtp_delivery_failed',
        },
        'Email delivery deferred',
      );
      return true;
    }
    await this.outbox.delivered(job.id, this.owner);
    return true;
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce().then(
        (hadJob) => {
          if (!this.stopped) this.schedule(hadJob ? 20 : 2000);
        },
        () => {
          this.log.error(
            { reason: 'outbox_database_unavailable' },
            'Email worker will retry',
          );
          if (!this.stopped) this.schedule(5000);
        },
      );
    }, delay);
    this.timer.unref();
  }
}
