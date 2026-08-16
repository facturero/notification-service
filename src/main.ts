import { loadConfig } from './config';
import { NotificationConsumer } from './infrastructure/messaging/consumer';
import { SmtpMailer } from './infrastructure/mailer/smtp.adapter';
import { ConsoleMailer } from './infrastructure/mailer/console.adapter';

async function main(): Promise<void> {
  const config = loadConfig();

  const mailer = config.SMTP_HOST
    ? new SmtpMailer(config)
    : new ConsoleMailer();

  const consumer = new NotificationConsumer();
  await consumer.start(config.RABBITMQ_URL, mailer);

  console.log('[notification-service] started');

  const shutdown = async () => {
    console.log('[notification-service] shutting down...');
    await consumer.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[notification-service] fatal:', err);
  process.exit(1);
});
