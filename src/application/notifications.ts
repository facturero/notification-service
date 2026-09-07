import { createHash, randomUUID } from 'node:crypto';
import { findProvider } from '../config.js';
import type { NotificationPreferenceService } from './preferences.js';
import type {
  NotificationRepository,
  StoredNotification,
} from '../infrastructure/persistence/notifications-repository.js';

/** Campos del evento que se guardan y viajan al cliente. Es una lista blanca a
 * propósito: el evento interno lleva más de lo que la campana necesita (líneas
 * de la factura, snapshots, importes...) y nada de eso debe acabar en el SPA.
 * Al añadir un provider nuevo, añade aquí solo lo que pinte o enlace. */
const DISPLAY_FIELDS = [
  'invoiceId',
  'number',
  'organizationId',
  'organizationName',
  'code',
] as const;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Un evento puede afectar a un usuario (`userId`) o a varios (`userIds`). */
function extractUserIds(payload: Record<string, unknown>): string[] {
  if (Array.isArray(payload.userIds)) {
    return (payload.userIds as unknown[]).filter((u): u is string => typeof u === 'string');
  }
  return typeof payload.userId === 'string' ? [payload.userId] : [];
}

/** Id estable por (evento, destinatario) con forma de UUID v5. Si el evento se
 * reprocesa (reintento del inbox), la fila cae en el mismo id y no se duplica. */
function deterministicId(eventId: string, userId: string): string {
  const h = createHash('sha1').update(`${eventId}:${userId}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    `${variant}${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join('-');
}

function safePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of DISPLAY_FIELDS) {
    const value = payload[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

export interface NotificationListResult {
  notifications: StoredNotification[];
  unread: number;
}

export class NotificationService {
  constructor(
    private readonly repo: NotificationRepository,
    private readonly prefs: NotificationPreferenceService,
  ) {}

  /**
   * Persiste la notificación in-app para cada destinatario del evento, si el
   * provider expone el canal `app` y el usuario no lo ha desactivado. Mismo
   * criterio que aplica el gateway antes de emitir por socket: si no suena la
   * campana, tampoco queda en el historial.
   */
  async recordForEvent(
    providerCode: string,
    payload: Record<string, unknown>,
    eventId?: string,
  ): Promise<StoredNotification[]> {
    const provider = findProvider(providerCode);
    if (!provider || !provider.channels.includes('app')) return [];

    const userIds = extractUserIds(payload);
    if (userIds.length === 0) return [];

    const organizationId =
      typeof payload.organizationId === 'string' ? payload.organizationId : null;
    const data = safePayload(payload);

    const created: StoredNotification[] = [];
    for (const userId of userIds) {
      if (!(await this.prefs.isEnabled(userId, providerCode, 'app'))) continue;
      const row = await this.repo.create({
        id: eventId ? deterministicId(eventId, userId) : randomUUID(),
        userId,
        organizationId,
        providerCode,
        payload: data,
      });
      if (row) created.push(row);
    }
    return created;
  }

  async list(
    userId: string,
    opts: { read?: boolean; limit?: number; offset?: number } = {},
  ): Promise<NotificationListResult> {
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(opts.offset ?? 0, 0);
    const [notifications, unread] = await Promise.all([
      this.repo.listByUser(userId, { read: opts.read, limit, offset }),
      this.repo.countUnread(userId),
    ]);
    return { notifications, unread };
  }

  markRead(userId: string, id: string): Promise<boolean> {
    return this.repo.markRead(userId, id);
  }

  markAllRead(userId: string): Promise<number> {
    return this.repo.markAllRead(userId);
  }
}
