import { describe, expect, it, vi } from 'vitest';
import { NotificationService } from '../application/notifications.js';
import { findProvider } from '../config.js';
import type { NotificationRepository, StoredNotification } from '../infrastructure/persistence/notifications-repository.js';

// Campana de la mensajería (chat-service, `chat.message.created`): solo canal `app` y AGRUPADA por conversación — tres mensajes
// seguidos en #ventas son UNA campana con su contador, no tres. Y nunca el texto (el evento no lo trae).

function memoryRepo(): NotificationRepository & { rows: StoredNotification[] } {
  const rows: StoredNotification[] = [];
  return {
    rows,
    create: vi.fn(async (row) => {
      if (rows.some((r) => r.id === row.id)) return null;
      const stored = { ...row, read: false, createdAt: new Date() };
      rows.push(stored);
      return stored;
    }),
    listByUser: vi.fn(async () => rows),
    countUnread: vi.fn(async () => rows.filter((r) => !r.read).length),
    markRead: vi.fn(async (_u: string, id: string) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.read = true;
      return !!r;
    }),
    markAllRead: vi.fn(),
    findUnreadByKey: vi.fn(async (userId: string, providerCode: string, key: string, value: string) =>
      rows.find((r) => r.userId === userId && r.providerCode === providerCode && !r.read && r.payload?.[key] === value) ?? null,
    ),
    refresh: vi.fn(async (id: string, payload: Record<string, unknown>, at: Date) => {
      const r = rows.find((x) => x.id === id)!;
      r.payload = payload;
      r.createdAt = at;
    }),
  };
}

const prefs = { isEnabled: vi.fn(async (_u: string, _p: string, channel: string) => channel === 'app') } as any;
const event = (n: number, conversationId = 'conv-ventas') => ({
  organizationId: 'org-1',
  conversationId,
  conversationName: 'ventas',
  messageId: `m-${n}`,
  senderId: 'ana',
  actorId: 'ana',
  kind: 'channel',
  userIds: ['bruno'],
  // Lo que el chat jamás manda, pero si llegara no debe guardarse: la lista blanca de la campana lo descarta.
  bodyText: 'texto privado',
});

describe('campana del chat', () => {
  it('existe como provider solo de campana y agrupado por conversación', () => {
    expect(findProvider('chat.message.created')).toMatchObject({ pluginCode: 'comm.internal_chat', channels: ['app'], collapseBy: 'conversationId' });
  });

  it('tres mensajes en la misma conversación: una sola campana sin leer con count = 3, arriba y sin texto', async () => {
    const repo = memoryRepo();
    const svc = new NotificationService(repo, prefs);
    for (const n of [1, 2, 3]) await svc.recordForEvent('chat.message.created', event(n), `e-${n}`);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].payload).toMatchObject({ conversationId: 'conv-ventas', messageId: 'm-3', count: 3 });
    expect(JSON.stringify(repo.rows[0].payload)).not.toContain('texto privado');
  });

  it('otra conversación abre otra campana; leída la primera, el siguiente mensaje abre una nueva', async () => {
    const repo = memoryRepo();
    const svc = new NotificationService(repo, prefs);
    await svc.recordForEvent('chat.message.created', event(1), 'e-1');
    await svc.recordForEvent('chat.message.created', event(2, 'conv-dm'), 'e-2');
    expect(repo.rows).toHaveLength(2);
    await repo.markRead('bruno', repo.rows[0].id);
    await svc.recordForEvent('chat.message.created', event(3), 'e-3');
    expect(repo.rows).toHaveLength(3);
    expect(repo.rows[2].payload).toMatchObject({ count: 1 });
  });

  it('el reintento del mismo evento no suma dos veces', async () => {
    const repo = memoryRepo();
    const svc = new NotificationService(repo, prefs);
    await svc.recordForEvent('chat.message.created', event(1), 'e-1');
    await svc.recordForEvent('chat.message.created', event(2), 'e-2');
    await svc.recordForEvent('chat.message.created', event(2), 'e-2');
    expect(repo.rows[0].payload).toMatchObject({ count: 2 });
  });
});
