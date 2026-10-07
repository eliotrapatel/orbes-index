/**
 * Product page view model (master spec §22):
 *
 *   PRODUCT      O26-J-00184
 *   GENOME       [visual]
 *   CODE STATUS  ACTIVE
 *   SIGNATURE    VALID
 *   SCAN COUNT   …
 *   OWNERSHIP    …
 *   WARRANTY     …
 *   ANOMALIES    …
 *
 * plus which actions the current admin can take. Pure, so the rules that
 * decide what an operator is offered are unit-tested without a browser.
 */
import { formatCount, formatDate, humanize, versionLabel } from '../format.js';
import type { AdminRole, CodeJson, LiveCodeCheck, ProductDetail, ProductStatus, ServiceRecord } from '../types.js';
import { can } from './permissions.js';
import { toneOf, type Tone } from './tone.js';

export interface SheetRow {
  key: string;
  label: string;
  value: string;
  tone: Tone;
  note?: string;
  mono?: boolean;
  /** A quantity, not a status: shown without a status mark. */
  plain?: boolean;
}

type DetailCode = CodeJson & { verification: LiveCodeCheck };

/** The code a scan would currently be judged by: the ACTIVE one, else the latest issue. */
export function primaryCode(codes: readonly DetailCode[]): DetailCode | null {
  if (codes.length === 0) return null;
  return codes.find((c) => c.status === 'ACTIVE') ?? [...codes].sort((a, b) => b.issue - a.issue)[0];
}

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

export function openAnomalies(d: Pick<ProductDetail, 'anomalies'>) {
  return d.anomalies.filter((a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED');
}

export function productSheet(d: ProductDetail): SheetRow[] {
  const p = d.product;
  const code = primaryCode(d.codes);
  const open = openAnomalies(d);
  const worst = SEVERITY_ORDER.find((s) => open.some((a) => a.severity === s));
  const owner = d.ownership.current;
  const w = d.warranty;

  const rows: SheetRow[] = [
    { key: 'product', label: 'Product', value: p.productId, tone: 'solid', note: `${humanize(p.model.name)} · ${humanize(p.model.type)}` },
    {
      key: 'status',
      label: 'Lifecycle',
      value: humanize(d.lifecycle.status),
      tone: toneOf('product', d.lifecycle.status),
      ...(d.lifecycle.returnTo ? { note: `Returns to ${humanize(d.lifecycle.returnTo)}` } : {}),
    },
    d.genome
      ? { key: 'genome', label: 'Genome', value: d.genome.fingerprint, tone: 'solid', mono: true, note: `${d.genome.versionLabel} · 8 glyphs` }
      : { key: 'genome', label: 'Genome', value: 'NONE', tone: 'alert' },
  ];

  if (code) {
    rows.push({
      key: 'code',
      label: 'Code status',
      value: humanize(code.status),
      tone: toneOf('code', code.status),
      note: `${versionLabel('CODE', code.codeVersion)} · Issue ${code.issue} · Key #${code.keyId}`,
    });
    rows.push(
      code.verification.valid
        ? { key: 'signature', label: 'Signature', value: 'VALID', tone: 'solid', note: `Ed25519 · re-verified live · key ${humanize(code.verification.keyStatus)}` }
        : { key: 'signature', label: 'Signature', value: 'INVALID', tone: 'critical', note: humanize(code.verification.reason) },
    );
  } else {
    rows.push({ key: 'code', label: 'Code status', value: 'NONE', tone: 'alert', note: 'No code issued' });
    rows.push({ key: 'signature', label: 'Signature', value: '—', tone: 'muted' });
  }

  rows.push({
    key: 'scans',
    label: 'Scan count',
    value: formatCount(d.scans.count),
    tone: 'solid',
    plain: true,
    note: d.scans.lastAt ? `Last ${formatDate(d.scans.lastAt)}` : 'Never scanned',
  });

  const ownerNote = owner
    ? [owner.verified ? 'Verified' : 'Unverified', humanize(owner.acquiredVia), `Since ${formatDate(owner.since)}`, owner.transferPending ? 'Transfer pending' : null]
        .filter(Boolean)
        .join(' · ')
    : 'No registered owner';
  rows.push({ key: 'ownership', label: 'Ownership', value: humanize(p.ownershipState), tone: toneOf('ownership', p.ownershipState), note: ownerNote });

  const ws = w?.status ?? 'NOT_STARTED';
  const wNote = !w
    ? 'Not activated'
    : ws === 'VOID'
      ? `Voided ${formatDate(w.voidedAt)}${w.voidReason ? ` · ${w.voidReason}` : ''}`
      : w.startDate
        ? `${formatDate(w.startDate)} → ${formatDate(w.endDate)}`
        : 'Not activated';
  rows.push({ key: 'warranty', label: 'Warranty', value: humanize(ws), tone: toneOf('warranty', ws), note: wNote });

  rows.push(
    open.length === 0
      ? { key: 'anomalies', label: 'Anomalies', value: 'NONE', tone: 'solid', note: d.anomalies.length ? `${d.anomalies.length} closed` : 'No findings' }
      : {
          key: 'anomalies',
          label: 'Anomalies',
          value: `${open.length} OPEN`,
          tone: worst === 'CRITICAL' ? 'critical' : 'alert',
          note: `Highest severity ${worst}`,
        },
  );
  return rows;
}

/** Statuses from which a product can no longer receive a printed code (mirrors issuance NOT_PRINTABLE). */
const NOT_PRINTABLE: ReadonlySet<ProductStatus> = new Set(['RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN']);
const WARRANTY_ACTIVATABLE: ReadonlySet<ProductStatus> = new Set(['ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED', 'TRANSFERRED', 'SERVICED', 'RESOLD']);
const MAX_ISSUE = 255;

export interface ProductActions {
  /** Lifecycle targets this admin may choose (REVOKED only for ADMIN). */
  transitions: ProductStatus[];
  canReinstate: boolean;
  canReissue: boolean;
  /** The ACTIVE code an ADMIN may revoke, if any. */
  revocableCodeId: string | null;
  canDownload: boolean;
  canActivateWarranty: boolean;
  canVoidWarranty: boolean;
  /** Add months to a started, non-void warranty (POST …/warranty/extend). */
  canExtendWarranty: boolean;
  canOpenService: boolean;
  /** Open service records the admin may complete (never a YEARLY_CARE one). */
  completableServices: ServiceRecord[];
  canConfirmOwnership: boolean;
}

export function productActions(d: ProductDetail, role: AdminRole): ProductActions {
  const status = d.lifecycle.status;
  const active = d.codes.find((c) => c.status === 'ACTIVE') ?? null;
  const maxIssue = d.codes.reduce((m, c) => Math.max(m, c.issue), 0);
  const w = d.warranty;
  const owner = d.ownership.current;
  return {
    transitions: can(role, 'transition') ? d.lifecycle.allowed.filter((s) => (s !== 'REVOKED' && s !== 'RETIRED') || can(role, 'revokeProduct')) : [],
    canReinstate: d.lifecycle.canReinstate && can(role, 'reinstate'),
    canReissue: can(role, 'reissueCode') && !NOT_PRINTABLE.has(status) && maxIssue < MAX_ISSUE,
    revocableCodeId: active && can(role, 'revokeCode') ? active.id : null,
    canDownload: can(role, 'download'),
    // Not during a pre-sale service (ISSUED → SERVICED, its return target ISSUED): the server refuses it until the service closes.
    canActivateWarranty: can(role, 'warranty') && WARRANTY_ACTIVATABLE.has(status) && !(status === 'SERVICED' && d.lifecycle.returnTo === 'ISSUED') && !w?.startDate && !w?.voidedAt,
    canVoidWarranty: can(role, 'warranty') && !w?.voidedAt,
    canExtendWarranty: can(role, 'warranty') && !!w?.startDate && !w?.voidedAt,
    canOpenService: can(role, 'service') && d.lifecycle.allowed.includes('SERVICED'),
    // Not a YEARLY_CARE record: the Yearly care board closes it with its request (the server refuses it here).
    completableServices: can(role, 'service') ? d.services.filter((s) => s.status === 'OPEN' && s.type !== 'YEARLY_CARE') : [],
    canConfirmOwnership: can(role, 'confirmOwnership') && owner !== null && !owner.verified,
  };
}

/**
 * Product attribute rows (the second block of the page): catalogue and
 * production facts, never cryptographic ones.
 */
export function productAttributes(d: ProductDetail): { label: string; value: string; mono?: boolean }[] {
  const p = d.product;
  return [
    { label: 'Category', value: `${humanize(p.category.name)} · ${p.category.code}` },
    { label: 'Collection', value: humanize(p.collection) },
    { label: 'Model', value: humanize(p.model.name) },
    { label: 'Type', value: humanize(p.model.type) },
    // The piece's field set at issuance: its size (NOCTURNE N1, formerly Variant), as written.
    { label: 'Size', value: p.variant ? humanize(p.variant) : '—' },
    { label: 'Material', value: humanize(p.material) },
    { label: 'SKU', value: p.sku, mono: true },
    { label: 'Production batch', value: p.productionBatch ?? '—', mono: !!p.productionBatch },
    { label: 'Production date', value: formatDate(p.productionDate) },
    { label: 'Created', value: formatDate(p.createdAt) },
    { label: 'Serial', value: String(p.serial).padStart(5, '0'), mono: true },
    { label: 'Authentication policy', value: humanize(p.authPolicy.replace(/\+/g, ' + ')) },
    { label: 'Claim code', value: p.hasClaimSecret ? 'ISSUED (HASH STORED)' : 'NONE' },
  ];
}
