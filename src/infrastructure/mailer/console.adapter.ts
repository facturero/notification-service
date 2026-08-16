import type { Mailer } from './mailer.port';

export class ConsoleMailer implements Mailer {
  async send(to: string, subject: string, html: string): Promise<void> {
    console.log('─'.repeat(60));
    console.log(`[ConsoleMailer] To: ${to}`);
    console.log(`[ConsoleMailer] Subject: ${subject}`);
    console.log(`[ConsoleMailer] Body length: ${html.length} chars`);
    console.log('─'.repeat(60));
  }
}
