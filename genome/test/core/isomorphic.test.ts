/**
 * Isomorphism of the whole core (src/core/**): the same modules run in
 * browsers, Web Workers and Node. Per-area tests (code, genome, decoder) scan
 * their own directories; this one covers every core file, including ecc/,
 * identity, payload, bytes and verify/, and checks the property at run time:
 * the bundled core must evaluate in a bare JavaScript realm that has no Node,
 * DOM or WHATWG host globals at all.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const CORE = join(dirname(fileURLToPath(import.meta.url)), '../../src/core');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const FILES = sourceFiles(CORE).map((file) => relative(CORE, file));

/** Packages core may depend on: audited, dependency-free and isomorphic themselves. */
const ALLOWED_PACKAGES = /^@noble\/(hashes|curves)\//;

async function bundleCore(format: 'esm' | 'iife') {
  return build({
    entryPoints: [join(CORE, 'index.ts')],
    bundle: true,
    write: false,
    format,
    globalName: format === 'iife' ? 'orbesCore' : undefined,
    platform: 'browser',
    target: ['es2022'],
    logLevel: 'silent',
    metafile: true,
  });
}

describe('src/core', () => {
  it('covers every module directory', () => {
    const dirs = new Set(FILES.map((f) => dirname(f)));
    expect([...dirs].sort()).toEqual(['.', 'code', 'decoder', 'ecc', 'genome', 'render', 'verify']);
  });

  it.each(FILES)('%s uses no host-specific API and imports with .js extensions', (file) => {
    const source = readFileSync(join(CORE, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toMatch(/from\s+['"]node:/);
    expect(source).not.toMatch(/\b(require|import)\s*\(/);
    expect(source).not.toMatch(/\b(Buffer|window|document|navigator|process|self|localStorage)\b/);
    expect(source).not.toMatch(/Math\.random/);
    for (const [, specifier] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (specifier.startsWith('.')) expect(specifier).toMatch(/\.js$/);
      else expect(specifier).toMatch(ALLOWED_PACKAGES);
    }
  });

  it('bundles for browsers with no Node built-in and no package beyond @noble', async () => {
    const result = await bundleCore('esm');
    for (const input of Object.keys(result.metafile.inputs)) {
      expect(input.startsWith('node:')).toBe(false);
      if (input.includes('node_modules/')) expect(input.split('node_modules/')[1]).toMatch(ALLOWED_PACKAGES);
    }
  });

  it('evaluates in a bare realm: importing core touches no host global', async () => {
    const result = await bundleCore('iife');
    // A fresh vm context holds only ECMAScript built-ins: no TextEncoder,
    // crypto, performance, URL, console, process or Buffer.
    const realm: { orbesCore?: Record<string, unknown> } = {};
    expect(() => runInNewContext(result.outputFiles[0].text, realm)).not.toThrow();
    const core = realm.orbesCore as {
      computeGenome(packed: number): { fingerprint: string };
      rsDecode(codeword: Uint8Array, nsym: number): { ok: boolean };
      rsEncode(data: Uint8Array, nsym: number): Uint8Array;
      crc16(bytes: Uint8Array): number;
    };
    // The pure codec functions keep working there too.
    expect(core.computeGenome(0x341000b8).fingerprint).toBe('G1-E1DC-BE52');
    expect(core.crc16(Uint8Array.from('123456789', (c) => c.charCodeAt(0)))).toBe(0x29b1);
    const codeword = core.rsEncode(Uint8Array.of(1, 2, 3), 4);
    codeword[0] ^= 0xff;
    expect(core.rsDecode(codeword, 4).ok).toBe(true);
  });
});
