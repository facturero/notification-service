import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { loadProviderConfig } from '../../config.js';
import { NotificationPreferenceService } from '../../application/preferences.js';
import { NotificationService } from '../../application/notifications.js';
import { readUser } from './middlewares.js';

export interface AppDependencies {
  preferenceService: NotificationPreferenceService;
  notificationService: NotificationService;
  corsOrigin: string;
}

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.use('*', cors({ origin: deps.corsOrigin }));

  // Mismo patrón que billing: el manejo global de errores va en `onError`
  // (en Hono ^4 un app.use con try/catch NO ve excepciones de handlers).
  app.onError(async (err: any, c) => {
    const status = err.statusCode || 500;
    const code = err.name || 'InternalError';
    const message = err.message || 'Error interno del servidor';
    if (status === 500) {
      console.error('[notification] Error:', err);
    }
    return c.json({ code, message }, status);
  });

  // Catálogo de providers (estilo Moodle): quién los declara (pluginCode) y qué
  // canales expone. El frontend cruza contra los plugins activos de la org.
  // El gateway reenvía /notifications/* completo (stripPrefix ''), por eso los
  // paths llevan el prefijo /notifications.
  app.get('/notifications/providers', (c) => {
    return c.json({
      providers: loadProviderConfig().map((p) => ({
        code: p.code,
        pluginCode: p.pluginCode,
        nameKey: p.nameKey,
        descriptionKey: p.descriptionKey,
        channels: p.channels,
        defaults: p.defaults,
      })),
      channels: ['app', 'smtp'],
    });
  });

  // Preferencias efectivas del usuario: preferencia ??: default del provider.
  app.get('/notifications/me/preferences', async (c) => {
    const { userId } = readUser(c);
    const effective = await deps.preferenceService.effectiveForUser(userId);
    return c.json({ preferences: effective });
  });

  // Guarda preferencias (lote). Canales omitidos = no tocar; null = reset.
  app.put('/notifications/me/preferences', async (c) => {
    const { userId } = readUser(c);
    const raw = await c.req.json().catch(() => null);
    if (!raw || !Array.isArray((raw as any)?.preferences)) {
      return c.json({ code: 'INVALID_BODY', message: 'Se esperaba { preferences: [...] }' }, 400);
    }
    const updates: Array<{ providerCode: string; app?: boolean | null; smtp?: boolean | null }> = [];
    for (const p of (raw as any).preferences) {
      if (!p || typeof p !== 'object' || typeof p.providerCode !== 'string') {
        return c.json({ code: 'INVALID_PROVIDER', message: 'providerCode inválido' }, 400);
      }
      const clean: { providerCode: string; app?: boolean | null; smtp?: boolean | null } = {
        providerCode: p.providerCode,
      };
      if (p.app !== undefined) {
        if (p.app !== null && typeof p.app !== 'boolean') {
          return c.json({ code: 'INVALID_CHANNEL_VALUE', message: 'app debe ser boolean o null' }, 400);
        }
        clean.app = p.app;
      }
      if (p.smtp !== undefined) {
        if (p.smtp !== null && typeof p.smtp !== 'boolean') {
          return c.json({ code: 'INVALID_CHANNEL_VALUE', message: 'smtp debe ser boolean o null' }, 400);
        }
        clean.smtp = p.smtp;
      }
      updates.push(clean);
    }
    await deps.preferenceService.apply(userId, updates);
    const effective = await deps.preferenceService.effectiveForUser(userId);
    return c.json({ preferences: effective }, 200);
  });

  // ── Bandeja in-app (canal `app`) ──────────────────────────────────────────
  // La campana del frontend lee de aquí: el socket solo avisa de que hay algo
  // nuevo, la lista y el estado de leído son siempre los del servidor.
  app.get('/notifications', async (c) => {
    const { userId } = readUser(c);
    const readParam = c.req.query('read');
    const read = readParam === undefined ? undefined : readParam === 'true';
    const limit = Number(c.req.query('limit'));
    const offset = Number(c.req.query('offset'));

    const result = await deps.notificationService.list(userId, {
      read,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });

    return c.json({
      notifications: result.notifications.map((n) => ({
        id: n.id,
        // `event` y no `providerCode`: es la routing key, y es lo que el
        // frontend ya usa como clave para el título y el deep-link.
        event: n.providerCode,
        data: n.payload ?? {},
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
      unread: result.unread,
    });
  });

  app.post('/notifications/read-all', async (c) => {
    const { userId } = readUser(c);
    const updated = await deps.notificationService.markAllRead(userId);
    return c.json({ updated }, 200);
  });

  app.post('/notifications/:id/read', async (c) => {
    const { userId } = readUser(c);
    const ok = await deps.notificationService.markRead(userId, c.req.param('id'));
    if (!ok) {
      return c.json({ code: 'NOT_FOUND', message: 'Notificación no encontrada' }, 404);
    }
    return c.json({ ok: true }, 200);
  });

  app.get('/health', (c) => c.json({ status: 'ok' }));

  return app;
}