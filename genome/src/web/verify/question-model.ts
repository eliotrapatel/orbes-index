/**
 * The question after a LIVE RELEASE (plan LIVE RELEASE+, choice 11) — pure: what its block says, from the server's
 * answer (GET /api/v1/live/:id/question, GET /api/v1/account/questions). views/question.ts draws it on the release's
 * end page (vault) and in MY PIECES (ivory).
 */
import { LIVE, QUESTION } from './copy.js';
import { zonedDate } from './releases-model.js';
import type { AccountQuestion } from './types.js';
import { upper } from './view-model.js';

export interface QuestionModel {
  dropId: string;
  /** MY PIECES names the release: its model's name (else LIVE RELEASE) and its opening date on this phone's calendar. */
  release: string;
  text: string;
  answers: { answer: number; label: string; chosen: boolean }[];
  /** Until when it may change, said before and after an answer. */
  note: string;
}

export function questionModel(q: AccountQuestion, localZone: string): QuestionModel {
  const until = zonedDate(q.closesAt, localZone);
  return {
    dropId: q.dropId,
    release: QUESTION.release(q.name ? upper(q.name) : LIVE.kind, zonedDate(q.opensAt, localZone)),
    text: upper(q.text),
    answers: q.answers.map((label, i) => ({ answer: i + 1, label: upper(label), chosen: q.answer === i + 1 })),
    note: q.answer === null ? QUESTION.ask(until) : QUESTION.answered(until),
  };
}
