/**
 * Calibration of the E2E camera: what does a page actually see when Chromium
 * plays a Y4M file through its fake capture device?
 *
 * A gray ramp is written in both luma ranges (test/support/y4m.ts), played
 * through getUserMedia → <video> → canvas exactly like the scanner reads
 * frames, and the pixels are compared with the source levels. This fixes
 * which range the camera E2E clips must use so the decoder sees the
 * simulated capture as intended (and not a washed-out or clipped variant).
 */
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeY4m } from '../support/y4m.js';
import { CHROMIUM_PATH, launchCamera, recordMetrics } from './support.js';

const HAS_CHROMIUM = existsSync(CHROMIUM_PATH);
const W = 640;
const H = 360;
const LEVELS = [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 235, 245, 255];

/** BT.601 video-range expansion a player applies to Y (16..235 → 0..255). */
const expand = (y: number) => Math.min(255, Math.max(0, Math.round(((y - 16) * 255) / 219)));

function ramp(): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(W * H);
  const band = W / LEVELS.length;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = LEVELS[Math.min(LEVELS.length - 1, Math.floor(x / band))];
  return { width: W, height: H, data };
}

interface Probe {
  width: number;
  height: number;
  frameRate: number | undefined;
  /** Mean R, G, B over a 9×9 patch at the centre of each band. */
  bands: [number, number, number][];
}

async function probe(browser: Browser, origin: string): Promise<Probe> {
  const page = await browser.newPage();
  try {
    await page.goto(origin);
    return await page.evaluate(
      async ({ n, W }) => {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await video.play();
        // Two presented frames, so the decoder pipeline has settled.
        for (let i = 0; i < 2; i++) await new Promise<void>((r) => video.requestVideoFrameCallback(() => r()));
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(video, 0, 0);
        const sx = canvas.width / W;
        const bands: [number, number, number][] = [];
        for (let i = 0; i < n; i++) {
          const cx = Math.floor(((i + 0.5) * W * sx) / n);
          const d = ctx.getImageData(cx - 4, Math.floor(canvas.height / 2) - 4, 9, 9).data;
          const sum = [0, 0, 0];
          for (let p = 0; p < d.length; p += 4) for (let c = 0; c < 3; c++) sum[c] += d[p + c];
          bands.push(sum.map((s) => Math.round((s / (d.length / 4)) * 10) / 10) as [number, number, number]);
        }
        const settings = stream.getVideoTracks()[0].getSettings();
        stream.getTracks().forEach((t) => t.stop());
        return { width: video.videoWidth, height: video.videoHeight, frameRate: settings.frameRate, bands };
      },
      { n: LEVELS.length, W },
    );
  } finally {
    await page.close();
  }
}

describe.skipIf(!HAS_CHROMIUM)('fake camera calibration (Chromium, Y4M → getUserMedia → canvas)', () => {
  let server: Server;
  let origin: string;
  let dir: string;
  const results: Record<string, unknown> = {};

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'orbes-e2e-cal-'));
    // 127.0.0.1 is a secure context: getUserMedia is available on plain http.
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><title>calibration</title><body></body>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server?.close(() => r()));
    if (dir) rmSync(dir, { recursive: true, force: true });
    recordMetrics('fake-camera', 'calibration', { levels: LEVELS, ...results });
  });

  it("'limited' range: the page sees the source gray levels (±2), neutral, at the file's size and rate", async () => {
    const clip = join(dir, 'ramp-limited.y4m');
    writeY4m(clip, [ramp()], 12, { range: 'limited' });
    const browser = await launchCamera(clip);
    try {
      const p = await probe(browser, origin);
      results.limited = p;
      expect({ w: p.width, h: p.height }).toEqual({ w: W, h: H });
      expect(p.frameRate).toBe(12);
      const errors = p.bands.map(([r, g, b], i) => {
        // Neutral chroma stays neutral: no colour cast in the conversion.
        expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1);
        return Math.abs(g - LEVELS[i]);
      });
      results.limitedMaxAbsError = Math.max(...errors);
      expect(Math.max(...errors)).toBeLessThanOrEqual(2);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("'full' range: Chromium still treats Y as video range, so contrast is stretched and both ends clip", async () => {
    const clip = join(dir, 'ramp-full.y4m');
    writeY4m(clip, [ramp()], 12, { range: 'full' });
    const browser = await launchCamera(clip);
    try {
      const p = await probe(browser, origin);
      results.full = p;
      const errors = p.bands.map(([, g], i) => Math.abs(g - expand(LEVELS[i])));
      results.fullMaxAbsErrorVsExpansion = Math.max(...errors);
      expect(Math.max(...errors)).toBeLessThanOrEqual(3);
      // Everything at or below 16 is black, everything at or above 235 is white.
      expect(p.bands[LEVELS.indexOf(16)][1]).toBeLessThanOrEqual(2);
      expect(p.bands[LEVELS.indexOf(235)][1]).toBeGreaterThanOrEqual(253);
      // Mid-gray is preserved; the slope is 255/219 ≈ 1.16.
      expect(Math.abs(p.bands[LEVELS.indexOf(128)][1] - 130)).toBeLessThanOrEqual(3);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
