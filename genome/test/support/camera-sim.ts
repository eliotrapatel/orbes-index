/**
 * Deterministic phone-camera simulator (Node test infrastructure).
 *
 * `simulateCapture(source, params, seed)` photographs a rendered artifact
 * (e.g. an ORBES CODE rasterised with `svgToGray`) the way a phone camera
 * would, so that decoder tests, the scan test matrix and the E2E fake camera
 * can measure robustness reproducibly. Same inputs + same seed → same bytes.
 *
 * Model, in the order light travels:
 *
 *   1. Scene    The source is a flat sheet in front of a pinhole camera
 *               (focal length `focalLengthPx`), optionally bent around a
 *               cylinder (`curvature`), rotated in plane, tilted out of plane
 *               and offset. Every output pixel is inverse-mapped (ray cast)
 *               onto the surface and the source is sampled bilinearly from a
 *               mip level matched to the magnification, so small codes are
 *               area-averaged rather than aliased.
 *   2. Surface  Source luma is remapped to reflectance between `inkLevel`
 *               and `paperLevel` (contrast and polarity). Opaque occluders
 *               are painted on, a substrate texture (paper, leather, brushed
 *               metal) modulates the result, curved surfaces darken towards
 *               their silhouette and specular glare is added. All of these
 *               live in surface coordinates, so they follow the code. Beyond
 *               the sheet (`sheetMargin`) lies the background.
 *   3. Light    Illumination gradient and vignetting in frame coordinates.
 *   4. Optics   Radial lens distortion (`barrelK1`), defocus (Gaussian) and
 *               motion blur (line kernel).
 *   5. Sensor   Gaussian read noise + signal-dependent shot noise, clipping
 *               to 0..255 (glare saturates here), quantisation.
 *   6. Codec    JPEG round trip, then the scanner's own downscale (area
 *               average) by `downscale`.
 *
 * Conventions: frame and source coordinates are continuous pixels, y down,
 * with pixel (i, j) covering [i, i+1) × [j, j+1); every direction angle is in
 * degrees clockwise from north (screen up), like src/core/geometry.ts.
 * Reflectances, levels and glare intensities are fractions of full scale
 * (1 = 255). All lengths are frame pixels unless stated otherwise.
 */
import type { Point } from '../../src/core/geometry.js';
import { encodeJpeg, encodeJpegFast } from './image-io.js';
import { inverseNormalCdf, Prng } from './prng.js';
import { createGray, type GrayImage } from './raster.js';

// ── Parameters ─────────────────────────────────────────────────────────────

export type Substrate = 'none' | 'paper' | 'textured-paper' | 'leather' | 'brushed-metal';

/** Seeded desk clutter: smooth shading plus out-of-focus objects (discs, rings, boxes, bars). */
export interface ClutterBackground {
  kind: 'clutter';
  /** Mean reflectance (default 0.35). */
  level?: number;
  /** Spread of reflectances around `level` (default 0.6). */
  contrast?: number;
}

/** Specular highlight: elliptical, Gaussian fall-off, added to the surface radiance. */
export interface GlareSpot {
  /** Centre in source-normalised coordinates (0..1 across the source width / height). */
  x: number;
  y: number;
  /** Semi-major axis as a fraction of the source width. */
  radius: number;
  /** Minor / major axis ratio (default 0.6). */
  aspect?: number;
  /** Direction of the major axis on the source (default 0). */
  angleDeg?: number;
  /** Added radiance at the centre; ≥ 1 saturates the core whatever lies beneath (default 1.2). */
  intensity?: number;
}

/** Opaque shape on the surface: dirt, a sticker, a scratch, a fingertip. */
export interface Occluder {
  /** 'blob' = ellipse, 'strip' = thin rectangle. */
  kind: 'blob' | 'strip';
  /** Centre in source-normalised coordinates. */
  x: number;
  y: number;
  /** Area as a fraction of the source (code) area. */
  area: number;
  /** Minor / major axis ratio (default 0.7 for blobs, 0.12 for strips). */
  aspect?: number;
  /** Direction of the major axis on the source (default 0). */
  angleDeg?: number;
  /** Reflectance (default 0.08, dark). Light occluders model abraded ink. */
  level?: number;
}

/**
 * `count` occluders with seeded kinds, positions and orientations: 60 % are
 * ink-like (dirt, marker), 40 % paper-like (abraded ink), relative to
 * `inkLevel` / `paperLevel`.
 */
export interface RandomOcclusion {
  count: number;
  /** Area of each occluder as a fraction of the source area. */
  area: number;
  kinds?: readonly Occluder['kind'][];
}

export interface CaptureParams {
  /** Sensor frame (default 1280×720). */
  frame?: { width: number; height: number };
  /** Apparent width of the whole source when seen face-on (default 60 % of the frame's short side). */
  codeWidthPx?: number;
  /** Offset of the source centre from the frame centre (default 0, 0). */
  offset?: { x: number; y: number };
  /** In-plane rotation, clockwise on screen (default 0). */
  rotationDeg?: number;
  /** Out-of-plane tilt about the frame's horizontal axis; positive = top edge further away (default 0). */
  tiltXDeg?: number;
  /** Out-of-plane tilt about the frame's vertical axis; positive = right edge further away (default 0). */
  tiltYDeg?: number;
  /**
   * Pinhole focal length (default: 65° horizontal field of view, a phone
   * main camera). The code sits at distance `focalLengthPx`, so a shorter
   * focal length means a closer camera and stronger perspective.
   */
  focalLengthPx?: number;
  /**
   * Radial distortion, inverse Brown form on focal-normalised coordinates:
   * a frame point at radius r images the scene at r·(1 + k1·r²). Positive =
   * barrel (phone lenses: 0.01–0.05). Default 0.
   */
  barrelK1?: number;
  /**
   * Cylindrical bend: angle (radians) the source width subtends on a
   * cylinder whose axis is the source's vertical axis; the centre is closest
   * to the camera. 0 = flat; 0.3–0.5 ≈ a bag panel; ≈1.1 = a 10 mm code on
   * an 18 mm ring. Default 0.
   */
  curvature?: number;
  /**
   * How far the printed sheet extends beyond the source on each side, as a
   * fraction of the source width (one number, or per axis). Infinity
   * (default) = the substrate fills the view.
   */
  sheetMargin?: number | { x: number; y: number };
  /** Seen beyond the sheet or past the surface's silhouette: flat reflectance or clutter (default 0.25). */
  background?: number | ClutterBackground;
  /** Surface texture, attached to the surface (default 'none'). */
  substrate?: Substrate;
  /** Scales the substrate texture amplitude (default 1). */
  substrateStrength?: number;
  /** Reflectance of source white (default 1). Swap with `inkLevel` to invert polarity. */
  paperLevel?: number;
  /** Reflectance of source black (default 0). */
  inkLevel?: number;
  /** Linear illumination gradient: ±`strength` at the frame half-diagonal, brighter towards `angleDeg`. */
  illumination?: { angleDeg: number; strength: number };
  /** Brightness loss at the frame corners, quadratic in radius (0..1, default 0). */
  vignette?: number;
  glare?: GlareSpot | readonly GlareSpot[];
  occlusion?: readonly Occluder[] | RandomOcclusion;
  /** Defocus: Gaussian sigma (default 0). */
  blurSigma?: number;
  /** Camera shake: box blur of `lengthPx` along `angleDeg`. */
  motionBlur?: { lengthPx: number; angleDeg: number };
  /** Sensor noise on the 0..255 scale: variance = sigma² + shot · signal. */
  noise?: { sigma: number; shot?: number };
  /** JPEG round trip at this quality (1..100); omitted = no compression. */
  jpegQuality?: number;
  /**
   * 'fast' (default): luma-only DCT quantisation, equivalent to a baseline
   * JPEG of a gray image to within ±1 level on ~10 % of pixels and ~8× faster;
   * 'jpeg-js': the real codec round trip (image-io `encodeJpeg`).
   */
  jpegCodec?: 'fast' | 'jpeg-js';
  /** Final area-average downscale (≥ 1, default 1); the output is round(frame / downscale). */
  downscale?: number;
}

// ── Geometry ───────────────────────────────────────────────────────────────

/** Rigid placement of the source in front of the camera. World unit = 1 frame px at the code distance. */
interface Rig {
  frameW: number;
  frameH: number;
  outW: number;
  outH: number;
  srcW: number;
  srcH: number;
  /** World units per source pixel. */
  scale: number;
  f: number;
  cx: number;
  cy: number;
  /** Object → camera rotation, row-major 3×3. */
  r: number[];
  t: [number, number, number];
  /** Cylinder radius in world units (0 = flat). */
  rc: number;
  k1: number;
}

const DEFAULT_FRAME = { width: 1280, height: 720 } as const;
const DEFAULT_HFOV_DEG = 65;

function check(ok: boolean, message: string): void {
  if (!ok) throw new RangeError(`camera-sim: ${message}`);
}

const finite = (v: number): boolean => Number.isFinite(v);
const rad = (d: number): number => (d * Math.PI) / 180;

function buildRig(source: { width: number; height: number }, p: CaptureParams): Rig {
  const frameW = p.frame?.width ?? DEFAULT_FRAME.width;
  const frameH = p.frame?.height ?? DEFAULT_FRAME.height;
  check(Number.isInteger(frameW) && Number.isInteger(frameH) && frameW > 0 && frameH > 0, 'frame must be positive integers');
  check(Number.isInteger(source.width) && Number.isInteger(source.height) && source.width > 0 && source.height > 0, 'empty source');
  const codeWidthPx = p.codeWidthPx ?? 0.6 * Math.min(frameW, frameH);
  const f = p.focalLengthPx ?? frameW / 2 / Math.tan(rad(DEFAULT_HFOV_DEG / 2));
  const downscale = p.downscale ?? 1;
  const tiltX = p.tiltXDeg ?? 0;
  const tiltY = p.tiltYDeg ?? 0;
  const curvature = p.curvature ?? 0;
  check(codeWidthPx > 0 && finite(codeWidthPx), 'codeWidthPx must be > 0');
  check(f > 0 && finite(f), 'focalLengthPx must be > 0');
  check(downscale >= 1 && finite(downscale), 'downscale must be ≥ 1');
  check(Math.abs(tiltX) < 85 && Math.abs(tiltY) < 85, 'tilts must be within ±85°');
  check(curvature >= 0 && curvature < 2 * Math.PI, 'curvature must be in [0, 2π)');
  check(finite(p.rotationDeg ?? 0) && finite(p.barrelK1 ?? 0), 'rotation and barrelK1 must be finite');
  check(finite(p.offset?.x ?? 0) && finite(p.offset?.y ?? 0), 'offset must be finite');

  const scale = codeWidthPx / source.width;
  // R = Ry(tiltY) · Rx(tiltX) · Rz(rotation): spin in the source plane first, then tilt about camera axes.
  const rz = rad(p.rotationDeg ?? 0);
  const ax = rad(tiltX);
  const ay = rad(tiltY);
  const Rz = [Math.cos(rz), -Math.sin(rz), 0, Math.sin(rz), Math.cos(rz), 0, 0, 0, 1];
  const Rx = [1, 0, 0, 0, Math.cos(ax), Math.sin(ax), 0, -Math.sin(ax), Math.cos(ax)];
  const Ry = [Math.cos(ay), 0, -Math.sin(ay), 0, 1, 0, Math.sin(ay), 0, Math.cos(ay)];
  return {
    frameW,
    frameH,
    outW: Math.max(1, Math.round(frameW / downscale)),
    outH: Math.max(1, Math.round(frameH / downscale)),
    srcW: source.width,
    srcH: source.height,
    scale,
    f,
    cx: frameW / 2,
    cy: frameH / 2,
    r: mul3(Ry, mul3(Rx, Rz)),
    t: [p.offset?.x ?? 0, p.offset?.y ?? 0, f],
    rc: curvature > 0 ? (source.width * scale) / curvature : 0,
    k1: p.barrelK1 ?? 0,
  };
}

function mul3(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return out;
}

/** Forward model: source point (px) → frame point (px), or null when hidden or behind the camera. */
function projectToFrame(rig: Rig, u: number, v: number): Point | null {
  const { r, t, rc } = rig;
  const x0 = (u - rig.srcW / 2) * rig.scale;
  const y = (v - rig.srcH / 2) * rig.scale;
  // Surface point and outward normal (towards the camera) in object coordinates.
  let x = x0;
  let z = 0;
  let nx = 0;
  let nz = -1;
  if (rc > 0) {
    const phi = x0 / rc;
    x = rc * Math.sin(phi);
    z = rc * (1 - Math.cos(phi));
    nx = Math.sin(phi);
    nz = -Math.cos(phi);
  }
  const px = r[0] * x + r[1] * y + r[2] * z + t[0];
  const py = r[3] * x + r[4] * y + r[5] * z + t[1];
  const pz = r[6] * x + r[7] * y + r[8] * z + t[2];
  if (pz <= 0) return null;
  const facing = (r[0] * nx + r[2] * nz) * px + (r[3] * nx + r[5] * nz) * py + (r[6] * nx + r[8] * nz) * pz;
  if (facing >= 0) return null;
  let xn = px / pz;
  let yn = py / pz;
  if (rig.k1 !== 0) {
    // Invert ru = rd·(1 + k1·rd²) by Newton's method (converges in a few steps for |k1·r²| ≪ 1).
    const ru = Math.hypot(xn, yn);
    let rd = ru;
    for (let i = 0; i < 8; i++) rd -= (rd + rig.k1 * rd * rd * rd - ru) / (1 + 3 * rig.k1 * rd * rd);
    if (ru > 0) {
      xn *= rd / ru;
      yn *= rd / ru;
    }
  }
  return { x: rig.cx + rig.f * xn, y: rig.cy + rig.f * yn };
}

/** Frame px per source px around a source point (√|det J|, by finite differences). */
function localScale(rig: Rig, u: number, v: number): number {
  const p = projectToFrame(rig, u, v);
  const pu = projectToFrame(rig, u + 1, v);
  const pv = projectToFrame(rig, u, v + 1);
  if (!p || !pu || !pv) return rig.scale;
  return Math.sqrt(Math.abs((pu.x - p.x) * (pv.y - p.y) - (pu.y - p.y) * (pv.x - p.x)));
}

export interface CaptureGeometry {
  /** Output image size (after `downscale`). */
  width: number;
  height: number;
  /**
   * Source px → output px homography, row-major 3×3 normalised to h[8] = 1.
   * Exact when `barrelK1` and `curvature` are 0; use `project` otherwise.
   */
  homography: number[];
  /** Output position of the source centre (the code centre for a centred artifact). */
  center: Point;
  /** Output positions of the source corners: top-left, top-right, bottom-right, bottom-left (null if hidden). */
  corners: [Point | null, Point | null, Point | null, Point | null];
  /** Output px per source px at the source centre (geometric mean of the two axes). */
  scaleAtCenter: number;
  /** Full forward model (curvature and lens distortion included): source px → output px, null if hidden. */
  project(u: number, v: number): Point | null;
}

/** Where the source lands in the output image, for assertions on decoder geometry. */
export function captureGeometry(source: { width: number; height: number }, params: CaptureParams = {}): CaptureGeometry {
  const rig = buildRig(source, params);
  const sx = rig.outW / rig.frameW;
  const sy = rig.outH / rig.frameH;
  const project = (u: number, v: number): Point | null => {
    const p = projectToFrame(rig, u, v);
    return p && { x: p.x * sx, y: p.y * sy };
  };
  const center = project(rig.srcW / 2, rig.srcH / 2);
  check(center !== null, 'source centre is not visible');
  return {
    width: rig.outW,
    height: rig.outH,
    homography: homographyOf(rig),
    center: center as Point,
    corners: [project(0, 0), project(rig.srcW, 0), project(rig.srcW, rig.srcH), project(0, rig.srcH)],
    scaleAtCenter: localScale(rig, rig.srcW / 2, rig.srcH / 2) * Math.sqrt(sx * sy),
    project,
  };
}

/** Planar perspective part of the model: source px → output px (row-major 3×3, h[8] = 1). */
export function perspectiveHomography(source: { width: number; height: number }, params: CaptureParams = {}): number[] {
  return homographyOf(buildRig(source, params));
}

function homographyOf(rig: Rig): number[] {
  const { r, t, f, scale: s } = rig;
  // H = S_out · K · [r1 r2 t] · A, with A: source px → object plane coordinates.
  const K = [f * (rig.outW / rig.frameW), 0, rig.cx * (rig.outW / rig.frameW), 0, f * (rig.outH / rig.frameH), rig.cy * (rig.outH / rig.frameH), 0, 0, 1];
  const M = [r[0], r[1], t[0], r[3], r[4], t[1], r[6], r[7], t[2]];
  const A = [s, 0, (-s * rig.srcW) / 2, 0, s, (-s * rig.srcH) / 2, 0, 0, 1];
  const h = mul3(K, mul3(M, A));
  return h.map((x) => x / h[8]);
}

// ── Procedural textures ────────────────────────────────────────────────────

/** Periodic value noise in [-1, 1] on a cellsX × cellsY lattice, smoothstep-interpolated. */
function valueNoise(w: number, h: number, cellsX: number, cellsY: number, rng: Prng): Float32Array {
  const lattice = new Float32Array(cellsX * cellsY);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.float() * 2 - 1;
  const axis = (n: number, cells: number) => {
    const i0 = new Int32Array(n);
    const i1 = new Int32Array(n);
    const wt = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const g = ((k + 0.5) * cells) / n;
      const i = Math.floor(g);
      const fr = g - i;
      i0[k] = i % cells;
      i1[k] = (i + 1) % cells;
      wt[k] = fr * fr * (3 - 2 * fr);
    }
    return { i0, i1, wt };
  };
  const ax = axis(w, cellsX);
  const ay = axis(h, cellsY);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const r0 = ay.i0[y] * cellsX;
    const r1 = ay.i1[y] * cellsX;
    const wy = ay.wt[y];
    for (let x = 0; x < w; x++) {
      const a = lattice[r0 + ax.i0[x]];
      const b = lattice[r0 + ax.i1[x]];
      const c = lattice[r1 + ax.i0[x]];
      const d = lattice[r1 + ax.i1[x]];
      const wx = ax.wt[x];
      out[y * w + x] = a + (b - a) * wx + (c - a + (a - b - c + d) * wx) * wy;
    }
  }
  return out;
}

/**
 * Substrate texture: relative reflectance modulation on a size×size tile that
 * spans one source width (tiled beyond). Feature sizes are fractions of the
 * code width, i.e. of a physical ~25 mm artifact: paper fibres, laid ribs,
 * leather pebble grain and creases, brushing streaks along the source x axis.
 *
 * A material is the same everywhere, so each (kind, size) tile is generated
 * once per process from a fixed seed; captures differ by which patch of it
 * lies under the code (a seeded tile offset).
 */
const materialCache = new Map<string, Float32Array>();

function materialTexture(kind: Exclude<Substrate, 'none'>, size: number): Float32Array {
  const key = `${kind}:${size}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const rng = new Prng(`substrate:${kind}`);
  const tex = new Float32Array(size * size);
  const add = (field: Float32Array, amp: number): void => {
    for (let i = 0; i < tex.length; i++) tex[i] += amp * field[i];
  };
  const noise = (cx: number, cy = cx): Float32Array => valueNoise(size, size, Math.min(cx, size), Math.min(cy, size), rng);
  const grain = (amp: number): void => {
    for (let i = 0; i < tex.length; i++) tex[i] += amp * (rng.float() * 2 - 1);
  };
  switch (kind) {
    case 'paper':
      add(noise(6), 0.015);
      add(noise(48), 0.02);
      grain(0.025);
      break;
    case 'textured-paper': {
      add(noise(8), 0.03);
      add(noise(36), 0.05);
      add(noise(110), 0.04);
      grain(0.03);
      // Laid lines: the fine parallel ribs of laid paper, ~64 per code width.
      for (let y = 0; y < size; y++) {
        const rib = 0.02 * Math.sin((2 * Math.PI * 64 * y) / size);
        for (let x = 0; x < size; x++) tex[y * size + x] += rib;
      }
      break;
    }
    case 'leather': {
      add(noise(4), 0.07); // tanning mottle
      // The zero crossings of band-limited noise form a cellular network: narrow
      // dark creases between domed pebbles, as on pebble-grain leather.
      const a = noise(26);
      const b = noise(52);
      for (let i = 0; i < tex.length; i++) {
        const n = Math.abs(0.65 * a[i] + 0.35 * b[i]);
        tex[i] += 0.06 * (n - 0.3) - 0.2 * (1 - n) ** 8;
      }
      add(noise(110), 0.03);
      grain(0.025);
      break;
    }
    case 'brushed-metal':
      add(noise(2, 384), 0.09); // long, hair-thin streaks
      add(noise(8, 192), 0.06);
      add(noise(3), 0.05);
      grain(0.02);
      break;
  }
  materialCache.set(key, tex);
  return tex;
}

/** Background clutter is generated at 1/CLUTTER_SUBSAMPLE resolution: it is out of focus anyway. */
const CLUTTER_SUBSAMPLE = 4;

/** Desk clutter: smooth shading and seeded objects (discs, rings, boxes, bars) with soft edges. */
function clutterField(w: number, h: number, spec: ClutterBackground, rng: Prng): Float32Array {
  const level = spec.level ?? 0.35;
  const contrast = spec.contrast ?? 0.6;
  const field = new Float32Array(w * h).fill(level);
  const low = valueNoise(w, h, 3, 2, rng);
  const mid = valueNoise(w, h, 12, 7, rng);
  for (let i = 0; i < field.length; i++) field[i] += contrast * (0.35 * low[i] + 0.12 * mid[i]);
  const shapes = 10 + rng.int(0, 8);
  const span = Math.min(w, h);
  for (let n = 0; n < shapes; n++) {
    const kind = rng.pick(['disc', 'ring', 'box', 'bar'] as const);
    const cx = rng.range(0, w);
    const cy = rng.range(0, h);
    const size = rng.range(0.05, 0.35) * span;
    const theta = rng.range(0, Math.PI);
    const tone = Math.min(0.98, Math.max(0.02, level + contrast * rng.range(-1, 1)));
    const halfLen = kind === 'bar' ? size : size / 2;
    const halfWid = kind === 'bar' ? Math.max(0.75, size * rng.range(0.03, 0.12)) : (size / 2) * rng.range(0.4, 1);
    const ringWidth = Math.max(1.5, size * rng.range(0.04, 0.15));
    const reach = Math.ceil(halfLen + ringWidth + 2);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    for (let y = Math.max(0, Math.floor(cy - reach)); y < Math.min(h, Math.ceil(cy + reach)); y++) {
      for (let x = Math.max(0, Math.floor(cx - reach)); x < Math.min(w, Math.ceil(cx + reach)); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        let dist: number;
        if (kind === 'disc') dist = Math.sqrt(dx * dx + dy * dy) - size / 2;
        else if (kind === 'ring') dist = Math.abs(Math.sqrt(dx * dx + dy * dy) - size / 2) - ringWidth / 2;
        else dist = Math.max(Math.abs(dx * cos + dy * sin) - halfLen, Math.abs(-dx * sin + dy * cos) - halfWid);
        const cover = Math.min(1, Math.max(0, 0.5 - dist));
        if (cover > 0) field[y * w + x] += (tone - field[y * w + x]) * cover;
      }
    }
  }
  return field;
}

// ── Surface shapes (occluders, glare) ──────────────────────────────────────

/** An oriented ellipse or rectangle in source px, with a bounding radius for cheap rejection. */
interface SurfaceShape {
  cx: number;
  cy: number;
  /** Unit vector of the major axis. */
  ux: number;
  uy: number;
  /** Semi-axes (source px). */
  a: number;
  b: number;
  reach: number;
  kind: 'blob' | 'strip' | 'glare';
  /** Occluder reflectance or glare intensity. */
  value: number;
}

function orientedShape(
  kind: SurfaceShape['kind'],
  x: number,
  y: number,
  a: number,
  b: number,
  angleDeg: number,
  value: number,
  rig: Rig,
  reachFactor: number,
): SurfaceShape {
  const th = rad(angleDeg);
  return { cx: x * rig.srcW, cy: y * rig.srcH, ux: Math.sin(th), uy: -Math.cos(th), a, b, reach: a * reachFactor + 1, kind, value };
}

function resolveOccluders(
  spec: CaptureParams['occlusion'],
  rig: Rig,
  rng: Prng,
  levels: { paper: number; ink: number },
): SurfaceShape[] {
  if (!spec) return [];
  let list: readonly Occluder[];
  if ('count' in spec) {
    check(Number.isInteger(spec.count) && spec.count >= 0, 'occlusion.count must be a non-negative integer');
    const kinds = spec.kinds ?? (['blob', 'strip'] as const);
    list = Array.from({ length: spec.count }, (): Occluder => {
      const kind = rng.pick(kinds);
      return {
        kind,
        x: rng.range(0.15, 0.85),
        y: rng.range(0.15, 0.85),
        area: spec.area,
        aspect: kind === 'blob' ? rng.range(0.45, 1) : rng.range(0.06, 0.2),
        angleDeg: rng.range(0, 180),
        // Ink-like (dirt, marker) or paper-like (abraded ink), relative to the material's own levels.
        level: rng.chance(0.6)
          ? levels.ink + (levels.paper - levels.ink) * rng.range(0, 0.2)
          : levels.paper * rng.range(0.96, 1),
      };
    });
  } else {
    list = spec;
  }
  const codeArea = rig.srcW * rig.srcH;
  return list.map((o) => {
    const aspect = o.aspect ?? (o.kind === 'blob' ? 0.7 : 0.12);
    check(o.area > 0 && o.area <= 1 && aspect > 0 && aspect <= 1, 'occluder area and aspect must be in (0, 1]');
    const area = o.area * codeArea;
    // Ellipse: π·a·b; rectangle: 2a·2b.
    const a = o.kind === 'blob' ? Math.sqrt(area / (Math.PI * aspect)) : Math.sqrt(area / aspect) / 2;
    return orientedShape(o.kind, o.x, o.y, a, a * aspect, o.angleDeg ?? 0, o.level ?? 0.08, rig, 1.5);
  });
}

function resolveGlare(spec: CaptureParams['glare'], rig: Rig): SurfaceShape[] {
  if (!spec) return [];
  const list: readonly GlareSpot[] = 'x' in spec ? [spec] : spec;
  return list.map((g) => {
    const aspect = g.aspect ?? 0.6;
    check(g.radius > 0 && aspect > 0 && aspect <= 1, 'glare radius must be > 0 and aspect in (0, 1]');
    const a = g.radius * rig.srcW;
    // exp(−2ρ²) is below 1e-6 beyond ρ = 2.7.
    return orientedShape('glare', g.x, g.y, a, a * aspect, g.angleDeg ?? 0, g.intensity ?? 1.2, rig, 2.7);
  });
}

// ── Source pyramid ─────────────────────────────────────────────────────────

interface Level {
  w: number;
  h: number;
  /** Luma 0..255 (level 0 is the source itself, no copy). */
  data: Uint8Array;
  /** Source pixels per texel. */
  factor: number;
}

/** Halve the source until a texel is at least ~0.67 frame px, so minified codes are area-averaged, not aliased. */
function sourceLevel(src: GrayImage, framePxPerSrcPx: number): Level {
  let level: Level = { w: src.width, h: src.height, data: src.data, factor: 1 };
  while (framePxPerSrcPx * level.factor < 1 / 1.5 && level.w > 1 && level.h > 1) {
    const { w: pw, h: ph, data: pd } = level;
    const w = Math.ceil(pw / 2);
    const h = Math.ceil(ph / 2);
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const r0 = 2 * y * pw;
      const r1 = Math.min(2 * y + 1, ph - 1) * pw;
      for (let x = 0; x < w; x++) {
        const x0 = 2 * x;
        const x1 = Math.min(2 * x + 1, pw - 1);
        data[y * w + x] = (pd[r0 + x0] + pd[r0 + x1] + pd[r1 + x0] + pd[r1 + x1] + 2) >> 2;
      }
    }
    level = { w, h, data, factor: level.factor * 2 };
  }
  return level;
}

// ── Capture ────────────────────────────────────────────────────────────────

export function simulateCapture(source: GrayImage, params: CaptureParams = {}, seed = 0): GrayImage {
  check(source.data.length === source.width * source.height, 'source data length does not match its size');
  const rig = buildRig(source, params);
  const rng = new Prng(seed);
  let radiance = renderScene(source, rig, params, rng);
  radiance = blur(radiance, rig.frameW, rig.frameH, params);
  let img = expose(radiance, rig.frameW, rig.frameH, params.noise, rng.fork('noise'));
  if (params.jpegQuality !== undefined) {
    img = params.jpegCodec === 'jpeg-js' ? encodeJpeg(img, params.jpegQuality) : encodeJpegFast(img, params.jpegQuality);
  }
  return rig.outW === rig.frameW && rig.outH === rig.frameH ? img : areaResample(img, rig.outW, rig.outH);
}

/** Steps 1–3: scene radiance per frame pixel (1 = paper white under neutral light). */
function renderScene(source: GrayImage, rig: Rig, p: CaptureParams, rng: Prng): Float32Array {
  const { frameW: W, frameH: H, srcW, srcH, rc, k1, f, cx, cy } = rig;
  const paper = p.paperLevel ?? 1;
  const ink = p.inkLevel ?? 0;
  check(paper >= 0 && paper <= 1 && ink >= 0 && ink <= 1, 'paperLevel and inkLevel must be in [0, 1]');
  // Source luma (0..255) → reflectance.
  const toneGain = (paper - ink) / 255;

  const pxPerSrc = localScale(rig, srcW / 2, srcH / 2);
  const { w: lw, h: lh, data: lt, factor } = sourceLevel(source, pxPerSrc);
  const invFactor = 1 / factor;

  const margin = p.sheetMargin ?? Infinity;
  const marginX = (typeof margin === 'number' ? margin : margin.x) * srcW;
  const marginY = (typeof margin === 'number' ? margin : margin.y) * srcW;
  check(marginX >= 0 && marginY >= 0, 'sheetMargin must be ≥ 0');
  const bounded = Number.isFinite(marginX) || Number.isFinite(marginY);

  const background = p.background ?? 0.25;
  check(typeof background === 'object' || (background >= 0 && background <= 1), 'background level must be in [0, 1]');
  const clutterW = Math.ceil(W / CLUTTER_SUBSAMPLE);
  const clutterH = Math.ceil(H / CLUTTER_SUBSAMPLE);
  const clutter = typeof background === 'object' ? clutterField(clutterW, clutterH, background, rng.fork('clutter')) : null;
  const flatBackground = typeof background === 'number' ? background : 0;
  const backgroundAt = (fx: number, fy: number): number => {
    if (!clutter) return flatBackground;
    // Bilinear lookup in the subsampled clutter field.
    const bx = Math.min(Math.max(fx / CLUTTER_SUBSAMPLE - 0.5, 0), clutterW - 1);
    const by = Math.min(Math.max(fy / CLUTTER_SUBSAMPLE - 0.5, 0), clutterH - 1);
    const x0 = Math.floor(bx);
    const y0 = Math.floor(by);
    const x1 = Math.min(x0 + 1, clutterW - 1);
    const y1 = Math.min(y0 + 1, clutterH - 1);
    const top = clutter[y0 * clutterW + x0] + (clutter[y0 * clutterW + x1] - clutter[y0 * clutterW + x0]) * (bx - x0);
    const bot = clutter[y1 * clutterW + x0] + (clutter[y1 * clutterW + x1] - clutter[y1 * clutterW + x0]) * (bx - x0);
    return top + (bot - top) * (by - y0);
  };

  // The texture tile spans one source width at about one texel per frame pixel.
  const texSize = Math.min(1024, Math.max(256, 2 ** Math.ceil(Math.log2(Math.max(1, srcW * pxPerSrc)))));
  const texMask = texSize - 1;
  const texPerSrc = texSize / srcW;
  const substrate = p.substrate ?? 'none';
  const texStrength = p.substrateStrength ?? 1;
  check(texStrength >= 0 && finite(texStrength), 'substrateStrength must be ≥ 0');
  const tex = substrate === 'none' || texStrength === 0 ? null : materialTexture(substrate, texSize);
  const texRng = rng.fork('substrate');
  const texOffU = texRng.int(0, texMask);
  const texOffV = texRng.int(0, texMask);

  const occluders = resolveOccluders(p.occlusion, rig, rng.fork('occlusion'), { paper, ink });
  const glares = resolveGlare(p.glare, rig);

  const gradStrength = p.illumination?.strength ?? 0;
  const gradAngle = rad(p.illumination?.angleDeg ?? 0);
  const halfDiag = Math.sqrt(W * W + H * H) / 2;
  const gx = (Math.sin(gradAngle) * gradStrength) / halfDiag;
  const gy = (-Math.cos(gradAngle) * gradStrength) / halfDiag;
  const vignette = (p.vignette ?? 0) / (halfDiag * halfDiag);

  // Ray in object coordinates: origin o = −Rᵀt, direction d = Rᵀ·(xn, yn, 1).
  const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = rig.r;
  const [tx, ty, tz] = rig.t;
  const ox = -(r0 * tx + r3 * ty + r6 * tz);
  const oy = -(r1 * tx + r4 * ty + r7 * tz);
  const oz = -(r2 * tx + r5 * ty + r8 * tz);
  const qz = oz - rc;
  const invScale = 1 / rig.scale;
  const invF = 1 / f;

  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = y + 0.5;
    const ry = fy - cy;
    for (let x = 0; x < W; x++) {
      const fx = x + 0.5;
      const rx = fx - cx;
      const i = y * W + x;
      let xn = rx * invF;
      let yn = ry * invF;
      if (k1 !== 0) {
        const m = 1 + k1 * (xn * xn + yn * yn);
        xn *= m;
        yn *= m;
      }
      const dx = r0 * xn + r3 * yn + r6;
      const dy = r1 * xn + r4 * yn + r7;
      const dz = r2 * xn + r5 * yn + r8;

      const vig = 1 - vignette * (rx * rx + ry * ry);
      const lit = 1 + gx * rx + gy * ry;
      const light = (lit > 0 ? lit : 0) * vig;

      // Ray / surface intersection → unrolled surface point (sx, sy), object units.
      let sx: number;
      let sy: number;
      let shade = 1;
      if (rc === 0) {
        const tHit = -oz / dz;
        if (!(tHit > 0)) {
          out[i] = backgroundAt(fx, fy) * light;
          continue;
        }
        sx = ox + tHit * dx;
        sy = oy + tHit * dy;
      } else {
        const qa = dx * dx + dz * dz;
        const qb = 2 * (ox * dx + qz * dz);
        const disc = qb * qb - 4 * qa * (ox * ox + qz * qz - rc * rc);
        const tHit = qa > 0 && disc >= 0 ? (-qb - Math.sqrt(disc)) / (2 * qa) : -1;
        if (!(tHit > 0)) {
          out[i] = backgroundAt(fx, fy) * light;
          continue;
        }
        const hx = ox + tHit * dx;
        const depth = rc - (oz + tHit * dz); // rc·cos φ, φ = angle from the crest
        sx = rc * Math.atan2(hx, depth); // arc length from the crest
        sy = oy + tHit * dy;
        // The surface turns away from the light towards the silhouette (softened Lambert).
        shade = Math.sqrt(Math.max(0, depth / rc));
      }
      const u = sx * invScale + srcW / 2;
      const v = sy * invScale + srcH / 2;

      // Sheet coverage with a one-pixel anti-aliased edge.
      let sheet = 1;
      if (bounded) {
        const outside = Math.max(-marginX - u, u - srcW - marginX, -marginY - v, v - srcH - marginY);
        sheet = Math.min(1, Math.max(0, 0.5 - outside * pxPerSrc));
        if (sheet === 0) {
          out[i] = backgroundAt(fx, fy) * light;
          continue;
        }
      }

      // Source luma (paper beyond the source), bilinear on the chosen mip level.
      let refl = paper;
      if (u >= 0 && u < srcW && v >= 0 && v < srcH) {
        let lu = u * invFactor - 0.5;
        let lv = v * invFactor - 0.5;
        lu = lu < 0 ? 0 : lu > lw - 1 ? lw - 1 : lu;
        lv = lv < 0 ? 0 : lv > lh - 1 ? lh - 1 : lv;
        const u0 = lu | 0;
        const v0 = lv | 0;
        const u1 = u0 + 1 < lw ? u0 + 1 : u0;
        const row0 = v0 * lw;
        const row1 = (v0 + 1 < lh ? v0 + 1 : v0) * lw;
        const wu = lu - u0;
        const top = lt[row0 + u0] + (lt[row0 + u1] - lt[row0 + u0]) * wu;
        const bot = lt[row1 + u0] + (lt[row1 + u1] - lt[row1 + u0]) * wu;
        refl = ink + toneGain * (top + (bot - top) * (lv - v0));
      }

      for (let k = 0; k < occluders.length; k++) {
        const o = occluders[k];
        const du = u - o.cx;
        const dv = v - o.cy;
        if (du * du + dv * dv > o.reach * o.reach) continue;
        const along = du * o.ux + dv * o.uy;
        const across = du * o.uy - dv * o.ux;
        let dist: number; // signed distance to the outline, source px (> 0 outside)
        if (o.kind === 'strip') {
          dist = Math.max(Math.abs(along) - o.a, Math.abs(across) - o.b);
        } else {
          // First-order distance to an ellipse: (ρ − 1) / |∇ρ|.
          const ea = along / (o.a * o.a);
          const eb = across / (o.b * o.b);
          const rho = Math.sqrt(along * ea + across * eb);
          dist = rho > 1e-9 ? ((rho - 1) * rho) / Math.sqrt(ea * ea + eb * eb) : -o.b;
        }
        const cover = Math.min(1, Math.max(0, 0.5 - dist * pxPerSrc));
        refl += (o.value - refl) * cover;
      }

      // Texture after occlusion: dirt and abrasions keep the surface relief.
      if (tex) {
        const tu = u * texPerSrc - 0.5 + texOffU;
        const tv = v * texPerSrc - 0.5 + texOffV;
        const tu0 = Math.floor(tu);
        const tv0 = Math.floor(tv);
        const wu = tu - tu0;
        const t0 = (tv0 & texMask) * texSize;
        const t1 = ((tv0 + 1) & texMask) * texSize;
        const c0 = tu0 & texMask;
        const c1 = (tu0 + 1) & texMask;
        const top = tex[t0 + c0] + (tex[t0 + c1] - tex[t0 + c0]) * wu;
        const bot = tex[t1 + c0] + (tex[t1 + c1] - tex[t1 + c0]) * wu;
        const gain = 1 + texStrength * (top + (bot - top) * (tv - tv0));
        refl *= gain > 0 ? gain : 0;
      }

      let glare = 0;
      for (let k = 0; k < glares.length; k++) {
        const g = glares[k];
        const du = u - g.cx;
        const dv = v - g.cy;
        if (du * du + dv * dv > g.reach * g.reach) continue;
        const along = du * g.ux + dv * g.uy;
        const across = du * g.uy - dv * g.ux;
        glare += g.value * Math.exp(-2 * ((along * along) / (g.a * g.a) + (across * across) / (g.b * g.b)));
      }

      // Specular light is not shaded by the diffuse gradient, but the lens still vignettes it.
      const surface = refl * shade * light + glare * vig;
      out[i] = sheet === 1 ? surface : surface * sheet + backgroundAt(fx, fy) * light * (1 - sheet);
    }
  }
  return out;
}

// ── Optics ─────────────────────────────────────────────────────────────────

/** Defocus then camera shake. Returns the input array when there is nothing to do. */
function blur(img: Float32Array, w: number, h: number, p: CaptureParams): Float32Array {
  const sigma = p.blurSigma ?? 0;
  check(sigma >= 0 && finite(sigma), 'blurSigma must be ≥ 0');
  let out = img;
  if (sigma > 0) {
    const radius = Math.max(1, Math.ceil(3 * sigma));
    const kernel = Float64Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
    const sum = kernel.reduce((a, b) => a + b, 0);
    for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
    out = convolveColumns(convolveRows(out, w, h, kernel), w, h, kernel);
  }
  if (p.motionBlur && p.motionBlur.lengthPx > 0) {
    out = convolve(out, w, h, lineKernel(p.motionBlur.lengthPx, rad(p.motionBlur.angleDeg)));
  }
  return out;
}

/** Horizontal pass of a centred odd-length kernel, edges clamped. */
function convolveRows(src: Float32Array, w: number, h: number, kernel: Float64Array): Float32Array {
  const n = kernel.length;
  const r = (n - 1) / 2;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      if (x >= r && x < w - r) {
        const base = row + x - r;
        for (let k = 0; k < n; k++) s += kernel[k] * src[base + k];
      } else {
        for (let k = 0; k < n; k++) {
          const sx = x + k - r;
          s += kernel[k] * src[row + (sx < 0 ? 0 : sx >= w ? w - 1 : sx)];
        }
      }
      out[row + x] = s;
    }
  }
  return out;
}

/** Vertical pass, accumulated row by row so memory is read sequentially. */
function convolveColumns(src: Float32Array, w: number, h: number, kernel: Float64Array): Float32Array {
  const n = kernel.length;
  const r = (n - 1) / 2;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let k = 0; k < n; k++) {
      const sy = y + k - r;
      const srow = (sy < 0 ? 0 : sy >= h ? h - 1 : sy) * w;
      const wk = kernel[k];
      for (let x = 0; x < w; x++) out[row + x] += wk * src[srow + x];
    }
  }
  return out;
}

interface Tap {
  dx: number;
  dy: number;
  w: number;
}

/** Box blur along a segment: uniform samples spread bilinearly onto integer taps. */
function lineKernel(length: number, angle: number): Tap[] {
  check(finite(length), 'motionBlur.lengthPx must be finite');
  const n = Math.ceil(length) + 1;
  const ux = Math.sin(angle);
  const uy = -Math.cos(angle);
  const taps = new Map<string, Tap>();
  const deposit = (dx: number, dy: number, w: number): void => {
    if (w <= 0) return;
    const key = `${dx},${dy}`;
    const tap = taps.get(key);
    if (tap) tap.w += w;
    else taps.set(key, { dx, dy, w });
  };
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1) - 0.5) * length;
    const px = s * ux;
    const py = s * uy;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    deposit(x0, y0, ((1 - fx) * (1 - fy)) / n);
    deposit(x0 + 1, y0, (fx * (1 - fy)) / n);
    deposit(x0, y0 + 1, ((1 - fx) * fy) / n);
    deposit(x0 + 1, y0 + 1, (fx * fy) / n);
  }
  return [...taps.values()];
}

/** out(x, y) = Σ w · in(x + dx, y + dy) with clamped edges; interior pixels skip the clamping. */
function convolve(src: Float32Array, w: number, h: number, taps: readonly Tap[]): Float32Array {
  const n = taps.length;
  const dxs = Int32Array.from(taps, (t) => t.dx);
  const dys = Int32Array.from(taps, (t) => t.dy);
  const wts = Float64Array.from(taps, (t) => t.w);
  const offsets = Int32Array.from(taps, (t) => t.dy * w + t.dx);
  const mx = Math.max(...taps.map((t) => Math.abs(t.dx)));
  const my = Math.max(...taps.map((t) => Math.abs(t.dy)));
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const interiorRow = y >= my && y < h - my;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let s = 0;
      if (interiorRow && x >= mx && x < w - mx) {
        for (let k = 0; k < n; k++) s += wts[k] * src[i + offsets[k]];
      } else {
        for (let k = 0; k < n; k++) {
          const sx = Math.min(w - 1, Math.max(0, x + dxs[k]));
          const sy = Math.min(h - 1, Math.max(0, y + dys[k]));
          s += wts[k] * src[sy * w + sx];
        }
      }
      out[i] = s;
    }
  }
  return out;
}

// ── Sensor ─────────────────────────────────────────────────────────────────

/**
 * Φ⁻¹ at the midpoints of 65 536 equiprobable bins: the top 16 bits of a u32
 * index a standard normal deviate (tails truncated at ±4.2σ), several times
 * cheaper per pixel than Box–Muller.
 */
let normalTable: Float32Array | undefined;
function normalDeviates(): Float32Array {
  normalTable ??= Float32Array.from({ length: 65536 }, (_, i) => inverseNormalCdf((i + 0.5) / 65536));
  return normalTable;
}

function expose(radiance: Float32Array, w: number, h: number, noise: CaptureParams['noise'], rng: Prng): GrayImage {
  const sigma = noise?.sigma ?? 0;
  const shot = noise?.shot ?? 0;
  check(sigma >= 0 && shot >= 0 && finite(sigma) && finite(shot), 'noise sigma and shot must be ≥ 0');
  const img = createGray(w, h);
  const out = img.data;
  const noisy = sigma > 0 || shot > 0;
  const deviates = noisy ? normalDeviates() : null;
  // Noise standard deviation per whole signal level (glare can push the signal past 255).
  const sdByLevel = Float32Array.from({ length: 512 }, (_, level) => Math.sqrt(sigma * sigma + shot * level));
  for (let i = 0; i < radiance.length; i++) {
    let v = radiance[i] * 255;
    if (deviates) {
      const level = v <= 0 ? 0 : v >= 511 ? 511 : v | 0;
      v += sdByLevel[level] * deviates[rng.u32() >>> 16];
    }
    out[i] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
  }
  return img;
}

/** Area-average resample (box filter with fractional overlaps), as a scanner downscaling its feed. */
function areaResample(img: GrayImage, outW: number, outH: number): GrayImage {
  const spans = (n: number, m: number) =>
    Array.from({ length: m }, (_, i) => {
      const a = (i * n) / m;
      const b = ((i + 1) * n) / m;
      const parts: { index: number; w: number }[] = [];
      for (let j = Math.floor(a); j < Math.min(n, Math.ceil(b)); j++) {
        parts.push({ index: j, w: (Math.min(b, j + 1) - Math.max(a, j)) / (b - a) });
      }
      return parts;
    });
  const cols = spans(img.width, outW);
  const rows = spans(img.height, outH);
  const tmp = new Float32Array(outW * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < outW; x++) {
      let s = 0;
      for (const c of cols[x]) s += c.w * img.data[y * img.width + c.index];
      tmp[y * outW + x] = s;
    }
  }
  const out = createGray(outW, outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let s = 0;
      for (const rw of rows[y]) s += rw.w * tmp[rw.index * outW + x];
      out.data[y * outW + x] = Math.round(s);
    }
  }
  return out;
}

// ── Presets ────────────────────────────────────────────────────────────────

export type PresetName =
  | 'clean'
  | 'typicalPhone'
  | 'lowLight'
  | 'glare'
  | 'tilted45'
  | 'leather'
  | 'metal'
  | 'worn'
  | 'small';

/** Hand-held phone shot of a printed hang-tag on a desk: the baseline for most presets. */
const HANDHELD: CaptureParams = {
  codeWidthPx: 400,
  offset: { x: 40, y: -25 },
  rotationDeg: 12,
  tiltXDeg: 12,
  tiltYDeg: -9,
  barrelK1: 0.02,
  sheetMargin: 0.35,
  background: { kind: 'clutter' },
  substrate: 'paper',
  paperLevel: 0.86,
  inkLevel: 0.1,
  illumination: { angleDeg: 300, strength: 0.18 },
  vignette: 0.25,
  blurSigma: 0.9,
  noise: { sigma: 1.5, shot: 0.04 },
  jpegQuality: 82,
};

/** Capture conditions for the scan test matrix (default 1280×720 frame). */
export const PRESETS: Readonly<Record<PresetName, Readonly<CaptureParams>>> = Object.freeze({
  /** Face-on, centred, noiseless, uncompressed: the decoder's best case. */
  clean: {},
  typicalPhone: HANDHELD,
  /** Dim room: underexposed, strong fall-off, heavy noise, hand shake, stronger compression. */
  lowLight: {
    ...HANDHELD,
    rotationDeg: -7,
    tiltXDeg: 8,
    tiltYDeg: 6,
    background: { kind: 'clutter', level: 0.15, contrast: 0.3 },
    paperLevel: 0.36,
    inkLevel: 0.05,
    illumination: { angleDeg: 120, strength: 0.35 },
    vignette: 0.45,
    blurSigma: 1.3,
    motionBlur: { lengthPx: 3, angleDeg: 20 },
    noise: { sigma: 5, shot: 0.8 },
    jpegQuality: 70,
  },
  /** Glossy label under a lamp: a saturated highlight across the data orbits. */
  glare: {
    ...HANDHELD,
    glare: { x: 0.68, y: 0.34, radius: 0.16, aspect: 0.55, angleDeg: 35, intensity: 1.6 },
  },
  /** Steep 45° view: strong foreshortening and keystone. */
  tilted45: {
    ...HANDHELD,
    codeWidthPx: 460,
    offset: { x: 0, y: 0 },
    rotationDeg: 5,
    tiltXDeg: 45,
    tiltYDeg: 0,
  },
  /** Blind deboss on a tan leather bag panel: low contrast, pebble grain, gentle bend. */
  leather: {
    ...HANDHELD,
    rotationDeg: -4,
    tiltXDeg: 6,
    tiltYDeg: 10,
    curvature: 0.45,
    sheetMargin: 0.5,
    background: { kind: 'clutter', level: 0.2, contrast: 0.35 },
    substrate: 'leather',
    paperLevel: 0.5,
    inkLevel: 0.2,
    illumination: { angleDeg: 45, strength: 0.3 },
    blurSigma: 1,
    noise: { sigma: 3, shot: 0.3 },
    jpegQuality: 80,
  },
  /** Laser engraving on a brushed ring: strong curvature, specular stripe along the ring axis. */
  metal: {
    ...HANDHELD,
    codeWidthPx: 360,
    offset: { x: 0, y: 0 },
    rotationDeg: 3,
    tiltXDeg: -6,
    tiltYDeg: 0,
    curvature: 1.1,
    sheetMargin: { x: Infinity, y: 0.12 },
    background: { kind: 'clutter', level: 0.2, contrast: 0.3 },
    substrate: 'brushed-metal',
    paperLevel: 0.72,
    inkLevel: 0.25,
    glare: { x: 0.58, y: 0.5, radius: 0.6, aspect: 0.1, angleDeg: 0, intensity: 0.9 },
  },
  /** Scuffed, dirty code: occluders (dirt, scratches, abrasion) on textured stock, noisy. */
  worn: {
    ...HANDHELD,
    substrate: 'textured-paper',
    occlusion: { count: 5, area: 0.012 },
    blurSigma: 1.1,
    noise: { sigma: 4, shot: 0.4 },
    jpegQuality: 75,
  },
  /** Far away / tiny print: 3 px per CODE-01 module (50 u across). */
  small: {
    ...HANDHELD,
    codeWidthPx: 150,
    blurSigma: 0.7,
  },
});
