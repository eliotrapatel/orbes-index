/**
 * The client sheet's Tags and private notes in the console (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.6 C.4.3, C.9,
 * C.11, step 5.6), as pure functions: the section's words, a tag as the server keeps it (in capitals, its spaces
 * collapsed) and the checks before it is sent, the suggestions not yet carried, a note's checks and counter, its line
 * (when, in Paris time, and who wrote it) and who may remove it (its writer, or an ADMIN).
 *
 * Never shown to the client: the section says so, and nothing of it reaches the app (§3.0 (n)).
 */
import { can } from './permissions.js';
import { parisDateTime } from './links.js';
import type { AdminRole, PrivateNote, TagSuggestion } from '../types.js';

/** The tags a client carries at most (services/client-notes.ts TAG_LIMIT). */
export const TAG_LIMIT = 20;
/** A tag's length at most (TAG_MAX). */
export const TAG_MAX = 32;
/** A note's length at most (NOTE_MAX). */
export const NOTE_MAX = 2000;
/** The notes the sheet shows before « Show the … older notes » (NOTES_SHOWN). */
export const NOTES_SHOWN = 50;
/** The counter shows once fewer characters than this are left. */
export const NOTE_COUNTER_FROM = 400;

export const TAGS_NOTES_COPY = Object.freeze({
  title: 'Tags and private notes',
  note: 'Never shown to the client.',
  tags: 'Tags',
  noTag: 'No tag.',
  addTag: 'Add a tag',
  add: 'Add',
  adding: 'Adding…',
  tagAdded: 'Tag added.',
  tagRemoved: 'Tag removed.',
  notes: 'Private notes',
  noNote: 'No private note.',
  addNote: 'Add a private note',
  addNoteButton: 'Add note',
  noteAdded: 'Note added.',
  noteRemoved: 'Note removed.',
  remove: 'Remove',
  keep: 'Keep it',
  removeTitle: 'Remove this note',
  removeBody: 'Remove this note? It disappears from the sheet; the audit log keeps that it was removed.',
  tagRefused: 'A tag is 1 to 32 letters, digits or spaces (and & ’ - .).',
  noteRefused: 'A note is 1 to 2,000 characters.',
});

/** The server's tag rule (services/client-notes.ts TAG_RE): letters of any script, digits, spaces and & ' ’ . -. */
const TAG_RE = /^[\p{L}\p{Nd} &'’.-]+$/u;

/** A tag as the server keeps it: in capitals, its spaces collapsed (« friend  of the house » → FRIEND OF THE HOUSE). */
export function tagValue(v: string): string {
  return v.normalize('NFC').replace(/\s+/gu, ' ').trim().toUpperCase().normalize('NFC');
}

/** Why a tag would be refused, said before it is sent; null when it is a tag. */
export function tagProblem(v: string, carried: readonly string[]): string | null {
  const tag = tagValue(v);
  const length = [...tag].length;
  if (length < 1 || length > TAG_MAX || !TAG_RE.test(tag)) return TAGS_NOTES_COPY.tagRefused;
  if (!carried.includes(tag) && carried.length >= TAG_LIMIT) return `A client carries at most ${TAG_LIMIT} tags.`;
  return null;
}

/** The suggestions of the Add a tag field: the tags in use (the most used first), less those the client carries. */
export function tagSuggestionsFor(items: readonly TagSuggestion[], carried: readonly string[]): string[] {
  return items.map((x) => x.tag).filter((t) => !carried.includes(t));
}

/** The × of a tag: its accessible name. */
export const removeTagLabel = (tag: string): string => `Remove the tag ${tag}`;

/** Why a note would be refused, said before it is sent; null when it can be added. */
export function noteProblem(text: string): string | null {
  const length = [...text.normalize('NFC').replace(/\r\n?/g, '\n').trim()].length;
  return length < 1 || length > NOTE_MAX ? TAGS_NOTES_COPY.noteRefused : null;
}

/** The note's counter, `1,640 left`, once fewer than NOTE_COUNTER_FROM characters are left; '' before. */
export function noteCounter(text: string): string {
  const left = NOTE_MAX - [...text].length;
  return left < NOTE_COUNTER_FROM ? `${Math.max(0, left).toLocaleString('en-GB')} left` : '';
}

/** A note's line: when (Paris) and who wrote it (its console email; 'ORBES' for a script). */
export function noteLine(n: Pick<PrivateNote, 'at' | 'by'>): string {
  return `${parisDateTime(n.at)} · ${n.by ?? 'ORBES'}`;
}

/** Whether the reader may remove a note: its writer (with the right to write notes), or an ADMIN. */
export function canRemoveNote(n: Pick<PrivateNote, 'byId'>, me: { id: string; role: AdminRole }): boolean {
  if (can(me.role, 'removeAnyClientNote')) return true;
  return can(me.role, 'writeClientNotes') && n.byId !== null && n.byId === me.id;
}

/** « Show the 120 older notes » under the 50 newest; null when every note is shown. */
export function olderNotesLabel(total: number, shown: number): string | null {
  const older = total - shown;
  if (older <= 0) return null;
  return older === 1 ? 'Show the 1 older note' : `Show the ${older.toLocaleString('en-GB')} older notes`;
}
