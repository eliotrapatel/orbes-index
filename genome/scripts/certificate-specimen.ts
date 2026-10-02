/**
 * Renders the certificate card specimen of BRAND-DESIGN-SYSTEM §7.
 *
 *   npx tsx scripts/certificate-specimen.ts
 *
 * Writes into docs/assets/:
 *   certificate-card-specimen.svg           the card as delivered (panel on)
 *   certificate-card-specimen-revealed.svg  the same card, panel scratched off
 *   certificate-card-specimen.pdf           the production PDF of that card
 *                                           (K-only black, ORBES SCRATCH-OFF spot plate, overprint)
 *
 * The specimen piece is the sample identity of the code samples, O26-J-00184
 * (genome G1-E1DC-BE52), with an invented claim code: no product's claim
 * code ever leaves the server except to the operator who issued it. Output is
 * byte for byte reproducible; test/render/certificate.test.ts checks that the
 * committed files are what this script produces, so run it after any change
 * to the card (and after the brand's validation, which removes PROOF).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeGenome } from '../src/core/genome/genome.js';
import { packIdentity } from '../src/core/identity.js';
import { certificateCardSvg, renderCertificatePdf, type CertificateItem } from '../src/server/render/certificate.js';

export const DEFAULT_OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/assets');

/** The specimen piece. The claim code is invented for the specimen and belongs to no product. */
export const CERTIFICATE_SPECIMEN_ITEM: Readonly<CertificateItem> = Object.freeze({
  productId: 'O26-J-00184',
  model: 'MONOLITHE · RING',
  material: '925 STERLING SILVER',
  genome: computeGenome(packIdentity({ year: 2026, categoryIndex: 1, serial: 184 })),
  claimCode: '7KQ2-M4TD-9XWH',
});

/** Fixed creation date of the specimen PDF (reproducible output). */
export const SPECIMEN_DATE = new Date('2026-10-02T00:00:00.000Z');

export async function renderCertificateSpecimenFiles(): Promise<{ name: string; bytes: Uint8Array }[]> {
  const utf8 = (s: string) => new TextEncoder().encode(s);
  const pdf = await renderCertificatePdf([CERTIFICATE_SPECIMEN_ITEM], { layout: 'card', createdAt: SPECIMEN_DATE });
  return [
    { name: 'certificate-card-specimen.svg', bytes: utf8(certificateCardSvg(CERTIFICATE_SPECIMEN_ITEM)) },
    { name: 'certificate-card-specimen-revealed.svg', bytes: utf8(certificateCardSvg(CERTIFICATE_SPECIMEN_ITEM, { panel: false })) },
    { name: 'certificate-card-specimen.pdf', bytes: pdf.body as Uint8Array },
  ];
}

async function main(): Promise<void> {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  for (const f of await renderCertificateSpecimenFiles()) {
    writeFileSync(join(outDir, f.name), f.bytes);
    console.log(`${f.name.padEnd(40)} ${(f.bytes.length / 1024).toFixed(1).padStart(6)} KiB`);
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
