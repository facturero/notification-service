import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';

const envSchema = z.object({
  PORT: z.coerce.number().default(3011),
  CORS_ORIGIN: z.string().default('*'),
  DB_HOST: z.string().default('mysql'),
  DB_PORT: z.coerce.number().default(3306),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default('root123'),
  DB_NAME: z.string().default('notification_db'),
  RABBITMQ_URL: z.string().default('amqp://rabbitmq:5672'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  FROM_EMAIL: z.string().default('no-reply@cmr.com'),
  FROM_NAME: z.string().default('CMR'),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('[config] invalid environment variables:', parsed.error.flatten());
    process.exit(1);
  }
  _config = parsed.data;
  return _config;
}

export interface TemplateEntry {
  event: string;
  template: string;
  subject: string;
  to: string;
  schema: Record<string, unknown>;
  /** true = el destinatario es opcional: si `to` resuelve vacío, el evento se
   *  descarta con log en vez de fallar el envío y reencolar (eventos que no
   *  garantizan email, p.ej. billing). Por defecto: el destinatario es
   *  obligatorio (requeue si falla, como con identity.*). */
  allowNullRecipient?: boolean;
}

let _templateConfig: TemplateEntry[] | null = null;

export function loadTemplateConfig(): TemplateEntry[] {
  if (_templateConfig) return _templateConfig;
  const configPath = path.resolve(__dirname, 'template-config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  _templateConfig = JSON.parse(raw) as TemplateEntry[];
  return _templateConfig;
}

export function findTemplateEntry(eventType: string): TemplateEntry | undefined {
  return loadTemplateConfig().find((e) => e.event === eventType);
}

/** Canales de notificación soportados. Al añadir uno, actualizar también el
 * frontend (matriz de preferencias) y el gate correspondiente. */
export const NOTIFICATION_CHANNELS = ['app', 'smtp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export interface NotificationProvider {
  /** Routing key del evento que dispara esta notificación. */
  code: string;
  /** Plugin del catálogo de plugins que expone la notificación. */
  pluginCode: string;
  /** Clave i18n del nombre visible (es/en/fr del frontend). */
  nameKey: string;
  descriptionKey: string;
  channels: NotificationChannel[];
  /** Valor por canal cuando el usuario no ha configurado nada. A lo Moodle:
   * cada provider declara sus defaults y el despachador los usa como base. */
  defaults: Record<NotificationChannel, boolean>;
}

let _providerConfig: NotificationProvider[] | null = null;

export function loadProviderConfig(): NotificationProvider[] {
  if (_providerConfig) return _providerConfig;
  const configPath = path.resolve(__dirname, 'provider-config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  _providerConfig = JSON.parse(raw) as NotificationProvider[];
  return _providerConfig;
}

export function findProvider(eventType: string): NotificationProvider | undefined {
  return loadProviderConfig().find((p) => p.code === eventType);
}
