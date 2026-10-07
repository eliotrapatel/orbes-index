/**
 * SHARE TO STORIES (plan NEXT-NINE of 2026-10-06, §3.8 BP-10; src/web/verify/story-card.ts): the story card's words for
 * each of the three places, what it never carries, its drawing on a recording 2D context (the canvas itself is drawn in
 * Chromium by verify.e2e, verify.live.e2e and nocturne.content-draws), the cards a page keeps, and the tap that shares
 * the file or saves it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MONOGRAM_PATHS } from '../../src/core/render/monogram.js';
import { LIVE, NOW, STORY } from '../../src/web/verify/copy.js';
import { liveStoryModel } from '../../src/web/verify/live-model.js';
import { drawStoryModel } from '../../src/web/verify/releases-model.js';
import type { ShareNavigator } from '../../src/web/verify/share-image.js';
import {
  canShareStory,
  drawStoryCard,
  shareStoryCard,
  STORY_CARD,
  StoryCards,
  storyCardModel,
  storyDate,
  storyTitleLines,
  storyWords,
  type StoryCardModel,
  type StoryContext,
  type StoryPhoto,
} from '../../src/web/verify/story-card.js';
import { resultViewModel } from '../../src/web/verify/view-model.js';
import type { ClubEntry, VerifyOutcome } from '../../src/web/verify/types.js';

const PHOTO = `/api/v1/media/${'a'.repeat(64)}`;
const FONTS = { display: '"Gravesend Sans", "Helvetica Neue", sans-serif', reading: '"Helvetica Neue", sans-serif' };
const T0 = '2026-10-08T17:00:00.000Z';

/** A 2D context that records what is drawn: each letter with its face, colour and transform; rectangles; the photograph; the fade. */
class Recorder implements StoryContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  lineWidth = 1;
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  globalAlpha = 1;
  transform: number[] = [1, 0, 0, 1, 0, 0];
  rects: { x: number; y: number; w: number; h: number; fill: unknown }[] = [];
  strokes: { x: number; y: number; w: number; h: number; stroke: string; width: number }[] = [];
  texts: { text: string; x: number; y: number; font: string; fill: string; alpha: number }[] = [];
  paths: { d: string; transform: number[]; alpha: number; fill: string }[] = [];
  images: number[][] = [];
  gradients: { box: number[]; stops: [number, string][] }[] = [];
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h, fill: this.fillStyle });
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.strokes.push({ x, y, w, h, stroke: String(this.strokeStyle), width: this.lineWidth });
  }
  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y, font: this.font, fill: String(this.fillStyle), alpha: this.globalAlpha });
  }
  measureText(text: string): { width: number } {
    // A plain metric: the size times the letters (no tracking: the card tracks letter by letter itself).
    const px = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10);
    return { width: text.length * px * 0.7 };
  }
  setTransform(...m: number[]): void {
    this.transform = m;
  }
  fill(path: Path2D): void {
    this.paths.push({ d: (path as unknown as { d: string }).d, transform: this.transform, alpha: this.globalAlpha, fill: String(this.fillStyle) });
  }
  drawImage(_img: StoryPhoto, ...box: number[]): void {
    this.images.push(box);
  }
  createLinearGradient(...box: number[]): CanvasGradient {
    const g = { box, stops: [] as [number, string][], addColorStop: (at: number, c: string) => g.stops.push([at, c]) };
    this.gradients.push(g);
    return g as unknown as CanvasGradient;
  }
  /** The letters drawn, joined into their lines (one line per y). */
  lines(): { text: string; y: number; size: number; fill: string }[] {
    const out: { text: string; y: number; size: number; fill: string; last: number; step: number }[] = [];
    for (const t of this.texts) {
      const size = Number(/(\d+)px/.exec(t.font)![1]);
      const line = out.find((l) => l.y === t.y);
      if (!line) out.push({ text: t.text, y: t.y, size, fill: t.fill, last: t.x, step: 0 });
      else {
        // A gap of two advances is a space (never drawn, its advance kept): a letter's is 0.7 em and its tracking (≤ 0.62 em).
        const gap = t.x - line.last;
        line.text += gap > size * 1.6 && gap > size * 0.7 * 2 ? ` ${t.text}` : t.text;
        line.last = t.x;
      }
    }
    return out.map(({ text, y, size, fill }) => ({ text, y, size, fill }));
  }
}

const photo = (width: number, height: number): StoryPhoto => ({ width, height }) as unknown as StoryPhoto;

function entry(over: Partial<ClubEntry> = {}): ClubEntry {
  return {
    id: '7f3c0a52-5b9d-4c1e-9a77-0c2f4d6b8e10',
    dropId: '11111111-2222-4333-8444-555555555555',
    title: 'MONOLITHE, THE OCTOBER DRAW',
    state: 'DRAWN',
    status: 'SELECTED',
    enteredAt: '2026-10-09T08:00:00.000Z',
    rank: 3,
    respondBy: '2026-10-13T18:00:00.000Z',
    reserved: false,
    opensAt: '2026-10-09T08:00:00.000Z',
    closesAt: '2026-10-10T18:00:00.000Z',
    drawnAt: '2026-10-11T18:00:00.000Z',
    ...over,
  };
}
const DRAW = { state: 'DRAWN' as const, title: 'MONOLITHE, THE OCTOBER DRAW', model: 'MONOLITHE · BRACELET', image: { src: PHOTO, alt: 'MONOLITHE' } };

beforeEach(() => {
  vi.stubGlobal(
    'Path2D',
    class {
      constructor(readonly d: string) {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('SHARE TO STORIES: the card of each place (BP-10)', () => {
  it('says the day on this phone\'s calendar, in capitals: its zone, or its offset east of UTC', () => {
    expect(storyDate(T0, 'Europe/Paris')).toBe('8 OCTOBER 2026');
    // Near midnight the phone's own day is the card's.
    expect(storyDate('2026-10-08T22:30:00.000Z', 'Europe/Paris')).toBe('9 OCTOBER 2026');
    expect(storyDate('2026-10-08T22:30:00.000Z', 'America/New_York')).toBe('8 OCTOBER 2026');
    expect(storyDate('2026-10-08T22:30:00.000Z', 120)).toBe('9 OCTOBER 2026');
    expect(storyDate('2026-10-08T22:30:00.000Z', -240)).toBe('8 OCTOBER 2026');
    expect(storyDate(Date.parse(T0), 'UTC')).toBe('8 OCTOBER 2026');
    // An unknown zone reads as UTC; nothing readable, nothing said.
    expect(storyDate(T0, 'Not/AZone')).toBe('8 OCTOBER 2026');
    for (const bad of [null, undefined, '', 'tomorrow', Number.NaN]) expect(storyDate(bad as never, 'UTC')).toBe('');
  });

  it('splits a title as modelTitle() does: the model\'s name on a line of its own', () => {
    expect(storyTitleLines('MONOLITHE IN BLUE', 'Monolithe')).toEqual(['MONOLITHE', 'IN BLUE']);
    expect(storyTitleLines('MONOLITHE, THE OCTOBER DRAW', 'MONOLITHE')).toEqual(['MONOLITHE,', 'THE OCTOBER DRAW']);
    expect(storyTitleLines('MONOLITHE', 'MONOLITHE')).toEqual(['MONOLITHE']);
    expect(storyTitleLines('THE OCTOBER DRAW', 'MONOLITHE')).toEqual(['THE OCTOBER DRAW']);
    expect(storyTitleLines('MONOLITHES', 'MONOLITHE')).toEqual(['MONOLITHES']);
    expect(storyTitleLines('MONOLITHE IN BLUE', null)).toEqual(['MONOLITHE IN BLUE']);
  });

  it('LIVE: CONFIRMED · LIVE RELEASE · the model with its variant · the day of T0 (an after-room\'s piece too)', () => {
    const sheet = { imageUrl: PHOTO, name: 'Monolithe', variant: 'Blue', opensAt: T0 };
    const m = liveStoryModel(sheet, 'Europe/Paris');
    expect(m).toEqual({ origin: 'live', photo: PHOTO, status: 'CONFIRMED', eyebrow: 'LIVE RELEASE', title: ['MONOLITHE', 'IN BLUE'], date: '8 OCTOBER 2026' });
    expect(STORY.kind.live).toBe(LIVE.kind);
    // An after-room's sheet (read through the release it follows) gives the same card: never THE AFTER-ROOM.
    const after = liveStoryModel({ ...sheet, afterRoom: { parentId: '11111111-2222-4333-8444-555555555555' } } as typeof sheet, 'Europe/Paris');
    expect(after).toEqual(m);
    expect(JSON.stringify(after)).not.toContain(LIVE.afterRoom.kind);
    // No variant: the model alone, on one line. Before the name's stage, no card.
    expect(liveStoryModel({ ...sheet, variant: null }, 'Europe/Paris')!.title).toEqual(['MONOLITHE']);
    expect(liveStoryModel({ ...sheet, name: null }, 'Europe/Paris')).toBeNull();
    expect(liveStoryModel({ ...sheet, name: '  ' }, 'Europe/Paris')).toBeNull();
  });

  it('DRAW: SELECTED for a place drawn, reserved directly or concluded; the day of the draw, or of the reservation', () => {
    const drawn = drawStoryModel(DRAW, entry(), 120);
    expect(drawn).toEqual({ origin: 'draw', photo: PHOTO, status: 'SELECTED', eyebrow: 'DRAW', title: ['MONOLITHE,', 'THE OCTOBER DRAW'], date: '11 OCTOBER 2026' });
    expect(STORY.kind.draw).toBe(NOW.draw);
    // A direct reservation: the day it was reserved (its entry's), not the draw's.
    expect(drawStoryModel(DRAW, entry({ reserved: true, enteredAt: '2026-10-08T21:00:00.000Z', drawnAt: null }), 120)!.date).toBe('8 OCTOBER 2026');
    expect(drawStoryModel(DRAW, entry({ reserved: true, enteredAt: '2026-10-08T22:30:00.000Z' }), 120)!.date).toBe('9 OCTOBER 2026');
    // CONFIRMED (the page says CONCLUDED): still SELECTED on the card.
    expect(drawStoryModel(DRAW, entry({ status: 'CONFIRMED' }), 120)!.status).toBe('SELECTED');
    expect(drawStoryModel(DRAW, entry({ status: 'CONFIRMED', reserved: true }), 120)!.date).toBe('9 OCTOBER 2026');
    // No card for ENTERED, WAITLISTED, LAPSED, WITHDRAWN, nor for a cancelled release, nor without an entry.
    for (const status of ['ENTERED', 'WAITLISTED', 'LAPSED', 'WITHDRAWN'] as const) expect(drawStoryModel(DRAW, entry({ status }), 120), status).toBeNull();
    expect(drawStoryModel({ ...DRAW, state: 'CANCELLED' }, entry(), 120)).toBeNull();
    expect(drawStoryModel(DRAW, null, 120)).toBeNull();
    // Drawn but no day known: no card. A title its model does not begin: one line.
    expect(drawStoryModel(DRAW, entry({ drawnAt: null }), 120)).toBeNull();
    expect(drawStoryModel({ ...DRAW, title: 'THE OCTOBER DRAW' }, entry(), 120)!.title).toEqual(['THE OCTOBER DRAW']);
  });

  it('REGISTERED: type and collection (or the type alone) · the model with its variant · the registration day', () => {
    const base = { photo: PHOTO, model: 'Monolithe', type: 'Bracelet', at: '2026-10-06T10:00:00.000Z', zone: 120 };
    expect(storyCardModel('registered', { ...base, collection: 'Orbital', variant: 'Gold' })).toEqual({
      origin: 'registered',
      photo: PHOTO,
      status: 'REGISTERED',
      eyebrow: 'BRACELET · ORBITAL',
      title: ['MONOLITHE', 'IN GOLD'],
      date: '6 OCTOBER 2026',
    });
    expect(storyCardModel('registered', { ...base, collection: null, variant: null })).toMatchObject({ eyebrow: 'BRACELET', title: ['MONOLITHE'] });
    expect(storyCardModel('registered', { ...base, type: '', collection: '' })).toBeNull();
  });

  it('is made only from this origin\'s media route, with a title and a date: otherwise no card (no button)', () => {
    const base = { model: 'MONOLITHE', type: 'RING', at: T0, zone: 'UTC' };
    for (const p of [null, undefined, '', 'https://example.com/a.jpg', '/api/v1/media/abc', `${PHOTO}?x=1`, `//evil.example${PHOTO}`, `data:image/png;base64,AAAA`, `blob:${PHOTO}`]) {
      expect(storyCardModel('registered', { ...base, photo: p }), String(p)).toBeNull();
    }
    expect(storyCardModel('registered', { ...base, photo: PHOTO, model: '' })).toBeNull();
    expect(storyCardModel('registered', { ...base, photo: PHOTO, at: null })).toBeNull();
    expect(storyCardModel('draw', { photo: PHOTO, model: 'MONOLITHE', title: '', at: T0, zone: 'UTC' })).toBeNull();
  });

  it('keeps nothing of the account, the entry or the piece: no id, reference, rank, size, quantity, price, email, product id, fingerprint or GENOME', () => {
    const outcome = {
      state: 'AUTHENTIC_OWNERSHIP_VERIFIED',
      title: 'AUTHENTIC — OWNERSHIP VERIFIED',
      message: '',
      scanId: '54adc7bd-0000-4000-8000-000000000000',
      verifiedAt: '2026-10-06T10:00:00.000Z',
      genome: { id: 'O26-J-00184', version: 'GENOME-01', fingerprint: 'G1-E1DC-BE52', glyphs: [14, 1, 13, 12, 11, 14, 5, 2] },
      product: { productId: 'O26-J-00184', model: 'MONOLITHE', type: 'BRACELET', collection: 'ORBITAL', modelVariant: 'GOLD', variant: 'SIZE 17', material: '925 STERLING SILVER', createdYear: 2026, imageUrl: PHOTO, category: { name: 'JEWELRY' } },
      ownership: { registered: true, you: true },
    } as unknown as VerifyOutcome;
    const vm = resultViewModel(outcome, { offsetMinutes: 120, ceremony: true });
    const registered = storyCardModel('registered', vm.story!)!;
    const cards: StoryCardModel[] = [
      registered,
      drawStoryModel(DRAW, entry({ id: 'e1e1e1e1-0000-4000-8000-000000000000', rank: 7 }), 0)!,
      liveStoryModel({ imageUrl: PHOTO, name: 'MONOLITHE', variant: 'BLUE', opensAt: T0 }, 'UTC')!,
    ];
    for (const m of cards) {
      expect(Object.keys(m).sort()).toEqual(['date', 'eyebrow', 'origin', 'photo', 'status', 'title']);
      const ctx = new Recorder();
      drawStoryCard(ctx, m, photo(1000, 1000), FONTS);
      const drawn = ctx.texts.map((t) => t.text).join('');
      const said = `${JSON.stringify(m)} ${drawn} ${storyWords(m).join(' ')}`;
      for (const banned of [/GENOME/i, /O26-J/, /G1-/, /E1DC/, /SIZE/, /17\b/, /€/, /@/, /REF/, /LR-/, /e1e1e1e1/, /7f3c0a52/, /54adc7bd/, /PIECES?\b/, /\bRANK\b/i]) {
        expect(said, `${m.origin} ${banned}`).not.toMatch(banned);
      }
    }
    expect(registered).toMatchObject({ eyebrow: 'BRACELET · ORBITAL', title: ['MONOLITHE', 'IN GOLD'], date: '6 OCTOBER 2026' });
  });
});

describe('SHARE TO STORIES: drawing the card, design A NOCTURNE (BP-10)', () => {
  const LIVE_CARD: StoryCardModel = { origin: 'live', photo: PHOTO, status: 'CONFIRMED', eyebrow: 'LIVE RELEASE', title: ['MONOLITHE', 'IN BLUE'], date: '8 OCTOBER 2026' };

  it('holds the mockup\'s values in the app\'s colour tokens: 1080 × 1920 on #0a0a0a', () => {
    expect(STORY_CARD).toMatchObject({ width: 1080, height: 1920, ground: '#0a0a0a', ivory: '#f6f2ea', ash: '#a7a29a', hairline: 'rgba(246,242,234,0.62)' });
    expect(STORY_CARD.width / STORY_CARD.height).toBeCloseTo(9 / 16);
    expect(STORY_CARD.wordmark).toEqual({ size: 44, tracking: 0.62, top: 132 });
    expect(STORY_CARD.label).toEqual({ top: 1190, size: 30, tracking: 0.46, padY: 20, padX: 26, border: 2 });
    expect(STORY_CARD.eyebrow).toEqual({ gap: 56, size: 26, tracking: 0.42 });
    expect(STORY_CARD.title).toMatchObject({ gap: 36, size: 88, tracking: 0.2, lineHeight: 1.12, long: { size: 72, tracking: 0.16 }, min: 56, step: 2, maxWidth: 960 });
    expect(STORY_CARD.date).toEqual({ gap: 40, size: 26, tracking: 0.42 });
    expect(STORY_CARD.monogram).toEqual({ side: 56, alpha: 0.9 });
    expect(STORY_CARD.site).toEqual({ gap: 26, size: 22, tracking: 0.5, bottom: 1810 });
  });

  it('draws the ground, the photograph in its 1080 window at y 250 and its fade, top to bottom', () => {
    const ctx = new Recorder();
    drawStoryCard(ctx, LIVE_CARD, photo(1200, 1200), FONTS);
    expect(ctx.rects[0]).toEqual({ x: 0, y: 0, w: 1080, h: 1920, fill: '#0a0a0a' });
    // A square photograph fills the window.
    expect(ctx.images).toEqual([[0, 0, 1200, 1200, 0, 250, 1080, 1080]]);
    expect(ctx.gradients.map(({ box, stops }) => ({ box, stops }))).toEqual([
      {
        box: [0, 250, 0, 1330],
        stops: [
          [0, '#0a0a0a'],
          [0.09, 'rgba(10,10,10,0.6)'],
          [0.26, 'rgba(10,10,10,0)'],
          [0.6, 'rgba(10,10,10,0)'],
          [1, '#0a0a0a'],
        ],
      },
    ]);
    expect(ctx.rects[1]).toMatchObject({ x: 0, y: 250, w: 1080, h: 1080 });
    // A taller photograph: scaled to the full width, cropped at its centre. A wider one: the full width, centred in the window.
    const tall = new Recorder();
    drawStoryCard(tall, LIVE_CARD, photo(800, 1200), FONTS);
    expect(tall.images).toEqual([[0, 200, 800, 800, 0, 250, 1080, 1080]]);
    const wide = new Recorder();
    drawStoryCard(wide, LIVE_CARD, photo(1600, 900), FONTS);
    expect(wide.images).toEqual([[0, 0, 1600, 900, 0, 250 + (1080 - 607.5) / 2, 1080, 607.5]]);
  });

  it('writes ORBES, the label in its hairline box, the eyebrow, the title on its lines, the date, then THEORBES.COM last', () => {
    const ctx = new Recorder();
    drawStoryCard(ctx, LIVE_CARD, photo(1000, 1000), FONTS);
    const lines = ctx.lines();
    expect(lines.map((l) => l.text)).toEqual(['ORBES', 'CONFIRMED', 'LIVE RELEASE', 'MONOLITHE', 'IN BLUE', '8 OCTOBER 2026', 'THEORBES.COM']);
    expect(lines.map((l) => l.size)).toEqual([44, 30, 26, 88, 88, 26, 22]);
    expect(lines.map((l) => l.fill)).toEqual(['#f6f2ea', '#f6f2ea', '#a7a29a', '#f6f2ea', '#f6f2ea', '#a7a29a', '#a7a29a']);
    // Top to bottom, each line's box as the mockup stacks it (a line's box 1.2 of its size; the title's 1.12).
    const ys = lines.map((l) => l.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(ys[0]).toBeCloseTo(132 + (44 * 1.2) / 2);
    const box = 2 + 20 + 30 * 1.2 + 20 + 2;
    expect(ys[1]).toBeCloseTo(1190 + box / 2);
    expect(ys[2]).toBeCloseTo(1190 + box + 56 + (26 * 1.2) / 2);
    const titleTop = 1190 + box + 56 + 26 * 1.2 + 36;
    expect(ys[3]).toBeCloseTo(titleTop + (88 * 1.12) / 2);
    expect(ys[4] - ys[3]).toBeCloseTo(88 * 1.12);
    expect(ys[5]).toBeCloseTo(titleTop + 2 * 88 * 1.12 + 40 + (26 * 1.2) / 2);
    // The foot ends at y 1810: THEORBES.COM's box, 26 px under the monogram.
    expect(ys[6]).toBeCloseTo(1810 - (22 * 1.2) / 2);
    expect(ctx.texts.at(-1)!.text).toBe('M');
    // The label's 2 px hairline box: centred, the tracking given back on both sides of the word, from y 1190.
    expect(ctx.strokes).toHaveLength(1);
    const s = ctx.strokes[0]!;
    expect(s).toMatchObject({ stroke: 'rgba(246,242,234,0.62)', width: 2 });
    expect(s.y).toBeCloseTo(1191);
    expect(s.h).toBeCloseTo(box - 2);
    const word = 9 * 30 * 0.7 + 8 * 30 * 0.46;
    expect(s.w + 2).toBeCloseTo(word + 2 * (26 + 30 * 0.46) + 4);
    expect(s.x + s.w / 2).toBeCloseTo(540);
  });

  it('tracks letter by letter (no letterSpacing), each line centred across the card', () => {
    const ctx = new Recorder();
    drawStoryCard(ctx, LIVE_CARD, photo(1000, 1000), FONTS);
    expect('letterSpacing' in ctx).toBe(false);
    const orbes = ctx.texts.filter((t) => t.y === ctx.lines()[0]!.y);
    expect(orbes.map((t) => t.text)).toEqual(['O', 'R', 'B', 'E', 'S']);
    // Each letter 0.7 em wide in the recorder, then 0.62 em of tracking.
    const steps = orbes.slice(1).map((t, i) => t.x - orbes[i]!.x);
    for (const step of steps) expect(step).toBeCloseTo(44 * 0.7 + 44 * 0.62);
    const width = 5 * 44 * 0.7 + 4 * 44 * 0.62;
    expect(orbes[0]!.x).toBeCloseTo((1080 - width) / 2);
    for (const t of ctx.texts) {
      expect(t.text).toHaveLength(1);
      expect(t.text).not.toBe(' ');
    }
  });

  it('sets the title\'s figures in the reading face, the date\'s in Gravesend (a recorded exception)', () => {
    const ctx = new Recorder();
    drawStoryCard(ctx, { ...LIVE_CARD, eyebrow: 'DRAW', title: ['ZENITH 22'] }, photo(1000, 1000), FONTS);
    const lines = ctx.lines();
    const titleY = lines.find((l) => l.text === 'ZENITH 22')!.y;
    const dateY = lines.find((l) => l.text === '8 OCTOBER 2026')!.y;
    const faces = (y: number, ch: string) => ctx.texts.filter((t) => t.y === y && t.text === ch).map((t) => t.font);
    expect(faces(titleY, '2')).toEqual([`400 88px ${FONTS.reading}`, `400 88px ${FONTS.reading}`]);
    expect(faces(titleY, 'Z')).toEqual([`500 88px ${FONTS.display}`]);
    expect(faces(dateY, '2')).toEqual([`500 26px ${FONTS.display}`, `500 26px ${FONTS.display}`]);
    expect(faces(dateY, '8')).toEqual([`500 26px ${FONTS.display}`]);
  });

  it('shrinks a title with a line wider than 960 px to 72 px at 0.16 em, then 2 px at a time down to 56 px, then breaks it between words', () => {
    const at = (title: string[]) => {
      const ctx = new Recorder();
      drawStoryCard(ctx, { ...LIVE_CARD, title }, photo(1000, 1000), FONTS);
      return ctx.lines().filter((l) => l.fill === '#f6f2ea' && l.size >= 56 && l.text !== 'CONFIRMED');
    };
    // 9 letters at 88 px: 9 × 61.6 + 8 × 17.6 = 695 px, kept.
    expect(at(['MONOLITHE', 'IN BLUE']).map((l) => l.size)).toEqual([88, 88]);
    // 16 letters: 16 × 61.6 + 15 × 17.6 = 1249.6 at 88; at 72 px (0.16 em): 16 × 50.4 + 15 × 11.52 = 979 → 70 px: 952.
    const long = at(['MONOLITHE,', 'THE OCTOBER DRAW']);
    expect(long.map((l) => l.size)).toEqual([70, 70]);
    const ctx = new Recorder();
    drawStoryCard(ctx, { ...LIVE_CARD, title: ['MONOLITHE,', 'THE OCTOBER DRAW'] }, photo(1000, 1000), FONTS);
    const step = ctx.texts.filter((t) => t.y === long[1]!.y);
    expect(step[1]!.x - step[0]!.x).toBeCloseTo(70 * 0.7 + 70 * 0.16);
    // 20 letters at 56 px: 20 × 39.2 + 19 × 8.96 = 954 → kept at 56. 24: too wide at 56, broken between its words.
    expect(at(['ABCDEFGHIJKLMNOPQRST']).map((l) => l.size)).toEqual([56]);
    const broken = at(['MONOLITHE ARCHITECTURALE', 'IN BLUE']);
    expect(broken.map((l) => l.text)).toEqual(['MONOLITHE', 'ARCHITECTURALE', 'IN BLUE']);
    expect(new Set(broken.map((l) => l.size))).toEqual(new Set([56]));
  });

  it('draws the monogram\'s five master outlines, 56 × 56, ivory at 0.9, centred, 26 px over THEORBES.COM', () => {
    const ctx = new Recorder();
    drawStoryCard(ctx, LIVE_CARD, photo(1000, 1000), FONTS);
    expect(ctx.paths.map((p) => p.d)).toEqual([...MONOGRAM_PATHS]);
    const scale = 56 / 500;
    const siteTop = 1810 - 22 * 1.2;
    for (const p of ctx.paths) {
      expect(p.fill).toBe('#f6f2ea');
      expect(p.alpha).toBe(0.9);
      expect(p.transform[0]).toBeCloseTo(scale);
      expect(p.transform[3]).toBeCloseTo(scale);
      expect(p.transform[4]).toBeCloseTo(540 - 28);
      expect(p.transform[5]).toBeCloseTo(siteTop - 26 - 56);
    }
    // Back in the plain frame, fully opaque, for THEORBES.COM.
    expect(ctx.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(ctx.texts.at(-1)!.alpha).toBe(1);
  });

  it('gives its alternative text the card\'s words joined by ". "', () => {
    expect(STORY.alt(...storyWords(LIVE_CARD))).toBe('ORBES. CONFIRMED. LIVE RELEASE. MONOLITHE IN BLUE. 8 OCTOBER 2026. THEORBES.COM');
  });
});

describe('SHARE TO STORIES: the cards of a page (BP-10)', () => {
  const m: StoryCardModel = { origin: 'live', photo: PHOTO, status: 'CONFIRMED', eyebrow: 'LIVE RELEASE', title: ['MONOLITHE', 'IN BLUE'], date: '8 OCTOBER 2026' };

  it('prepares a card once per entry: a screen built again reuses its PNG; new words draw it again', async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    const prepare = vi.fn(() => Promise.resolve(blob));
    const cards = new StoryCards(prepare);
    const first = cards.card('entry-1', m);
    expect(first.blob).toBeUndefined();
    await expect(first.ready).resolves.toBe(blob);
    expect(first.blob).toBe(blob);
    expect(cards.card('entry-1', { ...m })).toBe(first);
    expect(prepare).toHaveBeenCalledTimes(1);
    cards.card('entry-2', m);
    cards.card('entry-1', { ...m, title: ['MONOLITHE', 'IN GOLD'] });
    expect(prepare).toHaveBeenCalledTimes(3);
  });

  it('remembers a card that could not be drawn (null): no button', async () => {
    const cards = new StoryCards(() => Promise.reject(new Error('no canvas')));
    const c = cards.card('e', m);
    await expect(c.ready).resolves.toBeNull();
    expect(c.blob).toBeNull();
  });
});

describe('SHARE TO STORIES: the tap (BP-10)', () => {
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

  it('hands the share sheet the file alone, ORBES-STORY.png titled ORBES, within the tap', async () => {
    const shared: ShareData[] = [];
    const nav: ShareNavigator = {
      canShare: (d) => Array.isArray(d?.files) && d.files.length === 1,
      share: (d) => {
        shared.push(d);
        return Promise.resolve();
      },
    };
    const save = vi.fn();
    expect(canShareStory(blob, nav)).toBe(true);
    const result = shareStoryCard(blob, nav, save);
    expect(shared).toHaveLength(1);
    await expect(result).resolves.toBe('shared');
    expect(save).not.toHaveBeenCalled();
    expect(Object.keys(shared[0]!).sort()).toEqual(['files', 'title']);
    expect(shared[0]!.title).toBe('ORBES');
    const file = shared[0]!.files![0]!;
    expect([file.name, file.type]).toEqual(['ORBES-STORY.png', 'image/png']);
    expect(STORY).toMatchObject({ filename: 'ORBES-STORY.png', shareTitle: 'ORBES' });
  });

  it('saves the file where the browser cannot share it: canShare missing, false or throwing, or no share', async () => {
    for (const nav of [{}, { share: () => Promise.resolve() }, { canShare: () => false, share: () => Promise.resolve() }, { canShare: () => { throw new Error('x'); }, share: () => Promise.resolve() }] as ShareNavigator[]) {
      const save = vi.fn();
      expect(canShareStory(blob, nav)).toBe(false);
      await expect(shareStoryCard(blob, nav, save)).resolves.toBe('saved');
      expect(save).toHaveBeenCalledWith({ blob, filename: 'ORBES-STORY.png' });
    }
  });

  it('leaves a share sheet the collector closes (AbortError) at that; a share refused saves the file', async () => {
    const abort = vi.fn();
    await expect(shareStoryCard(blob, { canShare: () => true, share: () => Promise.reject(Object.assign(new Error('closed'), { name: 'AbortError' })) }, abort)).resolves.toBe('cancelled');
    expect(abort).not.toHaveBeenCalled();
    const save = vi.fn();
    await expect(shareStoryCard(blob, { canShare: () => true, share: () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })) }, save)).resolves.toBe('saved');
    expect(save).toHaveBeenCalledTimes(1);
  });
});
