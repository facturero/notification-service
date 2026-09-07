import { NotificationPreferenceModel } from './models.js';

export interface StoredPreference {
  providerCode: string;
  channel: string;
  enabled: boolean;
}

export interface NotificationPreferenceRepository {
  findByUser(userId: string): Promise<StoredPreference[]>;
  upsert(userId: string, providerCode: string, channel: string, enabled: boolean): Promise<void>;
  delete(userId: string, providerCode: string, channel: string): Promise<void>;
}

export class SequelizeNotificationPreferenceRepository implements NotificationPreferenceRepository {
  async findByUser(userId: string): Promise<StoredPreference[]> {
    const rows = await NotificationPreferenceModel.findAll({
      where: { userId },
    });
    return rows.map((r) => ({
      providerCode: r.providerCode,
      channel: r.channel,
      enabled: r.enabled,
    }));
  }

  async upsert(userId: string, providerCode: string, channel: string, enabled: boolean): Promise<void> {
    await NotificationPreferenceModel.upsert({
      userId,
      providerCode,
      channel,
      enabled,
      updatedAt: new Date(),
    });
  }

  async delete(userId: string, providerCode: string, channel: string): Promise<void> {
    await NotificationPreferenceModel.destroy({
      where: { userId, providerCode, channel },
    });
  }
}