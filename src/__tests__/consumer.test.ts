import { describe, it, expect, vi } from 'vitest';
import { buildHandlers } from '../infrastructure/messaging/consumer';
import { loadTemplateConfig } from '../config';
import type { Mailer } from '../infrastructure/mailer/mailer.port';

class StubMailer implements Mailer {
  sent: Array<{ to: string; subject: string; html: string }> = [];
  async send(to: string, subject: string, html: string): Promise<void> {
    this.sent.push({ to, subject, html });
  }
}

describe('buildHandlers', () => {
  it('crea un handler por cada evento de plantilla', () => {
    const handlers = buildHandlers(new StubMailer());
    const events = loadTemplateConfig().map((e) => e.event);
    expect(handlers.map((h) => h.eventType).sort()).toEqual([...events].sort());
  });

  it('procesa un evento y envía el correo', async () => {
    const mailer = new StubMailer();
    const handlers = buildHandlers(mailer);
    const handler = handlers.find((h) => h.eventType === 'identity.user.invited')!;

    await handler.handle(
      {
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

  it('propaga el error si el mailer falla (para que el consumer reintente)', async () => {
    const failMailer: Mailer = {
      send: vi.fn().mockRejectedValue(new Error('smtp down')),
    };
    const handlers = buildHandlers(failMailer);
    const handler = handlers.find((h) => h.eventType === 'identity.user.enabled')!;

    await expect(
      handler.handle({ email: 'a@b.com', organizationName: 'Acme' }, undefined as any),
    ).rejects.toThrow('smtp down');
  });
});
