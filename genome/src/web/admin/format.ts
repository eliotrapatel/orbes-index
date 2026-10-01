/**
 * Pure formatters for the console. Dates are shown in UTC: operators in
 * Paris, workshops and auditors elsewhere must read the same instant, and
 * the audit log is in UTC too.
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function toDate(v: string | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00.000Z`) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `01 OCT 2026` (UTC). Em dash when absent or invalid. */
export function formatDate(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `01 OCT 2026 · 14:32 UTC`. */
export function formatDateTime(v: string | Date | null | undefined, opts: { seconds?: boolean } = {}): string {
  const d = toDate(v);
  if (!d) return '—';
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${opts.seconds ? `:${pad(d.getUTCSeconds())}` : ''}`;
  return `${formatDate(d)} · ${time} UTC`;
}

/** Short relative age (`JUST NOW`, `12 MIN AGO`, `3 H AGO`, `5 D AGO`), falling back to the date after 30 days. */
export function formatAge(v: string | Date | null | undefined, now: Date): string {
  const d = toDate(v);
  if (!d) return '—';
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  if (s < 0) return formatDate(d);
  if (s < 60) return 'JUST NOW';
  if (s < 3600) return `${Math.floor(s / 60)} MIN AGO`;
  if (s < 86_400) return `${Math.floor(s / 3600)} H AGO`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)} D AGO`;
  return formatDate(d);
}

/** Integer with thin-space thousands (`12 480`), the typographic convention of the brand. */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const s = String(Math.trunc(Math.abs(n)));
  return sign + s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** `ACTIVE`, `COUNTERFEIT FLAGGED`, `AUTHENTIC — FIRST REGISTRATION`-like labels from enum values. */
export function humanize(v: string | null | undefined): string {
  if (!v) return '—';
  return v.replace(/_/g, ' ').toUpperCase();
}

/** First and last characters of a long hash: `3f9a1c…e04b`. Short values are returned unchanged. */
export function shortHash(v: string | null | undefined, head = 8, tail = 4): string {
  if (!v) return '—';
  if (v.length <= head + tail + 1) return v;
  return `${v.slice(0, head)}…${v.slice(-tail)}`;
}

/** Hex/base32 in groups of `size` for reading aloud or comparing by eye. */
export function groupChars(v: string, size = 4, sep = ' '): string {
  const out: string[] = [];
  for (let i = 0; i < v.length; i += size) out.push(v.slice(i, i + size));
  return out.join(sep);
}

/** `CODE-01`, `GENOME-01` labels from version numbers. */
export function versionLabel(kind: 'CODE' | 'GENOME', version: number | null | undefined): string {
  if (version === null || version === undefined) return '—';
  return `${kind}-${pad(version)}`;
}

/** Percent with no decimals for bar captions, never NaN. */
export function percent(part: number, whole: number): string {
  if (!(whole > 0)) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

/** One-line rendering of a JSON details object for tables (`key: value · key: value`). */
export function summarizeDetails(details: Record<string, unknown> | null | undefined, max = 140): string {
  if (!details || typeof details !== 'object') return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(details)) {
    if (v === null || v === undefined) continue;
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    parts.push(`${k}: ${s}`);
  }
  const line = parts.join(' · ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Today's date as `YYYY-MM-DD` (UTC) for date inputs. */
export function isoDay(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
