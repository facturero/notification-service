import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';

const envSchema = z.object({
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
