export interface Mailer {
  send(to: string, subject: string, html: string): Promise<void>;
}
