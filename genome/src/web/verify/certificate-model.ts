/**
 * The ownership certificate's page (F-06, /verify/c#…) as a view-model: what a buyer or an insurer reads when an
 * owner shares the link, from POST /api/v1/certificates/lookup. Pure (no DOM) and unit-tested, like MY PIECES'
 * view-model, whose GENOME plate and product lines it shares.
 *
 * A certificate attests what the registry records, not the object it is shown with: the page never says AUTHENTIC,
 * and it names no owner (the server sends none). The token comes from the link's fragment, never from its path.
 */
import { CERTIFICATE, PIECES } from './copy.js';
import { pieceGenomeModel } from './pieces-model.js';
import type { CertificateLookup } from './types.js';
import { formatDate, formatDateTime, productLines, warrantyModel, type GenomeModel, type Row } from './view-model.js';

export type CertificateScreen =
  | {
      kind: 'valid';
      state: string;
      lead: string;
      productId: string;
      /** For element ids: the product id in lower case. */
      key: string;
      genome?: GenomeModel;
      productLines: string[];
      recordRows: Row[];
      certificateRows: Row[];
      note: string;
    }
  | { kind: 'ended'; state: string; lead: string }
  | { kind: 'unknown'; state: string; lead: string };

const PRODUCT_ID = /^O[0-9]{2}-[A-Z]-[0-9]{5,6}$/;
/** A token as a reader may have typed or pasted it: Crockford letters and digits, hyphens and spaces (the server reads it). */
const TOKEN_INPUT = /^[0-9A-Za-z\s-]{1,128}$/;

/**
 * The token of a certificate link from `location.hash` ('#7Q2M…', grouped or not), or null when there is none the
 * server could read. Never sent anywhere but in the body of the lookup.
 */
export function certificateTokenOf(hash: string): string | null {
  let raw = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  raw = raw.trim();
  return TOKEN_INPUT.test(raw) ? raw : null;
}

/** The page for an answer: VALID with the record, NO LONGER VALID, or NOT FOUND (`null`: a 404, or no token). */
export function certificateScreen(r: CertificateLookup | null, opts: { offsetMinutes?: number } = {}): CertificateScreen {
  if (r === null) return { kind: 'unknown', state: CERTIFICATE.state.unknown, lead: CERTIFICATE.lead.unknown };
  if (r.status !== 'VALID') return { kind: 'ended', state: CERTIFICATE.state.ended, lead: CERTIFICATE.lead.ended };
  const p = r.piece;
  const productId = typeof p.productId === 'string' && PRODUCT_ID.test(p.productId) ? p.productId : '';
  const record: Row[] = [
    [CERTIFICATE.rows.ownership, r.ownership.verified ? CERTIFICATE.verified : CERTIFICATE.unverified],
    [CERTIFICATE.rows.since, formatDate(r.ownership.since)],
  ];
  const w = warrantyModel(r.warranty);
  // The WARRANTY rows of a result and of MY PIECES, the first one named WARRANTY here (one list for the whole record).
  if (w) record.push([CERTIFICATE.rows.warranty, w.status], ...w.rows.slice(1));
  record.push([CERTIFICATE.rows.incidents, CERTIFICATE.noIncident]);
  const screen: CertificateScreen = {
    kind: 'valid',
    state: CERTIFICATE.state.valid,
    lead: CERTIFICATE.lead.valid,
    productId,
    key: productId.toLowerCase(),
    // The piece's modelVariant rides with it: MODEL / VARIANT / TYPE / … (plan NEXT LOT §3.1).
    productLines: productLines(p),
    recordRows: record,
    certificateRows: [
      [CERTIFICATE.rows.checked, formatDateTime(r.checkedAt, opts.offsetMinutes ?? 0)],
      [CERTIFICATE.rows.issued, formatDate(r.certificate.issuedAt)],
      [CERTIFICATE.rows.validUntil, formatDate(r.certificate.expiresAt)],
    ],
    note: CERTIFICATE.note,
  };
  const genome = pieceGenomeModel(p.genome);
  if (genome) screen.genome = genome;
  return screen;
}

/** One open link of the owner's, as MY PIECES lists it: created, until when, or no longer valid. */
export function ownerCertificateLine(c: { createdAt: string; expiresAt: string; valid: boolean }): string {
  return c.valid ? PIECES.certificateLine(formatDate(c.createdAt), formatDate(c.expiresAt)) : PIECES.certificateEnded(formatDate(c.createdAt));
}
