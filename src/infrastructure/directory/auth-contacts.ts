/** Correo y nombre de una persona, lo justo para escribirle. */
export interface Contact {
  email: string;
  fullName: string | null;
}

export interface ContactDirectory {
  /** Los usuarios activos de la organización, por id. */
  contactsOf(organizationId: string): Promise<Map<string, Contact>>;
}

const CACHE_TTL_MS = 60_000;

/**
 * Pide a auth-service (`GET /internal/organizations/:id/contacts`, con `X-Internal-Secret`) los correos de una organización.
 *
 * Los eventos de Proyectos solo traen ids: projects-service no guarda correos, y no debe, porque cambian en auth. Se pide la
 * organización entera (una llamada por evento, no una por destinatario) y se guarda un minuto: un comentario en una tarea con diez
 * seguidores no hace diez peticiones, y un cambio de correo tarda como mucho un minuto en notarse.
 */
export class AuthContactDirectory implements ContactDirectory {
  private readonly cache = new Map<string, { at: number; contacts: Map<string, Contact> }>();

  constructor(
    private readonly authUrl: string,
    private readonly internalSecret: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async contactsOf(organizationId: string): Promise<Map<string, Contact>> {
    const hit = this.cache.get(organizationId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.contacts;

    const res = await this.fetchFn(`${this.authUrl}/internal/organizations/${encodeURIComponent(organizationId)}/contacts`, {
      headers: { 'X-Internal-Secret': this.internalSecret, Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`auth-service respondió ${res.status} al pedir los contactos de ${organizationId}`);
    const body = (await res.json()) as { users?: Array<{ id: string; email: string; fullName: string | null }> };
    const contacts = new Map((body.users ?? []).map((u) => [u.id, { email: u.email, fullName: u.fullName }] as const));
    this.cache.set(organizationId, { at: Date.now(), contacts });
    return contacts;
  }
}
