/**
 * YUV4MPEG2 writer for Chromium's fake camera (E2E tests):
 *
 *   chromium --use-fake-device-for-media-stream \
 *            --use-file-for-fake-video-capture=/path/frames.y4m
 *
 * Chromium reads planar 4:2:0 frames (C420) and loops the file. Gray frames
 * are written as Y = luma with neutral chroma (U = V = 128).
 */
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GrayImage } from './raster.js';

export interface Y4mOptions {
  /**
   * 'limited' (default) maps luma 0..255 to the video range 16..235: Chromium
   * treats camera frames as BT.601 limited range and expands them back when
   * converting to RGB, so a page reading the stream sees the original gray
   * levels. 'full' writes luma unchanged (contrast is then stretched and
   * clipped on playback).
   */
  range?: 'limited' | 'full';
}

export function writeY4m(path: string, frames: readonly GrayImage[], fps: number, opts: Y4mOptions = {}): void {
  if (frames.length === 0) throw new RangeError('writeY4m: no frames');
  if (!(fps > 0 && Number.isFinite(fps))) throw new RangeError(`writeY4m: invalid fps ${fps}`);
  const { width, height } = frames[0];
  for (const f of frames) {
    if (f.width !== width || f.height !== height || f.data.length !== width * height) {
      throw new RangeError(`writeY4m: every frame must be ${width}×${height}`);
    }
  }
  const lut = Uint8Array.from({ length: 256 }, (_, v) => (opts.range === 'full' ? v : 16 + Math.round((v * 219) / 255)));
  // 4:2:0 chroma planes cover odd edges with a partial sample (ceil).
  const chroma = new Uint8Array(Math.ceil(width / 2) * Math.ceil(height / 2)).fill(128);
  const luma = new Uint8Array(width * height);
  const encoder = new TextEncoder();

  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, encoder.encode(`YUV4MPEG2 W${width} H${height} F${frameRate(fps)} Ip A1:1 C420\n`));
    const frameHeader = encoder.encode('FRAME\n');
    for (const f of frames) {
      for (let i = 0; i < luma.length; i++) luma[i] = lut[f.data[i]];
      writeSync(fd, frameHeader);
      writeSync(fd, luma);
      writeSync(fd, chroma); // U
      writeSync(fd, chroma); // V
    }
  } finally {
    closeSync(fd);
  }
}

/** Exact `N:1` for integer rates, otherwise millihertz precision (e.g. 29.97 → 29970:1000). */
function frameRate(fps: number): string {
  return Number.isInteger(fps) ? `${fps}:1` : `${Math.round(fps * 1000)}:1000`;
}
