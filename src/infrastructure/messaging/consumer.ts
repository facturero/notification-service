import { InboxConsumer, EventHandler } from '@facturero/outbox-relay';
import { findTemplateEntry, loadTemplateConfig, TemplateEntry } from '../../config.js';
import { render } from '../template-engine.js';
import type { Mailer } from '../mailer/mailer.port.js';
import { sequelize } from '../persistence/models.js';

const EXCHANGE = 'crm.events';
const QUEUE = 'notification-service.events';

export function buildHandlers(mailer: Mailer): EventHandler[] {
  return loadTemplateConfig().map((entry: TemplateEntry) => ({
    eventType: entry.event,
    async handle(payload: unknown): Promise<void> {
      const activeEntry = findTemplateEntry(entry.event);
      if (!activeEntry) return;
      const { html, subject, to } = render(activeEntry, payload as Record<string, unknown>);
      await mailer.send(to, subject, html);
      console.log(`[notification] processed ${activeEntry.event} → ${to}`);
    },
  }));
}

export class NotificationConsumer {
  private consumer: InboxConsumer | null = null;

  async start(rabbitmqUrl: string, mailer: Mailer): Promise<void> {
    await sequelize.authenticate();
    await sequelize.sync();

    this.consumer = new InboxConsumer({
      sequelize,
      rabbitmqUrl,
      exchange: EXCHANGE,
      queue: QUEUE,
      bindings: loadTemplateConfig().map((entry: TemplateEntry) => entry.event),
      handlers: buildHandlers(mailer),
    });
    await this.consumer.start();

    console.log('[notification-service] listening for events...');
  }

  async stop(): Promise<void> {
    await this.consumer?.stop();
  }
}
