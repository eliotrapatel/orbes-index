/**
 * The Sign-up page's words and rules (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.1 P.10; step 1.10): what a new account
 * is asked, and the answers to « How did you hear about ORBES? » an ADMIN edits (added, renamed, moved, set aside or
 * offered again; Other always offered and last; 12 offered at most). The server is the authority (services/profiles.ts);
 * these checks only spare a request that would be refused. Pure: no DOM.
 */
import type { HeardOptionView } from '../types.js';

/** An answer's length, as the server's (migration 0040). */
export const HEARD_LABEL_MAX = 40;
/** The answers offered at once, Other counted (the server's HEARD_OFFERED_MAX). */
export const HEARD_OFFERED_MAX = 12;

export const SIGN_UP_COPY = Object.freeze({
  eyebrow: 'Clients · Owners',
  title: 'Sign-up',
  lead: 'What a new account is asked. Everyone in the console reads it; an ADMIN changes the answers offered.',
  asked: 'Asked at sign-up',
  askedRows: Object.freeze([
    { label: 'First name and last name', value: 'Required' },
    { label: 'Country', value: 'Required, preselected from where the person connects' },
    { label: 'How did you hear about ORBES?', value: 'Optional' },
  ]),
  heard: 'How did you hear about ORBES?',
  columns: Object.freeze({ answer: 'Answer', given: 'Given', status: 'Status' }),
  otherNote: 'With a text field',
  offered: 'OFFERED',
  setAside: 'SET ASIDE',
  empty: 'No answer yet: they are created at the first start.',
  add: 'Add an answer',
  edit: 'Edit',
  moveUp: 'Move up',
  moveDown: 'Move down',
  setAsideAction: 'Set aside',
  offerAgain: 'Offer again',
  field: 'Answer',
  fieldHint: 'As the collector reads it, 40 characters at most.',
  addConfirm: 'Add',
  added: 'Answer added.',
  editTitle: 'Edit the answer',
  editText: 'Collectors who gave this answer keep it, under its new name.',
  editConfirm: 'Save',
  saved: 'Answer saved.',
  unchanged: 'Nothing has changed.',
  setAsideTitle: 'Set the answer aside',
  setAsideText: 'It is no longer offered at sign-up or in YOUR PROFILE. Collectors who chose it keep it, and it stays in the console’s figures.',
  setAsideDone: 'Answer set aside.',
  offerAgainTitle: 'Offer the answer again',
  offerAgainText: 'It is offered again at sign-up and in YOUR PROFILE.',
  offeredAgain: 'Answer offered again.',
  orderSaved: 'Order saved.',
  noLabel: 'Enter the answer.',
  tooLong: `An answer is ${HEARD_LABEL_MAX} characters at most.`,
  taken: 'This answer exists already.',
  limit: `At most ${HEARD_OFFERED_MAX} answers are offered at once. Set one aside first.`,
  givenNote: 'Given: the collectors whose answer it is; test entrants and the team’s own accounts are left out.',
});

/** The answers in the page's order: by position, Other last. */
export function heardInOrder(options: readonly HeardOptionView[]): HeardOptionView[] {
  return [...options].sort((a, b) => Number(a.other) - Number(b.other) || a.position - b.position || a.label.localeCompare(b.label));
}

/** Why a label is refused before it is sent (the server says the same), or null. `except`: the answer being renamed. */
export function heardLabelProblem(label: string, options: readonly HeardOptionView[], except?: string): string | null {
  const v = label.trim();
  if (!v) return SIGN_UP_COPY.noLabel;
  if ([...v].length > HEARD_LABEL_MAX) return SIGN_UP_COPY.tooLong;
  if (options.some((o) => o.id !== except && o.label.toLowerCase() === v.toLowerCase())) return SIGN_UP_COPY.taken;
  return null;
}

/** Whether one more answer may be offered (Add, Offer again): fewer than 12 are. */
export function mayOfferMore(options: readonly HeardOptionView[]): boolean {
  return options.filter((o) => o.active).length < HEARD_OFFERED_MAX;
}

/**
 * The order PUT …/order sends once `id` is moved up (-1) or down (+1): every answer but Other, in its new order; null
 * when it cannot move that way (the first up, the last down, or Other, which stays last).
 */
export function movedOrder(options: readonly HeardOptionView[], id: string, by: -1 | 1): string[] | null {
  const ids = heardInOrder(options)
    .filter((o) => !o.other)
    .map((o) => o.id);
  const i = ids.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  return ids;
}
