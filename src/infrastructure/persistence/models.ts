import { Sequelize, DataTypes, Model } from 'sequelize';

const DB_NAME = process.env.DB_NAME || 'notification_db';
const DB_HOST = process.env.DB_HOST || 'mysql';
const DB_PORT = Number(process.env.DB_PORT) || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || 'root123';

export const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  port: DB_PORT,
  dialect: 'mysql',
  logging: false,
});

export class ProcessedEventModel extends Model {
  declare id: string;
  declare eventType: string;
  declare routingKey: string;
  declare payload: string;
  declare status: string;
  declare lastError: string | null;
  declare processedAt: Date;
}

ProcessedEventModel.init(
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    eventType: { type: DataTypes.STRING(100), allowNull: false, field: 'event_type' },
    routingKey: { type: DataTypes.STRING(200), allowNull: false, field: 'routing_key' },
    payload: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'processed',
    },
    lastError: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'last_error',
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'processed_at',
    },
  },
  {
    sequelize,
    tableName: 'processed_events',
    timestamps: false,
    indexes: [{ unique: true, fields: ['id'] }],
  },
);

/** Preferencias de notificación por usuario (estilo Moodle): un provider
 * (declarado por un plugin en provider-config.json) × canal (app/smtp) tiene
 * un valor enabled. PK compuesta (user_id, provider_code, channel). */
export class NotificationPreferenceModel extends Model {
  declare userId: string;
  declare providerCode: string;
  declare channel: string;
  declare enabled: boolean;
  declare updatedAt: Date;
}

NotificationPreferenceModel.init(
  {
    userId: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      primaryKey: true,
      field: 'user_id',
    },
    providerCode: {
      type: DataTypes.STRING(100),
      allowNull: false,
      primaryKey: true,
      field: 'provider_code',
    },
    channel: {
      type: DataTypes.STRING(20),
      allowNull: false,
      primaryKey: true,
    },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'updated_at',
    },
  },
  {
    sequelize,
    tableName: 'notification_preferences',
    timestamps: false,
  },
);

/** Notificación in-app persistida (canal `app`). `read` se mapea a la columna
 * `is_read` porque `READ` es palabra reservada en MySQL. */
export class NotificationModel extends Model {
  declare id: string;
  declare userId: string;
  declare organizationId: string | null;
  declare providerCode: string;
  declare payload: Record<string, unknown> | null;
  declare read: boolean;
  declare createdAt: Date;
}

NotificationModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    userId: { type: DataTypes.CHAR(36), allowNull: false, field: 'user_id' },
    organizationId: {
      type: DataTypes.CHAR(36),
      allowNull: true,
      field: 'organization_id',
    },
    providerCode: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: 'provider_code',
    },
    payload: { type: DataTypes.JSON, allowNull: true },
    read: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_read',
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at',
    },
  },
  {
    sequelize,
    tableName: 'notifications',
    timestamps: false,
  },
);
