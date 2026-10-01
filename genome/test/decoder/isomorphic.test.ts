import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const DECODER_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/core/decoder');
const FILES = readdirSync(DECODER_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => join(DECODER_DIR, f));

describe('decoder modules', () => {
  it.each(FILES)('%s runs in browsers, workers and Node alike', (file) => {
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toMatch(/from\s+['"]node:/);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\b(Buffer|window|document|navigator|process|self)\b/);
    expect(source).not.toMatch(/Math\.random/);
    for (const [, specifier] of source.matchAll(/from\s+['"](\.[^'"]*)['"]/g)) expect(specifier).toMatch(/\.js$/);
  });

  it('bundles for a browser Web Worker with no Node built-ins', async () => {
    const result = await build({
      entryPoints: [join(DECODER_DIR, 'index.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: ['es2022', 'safari15'],
      logLevel: 'silent',
      metafile: true,
    });
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.some((p) => p.includes('decoder/decode.ts'))).toBe(true);
    expect(inputs.every((p) => !p.startsWith('node:'))).toBe(true);
    const text = result.outputFiles[0].text;
    expect(text).toMatch(/export\s*\{[^}]*decodeOrbesCode/);
    // The worker bundle stays small enough to start instantly on a phone.
    expect(text.length).toBeLessThan(200_000);
  });
});
