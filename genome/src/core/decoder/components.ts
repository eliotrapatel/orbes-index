/**
 * Connected components of a binary image, with the moments needed to tell a
 * filled disc (seen as an ellipse under perspective) from anything else.
 *
 * Used by the moon-first fallback: when the seal itself is unreadable
 * (scratched, under a glare stripe, crossed by a strip), the four moons still
 * locate the code.
 *
 * Isomorphic: no Node.js or DOM dependencies.
 */

export interface Blob {
  /** Centroid in image coordinates (pixel centres at +0.5). */
  x: number;
  y: number;
  area: number;
  /** Semi-axes of the moment-equivalent ellipse (px) and fill ratio area / (π·a·b). */
  a: number;
  b: number;
  fill: number;
  /** Direction of the major axis (radians, image x axis towards y). */
  theta: number;
}

function find(parent: Int32Array, i: number): number {
  let r = i;
  while (parent[r] !== r) r = parent[r];
  // Path compression keeps later lookups short.
  while (parent[i] !== r) {
    const next = parent[i];
    parent[i] = r;
    i = next;
  }
  return r;
}

/**
 * 4-connected components of the ink pixels (value 1) whose area lies in
 * [minArea, maxArea], in two raster passes with union-find on provisional
 * labels. At most `maxLabels` provisional labels are tracked: beyond that the
 * frame is texture, not a scene with a code, and the search gives up.
 */
export function inkBlobs(bin: Uint8Array, w: number, h: number, minArea: number, maxArea: number, maxLabels = 50_000): Blob[] {
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
  // Resolve every provisional label to its root once, then accumulate moments per root.
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
  const blobs: Blob[] = [];
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
    // A filled ellipse with semi-axes a, b has second moments a²/4 and b²/4.
    const a = 2 * Math.sqrt(Math.max(0, mean + d));
    const b = 2 * Math.sqrt(Math.max(0, mean - d));
    if (!(b > 0)) continue;
    blobs.push({ x: mx, y: my, area: A, a, b, fill: A / (Math.PI * a * b), theta: 0.5 * Math.atan2(2 * cxy, cxx - cyy) });
  }
  return blobs;
}
