import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createGray, type GrayImage } from './raster.js';
import { writeY4m } from './y4m.js';

const dir = mkdtempSync(join(tmpdir(), 'orbes-y4m-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function ramp(width: number, height: number, offset: number): GrayImage {
  const img = createGray(width, height);
  img.data.forEach((_, i) => (img.data[i] = (i + offset) & 255));
  return img;
}

/** Splits a C420 YUV4MPEG2 file into its header line and per-frame planes. */
function parseY4m(bytes: Uint8Array) {
  const text = new TextDecoder('latin1');
  const headerEnd = bytes.indexOf(0x0a);
  const header = text.decode(bytes.subarray(0, headerEnd));
  const w = Number(/ W(\d+)/.exec(header)?.[1]);
  const h = Number(/ H(\d+)/.exec(header)?.[1]);
  const chroma = Math.ceil(w / 2) * Math.ceil(h / 2);
  const frames: { y: Uint8Array; u: Uint8Array; v: Uint8Array }[] = [];
  let pos = headerEnd + 1;
  while (pos < bytes.length) {
    expect(text.decode(bytes.subarray(pos, pos + 6))).toBe('FRAME\n');
    pos += 6;
    const y = bytes.subarray(pos, (pos += w * h));
    const u = bytes.subarray(pos, (pos += chroma));
    const v = bytes.subarray(pos, (pos += chroma));
    frames.push({ y, u, v });
  }
  expect(pos).toBe(bytes.length);
  return { header, frames };
}

describe('writeY4m', () => {
  it('writes a C420 stream with neutral chroma and limited-range luma by default', () => {
    const path = join(dir, 'clip.y4m');
    const frames = [ramp(16, 8, 0), ramp(16, 8, 100), ramp(16, 8, 200)];
    writeY4m(path, frames, 30);
    const { header, frames: parsed } = parseY4m(readFileSync(path));
    expect(header).toBe('YUV4MPEG2 W16 H8 F30:1 Ip A1:1 C420');
    expect(parsed).toHaveLength(3);
    parsed.forEach((f, k) => {
      f.y.forEach((y, i) => expect(y).toBe(16 + Math.round((frames[k].data[i] * 219) / 255)));
      expect(f.u.every((c) => c === 128) && f.v.every((c) => c === 128)).toBe(true);
    });
  });

  it('keeps luma unchanged in full range and sizes odd-dimension chroma planes up', () => {
    const path = join(dir, 'odd.y4m');
    const frame = ramp(5, 3, 7);
    writeY4m(path, [frame], 29.97, { range: 'full' });
    const { header, frames } = parseY4m(readFileSync(path));
    expect(header).toBe('YUV4MPEG2 W5 H3 F29970:1000 Ip A1:1 C420');
    expect([...frames[0].y]).toEqual([...frame.data]);
    expect(frames[0].u).toHaveLength(6); // 3 × 2
  });

  it('rejects empty, mismatched or invalid input', () => {
    const path = join(dir, 'bad.y4m');
    expect(() => writeY4m(path, [], 30)).toThrow(RangeError);
    expect(() => writeY4m(path, [createGray(4, 4), createGray(4, 2)], 30)).toThrow(RangeError);
    expect(() => writeY4m(path, [createGray(4, 4)], 0)).toThrow(RangeError);
  });
});
