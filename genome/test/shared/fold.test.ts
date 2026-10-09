/**
 * src/shared/fold.ts and the database's orbes_fold(text) (migration 0044_client_notes, plan CUSTOMER INTELLIGENCE §3.6
 * C.8 item 5, step 5.1): one rule in two places, held to the same answers on 200 strings drawn from capitals, small
 * letters, every accented letter the lists name and their capitals, figures, spaces, dashes and apostrophes; and the
 * migration's own copy of the two lists is FOLD_FROM and FOLD_TO.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FOLD_FROM, FOLD_TO, fold } from '../../src/shared/fold.js';
import { createTestDb, type TestDb } from '../support/db.js';
import { Prng } from '../support/prng.js';

describe('fold', () => {
  it('lower-cases and takes the common Latin accents off, one letter for one letter', () => {
    expect([...FOLD_FROM]).toHaveLength([...FOLD_TO].length);
    expect(new Set(FOLD_FROM).size).toBe([...FOLD_FROM].length);
    expect(fold('Saint-Étienne')).toBe('saint-etienne');
    expect(fold('SAINT-ÉTIENNE')).toBe('saint-etienne');
    expect(fold('Łódź')).toBe('lodz');
    expect(fold('Kraków')).toBe('krakow');
    expect(fold('São Paulo')).toBe('sao paulo');
    expect(fold('Zürich')).toBe('zurich');
    expect(fold('Køge')).toBe('koge');
    expect(fold('Bucureşti')).toBe('bucuresti');
    expect(fold('București')).toBe('bucuresti');
    expect(fold('İzmir'.slice(1))).toBe('zmir');
    // Letters the lists do not name are only lower-cased.
    expect(fold('Æbeltoft')).toBe('æbeltoft');
    expect(fold('МОСКВА')).toBe('москва');
    expect(fold('')).toBe('');
  });
});

describe('orbes_fold and fold.ts', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t?.close());

  it('give the same answer on 200 strings', async () => {
    const accented = [...FOLD_FROM];
    // Their capitals, where one exists and comes back to the same small letter (ı has none of its own).
    const capitals = accented.map((c) => c.toUpperCase()).filter((u, i) => [...u].length === 1 && u !== accented[i] && u.toLowerCase() === accented[i]);
    const alphabet = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', ' ', '-', "'", '’', ...accented, ...capitals, 'æ', 'Æ', 'ß', 'œ'];
    const prng = new Prng(44);
    const random = () => prng.float();
    const strings: string[] = [];
    for (let i = 0; i < 200; i++) {
      const length = 1 + Math.floor(random() * 24);
      let s = '';
      for (let j = 0; j < length; j++) s += alphabet[Math.floor(random() * alphabet.length)];
      strings.push(s);
    }
    const r = await sql<{ i: number; folded: string }>`
      SELECT s.i::int AS i, orbes_fold(s.v) AS folded FROM unnest(${strings}::text[]) WITH ORDINALITY AS s (v, i) ORDER BY s.i`.execute(t.db);
    expect(r.rows.map((x) => x.folded)).toEqual(strings.map(fold));
    // And every accented letter alone, small and capital.
    const letters = [...accented, ...capitals];
    const each = await sql<{ folded: string }>`
      SELECT orbes_fold(s.v) AS folded FROM unnest(${letters}::text[]) WITH ORDINALITY AS s (v, i) ORDER BY s.i`.execute(t.db);
    expect(each.rows.map((x) => x.folded)).toEqual(letters.map(fold));
  });

  it('the migration folds with FOLD_FROM and FOLD_TO', async () => {
    const r = await sql<{ src: string }>`SELECT prosrc AS src FROM pg_proc WHERE proname = 'orbes_fold'`.execute(t.db);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.src).toContain(`translate(lower($1), '${FOLD_FROM}', '${FOLD_TO}')`);
  });
});
