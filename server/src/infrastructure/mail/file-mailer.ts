import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { MailSender } from '../../application/ports.js';
import type { MailContent } from '../../domain/models.js';
import { renderMail } from './render-mail.js';

/** Development inbox on disk. Configuration forbids this transport in production. */
export class FileMailer implements MailSender {
  constructor(
    private readonly directory: string,
    private readonly appOrigin: string,
  ) {}
  async send(jobId: string, content: MailContent): Promise<void> {
    z.uuid().parse(jobId);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const message = { to: content.to, ...renderMail(content, this.appOrigin) };
    try {
      await writeFile(
        resolve(this.directory, `${jobId}.json`),
        JSON.stringify(message, null, 2),
        { flag: 'wx', mode: 0o600 },
      );
    } catch (error) {
      // Retrying a delivered development job must not create another message.
      if (!z.object({ code: z.literal('EEXIST') }).safeParse(error).success)
        throw error;
    }
  }
  close(): void {}
}
