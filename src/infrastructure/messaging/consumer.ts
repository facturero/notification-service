import type { ConsumeMessage } from 'amqplib';
import { InboxConsumer, EventHandler } from '@facturero/outbox-relay';
import { findTemplateEntry, loadProviderConfig, loadTemplateConfig, TemplateEntry } from '../../config.js';
import { render } from '../template-engine.js';
import type { Mailer } from '../mailer/mailer.port.js';
import { sequelize } from '../persistence/models.js';
import type { NotificationPreferenceService } from '../../application/preferences.js';
import type { NotificationService } from '../../application/notifications.js';

const EXCHANGE = 'crm.events';
const QUEUE = 'notification-service.events';

/** Si el evento trae `userId`, consulta la preferencia del usuario para el
 * canal smtp (práctica), y solo envía si está activa. A lo Moodle: el canal
 * smtp se puede desactivar por provider (plugin). Cuando el evento NO trae
 * userId (dato de plataforma, p.ej. facturas), se envía (default). */
function shouldSendSmtp(
  prefService: NotificationPreferenceService,
  event: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const userId = typeof payload.userId === 'string' ? payload.userId : undefined;
  if (!userId) return Promise.resolve(true);
  return prefService.isEnabled(userId, event, 'smtp');
}

/**
 * Proveedores que solo tienen campana (canal `app`) y ninguna plantilla de correo: p. ej. los de Proyectos y tareas, cuyos eventos
 * traen ids de usuario y no correos. Antes el consumidor solo escuchaba eventos con plantilla, así que un proveedor así nunca llegaba
 * a la bandeja (la campana sonaba en vivo por el gateway y desaparecía al recargar).
 */
export function appOnlyProviderEvents(): string[] {
  const withTemplate = new Set(loadTemplateConfig().map((e) => e.event));
  return loadProviderConfig()
    .filter((p) => p.channels.includes('app') && !withTemplate.has(p.code))
    .map((p) => p.code);
}

/** Todo lo que escucha la cola: eventos con plantilla de correo y proveedores solo de campana. */
export function consumedEvents(): string[] {
  return [...loadTemplateConfig().map((e) => e.event), ...appOnlyProviderEvents()];
}

export function buildHandlers(
  mailer: Mailer,
  prefService: NotificationPreferenceService,
  notifications?: NotificationService,
): EventHandler[] {
  const appOnly: EventHandler[] = appOnlyProviderEvents().map((event) => ({
    eventType: event,
    async handle(payload: unknown, msg: ConsumeMessage): Promise<void> {
      if (!notifications) return;
      const eventId = msg?.properties?.headers?.eventId;
      // A diferencia de los de plantilla, aquí la campana ES todo el trabajo: si falla, se relanza para que el inbox reintente.
      const rows = await notifications.recordForEvent(event, payload as Record<string, unknown>, typeof eventId === 'string' ? eventId : undefined);
      if (rows.length > 0) console.log(`[notification] app: ${rows.length} notificación(es) para ${event}`);
    },
  }));

  return [...appOnly, ...loadTemplateConfig().map((entry: TemplateEntry) => ({
    eventType: entry.event,
    async handle(payload: unknown, msg: ConsumeMessage): Promise<void> {
      const activeEntry = findTemplateEntry(entry.event);
      if (!activeEntry) return;
      const rec = payload as Record<string, unknown>;

      // La campana se persiste ANTES del gate de smtp: son canales
      // independientes y desactivar el email no debe vaciar el historial
      // in-app. El propio recordForEvent aplica la preferencia del canal `app`.
      if (notifications) {
        const eventId = msg?.properties?.headers?.eventId;
        try {
          const rows = await notifications.recordForEvent(
            entry.event,
            rec,
            typeof eventId === 'string' ? eventId : undefined,
          );
          if (rows.length > 0) {
            console.log(`[notification] app: ${rows.length} notificación(es) para ${entry.event}`);
          }
        } catch (err) {
          // Que falle el historial no debe impedir el email ni reencolar el
          // evento: la campana en vivo la emite el gateway por su cuenta.
          console.error(`[notification] no se pudo persistir ${entry.event}:`, err);
        }
      }

      if (!(await shouldSendSmtp(prefService, entry.event, rec))) {
        console.log(
          `[notification] smtp disabled for ${entry.event} (user ${rec.userId}) — skipping`,
        );
        return;
      }
      const result = render(activeEntry, rec);
      // Eventos de plataforma (billing.*) no garantizan email: si el payload no
      // llega con destinatario, se descarta con log en vez de reencolar (reintentar
      // no cambiaría nada y envenenaría la cola). Los identity.* sí exigen email.
      const hasRecipient = result.to.trim() !== '';
      if (hasRecipient || !activeEntry.allowNullRecipient) {
        await mailer.send(result.to, result.subject, result.html);
        console.log(`[notification] processed ${activeEntry.event} → ${result.to}`);
      } else {
        console.log(
          `[notification] ${entry.event}: sin destinatario en el evento — skipping`,
        );
      }

    },
  }))];
}

export class NotificationConsumer {
  private consumer: InboxConsumer | null = null;

  async start(
    rabbitmqUrl: string,
    mailer: Mailer,
    prefService: NotificationPreferenceService,
    notifications?: NotificationService,
  ): Promise<void> {
    await sequelize.authenticate();
    await sequelize.sync();

    this.consumer = new InboxConsumer({
      sequelize,
      rabbitmqUrl,
      exchange: EXCHANGE,
      queue: QUEUE,
      bindings: consumedEvents(),
      handlers: buildHandlers(mailer, prefService, notifications),
    });
    await this.consumer.start();

    console.log('[notification-service] listening for events...');
  }

  async stop(): Promise<void> {
    await this.consumer?.stop();
  }
}