/**
 * Dashboard view model: KPI figures and hairline bar rows. Bars are scaled
 * to the largest value (legible even when one status dominates) and carry
 * their share of the total as a caption.
 */
import { formatCount, humanize, percent } from '../format.js';
import { ANOMALY_SEVERITIES, PRODUCT_STATUSES, type DashboardData } from '../types.js';
import { toneOf, type Tone } from './tone.js';

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** Bar length 0..1, relative to the largest row. */
  fraction: number;
  /** Share of the total, e.g. `42%`. */
  share: string;
  tone: Tone;
}

export interface Kpi {
  key: string;
  label: string;
  value: string;
  note: string;
  tone: Tone;
}

function bars(entries: [string, number][], domain: 'product' | 'severity', keepZero: boolean): BarRow[] {
  const values = entries.map(([, v]) => (Number.isFinite(v) && v > 0 ? v : 0));
  const max = Math.max(0, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return entries
    .map(([k], i) => ({
      key: k,
      label: humanize(k),
      value: values[i],
      fraction: max > 0 ? values[i] / max : 0,
      share: percent(values[i], total),
      tone: toneOf(domain, k),
    }))
    .filter((r) => keepZero || r.value > 0);
}

/** Products by status, in lifecycle order. Zero rows are kept for the primary statuses only. */
export function statusBars(byStatus: Partial<Record<string, number>>): BarRow[] {
  const primary = new Set(['ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED']);
  return bars(
    PRODUCT_STATUSES.map((s) => [s, byStatus[s] ?? 0]),
    'product',
    true,
  ).filter((r) => r.value > 0 || primary.has(r.key));
}

/** Open anomalies by severity, most severe first; all four rows always shown. */
export function severityBars(bySeverity: Partial<Record<string, number>>): BarRow[] {
  return bars(
    [...ANOMALY_SEVERITIES].reverse().map((s) => [s, bySeverity[s] ?? 0]),
    'severity',
    true,
  );
}

export function dashboardKpis(d: DashboardData): Kpi[] {
  const critical = d.anomalies.openBySeverity.CRITICAL ?? 0;
  return [
    { key: 'products', label: 'Products', value: formatCount(d.products.total), note: 'ISSUED IDENTITIES', tone: 'solid' },
    { key: 'scans24', label: 'Verifications · 24 h', value: formatCount(d.scans.last24h), note: `${formatCount(d.scans.last7d)} IN 7 DAYS`, tone: 'solid' },
    {
      key: 'anomalies',
      label: 'Open anomalies',
      value: formatCount(d.anomalies.open),
      note: critical > 0 ? `${formatCount(critical)} CRITICAL` : 'NONE CRITICAL',
      tone: critical > 0 ? 'critical' : 'solid',
    },
    {
      key: 'key',
      label: 'Signing key',
      value: d.activeKey ? `#${d.activeKey.keyId}` : '—',
      // The kid is case-sensitive: shown as is (the stylesheet does not uppercase notes).
      note: d.activeKey ? d.activeKey.kid : 'NO ACTIVE KEY — ISSUANCE HALTED',
      tone: d.activeKey ? 'solid' : 'critical',
    },
  ];
}
