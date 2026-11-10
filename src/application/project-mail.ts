import { render } from '../infrastructure/template-engine.js';
import type { Mailer } from '../infrastructure/mailer/mailer.port.js';
import type { Contact, ContactDirectory } from '../infrastructure/directory/auth-contacts.js';
import type { NotificationPreferenceService } from './preferences.js';

/** Lo que dice el correo. `subject` va tal cual (texto plano); el resto lo escapa la plantilla. */
export interface ProjectMailContent {
  subject: string;
  heading: string;
  quote?: string;
  ctaLabel: string;
  url: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Si un evento no trae nombre de persona, el correo no inventa uno: dice «Alguien». */
function who(actor: Contact | undefined): string {
  return actor?.fullName?.trim() || actor?.email || 'Alguien';
}

const DECISION: Record<string, string> = { approved: 'aprobó', changes_requested: 'pidió cambios en', rejected: 'rechazó' };
const HEALTH: Record<string, string> = { on_track: 'en curso', at_risk: 'en riesgo', off_track: 'retrasado', complete: 'terminado' };

/**
 * Qué dice cada aviso de Proyectos por correo. Las frases son las de la campana (`notification.projects.*` del frontend), en
 * español: las demás plantillas de este servicio tampoco están traducidas todavía. `null` = este evento no se manda por correo.
 */
export function projectMailContent(
  event: string,
  payload: Record<string, unknown>,
  actor: Contact | undefined,
  appUrl: string,
): ProjectMailContent | null {
  const title = str(payload.title);
  const projectName = str(payload.projectName);
  const projectIds = Array.isArray(payload.projectIds) ? (payload.projectIds as unknown[]).filter((p): p is string => typeof p === 'string') : [];
  const projectId = str(payload.projectId) || projectIds[0] || '';
  const taskId = str(payload.taskId);
  // La tarea se abre sobre su proyecto (`?task=` abre el panel de detalle); si no se sabe el proyecto, desde «Mis tareas».
  const taskUrl = taskId
    ? projectId ? `${appUrl}/projects/${projectId}?task=${taskId}` : `${appUrl}/my-tasks?task=${taskId}`
    : `${appUrl}/my-tasks`;
  const projectUrl = projectId ? `${appUrl}/projects/${projectId}` : `${appUrl}/projects`;
  const excerpt = str(payload.excerpt) || undefined;
  const name = who(actor);
  const task = { ctaLabel: 'Abrir la tarea', url: taskUrl };

  switch (event) {
    case 'projects.task.assigned':
      return { subject: `${name} te asignó «${title}»`, heading: `${name} te asignó una tarea`, quote: title, ...task };
    case 'projects.task.mentioned':
      return { subject: `${name} te mencionó en «${title}»`, heading: `${name} te mencionó en «${title}»`, quote: excerpt, ...task };
    case 'projects.comment.created':
      return { subject: `${name} comentó en «${title}»`, heading: `${name} comentó en «${title}»`, quote: excerpt, ...task };
    case 'projects.task.completed':
      return { subject: `${name} completó «${title}»`, heading: `${name} completó una tarea que sigues`, quote: title, ...task };
    case 'projects.task.due_soon': {
      const when = payload.when === 'today' ? 'hoy' : 'mañana';
      return { subject: `«${title}» vence ${when}`, heading: `Tu tarea vence ${when}`, quote: title, ...task };
    }
    case 'projects.approval.requested':
      return { subject: `${name} te pidió aprobar «${title}»`, heading: `${name} te pidió una aprobación`, quote: title, ...task };
    case 'projects.approval.decided': {
      const verb = DECISION[str(payload.decision)] ?? 'respondió';
      return { subject: `${name} ${verb} «${title}»`, heading: `${name} ${verb} «${title}»`, ...task };
    }
    case 'projects.task.unblocked':
      return { subject: `Ya puedes empezar «${title}»`, heading: 'Lo que bloqueaba tu tarea ya está terminado', quote: title, ...task };
    case 'projects.member.added':
      return { subject: `${name} te añadió a «${projectName}»`, heading: `${name} te añadió al proyecto «${projectName}»`, ctaLabel: 'Abrir el proyecto', url: projectUrl };
    case 'projects.status_update.posted': {
      const health = HEALTH[str(payload.status)];
      return {
        subject: `Estado de «${projectName}»${health ? `: ${health}` : ''}`,
        heading: `${name} publicó el estado de «${projectName}»`,
        quote: excerpt,
        ctaLabel: 'Ver el proyecto',
        url: projectUrl,
      };
    }
    default:
      return null;
  }
}

function recipients(payload: Record<string, unknown>): string[] {
  const ids = Array.isArray(payload.userIds) ? (payload.userIds as unknown[]) : [payload.userId];
  return [...new Set(ids.filter((u): u is string => typeof u === 'string' && u !== ''))];
}

/**
 * Manda por correo los avisos de Proyectos (los mismos de la campana) a quien tenga el canal `smtp` activo en sus preferencias.
 *
 * Es de mejor esfuerzo, como los correos adicionales de las plantillas: el trabajo principal del evento es la campana, y si un correo
 * falla no se reencola el evento, porque eso repetiría los correos que sí salieron. Un fallo se registra y sigue con el siguiente.
 * Nunca escribe a quien causó el aviso (si alguien se menciona a sí mismo, no se manda nada).
 */
export class ProjectMailService {
  constructor(
    private readonly mailer: Mailer,
    private readonly prefs: Pick<NotificationPreferenceService, 'isEnabled'>,
    private readonly directory: ContactDirectory,
    private readonly appUrl: string,
  ) {}

  async send(event: string, payload: Record<string, unknown>): Promise<number> {
    const organizationId = str(payload.organizationId);
    const actorId = str(payload.actorId);
    const wanted: string[] = [];
    for (const userId of recipients(payload)) {
      if (userId === actorId) continue;
      if (await this.prefs.isEnabled(userId, event, 'smtp')) wanted.push(userId);
    }
    // Sin organización no se puede acotar la búsqueda de correos: mejor no mandar nada que preguntar a ciegas.
    if (wanted.length === 0 || !organizationId) return 0;

    const contacts = await this.directory.contactsOf(organizationId);
    const content = projectMailContent(event, payload, contacts.get(actorId), this.appUrl);
    if (!content) return 0;

    let sent = 0;
    for (const userId of wanted) {
      // Un id que no está entre los activos de la organización (deshabilitado, o de otra empresa) no recibe nada.
      const contact = contacts.get(userId);
      if (!contact) continue;
      try {
        const { html } = render(
          { event, template: 'projects.notification.html', subject: '', to: '', schema: { properties: {} } },
          { ...content, greeting: contact.fullName?.trim() || '', prefsUrl: `${this.appUrl}/settings?tab=notifications` },
        );
        await this.mailer.send(contact.email, content.subject, html);
        sent += 1;
      } catch (err) {
        console.error(`[notification] ${event}: no se pudo mandar el correo a ${userId}:`, err);
      }
    }
    return sent;
  }
}
