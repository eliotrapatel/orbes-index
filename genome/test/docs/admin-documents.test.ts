/**
 * The staff documents the console shows (routes/admin/documents.ts) are
 * copies shipped with the server: each must equal its source in docs/, so a
 * change of the playbook or the kit is copied before it ships.
 *   cp docs/launch/SALES-PLAYBOOK.md docs/launch/PACKAGING-KIT.md genome/src/server/documents/
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
      for (const m of readFileSync(join(COPIES, d.file), 'utf8').matchAll(/!\[[^\]]*\]\(\.\.\/assets\/((?:ui\/)?[\w.-]+)\)/g)) cited.add(m[1]);
    }
    expect(cited.size).toBeGreaterThan(0);
    for (const path of cited) {
      const name = path.split('/').pop() as string;
      expect(DOCUMENT_ASSETS[name], name).toBeDefined();
      expect(existsSync(join(COPIES, 'assets', name)), name).toBe(true);
      expect(readFileSync(join(COPIES, 'assets', name)).equals(readFileSync(join(ROOT, 'docs', 'assets', path))), name).toBe(true);
    }
  });

  it('keeps the Markdown copies in the server image despite the *.md rule of .dockerignore', () => {
    expect(readFileSync(join(ROOT, 'genome', '.dockerignore'), 'utf8')).toMatch(/^!src\/server\/documents\/\*\.md$/m);
  });
});
