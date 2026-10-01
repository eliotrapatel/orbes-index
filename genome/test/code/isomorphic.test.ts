import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CODE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/core/code');
const FILES = readdirSync(CODE_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => join(CODE_DIR, f));

describe('CODE-01 modules', () => {
  it('include the encoder, layout, primitives and barrel', () => {
    const names = FILES.map((f) => f.slice(CODE_DIR.length + 1));
    expect(names).toEqual(expect.arrayContaining(['encoder.ts', 'index.ts', 'layout.ts', 'primitives.ts', 'profile.ts']));
  });

  it.each(FILES)('%s runs in browsers and Node alike', (file) => {
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toMatch(/from\s+['"]node:/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\b(Buffer|window|document|navigator|process)\b/);
    for (const [, specifier] of source.matchAll(/from\s+['"](\.[^'"]*)['"]/g)) expect(specifier).toMatch(/\.js$/);
  });
});
