/**
 * THE VAULT CARD (render/vault-card.ts; plan OQ Q3 §5): the card in the box
 * of a bought piece, 95 × 62 mm like the MINT CERTIFICATE, as the card
 * mockup draws it (vault/card/vault-card-mockup.html, CD) with the words of
 * vault/SCOPE.md H (D47): the front black with THE VAULT over the engraved
 * monogram and no ORBES word; the back with THE VAULT, the title on two
 * lines, the horizon and its point, the two sentences each on its line, a
 * plain hairline, the three steps, the monogram and THEORBES.COM (D14).
 * The print files (D48, OP-31): the single card with its bleed and TrimBox,
 * the A4 sheet of eight with cut marks and its backs mirrored for duplex;
 * K only, no font, byte for byte what scripts/vault-card.ts writes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderVaultCardFiles } from '../../scripts/vault-card.js';
import { CERTIFICATE_CARD, layoutCertificateSheet } from '../../src/server/render/certificate.js';
import { mmToPt } from '../../src/server/render/scene.js';
import {
  VAULT_CARD,
  VAULT_CARD_BACK,
  VAULT_CARD_COPY,
  VAULT_CARD_FRONT,
  layoutVaultCardBack,
  layoutVaultCardFront,
  renderVaultCardPdf,
  vaultCardSheetPages,
  vaultCardSinglePages,
  vaultCardSpecimenSvg,
} from '../../src/server/render/vault-card.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const ASSETS = join(ROOT, 'docs', 'assets');
const SERVER_ASSETS = join(ROOT, 'genome', 'src', 'server', 'documents', 'assets');

const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');

/** Concatenated, inflated content of every stream in a PDF. */
function pdfStreams(pdf: Uint8Array): string {
  const text = latin1(pdf);
  let out = '';
  const re = /(?<!end)stream\r?\n/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    const raw = Buffer.from(pdf.subarray(start, end));
    try {
      out += inflateSync(raw).toString('latin1') + '\n';
    } catch {
      out += raw.toString('latin1') + '\n';
    }
    re.lastIndex = end;
  }
  return out;
}
const pdfObjects = (pdf: Uint8Array) => latin1(pdf).replace(/(?<!end)stream\r?\n[\s\S]*?endstream/g, 'stream endstream');
const pt = (mm: number) => Math.round(mmToPt(mm) * 1e4) / 1e4;

/** Every coordinate pair of absolute path data. */
function coords(d: string): [number, number][] {
  const n = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
}

describe('THE VAULT CARD: what it is', () => {
  it('is 95 × 62 mm, the MINT CERTIFICATE\'s size, with 3 mm of bleed on the front', () => {
    expect(VAULT_CARD).toMatchObject({ widthMm: 95, heightMm: 62, bleedMm: 3 });
    expect([VAULT_CARD.widthMm, VAULT_CARD.heightMm]).toEqual([CERTIFICATE_CARD.widthMm, CERTIFICATE_CARD.heightMm]);
  });

  it('says the words of SCOPE H word for word, "we" on the card (D13, D47) and THEORBES.COM (D14)', () => {
    expect(VAULT_CARD_COPY.over).toBe('THE VAULT');
    expect(VAULT_CARD_COPY.title).toEqual(['THIS PIECE', 'OPENS A VAULT']);
    expect(VAULT_CARD_COPY.sentences).toEqual([
      'Thank you for your order. With this piece, we have added a vault to your account.',
      'Open it for a chance to win a prize or to unlock an access we reserve for our collectors.',
    ]);
    expect(VAULT_CARD_COPY.steps).toEqual([
      { number: 'I', word: 'REGISTER', line: 'Your piece, with the code on its certificate.' },
      { number: 'II', word: 'FIND YOUR VAULT', line: 'In YOUR ACCOUNT, under THE VAULT. It is kept for 30 days.' },
      { number: 'III', word: 'OPEN IT', line: 'Press and hold its door. What it holds is yours.' },
    ]);
    expect(VAULT_CARD_COPY.address).toBe('THEORBES.COM');
  });

  it('draws the front: THE and VAULT only, no ORBES word, over the engraved monogram, where CD draws them (its PNG: THE 47.0, VAULT 47.5, the O 47.1 mm), VAULT centred by ink on the card', () => {
    const f = layoutVaultCardFront();
    expect(f.runs.map((r) => r.text)).toEqual(['THE', 'VAULT']);
    const centreOf = (r: { left: number; right: number }) => (r.left + r.right) / 2;
    const [the, vault] = f.runs;
    // Measured on vault-card-mockup.png (10 px to the mm, the card from x 40): THE's ink 480–539, VAULT's 375–654, the O's 345–676.
    expect(centreOf(the)).toBeCloseTo(47.0, 1);
    expect(centreOf(vault)).toBeCloseTo(VAULT_CARD.widthMm / 2, 1);
    const ring = f.ring as { x: number; w: number; y: number; h: number };
    expect(ring.x).toBeCloseTo(30.5, 1);
    expect(ring.x + ring.w).toBeCloseTo(63.65, 1);
    // THE over VAULT, both inside the O; the monogram is the mockup's (39.7 seal units of 5/6 mm: 33.1 mm wide), centred on the seal.
    expect(the.baseline).toBeLessThan(vault.baseline);
    expect(f.monogram.w).toBeCloseTo(33.11, 1);
    expect(Math.abs(f.monogram.y + f.monogram.h / 2 - VAULT_CARD_FRONT.centreY)).toBeLessThan(0.5);
    expect(vault.left).toBeGreaterThan(ring.x);
    expect(vault.right).toBeLessThan(ring.x + ring.w);
  });

  it('prints the front in K: VAULT the bare stock, THE at the mockup\'s 85 % (K 15), the engraving\'s face and edge as K tints under its veil, nothing but the black past them', () => {
    const f = layoutVaultCardFront();
    const fills = f.layers.filter((l) => l.kind === 'fill');
    expect(fills.slice(-2).map((l) => (l as { k: number }).k)).toEqual([15, 0]);
    const clip = f.layers[0];
    expect(clip.kind).toBe('clip');
    const faceK = (clip as unknown as { items: { k: number }[] }).items.map((i) => i.k);
    // The face: the mockup's 3–17 % ivory, darkened by the veil: K 83 to 99, one per cent apart.
    expect(Math.min(...faceK)).toBe(83);
    expect(Math.max(...faceK)).toBeLessThanOrEqual(99);
    const edges = f.layers.filter((l) => l.kind === 'stroke') as { k: number; width: number }[];
    // The edge: the mockup's 12–62 % ivory under the veil, K 51 at its lightest.
    expect(Math.min(...edges.map((e) => e.k))).toBe(51);
    expect(Math.max(...edges.map((e) => e.k))).toBeLessThanOrEqual(99);
    for (const e of edges) expect(e.width).toBe(0.1);
    // Every mark of the front inside the card, the monogram included.
    for (const l of f.layers) {
      for (const [x, y] of coords(l.kind === 'clip' ? l.clip : l.d)) {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(VAULT_CARD.widthMm);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(VAULT_CARD.heightMm);
      }
    }
  });

  it('draws the back in CD\'s order: THE VAULT, the title on two lines THIS PIECE above OPENS A VAULT, the two sentences each on its line, I / II / III with their words and lines, THEORBES.COM', () => {
    const b = layoutVaultCardBack();
    expect(b.runs.map((r) => r.text)).toEqual([
      'THE VAULT',
      'THIS PIECE',
      'OPENS A VAULT',
      ...VAULT_CARD_COPY.sentences,
      'I',
      'REGISTER',
      'Your piece, with the code on its',
      'certificate.',
      'II',
      'FIND YOUR VAULT',
      'In YOUR ACCOUNT, under THE',
      'VAULT. It is kept for 30 days.',
      'III',
      'OPEN IT',
      'Press and hold its door. What it',
      'holds is yours.',
      'THEORBES.COM',
    ]);
    // The steps' lines are their sentences, wrapped as CD wraps them.
    VAULT_CARD_COPY.steps.forEach((s) => {
      const i = b.runs.findIndex((r) => r.text === s.word);
      expect(`${b.runs[i + 1].text} ${b.runs[i + 2].text}`).toBe(s.line);
    });
    const at = (t: string) => b.runs.find((r) => r.text === t) as (typeof b.runs)[number];
    // The title: two lines, flush left, THIS PIECE above OPENS A VAULT.
    expect(at('THIS PIECE').baseline).toBeLessThan(at('OPENS A VAULT').baseline);
    expect(Math.abs(at('THIS PIECE').left - at('OPENS A VAULT').left)).toBeLessThan(0.15);
    // Each sentence on its own line, "Open it…" under "Thank you…".
    const [s1, s2] = VAULT_CARD_COPY.sentences.map(at);
    expect(s2.baseline - s1.baseline).toBeCloseTo(2.944, 2);
    // Everything inside the content's edges, each step's line inside its column.
    for (const r of b.runs) {
      expect(r.left, r.text).toBeGreaterThanOrEqual(VAULT_CARD_BACK.x0);
      expect(r.right, r.text).toBeLessThanOrEqual(VAULT_CARD_BACK.x1);
    }
    VAULT_CARD_COPY.steps.forEach((s, i) => {
      const x = VAULT_CARD_BACK.columns.x[i];
      const k = b.runs.findIndex((r) => r.text === s.word);
      for (const r of b.runs.slice(k - 1, k + 3)) expect(r.right, r.text).toBeLessThanOrEqual(x + VAULT_CARD_BACK.columns.width);
    });
    expect(at('THEORBES.COM').right).toBeCloseTo(VAULT_CARD_BACK.x1 - 0.546, 0);
  });

  it('lays the horizon and its point under the title, and a plain hairline, with no point, between the sentences and I / II / III (CD .steps border-top)', () => {
    const b = layoutVaultCardBack();
    const at = (t: string) => b.runs.find((r) => r.text === t) as (typeof b.runs)[number];
    const points = b.rects.filter((r) => r.name === 'point');
    expect(points).toHaveLength(1);
    const point = points[0];
    const rule = b.rects.find((r) => r.name === 'rule') as (typeof b.rects)[number];
    expect(point.y + point.h / 2).toBeCloseTo(rule.y + rule.h / 2, 3);
    expect(point.x + point.w / 2).toBeCloseTo(VAULT_CARD.widthMm / 2, 3);
    expect(rule.k).toBe(35);
    expect(at('OPENS A VAULT').baseline).toBeLessThan(rule.y);
    expect(rule.y + rule.h).toBeLessThan(at(VAULT_CARD_COPY.sentences[0]).baseline - 1.9 * 0.714);
    // The ramps fade from 35 % to nothing at both ends.
    const ramps = b.rects.filter((r) => r.name.startsWith('rule-in-'));
    expect(ramps.length).toBeGreaterThan(20);
    expect(ramps[0].k).toBeLessThan(1);
    expect(ramps[ramps.length - 1].k).toBeLessThan(35);

    const hairline = b.rects.filter((r) => r.name === 'hairline');
    expect(hairline).toHaveLength(1);
    const [hl] = hairline;
    expect(hl).toMatchObject({ x: VAULT_CARD_BACK.x0, h: 0.1, k: 12 });
    expect(hl.x + hl.w).toBeCloseTo(VAULT_CARD_BACK.x1, 6);
    // Between the second sentence and the step numbers' tops, and no point on it.
    expect(hl.y).toBeGreaterThan(at(VAULT_CARD_COPY.sentences[1]).baseline);
    expect(hl.y + hl.h).toBeLessThan(at('I').baseline - 1.1 * 0.64);
    expect(point.y + point.h).toBeLessThan(hl.y);
  });

  it('inks the back in K at the mockup\'s opacities and never the stock: the title and step words 100, the sentences 78, the lines 68, the numbers 45, THE VAULT and the address 55', () => {
    const b = layoutVaultCardBack();
    const k = (l: (typeof b.layers)[number]) => (l as { k: number }).k;
    const fills = b.layers.filter((l) => l.kind === 'fill');
    expect(new Set(fills.map(k))).toEqual(new Set([...new Set([55, 100, 78, 45, 68, 35, 12]), ...b.rects.filter((r) => r.name.startsWith('rule-')).map((r) => r.k)]));
    // The ORBES monogram: the mockup's 30 px symbol, its ink 2.84 × 2.17 mm from (7.28, 55.02).
    expect(b.monogram.x).toBeCloseTo(7.281, 2);
    expect(b.monogram.y).toBeCloseTo(55.016, 2);
    expect(b.monogram.w).toBeCloseTo(2.838, 2);
  });
});

describe('THE VAULT CARD: print files', () => {
  it('the single card: two pages, front then back, 101 × 68 mm with a 95 × 62 mm TrimBox 3 mm in; the front\'s black reaches the bleed, the back has none', async () => {
    const r = await renderVaultCardPdf('single');
    expect(r).toMatchObject({ contentType: 'application/pdf', filename: 'vault-card-single.pdf' });
    const text = latin1(r.body);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text).toMatch(/\/Count 2\b/);
    expect(text.match(new RegExp(`/MediaBox \\[0 0 ${mmToPt(101).toFixed(6).replace(/0+$/, '')} ${mmToPt(68).toFixed(6).replace(/0+$/, '')}\\]`, 'g'))).toHaveLength(2);
    expect(text.match(new RegExp(`/TrimBox \\[${pt(3)} ${pt(3)} ${pt(98)} ${pt(65)}\\]`, 'g'))).toHaveLength(2);
    const [front, back] = vaultCardSinglePages();
    expect(front.layers?.[0]).toMatchObject({ kind: 'fill', k: 100, d: 'M0 0L101 0L101 68L0 68Z' });
    expect(back.layers?.some((l) => l.kind === 'fill' && l.k === 100 && l.d === 'M0 0L101 0L101 68L0 68Z')).toBe(false);
  });

  it('the A4 sheet: eight fronts on the certificate\'s grid with the black 3 mm past it, cut marks past the bleed, then the eight backs mirrored for duplex, long edge', async () => {
    const r = await renderVaultCardPdf('sheet');
    expect(r.filename).toBe('vault-card-sheet.pdf');
    const text = latin1(r.body);
    expect(text).toMatch(/\/Count 2\b/);
    expect(text).toMatch(new RegExp(`/MediaBox \\[0 0 ${mmToPt(210).toFixed(6).replace(/0+$/, '')} ${mmToPt(297).toFixed(6).replace(/0+$/, '')}\\]`));
    const [fronts, backs] = vaultCardSheetPages();
    const slots = layoutCertificateSheet(8).pages[0];
    expect(slots).toHaveLength(8);
    expect(fronts.layers?.[0]).toMatchObject({ kind: 'fill', k: 100, d: 'M7 21.5L203 21.5L203 275.5L7 275.5Z' });
    expect(fronts.layers?.slice(1)).toEqual(slots.flatMap((s) => layoutVaultCardFront(s.xMm, s.yMm).layers));
    // Long edge: the back of the card in column c prints in column 1 − c, on the same row.
    expect(backs.layers).toEqual(slots.flatMap((s) => layoutVaultCardBack(210 - s.xMm - 95, s.yMm).layers));
    const mirrored = slots.map((s) => [210 - s.xMm - 95, s.yMm]);
    expect(mirrored.map(([x]) => x).sort()).toEqual(slots.map((s) => s.xMm).sort());
    // The cut marks start 1 mm past the bleed, never on the black, and stay 4 mm inside the page's edge.
    for (const page of [fronts, backs]) {
      const cuts = coords(page.marks?.[0].d ?? '');
      expect(cuts.length).toBeGreaterThan(0);
      for (const [x, y] of cuts) {
        const outside = x <= 6 + 1e-9 || x >= 204 - 1e-9 || y <= 20.5 + 1e-9 || y >= 276.5 - 1e-9;
        expect(outside, `${x} ${y}`).toBe(true);
        expect(x).toBeGreaterThanOrEqual(4);
        expect(x).toBeLessThanOrEqual(206);
      }
    }
    expect(text.replace(/\0/g, '')).toContain('ORBES THE VAULT CARD · A4 SHEET OF 8');
  });

  it('is K only, vector, without a font, an image or text: every colour C = M = Y = 0', async () => {
    for (const layout of ['single', 'sheet'] as const) {
      const pdf = (await renderVaultCardPdf(layout)).body;
      expect(pdfObjects(pdf)).not.toMatch(/\/Font|\/Subtype\s*\/Image|\/XObject|\/Separation|\/ExtGState/);
      const content = pdfStreams(pdf);
      expect(content).not.toMatch(/DeviceRGB|\bBT\b|\bTj\b|\bTJ\b|\bDo\b/);
      expect(content).toContain('0 0 0 1 scn');
      for (const m of content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) (scn|SCN)/g)) expect([m[1], m[2], m[3]]).toEqual(['0', '0', '0']);
    }
  });

  it('the committed files are byte for byte what scripts/vault-card.ts writes (run it after any change), in docs/assets and in the server\'s copies', async () => {
    const files = await renderVaultCardFiles();
    expect(files.map((f) => f.name)).toEqual(['vault-card-sheet.pdf', 'vault-card-single.pdf', 'vault-card-specimen.svg']);
    for (const dir of [ASSETS, SERVER_ASSETS]) {
      for (const f of files) {
        const path = join(dir, f.name);
        expect(existsSync(path), `${path} missing: run npx tsx scripts/vault-card.ts`).toBe(true);
        expect(Buffer.from(readFileSync(path)).equals(Buffer.from(f.bytes)), `${path} is stale: run npx tsx scripts/vault-card.ts`).toBe(true);
      }
    }
    // Reproducible: the same bytes twice.
    const again = await renderVaultCardFiles();
    files.forEach((f, i) => expect(Buffer.from(again[i].bytes).equals(Buffer.from(f.bytes))).toBe(true));
  });

  it('the specimen shows both faces side by side on the mockup\'s ground, the front black and the back on its ivory stock', () => {
    const svg = vaultCardSpecimenSvg();
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="202mm" height="70mm" viewBox="0 0 202 70">/);
    expect(svg).toContain('<rect x="4" y="4" width="95" height="62" fill="#0B0B0C"/>');
    expect(svg).toContain('<rect x="103" y="4" width="95" height="62" fill="#ECE6DA"/>');
    expect(svg).not.toMatch(/<text|font-family|@font-face/);
  });
});

describe('THE VAULT CARD in the console\'s Documents (docs/launch/VAULT-CARD.md)', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'launch', 'VAULT-CARD.md'), 'utf8');

  it('quotes the card\'s words as they are printed, and links the specimen and the two print files', () => {
    for (const line of [VAULT_CARD_COPY.over, VAULT_CARD_COPY.title.join(' / '), ...VAULT_CARD_COPY.sentences, VAULT_CARD_COPY.address]) expect(doc, line).toContain(line);
    for (const s of VAULT_CARD_COPY.steps) expect(doc).toContain(`${s.word} · ${s.line}`);
    expect(doc).toContain('](../assets/vault-card-specimen.svg)');
    expect(doc).toContain('[vault-card-sheet.pdf](../assets/vault-card-sheet.pdf)');
    expect(doc).toContain('[vault-card-single.pdf](../assets/vault-card-single.pdf)');
    // How to print: duplex on the long edge, at actual size, cut to 95 × 62 mm like the MINT CERTIFICATE; the checklist line.
    expect(doc).toMatch(/bord long/);
    expect(doc).toMatch(/taille réelle/);
    expect(doc).toContain('95 × 62 mm, comme la MINT CERTIFICATE');
    expect(doc).toContain('`THE VAULT CARD`');
  });

  it('is named, beside the MINT CERTIFICATE, by one line of the packaging kit', () => {
    const kit = readFileSync(join(ROOT, 'docs', 'launch', 'PACKAGING-KIT.md'), 'utf8');
    const lines = kit.split('\n').filter((l) => l.includes('THE VAULT CARD'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('MINT CERTIFICATE');
    expect(lines[0]).toContain('(VAULT-CARD.md)');
  });
});
