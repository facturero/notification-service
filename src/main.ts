import { serve } from '@hono/node-server';
import { loadConfig } from './config';
import { NotificationConsumer } from './infrastructure/messaging/consumer';
import { SmtpMailer } from './infrastructure/mailer/smtp.adapter';
import { ConsoleMailer } from './infrastructure/mailer/console.adapter';
import { SequelizeNotificationPreferenceRepository } from './infrastructure/persistence/preferences-repository';
import { SequelizeNotificationRepository } from './infrastructure/persistence/notifications-repository';
import { NotificationPreferenceService } from './application/preferences';
import { NotificationService } from './application/notifications';
import { createApp } from './interface/http/app';

async function main(): Promise<void> {
  const config = loadConfig();

  const mailer = config.SMTP_HOST
    ? new SmtpMailer(config)
    : new ConsoleMailer();

  const prefService = new NotificationPreferenceService(
    new SequelizeNotificationPreferenceRepository(),
  );

  const notificationService = new NotificationService(
    new SequelizeNotificationRepository(),
    prefService,
  );

  const httpApp = createApp({
    preferenceService: prefService,
    notificationService,
    corsOrigin: config.CORS_ORIGIN ?? '*',
  });

  // el servidor HTTP expone el catálogo de providers y las preferencias. El
  // Service k8s (3011) ya existía; el deployment ahora abre el puerto.
  serve({ fetch: httpApp.fetch, port: config.PORT });

  const consumer = new NotificationConsumer();
  await consumer.start(config.RABBITMQ_URL, mailer, prefService, notificationService);

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