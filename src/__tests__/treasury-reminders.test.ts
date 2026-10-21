import { describe, it, expect, vi } from 'vitest';
import { buildHandlers } from '../infrastructure/messaging/consumer';
import type { Mailer } from '../infrastructure/mailer/mailer.port';

class StubMailer implements Mailer {
  sent: Array<{ to: string; subject: string; html: string }> = [];
  async send(to: string, subject: string, html: string): Promise<void> {
    this.sent.push({ to, subject, html });
  }
}

const prefs = () => ({ isEnabled: async () => true, effectiveForUser: vi.fn(async () => []) }) as any;

// Lo que publica treasury-service (ver `receivableOverdueEvent` en application/events.ts de ese servicio).
const overdue = {
  organizationId: 'org-1',
  organizationName: 'La Esquina S.A.',
  customerId: 'c-1',
  customerName: 'Ana Pérez',
  email: 'ana@example.com',
  currencyCode: 'USD',
  runDate: '2026-10-21',
  totalOverdueCents: 17250,
  receivableCount: 2,
  extraItems: 0,
  items: [
    { receivableId: 'r-1', documentNumber: '001-001-000000123', dueDate: '2026-10-01', daysOverdue: 20, balanceCents: 11500 },
    { receivableId: 'r-2', documentNumber: null, dueDate: '2026-10-10', daysOverdue: 11, balanceCents: 5750 },
  ],
  trigger: 'scheduled',
  triggeredBy: null,
};

const handler = (mailer: Mailer) => buildHandlers(mailer, prefs()).find((h) => h.eventType === 'treasury.receivable.overdue')!;

describe('treasury.receivable.overdue: recordatorio de cobro al cliente', () => {
  it('se consume (hay un manejador registrado para el evento)', () => {
    expect(handler(new StubMailer())).toBeDefined();
  });

  it('manda UN correo al cliente, firmado por la organización, con el total y cada documento', async () => {
    const mailer = new StubMailer();
    await handler(mailer).handle(overdue, undefined as any);
    expect(mailer.sent).toHaveLength(1);
    const [mail] = mailer.sent;
    expect(mail!.to).toBe('ana@example.com');
    expect(mail!.subject).toBe('Recordatorio de pago — La Esquina S.A.');
    expect(mail!.html).toContain('Hola Ana Pérez');
    expect(mail!.html).toContain('La Esquina S.A.');
    expect(mail!.html).toContain('2 documento(s) vencido(s)');
    expect(mail!.html).toContain('172,50 USD');
    expect(mail!.html).toContain('001-001-000000123');
    expect(mail!.html).toContain('115,00 USD');
    expect(mail!.html).toContain('57,50 USD');
    expect(mail!.html).toContain('(20 d)');
    // un documento sin número no deja un hueco
    expect(mail!.html).toContain('—');
  });

  it('si hay más documentos de los que caben en el detalle, avisa cuántos faltan (ya van en el total)', async () => {
    const mailer = new StubMailer();
    await handler(mailer).handle({ ...overdue, receivableCount: 25, extraItems: 5 }, undefined as any);
    expect(mailer.sent[0]!.html).toContain('y 5 documento(s) más');
  });

  it('el nombre del cliente lo escribe cualquiera: se escapa, no se inyecta HTML', async () => {
    const mailer = new StubMailer();
    await handler(mailer).handle({ ...overdue, customerName: '<script>alert(1)</script>' }, undefined as any);
    expect(mailer.sent[0]!.html).not.toContain('<script>alert(1)</script>');
    expect(mailer.sent[0]!.html).toContain('&lt;script&gt;');
  });

  it('sin correo en el evento no manda nada ni lanza (no se reencola: reintentar no lo arreglaría)', async () => {
    const mailer = new StubMailer();
    await expect(handler(mailer).handle({ ...overdue, email: undefined }, undefined as any)).resolves.toBeUndefined();
    expect(mailer.sent).toHaveLength(0);
  });

  it('un evento sin el nombre de la organización se rechaza (no sale un correo sin firma)', async () => {
    const mailer = new StubMailer();
    await expect(handler(mailer).handle({ ...overdue, organizationName: '' }, undefined as any)).rejects.toThrow();
    expect(mailer.sent).toHaveLength(0);
  });
});
