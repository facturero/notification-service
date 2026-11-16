import { describe, it, expect, vi } from 'vitest';
import { ProjectMailService } from '../application/project-mail';
import { feedbackMailContent, FEEDBACK_MAIL_TEMPLATE } from '../application/feedback-mail';
import { buildHandlers, consumedEvents } from '../infrastructure/messaging/consumer';
import { findProvider } from '../config';
import type { Contact } from '../infrastructure/directory/auth-contacts';
import type { Mailer } from '../infrastructure/mailer/mailer.port';

class StubMailer implements Mailer {
  sent: Array<{ to: string; subject: string; html: string }> = [];
  async send(to: string, subject: string, html: string): Promise<void> {
    this.sent.push({ to, subject, html });
  }
}

const APP = 'https://crm.test';
const people: Record<string, Contact> = { sofia: { email: 'sofia@test.com', fullName: 'Sofía' } };
const EVENTS = ['feedback.reply.created', 'feedback.item.status_changed', 'feedback.points.granted'];

function setup(opts: { smtpOff?: boolean } = {}) {
  const mailer = new StubMailer();
  const contactsOf = vi.fn(async () => new Map(Object.entries(people)));
  const prefs = { isEnabled: vi.fn(async () => !opts.smtpOff) };
  const service = new ProjectMailService(mailer, prefs as any, { contactsOf }, APP, feedbackMailContent, FEEDBACK_MAIL_TEMPLATE);
  return { mailer, contactsOf, service };
}

const reply = { organizationId: 'org-1', itemId: 'it-1', kind: 'improvement', authorId: 'sofia', replyId: 'r-1', fromPlatform: true, userIds: ['sofia'] };

describe('avisos de Comentarios y mejoras', () => {
  it('los tres eventos son proveedores de campana y correo, y la cola los escucha', () => {
    for (const e of EVENTS) {
      expect(findProvider(e)).toMatchObject({ pluginCode: 'core.feedback', channels: ['app', 'smtp'] });
      expect(consumedEvents()).toContain(e);
    }
    // El correo por defecto solo para la respuesta: «Responder» del dueño suele traer respuesta, estado y puntos a la vez, y tres
    // correos por un clic serían ruido. La campana, en los tres.
    expect(findProvider('feedback.reply.created')!.defaults).toEqual({ app: true, smtp: true });
    expect(findProvider('feedback.item.status_changed')!.defaults).toEqual({ app: true, smtp: false });
    expect(findProvider('feedback.points.granted')!.defaults).toEqual({ app: true, smtp: false });
  });

  it('la respuesta llega por correo a quien escribió, con su plantilla y el enlace al envío', async () => {
    const { mailer, service } = setup();
    expect(await service.send('feedback.reply.created', reply)).toBe(1);
    expect(mailer.sent[0]!.to).toBe('sofia@test.com');
    expect(mailer.sent[0]!.subject).toBe('Te respondimos sobre tu mejora');
    expect(mailer.sent[0]!.html).toContain('Comentarios y mejoras');
    expect(mailer.sent[0]!.html).not.toContain('participas en esta tarea');
    expect(mailer.sent[0]!.html.replace(/&#x3D;/g, '=')).toContain(`href="${APP}/feedback?id=it-1"`);
  });

  it('cambio de estado y puntos dicen qué pasó; un ajuste a la baja no se anuncia por correo', () => {
    expect(feedbackMailContent('feedback.item.status_changed', { ...reply, status: 'accepted' }, undefined, APP)?.subject).toBe('Tu mejora: Aceptada');
    expect(feedbackMailContent('feedback.item.status_changed', { ...reply, kind: 'problem', status: 'implemented' }, undefined, APP)?.heading).toBe(
      'Tu reporte ahora está «Implementada»',
    );
    expect(feedbackMailContent('feedback.points.granted', { itemId: 'it-1', amount: 50 }, undefined, APP)?.subject).toBe('Tu empresa ganó 50 puntos');
    expect(feedbackMailContent('feedback.points.granted', { itemId: 'it-1', amount: -20 }, undefined, APP)).toBeNull();
    expect(feedbackMailContent('feedback.item.created', reply, undefined, APP)).toBeNull();
  });

  it('respeta la preferencia de correo', async () => {
    const { mailer, service, contactsOf } = setup({ smtpOff: true });
    expect(await service.send('feedback.reply.created', reply)).toBe(0);
    expect(contactsOf).not.toHaveBeenCalled();
    expect(mailer.sent).toHaveLength(0);
  });

  it('el consumidor guarda la campana con itemId, estado y puntos (sin textos) y manda el correo con el servicio de feedback', async () => {
    const recordForEvent = vi.fn(async () => [{ id: 'n-1' }]);
    const projectMail = { send: vi.fn(async () => 0) };
    const feedbackMail = { send: vi.fn(async () => 1) };
    const handler = buildHandlers(new StubMailer(), { isEnabled: async () => true } as any, { recordForEvent } as any, projectMail, feedbackMail).find(
      (h) => h.eventType === 'feedback.reply.created',
    )!;
    await handler.handle(reply, { properties: { headers: { eventId: 'e-1' } } } as any);
    expect(recordForEvent).toHaveBeenCalledWith('feedback.reply.created', reply, 'e-1');
    expect(feedbackMail.send).toHaveBeenCalledWith('feedback.reply.created', reply);
    expect(projectMail.send).not.toHaveBeenCalled();
  });
});
