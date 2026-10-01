import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CORE = join(dirname(fileURLToPath(import.meta.url)), '../../src/core');
const FILES = [...readdirSync(join(CORE, 'genome')).map((f) => join(CORE, 'genome', f)), join(CORE, 'render/svg.ts')];

describe('genome and SVG renderer modules', () => {
  it.each(FILES)('%s runs in browsers and Node alike', (file) => {
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toMatch(/from\s+['"]node:/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\b(Buffer|window|document|navigator|process)\b/);
    for (const [, specifier] of source.matchAll(/from\s+['"](\.[^'"]*)['"]/g)) expect(specifier).toMatch(/\.js$/);
  });
});
