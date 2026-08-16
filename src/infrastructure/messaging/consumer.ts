import { Channel, ChannelModel, connect } from 'amqplib';
import { findTemplateEntry, loadTemplateConfig } from '../../config.js';
import { render } from '../template-engine.js';
import type { Mailer } from '../mailer/mailer.port.js';
import { ProcessedEventModel, sequelize } from '../persistence/models.js';
import { TemplateNotFoundError, TemplateValidationError } from '../../domain/errors.js';

const EXCHANGE = 'crm.events';

export class NotificationConsumer {
  private model: ChannelModel | null = null;
  private channel: Channel | null = null;

  async start(rabbitmqUrl: string, mailer: Mailer): Promise<void> {
    await sequelize.authenticate();
    await sequelize.sync();

    this.model = await connect(rabbitmqUrl);
    this.channel = await this.model.createChannel();

    await this.channel.assertExchange(EXCHANGE, 'topic', { durable: true });

    const { queue } = await this.channel.assertQueue('notification-service.events', {
      durable: true,
    });

    for (const entry of loadTemplateConfig()) {
      await this.channel.bindQueue(queue, EXCHANGE, entry.event);
      console.log(`[consumer] bound queue to routing key: ${entry.event}`);
    }

    await this.channel.consume(queue, async (msg) => {
      if (!msg) return;

      const routingKey = msg.fields.routingKey;
      const eventId = msg.properties.headers?.eventId as string | undefined;

      try {
        if (eventId) {
          const exists = await ProcessedEventModel.findByPk(eventId);
          if (exists) {
            this.channel!.ack(msg);
            return;
          }
        }

        const payload = JSON.parse(msg.content.toString()) as Record<string, unknown>;
        const entry = findTemplateEntry(routingKey);

        if (!entry) {
          console.warn(`[consumer] no template for event: ${routingKey}`);
          this.channel!.ack(msg);
          return;
        }

        const { html, subject, to } = render(entry, payload);
        await mailer.send(to, subject, html);

        if (eventId) {
          await ProcessedEventModel.create({
            id: eventId,
            eventType: routingKey,
            routingKey,
            payload: JSON.stringify(payload),
            processedAt: new Date(),
          });
        }

        this.channel!.ack(msg);
        console.log(`[consumer] processed ${routingKey} → ${to}`);
      } catch (err) {
        if (err instanceof TemplateNotFoundError || err instanceof TemplateValidationError) {
          console.warn(`[consumer] discarding ${routingKey}:`, (err as Error).message);
          this.channel!.ack(msg);
        } else {
          console.error(`[consumer] error processing ${routingKey}:`, (err as Error).message);
          this.channel!.nack(msg, false, true);
        }
      }
    });

    console.log('[consumer] listening for events...');
  }

  async stop(): Promise<void> {
    await this.channel?.close();
    await this.model?.close();
  }
}
