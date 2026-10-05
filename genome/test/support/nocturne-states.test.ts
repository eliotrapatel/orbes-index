/**
 * How the NOCTURNE content test reads a baseline value in a page's blocks of words (nocturne-states.ts: shows,
 * valuePattern, maskVolatile): on word and figure boundaries, within one block, the server's parts read as any word.
 */
import { describe, expect, it } from 'vitest';
import { maskVolatile, normalizeText, shows } from './nocturne-states.js';

const page = (...blocks: string[]) => blocks.map(normalizeText);

describe('NOCTURNE content: a value shown', () => {
  it('is never matched inside a word', () => {
    expect(shows(page('You will not come.', '12 OCT 2026 · 17:00 UTC'), 'NO')).toBe(false);
    expect(shows(page('YES', 'NO'), 'NO')).toBe(true);
    expect(shows(page('SECURED AT 18:49'), 'SECURE')).toBe(false);
    expect(shows(page('THE ROOM IS OPEN'), 'the room')).toBe(true);
  });

  it('is never matched inside a figure', () => {
    expect(shows(page('CREATED 2017'), '17')).toBe(false);
    expect(shows(page('12 OCT 2026 · 17:00 UTC'), '17')).toBe(false);
    expect(shows(page('€ 1.17'), '17')).toBe(false);
    expect(shows(page('170'), '17')).toBe(false);
    expect(shows(page('YOUR SIZE', '16', '17', '18'), '17')).toBe(true);
    expect(shows(page('SIZE 17, ENGRAVING'), '17')).toBe(true);
    expect(shows(page('+ € 150'), '+')).toBe(true);
    expect(shows(page('UNTIL 17:00'), '17:00')).toBe(true);
  });

  it('never straddles two blocks of words', () => {
    expect(shows(page('YOU WILL', 'NOT COME'), 'will not')).toBe(false);
    expect(shows(page('YOU WILL NOT COME'), 'will not')).toBe(true);
  });

  it('may be shown part by part, each part on the same boundaries', () => {
    expect(shows(page('SIZE', '17'), 'SIZE · 17')).toBe(true);
    expect(shows(page('SIZE', '2017'), 'SIZE · 17')).toBe(false);
    expect(shows(page('SIZES', '17'), 'SIZE · 17')).toBe(false);
    expect(shows(page('SIZE · 17'), 'SIZE · 17')).toBe(true);
  });

  it('reads the parts the server writes as any word, folding case, quotes and whitespace', () => {
    expect(shows(page('REF 3F9A21C4'), maskVolatile('REF 7C21A9F0'))).toBe(true);
    expect(shows(page('REFERENCE LR-2026-0042'), maskVolatile('REFERENCE LR-2026-0007'))).toBe(true);
    expect(shows(page('YOU’RE  READY'), "you're ready")).toBe(true);
    expect(shows(page('REF'), maskVolatile('REF 7C21A9F0'))).toBe(false);
  });
});
