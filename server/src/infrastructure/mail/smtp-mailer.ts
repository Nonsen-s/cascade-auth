import nodemailer, { type Transporter } from 'nodemailer';
import type { MailSender } from '../../application/ports.js';
import type { MailContent } from '../../domain/models.js';
import type { ServerConfig } from '../../config.js';
import { renderMail } from './render-mail.js';

export class SmtpMailer implements MailSender {
  private readonly transport: Transporter;
  constructor(
    private readonly config: ServerConfig['mail'],
    private readonly appOrigin: string,
  ) {
    if (!config.smtp.host) throw new Error('SMTP host is missing');
    this.transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      requireTLS: !config.smtp.secure && !config.smtp.allowPlaintext,
      ignoreTLS: config.smtp.allowPlaintext,
      ...(config.smtp.user && config.smtp.password
        ? { auth: { user: config.smtp.user, pass: config.smtp.password } }
        : {}),
      pool: true,
      maxConnections: 2,
      maxMessages: 100,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    });
  }
  async send(jobId: string, content: MailContent): Promise<void> {
    await this.transport.sendMail({
      from: this.config.from,
      to: content.to,
      messageId: `<${jobId}@${new URL(this.appOrigin).hostname}>`,
      ...renderMail(content, this.appOrigin),
    });
  }
  close(): void {
    this.transport.close();
  }
}
