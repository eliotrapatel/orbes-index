/**
 * SHARE THE GENOME (P-D01, src/web/verify/share-image.ts): the image of the
 * ceremony of a first registration, drawn on a recording 2D context (the
 * canvas itself is drawn in Chromium by verify.e2e.test.ts), and the tap that
 * shares it or, where the browser cannot share a file, saves it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeGenome, genomeLayout, identityFromGenomeGlyphs } from '../../src/core/genome/index.js';
import { primitiveToPathData } from '../../src/core/render/svg.js';
import { CEREMONY } from '../../src/web/verify/copy.js';
import { drawShareImage, SHARE_IMAGE, shareGenomeImage, textRuns, type ShareContext, type ShareNavigator } from '../../src/web/verify/share-image.js';

const GLYPHS = [14, 1, 13, 12, 11, 14, 5, 2];
const GENOME = computeGenome(identityFromGenomeGlyphs(GLYPHS, 1), 1);
const FONTS = { display: '"Gravesend Sans", "Helvetica Neue", sans-serif', reading: '"Helvetica Neue", sans-serif' };

/** A 2D context that records what is drawn: text with its face and colour, filled paths with their transform. */
class Recorder implements ShareContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  globalAlpha = 1;
  letterSpacing = '0px';
  transform: number[] = [1, 0, 0, 1, 0, 0];
  rects: { x: number; y: number; w: number; h: number; fill: string }[] = [];
  texts: { text: string; x: number; y: number; font: string; fill: string }[] = [];
  paths: { d: string; transform: number[] }[] = [];
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h, fill: String(this.fillStyle) });
  }
  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y, font: this.font, fill: String(this.fillStyle) });
  }
  measureText(text: string): { width: number } {
    // A plain metric: the size times the letters (and the tracking, as a canvas counts it after every letter).
    const px = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10);
    return { width: text.length * (px * 0.7 + Number.parseFloat(this.letterSpacing)) };
  }
  setTransform(...m: number[]): void {
    this.transform = m;
  }
  fill(path: Path2D): void {
    this.paths.push({ d: (path as unknown as { d: string }).d, transform: this.transform });
  }
}

describe('SHARE THE GENOME: the image (P-D01)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'Path2D',
      class {
        constructor(readonly d: string) {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('splits a name into the runs of the display face and its figures (as withNumerals)', () => {
    expect(textRuns('MONOLITHE')).toEqual([{ text: 'MONOLITHE', numeral: false }]);
    expect(textRuns('ORBIT 2026')).toEqual([
      { text: 'ORBIT ', numeral: false },
      { text: '2026', numeral: true },
    ]);
    expect(textRuns('01 SEAL 1')).toEqual([
      { text: '01', numeral: true },
      { text: ' SEAL ', numeral: false },
      { text: '1', numeral: true },
    ]);
  });

  it('draws on ivory, in the ivory colourway, the GENOME of genomeLayout as the result draws it: the ORBES monogram at its centre (decision 12), one Path2D per outline and per primitive', () => {
    const ctx = new Recorder();
    drawShareImage(ctx, GENOME, { name: 'MONOLITHE', collection: 'ORBIT' }, FONTS);
    expect(SHARE_IMAGE).toMatchObject({ width: 1080, height: 1350, paper: '#F6F2EA', ink: '#111111' });
    expect(ctx.rects).toEqual([{ x: 0, y: 0, w: 1080, h: 1350, fill: '#F6F2EA' }]);
    const { primitives, viewBox, monogram } = genomeLayout(GENOME, 'orbit', { centre: 'monogram' });
    expect(monogram).toHaveLength(5);
    // The monogram's five outlines first, then the glyphs and their separators; no SEAL.
    expect(ctx.paths.map((p) => p.d)).toEqual([...monogram!, ...primitives.map(primitiveToPathData)]);
    expect(primitives.some((p) => p.layer === 'seal')).toBe(false);
    expect(new Set(ctx.paths.map((p) => p.transform.join(' '))).size).toBe(1);
    // Scaled into the orbit's square, centred across the image.
    const [scale, , , , dx, dy] = ctx.paths[0].transform;
    expect(scale * viewBox.w).toBeCloseTo(SHARE_IMAGE.orbit);
    expect(dx + (viewBox.x + viewBox.w / 2) * scale).toBeCloseTo(SHARE_IMAGE.width / 2);
    expect(dy + (viewBox.y + viewBox.h / 2) * scale).toBeCloseTo(SHARE_IMAGE.orbitY);
    // Text is drawn back in the plain frame, after the orbit.
    expect(ctx.transform).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('writes the wordmark, its label, the name of the model and its collection, and nothing of the piece or the account', () => {
    const ctx = new Recorder();
    drawShareImage(ctx, GENOME, { name: 'MONOLITHE', collection: 'ORBIT' }, FONTS);
    expect(ctx.texts.map((t) => t.text)).toEqual(['ORBES', 'GENOME', 'MONOLITHE', 'ORBIT']);
    expect(ctx.texts.map((t) => t.fill)).toEqual(['#111111', '#5c5c5c', '#111111', '#5c5c5c']);
    // Top to bottom: the wordmark, its label, the orbit, the name, the collection.
    const ys = ctx.texts.map((t) => t.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(ys[1]).toBeLessThan(SHARE_IMAGE.orbitY - SHARE_IMAGE.orbit / 2);
    expect(ys[2]).toBeGreaterThan(SHARE_IMAGE.orbitY + SHARE_IMAGE.orbit / 2);
    // Words in the display face; the identity (product id, fingerprint) is never written.
    for (const t of ctx.texts) expect(t.font).toContain(FONTS.display);
    const all = ctx.texts.map((t) => t.text).join(' ');
    expect(all).not.toMatch(/O26|G1-|@/);
    expect(all).not.toContain(GENOME.fingerprint);
  });

  it('sets a figure of a name in the reading face, centres each line, and shrinks a long name to the image', () => {
    const ctx = new Recorder();
    drawShareImage(ctx, GENOME, { name: 'MONOLITHE 2026' }, FONTS);
    const name = ctx.texts.filter((t) => t.y === 1120);
    expect(name.map((t) => t.text)).toEqual(['MONOLITHE ', '2026']);
    expect(name[0].font).toContain(FONTS.display);
    expect(name[1].font).toBe(`400 54px ${FONTS.reading}`);
    expect(name[1].x).toBeGreaterThan(name[0].x);
    // Without a collection, no line under the name.
    expect(ctx.texts.map((t) => t.text)).toEqual(['ORBES', 'GENOME', 'MONOLITHE ', '2026']);

    const long = new Recorder();
    drawShareImage(long, GENOME, { name: 'A VERY LONG NAME FOR A MODEL OF THE MAISON' }, FONTS);
    const line = long.texts.find((t) => t.text.startsWith('A VERY'))!;
    const px = Number(/(\d+)px/.exec(line.font)![1]);
    expect(px).toBeLessThan(54);
    expect(line.x).toBeGreaterThanOrEqual(0);
  });
});

describe('SHARE THE GENOME: the tap (P-D01)', () => {
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

  it('hands the ready file to navigator.share when navigator.canShare accepts it, within the tap', async () => {
    const shared: ShareData[] = [];
    const nav: ShareNavigator = {
      canShare: (d) => Array.isArray(d?.files) && d.files.length === 1,
      share: (d) => {
        shared.push(d);
        return Promise.resolve();
      },
    };
    const save = vi.fn();
    const result = shareGenomeImage(blob, nav, save);
    // Called before anything is awaited: the gesture is still there.
    expect(shared).toHaveLength(1);
    await expect(result).resolves.toBe('shared');
    expect(save).not.toHaveBeenCalled();
    const file = shared[0].files![0];
    expect(file.name).toBe(CEREMONY.filename);
    expect(file.type).toBe('image/png');
    expect(shared[0].title).toBe(CEREMONY.shareTitle);
    expect(CEREMONY).toMatchObject({ share: 'SHARE THE GENOME', filename: 'ORBES-GENOME.png' });
  });

  it('saves the file where the browser cannot share it (no share, no canShare, or a file refused)', async () => {
    for (const nav of [{}, { share: () => Promise.resolve() }, { canShare: () => false, share: () => Promise.resolve() }, { canShare: () => { throw new Error('x'); }, share: () => Promise.resolve() }] as ShareNavigator[]) {
      const save = vi.fn();
      await expect(shareGenomeImage(blob, nav, save)).resolves.toBe('saved');
      expect(save).toHaveBeenCalledWith({ blob, filename: CEREMONY.filename });
    }
  });

  it('leaves a share sheet the customer closes at that, and saves the file when the browser refuses to share', async () => {
    const abort = vi.fn();
    const closed: ShareNavigator = { canShare: () => true, share: () => Promise.reject(Object.assign(new Error('closed'), { name: 'AbortError' })) };
    await expect(shareGenomeImage(blob, closed, abort)).resolves.toBe('cancelled');
    expect(abort).not.toHaveBeenCalled();
    const save = vi.fn();
    const refused: ShareNavigator = { canShare: () => true, share: () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })) };
    await expect(shareGenomeImage(blob, refused, save)).resolves.toBe('saved');
    expect(save).toHaveBeenCalledTimes(1);
  });
});
