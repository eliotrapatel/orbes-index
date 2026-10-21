/**
 * The emails' default words (macro scope E0 to E5; lot M1 plan §4.1, §4.2): English, in the house's voice, one subject
 * and one body per kind, and the frame every email shares.
 *
 * A deliberate exception to "every collector word in web/verify/copy.ts": the server never imports the web app's
 * copy, which pulls in browser modules, so the emails' words live beside the emails (BRAND-DESIGN-SYSTEM says so).
 *
 * The console edits a kind's subject and body (email_templates; NULL keeps these words). A body is plain text:
 *  - paragraphs apart by an empty line; a line break inside a paragraph is kept;
 *  - `{name}` is a placeholder, filled at enqueue with the values the trigger gives (EMAIL_PLACEHOLDERS lists each
 *    kind's); a value never adds markup: it is escaped like every word;
 *  - a paragraph that is only `[WORDS]({link})` is the email's button: WORDS on the button, the link behind it (in the
 *    plain text, the words then the address). A button whose link is empty is left out.
 * The frame (the wordmark, the monogram, the hairline, why the email is received, STOP THESE EMAILS on the ones that
 * can be stopped, ORBES · PARIS) is the house's and is not edited.
 *
 * No piece name, material or price here: a trigger gives `{release}` only in words the release's stage has made
 * public (the house rule).
 */
import type { EmailKind } from '../db/schema.js';

/** The kinds a person may stop with one click (RFC 8058): the founding announcement (E1) and the release notices (E2). */
export const OPT_IN_KINDS: ReadonlySet<EmailKind> = new Set<EmailKind>(['FOUNDING_ANNOUNCEMENT', 'RELEASE_NOTICE']);

/** What each placeholder holds, as the console lists it beside the editor. */
export const PLACEHOLDER_WORDS: Readonly<Record<string, string>> = Object.freeze({
  firstName: 'The person’s first name',
  release: 'The release, in the words its stage has made public',
  opensAt: 'When it opens, Paris time',
  access: 'Who may take part, in words',
  heldUntil: 'Until when the place is held, Paris time',
  orderRef: 'The order’s reference',
  carrier: 'The carrier',
  trackingUrl: 'The parcel’s tracking page',
  resetLink: 'The link to choose a new password',
  link: 'The page in the ORBES app',
  unsubscribeLink: 'The page that stops these emails',
});
export type EmailPlaceholder = keyof typeof PLACEHOLDER_WORDS;

/** The placeholders each kind's trigger fills (any other `{name}` stays as it is written). */
export const EMAIL_PLACEHOLDERS: Readonly<Record<EmailKind, readonly EmailPlaceholder[]>> = Object.freeze({
  FOUNDING_ANNOUNCEMENT: ['firstName', 'release', 'opensAt', 'link', 'unsubscribeLink'],
  RELEASE_NOTICE: ['firstName', 'release', 'opensAt', 'access', 'link', 'unsubscribeLink'],
  PASSWORD_RESET: ['firstName', 'resetLink'],
  ORDER_CONFIRMED: ['firstName', 'orderRef', 'link'],
  ORDER_SHIPPED: ['firstName', 'orderRef', 'carrier', 'trackingUrl', 'link'],
  ORDER_DELIVERED: ['firstName', 'orderRef', 'link'],
  ORDER_CANCELLED: ['firstName', 'orderRef', 'link'],
  DRAW_SELECTED: ['firstName', 'release', 'heldUntil', 'link'],
  DRAW_OFFERED: ['firstName', 'release', 'heldUntil', 'link'],
  WARRANTY_LABEL: ['firstName', 'link'],
  CARE_LABEL: ['firstName', 'link'],
});

/** A kind's words: its subject (one line) and its body. */
export interface EmailWords {
  subject: string;
  body: string;
}

/** Each kind's default words. */
export const EMAIL_DEFAULTS: Readonly<Record<EmailKind, EmailWords>> = Object.freeze({
  FOUNDING_ANNOUNCEMENT: {
    subject: 'The first ORBES release',
    body: [
      '{firstName},',
      'You joined the ORBES founding list. {release} opens {opensAt}, Paris time.',
      'Sign in to ORBES with this address, or create your account with it, so that your place on the list is recognised.',
      '[SEE THE RELEASE]({link})',
    ].join('\n\n'),
  },
  RELEASE_NOTICE: {
    subject: 'A release is announced',
    body: [
      '{firstName},',
      '{release} opens {opensAt}, Paris time. {access}',
      '[SEE THE RELEASE]({link})',
    ].join('\n\n'),
  },
  PASSWORD_RESET: {
    subject: 'Choose a new password',
    body: [
      '{firstName},',
      'A new password was asked for the ORBES account that uses this address. The link below works once, for 30 minutes.',
      '[CHOOSE A NEW PASSWORD]({resetLink})',
      'If you did not ask for it, you can ignore this email: your password stays as it is.',
    ].join('\n\n'),
  },
  ORDER_CONFIRMED: {
    subject: 'Your order {orderRef} is confirmed',
    body: ['{firstName},', 'Your order {orderRef} is paid and confirmed. Its progress is in ORBES, under MY PIECES.', '[SEE YOUR ORDER]({link})'].join('\n\n'),
  },
  ORDER_SHIPPED: {
    subject: 'Your order {orderRef} is on its way',
    body: ['{firstName},', 'Your order {orderRef} has left ORBES with {carrier}.', '[FOLLOW THE PARCEL]({trackingUrl})', '[SEE YOUR ORDER]({link})'].join('\n\n'),
  },
  ORDER_DELIVERED: {
    subject: 'Your order {orderRef} is delivered',
    body: ['{firstName},', 'Your order {orderRef} is delivered. Scan your piece with ORBES to register it in your name.', '[SEE YOUR ORDER]({link})'].join('\n\n'),
  },
  ORDER_CANCELLED: {
    subject: 'Your order {orderRef} is cancelled',
    body: ['{firstName},', 'Your order {orderRef} is cancelled. If it was paid, its credit note is with the order.', '[SEE YOUR ORDER]({link})'].join('\n\n'),
  },
  DRAW_SELECTED: {
    subject: 'A place is yours',
    body: ['{firstName},', '{release} is drawn, and a place is yours. It is held until {heldUntil}, Paris time. ORBES Client Services will contact you.', '[SEE THE RELEASE]({link})'].join('\n\n'),
  },
  DRAW_OFFERED: {
    subject: 'A place is offered to you',
    body: ['{firstName},', '{release}: a place has come free and is offered to you. It is held until {heldUntil}, Paris time. ORBES Client Services will contact you.', '[SEE THE RELEASE]({link})'].join('\n\n'),
  },
  WARRANTY_LABEL: {
    subject: 'Your prepaid label is ready',
    body: ['{firstName},', 'The prepaid label for your piece is ready in ORBES CARE. Print it and give the parcel to the carrier.', '[OPEN ORBES CARE]({link})'].join('\n\n'),
  },
  CARE_LABEL: {
    subject: 'Your PRIVATE CARE label is ready',
    body: ['{firstName},', 'The prepaid label for your piece’s PRIVATE CARE is ready. Print it and give the parcel to the carrier.', '[OPEN ORBES CARE]({link})'].join('\n\n'),
  },
});

/** The frame's words, the same on every email. */
export const EMAIL_FRAME = Object.freeze({
  wordmark: 'ORBES',
  foot: 'ORBES · PARIS',
  /** Why the email is received, under the hairline. */
  reason: Object.freeze({
    FOUNDING_ANNOUNCEMENT: 'You receive this email because you joined the ORBES founding list on theorbes.com.',
    RELEASE_NOTICE: 'You receive this email because you asked, in YOUR PROFILE, to be told when a release is announced.',
    account: 'You receive this email about your ORBES account.',
  }),
  /** The link that stops an email that can be stopped. */
  stop: 'STOP THESE EMAILS',
  /** A name a first name stands in for when the person gave none (never empty in the greeting). */
  noName: 'Hello',
});

/** The values the console's preview fills the words with: plain examples, never a piece's name. */
export const EMAIL_SAMPLE_VALUES: Readonly<Record<EmailPlaceholder, string>> = Object.freeze({
  firstName: 'Camille',
  release: 'The November release',
  opensAt: 'Thursday 5 November at 19:00',
  access: 'It is open to every ORBES account.',
  heldUntil: 'Saturday 7 November at 19:00',
  orderRef: 'OR-7F3A21C9',
  carrier: 'Colissimo',
  trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois',
  resetLink: 'https://verify.theorbes.com/verify/reset',
  link: 'https://verify.theorbes.com/verify',
  unsubscribeLink: 'https://verify.theorbes.com/verify/unsubscribe',
});
