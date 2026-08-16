import Handlebars from 'handlebars';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import type { TemplateEntry } from '../config';
import { TemplateNotFoundError, TemplateValidationError } from '../domain/errors';

function buildZodSchema(entry: TemplateEntry): z.ZodType<unknown> {
  const schema = entry.schema as Record<string, unknown>;
  const required = (schema.required as string[]) ?? [];
  const properties = schema.properties as Record<string, Record<string, unknown>> ?? {};

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, val] of Object.entries(properties)) {
    let field: z.ZodTypeAny = z.string();
    if (val.minLength) field = (field as z.ZodString).min(val.minLength as number);
    shape[key] = required.includes(key) ? field : field.optional();
  }

  return z.object(shape);
}

const templateCache = new Map<string, HandlebarsTemplateDelegate>();

function compileTemplate(templatePath: string): HandlebarsTemplateDelegate {
  const cached = templateCache.get(templatePath);
  if (cached) return cached;

  const source = fs.readFileSync(templatePath, 'utf-8');
  const compiled = Handlebars.compile(source);
  templateCache.set(templatePath, compiled);
  return compiled;
}

export interface RenderResult {
  html: string;
  subject: string;
  to: string;
}

export function render(entry: TemplateEntry, payload: Record<string, unknown>): RenderResult {
  const schema = buildZodSchema(entry);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new TemplateValidationError(entry.event, parsed.error.message);
  }

  const templatesDir = path.resolve(__dirname, '..', 'templates');
  const templatePath = path.resolve(templatesDir, entry.template);

  if (!fs.existsSync(templatePath)) {
    throw new TemplateNotFoundError(entry.event);
  }

  const tpl = compileTemplate(templatePath);
  const html = tpl(payload);

  const subjectTpl = Handlebars.compile(entry.subject);
  const subject = subjectTpl(payload);

  const toTpl = Handlebars.compile(entry.to);
  const to = toTpl(payload);

  return { html, subject, to };
}
