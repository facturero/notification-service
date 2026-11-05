import { describe, it, expect, vi } from 'vitest';
import { buildHandlers } from '../infrastructure/messaging/consumer';
import { loadProviderConfig, loadTemplateConfig } from '../config';
import type { Mailer } from '../infrastructure/mailer/mailer.port';

class StubMailer implements Mailer {
  sent: Array<{ to: string; subject: string; html: string }> = [];
  async send(to: string, subject: string, html: string): Promise<void> {
    this.sent.push({ to, subject, html });
  }
}

function prefServiceStub(isEnabled: () => Promise<boolean> = async () => true) {
  return { isEnabled, effectiveForUser: vi.fn(async () => []) } as any;
}

describe('buildHandlers', () => {
  it('crea un handler por cada evento de plantilla y por cada proveedor que solo tiene campana', () => {
    const handlers = buildHandlers(new StubMailer(), prefServiceStub());
    const templates = loadTemplateConfig().map((e) => e.event);
    const appOnly = loadProviderConfig()
      .filter((p) => p.channels.includes('app') && !templates.includes(p.code))
      .map((p) => p.code);
    expect(appOnly).toContain('projects.task.assigned');
    expect(handlers.map((h) => h.eventType).sort()).toEqual([...templates, ...appOnly].sort());
  });

  it('un proveedor solo de campana guarda la notificación para cada destinatario y no manda correo', async () => {
    const mailer = new StubMailer();
    const recordForEvent = vi.fn(async (_event: string, payload: Record<string, unknown>) => (payload.userIds as string[]).map((id) => ({ id })));
    const handlers = buildHandlers(mailer, prefServiceStub(), { recordForEvent } as any);
    const handler = handlers.find((h) => h.eventType === 'projects.task.mentioned')!;

    await handler.handle({ organizationId: 'o-1', taskId: 't-1', title: 'Contrato', userIds: ['u-1', 'u-2'] }, { properties: { headers: { eventId: 'e-1' } } } as any);

    expect(recordForEvent).toHaveBeenCalledWith('projects.task.mentioned', expect.objectContaining({ userIds: ['u-1', 'u-2'] }), 'e-1');
    expect(mailer.sent).toHaveLength(0);
  });

  it('procesa un evento y envía el correo', async () => {
    const mailer = new StubMailer();
    const handlers = buildHandlers(mailer, prefServiceStub());
    const handler = handlers.find((h) => h.eventType === 'identity.user.invited')!;

    await handler.handle(
      {
        userId: 'u-1',
        email: 'user@example.com',
        organizationName: 'Acme',
        inviteUrl: 'http://localhost/invite/abc',
      },
      undefined as any,
    );

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('user@example.com');
    expect(mailer.sent[0].subject).toContain('Acme');
  });

  it('no envía por smtp si el usuario desactivó el canal para ese provider', async () => {
    const mailer = new StubMailer();
    const handlers = buildHandlers(
      mailer,
      prefServiceStub(async () => false),
    );
    const handler = handlers.find((h) => h.eventType === 'identity.user.enabled')!;

    await handler.handle(
      { userId: 'u-1', email: 'a@b.com', organizationName: 'Acme' },
      undefined as any,
    );

    expect(mailer.sent).toHaveLength(0);
  });

  it('propaga el error si el mailer falla (para que el consumer reintente)', async () => {
    const failMailer: Mailer = {
      send: vi.fn().mockRejectedValue(new Error('smtp down')),
    };
    const handlers = buildHandlers(failMailer, prefServiceStub());
    const handler = handlers.find((h) => h.eventType === 'identity.user.enabled')!;

    await expect(
      handler.handle({ email: 'a@b.com', organizationName: 'Acme' }, undefined as any),
    ).rejects.toThrow('smtp down');
  });
});