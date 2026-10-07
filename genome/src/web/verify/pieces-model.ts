/**
 * MY PIECES view-model (F-01): one owned piece (GET /api/v1/account/products) → what its plate and its
 * tabs show. Pure (no DOM) and unit-tested, like the result's view-model, whose helpers it shares: the
 * product lines, the WARRANTY rows and sentence, the dates.
 *
 * The owner's view says what the registry holds about their own piece: since when it is theirs, how
 * they acquired it, whether their ownership is verified, a transfer under way, the warranty, the
 * services, their own declaration (LOST or STOLEN), the photographs ORBES holds of it (F-04), as an
 * authentic result shows them, and the care of its model with ORBES Care (P-M02). It never names an internal status.
 */
import { careSubscribeHref } from '../shared/client-services.js';
import { DEFAULT_CARE, ORBES_CARE, ORDERS, PIECES } from './copy.js';
import { orderDate } from './orders-model.js';
import { releasePath } from './releases-model.js';
import type { ClientServices, IncidentType, OwnedPiece, PieceOrigin, ServiceRecord } from './types.js';
import { formatDate, formatDateLong, modelVariantLine, photoModels, pieceLines, productLines, upper, validGlyphs, warrantyModel, type GenomeModel, type PhotoModel, type Row } from './view-model.js';

export type PieceTabId = 'ownership' | 'warranty' | 'service' | 'care';

/** OWNERSHIP · WARRANTY · SERVICE · CARE (P-M02): four labels, the width of the result's four. */
export const PIECE_TABS: readonly PieceTabId[] = ['ownership', 'warranty', 'service', 'care'];

export const PIECE_TAB_LABELS: Readonly<Record<PieceTabId, string>> = PIECES.tabs;

/**
 * What the OWNERSHIP panel offers about loss and theft:
 *   reportable     — not reported: REPORT LOST / STOLEN (confirmed);
 *   not-reportable — not reported, but the server would refuse a report (the piece is revoked, retired or flagged:
 *                    `incidentReportable` false): ORBES Client Services and their contact, nothing to press;
 *   found          — a LOST the owner reported: PIECE FOUND (confirmed with the account's password);
 *   with-services  — a STOLEN, or a LOST ORBES Client Services recorded: their contact, nothing to press.
 */
export type IncidentMode = { kind: 'reportable' } | { kind: 'not-reportable' } | { kind: 'found' } | { kind: 'with-services'; type: IncidentType };

export interface PieceModel {
  productId: string;
  /** For element ids: the product id in lower case (`o26-j-00184`). */
  key: string;
  /** The model's name, as the list and the piece's page title it (C3, C4): `MONOLITHE`. */
  name: string;
  /** The line right under the name, in the list and on the piece's page (plan NEXT LOT §3.1): its model's variant, `STEEL`; null without one. */
  variant: string | null;
  /** Under the name on the piece's page (C4; addition 1): TYPE / CATEGORY / MATERIAL / SIZE 17 / CREATED YYYY. */
  pieceLines: string[];
  /** Under the name in the list (C3; addition 1): `BRACELET · 925 STERLING SILVER · SIZE 17`. */
  listLine: string;
  /** The state line of the list: `REGISTERED TO YOU · SINCE 3 OCT 2026`, or the status alone (REPORTED LOST…). */
  stateLine: string;
  /** Registered to the account, nothing reported nor pending: its state line takes the check (C3, C4). */
  registered: boolean;
  /** Its model's sheet in THE COLLECTION (SEE THE MODEL), when the model is PUBLIC there; else null. */
  lookbook: string | null;
  /** Where it comes from (addition 2): its release and its order; null without an order (a boutique sale). */
  origin: PieceOriginModel | null;
  /** The GENOME on the plate; absent when the server sent none, or one the app cannot draw faithfully. */
  genome?: GenomeModel;
  /** MODEL / VARIANT (with a label) / TYPE / CATEGORY / MATERIAL / CREATED YYYY. */
  productLines: string[];
  /**
   * The photographs of the piece (F-04), its own first, then its model's, each with its alternative text: those of an
   * authentic result (photoModels), on their ivory plate under the GENOME's. Empty when ORBES holds none.
   */
  photos: PhotoModel[];
  /** The status line of the OWNERSHIP panel. */
  status: string;
  ownershipRows: Row[];
  /** A sentence under the rows: a pending transfer, a service, an ownership not yet verified. */
  ownershipNotes: string[];
  transferPending: boolean;
  incident: IncidentMode;
  /**
   * OWNERSHIP CERTIFICATE is offered (F-06): a piece not reported lost or stolen whose status allows a certificate
   * (the server's `certificateAllowed`: not revoked nor retired). Otherwise the section is left out, its links with it:
   * the server would refuse the creation, and every link of the piece reads NO LONGER VALID.
   */
  certificateOffered: boolean;
  warranty?: { status: string; rows: Row[]; note: string };
  /** The CARE tab (P-M02): the model's care instructions, else the general care text of a result's CARE tab. */
  care: string;
}

/** WHERE IT COMES FROM (addition 2, C4): two rows that lead on, its release (a link to its page) and its order. */
export interface PieceOriginModel {
  /** `THE DRAW OF 14 SEPTEMBER`, `THE LIVE RELEASE OF 5 OCTOBER`, with its page; null for the private salon. */
  release: { id: string; title: string; href: string } | null;
  /** `ORDER OR-7C21A9F0`, then its step now and its date: `DELIVERED ON 22 SEP 2026`. */
  order: { reference: string; title: string; line: string };
}

const MONTHS_LONG = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/**
 * The day a release took place, as its title says it: `14 SEPTEMBER` on this phone's calendar (`offsetMinutes` east of
 * UTC: on that date's own offset by default), its year added when it is not the year of `now`; '' when unreadable.
 */
export function releaseDay(iso: string, now: Date, offsetMinutes?: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const at = new Date(t + (offsetMinutes ?? -new Date(t).getTimezoneOffset()) * 60_000);
  const today = new Date(now.getTime() + (offsetMinutes ?? -now.getTimezoneOffset()) * 60_000);
  const day = `${at.getUTCDate()} ${MONTHS_LONG[at.getUTCMonth()]}`;
  return at.getUTCFullYear() === today.getUTCFullYear() ? day : `${day} ${at.getUTCFullYear()}`;
}

const ORIGIN_REFERENCE = /^OR-[0-9A-F]{8}$/;

/** Where a piece comes from, as its page says it; null without an order, or with one the app cannot read. */
export function pieceOriginModel(o: PieceOrigin | null | undefined, now: Date, offsetMinutes?: number): PieceOriginModel | null {
  if (!o || !o.order || typeof o.order.reference !== 'string' || !ORIGIN_REFERENCE.test(o.order.reference)) return null;
  const step = ORDERS.step[o.order.status];
  if (!step) return null;
  const r = o.release;
  const day = r ? releaseDay(r.at, now, offsetMinutes) : '';
  return {
    release: r && day && (r.mode === 'DRAW' || r.mode === 'LIVE') ? { id: r.id, title: r.mode === 'DRAW' ? PIECES.origin.draw(day) : PIECES.origin.live(day), href: releasePath(r.id) } : null,
    order: { reference: o.order.reference, title: ORDERS.reference(o.order.reference), line: PIECES.origin.step(step, orderDate(o.order.at, offsetMinutes)) },
  };
}

/**
 * ORBES Care in the CARE tab (P-M02): its presentation, then SUBSCRIBE, a link to the subscription page in a new tab
 * when ORBES publishes one (`careSubscribeUrl`, https only, checked again here); otherwise `soon`, a plain sentence.
 */
export interface CareOfferModel {
  label: string;
  lead: string;
  benefits: string[];
  subscribe: { href: string; text: string; label: string } | null;
  soon: string | null;
}

export function careOfferModel(cs: ClientServices | undefined): CareOfferModel {
  const href = careSubscribeHref(cs);
  return {
    label: ORBES_CARE.label,
    lead: ORBES_CARE.lead,
    benefits: [...ORBES_CARE.benefits],
    subscribe: href ? { href, text: ORBES_CARE.subscribe, label: ORBES_CARE.subscribeLabel } : null,
    soon: href ? null : ORBES_CARE.soon,
  };
}

const PRODUCT_ID = /^O[0-9]{2}-[A-Z]-[0-9]{5,6}$/;

/** GENOME-01 for version 1, as the verification response names it. */
function genomeLabel(version: number): string {
  return `GENOME-${String(version).padStart(2, '0')}`;
}

/**
 * The GENOME of a piece as the account and certificate routes send it (an integer version, the glyph ids as one
 * pattern), for the plate; undefined when it is absent or the app cannot draw it faithfully.
 */
export function pieceGenomeModel(g: OwnedPiece['genome'] | undefined): GenomeModel | undefined {
  if (!g || !validGlyphs(g.glyphs) || !Number.isInteger(g.version) || g.version <= 0) return undefined;
  return {
    id: g.id,
    version: genomeLabel(g.version),
    versionNumber: g.version,
    fingerprint: g.fingerprint,
    glyphs: [...g.glyphs],
    ids: typeof g.pattern === 'string' && g.pattern ? g.pattern.split('·') : [],
  };
}

/** `now` and `offsetMinutes` date where the piece comes from (this phone's clock and calendar by default). */
export function pieceModel(p: OwnedPiece, opts: { now?: Date; offsetMinutes?: number } = {}): PieceModel {
  const productId = typeof p.productId === 'string' && PRODUCT_ID.test(p.productId) ? p.productId : '';
  const incident: IncidentMode =
    p.incident === 'LOST' && p.incidentResolvable === true
      ? { kind: 'found' }
      : p.incident === 'LOST' || p.incident === 'STOLEN'
        ? { kind: 'with-services', type: p.incident }
        : // A server that predates the flag sends none: offered, as before (the server still refuses what it must).
          p.incidentReportable === false
          ? { kind: 'not-reportable' }
          : { kind: 'reportable' };
  /** Neither lost nor stolen: the piece's own lines (a transfer, a service) and the certificate may show. */
  const notReported = incident.kind === 'reportable' || incident.kind === 'not-reportable';
  const transferPending = p.transfer?.pending === true && notReported;

  let status: string = PIECES.status.yours;
  if (p.incident === 'LOST') status = PIECES.status.lost;
  else if (p.incident === 'STOLEN') status = PIECES.status.stolen;
  else if (transferPending) status = PIECES.status.transfer;
  else if (p.inService) status = PIECES.status.service;

  // ACQUIRED, OWNERSHIP, SINCE (C4), then a transfer under way.
  const rows: Row[] = [];
  const via = PIECES.acquired[p.acquiredVia as keyof typeof PIECES.acquired];
  if (via) rows.push(['ACQUIRED', via]);
  rows.push(['OWNERSHIP', p.verified ? PIECES.verified : PIECES.unverified]);
  if (p.since) rows.push(['SINCE', formatDate(p.since)]);
  if (transferPending) rows.push(['TRANSFER', p.transfer.expiresAt ? `PENDING UNTIL ${formatDate(p.transfer.expiresAt)}` : 'PENDING']);

  const notes: string[] = [];
  if (transferPending) notes.push(PIECES.transferPending(formatDateLong(p.transfer.expiresAt)));
  if (p.inService && notReported) notes.push(PIECES.inService);
  if (!p.verified) notes.push(PIECES.unverifiedNote);

  const lines = pieceLines(p);
  const size = lines.find((l) => /^SIZE\b/.test(l));
  const registered = status === PIECES.status.yours;
  const model: PieceModel = {
    productId,
    key: productId.toLowerCase(),
    name: upper(p.model),
    variant: modelVariantLine(p.modelVariant),
    pieceLines: lines,
    listLine: [upper(p.type), upper(p.material), size ?? ''].filter((x) => x.length > 0).join(' · '),
    stateLine: registered && p.since ? `${status} · ${PIECES.since(formatDate(p.since))}` : status,
    registered,
    lookbook: typeof p.lookbook === 'string' && p.lookbook ? p.lookbook : null,
    origin: pieceOriginModel(p.origin, opts.now ?? new Date(), opts.offsetMinutes),
    productLines: productLines(p),
    photos: photoModels(p),
    status,
    ownershipRows: rows,
    ownershipNotes: notes,
    transferPending,
    incident,
    // A server that predates the flag sends none: offered, as before (the server still refuses what it must).
    certificateOffered: notReported && p.certificateAllowed !== false,
    care: typeof p.care === 'string' && p.care.trim() ? p.care.trim() : DEFAULT_CARE,
  };
  const genome = pieceGenomeModel(p.genome);
  if (genome) model.genome = genome;
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
