// src/core/geometry.ts
function polar(r, theta, cx = 0, cy = 0) {
  return { x: cx + r * Math.sin(theta), y: cy - r * Math.cos(theta) };
}
function angleOf(x, y) {
  const a = Math.atan2(x, -y);
  return a < 0 ? a + 2 * Math.PI : a;
}
var TAU = Math.PI * 2;
var deg = (d) => d * Math.PI / 180;

// src/core/code/profile.ts
var CODE01 = {
  id: "CODE-01",
  version: 1,
  seal: {
    coreRadius: 2,
    gapOuter: 3,
    ringOuter: 4,
    quietOuter: 5.75
  },
  genome: {
    orbitRadius: 7.5,
    glyphRadius: 1.75,
    count: 8,
    /** glyph i is centred at angle i · 45° clockwise from north */
    stepRad: TAU / 8
  },
  data: {
    firstRadius: 10.5,
    ringCount: 13,
    pitch: 1,
    /** Radial thickness of a drawn data arc (u). Cell centre sampling is at ring radius. */
    arcThickness: 0.72
  },
  format: {
    /** Format words live on ring 0. Two asymmetric copies (start cells). */
    ring: 0,
    copyStarts: [0, 24],
    bits: 15
  },
  moons: {
    orbitRadius: 27.5,
    radius: 1.75,
    /** Clockwise from north. Index 0 is POLARIS (NW). */
    anglesDeg: [315, 45, 135, 225],
    polarisIndex: 0,
    /** Polaris halo annulus (hint only): centre radius & width, relative to moon centre. */
    haloRadius: 2.6,
    haloWidth: 0.4
  },
  extent: {
    /** Half width of the content square (u). */
    halfWidth: 23,
    /** Mandatory quiet zone around the content square (u). */
    quiet: 2
  },
  ecc: {
    /** Bytes of protected data: 13 payload + 64 signature + 2 CRC-16. */
    dataBytes: 79,
    /** Total RS(255-shortened) codeword length over GF(256). */
    totalBytes: 164
  }
};
var CODE01_SIZE = 2 * (CODE01.extent.halfWidth + CODE01.extent.quiet);
var CODE01_RINGS = (() => {
  const rings = [];
  let offset = 0;
  for (let k = 0; k < CODE01.data.ringCount; k++) {
    const radius = CODE01.data.firstRadius + k * CODE01.data.pitch;
    const cells = 4 * Math.round(TAU * radius / 4);
    rings.push({ index: k, radius, cells, offset });
    offset += cells;
  }
  return rings;
})();
var CODE01_TOTAL_CELLS = CODE01_RINGS.reduce((s, r) => s + r.cells, 0);
var CODE01_FORMAT_CELLS = CODE01.format.copyStarts.map(
  (start) => {
    const ring = CODE01_RINGS[CODE01.format.ring];
    return Array.from({ length: CODE01.format.bits }, (_, b) => ring.offset + (start + b) % ring.cells);
  }
);
var FORMAT_SET = new Set(CODE01_FORMAT_CELLS.flat());
var CODE01_DATA_CELLS = (() => {
  const out = [];
  for (let i = 0; i < CODE01_TOTAL_CELLS; i++) if (!FORMAT_SET.has(i)) out.push(i);
  return out;
})();
var CODE01_DATA_BITS = CODE01.ecc.totalBytes * 8;
var CODE01_PADDING_CELLS = CODE01_DATA_CELLS.length - CODE01_DATA_BITS;
function cellRef(flat) {
  for (const ring of CODE01_RINGS) {
    if (flat < ring.offset + ring.cells) return { ring: ring.index, cell: flat - ring.offset, flat };
  }
  throw new RangeError(`cell ${flat} out of range`);
}
var CODE01_MOONS = CODE01.moons.anglesDeg.map(
  (a) => polar(CODE01.moons.orbitRadius, deg(a))
);
var CODE01_GENOME_CENTERS = Array.from(
  { length: CODE01.genome.count },
  (_, i) => polar(CODE01.genome.orbitRadius, i * CODE01.genome.stepRad)
);
var MASK_SEEDS = [2654435769, 2135587861, 2496678331, 3210233709];
var CODE01_MASK_COUNT = MASK_SEEDS.length;
var maskCache = /* @__PURE__ */ new Map();
function maskBits(mask) {
  return maskBitsShared(mask).slice();
}
function maskBitsShared(mask) {
  if (!Number.isInteger(mask) || mask < 0 || mask >= MASK_SEEDS.length) {
    throw new RangeError(`invalid mask ${mask}`);
  }
  const cached = maskCache.get(mask);
  if (cached) return cached;
  const out = new Uint8Array(CODE01_DATA_CELLS.length);
  let s = MASK_SEEDS[mask] >>> 0;
  for (let i = 0; i < out.length; i++) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    out[i] = s >>> 31;
  }
  maskCache.set(mask, out);
  return out;
}
function formatInfoValue(codeVersion, mask) {
  if (!Number.isInteger(codeVersion) || codeVersion < 1 || codeVersion > 8) throw new RangeError("codeVersion out of range");
  if (!Number.isInteger(mask) || mask < 0 || mask > 3) throw new RangeError("mask out of range");
  return codeVersion - 1 << 2 | mask;
}
function parseFormatInfoValue(v) {
  return { codeVersion: (v >> 2 & 7) + 1, mask: v & 3 };
}

// src/core/ecc/gf256.ts
var GF256_PRIMITIVE_POLY = 285;
var EXP = new Uint8Array(512);
var LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= GF256_PRIMITIVE_POLY;
  }
  for (let i = 255; i < EXP.length; i++) EXP[i] = EXP[i - 255];
}
function gfExp(e) {
  const r = e % 255;
  return EXP[r < 0 ? r + 255 : r];
}
function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}
function gfDiv(a, b) {
  if (b === 0) throw new RangeError("division by zero in GF(256)");
  return a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]];
}
function gfInv(a) {
  if (a === 0) throw new RangeError("0 has no inverse in GF(256)");
  return EXP[255 - LOG[a]];
}

// src/core/ecc/reed-solomon.ts
var MAX_CODEWORD_LENGTH = 255;
var INVALID_INPUT = Object.freeze({ ok: false, reason: "INVALID_INPUT" });
var TOO_MANY_ERRORS = Object.freeze({ ok: false, reason: "TOO_MANY_ERRORS" });
function isValidShape(n, nsym) {
  return Number.isInteger(nsym) && nsym >= 1 && n > nsym && n <= MAX_CODEWORD_LENGTH;
}
var generatorCache = /* @__PURE__ */ new Map();
function generatorPoly(nsym) {
  const cached = generatorCache.get(nsym);
  if (cached) return cached;
  const g = new Uint8Array(nsym + 1);
  g[0] = 1;
  for (let i = 0; i < nsym; i++) {
    const root = gfExp(i);
    for (let j = i + 1; j >= 1; j--) g[j] ^= gfMul(g[j - 1], root);
  }
  generatorCache.set(nsym, g);
  return g;
}
function rsEncode(data, nsym) {
  const n = data.length + nsym;
  if (!isValidShape(n, nsym)) {
    throw new RangeError(
      `invalid Reed-Solomon shape: ${data.length} data + ${nsym} parity bytes (need \u2265 1 each, total \u2264 255)`
    );
  }
  const gen = generatorPoly(nsym);
  const out = new Uint8Array(n);
  out.set(data);
  const parity = out.subarray(data.length);
  for (let i = 0; i < data.length; i++) {
    const feedback = data[i] ^ parity[0];
    parity.copyWithin(0, 1);
    parity[nsym - 1] = 0;
    if (feedback !== 0) {
      for (let j = 0; j < nsym; j++) parity[j] ^= gfMul(feedback, gen[j + 1]);
    }
  }
  return out;
}
function syndromes(word, nsym) {
  const s = new Uint8Array(nsym);
  for (let j = 0; j < nsym; j++) {
    const x = gfExp(j);
    let acc = 0;
    for (let i = 0; i < word.length; i++) acc = gfMul(acc, x) ^ word[i];
    s[j] = acc;
  }
  return s;
}
function isZero(p) {
  for (let i = 0; i < p.length; i++) if (p[i] !== 0) return false;
  return true;
}
function degree(p) {
  let d = p.length - 1;
  while (d > 0 && p[d] === 0) d--;
  return d;
}
function polyEval(p, x) {
  let y = 0;
  for (let i = p.length - 1; i >= 0; i--) y = gfMul(y, x) ^ p[i];
  return y;
}
function berlekampMassey(synd, gamma) {
  const nsym = synd.length;
  const f = gamma.length - 1;
  const lambda = new Uint8Array(nsym + 1);
  const b = new Uint8Array(nsym + 1);
  lambda.set(gamma);
  b.set(gamma);
  let length = f;
  for (let r = f + 1; r <= nsym; r++) {
    let delta = 0;
    for (let i = 0; i < r; i++) delta ^= gfMul(lambda[i], synd[r - 1 - i]);
    b.copyWithin(1, 0, nsym);
    b[0] = 0;
    if (delta === 0) continue;
    if (2 * length <= r + f - 1) {
      const inv = gfInv(delta);
      for (let i = 0; i <= r; i++) {
        const old = lambda[i];
        lambda[i] = old ^ gfMul(delta, b[i]);
        b[i] = gfMul(inv, old);
      }
      length = r + f - length;
    } else {
      for (let i = 0; i <= r; i++) lambda[i] ^= gfMul(delta, b[i]);
    }
  }
  return { lambda, length };
}
function chienSearch(locator, n) {
  const positions = [];
  for (let p = 0; p < n; p++) {
    if (polyEval(locator, gfExp(p - (n - 1))) === 0) positions.push(p);
  }
  return positions;
}
function rsDecode(codeword, nsym, erasures = []) {
  const n = codeword.length;
  if (!isValidShape(n, nsym)) return INVALID_INPUT;
  const erased = /* @__PURE__ */ new Set();
  for (const p of erasures) {
    if (!Number.isInteger(p) || p < 0 || p >= n) return INVALID_INPUT;
    erased.add(p);
  }
  const f = erased.size;
  if (f > nsym) return TOO_MANY_ERRORS;
  const word = codeword.slice();
  const k = n - nsym;
  const synd = syndromes(word, nsym);
  if (isZero(synd)) return success(word, k, 0, f, []);
  const gamma = new Uint8Array(f + 1);
  gamma[0] = 1;
  let gammaDegree = 0;
  for (const p of erased) {
    const x = gfExp(n - 1 - p);
    gammaDegree++;
    for (let i = gammaDegree; i >= 1; i--) gamma[i] ^= gfMul(gamma[i - 1], x);
  }
  const { lambda, length } = berlekampMassey(synd, gamma);
  if (2 * length - f > nsym || degree(lambda) !== length) return TOO_MANY_ERRORS;
  const locator = lambda.subarray(0, length + 1);
  const positions = chienSearch(locator, n);
  if (positions.length !== length) return TOO_MANY_ERRORS;
  const omega = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    let acc = 0;
    for (let j = 0; j <= i; j++) acc ^= gfMul(locator[j], synd[i - j]);
    omega[i] = acc;
  }
  const derivative = new Uint8Array(length);
  for (let i = 1; i <= length; i += 2) derivative[i - 1] = locator[i];
  for (const p of positions) {
    const x = gfExp(n - 1 - p);
    const xInv = gfInv(x);
    const denominator = polyEval(derivative, xInv);
    if (denominator === 0) return TOO_MANY_ERRORS;
    word[p] ^= gfMul(x, gfDiv(polyEval(omega, xInv), denominator));
  }
  if (!isZero(syndromes(word, nsym))) return TOO_MANY_ERRORS;
  const changed = positions.filter((p) => word[p] !== codeword[p]);
  const errors = changed.reduce((count, p) => count + (erased.has(p) ? 0 : 1), 0);
  return success(word, k, errors, f, changed);
}
function success(word, k, errors, erasures, positions) {
  return { ok: true, codeword: word, data: word.slice(0, k), errors, erasures, positions };
}

// src/core/ecc/bch.ts
var FORMAT_GENERATOR = 1335;
var FORMAT_XOR_MASK = 21522;
var VALUE_COUNT = 32;
function bchRemainder(value5) {
  let r = value5 << 10;
  for (let bit = 14; bit >= 10; bit--) {
    if (r & 1 << bit) r ^= FORMAT_GENERATOR << bit - 10;
  }
  return r;
}
var FORMAT_WORDS = Array.from(
  { length: VALUE_COUNT },
  (_, v) => (v << 10 | bchRemainder(v)) ^ FORMAT_XOR_MASK
);
function bchFormatEncode(value5) {
  if (!Number.isInteger(value5) || value5 < 0 || value5 >= VALUE_COUNT) {
    throw new RangeError(`format value ${value5} is not an integer in 0..31`);
  }
  return FORMAT_WORDS[value5];
}

// src/core/ecc/crc16.ts
var POLY = 4129;
var TABLE = (() => {
  const table = new Uint16Array(256);
  for (let b = 0; b < 256; b++) {
    let crc = b << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 32768 ? crc << 1 ^ POLY : crc << 1;
    table[b] = crc;
  }
  return table;
})();
function crc16(bytes) {
  let crc = 65535;
  for (let i = 0; i < bytes.length; i++) crc = (crc << 8 ^ TABLE[crc >>> 8 ^ bytes[i]]) & 65535;
  return crc;
}

// src/core/render/svg.ts
var DEFAULT_INK = "#000000";
var DEFAULT_PAPER = "#ffffff";
var DECIMALS = 3;
var MAX_ARC_SEGMENT = TAU / 4;
var FULL_TURN_EPSILON = 1e-9;
function fmt(n) {
  if (!Number.isFinite(n)) throw new RangeError(`non-finite coordinate ${n}`);
  const s = n.toFixed(DECIMALS).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}
function pt(p) {
  return `${fmt(p.x)} ${fmt(p.y)}`;
}
function arcTo(cx, cy, r, a0, a1) {
  const span = a1 - a0;
  const segments = Math.max(1, Math.ceil(Math.abs(span) / MAX_ARC_SEGMENT - 1e-9));
  const sweep = span > 0 ? 1 : 0;
  let d = "";
  for (let k = 1; k <= segments; k++) {
    const p = polar(r, a0 + span * k / segments, cx, cy);
    d += `A${fmt(r)} ${fmt(r)} 0 0 ${sweep} ${pt(p)}`;
  }
  return d;
}
function circle(cx, cy, r, clockwise) {
  const [a0, a1] = clockwise ? [0, TAU] : [TAU, 0];
  return `M${pt(polar(r, a0, cx, cy))}${arcTo(cx, cy, r, a0, a1)}Z`;
}
function annulus(cx, cy, inner, outer) {
  return inner > 0 ? circle(cx, cy, outer, true) + circle(cx, cy, inner, false) : circle(cx, cy, outer, true);
}
function requirePositive(value, what) {
  if (!(Number.isFinite(value) && value > 0)) throw new RangeError(`${what} must be a positive finite number, got ${value}`);
}
function requireFinite(value, what) {
  if (!Number.isFinite(value)) throw new RangeError(`${what} must be finite, got ${value}`);
}
function arcPath(cx, cy, r, width, start, end, cap) {
  const span = end - start;
  const half = width / 2;
  const outer = r + half;
  const inner = r - half;
  if (span >= TAU - FULL_TURN_EPSILON) return annulus(cx, cy, inner, outer);
  if (cap === "butt") {
    const tip = inner > 0 ? `L${pt(polar(inner, end, cx, cy))}${arcTo(cx, cy, inner, end, start)}` : `L${pt({ x: cx, y: cy })}`;
    return `M${pt(polar(outer, start, cx, cy))}${arcTo(cx, cy, outer, start, end)}${tip}Z`;
  }
  if (inner <= 0) throw new RangeError("round-capped arc width must be smaller than its diameter");
  const inset = Math.asin(half / r);
  if (span <= 2 * inset) {
    const mid = polar(r, start + span / 2, cx, cy);
    return circle(mid.x, mid.y, r * Math.sin(span / 2), true);
  }
  const a = start + inset;
  const b = end - inset;
  const capEnd = polar(r, b, cx, cy);
  const capStart = polar(r, a, cx, cy);
  return `M${pt(polar(outer, a, cx, cy))}` + arcTo(cx, cy, outer, a, b) + // Each cap is the half of the cap circle lying beyond the radial line through its centre.
  arcTo(capEnd.x, capEnd.y, half, b, b + Math.PI) + arcTo(cx, cy, inner, b, a) + arcTo(capStart.x, capStart.y, half, a + Math.PI, a + TAU) + "Z";
}
function primitiveToPathData(p) {
  requireFinite(p.cx, "cx");
  requireFinite(p.cy, "cy");
  requirePositive(p.r, `${p.kind} radius`);
  switch (p.kind) {
    case "disc":
      return circle(p.cx, p.cy, p.r, true);
    case "ring":
      requirePositive(p.width, "ring width");
      return annulus(p.cx, p.cy, p.r - p.width / 2, p.r + p.width / 2);
    case "arc": {
      requirePositive(p.width, "arc width");
      requireFinite(p.start, "arc start");
      requireFinite(p.end, "arc end");
      if (!(p.end > p.start)) throw new RangeError("arc end must be greater than start");
      if (p.width > 2 * p.r) throw new RangeError("arc width must not exceed its diameter");
      return arcPath(p.cx, p.cy, p.r, p.width, p.start, p.end, p.cap);
    }
    case "halfDisc": {
      requireFinite(p.angle, "halfDisc angle");
      const from = p.angle - Math.PI / 2;
      return `M${pt(polar(p.r, from, p.cx, p.cy))}${arcTo(p.cx, p.cy, p.r, from, from + Math.PI)}Z`;
    }
    case "crescent": {
      requireFinite(p.angle, "crescent angle");
      if (!(p.offset > 0 && p.offset < 2 * p.r)) throw new RangeError("crescent offset must be in (0, 2r)");
      const phi = Math.acos(p.offset / (2 * p.r));
      const occluder = polar(p.offset, p.angle, p.cx, p.cy);
      return `M${pt(polar(p.r, p.angle + phi, p.cx, p.cy))}` + arcTo(p.cx, p.cy, p.r, p.angle + phi, p.angle + TAU - phi) + arcTo(occluder.x, occluder.y, p.r, p.angle + Math.PI + phi, p.angle + Math.PI - phi) + "Z";
    }
    default: {
      const unknown = p;
      throw new RangeError(`unknown primitive kind ${unknown.kind}`);
    }
  }
}
function hasHole(p) {
  if (p.kind === "ring") return p.r - p.width / 2 > 0;
  if (p.kind === "arc") return p.end - p.start >= TAU - FULL_TURN_EPSILON && p.r - p.width / 2 > 0;
  return false;
}
function escapeXml(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
function parseHex(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function toneFill(tone, ink, paper) {
  const inkRgb = parseHex(ink);
  const paperRgb = paper === null ? null : parseHex(paper);
  if (inkRgb && paperRgb) {
    const mixed = inkRgb.map((c, i) => Math.round(paperRgb[i] + (c - paperRgb[i]) * tone));
    return ` fill="#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}"`;
  }
  return ` fill-opacity="${fmt(tone)}"`;
}
function primitivesToSvg(primitives, viewBox, style = {}) {
  requireFinite(viewBox.x, "viewBox.x");
  requireFinite(viewBox.y, "viewBox.y");
  requirePositive(viewBox.w, "viewBox.w");
  requirePositive(viewBox.h, "viewBox.h");
  const ink = style.ink ?? DEFAULT_INK;
  const paper = style.paper === void 0 ? DEFAULT_PAPER : style.paper;
  const box = `${fmt(viewBox.x)} ${fmt(viewBox.y)} ${fmt(viewBox.w)} ${fmt(viewBox.h)}`;
  let size = "";
  if (style.widthMm !== void 0) {
    requirePositive(style.widthMm, "widthMm");
    size = ` width="${fmt(style.widthMm)}mm" height="${fmt(style.widthMm * viewBox.h / viewBox.w)}mm"`;
  }
  const lines = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}"${size}>`];
  if (style.title !== void 0) lines.push(`<title>${escapeXml(style.title)}</title>`);
  if (paper !== null) {
    lines.push(
      `<rect x="${fmt(viewBox.x)}" y="${fmt(viewBox.y)}" width="${fmt(viewBox.w)}" height="${fmt(viewBox.h)}" fill="${escapeXml(paper)}"/>`
    );
  }
  lines.push(`<g fill="${escapeXml(ink)}">`);
  let openLayer = null;
  for (const p of primitives) {
    if (p.layer === "decor" && style.decor === false) continue;
    const tone = p.tone ?? 1;
    if (!(tone >= 0 && tone <= 1)) throw new RangeError(`tone must be in [0, 1], got ${tone}`);
    if (tone === 0) continue;
    if (p.layer !== openLayer) {
      if (openLayer !== null) lines.push("</g>");
      lines.push(`<g data-layer="${escapeXml(p.layer)}">`);
      openLayer = p.layer;
    }
    const fill = tone === 1 ? "" : toneFill(tone, ink, paper);
    const rule = hasHole(p) ? ' fill-rule="evenodd"' : "";
    lines.push(`<path${fill}${rule} d="${primitiveToPathData(p)}"/>`);
  }
  if (openLayer !== null) lines.push("</g>");
  lines.push("</g>", "</svg>");
  return lines.join("\n") + "\n";
}

// src/core/code/layout.ts
var FORMAT_MSB = CODE01.format.bits - 1;
var FORMAT_WORD_MAX = (1 << CODE01.format.bits) - 1;
var CELL_BYTE = (() => {
  const table = new Int16Array(CODE01_TOTAL_CELLS).fill(-1);
  for (let j = 0; j < CODE01_DATA_BITS; j++) table[CODE01_DATA_CELLS[j]] = j >> 3;
  return table;
})();
function requireCodeword(codeword) {
  if (!(codeword instanceof Uint8Array) || codeword.length !== CODE01.ecc.totalBytes) {
    throw new RangeError(`a CODE-01 codeword has ${CODE01.ecc.totalBytes} bytes`);
  }
}
function assertCellArray(cells) {
  if (cells === null || typeof cells !== "object" || cells.length !== CODE01_TOTAL_CELLS) {
    throw new RangeError(`a CODE-01 cell array has ${CODE01_TOTAL_CELLS} cells`);
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== 0 && cells[i] !== 1) throw new RangeError(`cell ${i} is ${cells[i]}, expected 0 or 1`);
  }
}
function placeCells(codeword, mask, formatWord) {
  requireCodeword(codeword);
  if (!Number.isInteger(formatWord) || formatWord < 0 || formatWord > FORMAT_WORD_MAX) {
    throw new RangeError(`format word ${formatWord} is not a ${CODE01.format.bits}-bit integer`);
  }
  const bits = maskBits(mask);
  const cells = new Uint8Array(CODE01_TOTAL_CELLS);
  CODE01_DATA_CELLS.forEach((flat, p) => {
    const bit = p < CODE01_DATA_BITS ? codeword[p >> 3] >> 7 - (p & 7) & 1 : 0;
    cells[flat] = bit ^ bits[p];
  });
  for (const copy of CODE01_FORMAT_CELLS) {
    copy.forEach((flat, b) => {
      cells[flat] = formatWord >> FORMAT_MSB - b & 1;
    });
  }
  return cells;
}
function readFormatWords(cells) {
  assertCellArray(cells);
  const [first, second] = CODE01_FORMAT_CELLS.map((copy) => copy.reduce((word, flat) => word << 1 | cells[flat], 0));
  return [first, second];
}
function decodeCellsToCodeword(cells, mask) {
  const formatWords = readFormatWords(cells);
  const bits = maskBits(mask);
  const codeword = new Uint8Array(CODE01.ecc.totalBytes);
  for (let j = 0; j < CODE01_DATA_BITS; j++) {
    codeword[j >> 3] |= (cells[CODE01_DATA_CELLS[j]] ^ bits[j]) << 7 - (j & 7);
  }
  return { codeword, formatWords };
}
function cyclicRuns(values) {
  const n = values.length;
  if (n === 0) return [];
  let first = -1;
  for (let c = 0; c < n && first < 0; c++) if (values[c] !== values[(c + n - 1) % n]) first = c;
  if (first < 0) return [{ start: 0, length: n, value: values[0] }];
  const runs = [];
  let start = first;
  for (let k = 1; k <= n; k++) {
    const c = (first + k) % n;
    if (k === n || values[c] !== values[start]) {
      runs.push({ start, length: (c - start + n) % n, value: values[start] });
      start = c;
    }
  }
  return runs;
}

// node_modules/@noble/hashes/_u64.js
var fromNumH = (n) => n / 2 ** 32 | 0;
var fromNumL = (n) => n >>> 0;
function setU64FromNum(view, byteOffset, n, isLE) {
  const h = fromNumH(n);
  const l = fromNumL(n);
  view.setUint32(byteOffset, isLE ? l : h, isLE);
  view.setUint32(byteOffset + 4, isLE ? h : l, isLE);
}

// node_modules/@noble/hashes/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle = (title) => title ? `"${title}" ` : "";
function anumber(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes(value, length, title = "") {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber(length, "length");
  const bytes = isBytes(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
var aobject = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
var aopts = (value, label) => {
  aobject(value, label);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError(`"${label}" expected plain object`);
  if (Object.hasOwn(value, "__proto__"))
    throw new TypeError(`"${label}.__proto__" is not allowed`);
};
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
function checkOpts(defaults, opts, title = "opts") {
  aopts(defaults, "defaults");
  if (opts !== void 0)
    aopts(opts, title);
  const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
  return merged;
}
function createHasher(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
var oidNist = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    let processed = false;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = true;
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
        processed = true;
      }
    }
    this.length += data.length;
    if (processed)
      this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    buffer.fill(0, pos);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      buffer.fill(0);
    }
    setU64FromNum(view, blockLen - 8, this.length * 8, isLE);
    this.process(view, 0);
    this.roundClean();
    const oview = out === buffer ? view : createView(out);
    const len = this.outputLen;
    const outLen = len / 4;
    const state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneIntoMeta(to) {
    const { buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (pos)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and makes sha256 3x slower (measured).
  A = 0;
  B = 0;
  C = 0;
  D = 0;
  E = 0;
  F = 0;
  G = 0;
  H = 0;
  constructor(outputLen, IV) {
    super(64, outputLen, 8, false);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  constructor() {
    super(32, SHA256_IV);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);

// src/core/genome/vocabulary.ts
var SYMMETRIC_FAMILY = "SYMMETRIC";
var STROKE = 0.26;
var ORBIT = 1 - STROKE / 2;
var POINT = 0.37;
var CORE = 0.42;
var SMALL_ORBIT = 0.5;
var ORB = 0.8;
function unitPrimitives(cx, cy, R) {
  const layer = "genome";
  return {
    disc: (r, at) => {
      const c = at ? polar(at.r * R, at.angle, cx, cy) : { x: cx, y: cy };
      return { kind: "disc", layer, cx: c.x, cy: c.y, r: r * R };
    },
    ring: (r, width) => ({ kind: "ring", layer, cx, cy, r: r * R, width: width * R }),
    arc: (r, width, start, end, cap) => ({ kind: "arc", layer, cx, cy, r: r * R, width: width * R, start, end, cap }),
    halfDisc: (r, angle) => ({ kind: "halfDisc", layer, cx, cy, r: r * R, angle }),
    crescent: (r, offset, angle) => ({ kind: "crescent", layer, cx, cy, r: r * R, offset: offset * R, angle })
  };
}
function glyph(id, name, family2, hint, shape) {
  return Object.freeze({ id, name, family: family2, hint, primitives: (cx, cy, R) => shape(unitPrimitives(cx, cy, R)) });
}
var orientations = (suffixes, firstDeg, stepDeg, hints) => suffixes.map((suffix, i) => ({ suffix, angle: deg(firstDeg + stepDeg * i), hint: hints[i] }));
var COMPASS = ["N", "E", "S", "W"];
var DIAGONALS = ["NE", "SE", "SW", "NW"];
var AXES = ["NS", "NESW", "EW", "NWSE"];
function family(name, label, members, shape) {
  return members.map((o) => glyph(`${name}_${o.suffix}`, `${label} ${o.suffix}`, name, o.hint, (u) => shape(u, o.angle)));
}
var GENOME_GLYPH_CANDIDATES = Object.freeze([
  glyph("FULL_ORBIT", "Full orbit", SYMMETRIC_FAMILY, "\u25CB", (u) => [u.ring(ORBIT, STROKE)]),
  glyph("RING_POINT", "Orbit with core", SYMMETRIC_FAMILY, "\u25C9", (u) => [u.ring(ORBIT, STROKE), u.disc(CORE)]),
  glyph("SMALL_ORBIT", "Small orbit", SYMMETRIC_FAMILY, "\u25E6", (u) => [u.ring(SMALL_ORBIT, STROKE)]),
  glyph("POINT", "Point", SYMMETRIC_FAMILY, "\u2022", (u) => [u.disc(POINT)]),
  glyph("ORB", "Orb", SYMMETRIC_FAMILY, "\u25CF", (u) => [u.disc(ORB)]),
  glyph("DOUBLE_ORBIT", "Double orbit", SYMMETRIC_FAMILY, "\u25CE", (u) => [u.ring(ORBIT, STROKE), u.ring(0.36, 0.24)]),
  glyph("HEAVY_ORBIT", "Heavy orbit", SYMMETRIC_FAMILY, "\u2B58", (u) => [u.ring(0.775, 0.45)]),
  // Half of the orbit, on the orientation side.
  ...family("HALF_ARC", "Half arc", orientations(COMPASS, 0, 90, ["\u25E0", ")", "\u25E1", "("]), (u, a) => [
    u.arc(ORBIT, STROKE, a - deg(90), a + deg(90), "round")
  ]),
  // Two opposite quarter orbits on the given axis.
  ...family(
    "ARC_PAIR",
    "Arc pair",
    orientations(AXES, 0, 45, ["\u2195", "\u2922", "\u2194", "\u2921"]),
    (u, a) => [0, Math.PI].map((side) => u.arc(ORBIT, STROKE, a + side - deg(45), a + side + deg(45), "round"))
  ),
  // Quarter of an orb, in the given diagonal quadrant.
  ...family("QUARTER_ORB", "Quarter orb", orientations(DIAGONALS, 45, 90, ["\u25DD", "\u25DE", "\u25DF", "\u25DC"]), (u, a) => [
    u.arc(0.5, 1, a - deg(45), a + deg(45), "butt")
  ]),
  // Orbit with the half facing the orientation filled.
  ...family("HALF_ORBIT", "Half orbit", orientations(COMPASS, 0, 90, ["\u25D3", "\u25D1", "\u25D2", "\u25D0"]), (u, a) => [
    u.ring(ORBIT, STROKE),
    u.halfDisc(ORBIT, a)
  ]),
  // Solid half orb.
  ...family("HALF_ORB", "Half orb", orientations(COMPASS, 0, 90, ["\u2BCA", "\u25D7", "\u2BCB", "\u25D6"]), (u, a) => [u.halfDisc(1, a)]),
  // Lit crescent bulging towards the orientation (the occluding disc sits opposite).
  ...family("ECLIPSE", "Eclipse", orientations(COMPASS, 0, 90, ["\u23DC", "\u263D", "\u23DD", "\u263E"]), (u, a) => [u.crescent(1, 0.62, a + Math.PI)]),
  // Orbit interrupted by a 90° gap facing the orientation.
  ...family("OPEN_ORBIT", "Open orbit", orientations(COMPASS, 0, 90, ["U", "\u2183", "\u2229", "C"]), (u, a) => [
    u.arc(ORBIT, STROKE, a + deg(45), a + deg(315), "round")
  ]),
  // Orbit with the quadrant facing the diagonal orientation filled.
  ...family("QUARTER_ORBIT", "Quarter orbit", orientations(DIAGONALS, 45, 90, ["\u25D4", "\u25F6", "\u25F5", "\u25F4"]), (u, a) => [
    u.ring(ORBIT, STROKE),
    u.arc(ORBIT / 2, ORBIT, a - deg(45), a + deg(45), "butt")
  ]),
  // Orbit carrying a planet on the orientation side.
  ...family("PLANET", "Planet", orientations(COMPASS, 0, 90, ["\u23C0", "\u29B6", "\u29B8", "\u29B7"]), (u, a) => [
    u.ring(ORBIT, STROKE),
    u.disc(0.32, { r: 1 - 0.32, angle: a })
  ])
]);
var GENOME01_ORDER = [
  "FULL_ORBIT",
  "RING_POINT",
  "SMALL_ORBIT",
  "POINT",
  "HALF_ARC_N",
  "HALF_ARC_E",
  "HALF_ARC_S",
  "HALF_ARC_W",
  "ARC_PAIR_NS",
  "ARC_PAIR_NESW",
  "ARC_PAIR_EW",
  "ARC_PAIR_NWSE",
  "QUARTER_ORB_NE",
  "QUARTER_ORB_SE",
  "QUARTER_ORB_SW",
  "QUARTER_ORB_NW"
];
var GENOME01_GLYPHS = Object.freeze(
  GENOME01_ORDER.map((id, index) => {
    const candidate = GENOME_GLYPH_CANDIDATES.find((c) => c.id === id);
    if (!candidate) throw new Error(`GENOME-01 glyph ${id} missing from the candidate pool`);
    return Object.freeze({ index, ...candidate });
  })
);

// src/core/genome/genome.ts
var SUPPORTED_GENOME_VERSIONS = Object.freeze([1]);
var GLYPH_COUNT = 8;
var GLYPH_BITS = 4;
var FEISTEL_ROUNDS = 8;
var ROUND_DOMAIN = Uint8Array.from("ORBES/GENOME-01/F", (c) => c.charCodeAt(0));
var roundInput = new Uint8Array(ROUND_DOMAIN.length + 3);
roundInput.set(ROUND_DOMAIN);
var roundMemo;
function roundFunction(round, half) {
  roundMemo ??= new Uint32Array(FEISTEL_ROUNDS << 16);
  const slot = round << 16 | half;
  let entry = roundMemo[slot];
  if (entry === 0) {
    const n = ROUND_DOMAIN.length;
    roundInput[n] = round;
    roundInput[n + 1] = half >>> 8;
    roundInput[n + 2] = half & 255;
    const digest = sha256(roundInput);
    entry = 65536 | digest[0] << 8 | digest[1];
    roundMemo[slot] = entry;
  }
  return entry & 65535;
}
function requireU32(x, what) {
  if (!(Number.isInteger(x) && x >= 0 && x <= 4294967295)) throw new RangeError(`${what} must be a u32 integer, got ${x}`);
}
function genomePermute(x) {
  requireU32(x, "genome input");
  let left = x >>> 16;
  let right = x & 65535;
  for (let i = 0; i < FEISTEL_ROUNDS; i++) {
    const next = (left ^ roundFunction(i, right)) & 65535;
    left = right;
    right = next;
  }
  return (left << 16 | right) >>> 0;
}
function genomeUnpermute(y) {
  requireU32(y, "genome value");
  let left = y >>> 16;
  let right = y & 65535;
  for (let i = FEISTEL_ROUNDS - 1; i >= 0; i--) {
    const previous = (right ^ roundFunction(i, left)) & 65535;
    right = left;
    left = previous;
  }
  return (left << 16 | right) >>> 0;
}
var SCHEMES = /* @__PURE__ */ new Map([
  [1, { permute: genomePermute, unpermute: genomeUnpermute, vocabulary: GENOME01_GLYPHS }]
]);
function scheme(version) {
  const s = SCHEMES.get(version);
  if (!s) throw new RangeError(`unsupported genome version ${version}`);
  return s;
}
function genomeVocabulary(version = 1) {
  return scheme(version).vocabulary;
}
var hex16 = (v) => v.toString(16).toUpperCase().padStart(4, "0");
function computeGenome(packedIdentity, version = 1) {
  const { permute, vocabulary } = scheme(version);
  requireU32(packedIdentity, "packed identity");
  const value = permute(packedIdentity);
  const glyphs = Array.from({ length: GLYPH_COUNT }, (_, i) => value >>> (GLYPH_COUNT - 1 - i) * GLYPH_BITS & 15);
  return {
    version,
    packedIdentity,
    value,
    glyphs,
    ids: glyphs.map((g) => vocabulary[g].id),
    fingerprint: `G${version}-${hex16(value >>> 16)}-${hex16(value & 65535)}`
  };
}

// src/core/genome/render.ts
function genomeGlyphPrimitives(glyph2, cx, cy, R, version = 1) {
  const vocabulary = genomeVocabulary(version);
  if (!(Number.isInteger(glyph2) && glyph2 >= 0 && glyph2 < vocabulary.length)) throw new RangeError(`invalid glyph index ${glyph2}`);
  if (!(Number.isFinite(R) && R > 0)) throw new RangeError(`glyph radius must be positive, got ${R}`);
  return vocabulary[glyph2].primitives(cx, cy, R);
}

// src/core/code/primitives.ts
var DECOR_HAIRLINES = [
  // Horizon: the outer edge of the orbital system, inside the quiet band.
  { r: 24, width: 0.08, tone: 0.35 },
  // Guides framing the data orbits, as close as the clearance allows.
  { r: 9.5, width: 0.06, tone: 0.25 },
  { r: 23.5, width: 0.06, tone: 0.25 }
];
var PAPER = 0;
var DATA = 1;
var FORMAT = 2;
var FORMAT_SET2 = new Set(CODE01_FORMAT_CELLS.flat());
function decorPrimitives() {
  return DECOR_HAIRLINES.map(({ r, width, tone }) => ({ kind: "ring", layer: "decor", cx: 0, cy: 0, r, width, tone }));
}
function sealPrimitives() {
  const { coreRadius, gapOuter, ringOuter } = CODE01.seal;
  return [
    { kind: "disc", layer: "seal", cx: 0, cy: 0, r: coreRadius },
    { kind: "ring", layer: "seal", cx: 0, cy: 0, r: (gapOuter + ringOuter) / 2, width: ringOuter - gapOuter }
  ];
}
function moonPrimitives() {
  const { radius, polarisIndex, haloRadius, haloWidth } = CODE01.moons;
  const polaris = CODE01_MOONS[polarisIndex];
  return [
    ...CODE01_MOONS.map((m) => ({ kind: "disc", layer: "moon", cx: m.x, cy: m.y, r: radius })),
    { kind: "ring", layer: "polaris", cx: polaris.x, cy: polaris.y, r: haloRadius, width: haloWidth }
  ];
}
function ringRunPrimitives(ring, keys, key, layer) {
  const width = CODE01.data.arcThickness;
  const step = TAU / ring.cells;
  return cyclicRuns(keys).filter((run) => run.value === key).map(
    (run) => run.length === ring.cells ? { kind: "ring", layer, cx: 0, cy: 0, r: ring.radius, width } : {
      kind: "arc",
      layer,
      cx: 0,
      cy: 0,
      r: ring.radius,
      width,
      // Exact cell boundaries; a run crossing north simply ends beyond 2π.
      start: run.start * step,
      end: (run.start + run.length) * step,
      cap: "round"
    }
  );
}
function cellPrimitives(cells) {
  const ringKeys = CODE01_RINGS.map(
    (ring) => Uint8Array.from({ length: ring.cells }, (_, c) => {
      const flat = ring.offset + c;
      if (cells[flat] === 0) return PAPER;
      return FORMAT_SET2.has(flat) ? FORMAT : DATA;
    })
  );
  return [
    ...CODE01_RINGS.flatMap((ring, k) => ringRunPrimitives(ring, ringKeys[k], FORMAT, "format")),
    ...CODE01_RINGS.flatMap((ring, k) => ringRunPrimitives(ring, ringKeys[k], DATA, "data"))
  ];
}
function genomePrimitives(glyphs) {
  return glyphs.flatMap((glyph2, i) => {
    const c = CODE01_GENOME_CENTERS[i];
    return genomeGlyphPrimitives(glyph2, c.x, c.y, CODE01.genome.glyphRadius);
  });
}
function orbesCodePrimitives(cells, genomeGlyphs, opts = {}) {
  assertCellArray(cells);
  if (!Array.isArray(genomeGlyphs) || genomeGlyphs.length !== CODE01.genome.count) {
    throw new RangeError(`a CODE-01 genome has ${CODE01.genome.count} glyphs`);
  }
  return [
    ...opts.decor === false ? [] : decorPrimitives(),
    ...sealPrimitives(),
    ...moonPrimitives(),
    ...cellPrimitives(cells),
    ...genomePrimitives(genomeGlyphs)
  ];
}

// src/core/code/encoder.ts
var ORBES_CODE_STYLES = {
  /** Black on white, the reference rendition. */
  classic: { ink: "#0A0A0A", paper: "#FFFFFF" },
  /** White on black; decoders must enable inverted reading. */
  inverted: { ink: "#FFFFFF", paper: "#0A0A0A" },
  /** Soft black on ivory, for paper goods and leather tags. */
  ivory: { ink: "#111111", paper: "#F6F2EA" }
};
var CODE_VERSION = 1;
var PARITY_BYTES = CODE01.ecc.totalBytes - CODE01.ecc.dataBytes;
var RUN_LIMIT = 9;
var SECTORS = 8;
var BANDS = 3;
var BALANCE_TOLERANCE = 0.15;
var BALANCE_WEIGHT = 40;
var PATCH_MIN_RUN = 7;
var PATCH_WEIGHT = 2;
var RING_BAND = CODE01_RINGS.map(
  (ring) => Math.floor(BANDS * (ring.offset + ring.cells / 2) / CODE01_TOTAL_CELLS)
);
function ringValues(cells, ring) {
  return cells.subarray(ring.offset, ring.offset + ring.cells);
}
function runPenalty(runs) {
  let cost = 0;
  for (const run of runs) if (run.length > RUN_LIMIT) cost += (run.length - RUN_LIMIT) ** 2;
  return cost;
}
function balancePenalty(cells) {
  const ink = new Array(SECTORS * BANDS).fill(0);
  const total = new Array(SECTORS * BANDS).fill(0);
  CODE01_RINGS.forEach((ring, k) => {
    for (let c = 0; c < ring.cells; c++) {
      const region = RING_BAND[k] * SECTORS + Math.floor((2 * c + 1) * SECTORS / (2 * ring.cells));
      ink[region] += cells[ring.offset + c];
      total[region]++;
    }
  });
  let cost = 0;
  for (let i = 0; i < ink.length; i++) {
    const excess = Math.abs(ink[i] / total[i] - 0.5) - BALANCE_TOLERANCE;
    if (excess > 0) cost += BALANCE_WEIGHT * excess;
  }
  return cost;
}
function runInterval(run, ring) {
  const step = TAU / ring.cells;
  return [run.start * step, (run.start + run.length) * step];
}
function circularOverlap([a0, a1], [b0, b1]) {
  let overlap = 0;
  for (const shift of [-TAU, 0, TAU]) overlap += Math.max(0, Math.min(a1, b1 + shift) - Math.max(a0, b0 + shift));
  return overlap;
}
function patchPenalty(ringRuns) {
  const longPaper = ringRuns.map(
    (runs, k) => runs.filter((r) => r.value === 0 && r.length >= PATCH_MIN_RUN).map((r) => runInterval(r, CODE01_RINGS[k]))
  );
  let cost = 0;
  for (let k = 0; k + 1 < CODE01_RINGS.length; k++) {
    const meanRadius = (CODE01_RINGS[k].radius + CODE01_RINGS[k + 1].radius) / 2;
    for (const inner of longPaper[k]) {
      for (const outer of longPaper[k + 1]) cost += PATCH_WEIGHT * meanRadius * circularOverlap(inner, outer);
    }
  }
  return cost;
}
function maskPenalty(cells) {
  if (!(cells instanceof Uint8Array)) throw new RangeError("cells must be a Uint8Array");
  assertCellArray(cells);
  const ringRuns = CODE01_RINGS.map((ring) => cyclicRuns(ringValues(cells, ring)));
  const runs = ringRuns.reduce((sum, r) => sum + runPenalty(r), 0);
  const balance = balancePenalty(cells);
  const patches = patchPenalty(ringRuns);
  return { runs, balance, patches, total: runs + balance + patches };
}
function requireInput(input) {
  if (input === null || typeof input !== "object") throw new RangeError("encode input must be an object");
  if (!(input.data instanceof Uint8Array) || input.data.length !== CODE01.ecc.dataBytes) {
    throw new RangeError(`CODE-01 data must be exactly ${CODE01.ecc.dataBytes} bytes`);
  }
  if (input.codeVersion !== void 0 && input.codeVersion !== CODE_VERSION) {
    throw new RangeError(`unsupported code version ${String(input.codeVersion)}`);
  }
  if (!Array.isArray(input.genomeGlyphs) || input.genomeGlyphs.length !== CODE01.genome.count) {
    throw new RangeError(`a CODE-01 genome has ${CODE01.genome.count} glyphs`);
  }
  const { mask } = input;
  if (mask !== void 0 && !(Number.isInteger(mask) && mask >= 0 && mask < CODE01_MASK_COUNT)) {
    throw new RangeError(`invalid mask ${String(mask)}`);
  }
}
function lowestPenalty(candidates) {
  let best = candidates[0];
  let bestPenalty = maskPenalty(best.cells).total;
  for (const candidate of candidates.slice(1)) {
    const penalty = maskPenalty(candidate.cells).total;
    if (penalty < bestPenalty) [best, bestPenalty] = [candidate, penalty];
  }
  return best;
}
function encodeOrbesCode(input, opts = {}) {
  requireInput(input);
  const codeword = rsEncode(input.data, PARITY_BYTES);
  const masks = input.mask === void 0 ? Array.from({ length: CODE01_MASK_COUNT }, (_, m) => m) : [input.mask];
  const layouts = masks.map((mask) => {
    const formatWord = bchFormatEncode(formatInfoValue(CODE_VERSION, mask));
    return { mask, formatWord, cells: placeCells(codeword, mask, formatWord) };
  });
  const chosen = layouts.length === 1 ? layouts[0] : lowestPenalty(layouts);
  const genomeGlyphs = [...input.genomeGlyphs];
  return {
    profile: "CODE-01",
    codeVersion: CODE_VERSION,
    mask: chosen.mask,
    formatWord: chosen.formatWord,
    codeword,
    cells: chosen.cells,
    genomeGlyphs,
    primitives: orbesCodePrimitives(chosen.cells, genomeGlyphs, opts)
  };
}
var HALF = CODE01_SIZE / 2;
function renderOrbesCodeSvg(model, style = {}) {
  return primitivesToSvg(
    model.primitives,
    { x: -HALF, y: -HALF, w: CODE01_SIZE, h: CODE01_SIZE },
    {
      ...style,
      ink: style.ink ?? ORBES_CODE_STYLES.classic.ink,
      paper: style.paper === void 0 ? ORBES_CODE_STYLES.classic.paper : style.paper,
      title: style.title ?? `ORBES ${CODE01.id}`
    }
  );
}

// src/core/decoder/image.ts
function asGrayImage(img) {
  if (img === null || typeof img !== "object") return null;
  const { width, height, data } = img;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || data.length < width * height) return null;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, width * height);
  return { width, height, data: bytes };
}
function invertImage(img) {
  const data = new Uint8Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = 255 - img.data[i];
  return { width: img.width, height: img.height, data };
}
function downscaleImage(img, factor) {
  const width = Math.max(1, Math.floor(img.width / factor));
  const height = Math.max(1, Math.floor(img.height / factor));
  const data = new Uint8Array(width * height);
  const area = factor * factor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * img.width + x * factor;
        for (let dx = 0; dx < factor; dx++) sum += img.data[row + dx];
      }
      data[y * width + x] = Math.round(sum / area);
    }
  }
  return { width, height, data };
}
function sampleBilinear(img, x, y) {
  const { width: w, height: h, data } = img;
  let fx = x - 0.5;
  let fy = y - 0.5;
  if (fx < 0) fx = 0;
  else if (fx > w - 1) fx = w - 1;
  if (fy < 0) fy = 0;
  else if (fy > h - 1) fy = h - 1;
  const x0 = fx | 0;
  const y0 = fy | 0;
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const ax = fx - x0;
  const ay = fy - y0;
  const r0 = y0 * w;
  const r1 = y1 * w;
  const top = data[r0 + x0] + (data[r0 + x1] - data[r0 + x0]) * ax;
  const bottom = data[r1 + x0] + (data[r1 + x1] - data[r1 + x0]) * ax;
  return top + (bottom - top) * ay;
}

// src/core/bytes.ts
var BYTE_TO_HEX = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0"));
var B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
var B64URL_VALUES = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64URL_ALPHABET.length; i++) table[B64URL_ALPHABET.charCodeAt(i)] = i;
  return table;
})();
function checkAccess(b, o, size) {
  if (!Number.isInteger(o) || o < 0 || o + size > b.length) {
    throw new RangeError(`${size}-byte access at offset ${o} is out of bounds (length ${b.length})`);
  }
}
function checkValue(v, max) {
  if (!Number.isInteger(v) || v < 0 || v > max) throw new RangeError(`value ${v} is not an integer in 0..${max}`);
}
function readU16BE(b, o) {
  checkAccess(b, o, 2);
  return b[o] << 8 | b[o + 1];
}
function readU32BE(b, o) {
  checkAccess(b, o, 4);
  return (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
}
function writeU16BE(b, o, v) {
  checkAccess(b, o, 2);
  checkValue(v, 65535);
  b[o] = v >>> 8;
  b[o + 1] = v & 255;
}
function writeU32BE(b, o, v) {
  checkAccess(b, o, 4);
  checkValue(v, 4294967295);
  b[o] = v >>> 24;
  b[o + 1] = v >>> 16 & 255;
  b[o + 2] = v >>> 8 & 255;
  b[o + 3] = v & 255;
}

// src/core/identity.ts
var IdentityError = class extends Error {
  name = "IdentityError";
};
var YEAR_BASE = 2e3;
var YEAR_MAX = 2099;
var CATEGORY_INDEX_MAX = 31;
var SERIAL_MAX = 999999;
var CATEGORY_SHIFT = 2 ** 20;
var YEAR_SHIFT = 2 ** 25;
var SERIAL_MASK = 1048575;
var CATEGORY_MASK = 31;
function isIntInRange(v, min, max) {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}
function assertValidIdentity(id) {
  if (id === null || typeof id !== "object") throw new IdentityError("identity must be an object");
  if (!isIntInRange(id.year, YEAR_BASE, YEAR_MAX)) throw new IdentityError(`year ${id.year} is outside ${YEAR_BASE}..${YEAR_MAX}`);
  if (!isIntInRange(id.categoryIndex, 1, CATEGORY_INDEX_MAX)) {
    throw new IdentityError(`category index ${id.categoryIndex} is outside 1..${CATEGORY_INDEX_MAX}`);
  }
  if (!isIntInRange(id.serial, 1, SERIAL_MAX)) throw new IdentityError(`serial ${id.serial} is outside 1..${SERIAL_MAX}`);
}
function packIdentity(id) {
  assertValidIdentity(id);
  return (id.year - YEAR_BASE) * YEAR_SHIFT + id.categoryIndex * CATEGORY_SHIFT + id.serial;
}
function unpackIdentity(packed) {
  if (!isIntInRange(packed, 0, 4294967295)) throw new IdentityError(`packed identity ${packed} is not a u32`);
  const id = {
    year: YEAR_BASE + Math.floor(packed / YEAR_SHIFT),
    categoryIndex: Math.floor(packed / CATEGORY_SHIFT) & CATEGORY_MASK,
    serial: packed & SERIAL_MASK
  };
  assertValidIdentity(id);
  return id;
}

// src/core/payload.ts
var PAYLOAD_V1_LENGTH = 13;
var SIGNATURE_LENGTH = 64;
var CODE_DATA_V1_LENGTH = 79;
var ISSUED_DAY_EPOCH_UTC = Date.UTC(2024, 0, 1);
var PayloadError = class extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
  }
  code;
  name = "PayloadError";
};
var CODE_VERSION2 = 1;
var GENOME_VERSION_MAX = 15;
var NONCE_LENGTH = 4;
var CRC_OFFSET = PAYLOAD_V1_LENGTH + SIGNATURE_LENGTH;
var ISSUED_DAY_MAX = 65535;
function isBytes2(v) {
  return v instanceof Uint8Array;
}
function isInt(v) {
  return typeof v === "number" && Number.isInteger(v);
}
function checkNonZeroField(name, v, max) {
  if (v === 0) throw new PayloadError("RESERVED", `${name} 0 is reserved`);
  if (!isInt(v) || v < 1 || v > max) throw new PayloadError("RANGE", `${name} ${String(v)} is outside 1..${max}`);
}
function checkLength(name, b, length) {
  if (!isBytes2(b) || b.length !== length) {
    const got = isBytes2(b) ? `${b.length} bytes` : "not a Uint8Array";
    throw new PayloadError("LENGTH", `${name} must be ${length} bytes (got ${got})`);
  }
}
function packIdentityOrThrow(identity) {
  try {
    return packIdentity(identity);
  } catch (e) {
    if (e instanceof IdentityError) throw new PayloadError("RANGE", `identity: ${e.message}`, { cause: e });
    throw e;
  }
}
function unpackIdentityOrThrow(packed) {
  try {
    return unpackIdentity(packed);
  } catch (e) {
    if (e instanceof IdentityError) throw new PayloadError("RANGE", `identity: ${e.message}`, { cause: e });
    throw e;
  }
}
function encodePayload(p) {
  if (p === null || typeof p !== "object") throw new PayloadError("RANGE", "payload must be an object");
  if (p.codeVersion !== CODE_VERSION2) throw new PayloadError("VERSION", `unsupported code version ${String(p.codeVersion)}`);
  checkNonZeroField("genome version", p.genomeVersion, GENOME_VERSION_MAX);
  checkNonZeroField("key id", p.keyId, 255);
  const packed = packIdentityOrThrow(p.identity);
  checkNonZeroField("issue", p.issue, 255);
  if (!isInt(p.issuedDay) || p.issuedDay < 0 || p.issuedDay > ISSUED_DAY_MAX) {
    throw new PayloadError("RANGE", `issued day ${String(p.issuedDay)} is outside 0..${ISSUED_DAY_MAX}`);
  }
  checkLength("nonce", p.nonce, NONCE_LENGTH);
  const out = new Uint8Array(PAYLOAD_V1_LENGTH);
  out[0] = CODE_VERSION2 << 4 | p.genomeVersion;
  out[1] = p.keyId;
  writeU32BE(out, 2, packed);
  out[6] = p.issue;
  writeU16BE(out, 7, p.issuedDay);
  out.set(p.nonce, 9);
  return out;
}
function decodePayload(b) {
  checkLength("payload", b, PAYLOAD_V1_LENGTH);
  const codeVersion = b[0] >>> 4;
  if (codeVersion !== CODE_VERSION2) throw new PayloadError("VERSION", `unsupported code version ${codeVersion}`);
  const genomeVersion = b[0] & 15;
  checkNonZeroField("genome version", genomeVersion, GENOME_VERSION_MAX);
  const keyId = b[1];
  checkNonZeroField("key id", keyId, 255);
  const identity = unpackIdentityOrThrow(readU32BE(b, 2));
  const issue = b[6];
  checkNonZeroField("issue", issue, 255);
  return {
    codeVersion: CODE_VERSION2,
    genomeVersion,
    keyId,
    identity,
    issue,
    issuedDay: readU16BE(b, 7),
    nonce: b.slice(9, 9 + NONCE_LENGTH)
  };
}
function frameCodeData(payloadBytes, signature) {
  checkLength("payload", payloadBytes, PAYLOAD_V1_LENGTH);
  checkLength("signature", signature, SIGNATURE_LENGTH);
  const out = new Uint8Array(CODE_DATA_V1_LENGTH);
  out.set(payloadBytes, 0);
  out.set(signature, PAYLOAD_V1_LENGTH);
  writeU16BE(out, CRC_OFFSET, crc16(out.subarray(0, CRC_OFFSET)));
  return out;
}
function unframeCodeData(data) {
  checkLength("code data", data, CODE_DATA_V1_LENGTH);
  if (crc16(data.subarray(0, CRC_OFFSET)) !== readU16BE(data, CRC_OFFSET)) {
    throw new PayloadError("CRC", "code data CRC-16 mismatch");
  }
  const payloadBytes = data.slice(0, PAYLOAD_V1_LENGTH);
  return {
    payloadBytes,
    signature: data.slice(PAYLOAD_V1_LENGTH, CRC_OFFSET),
    payload: decodePayload(payloadBytes)
  };
}

// src/core/decoder/binarize.ts
var RELATIVE_MARGIN = 0.1;
var MIN_MARGIN = 4;
function binarize(img, ii, windowPx, lightInk = false) {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(w * h);
  const half = Math.max(1, Math.floor(windowPx / 2));
  const s = w + 1;
  const { sums } = ii;
  const keep = 1 - RELATIVE_MARGIN;
  const xa = Math.min(w, half);
  const xb = Math.max(xa, w - half - 1);
  for (let y = 0; y < h; y++) {
    const y0 = y - half < 0 ? 0 : y - half;
    const y1 = y + half + 1 > h ? h : y + half + 1;
    const r0 = y0 * s;
    const r1 = y1 * s;
    const rows = y1 - y0;
    const base = y * w;
    const classify = (x, x0, x1) => {
      const sum = sums[r1 + x1] - sums[r0 + x1] - sums[r1 + x0] + sums[r0 + x0];
      const area2 = rows * (x1 - x0);
      const v = data[base + x] * area2;
      if (lightInk) {
        const room = 255 * area2 - sum;
        return v > sum + Math.max(RELATIVE_MARGIN * room, MIN_MARGIN * area2) ? 1 : 0;
      }
      return v < Math.min(keep * sum, sum - MIN_MARGIN * area2) ? 1 : 0;
    };
    for (let x = 0; x < xa; x++) out[base + x] = classify(x, 0, Math.min(w, x + half + 1));
    const area = rows * (2 * half + 1);
    const floor = MIN_MARGIN * area;
    if (lightInk) {
      const full = 255 * area;
      for (let x = xa; x < xb; x++) {
        const x0 = x - half;
        const x1 = x + half + 1;
        const sum = sums[r1 + x1] - sums[r0 + x1] - sums[r1 + x0] + sums[r0 + x0];
        const margin = RELATIVE_MARGIN * (full - sum);
        out[base + x] = data[base + x] * area > sum + (margin > floor ? margin : floor) ? 1 : 0;
      }
    } else {
      for (let x = xa; x < xb; x++) {
        const x0 = x - half;
        const x1 = x + half + 1;
        const sum = sums[r1 + x1] - sums[r0 + x1] - sums[r1 + x0] + sums[r0 + x0];
        const t = keep * sum;
        const u = sum - floor;
        out[base + x] = data[base + x] * area < (t < u ? t : u) ? 1 : 0;
      }
    }
    for (let x = xb; x < w; x++) out[base + x] = classify(x, Math.max(0, x - half), Math.min(w, x + half + 1));
  }
  return out;
}

// src/core/decoder/ellipse.ts
function cubicRoots(a, b, c) {
  const q = (a * a - 3 * b) / 9;
  const r = (2 * a * a * a - 9 * a * b + 27 * c) / 54;
  if (r * r < q * q * q) {
    const theta = Math.acos(Math.max(-1, Math.min(1, r / Math.sqrt(q * q * q))));
    const s = -2 * Math.sqrt(q);
    return [0, 1, -1].map((k) => s * Math.cos((theta + 2 * Math.PI * k) / 3) - a / 3);
  }
  const big = -Math.sign(r) * Math.cbrt(Math.abs(r) + Math.sqrt(r * r - q * q * q));
  const small = big === 0 ? 0 : q / big;
  return [big + small - a / 3];
}
function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    A / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    C / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det
  ];
}
function nullVector(m) {
  const rows = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
  let best = [0, 0, 0];
  let bestNorm = 0;
  for (const [i, j] of [
    [0, 1],
    [0, 2],
    [1, 2]
  ]) {
    const [p, q] = [rows[i], rows[j]];
    const v = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const n = Math.hypot(v[0], v[1], v[2]);
    if (n > bestNorm) {
      best = v;
      bestNorm = n;
    }
  }
  return best;
}
function fitEllipse(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 6) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let spread = 0;
  for (let i = 0; i < n; i++) spread += (xs[i] - mx) ** 2 + (ys[i] - my) ** 2;
  const scale2 = Math.sqrt(spread / (2 * n));
  if (!(scale2 > 1e-9)) return null;
  const s1 = new Array(9).fill(0);
  const s2 = new Array(9).fill(0);
  const s3 = new Array(9).fill(0);
  for (let i = 0; i < n; i++) {
    const x = (xs[i] - mx) / scale2;
    const y = (ys[i] - my) / scale2;
    const d1 = [x * x, x * y, y * y];
    const d2 = [x, y, 1];
    for (let r = 0; r < 3; r++) {
      for (let c2 = 0; c2 < 3; c2++) {
        s1[r * 3 + c2] += d1[r] * d1[c2];
        s2[r * 3 + c2] += d1[r] * d2[c2];
        s3[r * 3 + c2] += d2[r] * d2[c2];
      }
    }
  }
  const s3inv = invert3(s3);
  if (!s3inv) return null;
  const t = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c2 = 0; c2 < 3; c2++) {
      let acc = 0;
      for (let k2 = 0; k2 < 3; k2++) acc += s3inv[r * 3 + k2] * s2[c2 * 3 + k2];
      t[r * 3 + c2] = -acc;
    }
  }
  const m = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c2 = 0; c2 < 3; c2++) {
      let acc = s1[r * 3 + c2];
      for (let k2 = 0; k2 < 3; k2++) acc += s2[r * 3 + k2] * t[k2 * 3 + c2];
      m[r * 3 + c2] = acc;
    }
  }
  const reduced = [m[6] / 2, m[7] / 2, m[8] / 2, -m[3], -m[4], -m[5], m[0] / 2, m[1] / 2, m[2] / 2];
  const [a, b, c, d, e, f, g, h, k] = reduced;
  const trace = a + e + k;
  const minors = a * e - b * d + a * k - c * g + e * k - f * h;
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  let best = null;
  let bestCond = 0;
  for (const lambda of cubicRoots(-trace, minors, -det)) {
    const v = nullVector([a - lambda, b, c, d, e - lambda, f, g, h, k - lambda]);
    const cond = 4 * v[0] * v[2] - v[1] * v[1];
    if (cond > bestCond) {
      bestCond = cond;
      best = v;
    }
  }
  if (!best) return null;
  const lin = [0, 1, 2].map((r) => t[r * 3] * best[0] + t[r * 3 + 1] * best[1] + t[r * 3 + 2] * best[2]);
  return conicToEllipse(best[0], best[1], best[2], lin[0], lin[1], lin[2], mx, my, scale2);
}
function conicToEllipse(A, B, C, D, E, F, mx, my, scale2) {
  const det = 4 * A * C - B * B;
  if (!(Math.abs(det) > 1e-15)) return null;
  const x0 = (B * E - 2 * C * D) / det;
  const y0 = (B * D - 2 * A * E) / det;
  const fc = A * x0 * x0 + B * x0 * y0 + C * y0 * y0 + D * x0 + E * y0 + F;
  if (!(Math.abs(fc) > 1e-15)) return null;
  const m11 = A / -fc / (scale2 * scale2);
  const m12 = B / 2 / -fc / (scale2 * scale2);
  const m22 = C / -fc / (scale2 * scale2);
  if (!(m11 > 0 && m22 > 0 && m11 * m22 - m12 * m12 > 0)) return null;
  return { cx: x0 * scale2 + mx, cy: y0 * scale2 + my, m: [m11, m12, m22] };
}
function ellipseDistance(el, x, y) {
  const dx = x - el.cx;
  const dy = y - el.cy;
  const q = el.m[0] * dx * dx + 2 * el.m[1] * dx * dy + el.m[2] * dy * dy;
  const r = Math.hypot(dx, dy);
  if (q <= 0) return r;
  return Math.abs(r - r / Math.sqrt(q));
}
function fitEllipseRobust(xs, ys, minTolerance) {
  let px = xs;
  let py = ys;
  let el = fitEllipse(px, py);
  for (let round = 0; round < 2 && el; round++) {
    const fit2 = el;
    const dist = px.map((x, i) => ellipseDistance(fit2, x, py[i]));
    const sorted = [...dist].sort((p, q) => p - q);
    const tol = Math.max(minTolerance, 3 * sorted[sorted.length >> 1]);
    const keep = dist.map((d) => d <= tol);
    if (keep.every(Boolean)) break;
    px = px.filter((_, i) => keep[i]);
    py = py.filter((_, i) => keep[i]);
    el = fitEllipse(px, py);
  }
  if (!el) return null;
  const fit = el;
  const rms = Math.sqrt(px.reduce((s, x, i) => s + ellipseDistance(fit, x, py[i]) ** 2, 0) / px.length);
  return { ellipse: el, inliers: px.length, rms };
}

// src/core/decoder/finder.ts
var MIN_UNIT = 1.2;
var RING_RANGE = [0.35, 1.9];
var GAP_RANGE = [0.3, 1.8];
var CORE_RANGE = [2.8, 4.8];
var MIN_CORE_PX = Math.ceil(CORE_RANGE[0] * MIN_UNIT);
var MIN_QUIET = 0.4;
function inRange(v, unit, [lo, hi]) {
  return v >= lo * unit && v <= hi * unit;
}
function sealPattern(a, b, c, d, e) {
  const unit = (a + b + c + d + e) / 8;
  if (unit < MIN_UNIT) return 0;
  if (!inRange(c, unit, CORE_RANGE)) return 0;
  if (!inRange(a, unit, RING_RANGE) || !inRange(e, unit, RING_RANGE)) return 0;
  if (!inRange(b, unit, GAP_RANGE) || !inRange(d, unit, GAP_RANGE)) return 0;
  const slack = 0.8 * unit + 1;
  if (Math.abs(a - e) > slack || Math.abs(b - d) > slack) return 0;
  return unit;
}
function crossCheck(bin, w, h, x, y, dx, dy, maxRun) {
  if (x < 0 || y < 0 || x >= w || y >= h || bin[y * w + x] !== 1) return null;
  const runs = [];
  for (const sign of [-1, 1]) {
    const counts = [0, 0, 0, 0];
    let px = x;
    let py = y;
    let state = 0;
    while (state < 4) {
      if (px < 0 || py < 0 || px >= w || py >= h) break;
      const ink = bin[py * w + px] === 1;
      const expectInk = state === 0 || state === 2;
      if (ink !== expectInk) {
        state++;
        continue;
      }
      counts[state]++;
      if (counts[state] > maxRun) break;
      px += sign * dx;
      py += sign * dy;
    }
    if (state < 3) return null;
    runs.push(counts);
  }
  const [neg, pos] = runs;
  const step = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
  const core = neg[0] + pos[0] - 1;
  const unit = sealPattern(neg[2] * step, neg[1] * step, core * step, pos[1] * step, pos[2] * step);
  if (unit === 0) return null;
  if (Math.min(neg[3], pos[3]) * step < MIN_QUIET * unit) return null;
  return { unit, offset: (pos[0] - neg[0]) / 2 };
}
function confirm(bin, w, h, hit, axis) {
  const maxRun = Math.ceil(hit.unit * 8);
  const [px, py, ax, ay] = axis === "rows" ? [0, 1, 1, 0] : [1, 0, 0, 1];
  let cx = hit.x;
  let cy = hit.y;
  const units = [hit.unit];
  const perp = crossCheck(bin, w, h, Math.floor(cx), Math.floor(cy), px, py, maxRun);
  if (perp) {
    units.push(perp.unit);
    cx = Math.floor(cx) + 0.5 + px * perp.offset;
    cy = Math.floor(cy) + 0.5 + py * perp.offset;
    const along = crossCheck(bin, w, h, Math.floor(cx), Math.floor(cy), ax, ay, maxRun);
    if (along) {
      cx = Math.floor(cx) + 0.5 + ax * along.offset;
      cy = Math.floor(cy) + 0.5 + ay * along.offset;
    }
  }
  for (const [dx, dy] of [
    [1, 1],
    [1, -1]
  ]) {
    const diag = crossCheck(bin, w, h, Math.floor(cx), Math.floor(cy), dx, dy, maxRun);
    if (diag) units.push(diag.unit);
  }
  if (units.length < 2) return null;
  const lo = Math.min(...units);
  const hi = Math.max(...units);
  if (hi > 1.8 * lo) return null;
  return { x: cx, y: cy, unit: units.reduce((s, u) => s + u, 0) / units.length };
}
var CLUSTER_CELL = 64;
var MAX_SCAN_CLUSTERS = 512;
var ClusterIndex = class {
  all = [];
  grid = /* @__PURE__ */ new Map();
  add(hit) {
    const gx = Math.floor(hit.x / CLUSTER_CELL);
    const gy = Math.floor(hit.y / CLUSTER_CELL);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const c of this.grid.get(this.key(gx + dx, gy + dy)) ?? []) {
          if (Math.hypot(c.x - hit.x, c.y - hit.y) < 2 * Math.max(c.unit, hit.unit) && Math.abs(c.unit - hit.unit) < 0.5 * c.unit) {
            const k = c.count;
            c.x = (c.x * k + hit.x) / (k + 1);
            c.y = (c.y * k + hit.y) / (k + 1);
            c.unit = (c.unit * k + hit.unit) / (k + 1);
            c.count = k + 1;
            return;
          }
        }
      }
    }
    if (this.all.length >= MAX_SCAN_CLUSTERS) return;
    const cluster = { x: hit.x, y: hit.y, unit: hit.unit, count: 1 };
    this.all.push(cluster);
    const key = this.key(gx, gy);
    const bucket = this.grid.get(key);
    if (bucket) bucket.push(cluster);
    else this.grid.set(key, [cluster]);
  }
  key(gx, gy) {
    return gy * 65536 + gx;
  }
};
function findSealHits(bin, w, h, axis = "rows") {
  const clusters = new ClusterIndex();
  const [lines, length, lineStride, step] = axis === "rows" ? [h, w, w, 1] : [w, h, 1, w];
  const runs = new Int32Array(length + 2);
  for (let line = 0; line < lines; line++) {
    let n = 0;
    let len = 0;
    let ink = 0;
    for (let k = 0, idx = line * lineStride; k < length; k++, idx += step) {
      const v = bin[idx];
      if (v !== ink) {
        runs[n++] = len;
        len = 0;
        ink = v;
      }
      len++;
    }
    runs[n++] = len;
    let start = runs[0];
    for (let i = 1; i + 5 < n; i += 2) {
      const unit = runs[i + 2] >= MIN_CORE_PX ? sealPattern(runs[i], runs[i + 1], runs[i + 2], runs[i + 3], runs[i + 4]) : 0;
      if (unit > 0 && runs[i - 1] >= MIN_QUIET * unit && runs[i + 5] >= MIN_QUIET * unit) {
        const core = start + runs[i] + runs[i + 1] + runs[i + 2] / 2;
        const seed = axis === "rows" ? { x: core, y: line + 0.5, unit } : { x: line + 0.5, y: core, unit };
        const hit = confirm(bin, w, h, seed, axis);
        if (hit) clusters.add(hit);
      }
      start += runs[i] + runs[i + 1];
    }
  }
  return clusters.all;
}
var MERGE_TOP = 64;
function mergeClusters(lists) {
  const merged = [];
  for (const list of lists) {
    for (const c of [...list].sort((a, b) => b.count - a.count).slice(0, MERGE_TOP)) {
      const same = merged.find((m) => Math.hypot(m.x - c.x, m.y - c.y) < 2 * Math.max(m.unit, c.unit));
      if (!same) {
        merged.push({ ...c });
        continue;
      }
      const k = same.count + c.count;
      same.x = (same.x * same.count + c.x * c.count) / k;
      same.y = (same.y * same.count + c.y * c.count) / k;
      same.unit = (same.unit * same.count + c.unit * c.count) / k;
      same.count = k;
    }
  }
  return merged.sort((a, b) => b.count - a.count);
}
var RAY_COUNT = 48;
function measureSeal(img, cluster) {
  const first = measureAt(img, cluster.x, cluster.y, cluster.unit, cluster.count);
  if (first && Math.hypot(first.center.x - cluster.x, first.center.y - cluster.y) > 0.3 * cluster.unit) {
    return measureAt(img, first.center.x, first.center.y, first.unit, cluster.count) ?? first;
  }
  return first;
}
function measureAt(img, cx, cy, unit, hits) {
  const reach = 6.5 * unit;
  if (cx - reach < -unit || cy - reach < -unit || cx + reach > img.width + unit || cy + reach > img.height + unit) return null;
  const step = Math.min(0.5, unit / 6);
  const samples = Math.ceil(reach / step);
  let ink = sampleBilinear(img, cx, cy);
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    ink += sampleBilinear(img, cx + 0.9 * unit * Math.cos(a), cy + 0.9 * unit * Math.sin(a));
  }
  ink /= 9;
  const profiles = [];
  const peaks = [];
  for (let k = 0; k < RAY_COUNT; k++) {
    const a = k * Math.PI * 2 / RAY_COUNT;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const raw = new Float64Array(samples + 1);
    for (let i = 0; i <= samples; i++) raw[i] = sampleBilinear(img, cx + i * step * ca, cy + i * step * sa);
    const p = new Float64Array(samples + 1);
    for (let i = 0; i <= samples; i++) p[i] = (raw[Math.max(0, i - 1)] + 2 * raw[i] + raw[Math.min(samples, i + 1)]) / 4;
    profiles.push(p);
    let peak = -Infinity;
    for (let i = Math.floor(3.8 * unit / step); i <= samples; i++) peak = Math.max(peak, p[i]);
    peaks.push(peak);
  }
  const paper = [...peaks].sort((p, q2) => p - q2)[peaks.length >> 1];
  if (!(paper - ink > 12)) return null;
  const threshold = (ink + paper) / 2;
  const ring = [[], []];
  const core = [[], []];
  for (let k = 0; k < RAY_COUNT; k++) {
    const p = profiles[k];
    const a = k * Math.PI * 2 / RAY_COUNT;
    const edges = rayEdges(p, threshold, Math.floor(0.8 * unit / step));
    if (!edges) continue;
    const [e2, e3, e4] = edges.map((i) => i * step);
    if (e4 < 2.4 * unit || e4 > 6 * unit) continue;
    if (e2 / e4 < 0.38 || e2 / e4 > 0.6 || e3 / e4 < 0.64 || e3 / e4 > 0.82) continue;
    const mid = (e3 + e4) / 2;
    ring[0].push(cx + mid * Math.cos(a));
    ring[1].push(cy + mid * Math.sin(a));
    core[0].push(cx + e2 * Math.cos(a));
    core[1].push(cy + e2 * Math.sin(a));
  }
  if (ring[0].length < RAY_COUNT * 0.6) return null;
  const ringFit = fitEllipseRobust(ring[0], ring[1], Math.max(0.5, 0.15 * unit));
  if (!ringFit || ringFit.inliers < RAY_COUNT * 0.5) return null;
  const coreFit = fitEllipseRobust(core[0], core[1], Math.max(0.5, 0.15 * unit));
  const fits = [[ringFit.ellipse, ringFit.inliers * 3.5 * 3.5]];
  if (coreFit && coreFit.inliers >= RAY_COUNT * 0.5) fits.push([coreFit.ellipse, coreFit.inliers * 2 * 2 * 0.5]);
  let wsum = 0;
  let ex = 0;
  let ey = 0;
  for (const [el, wgt] of fits) {
    ex += el.cx * wgt;
    ey += el.cy * wgt;
    wsum += wgt;
  }
  ex /= wsum;
  ey /= wsum;
  const R = 3.5;
  const q = ringFit.ellipse.m.map((v) => v * R * R);
  const affine = inverseSqrtSym(q);
  if (!affine) return null;
  const det = affine[0] * affine[3] - affine[1] * affine[2];
  const sealUnit = Math.sqrt(Math.abs(det));
  const [l1, l2] = symEigenvalues(q);
  if (!(Math.sqrt(Math.min(l1, l2) / Math.max(l1, l2)) > 0.3)) return null;
  if (sealUnit < MIN_UNIT * 0.8) return null;
  const support = ringFit.inliers / RAY_COUNT;
  const score = support * (1 / (1 + ringFit.rms / sealUnit)) * Math.log2(2 + hits) * ((paper - ink) / 255 + 0.2);
  return { center: { x: ex, y: ey }, affine, unit: sealUnit, ink, paper, score };
}
function rayEdges(p, t, start) {
  const out = [];
  let wantUp = true;
  for (let i = Math.max(1, start); i < p.length && out.length < 3; i++) {
    const a = p[i - 1];
    const b = p[i];
    if (wantUp ? a < t && b >= t : a >= t && b < t) {
      out.push(i - 1 + (t - a) / (b - a));
      wantUp = !wantUp;
    }
  }
  return out.length === 3 ? [out[0], out[1], out[2]] : null;
}
function symEigenvalues([a, b, c]) {
  const mean = (a + c) / 2;
  const d = Math.sqrt(((a - c) / 2) ** 2 + b * b);
  return [mean + d, mean - d];
}
function inverseSqrtSym(q) {
  const [a, b, c] = q;
  const [l1, l2] = symEigenvalues(q);
  if (!(l2 > 0)) return null;
  let vx;
  let vy;
  if (Math.abs(b) > 1e-12) {
    vx = l1 - c;
    vy = b;
  } else if (a >= c) {
    vx = 1;
    vy = 0;
  } else {
    vx = 0;
    vy = 1;
  }
  const n = Math.hypot(vx, vy);
  vx /= n;
  vy /= n;
  const s1 = 1 / Math.sqrt(l1);
  const s2 = 1 / Math.sqrt(l2);
  const m11 = s1 * vx * vx + s2 * vy * vy;
  const m12 = (s1 - s2) * vx * vy;
  const m22 = s1 * vy * vy + s2 * vx * vx;
  return [m11, m12, m12, m22];
}

// src/core/decoder/genome-reader.ts
var GRID = 14;
var HALF_EXTENT = CODE01.genome.glyphRadius * 1.1;
var SUPER = 4;
var MIN_CORRELATION = 0.45;
var MIN_MARGIN2 = 0.06;
function inSpan(a, start, end) {
  const t = 2 * Math.PI;
  const rel = ((a - start) % t + t) % t;
  return rel <= end - start;
}
function primitiveCovers(p, x, y) {
  const dx = x - p.cx;
  const dy = y - p.cy;
  const d = Math.hypot(dx, dy);
  switch (p.kind) {
    case "disc":
      return d <= p.r;
    case "ring":
      return Math.abs(d - p.r) <= p.width / 2;
    case "halfDisc":
      return d <= p.r && dx * Math.sin(p.angle) - dy * Math.cos(p.angle) >= 0;
    case "crescent": {
      const ox = p.cx + p.offset * Math.sin(p.angle);
      const oy = p.cy - p.offset * Math.cos(p.angle);
      return d <= p.r && Math.hypot(x - ox, y - oy) > p.r;
    }
    case "arc": {
      const half = p.width / 2;
      if (p.cap === "butt") return Math.abs(d - p.r) <= half && inSpan(angleOf(dx, dy), p.start, p.end);
      const inset = Math.asin(Math.min(1, half / p.r));
      const a = p.start + inset;
      const b = p.end - inset;
      if (b <= a) {
        const mid = (p.start + p.end) / 2;
        return Math.hypot(x - (p.cx + p.r * Math.sin(mid)), y - (p.cy - p.r * Math.cos(mid))) <= p.r * Math.sin((p.end - p.start) / 2);
      }
      if (Math.abs(d - p.r) <= half && inSpan(angleOf(dx, dy), a, b)) return true;
      for (const e of [a, b]) {
        if (Math.hypot(x - (p.cx + p.r * Math.sin(e)), y - (p.cy - p.r * Math.cos(e))) <= half) return true;
      }
      return false;
    }
  }
}
function gridOffset(k) {
  return -HALF_EXTENT + (k + 0.5) * 2 * HALF_EXTENT / GRID;
}
function normalise(v) {
  let mean = 0;
  for (const x of v) mean += x;
  mean /= v.length;
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    v[i] -= mean;
    norm += v[i] * v[i];
  }
  if (!(norm > 1e-9)) return null;
  const s = 1 / Math.sqrt(norm);
  for (let i = 0; i < v.length; i++) v[i] *= s;
  return v;
}
var templates = null;
function glyphTemplates() {
  if (templates) return templates;
  const R = CODE01.genome.glyphRadius;
  templates = GENOME01_GLYPHS.map((g) => {
    const prims = genomeGlyphPrimitives(g.index, 0, 0, R);
    const t = new Float64Array(GRID * GRID);
    const cell = 2 * HALF_EXTENT / GRID;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        let hits = 0;
        for (let sj = 0; sj < SUPER; sj++) {
          for (let si = 0; si < SUPER; si++) {
            const x = gridOffset(i) + ((si + 0.5) / SUPER - 0.5) * cell;
            const y = gridOffset(j) + ((sj + 0.5) / SUPER - 0.5) * cell;
            if (prims.some((p) => primitiveCovers(p, x, y))) hits++;
          }
        }
        t[j * GRID + i] = hits / (SUPER * SUPER);
      }
    }
    return normalise(t);
  });
  return templates;
}
function readGenome(img, h) {
  const tpl = glyphTemplates();
  const glyphs = [];
  const confidence = [];
  const patch = new Float64Array(GRID * GRID);
  for (const c of CODE01_GENOME_CENTERS) {
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const x = c.x + gridOffset(i);
        const y = c.y + gridOffset(j);
        const w = h[6] * x + h[7] * y + h[8];
        patch[j * GRID + i] = 255 - sampleBilinear(img, (h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w);
      }
    }
    const v = normalise(patch);
    let best = -1;
    let bestScore = -Infinity;
    let second = -Infinity;
    if (v) {
      tpl.forEach((t, g) => {
        if (!t) return;
        let s = 0;
        for (let k = 0; k < t.length; k++) s += t[k] * v[k];
        if (s > bestScore) {
          second = bestScore;
          bestScore = s;
          best = g;
        } else if (s > second) {
          second = s;
        }
      });
    }
    const margin = bestScore - second;
    const ok = best >= 0 && bestScore >= MIN_CORRELATION && margin >= MIN_MARGIN2;
    glyphs.push(ok ? best : null);
    confidence.push(ok ? Math.max(0, Math.min(1, bestScore * Math.min(1, margin / 0.3))) : 0);
  }
  return { glyphs, confidence };
}

// src/core/decoder/homography.ts
function solveLinear(a, b, n) {
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(a[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(a[r * n + col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (!(best > 1e-12)) return null;
    if (pivot !== col) {
      for (let c = 0; c < n; c++) {
        const tmp = a[col * n + c];
        a[col * n + c] = a[pivot * n + c];
        a[pivot * n + c] = tmp;
      }
      const tb = b[col];
      b[col] = b[pivot];
      b[pivot] = tb;
    }
    const diag = a[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = a[r * n + col] / diag;
      if (f === 0) continue;
      for (let c = col; c < n; c++) a[r * n + c] -= f * a[col * n + c];
      b[r] -= f * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let acc = b[r];
    for (let c = r + 1; c < n; c++) acc -= a[r * n + c] * x[c];
    x[r] = acc / a[r * n + r];
  }
  return x;
}
function normalizer(points) {
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= points.length;
  my /= points.length;
  let d = 0;
  for (const p of points) d += (p.x - mx) ** 2 + (p.y - my) ** 2;
  const rms = Math.sqrt(d / points.length);
  if (!(rms > 1e-12)) return null;
  const s = Math.SQRT2 / rms;
  return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
}
function multiplyH(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}
function invertH(h) {
  const [a, b, c, d, e, f, g, k, i] = h;
  const A = e * i - f * k;
  const B = f * g - d * i;
  const C = d * k - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) return null;
  return normalizeH([
    A / det,
    (c * k - b * i) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    C / det,
    (b * g - a * k) / det,
    (a * e - b * d) / det
  ]);
}
function normalizeH(h) {
  if (!(Math.abs(h[8]) > 1e-15)) return null;
  const s = 1 / h[8];
  const out = h.map((v) => v * s);
  return out.every(Number.isFinite) ? out : null;
}
function applyH(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}
function homographyFromPoints(src, dst) {
  const n = Math.min(src.length, dst.length);
  if (n < 4) return null;
  const ns = normalizer(src.slice(0, n));
  const nd = normalizer(dst.slice(0, n));
  if (!ns || !nd) return null;
  const ata = new Float64Array(64);
  const atb = new Float64Array(8);
  const row = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    const p = applyH(ns, src[i].x, src[i].y);
    const q = applyH(nd, dst[i].x, dst[i].y);
    for (let eq = 0; eq < 2; eq++) {
      row.fill(0);
      let rhs;
      if (eq === 0) {
        row[0] = p.x;
        row[1] = p.y;
        row[2] = 1;
        row[6] = -p.x * q.x;
        row[7] = -p.y * q.x;
        rhs = q.x;
      } else {
        row[3] = p.x;
        row[4] = p.y;
        row[5] = 1;
        row[6] = -p.x * q.y;
        row[7] = -p.y * q.y;
        rhs = q.y;
      }
      for (let r = 0; r < 8; r++) {
        if (row[r] === 0) continue;
        atb[r] += row[r] * rhs;
        for (let c = 0; c < 8; c++) ata[r * 8 + c] += row[r] * row[c];
      }
    }
  }
  const x = solveLinear(ata, atb, 8);
  if (!x) return null;
  const hn = [x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], 1];
  const ndInv = invertH(nd);
  if (!ndInv) return null;
  return normalizeH(multiplyH(ndInv, multiplyH(hn, ns)));
}
function jacobianH(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  const X = (h[0] * x + h[1] * y + h[2]) / w;
  const Y = (h[3] * x + h[4] * y + h[5]) / w;
  return [(h[0] - h[6] * X) / w, (h[1] - h[7] * X) / w, (h[3] - h[6] * Y) / w, (h[4] - h[7] * Y) / w];
}

// src/core/decoder/integral.ts
var MAX_INTEGRAL_PIXELS = Math.floor((2 ** 31 - 1) / 255);
function integralImage(img) {
  const { width: w, height: h, data } = img;
  if (w * h > MAX_INTEGRAL_PIXELS) throw new RangeError(`image too large for a 32-bit summed-area table: ${w}\xD7${h}`);
  const stride = w + 1;
  const sums = new Int32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    const src = y * w;
    const above = y * stride;
    const out = above + stride;
    for (let x = 0; x < w; x++) {
      row += data[src + x];
      sums[out + x + 1] = sums[above + x + 1] + row;
    }
  }
  return { width: w, height: h, sums };
}
function boxMean(ii, x0, y0, x1, y1) {
  const ax = x0 < 0 ? 0 : x0 > ii.width ? ii.width : x0 | 0;
  const bx = x1 < 0 ? 0 : x1 > ii.width ? ii.width : x1 | 0;
  const ay = y0 < 0 ? 0 : y0 > ii.height ? ii.height : y0 | 0;
  const by = y1 < 0 ? 0 : y1 > ii.height ? ii.height : y1 | 0;
  const area = (bx - ax) * (by - ay);
  if (area <= 0) return Number.NaN;
  const s = ii.width + 1;
  const { sums } = ii;
  return (sums[by * s + bx] - sums[ay * s + bx] - sums[by * s + ax] + sums[ay * s + ax]) / area;
}

// src/core/decoder/components.ts
function find(parent, i) {
  let r = i;
  while (parent[r] !== r) r = parent[r];
  while (parent[i] !== r) {
    const next = parent[i];
    parent[i] = r;
    i = next;
  }
  return r;
}
function inkBlobs(bin, w, h, minArea, maxArea, maxLabels = 5e4) {
  const labels = new Int32Array(w * h);
  const parent = new Int32Array(maxLabels + 1);
  let next = 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (bin[i] !== 1) continue;
      const left = x > 0 ? labels[i - 1] : 0;
      const up = y > 0 ? labels[i - w] : 0;
      if (left === 0 && up === 0) {
        if (next > maxLabels) return [];
        parent[next] = next;
        labels[i] = next++;
      } else if (left !== 0 && up !== 0) {
        const a = find(parent, left);
        const b = find(parent, up);
        labels[i] = a < b ? a : b;
        if (a !== b) parent[a < b ? b : a] = a < b ? a : b;
      } else {
        labels[i] = left !== 0 ? left : up;
      }
    }
  }
  const n = next;
  const root = new Int32Array(n);
  for (let l = 1; l < n; l++) root[l] = find(parent, l);
  const area = new Float64Array(n);
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const sxx = new Float64Array(n);
  const syy = new Float64Array(n);
  const sxy = new Float64Array(n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const py = y + 0.5;
    for (let x = 0; x < w; x++) {
      const l = labels[row + x];
      if (l === 0) continue;
      const r = root[l];
      const px = x + 0.5;
      area[r]++;
      sx[r] += px;
      sy[r] += py;
      sxx[r] += px * px;
      syy[r] += py * py;
      sxy[r] += px * py;
    }
  }
  const blobs = [];
  for (let r = 1; r < n; r++) {
    const A = area[r];
    if (A < minArea || A > maxArea) continue;
    const mx = sx[r] / A;
    const my = sy[r] / A;
    const cxx = sxx[r] / A - mx * mx + 1 / 12;
    const cyy = syy[r] / A - my * my + 1 / 12;
    const cxy = sxy[r] / A - mx * my;
    const mean = (cxx + cyy) / 2;
    const d = Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy * cxy);
    const a = 2 * Math.sqrt(Math.max(0, mean + d));
    const b = 2 * Math.sqrt(Math.max(0, mean - d));
    if (!(b > 0)) continue;
    blobs.push({ x: mx, y: my, area: A, a, b, fill: A / (Math.PI * a * b), theta: 0.5 * Math.atan2(2 * cxy, cxx - cyy) });
  }
  return blobs;
}

// src/core/decoder/moons.ts
var ORBIT2 = CODE01.moons.orbitRadius;
var MOON_R = CODE01.moons.radius;
var BAND = [ORBIT2 * 0.72, ORBIT2 * 1.45];
var MIN_RESPONSE = 0.22;
var MAX_PEAKS = 24;
var MAX_DIAGONAL_OFFSET = 1.5;
var ANGLE_TOLERANCE = 40 * Math.PI / 180;
var CENTROID_WINDOW = 2.15;
function invert2([a, b, c, d]) {
  const det = a * d - b * c;
  if (!(Math.abs(det) > 1e-12)) return null;
  return [d / det, -b / det, -c / det, a / det];
}
function singularValues([a, b, c, d]) {
  const s1 = a * a + b * b + c * c + d * d;
  const det = Math.abs(a * d - b * c);
  const big = Math.sqrt(Math.max(0, s1 / 2 + Math.sqrt(Math.max(0, s1 * s1 / 4 - det * det))));
  return [big, big > 0 ? det / big : 0];
}
function ringMean(img, affine, p, r, count) {
  let sum = 0;
  for (let k = 0; k < count; k++) {
    const a = k * 2 * Math.PI / count;
    const u = r * Math.sin(a);
    const v = -r * Math.cos(a);
    sum += sampleBilinear(img, p.x + affine[0] * u + affine[1] * v, p.y + affine[2] * u + affine[3] * v);
  }
  return sum / count;
}
function refineCentroid(img, affine, p, ink, paper) {
  const inv = invert2(affine);
  if (!inv || !(paper - ink > 1)) return p;
  const [s1] = singularValues(affine);
  const half = Math.ceil(CENTROID_WINDOW * s1) + 1;
  const span = paper - ink;
  const r2max = CENTROID_WINDOW * CENTROID_WINDOW;
  let cur = p;
  for (let pass = 0; pass < 2; pass++) {
    let sw = 0;
    let sx = 0;
    let sy = 0;
    const x0 = Math.max(0, Math.floor(cur.x - half));
    const x1 = Math.min(img.width - 1, Math.ceil(cur.x + half));
    const y0 = Math.max(0, Math.floor(cur.y - half));
    const y1 = Math.min(img.height - 1, Math.ceil(cur.y + half));
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      const dy = py - cur.y;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const dx = px - cur.x;
        const u = inv[0] * dx + inv[1] * dy;
        const v = inv[2] * dx + inv[3] * dy;
        if (u * u + v * v > r2max) continue;
        let wgt = (paper - img.data[y * img.width + x]) / span;
        if (wgt <= 0) continue;
        if (wgt > 1) wgt = 1;
        sw += wgt;
        sx += wgt * px;
        sy += wgt * py;
      }
    }
    if (!(sw > 0)) return cur;
    cur = { x: sx / sw, y: sy / sw };
  }
  return cur;
}
function moonLevels(img, affine, p) {
  return { ink: (2 * ringMean(img, affine, p, 0.5, 8) + sampleBilinear(img, p.x, p.y)) / 3, paper: ringMean(img, affine, p, 3.4, 16) };
}
function haloDarkness(img, affine, p) {
  const { ink, paper } = moonLevels(img, affine, p);
  if (!(paper - ink > 1)) return 0;
  return (paper - ringMean(img, affine, p, CODE01.moons.haloRadius, 24)) / (paper - ink);
}
function discShape(img, affine, c, mid) {
  const RAYS = 16;
  const STEP = 0.1;
  const LIMIT = 2 * MOON_R;
  const radii = [];
  const dirs = [];
  for (let k = 0; k < RAYS; k++) {
    const a = k * 2 * Math.PI / RAYS;
    const ux = Math.sin(a);
    const uy = -Math.cos(a);
    const dx = affine[0] * ux + affine[1] * uy;
    const dy = affine[2] * ux + affine[3] * uy;
    dirs.push([dx, dy]);
    let prev = sampleBilinear(img, c.x, c.y);
    let edge = LIMIT;
    for (let t = STEP; t <= LIMIT; t += STEP) {
      const v = sampleBilinear(img, c.x + t * dx, c.y + t * dy);
      if (v > mid) {
        edge = t - STEP + STEP * (mid - prev) / Math.max(1e-6, v - prev);
        break;
      }
      prev = v;
    }
    radii.push(edge);
  }
  const mean = radii.reduce((s, r) => s + r, 0) / RAYS;
  const sd = Math.sqrt(radii.reduce((s, r) => s + (r - mean) ** 2, 0) / RAYS);
  const cv = sd / mean;
  if (mean < 0.55 * MOON_R || mean > 1.7 * MOON_R || cv > 0.3) return null;
  let light = 0;
  for (const [dx, dy] of dirs) if (sampleBilinear(img, c.x + 1.3 * mean * dx, c.y + 1.3 * mean * dy) > mid) light++;
  const isolation = light / RAYS;
  if (isolation < 0.6) return null;
  return { quality: (1 - cv) * isolation, radius: mean };
}
function moonPeaks(img, ii, seal) {
  const affine = seal.affine;
  const inv = invert2(affine);
  if (!inv) return [];
  const [sMax, sMin] = singularValues(affine);
  const inner = Math.max(1, sMin * MOON_R * 0.6);
  const outer = Math.max(inner + 1.5, sMax * MOON_R * 1.4);
  const grid = Math.max(1, sMin * 0.4);
  const reach = BAND[1] * sMax;
  const gx0 = Math.max(outer, seal.center.x - reach);
  const gy0 = Math.max(outer, seal.center.y - reach);
  const gx1 = Math.min(img.width - outer, seal.center.x + reach);
  const gy1 = Math.min(img.height - outer, seal.center.y + reach);
  if (!(gx1 > gx0 && gy1 > gy0)) return [];
  const nx = Math.floor((gx1 - gx0) / grid) + 1;
  const ny = Math.floor((gy1 - gy0) / grid) + 1;
  const contrast = Math.max(16, seal.paper - seal.ink);
  const resp = new Float32Array(nx * ny).fill(-1);
  const innerArea = 4 * inner * inner;
  const outerArea = 4 * outer * outer;
  const r0 = BAND[0] * BAND[0];
  const r1 = BAND[1] * BAND[1];
  for (let j = 0; j < ny; j++) {
    const y = gy0 + j * grid;
    const dy = y - seal.center.y;
    for (let i = 0; i < nx; i++) {
      const x = gx0 + i * grid;
      const dx = x - seal.center.x;
      const qx = inv[0] * dx + inv[1] * dy;
      const qy = inv[2] * dx + inv[3] * dy;
      const rr = qx * qx + qy * qy;
      if (rr < r0 || rr > r1) continue;
      const mi = boxMean(ii, x - inner, y - inner, x + inner, y + inner);
      const mo = boxMean(ii, x - outer, y - outer, x + outer, y + outer);
      const surround = (mo * outerArea - mi * innerArea) / (outerArea - innerArea);
      resp[j * nx + i] = (surround - mi) / contrast;
    }
  }
  const raw = [];
  const suppress = Math.max(2, Math.round(MOON_R * 1.5 * sMin / grid));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = resp[j * nx + i];
      if (v < MIN_RESPONSE) continue;
      let isMax = true;
      for (let dj = -suppress; dj <= suppress && isMax; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= ny) continue;
        for (let di = -suppress; di <= suppress; di++) {
          const i2 = i + di;
          if (i2 < 0 || i2 >= nx || di === 0 && dj === 0) continue;
          const w = resp[jj * nx + i2];
          if (w > v || w === v && (dj < 0 || dj === 0 && di < 0)) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) raw.push({ x: gx0 + i * grid, y: gy0 + j * grid, v });
    }
  }
  raw.sort((a, b) => b.v - a.v);
  const peaks = [];
  for (const p of raw.slice(0, MAX_PEAKS)) {
    const { ink, paper } = moonLevels(img, affine, p);
    if (!(paper - ink > 0.25 * contrast)) continue;
    const first = refineCentroid(img, affine, p, ink, paper);
    const shape = discShape(img, affine, first, (ink + paper) / 2);
    if (!shape) continue;
    const k = shape.radius / MOON_R;
    const local = [affine[0] * k, affine[1] * k, affine[2] * k, affine[3] * k];
    const c = refineCentroid(img, local, first, ink, paper);
    const dx = c.x - seal.center.x;
    const dy = c.y - seal.center.y;
    const q = { x: inv[0] * dx + inv[1] * dy, y: inv[2] * dx + inv[3] * dy };
    const a = Math.atan2(q.x, -q.y);
    peaks.push({ x: c.x, y: c.y, response: p.v * shape.quality, halo: haloDarkness(img, local, c), q, r: Math.hypot(q.x, q.y), a: a < 0 ? a + 2 * Math.PI : a });
  }
  return peaks;
}
function angleDiff(a, b) {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}
function diagonals(peaks) {
  const out = [];
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length; j++) {
      const p = peaks[i];
      const q = peaks[j];
      if (Math.PI - angleDiff(p.a, q.a) > ANGLE_TOLERANCE) continue;
      const ratio = p.r / q.r;
      if (ratio < 0.6 || ratio > 1 / 0.6) continue;
      const len = Math.hypot(q.q.x - p.q.x, q.q.y - p.q.y);
      const offset = Math.abs(p.q.x * q.q.y - p.q.y * q.q.x) / len;
      if (offset > MAX_DIAGONAL_OFFSET) continue;
      const score = (p.response + q.response) * (1 - offset / (2 * MAX_DIAGONAL_OFFSET));
      out.push({ i, j, score, dir: Math.atan2(q.q.x - p.q.x, -(q.q.y - p.q.y)) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
function toSlots(members, missingAngle) {
  const entries = members.map((p) => ({ a: p.a, m: p }));
  if (missingAngle !== null) entries.push({ a: missingAngle, m: null });
  entries.sort((x, y) => x.a - y.a);
  return entries.map((e) => e.m ? { x: e.m.x, y: e.m.y, response: e.m.response, halo: e.m.halo } : null);
}
function findMoons(img, ii, seal) {
  const peaks = moonPeaks(img, ii, seal);
  const diags = diagonals(peaks);
  let best = null;
  for (let s = 0; s < diags.length; s++) {
    for (let t = s + 1; t < diags.length; t++) {
      const d1 = diags[s];
      const d2 = diags[t];
      if (d1.i === d2.i || d1.i === d2.j || d1.j === d2.i || d1.j === d2.j) continue;
      const cross = angleDiff(d1.dir, d2.dir);
      if (Math.abs(Math.min(cross, Math.PI - cross) - Math.PI / 2) > ANGLE_TOLERANCE) continue;
      const score = d1.score + d2.score;
      if (!best || score > best.score) {
        best = { slots: toSlots([peaks[d1.i], peaks[d1.j], peaks[d2.i], peaks[d2.j]], null), score };
      }
    }
  }
  if (best) return best;
  for (const d of diags) {
    const p = peaks[d.i];
    const q = peaks[d.j];
    const meanR = (p.r + q.r) / 2;
    for (let k = 0; k < peaks.length; k++) {
      if (k === d.i || k === d.j) continue;
      const m = peaks[k];
      if (m.r < 0.6 * meanR || m.r > meanR / 0.6) continue;
      if (Math.abs(angleDiff(m.a, p.a) - Math.PI / 2) > ANGLE_TOLERANCE) continue;
      const score = 0.75 * (d.score + m.response);
      if (!best || score > best.score) {
        const missing = (m.a + Math.PI) % (2 * Math.PI);
        best = { slots: toSlots([p, q, m], missing), score };
      }
    }
  }
  return best;
}
var DISC_FILL = [0.7, 1.25];
var DIAGONAL_IN_RADII = [12, 50];
var MOON_SIZE_RATIO = 1.8;
var MAX_DISCS = 32;
function crossing(p0, p1, q0, q1) {
  const rx = p1.x - p0.x;
  const ry = p1.y - p0.y;
  const sx = q1.x - q0.x;
  const sy = q1.y - q0.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qpx = q0.x - p0.x;
  const qpy = q0.y - p0.y;
  return [(qpx * sy - qpy * sx) / den, (qpx * ry - qpy * rx) / den];
}
function findMoonQuads(img, blobs, max) {
  const discs = blobs.filter((b) => b.a >= 2 && b.b / b.a >= 0.35 && b.fill >= DISC_FILL[0] && b.fill <= DISC_FILL[1]).sort((p, q) => q.area - p.area).slice(0, MAX_DISCS);
  const size = discs.map((b) => Math.sqrt(b.a * b.b));
  const diagonals2 = [];
  for (let i = 0; i < discs.length; i++) {
    for (let j = i + 1; j < discs.length; j++) {
      if (Math.max(size[i], size[j]) > MOON_SIZE_RATIO * Math.min(size[i], size[j])) continue;
      const len = Math.hypot(discs[i].x - discs[j].x, discs[i].y - discs[j].y);
      const inRadii = len / ((size[i] + size[j]) / 2);
      if (inRadii >= DIAGONAL_IN_RADII[0] && inRadii <= DIAGONAL_IN_RADII[1]) diagonals2.push({ i, j, len });
    }
  }
  const quads = [];
  for (let s = 0; s < diagonals2.length; s++) {
    const d1 = diagonals2[s];
    for (let t = s + 1; t < diagonals2.length; t++) {
      const d2 = diagonals2[t];
      if (d1.i === d2.i || d1.i === d2.j || d1.j === d2.i || d1.j === d2.j) continue;
      if (d1.len > 2 * d2.len || d2.len > 2 * d1.len) continue;
      const cut = crossing(discs[d1.i], discs[d1.j], discs[d2.i], discs[d2.j]);
      if (!cut || cut[0] < 0.3 || cut[0] > 0.7 || cut[1] < 0.3 || cut[1] > 0.7) continue;
      const sizes = [size[d1.i], size[d1.j], size[d2.i], size[d2.j]];
      if (Math.max(...sizes) > MOON_SIZE_RATIO * Math.min(...sizes)) continue;
      const four = [discs[d1.i], discs[d1.j], discs[d2.i], discs[d2.j]];
      const a = discs[d1.i];
      const b = discs[d1.j];
      const center = { x: a.x + cut[0] * (b.x - a.x), y: a.y + cut[0] * (b.y - a.y) };
      const score = 2 - Math.abs(cut[0] - 0.5) - Math.abs(cut[1] - 0.5) - four.reduce((acc, f) => acc + Math.abs(1 - f.fill), 0) / 4;
      quads.push({ center, four, score });
    }
  }
  return quads.sort((p, q) => q.score - p.score).slice(0, max).map(({ center, four, score }) => {
    const slots = moonsAround(img, center, four);
    return { center, points: slots.map(({ x, y }) => ({ x, y })), moons: { slots, score } };
  });
}
function moonsAround(img, center, blobs) {
  const angle = (b) => {
    const a = Math.atan2(b.x - center.x, -(b.y - center.y));
    return a < 0 ? a + 2 * Math.PI : a;
  };
  return [...blobs].sort((p, q) => angle(p) - angle(q)).map((b) => {
    const c = Math.cos(b.theta);
    const s = Math.sin(b.theta);
    const ka = b.a / MOON_R;
    const kb = b.b / MOON_R;
    const affine = [ka * c * c + kb * s * s, (ka - kb) * c * s, (ka - kb) * c * s, ka * s * s + kb * c * c];
    return { x: b.x, y: b.y, response: 1, halo: haloDarkness(img, affine, b) };
  });
}

// src/core/decoder/sampler.ts
var CELL_COUNT = CODE01_TOTAL_CELLS;
var CELL_GEOMETRY = (() => {
  const x = new Float64Array(CELL_COUNT);
  const y = new Float64Array(CELL_COUNT);
  const theta = new Float64Array(CELL_COUNT);
  const ring = new Uint8Array(CELL_COUNT);
  for (let flat = 0; flat < CELL_COUNT; flat++) {
    const ref = cellRef(flat);
    const spec = CODE01_RINGS[ref.ring];
    const a = (ref.cell + 0.5) * TAU / spec.cells;
    theta[flat] = a;
    ring[flat] = ref.ring;
    x[flat] = spec.radius * Math.sin(a);
    y[flat] = -spec.radius * Math.cos(a);
  }
  return { x, y, theta, ring };
})();
function neighbourhoods(ringReach, arcReach) {
  const out = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    const list = [];
    const ri = CELL_GEOMETRY.ring[i];
    for (let k = Math.max(0, ri - ringReach); k <= Math.min(CODE01_RINGS.length - 1, ri + ringReach); k++) {
      const spec = CODE01_RINGS[k];
      const span = arcReach / spec.radius;
      for (let c = 0; c < spec.cells; c++) {
        const j = spec.offset + c;
        let d = Math.abs(CELL_GEOMETRY.theta[j] - CELL_GEOMETRY.theta[i]);
        if (d > Math.PI) d = TAU - d;
        if (d <= span) list.push(j);
      }
    }
    out.push(Int16Array.from(list));
  }
  return out;
}
var NEIGHBOURS = neighbourhoods(2, 4);
var IMMEDIATE = neighbourhoods(1, 1.6);
var FOOTPRINT = 0.2;
var FOOTPRINT_SAMPLES = 9;
function projectCells(h, footprint) {
  const per = footprint ? FOOTPRINT_SAMPLES : 1;
  const out = new Float64Array(CELL_COUNT * per * 2);
  const { x: cxs, y: cys, theta } = CELL_GEOMETRY;
  let o = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    const cx = cxs[i];
    const cy = cys[i];
    const s = Math.sin(theta[i]);
    const c = Math.cos(theta[i]);
    for (let k = 0; k < per; k++) {
      const dr = footprint ? (k % 3 - 1) * FOOTPRINT : 0;
      const dt = footprint ? (Math.floor(k / 3) - 1) * FOOTPRINT : 0;
      const x = cx + dr * s + dt * c;
      const y = cy - dr * c + dt * s;
      const w = h[6] * x + h[7] * y + h[8];
      out[o++] = (h[0] * x + h[1] * y + h[2]) / w;
      out[o++] = (h[3] * x + h[4] * y + h[5]) / w;
    }
  }
  return out;
}
function sampleProjected(img, pos, shift, out = new Float64Array(CELL_COUNT)) {
  const per = pos.length / (2 * CELL_COUNT);
  let o = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    const dx = shift ? shift[2 * i] : 0;
    const dy = shift ? shift[2 * i + 1] : 0;
    let sum = 0;
    for (let k = 0; k < per; k++, o += 2) sum += sampleBilinear(img, pos[o] + dx, pos[o + 1] + dy);
    out[i] = sum / per;
  }
  return out;
}
function sampleCells(img, h, footprint, shift = null) {
  return sampleProjected(img, projectCells(h, footprint), shift);
}
function twoMeans(values, idx) {
  let t = 0;
  for (let k = 0; k < idx.length; k++) t += values[idx[k]];
  t /= idx.length;
  let mLo = t;
  let mHi = t;
  for (let iter = 0; iter < 3; iter++) {
    let sl = 0;
    let nl = 0;
    let sh = 0;
    let nh = 0;
    for (let k = 0; k < idx.length; k++) {
      const v = values[idx[k]];
      if (v < t) {
        sl += v;
        nl++;
      } else {
        sh += v;
        nh++;
      }
    }
    if (nl === 0 || nh === 0) break;
    mLo = sl / nl;
    mHi = sh / nh;
    t = (mLo + mHi) / 2;
  }
  return [t, mLo, mHi];
}
function classifyCells(values) {
  const threshold = new Float64Array(CELL_COUNT);
  const contrast = new Float64Array(CELL_COUNT);
  for (let i = 0; i < CELL_COUNT; i++) {
    const [t, lo, hi] = twoMeans(values, NEIGHBOURS[i]);
    threshold[i] = t;
    contrast[i] = hi - lo;
  }
  const globalContrast = Math.max(1, median(contrast));
  const bits = new Uint8Array(CELL_COUNT);
  const confidence = new Float64Array(CELL_COUNT);
  for (let i = 0; i < CELL_COUNT; i++) {
    const v = values[i];
    bits[i] = v < threshold[i] ? 1 : 0;
    const local = Math.max(contrast[i], 1);
    const margin = Math.min(1, Math.abs(v - threshold[i]) / (local / 2));
    const health = Math.min(1, contrast[i] / (0.5 * globalContrast));
    let lo = v;
    let hi = v;
    for (const j of IMMEDIATE[i]) {
      if (values[j] < lo) lo = values[j];
      if (values[j] > hi) hi = values[j];
    }
    const spread = Math.min(1, (hi - lo) / (0.5 * globalContrast));
    confidence[i] = margin * health * spread;
  }
  return { bits, confidence, threshold, contrast, globalContrast };
}
function median(a) {
  const s = Float64Array.from(a).sort();
  return s.length ? s[s.length >> 1] : 0;
}
var QUIET_PROBES = (() => {
  const probes = [];
  const nearestCell = (ringIndex, a) => {
    const ring = CODE01_RINGS[ringIndex];
    return ring.offset + Math.floor(a / TAU * ring.cells) % ring.cells;
  };
  const OUTER = 24.6;
  for (let k = 0; k < 96; k++) {
    const a = (k + 0.5) * TAU / 96;
    const fromDiagonal = Math.abs(((a - Math.PI / 4) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2) - Math.PI / 4);
    if (Math.PI / 4 - fromDiagonal < 12 * Math.PI / 180) continue;
    probes.push({ x: OUTER * Math.sin(a), y: -OUTER * Math.cos(a), cell: nearestCell(CODE01_RINGS.length - 1, a) });
  }
  const INNER = 4.85;
  for (let k = 0; k < 32; k++) {
    const a = (k + 0.5) * TAU / 32;
    probes.push({ x: INNER * Math.sin(a), y: -INNER * Math.cos(a), cell: nearestCell(0, a) });
  }
  return probes;
})();
function quietZoneScore(img, h, cls) {
  let light = 0;
  for (const p of QUIET_PROBES) {
    const w = h[6] * p.x + h[7] * p.y + h[8];
    const v = sampleBilinear(img, (h[0] * p.x + h[1] * p.y + h[2]) / w, (h[3] * p.x + h[4] * p.y + h[5]) / w);
    if (v >= cls.threshold[p.cell]) light++;
  }
  return light / QUIET_PROBES.length;
}

// src/core/decoder/refine.ts
function alignmentScore(values, cls) {
  let s = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    const c = cls.contrast[i] > 1 ? cls.contrast[i] : 1;
    s += Math.abs(values[i] - cls.threshold[i]) / c;
  }
  return s;
}
function fullObjective(params, score) {
  const scratch = Float64Array.from(params);
  return {
    trial(k, value) {
      scratch.set(params);
      scratch[k] = value;
      return score(scratch);
    },
    accept() {
    }
  };
}
function coordinateDescent(params, initial, objective, step, minStep, maxEvals) {
  let best = initial;
  let evals = 1;
  for (let s = step; s >= minStep && evals < maxEvals; s /= 2) {
    let improved = true;
    while (improved && evals < maxEvals) {
      improved = false;
      for (let k = 0; k < params.length && evals < maxEvals; k++) {
        for (const dir of [1, -1]) {
          const value = params[k] + dir * s;
          const v = objective.trial(k, value);
          evals++;
          if (v > best) {
            best = v;
            params[k] = value;
            objective.accept();
            improved = true;
            break;
          }
        }
      }
    }
  }
  return best;
}
function refineControlPoints(img, codePoints, imagePoints, unitPx, cls) {
  const values = new Float64Array(CELL_COUNT);
  const params = new Float64Array(imagePoints.length * 2);
  const pointsOf = (p) => imagePoints.map((q, i) => ({ x: q.x + p[2 * i], y: q.y + p[2 * i + 1] }));
  const score = (p) => {
    const h2 = homographyFromPoints(codePoints, pointsOf(p));
    if (!h2) return -Infinity;
    return alignmentScore(sampleProjected(img, projectCells(h2, false), null, values), cls);
  };
  const best = coordinateDescent(params, score(params), fullObjective(params, score), 0.3 * unitPx, 0.04 * unitPx, 400);
  const points = pointsOf(params);
  const h = homographyFromPoints(codePoints, points);
  return h ? { homography: h, points, score: best } : null;
}
var SECTORS2 = 8;
var BANDS2 = 2;
var FIELD_PARAMS = SECTORS2 * BANDS2 * 2;
var FIELD_WEIGHTS = (() => {
  const inner = CODE01_RINGS[0].radius;
  const outer = CODE01_RINGS[CODE01_RINGS.length - 1].radius;
  const node = new Uint8Array(CELL_COUNT * 4);
  const weight = new Float64Array(CELL_COUNT * 4);
  const byNode = Array.from({ length: SECTORS2 * BANDS2 }, () => ({ cells: [], weights: [] }));
  for (let i = 0; i < CELL_COUNT; i++) {
    const f = CELL_GEOMETRY.theta[i] / TAU * SECTORS2 - 0.5;
    const s0 = (Math.floor(f) % SECTORS2 + SECTORS2) % SECTORS2;
    const s1 = (s0 + 1) % SECTORS2;
    const ta = f - Math.floor(f);
    const radius = CODE01_RINGS[CELL_GEOMETRY.ring[i]].radius;
    const tr = (radius - inner) / (outer - inner);
    const entries = [
      [s0 * BANDS2, (1 - ta) * (1 - tr)],
      [s0 * BANDS2 + 1, (1 - ta) * tr],
      [s1 * BANDS2, ta * (1 - tr)],
      [s1 * BANDS2 + 1, ta * tr]
    ];
    entries.forEach(([n, w], k) => {
      node[4 * i + k] = n;
      weight[4 * i + k] = w;
      if (w > 0) {
        byNode[n].cells.push(i);
        byNode[n].weights.push(w);
      }
    });
  }
  return {
    node,
    weight,
    nodeCells: byNode.map((b) => Int32Array.from(b.cells)),
    nodeWeights: byNode.map((b) => Float64Array.from(b.weights))
  };
})();
function fieldShift(params, out = new Float64Array(CELL_COUNT * 2)) {
  const { node, weight } = FIELD_WEIGHTS;
  for (let i = 0; i < CELL_COUNT; i++) {
    let dx = 0;
    let dy = 0;
    for (let k = 4 * i; k < 4 * i + 4; k++) {
      dx += weight[k] * params[2 * node[k]];
      dy += weight[k] * params[2 * node[k] + 1];
    }
    out[2 * i] = dx;
    out[2 * i + 1] = dy;
  }
  return out;
}
function refineOffsetField(img, h, unitPx, cls, initial = new Float64Array(FIELD_PARAMS)) {
  const pos = projectCells(h, false);
  const params = Float64Array.from(initial);
  const shift = fieldShift(params);
  const contribution = new Float64Array(CELL_COUNT);
  const cellScore = (i, dx, dy) => {
    const v = sampleBilinear(img, pos[2 * i] + dx, pos[2 * i + 1] + dy);
    return Math.abs(v - cls.threshold[i]) / (cls.contrast[i] > 1 ? cls.contrast[i] : 1);
  };
  let total = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    contribution[i] = cellScore(i, shift[2 * i], shift[2 * i + 1]);
    total += contribution[i];
  }
  let pendingK = -1;
  let pendingTotal = 0;
  const trialShift = new Float64Array(CELL_COUNT);
  const trialScore = new Float64Array(CELL_COUNT);
  const objective = {
    trial(k, value) {
      const axis = k & 1;
      const cells = FIELD_WEIGHTS.nodeCells[k >> 1];
      const weights = FIELD_WEIGHTS.nodeWeights[k >> 1];
      const delta = value - params[k];
      let t = total;
      for (let j = 0; j < cells.length; j++) {
        const i = cells[j];
        const moved = shift[2 * i + axis] + weights[j] * delta;
        trialShift[j] = moved;
        trialScore[j] = axis === 0 ? cellScore(i, moved, shift[2 * i + 1]) : cellScore(i, shift[2 * i], moved);
        t += trialScore[j] - contribution[i];
      }
      pendingK = k;
      pendingTotal = t;
      return t;
    },
    accept() {
      const axis = pendingK & 1;
      const cells = FIELD_WEIGHTS.nodeCells[pendingK >> 1];
      for (let j = 0; j < cells.length; j++) {
        shift[2 * cells[j] + axis] = trialShift[j];
        contribution[cells[j]] = trialScore[j];
      }
      total = pendingTotal;
    }
  };
  const best = coordinateDescent(params, total, objective, 0.25 * unitPx, 0.04 * unitPx, 800);
  return { shift: fieldShift(params), score: best };
}
var LATTICE = (() => {
  const { firstRadius, pitch, arcThickness, ringCount } = CODE01.data;
  const lastRadius = firstRadius + (ringCount - 1) * pitch;
  return {
    firstRadius,
    pitch,
    halfArc: arcThickness / 2,
    /** Ink share of one pitch: the template is zero-mean over every pitch. */
    fill: arcThickness / pitch,
    /** Radial extent of the data band (u). */
    inner: firstRadius - pitch / 2,
    outer: lastRadius + pitch / 2,
    /** Pivot of the per-sector linear model, mid data band. */
    mid: (firstRadius + lastRadius) / 2
  };
})();
var LATTICE_OFFSET = 1.5;
var LATTICE_OFFSET_STEP = 0.05;
var LATTICE_SLOPES = [-0.08, -0.06, -0.04, -0.02, 0, 0.02, 0.04, 0.06, 0.08];
var PROFILE_STEP = 0.05;
var PROFILE_FROM = LATTICE.inner - 1.25;
var PROFILE_TO = LATTICE.outer + 2.25;
var PROFILE_SAMPLES = Math.round((PROFILE_TO - PROFILE_FROM) / PROFILE_STEP);
var PROFILE_ANGLES = 24;
var LATTICE_CONTINUITY = 0.5;
function sectorProfile(img, h, sector) {
  const raw = new Float64Array(PROFILE_SAMPLES);
  const span = TAU / SECTORS2;
  const sin = new Float64Array(PROFILE_ANGLES);
  const cos = new Float64Array(PROFILE_ANGLES);
  for (let a = 0; a < PROFILE_ANGLES; a++) {
    const theta = (sector + (a + 0.5) / PROFILE_ANGLES) * span;
    sin[a] = Math.sin(theta);
    cos[a] = Math.cos(theta);
  }
  for (let j = 0; j < PROFILE_SAMPLES; j++) {
    const r = PROFILE_FROM + (j + 0.5) * PROFILE_STEP;
    let sum = 0;
    for (let a = 0; a < PROFILE_ANGLES; a++) {
      const x = r * sin[a];
      const y = -r * cos[a];
      const w = h[6] * x + h[7] * y + h[8];
      sum += sampleBilinear(img, (h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w);
    }
    raw[j] = sum / PROFILE_ANGLES;
  }
  const half = Math.round(LATTICE.pitch / PROFILE_STEP / 2);
  const out = new Float64Array(PROFILE_SAMPLES);
  for (let j = 0; j < PROFILE_SAMPLES; j++) {
    let sum = 0;
    for (let k = j - half; k < j + half; k++) sum += raw[k < 0 ? 0 : k >= PROFILE_SAMPLES ? PROFILE_SAMPLES - 1 : k];
    out[j] = sum / (2 * half) - raw[j];
  }
  return out;
}
var OFFSETS = Array.from({ length: Math.round(2 * LATTICE_OFFSET / LATTICE_OFFSET_STEP) + 1 }, (_, i) => -LATTICE_OFFSET + i * LATTICE_OFFSET_STEP);
var LATTICE_EDGES = (() => {
  const radii = [LATTICE.inner, LATTICE.outer];
  const weights = [LATTICE.fill, -LATTICE.fill];
  for (const ring of CODE01_RINGS) {
    radii.push(ring.radius - LATTICE.halfArc, ring.radius + LATTICE.halfArc);
    weights.push(-1, 1);
  }
  return { radii: Float64Array.from(radii), weights: Float64Array.from(weights) };
})();
function registration(profile) {
  const prefix = new Float64Array(PROFILE_SAMPLES + 1);
  for (let j = 0; j < PROFILE_SAMPLES; j++) prefix[j + 1] = prefix[j] + profile[j];
  const { radii, weights } = LATTICE_EDGES;
  const score = new Float64Array(OFFSETS.length).fill(-Infinity);
  const slope = new Float64Array(OFFSETS.length);
  for (let i = 0; i < OFFSETS.length; i++) {
    for (const b of LATTICE_SLOPES) {
      let c = 0;
      for (let e = 0; e < radii.length; e++) {
        const u = (radii[e] + OFFSETS[i] + b * (radii[e] - LATTICE.mid) - PROFILE_FROM) / PROFILE_STEP;
        let integral;
        if (u <= 0) integral = 0;
        else if (u >= PROFILE_SAMPLES) integral = prefix[PROFILE_SAMPLES];
        else {
          const j = Math.floor(u);
          integral = prefix[j] + (u - j) * profile[j];
        }
        c += weights[e] * integral;
      }
      if (c > score[i]) {
        score[i] = c;
        slope[i] = b;
      }
    }
  }
  return { score, slope };
}
function branchCandidates(score) {
  const bestIn = (lo, hi) => {
    let best = -1;
    for (let i = 0; i < OFFSETS.length; i++) {
      if (OFFSETS[i] > lo && OFFSETS[i] <= hi && (best < 0 || score[i] > score[best])) best = i;
    }
    return best;
  };
  const centre = bestIn(-LATTICE.pitch / 2, LATTICE.pitch / 2);
  const out = [];
  for (const k of [-1, 0, 1]) {
    const i = k === 0 ? centre : bestIn(OFFSETS[centre] + k * LATTICE.pitch - 0.3, OFFSETS[centre] + k * LATTICE.pitch + 0.3);
    if (i >= 0) out.push(i);
  }
  return out;
}
function ringLatticeField(img, h) {
  const regs = Array.from({ length: SECTORS2 }, (_, s) => registration(sectorProfile(img, h, s)));
  const peaks = regs.map((r) => Math.max(...r.score));
  const median2 = [...peaks].sort((a, b) => a - b)[SECTORS2 >> 1];
  if (!(median2 > 0)) return null;
  const cands = regs.map((r) => branchCandidates(r.score));
  const gain = (s, i) => peaks[s] > 0 ? Math.min(1, peaks[s] / median2) * regs[s].score[i] / peaks[s] : 0;
  const jump = (i, j) => LATTICE_CONTINUITY * (OFFSETS[i] - OFFSETS[j]) ** 2;
  let best = -Infinity;
  let picks = [];
  for (const start of cands[0]) {
    let value = /* @__PURE__ */ new Map([[start, gain(0, start)]]);
    const back = [];
    for (let s = 1; s < SECTORS2; s++) {
      const next = /* @__PURE__ */ new Map();
      const from = /* @__PURE__ */ new Map();
      for (const i of cands[s]) {
        let v = -Infinity;
        let arg = -1;
        for (const [j, prev] of value) {
          const t = prev - jump(i, j);
          if (t > v) {
            v = t;
            arg = j;
          }
        }
        next.set(i, v + gain(s, i));
        from.set(i, arg);
      }
      back.push(from);
      value = next;
    }
    for (const [last, v] of value) {
      const total = v - jump(last, start);
      if (total > best) {
        best = total;
        picks = [last];
        for (let s = SECTORS2 - 1; s > 0; s--) picks.unshift(back[s - 1].get(picks[0]));
      }
    }
  }
  const params = new Float64Array(FIELD_PARAMS);
  const radii = [CODE01_RINGS[0].radius, CODE01_RINGS[CODE01_RINGS.length - 1].radius];
  for (let s = 0; s < SECTORS2; s++) {
    const i = picks[s];
    const theta = (s + 0.5) * (TAU / SECTORS2);
    const ux = Math.sin(theta);
    const uy = -Math.cos(theta);
    radii.forEach((r, band) => {
      const d = OFFSETS[i] + regs[s].slope[i] * (r - LATTICE.mid);
      const [a, b, c, e] = jacobianH(h, r * ux, r * uy);
      const n = s * BANDS2 + band;
      params[2 * n] = d * (a * ux + b * uy);
      params[2 * n + 1] = d * (c * ux + e * uy);
    });
  }
  return params;
}

// src/core/decoder/decode.ts
var NSYM = CODE01.ecc.totalBytes - CODE01.ecc.dataBytes;
var CODE_VERSION3 = 1;
var MAX_DETECTION_PIXELS = 25e5;
var MIN_SIDE = 12;
var MAX_CLUSTERS = 12;
var ERASURE_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80];
var FORMAT_TRUST = 6;
var FORMAT_CERTAIN = 2;
var FORMAT_WORDS2 = Array.from({ length: 32 }, (_, v) => bchFormatEncode(v));
var DIHEDRAL_PERMS = Array.from({ length: 8 }, (_, g) => {
  const k = g & 3;
  const mirror = g >> 2 === 1;
  const perm = new Int16Array(CODE01_TOTAL_CELLS);
  for (const ring of CODE01_RINGS) {
    const n = ring.cells;
    for (let c = 0; c < n; c++) {
      const base = mirror ? n - 1 - c : c;
      perm[ring.offset + c] = ring.offset + (base + k * n / 4) % n;
    }
  }
  return perm;
});
function dihedralMatrix(g) {
  const k = g & 3;
  const cos = [1, 0, -1, 0][k];
  const sin = [0, 1, 0, -1][k];
  const m = g >> 2 === 1 ? -1 : 1;
  return [cos * m, -sin, 0, sin * m, cos, 0, 0, 0, 1];
}
function moonSlot(g, i) {
  const k = g & 3;
  return g >> 2 === 1 ? ((1 - i + k) % 4 + 4) % 4 : (i + k) % 4;
}
var BYTE_CELLS = Array.from(
  { length: CODE01.ecc.totalBytes },
  (_, b) => Int16Array.from({ length: 8 }, (_2, j) => CODE01_DATA_CELLS[8 * b + j])
);
function popcount(x) {
  let c = 0;
  for (let v = x; v !== 0; v &= v - 1) c++;
  return c;
}
var now = typeof globalThis.performance?.now === "function" ? () => globalThis.performance.now() : () => Date.now();
var FAILURE_RANK = { NO_SEAL: 0, NO_MOONS: 1, FORMAT: 2, ECC: 3, CRC: 4, PAYLOAD: 5 };
var Failure = class {
  reason = "NO_SEAL";
  detail;
  note(reason, detail) {
    if (FAILURE_RANK[reason] >= FAILURE_RANK[this.reason]) {
      this.reason = reason;
      this.detail = detail;
    }
  }
};
var Detection = class {
  constructor(frame) {
    this.frame = frame;
    const pixels = frame.width * frame.height;
    this.factor = pixels > MAX_DETECTION_PIXELS ? Math.ceil(Math.sqrt(pixels / MAX_DETECTION_PIXELS)) : 1;
    this.image = this.factor > 1 ? downscaleImage(frame, this.factor) : frame;
    this.integral = integralImage(this.image);
    const side = Math.min(this.image.width, this.image.height);
    this.windows = [.../* @__PURE__ */ new Set([Math.max(8, Math.round(side / 8)), Math.max(6, Math.round(side / 16))])];
  }
  frame;
  image;
  integral;
  /** Full-resolution pixels per detection pixel. */
  factor;
  /** Binarisation windows (px): 1/8 and 1/16 of the short side. */
  windows;
  negative = null;
  binaries = /* @__PURE__ */ new Map();
  /** Detection image, its table and the full frame, as dark-ink images of the given polarity. */
  view(inverted) {
    if (!inverted) return { image: this.image, integral: this.integral, frame: this.frame };
    if (!this.negative) {
      const image = invertImage(this.image);
      this.negative = { image, integral: integralImage(image), frame: this.factor > 1 ? invertImage(this.frame) : image };
    }
    return this.negative;
  }
  /** Binarisation of the detection image (cached: the passes share them). */
  binary(windowPx, inverted) {
    const key = `${windowPx}/${inverted}`;
    let bin = this.binaries.get(key);
    if (!bin) {
      bin = binarize(this.image, this.integral, windowPx, inverted);
      this.binaries.set(key, bin);
    }
    return bin;
  }
};
function* sealCandidates(det, max, polarities) {
  const { image } = det;
  const passes = [];
  for (const w of det.windows) {
    for (const inverted of polarities) {
      passes.push({ inverted, scan: () => [findSealHits(det.binary(w, inverted), image.width, image.height, "rows")] });
    }
  }
  for (const inverted of polarities) {
    passes.push({ inverted, scan: () => det.windows.map((w) => findSealHits(det.binary(w, inverted), image.width, image.height, "columns")) });
  }
  const seen = [];
  const near = (x, y, inverted) => seen.some((h) => h.inverted === inverted && Math.hypot(h.seal.center.x - x, h.seal.center.y - y) < 2 * h.seal.unit);
  for (const pass of passes) {
    const clusters = mergeClusters(pass.scan()).filter((c) => !near(c.x, c.y, pass.inverted));
    if (clusters.length === 0) continue;
    const view = det.view(pass.inverted);
    const fresh = [];
    for (const cluster of clusters.slice(0, MAX_CLUSTERS)) {
      const seal = measureSeal(view.image, cluster);
      if (seal && !near(seal.center.x, seal.center.y, pass.inverted)) fresh.push(seal);
    }
    fresh.sort((a, b) => b.score - a.score);
    for (const seal of fresh.slice(0, max)) {
      const hit = { seal, inverted: pass.inverted };
      seen.push(hit);
      yield hit;
    }
  }
}
function scale(p, f) {
  return { x: p.x * f, y: p.y * f };
}
var MIN_QUIET_SCORE = 0.7;
function fitFrame(center, sealAffine, pairs) {
  const code = [{ x: 0, y: 0 }, ...pairs.map(([c]) => c)];
  const image = [center, ...pairs.map(([, p]) => p)];
  if (pairs.length < 4) {
    const inv = invert2(sealAffine);
    if (!inv) return null;
    let dot = 0;
    let cross = 0;
    for (const [c, p] of pairs) {
      const qx = inv[0] * (p.x - center.x) + inv[1] * (p.y - center.y);
      const qy = inv[2] * (p.x - center.x) + inv[3] * (p.y - center.y);
      dot += c.x * qx + c.y * qy;
      cross += c.x * qy - c.y * qx;
    }
    const theta = Math.atan2(cross, dot);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const R = 3.5;
    for (const [ux, uy] of [
      [R, 0],
      [0, R],
      [-R, 0],
      [0, -R]
    ]) {
      const rx = cos * ux - sin * uy;
      const ry = sin * ux + cos * uy;
      code.push({ x: ux, y: uy });
      image.push({ x: center.x + sealAffine[0] * rx + sealAffine[1] * ry, y: center.y + sealAffine[2] * rx + sealAffine[3] * ry });
    }
  }
  return homographyFromPoints(code, image);
}
function alignmentFrom(img, center, h) {
  const values = sampleCells(img, h, true);
  return {
    homography: h,
    codePoints: [{ x: 0, y: 0 }, ...CODE01_MOONS],
    imagePoints: [center, ...CODE01_MOONS.map((c) => applyH(h, c.x, c.y))],
    values,
    cls: classifyCells(values),
    shift: null
  };
}
function anchorsOf(img, center, sealAffine, moons, factor) {
  const pairs = [];
  moons.slots.forEach((m, k) => {
    if (m) pairs.push([CODE01_MOONS[k], scale(m, factor)]);
  });
  const rough = fitFrame(center, sealAffine, pairs);
  if (!rough) return null;
  return {
    center,
    sealAffine,
    pairs: pairs.map(([c, p]) => {
      const local = jacobianH(rough, c.x, c.y);
      const { ink, paper } = moonLevels(img, local, p);
      return [c, refineCentroid(img, local, p, ink, paper)];
    })
  };
}
function leaveOneOut(img, anchors, full) {
  if (anchors.pairs.length !== 4) return null;
  let best = null;
  let bestScore = alignmentScore(sampleCells(img, full.homography, false), full.cls);
  for (let skip = 0; skip < 4; skip++) {
    const h = fitFrame(anchors.center, anchors.sealAffine, anchors.pairs.filter((_, i) => i !== skip));
    if (!h) continue;
    const score = alignmentScore(sampleCells(img, h, false), full.cls);
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best ? alignmentFrom(img, anchors.center, best) : null;
}
function refineAlignment(img, a, unitPx) {
  const refined = refineControlPoints(img, a.codePoints, a.imagePoints, unitPx, a.cls);
  if (!refined) return a;
  const values = sampleCells(img, refined.homography, true);
  return { ...a, homography: refined.homography, imagePoints: refined.points, values, cls: classifyCells(values) };
}
function withOffsetField(img, a, unitPx) {
  const { shift } = refineOffsetField(img, a.homography, unitPx, a.cls);
  const values = sampleCells(img, a.homography, true, shift);
  return { ...a, values, cls: classifyCells(values), shift };
}
function withRingLattice(img, a, unitPx) {
  const initial = ringLatticeField(img, a.homography);
  if (!initial) return null;
  const start = classifyCells(sampleCells(img, a.homography, true, fieldShift(initial)));
  const { shift } = refineOffsetField(img, a.homography, unitPx, start, initial);
  const values = sampleCells(img, a.homography, true, shift);
  return { ...a, values, cls: classifyCells(values), shift };
}
function formatHypotheses(cls, moons, mirrored, failure) {
  const out = [];
  for (let g = 0; g < (mirrored ? 8 : 4); g++) {
    const perm = DIHEDRAL_PERMS[g];
    const [w0, w1] = CODE01_FORMAT_CELLS.map((copy) => copy.reduce((w, flat) => w << 1 | cls.bits[perm[flat]], 0));
    let bestV1 = { mask: 0, d: Infinity };
    let bestAny = Infinity;
    FORMAT_WORDS2.forEach((word, v) => {
      const d = popcount(w0 ^ word) + popcount(w1 ^ word);
      bestAny = Math.min(bestAny, d);
      const info = parseFormatInfoValue(v);
      if (info.codeVersion === CODE_VERSION3 && d < bestV1.d) bestV1 = { mask: info.mask, d };
    });
    if (bestAny <= FORMAT_TRUST && bestV1.d > FORMAT_TRUST) failure.note("FORMAT", "unsupported code version");
    const polaris = moons.slots[moonSlot(g, 0)];
    out.push({ g, mask: bestV1.mask, formatDistance: bestV1.d, hint: polaris ? polaris.halo : 0 });
  }
  return out.sort((a, b) => a.formatDistance - b.formatDistance || b.hint - a.hint);
}
function readCodeword(cls, g, mask) {
  const perm = DIHEDRAL_PERMS[g];
  const cells = new Uint8Array(CELL_COUNT);
  for (let j = 0; j < CELL_COUNT; j++) cells[j] = cls.bits[perm[j]];
  const { codeword } = decodeCellsToCodeword(cells, mask);
  const byteConfidence = new Float64Array(codeword.length);
  BYTE_CELLS.forEach((list, b) => {
    let m = 1;
    for (const flat of list) m = Math.min(m, cls.confidence[perm[flat]]);
    byteConfidence[b] = m;
  });
  return { codeword, byteConfidence };
}
function tryHypothesis(cls, g, mask, schedule, guessed, failure) {
  const { codeword, byteConfidence } = readCodeword(cls, g, mask);
  const order = Array.from(byteConfidence.keys()).sort((a, b) => byteConfidence[a] - byteConfidence[b] || a - b);
  let lastErasures = -1;
  for (const step of schedule) {
    let count = 0;
    while (count < step && byteConfidence[order[count]] < 0.999) count++;
    if (count === lastErasures) continue;
    lastErasures = count;
    const rs = rsDecode(codeword, NSYM, order.slice(0, count));
    if (!rs.ok) {
      if (!guessed) failure.note("ECC", `Reed-Solomon failed (mask ${mask}, ${count} erasures)`);
      continue;
    }
    try {
      const framed = unframeCodeData(rs.data);
      return { g, mask, data: rs.data, payloadBytes: framed.payloadBytes, signature: framed.signature, errors: rs.errors, erasures: rs.erasures };
    } catch (e) {
      if (e instanceof PayloadError && e.code === "CRC") failure.note("CRC", "CRC-16 mismatch after Reed-Solomon");
      else failure.note("PAYLOAD", e instanceof Error ? e.message : "invalid payload");
    }
  }
  return null;
}
var BRUTE_FORCE_ERASURES = [0, 30, 60];
function decodeCells(cls, moons, mirrored, failure) {
  const hyps = formatHypotheses(cls, moons, mirrored, failure);
  const trusted = hyps.filter((h) => h.formatDistance <= FORMAT_TRUST);
  for (const h of trusted) {
    const read = tryHypothesis(cls, h.g, h.mask, ERASURE_STEPS, false, failure);
    if (read) return read;
  }
  if (trusted.length === 0) failure.note("FORMAT", "format word unreadable");
  else if (trusted[0].formatDistance <= FORMAT_CERTAIN) return null;
  for (const h of hyps) {
    for (let mask = 0; mask < CODE01_MASK_COUNT; mask++) {
      if (h.formatDistance <= FORMAT_TRUST && mask === h.mask) continue;
      const read = tryHypothesis(cls, h.g, mask, BRUTE_FORCE_ERASURES, true, failure);
      if (read) return read;
    }
  }
  return null;
}
function prepareAttempt(img, anchors, unitPx, moons, inverted, failure) {
  const fit = anchors && fitFrame(anchors.center, anchors.sealAffine, anchors.pairs);
  if (!anchors || !fit) {
    failure.note("NO_MOONS", "degenerate moon configuration");
    return null;
  }
  const fitted = alignmentFrom(img, anchors.center, fit);
  const quiet = quietZoneScore(img, fitted.homography, fitted.cls);
  if (quiet < MIN_QUIET_SCORE) {
    failure.note("NO_MOONS", "no code structure around the seal");
    return null;
  }
  return { img, anchors, moons, unitPx, inverted, fitted, alignment: fitted, quiet, repaired: false };
}
function quickDecode(a, opts, failure) {
  const read = decodeCells(a.alignment.cls, a.moons, opts.tryMirrored, failure);
  if (read) return read;
  const robust = leaveOneOut(a.img, a.anchors, a.alignment);
  if (!robust) return null;
  a.alignment = robust;
  return decodeCells(robust.cls, a.moons, opts.tryMirrored, failure);
}
function repairDecode(a, opts, failure) {
  const lattice = withRingLattice(a.img, a.fitted, a.unitPx);
  const read = lattice && decodeCells(lattice.cls, a.moons, opts.tryMirrored, failure);
  if (lattice && read) {
    a.alignment = lattice;
    return read;
  }
  a.alignment = refineAlignment(a.img, a.alignment, a.unitPx);
  const refined = decodeCells(a.alignment.cls, a.moons, opts.tryMirrored, failure);
  if (refined) return refined;
  a.alignment = withOffsetField(a.img, a.alignment, a.unitPx);
  return decodeCells(a.alignment.cls, a.moons, opts.tryMirrored, failure);
}
function decodeResult(a, read, opts, started) {
  const g = read.g;
  const h = multiplyH(a.alignment.homography, dihedralMatrix(g));
  let genome = null;
  if (opts.readGenome) {
    try {
      genome = readGenome(a.img, h);
    } catch {
      genome = null;
    }
  }
  const center = applyH(h, 0, 0);
  const north = applyH(h, 0, -10);
  let orientation = Math.atan2(north.x - center.x, -(north.y - center.y)) * 180 / Math.PI;
  if (orientation < 0) orientation += 360;
  const [m11, m12, m21, m22] = jacobianH(h, 0, 0);
  return {
    ok: true,
    data: read.data,
    payloadBytes: read.payloadBytes,
    signature: read.signature,
    codeVersion: CODE_VERSION3,
    mask: read.mask,
    genome,
    quality: {
      rsErrors: read.errors,
      rsErasures: read.erasures,
      contrast: Math.min(1, a.alignment.cls.globalContrast / 255),
      moduleSizePx: Math.sqrt(Math.abs(m11 * m22 - m12 * m21)),
      inverted: a.inverted,
      mirrored: g >= 4,
      orientation,
      elapsedMs: now() - started
    },
    geometry: {
      center,
      moons: CODE01_MOONS.map((m) => applyH(h, m.x, m.y)),
      homography: h
    }
  };
}
function isRepeat(attempts, anchors, unitPx, inverted) {
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= unitPx;
  return attempts.some(
    (a) => a.inverted === inverted && anchors.pairs.length <= a.anchors.pairs.length && near(anchors.center, a.anchors.center) && anchors.pairs.every(([, p]) => a.anchors.pairs.some(([, q]) => near(p, q)))
  );
}
var MAX_MOON_QUADS = 3;
var MAX_REPAIRS = 2;
function decodeFromMoons(det, opts, polarities, attempts, failure, started) {
  const { image } = det;
  for (const inverted of polarities) {
    const side = Math.min(image.width, image.height);
    const blobs = inkBlobs(det.binary(det.windows[0], inverted), image.width, image.height, 12, side * side / 36);
    const view = det.view(inverted);
    for (const quad of findMoonQuads(view.image, blobs, MAX_MOON_QUADS)) {
      const center = scale(quad.center, det.factor);
      const moonFit = homographyFromPoints([{ x: 0, y: 0 }, ...CODE01_MOONS], [center, ...quad.points.map((m) => scale(m, det.factor))]);
      if (!moonFit) continue;
      const local = jacobianH(moonFit, 0, 0);
      const unitPx = Math.sqrt(Math.abs(local[0] * local[3] - local[1] * local[2]));
      const anchors = anchorsOf(view.frame, center, local, quad.moons, det.factor);
      if (anchors && isRepeat(attempts, anchors, unitPx, inverted)) continue;
      const attempt = prepareAttempt(view.frame, anchors, unitPx, quad.moons, inverted, failure);
      if (!attempt) continue;
      const read = quickDecode(attempt, opts, failure);
      if (read) return decodeResult(attempt, read, opts, started);
      attempts.push(attempt);
    }
  }
  return null;
}
function decodeFrame(frame, opts, failure, started) {
  const det = new Detection(frame);
  const polarities = opts.tryInverted ? [false, true] : [false];
  const attempts = [];
  let repairs = 0;
  for (const { seal, inverted } of sealCandidates(det, opts.maxSealCandidates, polarities)) {
    const view = det.view(inverted);
    const moons = findMoons(view.image, view.integral, seal);
    if (!moons) {
      failure.note("NO_MOONS", `seal at (${(seal.center.x * det.factor).toFixed(1)}, ${(seal.center.y * det.factor).toFixed(1)}) without moons`);
      continue;
    }
    const center = scale(seal.center, det.factor);
    const sealAffine = seal.affine.map((v) => v * det.factor);
    const anchors = anchorsOf(view.frame, center, sealAffine, moons, det.factor);
    const attempt = prepareAttempt(view.frame, anchors, seal.unit * det.factor, moons, inverted, failure);
    if (!attempt) continue;
    attempts.push(attempt);
    let read = quickDecode(attempt, opts, failure);
    if (!read && repairs < MAX_REPAIRS) {
      repairs++;
      attempt.repaired = true;
      read = repairDecode(attempt, opts, failure);
    }
    if (read) return decodeResult(attempt, read, opts, started);
  }
  const fallback = decodeFromMoons(det, opts, polarities, attempts, failure, started);
  if (fallback) return fallback;
  const ranked = attempts.filter((a) => !a.repaired).sort((a, b) => b.quiet - a.quiet);
  for (const attempt of ranked.slice(0, MAX_REPAIRS - repairs)) {
    const read = repairDecode(attempt, opts, failure);
    if (read) return decodeResult(attempt, read, opts, started);
  }
  return null;
}
function decodeOrbesCode(img, opts = {}) {
  const started = now();
  const failure = new Failure();
  try {
    const frame = asGrayImage(img);
    if (!frame || frame.width < MIN_SIDE || frame.height < MIN_SIDE) {
      return { ok: false, reason: "NO_SEAL", detail: "image too small or malformed", elapsedMs: now() - started };
    }
    const o = opts !== null && typeof opts === "object" ? opts : {};
    const options = {
      tryInverted: o.tryInverted ?? true,
      tryMirrored: o.tryMirrored ?? false,
      readGenome: o.readGenome ?? true,
      maxSealCandidates: Number.isFinite(o.maxSealCandidates) ? Math.max(1, Math.min(16, Math.floor(o.maxSealCandidates))) : 4
    };
    const result = decodeFrame(frame, options, failure, started);
    if (result) return result;
  } catch (e) {
    return { ok: false, reason: failure.reason, detail: `internal error: ${e instanceof Error ? e.message : String(e)}`, elapsedMs: now() - started };
  }
  return { ok: false, reason: failure.reason, ...failure.detail ? { detail: failure.detail } : {}, elapsedMs: now() - started };
}

// test/support/image-io.ts
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

// test/support/raster.ts
import { Resvg } from "@resvg/resvg-js";
function createGray(width, height, fill = 0) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`invalid image size ${width}\xD7${height}`);
  }
  return { width, height, data: new Uint8Array(width * height).fill(fill) };
}
function luma601(r, g, b) {
  return 77 * r + 150 * g + 29 * b + 128 >> 8;
}
function rgbaToGray2(rgba, width, height, background = 255) {
  if (rgba.length !== width * height * 4) {
    throw new RangeError(`RGBA buffer has ${rgba.length} bytes, expected ${width * height * 4}`);
  }
  const out = createGray(width, height);
  const d = out.data;
  for (let i = 0, p = 0; i < d.length; i++, p += 4) {
    const y = luma601(rgba[p], rgba[p + 1], rgba[p + 2]);
    const a = rgba[p + 3];
    d[i] = a === 255 ? y : Math.round((y * a + background * (255 - a)) / 255);
  }
  return out;
}
function grayToRgba(img) {
  const out = new Uint8Array(img.width * img.height * 4);
  for (let i = 0, p = 0; i < img.data.length; i++, p += 4) {
    const v = img.data[i];
    out[p] = v;
    out[p + 1] = v;
    out[p + 2] = v;
    out[p + 3] = 255;
  }
  return out;
}
function svgToGray(svg, opts) {
  const { widthPx } = opts;
  const background = opts.background ?? 255;
  if (!Number.isInteger(widthPx) || widthPx <= 0) throw new RangeError(`invalid widthPx ${widthPx}`);
  if (!(background >= 0 && background <= 255)) throw new RangeError(`invalid background ${background}`);
  const level = Math.round(background);
  const rendered = new Resvg(svg, {
    fitTo: { mode: "width", value: widthPx },
    background: `rgb(${level},${level},${level})`,
    font: { loadSystemFonts: false },
    logLevel: "off"
  }).render();
  return rgbaToGray2(rendered.pixels, rendered.width, rendered.height, level);
}

// test/support/image-io.ts
function encodeJpeg(img, quality) {
  const decoded = jpeg.decode(jpegBytes(img, quality), { useTArray: true, formatAsRGBA: true });
  return rgbaToGray2(decoded.data, decoded.width, decoded.height, 255);
}
function jpegBytes(img, quality) {
  assertImage(img);
  assertQuality(quality);
  return jpeg.encode({ width: img.width, height: img.height, data: grayToRgba(img) }, quality).data;
}
var ANNEX_K_LUMA = [
  16,
  11,
  10,
  16,
  24,
  40,
  51,
  61,
  12,
  12,
  14,
  19,
  26,
  58,
  60,
  55,
  14,
  13,
  16,
  24,
  40,
  57,
  69,
  56,
  14,
  17,
  22,
  29,
  51,
  87,
  80,
  62,
  18,
  22,
  37,
  56,
  68,
  109,
  103,
  77,
  24,
  35,
  55,
  64,
  81,
  104,
  113,
  92,
  49,
  64,
  78,
  87,
  103,
  121,
  120,
  101,
  72,
  92,
  95,
  98,
  112,
  100,
  103,
  99
];
function jpegLumaTable(quality) {
  assertQuality(quality);
  const scale2 = quality < 50 ? Math.floor(5e3 / quality) : Math.floor(200 - 2 * quality);
  return Uint8Array.from(ANNEX_K_LUMA, (base) => Math.min(255, Math.max(1, Math.floor((base * scale2 + 50) / 100))));
}
var AAN = Array.from({ length: 8 }, (_, k) => k === 0 ? 1 : Math.SQRT2 * Math.cos(k * Math.PI / 16));
function quantFactors(quality) {
  const table = jpegLumaTable(quality);
  const toQuant = new Float64Array(64);
  const fromQuant = new Float64Array(64);
  for (let i = 0; i < 64; i++) {
    const scaled = table[i] * AAN[i >> 3] * AAN[i & 7];
    toQuant[i] = 1 / (scaled * 8);
    fromQuant[i] = scaled;
  }
  return { toQuant, fromQuant };
}
function encodeJpegFast(img, quality) {
  assertImage(img);
  const { toQuant, fromQuant } = quantFactors(quality);
  const { width, height, data } = img;
  const out = createGray(width, height);
  const block = new Float64Array(64);
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      if (bx + 8 <= width && by + 8 <= height) {
        for (let y = 0, row = by * width + bx; y < 8; y++, row += width) {
          for (let x = 0; x < 8; x++) block[y * 8 + x] = data[row + x] - 128;
        }
      } else {
        for (let y = 0; y < 8; y++) {
          const row = Math.min(by + y, height - 1) * width;
          for (let x = 0; x < 8; x++) block[y * 8 + x] = data[row + Math.min(bx + x, width - 1)] - 128;
        }
      }
      forwardDct(block);
      let acNonZero = false;
      for (let i = 0; i < 64; i++) {
        const v = block[i] * toQuant[i];
        const q = v >= 0 ? Math.floor(v + 0.5) : -Math.floor(-v + 0.5);
        block[i] = q * fromQuant[i];
        if (q !== 0 && i !== 0) acNonZero = true;
      }
      if (acNonZero) inverseDct(block);
      else block.fill(block[0]);
      for (let y = 0; y < 8 && by + y < height; y++) {
        const row = (by + y) * width;
        for (let x = 0; x < 8 && bx + x < width; x++) {
          const v = Math.round(block[y * 8 + x] / 8 + 128);
          out.data[row + bx + x] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }
  }
  return out;
}
function forwardDct(d) {
  for (let o = 0; o < 64; o += 8) fdct8(d, o, 1);
  for (let o = 0; o < 8; o++) fdct8(d, o, 8);
}
function fdct8(d, o, s) {
  const d0 = d[o], d1 = d[o + s], d2 = d[o + 2 * s], d3 = d[o + 3 * s];
  const d4 = d[o + 4 * s], d5 = d[o + 5 * s], d6 = d[o + 6 * s], d7 = d[o + 7 * s];
  const tmp0 = d0 + d7, tmp7 = d0 - d7, tmp1 = d1 + d6, tmp6 = d1 - d6;
  const tmp2 = d2 + d5, tmp5 = d2 - d5, tmp3 = d3 + d4, tmp4 = d3 - d4;
  const tmp10 = tmp0 + tmp3, tmp13 = tmp0 - tmp3, tmp11 = tmp1 + tmp2, tmp12 = tmp1 - tmp2;
  d[o] = tmp10 + tmp11;
  d[o + 4 * s] = tmp10 - tmp11;
  const z1 = (tmp12 + tmp13) * 0.707106781;
  d[o + 2 * s] = tmp13 + z1;
  d[o + 6 * s] = tmp13 - z1;
  const o10 = tmp4 + tmp5, o11 = tmp5 + tmp6, o12 = tmp6 + tmp7;
  const z5 = (o10 - o12) * 0.382683433;
  const z2 = 0.5411961 * o10 + z5;
  const z4 = 1.306562965 * o12 + z5;
  const z3 = o11 * 0.707106781;
  const z11 = tmp7 + z3, z13 = tmp7 - z3;
  d[o + 5 * s] = z13 + z2;
  d[o + 3 * s] = z13 - z2;
  d[o + s] = z11 + z4;
  d[o + 7 * s] = z11 - z4;
}
function inverseDct(d) {
  for (let o = 0; o < 8; o++) idct8(d, o, 8);
  for (let o = 0; o < 64; o += 8) idct8(d, o, 1);
}
function idct8(d, o, s) {
  const e0 = d[o], e1 = d[o + 2 * s], e2 = d[o + 4 * s], e3 = d[o + 6 * s];
  const tmp10 = e0 + e2, tmp11 = e0 - e2, tmp13 = e1 + e3;
  const tmp12 = (e1 - e3) * 1.414213562 - tmp13;
  const tmp0 = tmp10 + tmp13, tmp3 = tmp10 - tmp13, tmp1 = tmp11 + tmp12, tmp2 = tmp11 - tmp12;
  const i4 = d[o + s], i5 = d[o + 3 * s], i6 = d[o + 5 * s], i7 = d[o + 7 * s];
  const z13 = i6 + i5, z10 = i6 - i5, z11 = i4 + i7, z12 = i4 - i7;
  const tmp7 = z11 + z13;
  const r11 = (z11 - z13) * 1.414213562;
  const z5 = (z10 + z12) * 1.847759065;
  const r10 = 1.0823922 * z12 - z5;
  const r12 = -2.61312593 * z10 + z5;
  const tmp6 = r12 - tmp7;
  const tmp5 = r11 - tmp6;
  const tmp4 = r10 + tmp5;
  d[o] = tmp0 + tmp7;
  d[o + 7 * s] = tmp0 - tmp7;
  d[o + s] = tmp1 + tmp6;
  d[o + 6 * s] = tmp1 - tmp6;
  d[o + 2 * s] = tmp2 + tmp5;
  d[o + 5 * s] = tmp2 - tmp5;
  d[o + 4 * s] = tmp3 + tmp4;
  d[o + 3 * s] = tmp3 - tmp4;
}
function assertImage(img) {
  if (img.data.length !== img.width * img.height) {
    throw new RangeError(`GrayImage data has ${img.data.length} bytes, expected ${img.width * img.height}`);
  }
}
function assertQuality(quality) {
  if (!(quality >= 1 && quality <= 100)) throw new RangeError(`JPEG quality must be 1..100, got ${quality}`);
}

// test/support/prng.ts
function fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}
function hashSeed(...parts) {
  let h = 2166136261;
  const mix = (byte) => {
    h ^= byte & 255;
    h = Math.imul(h, 16777619);
  };
  for (const part of parts) {
    const text = (typeof part === "number" ? "n" : "s") + String(part);
    mix(text.length);
    mix(text.length >>> 8);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      mix(c);
      mix(c >>> 8);
    }
  }
  return fmix32(h);
}
function inverseNormalCdf(p) {
  if (!(p > 0 && p < 1)) throw new RangeError(`p must be in (0, 1), got ${p}`);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (q2) => (((((c[0] * q2 + c[1]) * q2 + c[2]) * q2 + c[3]) * q2 + c[4]) * q2 + c[5]) / ((((d[0] * q2 + d[1]) * q2 + d[2]) * q2 + d[3]) * q2 + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
var Prng = class _Prng {
  /** u32 seed this generator was built from (used by `fork`). */
  seed;
  a;
  b;
  c;
  d;
  spareNormal = null;
  constructor(seed) {
    this.seed = typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 4294967295 ? seed : hashSeed(seed);
    let x = this.seed;
    const next = () => {
      x = x + 2654435769 >>> 0;
      return fmix32(x);
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 12; i++) this.u32();
  }
  /** Uniform u32. */
  u32() {
    const t = (this.a + this.b >>> 0) + this.d >>> 0;
    this.d = this.d + 1 >>> 0;
    this.a = this.b ^ this.b >>> 9;
    this.b = this.c + (this.c << 3) >>> 0;
    this.c = (this.c << 21 | this.c >>> 11) >>> 0;
    this.c = this.c + t >>> 0;
    return t;
  }
  /** Uniform float in [0, 1). */
  float() {
    return this.u32() / 4294967296;
  }
  /** Uniform float in [min, max). */
  range(min, max) {
    return min + (max - min) * this.float();
  }
  /** Uniform integer in [min, max], both inclusive. */
  int(min, max) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`invalid integer range [${min}, ${max}]`);
    }
    return min + Math.floor(this.float() * (max - min + 1));
  }
  /** Gaussian sample (Box–Muller; the second value of each pair is cached). */
  normal(mean = 0, sd = 1) {
    if (this.spareNormal !== null) {
      const z = this.spareNormal;
      this.spareNormal = null;
      return mean + sd * z;
    }
    const r = Math.sqrt(-2 * Math.log(1 - this.float()));
    const theta = 2 * Math.PI * this.float();
    this.spareNormal = r * Math.sin(theta);
    return mean + sd * r * Math.cos(theta);
  }
  /** True with probability p. */
  chance(p) {
    return this.float() < p;
  }
  /** Uniformly chosen element. */
  pick(items) {
    if (items.length === 0) throw new RangeError("pick() from an empty list");
    return items[Math.floor(this.float() * items.length)];
  }
  /**
   * Independent child stream identified by `label`. It depends only on this
   * generator's seed and the label, never on how many values were drawn, so
   * adding a random feature does not reshuffle the others.
   */
  fork(label) {
    return new _Prng(hashSeed(this.seed, label));
  }
};

// test/support/camera-sim.ts
var DEFAULT_FRAME = { width: 1280, height: 720 };
var DEFAULT_HFOV_DEG = 65;
function check(ok, message) {
  if (!ok) throw new RangeError(`camera-sim: ${message}`);
}
var finite = (v) => Number.isFinite(v);
var rad = (d) => d * Math.PI / 180;
function buildRig(source, p) {
  const frameW = p.frame?.width ?? DEFAULT_FRAME.width;
  const frameH = p.frame?.height ?? DEFAULT_FRAME.height;
  check(Number.isInteger(frameW) && Number.isInteger(frameH) && frameW > 0 && frameH > 0, "frame must be positive integers");
  check(Number.isInteger(source.width) && Number.isInteger(source.height) && source.width > 0 && source.height > 0, "empty source");
  const codeWidthPx = p.codeWidthPx ?? 0.6 * Math.min(frameW, frameH);
  const f = p.focalLengthPx ?? frameW / 2 / Math.tan(rad(DEFAULT_HFOV_DEG / 2));
  const downscale = p.downscale ?? 1;
  const tiltX = p.tiltXDeg ?? 0;
  const tiltY = p.tiltYDeg ?? 0;
  const curvature = p.curvature ?? 0;
  check(codeWidthPx > 0 && finite(codeWidthPx), "codeWidthPx must be > 0");
  check(f > 0 && finite(f), "focalLengthPx must be > 0");
  check(downscale >= 1 && finite(downscale), "downscale must be \u2265 1");
  check(Math.abs(tiltX) < 85 && Math.abs(tiltY) < 85, "tilts must be within \xB185\xB0");
  check(curvature >= 0 && curvature < 2 * Math.PI, "curvature must be in [0, 2\u03C0)");
  check(finite(p.rotationDeg ?? 0), "rotationDeg must be finite");
  check(Math.abs(p.barrelK1 ?? 0) <= 0.5, "barrelK1 must be within \xB10.5");
  check(finite(p.offset?.x ?? 0) && finite(p.offset?.y ?? 0), "offset must be finite");
  const scale2 = codeWidthPx / source.width;
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
    scale: scale2,
    f,
    cx: frameW / 2,
    cy: frameH / 2,
    r: mul3(Ry, mul3(Rx, Rz)),
    t: [p.offset?.x ?? 0, p.offset?.y ?? 0, f],
    rc: curvature > 0 ? source.width * scale2 / curvature : 0,
    k1: p.barrelK1 ?? 0
  };
}
function mul3(a, b) {
  const out = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return out;
}
function projectToFrame(rig, u, v) {
  const { r, t, rc } = rig;
  const x0 = (u - rig.srcW / 2) * rig.scale;
  const y = (v - rig.srcH / 2) * rig.scale;
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
function localScale(rig, u, v) {
  const p = projectToFrame(rig, u, v);
  const pu = projectToFrame(rig, u + 1, v);
  const pv = projectToFrame(rig, u, v + 1);
  if (!p || !pu || !pv) return rig.scale;
  return Math.sqrt(Math.abs((pu.x - p.x) * (pv.y - p.y) - (pu.y - p.y) * (pv.x - p.x)));
}
function valueNoise(w, h, cellsX, cellsY, rng) {
  const lattice = new Float32Array(cellsX * cellsY);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.float() * 2 - 1;
  const axis = (n, cells) => {
    const i0 = new Int32Array(n);
    const i1 = new Int32Array(n);
    const wt = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const g = (k + 0.5) * cells / n;
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
var materialCache = /* @__PURE__ */ new Map();
function materialTexture(kind, size) {
  const key = `${kind}:${size}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const rng = new Prng(`substrate:${kind}`);
  const tex = new Float32Array(size * size);
  const add = (field, amp) => {
    for (let i = 0; i < tex.length; i++) tex[i] += amp * field[i];
  };
  const noise = (cx, cy = cx) => valueNoise(size, size, Math.min(cx, size), Math.min(cy, size), rng);
  const grain = (amp) => {
    for (let i = 0; i < tex.length; i++) tex[i] += amp * (rng.float() * 2 - 1);
  };
  switch (kind) {
    case "paper":
      add(noise(6), 0.015);
      add(noise(48), 0.02);
      grain(0.025);
      break;
    case "textured-paper": {
      add(noise(8), 0.03);
      add(noise(36), 0.05);
      add(noise(110), 0.04);
      grain(0.03);
      for (let y = 0; y < size; y++) {
        const rib = 0.02 * Math.sin(2 * Math.PI * 64 * y / size);
        for (let x = 0; x < size; x++) tex[y * size + x] += rib;
      }
      break;
    }
    case "leather": {
      add(noise(4), 0.07);
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
    case "brushed-metal":
      add(noise(2, 384), 0.09);
      add(noise(8, 192), 0.06);
      add(noise(3), 0.05);
      grain(0.02);
      break;
  }
  materialCache.set(key, tex);
  return tex;
}
var CLUTTER_SUBSAMPLE = 4;
function clutterField(w, h, spec, rng) {
  const level = spec.level ?? 0.35;
  const contrast = spec.contrast ?? 0.6;
  const field = new Float32Array(w * h).fill(level);
  const low = valueNoise(w, h, 3, 2, rng);
  const mid = valueNoise(w, h, 12, 7, rng);
  for (let i = 0; i < field.length; i++) field[i] += contrast * (0.35 * low[i] + 0.12 * mid[i]);
  const shapes = 10 + rng.int(0, 8);
  const span = Math.min(w, h);
  for (let n = 0; n < shapes; n++) {
    const kind = rng.pick(["disc", "ring", "box", "bar"]);
    const cx = rng.range(0, w);
    const cy = rng.range(0, h);
    const size = rng.range(0.05, 0.35) * span;
    const theta = rng.range(0, Math.PI);
    const tone = Math.min(0.98, Math.max(0.02, level + contrast * rng.range(-1, 1)));
    const halfLen = kind === "bar" ? size : size / 2;
    const halfWid = kind === "bar" ? Math.max(0.75, size * rng.range(0.03, 0.12)) : size / 2 * rng.range(0.4, 1);
    const ringWidth = Math.max(1.5, size * rng.range(0.04, 0.15));
    const reach = Math.ceil(halfLen + ringWidth + 2);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    for (let y = Math.max(0, Math.floor(cy - reach)); y < Math.min(h, Math.ceil(cy + reach)); y++) {
      for (let x = Math.max(0, Math.floor(cx - reach)); x < Math.min(w, Math.ceil(cx + reach)); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        let dist;
        if (kind === "disc") dist = Math.sqrt(dx * dx + dy * dy) - size / 2;
        else if (kind === "ring") dist = Math.abs(Math.sqrt(dx * dx + dy * dy) - size / 2) - ringWidth / 2;
        else dist = Math.max(Math.abs(dx * cos + dy * sin) - halfLen, Math.abs(-dx * sin + dy * cos) - halfWid);
        const cover = Math.min(1, Math.max(0, 0.5 - dist));
        if (cover > 0) field[y * w + x] += (tone - field[y * w + x]) * cover;
      }
    }
  }
  return field;
}
function orientedShape(kind, x, y, a, b, angleDeg, value, rig, reachFactor) {
  const th = rad(angleDeg);
  return { cx: x * rig.srcW, cy: y * rig.srcH, ux: Math.sin(th), uy: -Math.cos(th), a, b, reach: a * reachFactor + 1, kind, value };
}
function resolveOccluders(spec, rig, rng, levels) {
  if (!spec) return [];
  let list;
  if ("count" in spec) {
    check(Number.isInteger(spec.count) && spec.count >= 0, "occlusion.count must be a non-negative integer");
    const kinds = spec.kinds ?? ["blob", "strip"];
    list = Array.from({ length: spec.count }, () => {
      const kind = rng.pick(kinds);
      return {
        kind,
        x: rng.range(0.15, 0.85),
        y: rng.range(0.15, 0.85),
        area: spec.area,
        aspect: kind === "blob" ? rng.range(0.45, 1) : rng.range(0.06, 0.2),
        angleDeg: rng.range(0, 180),
        // Ink-like (dirt, marker) or paper-like (abraded ink), relative to the material's own levels.
        level: rng.chance(0.6) ? levels.ink + (levels.paper - levels.ink) * rng.range(0, 0.2) : levels.paper * rng.range(0.96, 1)
      };
    });
  } else {
    list = spec;
  }
  const codeArea = rig.srcW * rig.srcH;
  return list.map((o) => {
    const aspect = o.aspect ?? (o.kind === "blob" ? 0.7 : 0.12);
    check(o.area > 0 && o.area <= 1 && aspect > 0 && aspect <= 1, "occluder area and aspect must be in (0, 1]");
    const area = o.area * codeArea;
    const a = o.kind === "blob" ? Math.sqrt(area / (Math.PI * aspect)) : Math.sqrt(area / aspect) / 2;
    return orientedShape(o.kind, o.x, o.y, a, a * aspect, o.angleDeg ?? 0, o.level ?? 0.08, rig, 1.5);
  });
}
function resolveGlare(spec, rig) {
  if (!spec) return [];
  const list = "x" in spec ? [spec] : spec;
  return list.map((g) => {
    const aspect = g.aspect ?? 0.6;
    check(g.radius > 0 && aspect > 0 && aspect <= 1, "glare radius must be > 0 and aspect in (0, 1]");
    const a = g.radius * rig.srcW;
    return orientedShape("glare", g.x, g.y, a, a * aspect, g.angleDeg ?? 0, g.intensity ?? 1.2, rig, 2.7);
  });
}
function sourceLevel(src, framePxPerSrcPx) {
  let level = { w: src.width, h: src.height, data: src.data, factor: 1 };
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
        data[y * w + x] = pd[r0 + x0] + pd[r0 + x1] + pd[r1 + x0] + pd[r1 + x1] + 2 >> 2;
      }
    }
    level = { w, h, data, factor: level.factor * 2 };
  }
  return level;
}
function simulateCapture(source, params = {}, seed = 0) {
  check(source.data.length === source.width * source.height, "source data length does not match its size");
  const rig = buildRig(source, params);
  const rng = new Prng(seed);
  let radiance = renderScene(source, rig, params, rng);
  radiance = blur(radiance, rig.frameW, rig.frameH, params);
  let img = expose(radiance, rig.frameW, rig.frameH, params.noise, rng.fork("noise"));
  if (params.jpegQuality !== void 0) {
    img = params.jpegCodec === "jpeg-js" ? encodeJpeg(img, params.jpegQuality) : encodeJpegFast(img, params.jpegQuality);
  }
  return rig.outW === rig.frameW && rig.outH === rig.frameH ? img : areaResample(img, rig.outW, rig.outH);
}
function renderScene(source, rig, p, rng) {
  const { frameW: W, frameH: H, srcW, srcH, rc, k1, f, cx, cy } = rig;
  const paper = p.paperLevel ?? 1;
  const ink = p.inkLevel ?? 0;
  check(paper >= 0 && paper <= 1 && ink >= 0 && ink <= 1, "paperLevel and inkLevel must be in [0, 1]");
  const toneGain = (paper - ink) / 255;
  const pxPerSrc = localScale(rig, srcW / 2, srcH / 2);
  const { w: lw, h: lh, data: lt, factor } = sourceLevel(source, pxPerSrc);
  const invFactor = 1 / factor;
  const margin = p.sheetMargin ?? 0;
  const marginX = (typeof margin === "number" ? margin : margin.x) * srcW;
  const marginY = (typeof margin === "number" ? margin : margin.y) * srcW;
  check(marginX >= 0 && marginY >= 0, "sheetMargin must be \u2265 0");
  const bounded = Number.isFinite(marginX) || Number.isFinite(marginY);
  const background = p.background ?? paper;
  check(typeof background === "object" || background >= 0 && background <= 1, "background level must be in [0, 1]");
  const clutterW = Math.ceil(W / CLUTTER_SUBSAMPLE);
  const clutterH = Math.ceil(H / CLUTTER_SUBSAMPLE);
  const clutter = typeof background === "object" ? clutterField(clutterW, clutterH, background, rng.fork("clutter")) : null;
  const flatBackground = typeof background === "number" ? background : 0;
  const backgroundAt = (fx, fy) => {
    if (!clutter) return flatBackground;
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
  const texSize = Math.min(1024, Math.max(256, 2 ** Math.ceil(Math.log2(Math.max(1, srcW * pxPerSrc)))));
  const texMask = texSize - 1;
  const texPerSrc = texSize / srcW;
  const substrate = p.substrate ?? "none";
  const texStrength = p.substrateStrength ?? 1;
  check(texStrength >= 0 && finite(texStrength), "substrateStrength must be \u2265 0");
  const tex = substrate === "none" || texStrength === 0 ? null : materialTexture(substrate, texSize);
  const texRng = rng.fork("substrate");
  const texOffU = texRng.int(0, texMask);
  const texOffV = texRng.int(0, texMask);
  const occluders = resolveOccluders(p.occlusion, rig, rng.fork("occlusion"), { paper, ink });
  const glares = resolveGlare(p.glare, rig);
  const gradStrength = p.illumination?.strength ?? 0;
  const gradAngle = rad(p.illumination?.angleDeg ?? 0);
  const halfDiag = Math.sqrt(W * W + H * H) / 2;
  const gx = Math.sin(gradAngle) * gradStrength / halfDiag;
  const gy = -Math.cos(gradAngle) * gradStrength / halfDiag;
  const vignette = (p.vignette ?? 0) / (halfDiag * halfDiag);
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
      let sx;
      let sy;
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
        const depth = rc - (oz + tHit * dz);
        sx = rc * Math.atan2(hx, depth);
        sy = oy + tHit * dy;
        shade = Math.sqrt(Math.max(0, depth / rc));
      }
      const u = sx * invScale + srcW / 2;
      const v = sy * invScale + srcH / 2;
      let sheet = 1;
      if (bounded) {
        const outside = Math.max(-marginX - u, u - srcW - marginX, -marginY - v, v - srcH - marginY);
        sheet = Math.min(1, Math.max(0, 0.5 - outside * pxPerSrc));
        if (sheet === 0) {
          out[i] = backgroundAt(fx, fy) * light;
          continue;
        }
      }
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
        let dist;
        if (o.kind === "strip") {
          dist = Math.max(Math.abs(along) - o.a, Math.abs(across) - o.b);
        } else {
          const ea = along / (o.a * o.a);
          const eb = across / (o.b * o.b);
          const rho = Math.sqrt(along * ea + across * eb);
          dist = rho > 1e-9 ? (rho - 1) * rho / Math.sqrt(ea * ea + eb * eb) : -o.b;
        }
        const cover = Math.min(1, Math.max(0, 0.5 - dist * pxPerSrc));
        refl += (o.value - refl) * cover;
      }
      if (tex) {
        const tu = u * texPerSrc - 0.5 + texOffU;
        const tv = v * texPerSrc - 0.5 + texOffV;
        const tu0 = Math.floor(tu);
        const tv0 = Math.floor(tv);
        const wu = tu - tu0;
        const t0 = (tv0 & texMask) * texSize;
        const t1 = (tv0 + 1 & texMask) * texSize;
        const c0 = tu0 & texMask;
        const c1 = tu0 + 1 & texMask;
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
        glare += g.value * Math.exp(-2 * (along * along / (g.a * g.a) + across * across / (g.b * g.b)));
      }
      const surface = refl * shade * light + glare * vig;
      out[i] = sheet === 1 ? surface : surface * sheet + backgroundAt(fx, fy) * light * (1 - sheet);
    }
  }
  return out;
}
function blur(img, w, h, p) {
  const sigma = p.blurSigma ?? 0;
  check(sigma >= 0 && finite(sigma), "blurSigma must be \u2265 0");
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
function convolveRows(src, w, h, kernel) {
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
function convolveColumns(src, w, h, kernel) {
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
function lineKernel(length, angle) {
  check(finite(length), "motionBlur.lengthPx must be finite");
  const n = Math.ceil(length) + 1;
  const ux = Math.sin(angle);
  const uy = -Math.cos(angle);
  const taps = /* @__PURE__ */ new Map();
  const deposit = (dx, dy, w) => {
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
    deposit(x0, y0, (1 - fx) * (1 - fy) / n);
    deposit(x0 + 1, y0, fx * (1 - fy) / n);
    deposit(x0, y0 + 1, (1 - fx) * fy / n);
    deposit(x0 + 1, y0 + 1, fx * fy / n);
  }
  return [...taps.values()];
}
function convolve(src, w, h, taps) {
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
var normalTable;
function normalDeviates() {
  normalTable ??= Float32Array.from({ length: 65536 }, (_, i) => inverseNormalCdf((i + 0.5) / 65536));
  return normalTable;
}
function expose(radiance, w, h, noise, rng) {
  const sigma = noise?.sigma ?? 0;
  const shot = noise?.shot ?? 0;
  check(sigma >= 0 && shot >= 0 && finite(sigma) && finite(shot), "noise sigma and shot must be \u2265 0");
  const img = createGray(w, h);
  const out = img.data;
  const noisy = sigma > 0 || shot > 0;
  const deviates = noisy ? normalDeviates() : null;
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
function areaResample(img, outW, outH) {
  const spans = (n, m) => Array.from({ length: m }, (_, i) => {
    const a = i * n / m;
    const b = (i + 1) * n / m;
    const parts = [];
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
var HANDHELD = {
  codeWidthPx: 400,
  offset: { x: 40, y: -25 },
  rotationDeg: 12,
  tiltXDeg: 12,
  tiltYDeg: -9,
  barrelK1: 0.02,
  sheetMargin: 0.35,
  background: { kind: "clutter" },
  substrate: "paper",
  paperLevel: 0.86,
  inkLevel: 0.1,
  illumination: { angleDeg: 300, strength: 0.18 },
  vignette: 0.25,
  blurSigma: 0.9,
  noise: { sigma: 1.5, shot: 0.04 },
  jpegQuality: 82
};
function freezeDeep(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
var PRESETS = freezeDeep({
  /** Face-on, centred, noiseless, uncompressed: the decoder's best case. */
  clean: {},
  typicalPhone: HANDHELD,
  /** Dim room: underexposed, strong fall-off, heavy noise, hand shake, stronger compression. */
  lowLight: {
    ...HANDHELD,
    rotationDeg: -7,
    tiltXDeg: 8,
    tiltYDeg: 6,
    background: { kind: "clutter", level: 0.15, contrast: 0.3 },
    paperLevel: 0.36,
    inkLevel: 0.05,
    illumination: { angleDeg: 120, strength: 0.35 },
    vignette: 0.45,
    blurSigma: 1.3,
    motionBlur: { lengthPx: 3, angleDeg: 20 },
    noise: { sigma: 4, shot: 0.5 },
    jpegQuality: 70
  },
  /** Glossy label under a lamp: a saturated highlight across the data orbits. */
  glare: {
    ...HANDHELD,
    glare: { x: 0.68, y: 0.34, radius: 0.16, aspect: 0.55, angleDeg: 35, intensity: 1.6 }
  },
  /** Steep 45° view: strong foreshortening and keystone. */
  tilted45: {
    ...HANDHELD,
    codeWidthPx: 460,
    offset: { x: 0, y: 0 },
    rotationDeg: 5,
    tiltXDeg: 45,
    tiltYDeg: 0
  },
  /** Blind deboss on a tan leather bag panel: low contrast, pebble grain, gentle bend. */
  leather: {
    ...HANDHELD,
    rotationDeg: -4,
    tiltXDeg: 6,
    tiltYDeg: 10,
    curvature: 0.45,
    sheetMargin: 0.5,
    background: { kind: "clutter", level: 0.2, contrast: 0.35 },
    substrate: "leather",
    paperLevel: 0.5,
    inkLevel: 0.2,
    illumination: { angleDeg: 45, strength: 0.3 },
    blurSigma: 1,
    noise: { sigma: 2.5, shot: 0.1 },
    jpegQuality: 80
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
    background: { kind: "clutter", level: 0.2, contrast: 0.3 },
    substrate: "brushed-metal",
    paperLevel: 0.72,
    inkLevel: 0.25,
    glare: { x: 0.58, y: 0.5, radius: 0.6, aspect: 0.1, angleDeg: 0, intensity: 0.9 }
  },
  /** Scuffed, dirty code: occluders (dirt, scratches, abrasion) on textured stock, noisy. */
  worn: {
    ...HANDHELD,
    substrate: "textured-paper",
    occlusion: { count: 5, area: 0.012 },
    blurSigma: 1.1,
    noise: { sigma: 3, shot: 0.15 },
    jpegQuality: 75
  },
  /** Far away / tiny print: 3 px per CODE-01 module (50 u across). */
  small: {
    ...HANDHELD,
    codeWidthPx: 150,
    blurSigma: 0.7
  }
});

// test/decoder/fixtures.ts
function makeCode(seed, opts = {}) {
  const rng = new Prng(`decoder-fixture-${seed}`);
  const identity = { year: rng.int(2e3, 2099), categoryIndex: rng.int(1, 31), serial: rng.int(1, 999999) };
  const nonce = Uint8Array.from({ length: 4 }, () => rng.int(0, 255));
  const payloadBytes = encodePayload({
    codeVersion: 1,
    genomeVersion: 1,
    keyId: rng.int(1, 255),
    identity,
    issue: rng.int(1, 255),
    issuedDay: rng.int(0, 65535),
    nonce
  });
  const signature = Uint8Array.from({ length: 64 }, () => rng.int(0, 255));
  const data = frameCodeData(payloadBytes, signature);
  const genomeGlyphs = computeGenome(packIdentity(identity)).glyphs;
  const model = encodeOrbesCode({ data, genomeGlyphs, ...opts.mask === void 0 ? {} : { mask: opts.mask } }, { decor: opts.decor ?? true });
  return { seed, data, payloadBytes, signature, genomeGlyphs, model };
}
var sourceCache = /* @__PURE__ */ new Map();
function renderCode(code, pxPerU, style = "classic") {
  const key = `${code.seed}/${code.model.mask}/${pxPerU}/${style}/${code.model.primitives.length}`;
  const cached = sourceCache.get(key);
  if (cached) return cached;
  const img = svgToGray(renderOrbesCodeSvg(code.model, ORBES_CODE_STYLES[style]), { widthPx: Math.round(CODE01_SIZE * pxPerU) });
  if (sourceCache.size > 64) sourceCache.clear();
  sourceCache.set(key, img);
  return img;
}

// ../../../../tmp/claude-0/-home-user-orbes-index/c69a4bc9-92e3-59d9-b46c-1319bf876532/scratchpad/fuzz.ts
var REASONS = /* @__PURE__ */ new Set(["NO_SEAL", "NO_MOONS", "FORMAT", "ECC", "CRC", "PAYLOAD"]);
var mode = process.argv[2] ?? "crash";
var N = Number(process.argv[3] ?? 200);
function gray(w, h, f) {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = Math.max(0, Math.min(255, Math.round(f(x, y))));
  return { width: w, height: h, data };
}
function drawRings(img, rng, count, scale2) {
  for (let n = 0; n < count; n++) {
    const cx = rng.range(0, img.width), cy = rng.range(0, img.height);
    const u = scale2 * rng.range(0.5, 2);
    const kind = rng.int(0, 4);
    const bands = kind === 0 ? [[0, 2 * u], [3 * u, 4 * u]] : kind === 1 ? [[0, 1.75 * u]] : kind === 2 ? [[0, 2 * u], [3 * u, 4 * u], [6 * u, 7 * u], [9 * u, 10 * u]] : kind === 3 ? Array.from({ length: 8 }, (_, k) => [k * 1.5 * u, (k * 1.5 + 0.75) * u]) : [[2 * u, 2.4 * u]];
    const tone = rng.chance(0.7) ? rng.int(0, 60) : rng.int(180, 255);
    const R = Math.max(...bands.map((b) => b[1])) + 1;
    for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(img.height, cy + R); y++)
      for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(img.width, cx + R); x++) {
        const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (bands.some(([a, b]) => r >= a && r < b)) img.data[y * img.width + x] = tone;
      }
  }
}
function negative(rng, t) {
  const kind = rng.int(0, 7);
  const w = rng.pick([320, 640, 1280]), h = Math.round(w * 9 / 16);
  switch (kind) {
    case 0: {
      const blank = gray(400, 400, () => 255);
      const preset = rng.pick(["typicalPhone", "lowLight", "glare", "leather", "metal", "worn"]);
      return { kind: "clutter-" + preset, img: simulateCapture(blank, { ...PRESETS[preset], rotationDeg: rng.range(0, 360), sheetMargin: rng.range(0, 0.5), background: { kind: "clutter", level: rng.range(0.1, 0.8), contrast: rng.range(0.2, 1) } }, t) };
    }
    case 1:
      return { kind: "noise", img: gray(w, h, () => rng.int(0, 255)) };
    case 2: {
      const img = gray(w, h, (x, y) => 128 + 100 * Math.sin(x / rng.range(2, 40)) * Math.cos(y / 17));
      drawRings(img, rng, rng.int(5, 40), rng.range(2, 12));
      return { kind: "bullseyes", img };
    }
    case 3: {
      const img = gray(w, h, () => 230);
      drawRings(img, rng, rng.int(20, 80), rng.range(1.5, 8));
      return { kind: "bullseyes-white", img };
    }
    case 4: {
      const data = Uint8Array.from({ length: 79 }, () => rng.int(0, 255));
      const model = encodeOrbesCode({ data, genomeGlyphs: Array.from({ length: 8 }, () => rng.int(0, 15)) });
      const src = svgToGray(renderOrbesCodeSvg(model), { widthPx: 800 });
      return { kind: "random-data-code", img: simulateCapture(src, { ...PRESETS.typicalPhone, rotationDeg: rng.range(0, 360), codeWidthPx: rng.range(4, 8) * CODE01_SIZE }, t) };
    }
    case 5: {
      const code = makeCode(900 + t % 7);
      const src = renderCode(code, 8);
      const out = { ...src, data: src.data.slice() };
      const c = src.width / 2;
      for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
        const r = Math.hypot(x + 0.5 - c, y + 0.5 - c) / 8;
        if (r > 10 && r < 23 && rng.chance(0.6)) out.data[y * src.width + x] = rng.chance(0.5) ? 10 : 245;
      }
      return { kind: "scrambled-code", img: simulateCapture(out, { ...PRESETS.typicalPhone, rotationDeg: rng.range(0, 360), codeWidthPx: 6 * CODE01_SIZE }, t) };
    }
    case 6: {
      const img = gray(w, h, (x, y) => (Math.floor(x / rng.int(2, 9)) + Math.floor(y / 5)) % 2 ? 20 : 235);
      return { kind: "checker", img };
    }
    default: {
      const img = gray(w, h, (x, y) => x * 255 / w);
      drawRings(img, rng, rng.int(1, 10), rng.range(2, 20));
      return { kind: "gradient-rings", img };
    }
  }
}
function anyInput(rng, t) {
  const opts = rng.pick([void 0, null, {}, { tryInverted: false }, { tryMirrored: true }, { maxSealCandidates: rng.pick([0, 1, 16, -1, 1e9, Number.NaN, Infinity, 2.5]) }, { readGenome: false }, "x", 42]);
  const k = rng.int(0, 9);
  if (k === 0) {
    const w = rng.pick([0, 1, 11, 12, 13, -5, 2.5, Number.NaN, 1e9, 3]);
    const h = rng.pick([0, 1, 12, 64, -1, Number.POSITIVE_INFINITY, 7]);
    const len = rng.pick([0, 1, 100, 4096]);
    return { kind: `malformed ${w}x${h} len ${len}`, img: { width: w, height: h, data: rng.chance(0.5) ? new Uint8Array(len) : new Uint8ClampedArray(len) }, opts };
  }
  if (k === 1) return { kind: "non-object", img: rng.pick([void 0, null, 0, "img", [], { width: 10 }, { data: new Uint8Array(10) }]), opts };
  if (k === 2) {
    const w = rng.pick([12, 13, 2e3, 5e3]), h = w > 100 ? rng.int(12, 20) : rng.int(12, 4e3);
    return { kind: `strip ${w}x${h}`, img: gray(w, h, () => rng.int(0, 255)), opts };
  }
  if (k === 3) {
    const code = makeCode(700 + t % 5);
    const src = renderCode(code, rng.pick([2, 3, 6, 12]));
    const x0 = rng.int(0, src.width - 12), y0 = rng.int(0, src.height - 12);
    const w = rng.int(12, src.width - x0), h = rng.int(12, src.height - y0);
    const crop = gray(w, h, (x, y) => src.data[(y0 + y) * src.width + x0 + x]);
    return { kind: `crop ${w}x${h}`, img: crop, opts };
  }
  if (k === 4) {
    const w = 300, h = 300;
    const big = new Uint8ClampedArray(w * h + 777);
    for (let i = 0; i < big.length; i++) big[i] = rng.int(0, 255);
    return { kind: "offset view", img: { width: w, height: h, data: new Uint8ClampedArray(big.buffer, 777, w * h) }, opts };
  }
  if (k === 5) return { kind: "constant", img: gray(rng.int(12, 900), rng.int(12, 900), () => rng.pick([0, 255, 128])), opts };
  if (k === 6) {
    const code = makeCode(800 + t % 5);
    const src = renderCode(code, 5);
    const g = rng.range(0.01, 4), o = rng.range(-300, 300);
    return { kind: "gain", img: gray(src.width, src.height, (x, y) => src.data[y * src.width + x] * g + o), opts };
  }
  if (k === 7) {
    const w = rng.int(12, 1500), h = rng.int(12, 1500);
    const img = gray(w, h, () => rng.int(200, 255));
    drawRings(img, rng, rng.int(1, 60), rng.range(0.5, 30));
    return { kind: `rings ${w}x${h}`, img, opts };
  }
  if (k === 8) {
    const code = makeCode(600 + t % 5);
    const ppu = rng.pick([0.5, 1, 1.5, 40, 60]);
    const src = renderCode(code, Math.max(1, ppu));
    const W = rng.int(Math.min(src.width, 200), Math.max(200, src.width));
    const s = ppu < 1 ? ppu : 1;
    return { kind: `scaled ${ppu}`, img: simulateCapture(src, { codeWidthPx: ppu * CODE01_SIZE, frame: { width: Math.max(16, Math.round(W * s)), height: Math.max(16, Math.round(W * s * 0.75)) }, rotationDeg: rng.range(0, 360) }, t), opts };
  }
  return { kind: "negative", img: negative(rng, t).img, opts };
}
var crashes = 0;
var positives = 0;
var bad = 0;
var times = [];
var byKind = {};
for (let t = 0; t < N; t++) {
  const rng = new Prng(hashSeed("fuzz", mode, t));
  const input = mode === "fp" ? { ...negative(rng, t), opts: { tryMirrored: true } } : anyInput(rng, t);
  let res;
  const t0 = performance.now();
  try {
    res = decodeOrbesCode(input.img, input.opts);
  } catch (e) {
    crashes++;
    console.log(`THROW #${t} ${input.kind}: ${e.message}`);
    continue;
  }
  const dt = performance.now() - t0;
  times.push(dt);
  const kk = input.kind.split(" ")[0];
  byKind[kk] = { n: (byKind[kk]?.n ?? 0) + 1, max: Math.max(byKind[kk]?.max ?? 0, dt) };
  if (res.ok) {
    if (mode === "fp") {
      positives++;
      console.log(`FALSE POSITIVE #${t} ${input.kind}`);
    }
  } else {
    if (!REASONS.has(res.reason) || !Number.isFinite(res.elapsedMs)) {
      bad++;
      console.log(`BAD RESULT #${t}`, res);
    }
    if (res.detail?.startsWith("internal error")) {
      crashes++;
      console.log(`INTERNAL #${t} ${input.kind}: ${res.detail}`);
    }
  }
}
times.sort((a, b) => a - b);
console.log(`${mode}: ${N} inputs, internal errors/throws ${crashes}, malformed results ${bad}, positives ${positives}; time median ${times[times.length >> 1].toFixed(0)} ms p95 ${times[Math.floor(times.length * 0.95)].toFixed(0)} ms max ${times[times.length - 1].toFixed(0)} ms`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, `${v.n} max ${v.max.toFixed(0)}ms`]))));
