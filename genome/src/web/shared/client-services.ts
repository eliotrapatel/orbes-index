/**
 * The contact of ORBES Client Services as GET /api/v1/client-services
 * publishes it (CLIENT_SERVICES_*, API §8.4), checked again in the browser
 * before anything becomes a link: the same rules as the server's (config.ts).
 *
 * Shared by the verification app (verify/view-model.ts: the contact under a
 * result, in a warranty, under FORGOTTEN PASSWORD?, in MY PIECES) and the
 * legal pages (legal/main.ts, fillContacts: the publisher's contact and the
 * privacy policy's, J-06).
 */

/** A plain mailbox: nothing a mailto: link would read as syntax. */
const MAILBOX = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
/** International format: +, then 7 to 15 digits with single spaces, dots or hyphens between them. */
const PHONE = /^\+[1-9](?:[ .-]?[0-9]){6,14}$/;
/** One line of text. */
const HOURS = /^[^\p{Cc}]{1,120}$/u;

export interface ContactLines {
  email?: string;
  phone?: string;
  hours?: string;
}

/** The usable lines of GET /api/v1/client-services; null when neither an email nor a phone is usable. */
export function contactLines(cs: unknown): ContactLines | null {
  if (cs === null || typeof cs !== 'object') return null;
  const o = cs as Record<string, unknown>;
  const text = (v: unknown, re: RegExp, max: number): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t.length <= max && re.test(t) ? t : undefined;
  };
  const email = text(o.email, MAILBOX, 254);
  const phone = text(o.phone, PHONE, 32);
  if (!email && !phone) return null;
  const hours = text(o.hours, HOURS, 120);
  return { ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(hours ? { hours } : {}) };
}

/** The tel: link of a number in the international format: `+33 1 23 45 67 89` → `tel:+33123456789`. */
export function phoneHref(phone: string): string {
  return `tel:+${phone.replace(/\D/g, '')}`;
}
