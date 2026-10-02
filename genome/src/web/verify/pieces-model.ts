/**
 * MY PIECES view-model (F-01): one owned piece (GET /api/v1/account/products) → what its plate and its
 * tabs show. Pure (no DOM) and unit-tested, like the result's view-model, whose helpers it shares: the
 * product lines, the WARRANTY rows and sentence, the dates.
 *
 * The owner's view says what the registry holds about their own piece: since when it is theirs, how
 * they acquired it, whether their ownership is verified, a transfer under way, the warranty, the
 * services, and their own declaration (LOST or STOLEN). It never names an internal status.
 */
import { PIECES } from './copy.js';
import type { IncidentType, OwnedPiece, ServiceRecord } from './types.js';
import { formatDate, formatDateLong, productLines, upper, validGlyphs, warrantyModel, type GenomeModel, type Row } from './view-model.js';

export type PieceTabId = 'ownership' | 'warranty' | 'service';

export const PIECE_TABS: readonly PieceTabId[] = ['ownership', 'warranty', 'service'];

export const PIECE_TAB_LABELS: Readonly<Record<PieceTabId, string>> = PIECES.tabs;

/**
 * What the OWNERSHIP panel offers about loss and theft:
 *   reportable   — not reported: REPORT LOST / STOLEN (confirmed);
 *   found        — a LOST the owner reported: PIECE FOUND (confirmed);
 *   with-services — a STOLEN, or a LOST ORBES Client Services recorded: their contact, nothing to press.
 */
export type IncidentMode = { kind: 'reportable' } | { kind: 'found' } | { kind: 'with-services'; type: IncidentType };

export interface PieceModel {
  productId: string;
  /** For element ids: the product id in lower case (`o26-j-00184`). */
  key: string;
  /** The GENOME on the plate; absent when the server sent none, or one the app cannot draw faithfully. */
  genome?: GenomeModel;
  /** MODEL / TYPE / CATEGORY / MATERIAL / CREATED YYYY. */
  productLines: string[];
  /** The status line of the OWNERSHIP panel. */
  status: string;
  ownershipRows: Row[];
  /** A sentence under the rows: a pending transfer, a service, an ownership not yet verified. */
  ownershipNotes: string[];
  transferPending: boolean;
  incident: IncidentMode;
  warranty?: { status: string; rows: Row[]; note: string };
}

const PRODUCT_ID = /^O[0-9]{2}-[A-Z]-[0-9]{5,6}$/;

/** GENOME-01 for version 1, as the verification response names it. */
function genomeLabel(version: number): string {
  return `GENOME-${String(version).padStart(2, '0')}`;
}

export function pieceModel(p: OwnedPiece): PieceModel {
  const productId = typeof p.productId === 'string' && PRODUCT_ID.test(p.productId) ? p.productId : '';
  const incident: IncidentMode =
    p.incident === 'LOST' && p.incidentResolvable === true
      ? { kind: 'found' }
      : p.incident === 'LOST' || p.incident === 'STOLEN'
        ? { kind: 'with-services', type: p.incident }
        : { kind: 'reportable' };
  const transferPending = p.transfer?.pending === true && incident.kind === 'reportable';

  let status: string = PIECES.status.yours;
  if (p.incident === 'LOST') status = PIECES.status.lost;
  else if (p.incident === 'STOLEN') status = PIECES.status.stolen;
  else if (transferPending) status = PIECES.status.transfer;
  else if (p.inService) status = PIECES.status.service;

  const rows: Row[] = [];
  if (p.since) rows.push(['SINCE', formatDate(p.since)]);
  const via = PIECES.acquired[p.acquiredVia as keyof typeof PIECES.acquired];
  if (via) rows.push(['ACQUIRED', via]);
  rows.push(['OWNERSHIP', p.verified ? PIECES.verified : PIECES.unverified]);
  if (transferPending) rows.push(['TRANSFER', p.transfer.expiresAt ? `PENDING UNTIL ${formatDate(p.transfer.expiresAt)}` : 'PENDING']);

  const notes: string[] = [];
  if (transferPending) notes.push(PIECES.transferPending(formatDateLong(p.transfer.expiresAt)));
  if (p.inService && incident.kind === 'reportable') notes.push(PIECES.inService);
  if (!p.verified) notes.push(PIECES.unverifiedNote);

  const model: PieceModel = {
    productId,
    key: productId.toLowerCase(),
    productLines: productLines(p),
    status,
    ownershipRows: rows,
    ownershipNotes: notes,
    transferPending,
    incident,
  };
  const g = p.genome;
  if (g && validGlyphs(g.glyphs) && Number.isInteger(g.version) && g.version > 0) {
    model.genome = {
      id: g.id,
      version: genomeLabel(g.version),
      versionNumber: g.version,
      fingerprint: g.fingerprint,
      glyphs: [...g.glyphs],
      ids: typeof g.pattern === 'string' && g.pattern ? g.pattern.split('·') : [],
    };
  }
  const warranty = warrantyModel(p.warranty);
  if (warranty) model.warranty = warranty;
  return model;
}

/**
 * The SERVICE tab: one row per service, oldest first. The label is its type, the value its dates (opened to closed,
 * or IN PROGRESS SINCE …, or CANCELLED …) and the place; staff notes never reach the owner.
 */
export function serviceRows(services: readonly ServiceRecord[]): Row[] {
  return services.map((s) => {
    const opened = formatDate(s.openedAt);
    let when: string;
    if (s.status === 'OPEN') when = `${PIECES.serviceStatus.OPEN} SINCE ${opened}`;
    else if (s.status === 'CANCELLED') when = `${PIECES.serviceStatus.CANCELLED} · ${opened}`;
    else when = s.closedAt && formatDate(s.closedAt) !== opened ? `${opened} – ${formatDate(s.closedAt)}` : opened;
    return [upper(s.type).replace(/_/g, ' '), [when, upper(s.location)].filter((x) => x.length > 0).join(' · ')] as const;
  });
}
