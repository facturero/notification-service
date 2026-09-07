import {
  loadProviderConfig,
  findProvider,
  NOTIFICATION_CHANNELS,
  NotificationChannel,
  NotificationProvider,
} from '../config.js';
import type { NotificationPreferenceRepository } from '../infrastructure/persistence/preferences-repository.js';

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  enabled: boolean;
  expiresAt: number;
}

/** Prioridad de consulta para un canal: preferencia explícita del usuario, y si
 * no la hay, el default declarado por el provider (estilo Moodle). */
function effectiveEnabled(
  stored: StoredMap,
  provider: NotificationProvider,
  channel: NotificationChannel,
): boolean {
  const explicit = stored.get(provider.code)?.get(channel);
  return explicit ?? provider.defaults[channel];
}

type StoredMap = Map<string, Map<string, boolean>>;

export class NotificationPreferenceService {
  private readonly repo: NotificationPreferenceRepository;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(repo: NotificationPreferenceRepository) {
    this.repo = repo;
  }

  /** Valor efectivo de un canal para un usuario: preferencia ??: default. */
  async isEnabled(userId: string, providerCode: string, channel: NotificationChannel): Promise<boolean> {
    const cacheKey = `${userId}:${providerCode}:${channel}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.enabled;

    const stored = await this.fetchStored(userId);
    const provider = findProvider(providerCode);
    if (!provider) return true; // provider desconocido -> fail-open (envía)
    const enabled = effectiveEnabled(stored, provider, channel);

    const entry = { enabled, expiresAt: Date.now() + CACHE_TTL_MS };
    this.cache.set(cacheKey, entry);
    return enabled;
  }

  /** Preferencias efectivas de TODOS los providers para pintar la matriz. */
  async effectiveForUser(userId: string): Promise<
    Array<{
      providerCode: string;
      pluginCode: string;
      nameKey: string;
      descriptionKey: string;
      channels: Record<NotificationChannel, boolean>;
    }>
  > {
    const stored = await this.fetchStored(userId);
    return loadProviderConfig().map((p) => ({
      providerCode: p.code,
      pluginCode: p.pluginCode,
      nameKey: p.nameKey,
      descriptionKey: p.descriptionKey,
      channels: {
        app: effectiveEnabled(stored, p, 'app'),
        smtp: effectiveEnabled(stored, p, 'smtp'),
      },
      // defaults se incluyen para que el frontend pueda renderizar "usando
      // defaults" y el botón "restablecer" (opcionales, no escalar el API).
    }));
  }

  /** Aplica cambios en lote: canales omitidos se mantienen (null = sin tocar),
   * canales explicitos se guardan. `enabled: null` restablece al default
   * borrando la preferencia (equivalente a "usar el valor por defecto"). */
  async apply(
    userId: string,
    updates: Array<{ providerCode: string; app?: boolean | null; smtp?: boolean | null }>,
  ): Promise<void> {
    for (const u of updates) {
      const provider = findProvider(u.providerCode);
      if (!provider) continue;
      for (const channel of NOTIFICATION_CHANNELS) {
        const value = u[channel as 'app' | 'smtp'];
        if (value === undefined) continue;
        if (value === null) {
          // Restablecer al default declarado por el provider: borra la fila,
          // así el efectivo vuelve a `defaults[channel]`.
          await this.repo.delete(userId, provider.code, channel);
        } else {
          await this.repo.upsert(userId, provider.code, channel, value);
        }
        this.cache.delete(`${userId}:${provider.code}:${channel}`);
      }
    }
  }

  private async fetchStored(userId: string): Promise<StoredMap> {
    const rows = await this.repo.findByUser(userId);
    const map: StoredMap = new Map();
    for (const r of rows) {
      if (!map.has(r.providerCode)) map.set(r.providerCode, new Map());
      map.get(r.providerCode)!.set(r.channel, r.enabled);
    }
    return map;
  }
}