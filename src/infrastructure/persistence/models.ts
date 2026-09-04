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
