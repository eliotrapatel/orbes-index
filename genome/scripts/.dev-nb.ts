import { CODE01_RINGS, CODE01_TOTAL_CELLS, cellRef } from '../src/core/code/profile.js';
const TAU = Math.PI * 2;
function count(rr: number, ar: number) {
  let tot = 0, min = 1e9, max = 0;
  for (let i = 0; i < CODE01_TOTAL_CELLS; i++) {
    const a = cellRef(i); const sa = CODE01_RINGS[a.ring]; const ti = ((a.cell + 0.5) * TAU) / sa.cells;
    let n = 0;
    for (let k = Math.max(0, a.ring - rr); k <= Math.min(12, a.ring + rr); k++) { const s = CODE01_RINGS[k]; for (let c = 0; c < s.cells; c++) { let d = Math.abs(((c + 0.5) * TAU) / s.cells - ti); if (d > Math.PI) d = TAU - d; if (d <= ar / s.radius) n++; } }
    tot += n; min = Math.min(min, n); max = Math.max(max, n);
  }
  console.log(rr, ar, (tot / CODE01_TOTAL_CELLS).toFixed(1), min, max);
}
count(2, 4); count(1, 1.6); count(1, 1.1);
