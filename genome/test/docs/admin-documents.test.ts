/**
 * The staff documents the console shows (routes/admin/documents.ts) are
 * copies shipped with the server: each must equal its source in docs/, so a
 * change of the playbook, the kit or THE VAULT CARD is copied before it ships.
 *   cp docs/launch/SALES-PLAYBOOK.md docs/launch/PACKAGING-KIT.md docs/launch/VAULT-CARD.md genome/src/server/documents/
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_ASSETS, STAFF_DOCUMENTS } from '../../src/server/routes/admin/documents.js';

const ROOT = join(__dirname, '..', '..', '..');
const COPIES = join(ROOT, 'genome', 'src', 'server', 'documents');

describe('staff documents shipped with the server', () => {
  for (const d of STAFF_DOCUMENTS) {
    it(`${d.file} equals docs/launch/${d.file}`, () => {
      expect(readFileSync(join(COPIES, d.file), 'utf8'), `copy docs/launch/${d.file} to genome/src/server/documents/`).toBe(
        readFileSync(join(ROOT, 'docs', 'launch', d.file), 'utf8'),
      );
    });
  }

  it('ships every illustration the documents cite, equal to its source', () => {
    const cited = new Set<string>();
    for (const d of STAFF_DOCUMENTS) {
      const text = readFileSync(join(COPIES, d.file), 'utf8');
      for (const m of text.matchAll(/!\[[^\]]*\]\(\.\.\/assets\/((?:ui\/)?[\w.-]+)\)/g)) cited.add(m[1]);
      // And the print files they link to (THE VAULT CARD's two PDFs).
      for (const m of text.matchAll(/\]\(\.\.\/assets\/([\w.-]+\.pdf)\)/g)) cited.add(m[1]);
    }
    expect(cited.size).toBeGreaterThan(0);
    for (const path of cited) {
      const name = path.split('/').pop() as string;
      expect(DOCUMENT_ASSETS[name], name).toBeDefined();
      expect(existsSync(join(COPIES, 'assets', name)), name).toBe(true);
      expect(readFileSync(join(COPIES, 'assets', name)).equals(readFileSync(join(ROOT, 'docs', 'assets', path))), name).toBe(true);
    }
  });

  it('lists THE VAULT CARD (plan OQ Q3 §5) in French, with its specimen and its two print files, served as PDFs', () => {
    expect(STAFF_DOCUMENTS.map((d) => d.id)).toEqual(['sales-playbook', 'packaging-kit', 'vault-card']);
    expect(STAFF_DOCUMENTS[2]).toMatchObject({ file: 'VAULT-CARD.md', title: 'THE VAULT CARD', lang: 'fr' });
    expect(DOCUMENT_ASSETS).toMatchObject({
      'vault-card-specimen.svg': 'image/svg+xml',
      'vault-card-sheet.pdf': 'application/pdf',
      'vault-card-single.pdf': 'application/pdf',
    });
    const cited = [...readFileSync(join(COPIES, 'VAULT-CARD.md'), 'utf8').matchAll(/\]\(\.\.\/assets\/([\w.-]+)\)/g)].map((m) => m[1]);
    expect(cited).toEqual(['vault-card-specimen.svg', 'vault-card-sheet.pdf', 'vault-card-single.pdf']);
  });

  it('keeps the Markdown copies in the server image despite the *.md rule of .dockerignore', () => {
    expect(readFileSync(join(ROOT, 'genome', '.dockerignore'), 'utf8')).toMatch(/^!src\/server\/documents\/\*\.md$/m);
  });
});
