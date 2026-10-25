/**
 * Writes THE VAULT CARD's print files and specimen (plan OQ Q3 §5): the card
 * in the box of every bought piece, 95 × 62 mm (render/vault-card.ts).
 *
 *   npx tsx scripts/vault-card.ts
 *
 * Writes into docs/assets/:
 *   vault-card-sheet.pdf     A4, eight cards with cut marks: the fronts on
 *                            page 1, the backs on page 2 (duplex, long edge)
 *   vault-card-single.pdf    one card: the front with 3 mm of bleed, then the
 *                            back, each page with its 95 × 62 mm TrimBox
 *   vault-card-specimen.svg  the front and the back side by side
 * and copies the three into genome/src/server/documents/assets/, which the
 * console's Documents serves (THE VAULT CARD, docs/launch/VAULT-CARD.md).
 * Output is byte for byte reproducible; test/render/vault-card.test.ts
 * checks that the committed files are what this script produces, so run it
 * after any change to the card.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderVaultCardPdf, vaultCardSpecimenSvg } from '../src/server/render/vault-card.js';

const GENOME = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUT_DIR = resolve(GENOME, '../docs/assets');
export const DOCUMENTS_ASSETS_DIR = resolve(GENOME, 'src/server/documents/assets');

export async function renderVaultCardFiles(): Promise<{ name: string; bytes: Uint8Array }[]> {
  return [
    { name: 'vault-card-sheet.pdf', bytes: (await renderVaultCardPdf('sheet')).body },
    { name: 'vault-card-single.pdf', bytes: (await renderVaultCardPdf('single')).body },
    { name: 'vault-card-specimen.svg', bytes: new TextEncoder().encode(vaultCardSpecimenSvg()) },
  ];
}

async function main(): Promise<void> {
  const outDirs = process.argv[2] ? [resolve(process.argv[2])] : [DEFAULT_OUT_DIR, DOCUMENTS_ASSETS_DIR];
  const files = await renderVaultCardFiles();
  for (const dir of outDirs) {
    mkdirSync(dir, { recursive: true });
    for (const f of files) writeFileSync(join(dir, f.name), f.bytes);
  }
  for (const f of files) console.log(`${f.name.padEnd(28)} ${(f.bytes.length / 1024).toFixed(1).padStart(7)} KiB`);
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
