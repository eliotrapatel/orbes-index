/**
 * How the NOCTURNE content test reads a baseline value in a page's blocks of words (nocturne-states.ts: shows,
 * valuePattern, maskVolatile): on word and figure boundaries, within one block, the server's parts read as any text of their shape.
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

  it('reads the parts the server writes as any text of their shape, folding case, quotes and whitespace', () => {
    expect(shows(page('REF 3F9A21C4'), maskVolatile('REF 7C21A9F0'))).toBe(true);
    expect(shows(page('REFERENCE LR-2026-0042'), maskVolatile('REFERENCE LR-2026-0007'))).toBe(true);
    expect(shows(page('YOU’RE  READY'), "you're ready")).toBe(true);
    expect(shows(page('REF'), maskVolatile('REF 7C21A9F0'))).toBe(false);
  });

  it('reads a value made of a server part alone only in a text of its shape, never in any word', () => {
    const genome = maskVolatile('G2-7C21-A9F0');
    expect(genome).toBe('«genome»');
    expect(shows(page('ORBES'), genome)).toBe(false);
    expect(shows(page('G1-3F9A-21C4'), genome)).toBe(true);
    const code = maskVolatile('7KQ2-M9XA-4TZP');
    expect(code).toBe('«code»');
    expect(shows(page('REGISTER THIS PIECE'), code)).toBe(false);
    expect(shows(page('A1B2-C3D4-E5F6'), code)).toBe(true);
    const seed = maskVolatile('a'.repeat(64));
    expect(seed).toBe('«hex»');
    expect(shows(page('SEED'), seed)).toBe(false);
    expect(shows(page('0123 4567 89ab cdef 0123 4567 89ab cdef 0123 4567 89ab cdef 0123 4567 89ab cdef'), seed)).toBe(true);
    const id = maskVolatile('YOUR ENTRY 3f9a21c4-7c21-4a9f-8b0e-21c43f9a7c21');
    expect(id).toBe('YOUR ENTRY «id»');
    expect(shows(page('YOUR ENTRY'), id)).toBe(false);
    expect(shows(page('YOUR ENTRY 0b5e7d1a-1c2d-4e5f-9a8b-7c6d5e4f3a2b'), id)).toBe(true);
    const link = maskVolatile('http://127.0.0.1:51234/verify/c#k3y');
    expect(link).toBe('«link»');
    expect(shows(page('COPY LINK'), link)).toBe(false);
    expect(shows(page('https://verify.theorbes.com/verify/c#abc'), link)).toBe(true);
    expect(shows(page('VERSION OF 1 OCTOBER 2026'), maskVolatile('VERSION OF 5 OCTOBER 2026'))).toBe(true);
    expect(shows(page('VERSION OF THE TERMS'), maskVolatile('VERSION OF 5 OCTOBER 2026'))).toBe(false);
  });

  it('keeps the placeholder of a code field as it is, and masks a code the server wrote', () => {
    expect(maskVolatile('XXXX-XXXX-XXXX')).toBe('XXXX-XXXX-XXXX');
    expect(shows(page('XXXX-XXXX-XXXX'), maskVolatile('XXXX-XXXX-XXXX'))).toBe(true);
    expect(shows(page('A1B2-C3D4-E5F6'), maskVolatile('XXXX-XXXX-XXXX'))).toBe(false);
    expect(maskVolatile('CODE 7KQ2-M9XA-4TZP')).toBe('CODE «code»');
  });
});
