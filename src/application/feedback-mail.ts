import type { Contact } from '../infrastructure/directory/auth-contacts.js';
import type { ProjectMailContent } from './project-mail.js';

/** Plantilla de los correos de Comentarios y mejoras (la de Proyectos dice «Proyectos» arriba y «participas en esta tarea» abajo). */
export const FEEDBACK_MAIL_TEMPLATE = 'feedback.notification.html';

const KIND: Record<string, string> = { improvement: 'tu mejora', comment: 'tu comentario', problem: 'tu reporte' };
const STATUS: Record<string, string> = {
  new: 'Nueva',
  reviewing: 'En revisión',
  accepted: 'Aceptada',
  implemented: 'Implementada',
  declined: 'Descartada',
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Qué dice cada aviso de Comentarios y mejoras por correo, con las frases de la campana (`notifications.feedback*` del frontend), en
 * español como el resto de correos de este servicio. Los eventos no traen el título ni el texto de lo que la persona escribió ni de la
 * respuesta (regla del buzón): el correo avisa y enlaza, y lo demás se lee en el CRM. `null` = este evento no se manda por correo.
 *
 * Quien responde es el equipo de la plataforma, no un compañero de la empresa: por eso no se usa `actor` (no está en el directorio de
 * la organización) y se habla en primera persona del plural.
 */
export function feedbackMailContent(
  event: string,
  payload: Record<string, unknown>,
  _actor: Contact | undefined,
  appUrl: string,
): ProjectMailContent | null {
  const itemId = str(payload.itemId);
  const url = itemId ? `${appUrl}/feedback?id=${encodeURIComponent(itemId)}` : `${appUrl}/feedback`;
  const what = KIND[str(payload.kind)] ?? 'tu envío';
  const open = { ctaLabel: 'Ver la conversación', url };

  switch (event) {
    case 'feedback.reply.created':
      return { subject: `Te respondimos sobre ${what}`, heading: `Te respondimos sobre ${what}`, ...open };
    case 'feedback.item.status_changed': {
      const status = STATUS[str(payload.status)];
      if (!status) return null;
      return { subject: `${capitalize(what)}: ${status}`, heading: `${capitalize(what)} ahora está «${status}»`, ...open };
    }
    case 'feedback.points.granted': {
      // Solo se avisa de lo que suma: un ajuste a la baja no se anuncia por correo (sí queda en los movimientos de la empresa).
      const amount = typeof payload.amount === 'number' ? payload.amount : 0;
      if (amount <= 0) return null;
      return {
        subject: `Tu empresa ganó ${amount} puntos`,
        heading: `Gracias: tu empresa ganó ${amount} puntos por ${what === 'tu envío' ? 'tu aporte' : what}`,
        ctaLabel: 'Ver los puntos',
        url,
      };
    }
    default:
      return null;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
