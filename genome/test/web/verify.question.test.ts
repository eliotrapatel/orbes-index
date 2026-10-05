/**
 * The question after a LIVE RELEASE (plan LIVE RELEASE+, step S8: choice 11) as its block says it (question-model.ts),
 * and its copy. Pure: no DOM. The block itself is driven in Chromium by verify.question.e2e.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { QUESTION } from '../../src/web/verify/copy.js';
import { questionModel } from '../../src/web/verify/question-model.js';
import type { AccountQuestion } from '../../src/web/verify/types.js';
import { brandForbiddenTerms, EXTRA_FORBIDDEN_EN, findForbidden } from '../docs/lexicon.js';

function question(extra: Partial<AccountQuestion> = {}): AccountQuestion {
  return {
    dropId: 'r1',
    name: 'Monolithe',
    opensAt: '2026-11-02T23:30:00.000Z',
    text: 'What would you have wanted?',
    answers: ['Another size', 'Another finish', 'Another price band'],
    answer: null,
    closesAt: '2026-11-09T22:30:00.000Z',
    asked: 'INTEREST',
    ...extra,
  };
}

describe('the question after (question-model.ts)', () => {
  it('names the release by its model and its opening date on the phone’s calendar, the question and its answers in capitals', () => {
    const m = questionModel(question(), 'UTC');
    expect(m).toEqual({
      dropId: 'r1',
      release: 'MONOLITHE · 2 NOV 2026',
      text: 'WHAT WOULD YOU HAVE WANTED?',
      answers: [
        { answer: 1, label: 'ANOTHER SIZE', chosen: false },
        { answer: 2, label: 'ANOTHER FINISH', chosen: false },
        { answer: 3, label: 'ANOTHER PRICE BAND', chosen: false },
      ],
      note: 'One tap. You may change your answer until 9 NOV 2026.',
    });
    // In Paris, the opening and the close fall on the next day.
    expect(questionModel(question(), 'Europe/Paris')).toMatchObject({ release: 'MONOLITHE · 3 NOV 2026', note: 'One tap. You may change your answer until 9 NOV 2026.' });
    expect(questionModel(question({ closesAt: '2026-11-09T23:30:00.000Z' }), 'Europe/Paris').note).toBe('One tap. You may change your answer until 10 NOV 2026.');
  });

  it('marks the answer chosen and says it is recorded, changeable until the close; a release ended before its name reads LIVE RELEASE', () => {
    const m = questionModel(question({ answer: 2, name: null }), 'UTC');
    expect(m.answers.map((a) => a.chosen)).toEqual([false, true, false]);
    expect(m.note).toBe('Thank you: your answer is recorded. You may change it until 9 NOV 2026.');
    expect(m.release).toBe('LIVE RELEASE · 2 NOV 2026');
    // Six answers of the console's own.
    const six = questionModel(question({ text: 'Which finish?', answers: ['gold', 'silver', 'black', 'white', 'rose', 'none'], answer: 6 }), 'UTC');
    expect(six.answers.map((a) => [a.answer, a.label, a.chosen])).toEqual([
      [1, 'GOLD', false],
      [2, 'SILVER', false],
      [3, 'BLACK', false],
      [4, 'WHITE', false],
      [5, 'ROSE', false],
      [6, 'NONE', true],
    ]);
  });

  it('keeps to the brand lexicon', () => {
    const words = [QUESTION.label, QUESTION.ask('9 NOV 2026'), QUESTION.answered('9 NOV 2026'), QUESTION.saving, QUESTION.failed, QUESTION.piecesTitle, QUESTION.piecesLead].join('\n');
    expect(words).not.toContain('!');
    expect(findForbidden(words, [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN])).toEqual([]);
  });
});
