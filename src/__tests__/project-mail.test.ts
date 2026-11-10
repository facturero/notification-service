import { describe, it, expect, vi } from 'vitest';
import { ProjectMailService, projectMailContent } from '../application/project-mail';
import { buildHandlers } from '../infrastructure/messaging/consumer';
import { AuthContactDirectory, type Contact } from '../infrastructure/directory/auth-contacts';
import type { Mailer } from '../infrastructure/mailer/mailer.port';

class StubMailer implements Mailer {
  sent: Array<{ to: string; subject: string; html: string }> = [];
  async send(to: string, subject: string, html: string): Promise<void> {
    this.sent.push({ to, subject, html });
  }
}

const APP = 'https://crm.test';
const people: Record<string, Contact> = {
  ana: { email: 'ana@test.com', fullName: 'Ana Pérez' },
  beto: { email: 'beto@test.com', fullName: null },
  carla: { email: 'carla@test.com', fullName: 'Carla' },
};

function setup(opts: { smtpOff?: string[] } = {}) {
  const mailer = new StubMailer();
  const contactsOf = vi.fn(async () => new Map(Object.entries(people)));
  const prefs = { isEnabled: vi.fn(async (userId: string) => !(opts.smtpOff ?? []).includes(userId)) };
  const service = new ProjectMailService(mailer, prefs as any, { contactsOf }, APP);
  return { mailer, contactsOf, prefs, service };
}

const mention = {
  organizationId: 'org-1',
  actorId: 'ana',
  taskId: 't-1',
  title: 'Contrato <Acme>',
  projectIds: ['p-1'],
  excerpt: '@Beto revisa la cláusula 3 <b>ya</b>',
  userIds: ['beto', 'carla', 'ana', 'intruso'],
};

describe('avisos de Proyectos por correo', () => {
  it('escribe a cada destinatario con el canal activo, con el nombre de quien lo causó y el enlace a la tarea', async () => {
    const { mailer, service } = setup();
    const sent = await service.send('projects.task.mentioned', mention);

    expect(sent).toBe(2);
    expect(mailer.sent.map((m) => m.to)).toEqual(['beto@test.com', 'carla@test.com']);
    expect(mailer.sent[0]!.subject).toBe('Ana Pérez te mencionó en «Contrato <Acme>»');
    // Handlebars escapa el `=` del enlace (`&#x3D;`): el navegador lo decodifica igual, y así un id raro no rompe el atributo.
    expect(mailer.sent[0]!.html.replace(/&#x3D;/g, '=')).toContain(`href="${APP}/projects/p-1?task=t-1"`);
    expect(mailer.sent[1]!.html).toContain('Hola Carla,');
  });

  it('nunca escribe a quien causó el aviso, ni a un id que no está entre los activos de la organización', async () => {
    const { mailer, service } = setup();
    await service.send('projects.task.mentioned', mention);
    expect(mailer.sent.map((m) => m.to)).not.toContain('ana@test.com');
    expect(mailer.sent).toHaveLength(2);
  });

  it('el texto del comentario va escapado: no se puede meter HTML en el correo', async () => {
    const { mailer, service } = setup();
    await service.send('projects.task.mentioned', mention);
    expect(mailer.sent[0]!.html).toContain('&lt;b&gt;ya&lt;/b&gt;');
    expect(mailer.sent[0]!.html).not.toContain('<b>ya</b>');
  });

  it('respeta la preferencia: con el correo desactivado no se manda nada a esa persona', async () => {
    const { mailer, service } = setup({ smtpOff: ['beto'] });
    await service.send('projects.task.mentioned', mention);
    expect(mailer.sent.map((m) => m.to)).toEqual(['carla@test.com']);
  });

  it('sin organización en el evento no pregunta por correos ni manda nada', async () => {
    const { mailer, service, contactsOf } = setup();
    await service.send('projects.task.mentioned', { ...mention, organizationId: undefined });
    expect(contactsOf).not.toHaveBeenCalled();
    expect(mailer.sent).toHaveLength(0);
  });

  it('si nadie lo quiere por correo, ni siquiera pide los contactos', async () => {
    const { service, contactsOf } = setup({ smtpOff: ['beto', 'carla', 'intruso'] });
    await service.send('projects.task.mentioned', mention);
    expect(contactsOf).not.toHaveBeenCalled();
  });

  it('un envío que falla no impide los demás', async () => {
    const { service, mailer } = setup();
    const send = vi.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('smtp caído'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await service.send('projects.task.mentioned', mention)).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });

  it('cada evento tiene su frase; uno que no es aviso no se manda', () => {
    const ana = people.ana;
    const base = { title: 'Informe', taskId: 't', projectIds: ['p'], projectName: 'Web' };
    expect(projectMailContent('projects.task.assigned', base, ana, APP)?.subject).toBe('Ana Pérez te asignó «Informe»');
    expect(projectMailContent('projects.task.due_soon', { ...base, when: 'today' }, undefined, APP)?.subject).toBe('«Informe» vence hoy');
    expect(projectMailContent('projects.approval.decided', { ...base, decision: 'changes_requested' }, ana, APP)?.subject).toBe(
      'Ana Pérez pidió cambios en «Informe»',
    );
    expect(projectMailContent('projects.member.added', { projectId: 'p', projectName: 'Web' }, undefined, APP)).toMatchObject({
      subject: 'Alguien te añadió a «Web»',
      url: `${APP}/projects/p`,
    });
    expect(projectMailContent('projects.status_update.posted', { projectId: 'p', projectName: 'Web', status: 'at_risk' }, ana, APP)?.subject).toBe(
      'Estado de «Web»: en riesgo',
    );
    expect(projectMailContent('projects.task.moved', base, ana, APP)).toBeNull();
  });
});

describe('consumidor: los avisos de Proyectos van a la campana y, después, al correo', () => {
  const prefs = { isEnabled: async () => true, effectiveForUser: vi.fn(async () => []) } as any;

  it('guarda la campana y luego manda los correos', async () => {
    const order: string[] = [];
    const recordForEvent = vi.fn(async () => { order.push('campana'); return [{ id: 'n' }]; });
    const send = vi.fn(async () => { order.push('correo'); return 1; });
    const handler = buildHandlers(new StubMailer(), prefs, { recordForEvent } as any, { send }).find((h) => h.eventType === 'projects.task.assigned')!;

    await handler.handle({ organizationId: 'o', userIds: ['u'] }, { properties: { headers: { eventId: 'e' } } } as any);
    expect(order).toEqual(['campana', 'correo']);
  });

  it('si el correo falla, el evento no se reencola (la campana ya quedó)', async () => {
    const recordForEvent = vi.fn(async () => [{ id: 'n' }]);
    const send = vi.fn(async () => { throw new Error('auth caído'); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = buildHandlers(new StubMailer(), prefs, { recordForEvent } as any, { send }).find((h) => h.eventType === 'projects.task.assigned')!;

    await expect(handler.handle({ organizationId: 'o', userIds: ['u'] }, { properties: { headers: {} } } as any)).resolves.toBeUndefined();
    errors.mockRestore();
  });
});

describe('directorio de auth', () => {
  it('pide los contactos con el secreto interno y los guarda un minuto', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ users: [{ id: 'u', email: 'u@test.com', fullName: 'U' }] }), { status: 200 }));
    const dir = new AuthContactDirectory('http://auth:3001', 's3cr3t', fetchFn as any);

    expect((await dir.contactsOf('org-1')).get('u')).toEqual({ email: 'u@test.com', fullName: 'U' });
    await dir.contactsOf('org-1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://auth:3001/internal/organizations/org-1/contacts');
    expect((init.headers as Record<string, string>)['X-Internal-Secret']).toBe('s3cr3t');
  });

  it('si auth responde con error, lanza (y el consumidor lo registra sin reencolar)', async () => {
    const dir = new AuthContactDirectory('http://auth:3001', 'x', (async () => new Response('', { status: 401 })) as any);
    await expect(dir.contactsOf('org-1')).rejects.toThrow('401');
  });
});
