import { Op } from 'sequelize';
import { NotificationModel } from './models.js';

export interface StoredNotification {
  id: string;
  userId: string;
  organizationId: string | null;
  providerCode: string;
  payload: Record<string, unknown> | null;
  read: boolean;
  createdAt: Date;
}

export interface ListOptions {
  /** undefined = todas; true/false filtra por estado de lectura. */
  read?: boolean;
  limit: number;
  offset: number;
}

export interface NotificationRepository {
  /** Inserta si el id no existe. Devuelve null si ya estaba (reproceso del
   *  mismo evento): el id se deriva de `eventId`+`userId`, así que un reintento
   *  no duplica la campana. */
  create(row: Omit<StoredNotification, 'read' | 'createdAt'>): Promise<StoredNotification | null>;
  listByUser(userId: string, opts: ListOptions): Promise<StoredNotification[]>;
  countUnread(userId: string): Promise<number>;
  /** Devuelve false si la notificación no existe o no es de ese usuario. */
  markRead(userId: string, id: string): Promise<boolean>;
  markAllRead(userId: string): Promise<number>;
}

function toStored(row: NotificationModel): StoredNotification {
  return {
    id: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    providerCode: row.providerCode,
    payload: row.payload,
    read: row.read,
    createdAt: row.createdAt,
  };
}

export class SequelizeNotificationRepository implements NotificationRepository {
  async create(
    row: Omit<StoredNotification, 'read' | 'createdAt'>,
  ): Promise<StoredNotification | null> {
    const [created, inserted] = await NotificationModel.findOrCreate({
      where: { id: row.id },
      defaults: { ...row, read: false, createdAt: new Date() },
    });
    return inserted ? toStored(created) : null;
  }

  async listByUser(userId: string, opts: ListOptions): Promise<StoredNotification[]> {
    const rows = await NotificationModel.findAll({
      where: {
        userId,
        ...(opts.read === undefined ? {} : { read: opts.read }),
      },
      order: [['createdAt', 'DESC']],
      limit: opts.limit,
      offset: opts.offset,
    });
    return rows.map(toStored);
  }

  async countUnread(userId: string): Promise<number> {
    return NotificationModel.count({ where: { userId, read: false } });
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    // El userId va en el WHERE, no solo el id: nadie marca como leída la
    // notificación de otro aunque acierte el uuid.
    const [affected] = await NotificationModel.update(
      { read: true },
      { where: { id, userId, read: false } },
    );
    if (affected > 0) return true;
    // 0 filas puede ser "no existe / no es tuya" o "ya estaba leída"; solo lo
    // primero es un 404 para el cliente.
    const exists = await NotificationModel.count({ where: { id, userId } });
    return exists > 0;
  }

  async markAllRead(userId: string): Promise<number> {
    const [affected] = await NotificationModel.update(
      { read: true },
      { where: { userId, read: { [Op.eq]: false } } },
    );
    return affected;
  }
}
