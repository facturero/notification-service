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

// Lo que publica restaurant-service (ver application/events.ts de ese servicio).
const created = {
  organizationId: 'org-1',
  reservationId: 'r-1',
  code: 'K7M2XQ9P',
  guestName: 'Ana Pérez',
  guestEmail: 'ana@example.com',
  guestPhone: '+593 99 888 7766',
  partySize: 4,
  notes: 'Cumpleaños, ¿pueden poner una vela?',
  dateText: 'sábado, 17 de octubre de 2026',
  timeText: '19:30',
  restaurantName: 'La Esquina',
  restaurantPhone: '+593 99 123 4567',
  staffNoticeEmail: 'dueno@laesquina.test',
  tableNames: 'Mesa 2, Mesa 3',
  manageUrl: 'https://reservas.noahsolution.com/r/abc123',
};

function handlerFor(event: string, mailer: Mailer) {
  return buildHandlers(mailer, prefs()).find((h) => h.eventType === event)!;
}

describe('reservas: correos de restaurant.reservation.created', () => {
  it('manda la confirmación al cliente y el aviso al restaurante', async () => {
    const mailer = new StubMailer();
    await handlerFor('restaurant.reservation.created', mailer).handle(created, undefined as any);

    expect(mailer.sent.map((m) => m.to)).toEqual(['ana@example.com', 'dueno@laesquina.test']);

    const [cliente, restaurante] = mailer.sent;
    expect(cliente!.subject).toBe('Reserva confirmada en La Esquina — sábado, 17 de octubre de 2026, 19:30');
    expect(cliente!.html).toContain('K7M2XQ9P');
    expect(cliente!.html).toContain('https://reservas.noahsolution.com/r/abc123');
    expect(cliente!.html).toContain('+593 99 123 4567');
    // El cliente no necesita ver qué mesas se eligieron ni los datos internos.
    expect(cliente!.html).not.toContain('Mesa 2');

    expect(restaurante!.subject).toBe('Nueva reserva: Ana Pérez (4 personas) — sábado, 17 de octubre de 2026, 19:30');
    expect(restaurante!.html).toContain('+593 99 888 7766');
    expect(restaurante!.html).toContain('Mesa 2, Mesa 3');
    expect(restaurante!.html).toContain('¿pueden poner una vela?');
  });

  it('escapa lo que escribe el cliente: un nombre con HTML no inyecta nada en el correo', async () => {
    const mailer = new StubMailer();
    await handlerFor('restaurant.reservation.created', mailer).handle(
      { ...created, guestName: '<script>alert(1)</script>', notes: '<img src=x onerror=alert(1)>' },
      undefined as any,
    );
    for (const m of mailer.sent) {
      expect(m.html).not.toContain('<script>alert(1)</script>');
      expect(m.html).not.toContain('<img src=x');
      expect(m.html).toContain('&lt;');
    }
  });

  it('una reserva anotada por teléfono (sin correo y sin aviso al restaurante) no manda nada y no falla', async () => {
    const mailer = new StubMailer();
    await handlerFor('restaurant.reservation.created', mailer).handle(
      { ...created, guestEmail: '', staffNoticeEmail: '' },
      undefined as any,
    );
    expect(mailer.sent).toHaveLength(0);
  });

  it('sin correo del cliente pero con aviso al restaurante, solo sale el aviso', async () => {
    const mailer = new StubMailer();
    await handlerFor('restaurant.reservation.created', mailer).handle({ ...created, guestEmail: '' }, undefined as any);
    expect(mailer.sent.map((m) => m.to)).toEqual(['dueno@laesquina.test']);
  });

  it('si el aviso al restaurante falla, el evento NO se reencola (repetiría la confirmación al cliente)', async () => {
    const calls: string[] = [];
    const mailer: Mailer = {
      send: vi.fn(async (to: string) => {
        calls.push(to);
        if (to === 'dueno@laesquina.test') throw new Error('smtp: buzón lleno');
      }),
    };
    await expect(handlerFor('restaurant.reservation.created', mailer).handle(created, undefined as any)).resolves.toBeUndefined();
    expect(calls).toEqual(['ana@example.com', 'dueno@laesquina.test']);
  });

  it('si falla la confirmación al cliente SÍ se propaga el error para que el consumidor reintente', async () => {
    const mailer: Mailer = { send: vi.fn().mockRejectedValue(new Error('smtp down')) };
    await expect(handlerFor('restaurant.reservation.created', mailer).handle(created, undefined as any)).rejects.toThrow('smtp down');
    // Y el aviso al restaurante no salió antes que la confirmación.
    expect(mailer.send).toHaveBeenCalledTimes(1);
  });
});

describe('reservas: correos de restaurant.reservation.cancelled', () => {
  const cancelled = { ...created, cancelledBy: 'guest', cancelReason: 'Cambio de planes', manageUrl: '' };

  it('cuando cancela el cliente: confirmación al cliente y aviso al restaurante', async () => {
    const mailer = new StubMailer();
    await handlerFor('restaurant.reservation.cancelled', mailer).handle(cancelled, undefined as any);
    expect(mailer.sent.map((m) => m.to)).toEqual(['ana@example.com', 'dueno@laesquina.test']);
    expect(mailer.sent[0]!.html).toContain('Se canceló');
    expect(mailer.sent[0]!.html).not.toContain('El restaurante canceló');
    expect(mailer.sent[1]!.subject).toContain('Reserva cancelada: Ana Pérez');
    expect(mailer.sent[1]!.html).toContain('Cambio de planes');
  });

  it('cuando cancela el restaurante: se lo dice al cliente y no se avisa al propio restaurante', async () => {
    const mailer = new StubMailer();
    await handlerFor('restaurant.reservation.cancelled', mailer).handle(
      { ...cancelled, cancelledBy: 'staff', staffNoticeEmail: '', cancelReason: 'Cerramos por mantenimiento' },
      undefined as any,
    );
    expect(mailer.sent.map((m) => m.to)).toEqual(['ana@example.com']);
    expect(mailer.sent[0]!.html).toContain('El restaurante canceló');
    expect(mailer.sent[0]!.html).toContain('Cerramos por mantenimiento');
  });
});
