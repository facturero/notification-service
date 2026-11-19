// Importación por nombre: los tipos de nodemailer 10 (@types/nodemailer 8) ya no exponen un espacio de nombres `nodemailer.*`.
import { createTransport, type Transporter } from 'nodemailer';
import type { Mailer } from './mailer.port';
import type { Config } from '../../config';
import { MailerError } from '../../domain/errors';

export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;
  private readonly from: { email: string; name: string };

  constructor(config: Config) {
    this.transporter = createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER && config.SMTP_PASS
        ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
        : undefined,
    });
    this.from = { email: config.FROM_EMAIL, name: config.FROM_NAME };
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `"${this.from.name}" <${this.from.email}>`,
        to,
        subject,
        html,
      });
    } catch (err) {
      throw new MailerError(`Failed to send email to ${to}: ${(err as Error).message}`, err);
    }
  }
}
