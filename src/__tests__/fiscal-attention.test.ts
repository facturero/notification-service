import { describe, it, expect, vi } from 'vitest';
import { buildHandlers } from '../infrastructure/messaging/consumer';
import { NotificationService } from '../application/notifications';
import { findProvider, loadTemplateConfig } from '../config';
import type { Mailer } from '../infrastructure/mailer/mailer.port';
import type { NotificationRepository, StoredNotification } from '../infrastructure/persistence/notifications-repository';

const EVENT = 'fiscal.ec.invoice.attention_required';

/** Lo que publica fiscal-ecuador cuando una factura necesita a una persona. */
const payload = {
  fiscalInvoiceId: 'f-1',
  billingInvoiceId: 'inv-1',
  invoiceId: 'inv-1',
  organizationId: 'org-1',
  number: '001-001-000000001',
  status: 'rejected',
  type: 'rejected',
  message: '[39] FIRMA INVALIDA',
  requiresAttention: true,
  userId: 'user-1',
};

function memoryRepo(): NotificationRepository & { rows: StoredNotification[] } {
  const rows: StoredNotification[] = [];
  return {
    rows,
    create: vi.fn(async (row) => {
      const stored = { ...row, read: false, createdAt: new Date() };
      rows.push(stored);
      return stored;
    }),
    listByUser: vi.fn(async () => rows),
    countUnread: vi.fn(async () => rows.length),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  };
}

describe('Aviso de facturas fiscales que requieren atención', () => {
  const prefs = { isEnabled: vi.fn(async (_u: string, _p: string, channel: string) => channel === 'app') } as any;

  it('es un proveedor de la campana del plugin de facturación electrónica, solo canal app', () => {
    expect(findProvider(EVENT)).toMatchObject({ pluginCode: 'finance.electronic_invoicing', channels: ['app'] });
    expect(loadTemplateConfig().map((t) => t.event)).toContain(EVENT);
  });

  it('queda en la campana del usuario con el mensaje y el enlace, sin enviar correo', async () => {
    const repo = memoryRepo();
    const notifications = new NotificationService(repo, prefs);
    const mailer: Mailer & { sent: unknown[] } = { sent: [], send: vi.fn(async function (this: any, ...a) { mailer.sent.push(a); }) };

    const handler = buildHandlers(mailer, prefs, notifications).find((h) => h.eventType === EVENT)!;
    await handler.handle(payload, { properties: { headers: { eventId: 'evt-1' } } } as any);

    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ userId: 'user-1', providerCode: EVENT, organizationId: 'org-1' });
    expect(repo.rows[0].payload).toEqual({
      invoiceId: 'inv-1',
      number: '001-001-000000001',
      organizationId: 'org-1',
      message: '[39] FIRMA INVALIDA',
      status: 'rejected',
    });
    expect(mailer.sent).toHaveLength(0);
  });
});
