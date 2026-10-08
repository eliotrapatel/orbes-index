/**
 * Role enforcement for every admin route group: AUDITOR reads, OPERATOR
 * mutates (the catalogue's models and collections included, created or
 * edited, their variants added, NOCTURNE N1, their lookbook and its gallery, P-R02, and the photographs of models and pieces, F-04,
 * and the drops of the Club page, P-R03: created, edited, published, cancelled, their entries
 * concluded and the next one offered; the posts of its circle, P-X01: created, edited, published,
 * withdrawn, their photographs; the words of its tiers' benefits, P-X04; the requests of its private salon closed,
 * P-X08), ADMIN for keys, revocations, reinstatement, categories (created,
 * activated or deactivated), the console users of the Team page (A-02), the
 * points of sale (A-08), a customer's recovery code, lock and export, the draw of a drop, a model
 * discontinued or reinstated (P-R06), a LIVE RELEASE ended now or an entry removed from it (its creation, edits,
 * publication, cancellation, silhouette, board link and live controls: OPERATOR), and the settings of the orders: their
 * alerts' delays, the locations and the carriers (plan LIVE RELEASE+; the orders' steps, returns, terms, buyer and piece,
 * and the atelier's stock, pieces to make and work sheets: OPERATOR; the invoices and credit notes read by an AUDITOR;
 * the segments read by an AUDITOR, their members' CSV too, built, counted live, changed and deleted by an OPERATOR; the
 * size mix proposed at creation, the feasibility check and the best time to open read by an AUDITOR; the Shopify
 * exports read by an AUDITOR, the order CSV masked, the Shopify ids pasted back by an OPERATOR; the Messages board of
 * the next nine, CS-01, read by an AUDITOR, its conversations answered, taken and closed by an OPERATOR, assigned by an
 * ADMIN; THE PROGRAM of the club's tiers and the orders' shipping rates, BP-19 T2, read by an AUDITOR, set by an ADMIN;
 * the Yearly care board, BP-19 T6, read by an AUDITOR, its steps taken by an OPERATOR; THE HOUSE'S GUARANTEE, IN-01,
 * granted, changed and revoked by an OPERATOR, its defaults read by an AUDITOR and set by an ADMIN; a model's Sizes, AC-01,
 * read by an AUDITOR and set by an OPERATOR, its sizes declared, removed and reinstated by an OPERATOR (NEXT LOT §3.3); GROWTH, BP-29, read by an AUDITOR;
 * the suppliers, read by an AUDITOR, added and changed by an OPERATOR, a model's supplier set by an OPERATOR, NEXT LOT §3.5.6.2);
 * every role changes its own password. RETAIL (A-08) ranks under AUDITOR: it
 * reaches the sale mode, the list of points of sale and its own session,
 * password and second factor, nothing else. LOGISTICS (plan NEXT LOT §3.5.6.1),
 * a person at the logistics agent, ranks with RETAIL: it reaches the Logistics
 * routes that name it (LOGISTICS_ACT, LOGISTICS_READ) and its own session,
 * password and second factor, never the points of sale. The sale mode names its roles
 * (RETAIL, OPERATOR, ADMIN): it starts warranties, so the read-only AUDITOR,
 * though above RETAIL, does not sell.
 *
 * "Allowed" is probed with a request the guard lets through but validation
 * then rejects (400) or that targets nothing (404), so the probes have no
 * side effects; "forbidden" must be 403 FORBIDDEN before any validation.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminRole } from '../../src/server/db/schema.js';
import { jpegPhoto } from '../support/images.js';
import { adminClient, createHarness, errorOf, type Client, type Harness } from './support.js';

/**
 * `min`: the rank the route needs; `roles`, when given, the exact roles it lets in instead (the sale mode). `headers`:
 * a body that is not JSON (the photographs of F-04 take the image itself).
 */
type Probe = { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; url: string; body?: unknown; headers?: Record<string, string>; min: AdminRole; roles?: readonly AdminRole[]; group: string };
const SELLERS: readonly AdminRole[] = ['RETAIL', 'OPERATOR', 'ADMIN'];
/** The points of sale: every role but LOGISTICS, ranked with RETAIL (plan NEXT LOT §3.5.6.1). */
const RETAILER_READERS: readonly AdminRole[] = ['RETAIL', 'AUDITOR', 'OPERATOR', 'ADMIN'];
const ROLES = ['RETAIL', 'LOGISTICS', 'AUDITOR', 'OPERATOR', 'ADMIN'] as const;
const allows = (p: Probe, role: AdminRole) => (p.roles ? p.roles.includes(role) : RANK[role] >= RANK[p.min]);

const RANK: Record<AdminRole, number> = { RETAIL: 1, LOGISTICS: 1, AUDITOR: 2, OPERATOR: 3, ADMIN: 4 };
const PID = 'O26-J-00001';
const UUID = randomUUID();
const INVALID = { definitelyNotAField: true };
/** A real photograph: the image routes check the type before the target, so an allowed probe ends in 404. */
const PHOTO = { body: Buffer.from(jpegPhoto(8, 8)), headers: { 'content-type': 'image/jpeg' } };
/** A yearly care's label, the PDF itself, without its carrier and tracking number: an allowed probe ends in 400. */
const LABEL = { body: Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1'), headers: { 'content-type': 'application/pdf' } };

const PROBES: Probe[] = [
  { group: 'dashboard', method: 'GET', url: '/api/admin/dashboard', min: 'AUDITOR' },
  // Test entrants §7: the server's status, read by an AUDITOR.
  { group: 'system', method: 'GET', url: '/api/admin/system/status', min: 'AUDITOR' },
  { group: 'analytics', method: 'GET', url: '/api/admin/analytics', min: 'AUDITOR' },
  { group: 'documents', method: 'GET', url: '/api/admin/documents', min: 'AUDITOR' },
  { group: 'documents', method: 'GET', url: '/api/admin/documents/sales-playbook', min: 'AUDITOR' },
  { group: 'documents', method: 'GET', url: '/api/admin/documents/assets/certificate-card-specimen.svg', min: 'AUDITOR' },
  { group: 'analytics', method: 'GET', url: '/api/admin/analytics?from=2025-10-01&to=2026-10-01', min: 'AUDITOR' },
  { group: 'analytics', method: 'GET', url: '/api/admin/analytics?days=367', min: 'AUDITOR' },
  { group: 'categories', method: 'GET', url: '/api/admin/categories', min: 'AUDITOR' },
  { group: 'categories', method: 'POST', url: '/api/admin/categories', body: INVALID, min: 'ADMIN' },
  { group: 'categories', method: 'POST', url: '/api/admin/categories/J/active', body: INVALID, min: 'ADMIN' },
  { group: 'models', method: 'GET', url: '/api/admin/models', min: 'AUDITOR' },
  { group: 'models', method: 'POST', url: '/api/admin/models', body: INVALID, min: 'OPERATOR' },
  { group: 'models', method: 'PATCH', url: `/api/admin/models/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'models', method: 'GET', url: `/api/admin/models/${UUID}`, min: 'AUDITOR' },
  // NOCTURNE N1: ADD A VARIANT, as editing a model.
  { group: 'models', method: 'POST', url: `/api/admin/models/${UUID}/variants`, body: INVALID, min: 'OPERATOR' },
  // P-R06: an ADMIN discontinues a model and reinstates it.
  { group: 'models', method: 'POST', url: `/api/admin/models/${UUID}/discontinue`, body: INVALID, min: 'ADMIN' },
  { group: 'models', method: 'POST', url: `/api/admin/models/${UUID}/reinstate`, body: INVALID, min: 'ADMIN' },
  { group: 'lookbook', method: 'POST', url: `/api/admin/models/${UUID}/gallery`, ...PHOTO, min: 'OPERATOR' },
  { group: 'lookbook', method: 'DELETE', url: `/api/admin/models/${UUID}/gallery/${'ab'.repeat(32)}`, min: 'OPERATOR' },
  { group: 'lookbook', method: 'PATCH', url: `/api/admin/models/${UUID}/gallery`, body: INVALID, min: 'OPERATOR' },
  { group: 'media', method: 'POST', url: `/api/admin/models/${UUID}/image`, ...PHOTO, min: 'OPERATOR' },
  { group: 'media', method: 'DELETE', url: `/api/admin/models/${UUID}/image`, min: 'OPERATOR' },
  { group: 'media', method: 'POST', url: `/api/admin/products/${PID}/photo`, ...PHOTO, min: 'OPERATOR' },
  { group: 'media', method: 'DELETE', url: `/api/admin/products/${PID}/photo`, min: 'OPERATOR' },
  { group: 'collections', method: 'GET', url: '/api/admin/collections', min: 'AUDITOR' },
  { group: 'collections', method: 'POST', url: '/api/admin/collections', body: INVALID, min: 'OPERATOR' },
  { group: 'collections', method: 'PATCH', url: `/api/admin/collections/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'products', method: 'GET', url: '/api/admin/products', min: 'AUDITOR' },
  { group: 'products', method: 'POST', url: '/api/admin/products', body: INVALID, min: 'OPERATOR' },
  { group: 'products', method: 'POST', url: '/api/admin/products/batch', body: INVALID, min: 'OPERATOR' },
  { group: 'products', method: 'GET', url: `/api/admin/products/${PID}`, min: 'AUDITOR' },
  { group: 'lifecycle', method: 'POST', url: `/api/admin/products/${PID}/transitions`, body: INVALID, min: 'OPERATOR' },
  { group: 'lifecycle', method: 'POST', url: `/api/admin/products/${PID}/reinstate`, body: INVALID, min: 'ADMIN' },
  { group: 'codes', method: 'POST', url: `/api/admin/products/${PID}/codes/reissue`, body: INVALID, min: 'OPERATOR' },
  // NEW CLAIM CODE (plan NEXT LOT §3.4): OPERATOR and ADMIN; an AUDITOR reads its history on the product page.
  { group: 'codes', method: 'POST', url: `/api/admin/products/${PID}/claim-code`, body: INVALID, min: 'OPERATOR' },
  { group: 'warranty', method: 'POST', url: `/api/admin/products/${PID}/warranty/activate`, body: INVALID, min: 'OPERATOR' },
  { group: 'warranty', method: 'POST', url: `/api/admin/products/${PID}/warranty/void`, body: INVALID, min: 'OPERATOR' },
  { group: 'warranty', method: 'POST', url: `/api/admin/products/${PID}/warranty/extend`, body: INVALID, min: 'OPERATOR' },
  { group: 'services', method: 'POST', url: `/api/admin/products/${PID}/services`, body: INVALID, min: 'OPERATOR' },
  { group: 'services', method: 'POST', url: `/api/admin/services/${UUID}/complete`, body: INVALID, min: 'OPERATOR' },
  { group: 'ownership', method: 'POST', url: `/api/admin/products/${PID}/ownership/confirm`, body: INVALID, min: 'OPERATOR' },
  { group: 'codes', method: 'GET', url: `/api/admin/codes/${UUID}/artifact.svg`, min: 'OPERATOR' },
  { group: 'codes', method: 'POST', url: `/api/admin/codes/${UUID}/revoke`, body: INVALID, min: 'ADMIN' },
  { group: 'codes', method: 'POST', url: '/api/admin/codes/print-sheet', body: INVALID, min: 'OPERATOR' },
  { group: 'codes', method: 'POST', url: '/api/admin/codes/print-sheet/manifest', body: INVALID, min: 'OPERATOR' },
  { group: 'certificates', method: 'POST', url: '/api/admin/certificates', body: INVALID, min: 'OPERATOR' },
  { group: 'genomes', method: 'GET', url: '/api/admin/genomes', min: 'AUDITOR' },
  { group: 'codes', method: 'GET', url: '/api/admin/codes', min: 'AUDITOR' },
  { group: 'codes', method: 'GET', url: '/api/admin/codes?productionBatch=B-2026-09-A&status=ACTIVE&issuedFrom=2026-09-01', min: 'AUDITOR' },
  { group: 'codes', method: 'GET', url: '/api/admin/codes/ids?productionBatch=B-2026-09-A', min: 'AUDITOR' },
  { group: 'products', method: 'GET', url: '/api/admin/products?productionBatch=B-2026-09-A', min: 'AUDITOR' },
  { group: 'scans', method: 'GET', url: '/api/admin/scans', min: 'AUDITOR' },
  { group: 'scans', method: 'GET', url: `/api/admin/scans?productId=${PID}&from=2026-10-01&to=2026-10-01T12:00:00Z`, min: 'AUDITOR' },
  { group: 'owners', method: 'GET', url: '/api/admin/owners', min: 'AUDITOR' },
  { group: 'owners', method: 'POST', url: `/api/admin/owners/${UUID}/recovery-code`, body: INVALID, min: 'ADMIN' },
  { group: 'owners', method: 'GET', url: '/api/admin/owners?email=client%40example.com', min: 'AUDITOR' },
  { group: 'owners', method: 'GET', url: '/api/admin/owners?ref=1A2B3C4D', min: 'AUDITOR' },
  { group: 'owners', method: 'GET', url: `/api/admin/owners/${UUID}`, min: 'AUDITOR' },
  { group: 'owners', method: 'POST', url: `/api/admin/owners/${UUID}/lock`, body: INVALID, min: 'ADMIN' },
  { group: 'owners', method: 'POST', url: `/api/admin/owners/${UUID}/unlock`, body: INVALID, min: 'ADMIN' },
  { group: 'owners', method: 'GET', url: `/api/admin/owners/${UUID}/export`, min: 'ADMIN' },
  { group: 'drops', method: 'GET', url: '/api/admin/drops', min: 'AUDITOR' },
  { group: 'drops', method: 'POST', url: '/api/admin/drops', body: INVALID, min: 'OPERATOR' },
  { group: 'drops', method: 'GET', url: `/api/admin/drops/${UUID}`, min: 'AUDITOR' },
  { group: 'drops', method: 'PATCH', url: `/api/admin/drops/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'drops', method: 'POST', url: `/api/admin/drops/${UUID}/publish`, body: INVALID, min: 'OPERATOR' },
  { group: 'drops', method: 'POST', url: `/api/admin/drops/${UUID}/cancel`, body: INVALID, min: 'OPERATOR' },
  { group: 'drops', method: 'POST', url: `/api/admin/drops/${UUID}/draw`, body: INVALID, min: 'ADMIN' },
  { group: 'drops', method: 'GET', url: `/api/admin/drops/${UUID}/entries`, min: 'AUDITOR' },
  { group: 'drops', method: 'GET', url: `/api/admin/drops/${UUID}/entries?status=SELECTED`, min: 'AUDITOR' },
  { group: 'drops', method: 'POST', url: `/api/admin/drops/${UUID}/entries/${UUID}/confirm`, body: INVALID, min: 'OPERATOR' },
  { group: 'drops', method: 'POST', url: `/api/admin/drops/${UUID}/entries/${UUID}/lapse`, body: INVALID, min: 'OPERATOR' },
  { group: 'drops', method: 'POST', url: `/api/admin/drops/${UUID}/offer-next`, body: INVALID, min: 'OPERATOR' },
  // TEST ENTRANTS (2026-10-07): sent, added, stopped, confirmed or released by hand and ended by an ADMIN; read by an AUDITOR.
  { group: 'test-entrants', method: 'POST', url: `/api/admin/drops/${UUID}/test-runs`, body: INVALID, min: 'ADMIN' },
  { group: 'test-entrants', method: 'POST', url: `/api/admin/test-runs/${UUID}/add`, body: INVALID, min: 'ADMIN' },
  { group: 'test-entrants', method: 'POST', url: `/api/admin/test-runs/${UUID}/stop`, body: INVALID, min: 'ADMIN' },
  { group: 'test-entrants', method: 'POST', url: `/api/admin/test-runs/${UUID}/entrants/${UUID}/confirm`, body: INVALID, min: 'ADMIN' },
  { group: 'test-entrants', method: 'POST', url: `/api/admin/test-runs/${UUID}/entrants/${UUID}/release`, body: INVALID, min: 'ADMIN' },
  { group: 'test-entrants', method: 'POST', url: `/api/admin/test-runs/${UUID}/end`, body: INVALID, min: 'ADMIN' },
  { group: 'test-entrants', method: 'GET', url: `/api/admin/drops/${UUID}/test-runs/current`, min: 'AUDITOR' },
  { group: 'test-entrants', method: 'GET', url: `/api/admin/drops/${UUID}/test-runs`, min: 'AUDITOR' },
  { group: 'test-entrants', method: 'GET', url: '/api/admin/test-runs/active', min: 'AUDITOR' },
  // The LIVE RELEASES (plan of 2026-10-04): read by an AUDITOR; created, edited, published, cancelled, their silhouette and
  // board link and their live controls by an OPERATOR; END NOW and REMOVE by an ADMIN.
  { group: 'live', method: 'GET', url: '/api/admin/live', min: 'AUDITOR' },
  { group: 'live', method: 'POST', url: '/api/admin/live', body: INVALID, min: 'OPERATOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}`, min: 'AUDITOR' },
  { group: 'live', method: 'PATCH', url: `/api/admin/live/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'live', method: 'POST', url: `/api/admin/live/${UUID}/publish`, body: INVALID, min: 'OPERATOR' },
  { group: 'live', method: 'POST', url: `/api/admin/live/${UUID}/circle-post`, body: INVALID, min: 'OPERATOR' },
  { group: 'live', method: 'DELETE', url: `/api/admin/live/${UUID}/circle-post`, min: 'OPERATOR' },
  { group: 'live', method: 'POST', url: `/api/admin/live/${UUID}/cancel`, body: INVALID, min: 'OPERATOR' },
  { group: 'live', method: 'POST', url: `/api/admin/live/${UUID}/silhouette`, ...PHOTO, min: 'OPERATOR' },
  { group: 'live', method: 'DELETE', url: `/api/admin/live/${UUID}/silhouette`, min: 'OPERATOR' },
  { group: 'live', method: 'POST', url: `/api/admin/live/${UUID}/board-link`, body: INVALID, min: 'OPERATOR' },
  { group: 'live', method: 'DELETE', url: `/api/admin/live/${UUID}/board-link`, min: 'OPERATOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/board`, min: 'AUDITOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/stream`, min: 'AUDITOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/entries`, min: 'AUDITOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/entries?status=OPEN`, min: 'AUDITOR' },
  { group: 'live', method: 'POST', url: `/api/admin/live/${UUID}/pause`, body: INVALID, min: 'OPERATOR' },
  { group: 'live', method: 'POST', url: `/api/admin/live/${UUID}/resume`, body: INVALID, min: 'OPERATOR' },
  { group: 'live', method: 'POST', url: `/api/admin/live/${UUID}/extend`, body: INVALID, min: 'OPERATOR' },
  { group: 'live', method: 'POST', url: `/api/admin/live/${UUID}/stock`, body: INVALID, min: 'OPERATOR' },
  { group: 'live', method: 'POST', url: `/api/admin/live/${UUID}/messages`, body: INVALID, min: 'OPERATOR' },
  { group: 'live', method: 'POST', url: `/api/admin/live/${UUID}/end`, body: INVALID, min: 'ADMIN' },
  { group: 'live', method: 'POST', url: `/api/admin/live/${UUID}/entries/${UUID}/free`, body: INVALID, min: 'OPERATOR' },
  { group: 'live', method: 'POST', url: `/api/admin/live/${UUID}/entries/${UUID}/let-in`, body: INVALID, min: 'OPERATOR' },
  { group: 'live', method: 'POST', url: `/api/admin/live/${UUID}/entries/${UUID}/remove`, body: INVALID, min: 'ADMIN' },
  // The intelligence: reads for every console role from AUDITOR (the emails masked for an AUDITOR by the routes).
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/plan`, min: 'AUDITOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/forecast`, min: 'AUDITOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/radar`, min: 'AUDITOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/bots`, min: 'AUDITOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/report`, min: 'AUDITOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/report.csv`, min: 'AUDITOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/collectors`, min: 'AUDITOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/comparison`, min: 'AUDITOR' },
  // Step S8: the size mix proposed at creation, the feasibility check before publishing, the best time to open: reads.
  { group: 'live', method: 'GET', url: '/api/admin/live/size-mix?modelId=nope', min: 'AUDITOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/size-mix?modelId=${UUID}`, min: 'AUDITOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/feasibility`, min: 'AUDITOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/best-time?days=367`, min: 'AUDITOR' },
  { group: 'live', method: 'GET', url: `/api/admin/live/${UUID}/best-time?country=FR`, min: 'AUDITOR' },
  { group: 'circle', method: 'GET', url: '/api/admin/circle/posts', min: 'AUDITOR' },
  { group: 'circle', method: 'POST', url: '/api/admin/circle/posts', body: INVALID, min: 'OPERATOR' },
  { group: 'circle', method: 'GET', url: `/api/admin/circle/posts/${UUID}`, min: 'AUDITOR' },
  { group: 'circle', method: 'PATCH', url: `/api/admin/circle/posts/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'circle', method: 'POST', url: `/api/admin/circle/posts/${UUID}/publish`, body: INVALID, min: 'OPERATOR' },
  { group: 'circle', method: 'POST', url: `/api/admin/circle/posts/${UUID}/unpublish`, body: INVALID, min: 'OPERATOR' },
  { group: 'circle', method: 'GET', url: `/api/admin/circle/posts/${UUID}/answers`, min: 'AUDITOR' },
  { group: 'circle', method: 'GET', url: `/api/admin/circle/posts/${UUID}/answers?answer=YES`, min: 'AUDITOR' },
  { group: 'circle', method: 'POST', url: `/api/admin/circle/posts/${UUID}/photos`, ...PHOTO, min: 'OPERATOR' },
  { group: 'circle', method: 'DELETE', url: `/api/admin/circle/posts/${UUID}/photos/${'ab'.repeat(32)}`, min: 'OPERATOR' },
  { group: 'circle', method: 'PATCH', url: `/api/admin/circle/posts/${UUID}/photos`, body: INVALID, min: 'OPERATOR' },
  { group: 'tiers', method: 'GET', url: '/api/admin/club/tiers', min: 'AUDITOR' },
  { group: 'tiers', method: 'PATCH', url: '/api/admin/club/tiers/TITANE', body: INVALID, min: 'OPERATOR' },
  { group: 'tiers', method: 'PATCH', url: '/api/admin/club/tiers/PALLADIUM', body: INVALID, min: 'OPERATOR' },
  // The next nine (BP-19 T2): THE PROGRAM read by an AUDITOR, changed by an ADMIN.
  { group: 'program', method: 'GET', url: '/api/admin/club/program', min: 'AUDITOR' },
  { group: 'program', method: 'PUT', url: '/api/admin/club/program', body: INVALID, min: 'ADMIN' },
  // P-X08: the requests of the private salon, read by an AUDITOR, closed by an OPERATOR.
  { group: 'requests', method: 'GET', url: '/api/admin/club/requests', min: 'AUDITOR' },
  { group: 'requests', method: 'GET', url: '/api/admin/club/requests?status=CLOSED', min: 'AUDITOR' },
  { group: 'requests', method: 'POST', url: `/api/admin/club/requests/${UUID}/close`, body: INVALID, min: 'OPERATOR' },
  // The next nine (CS-01): the Messages board read by an AUDITOR; answered, taken and closed by an OPERATOR; assigned by an ADMIN.
  { group: 'messages', method: 'GET', url: '/api/admin/messages', min: 'AUDITOR' },
  { group: 'messages', method: 'GET', url: '/api/admin/messages?status=ALL&who=mine&q=5A864AF8', min: 'AUDITOR' },
  { group: 'messages', method: 'GET', url: '/api/admin/messages/summary', min: 'AUDITOR' },
  { group: 'messages', method: 'GET', url: `/api/admin/messages/${UUID}`, min: 'AUDITOR' },
  { group: 'messages', method: 'POST', url: `/api/admin/messages/${UUID}/answer`, body: INVALID, min: 'OPERATOR' },
  { group: 'messages', method: 'POST', url: `/api/admin/messages/${UUID}/take`, body: INVALID, min: 'OPERATOR' },
  { group: 'messages', method: 'POST', url: `/api/admin/messages/${UUID}/assign`, body: INVALID, min: 'ADMIN' },
  { group: 'messages', method: 'POST', url: `/api/admin/messages/${UUID}/close`, body: INVALID, min: 'OPERATOR' },
  // BP-19 T6: the Yearly care board read by an AUDITOR, its steps by an OPERATOR (manageCare); the label is the PDF itself.
  { group: 'care', method: 'GET', url: '/api/admin/care', min: 'AUDITOR' },
  { group: 'care', method: 'GET', url: '/api/admin/care?status=DONE&year=2026', min: 'AUDITOR' },
  { group: 'care', method: 'GET', url: `/api/admin/care/${UUID}`, min: 'AUDITOR' },
  { group: 'care', method: 'POST', url: `/api/admin/care/${UUID}/label`, ...LABEL, min: 'OPERATOR' },
  { group: 'care', method: 'POST', url: `/api/admin/care/${UUID}/receive`, body: INVALID, min: 'OPERATOR' },
  { group: 'care', method: 'POST', url: `/api/admin/care/${UUID}/return`, body: INVALID, min: 'OPERATOR' },
  { group: 'care', method: 'POST', url: `/api/admin/care/${UUID}/complete`, body: INVALID, min: 'OPERATOR' },
  { group: 'care', method: 'POST', url: `/api/admin/care/${UUID}/cancel`, body: INVALID, min: 'OPERATOR' },
  // IN-01: THE HOUSE'S GUARANTEE granted, changed and revoked by an OPERATOR (grantGuarantee), a release's guarantees and
  // the defaults read by an AUDITOR, the defaults set by an ADMIN (manageGuaranteeSettings).
  { group: 'guarantees', method: 'POST', url: `/api/admin/owners/${UUID}/guarantees`, body: INVALID, min: 'OPERATOR' },
  { group: 'guarantees', method: 'PATCH', url: `/api/admin/guarantees/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'guarantees', method: 'POST', url: `/api/admin/guarantees/${UUID}/revoke`, body: INVALID, min: 'OPERATOR' },
  { group: 'guarantees', method: 'GET', url: `/api/admin/drops/${UUID}/guarantees`, min: 'AUDITOR' },
  { group: 'guarantees', method: 'GET', url: '/api/admin/settings/guarantees', min: 'AUDITOR' },
  { group: 'guarantees', method: 'PUT', url: '/api/admin/settings/guarantees', body: INVALID, min: 'ADMIN' },
  // AC-01: a model's Sizes (its size kind and its sizes' fits) read by an AUDITOR, set by an OPERATOR.
  // NEXT LOT §3.5.6.2: the suppliers read by an AUDITOR, added and changed by an OPERATOR, a model's supplier set by an
  // OPERATOR; never LOGISTICS (ranked with RETAIL).
  { group: 'suppliers', method: 'GET', url: '/api/admin/suppliers', min: 'AUDITOR' },
  { group: 'suppliers', method: 'POST', url: '/api/admin/suppliers', body: INVALID, min: 'OPERATOR' },
  { group: 'suppliers', method: 'PATCH', url: `/api/admin/suppliers/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'suppliers', method: 'PUT', url: `/api/admin/models/${UUID}/supplier`, body: INVALID, min: 'OPERATOR' },
  { group: 'sizes', method: 'GET', url: `/api/admin/models/${UUID}/sizes`, min: 'AUDITOR' },
  { group: 'sizes', method: 'PUT', url: `/api/admin/models/${UUID}/sizes`, body: INVALID, min: 'OPERATOR' },
  // NEXT LOT §3.3: a size taken off a model (removed or set aside) and reinstated, by an OPERATOR.
  { group: 'sizes', method: 'POST', url: `/api/admin/models/${UUID}/sizes/${UUID}/remove`, min: 'OPERATOR' },
  { group: 'sizes', method: 'POST', url: `/api/admin/models/${UUID}/sizes/${UUID}/reinstate`, min: 'OPERATOR' },
  // BP-34: a model's pairs (PAIRS WELL WITH) set by an OPERATOR; read with the model (GET /api/admin/models/:id, AUDITOR).
  { group: 'pairs', method: 'PUT', url: `/api/admin/models/${UUID}/pairs`, body: INVALID, min: 'OPERATOR' },
  // Plan LIVE RELEASE+: the orders read by an AUDITOR, stepped by an OPERATOR, their alerts' delays set by an ADMIN; the
  // locations and carriers read by an AUDITOR, set by an ADMIN; the atelier read by an AUDITOR, worked by an OPERATOR.
  { group: 'orders', method: 'GET', url: '/api/admin/orders', min: 'AUDITOR' },
  { group: 'orders', method: 'GET', url: `/api/admin/orders?channel=LIVE&dropId=${UUID}&locationId=${UUID}&late=true&q=OR-1`, min: 'AUDITOR' },
  { group: 'orders', method: 'GET', url: '/api/admin/orders.csv', min: 'AUDITOR' },
  { group: 'orders', method: 'GET', url: '/api/admin/orders/alerts', min: 'AUDITOR' },
  { group: 'orders', method: 'PUT', url: '/api/admin/orders/alerts', body: INVALID, min: 'ADMIN' },
  // BP-19 T2: the optional shipping rates, read by an AUDITOR, set by an ADMIN.
  { group: 'orders', method: 'GET', url: '/api/admin/orders/shipping-rates', min: 'AUDITOR' },
  { group: 'orders', method: 'PUT', url: '/api/admin/orders/shipping-rates', body: INVALID, min: 'ADMIN' },
  { group: 'orders', method: 'GET', url: `/api/admin/orders/${UUID}`, min: 'AUDITOR' },
  { group: 'orders', method: 'POST', url: `/api/admin/orders/${UUID}/transition`, body: INVALID, min: 'OPERATOR' },
  { group: 'orders', method: 'POST', url: `/api/admin/orders/${UUID}/location`, body: INVALID, min: 'OPERATOR' },
  { group: 'orders', method: 'PATCH', url: `/api/admin/orders/${UUID}/terms`, body: INVALID, min: 'OPERATOR' },
  { group: 'orders', method: 'PUT', url: `/api/admin/orders/${UUID}/buyer`, body: INVALID, min: 'OPERATOR' },
  { group: 'orders', method: 'POST', url: `/api/admin/orders/${UUID}/piece`, body: INVALID, min: 'OPERATOR' },
  // BP-19 T5: a tier's credit taken off an order, and given back, by an OPERATOR.
  { group: 'orders', method: 'POST', url: `/api/admin/orders/${UUID}/credit`, body: INVALID, min: 'OPERATOR' },
  { group: 'orders', method: 'DELETE', url: `/api/admin/orders/${UUID}/credit`, min: 'OPERATOR' },
  // Step S4: a return opened by an OPERATOR (to the archive by an ADMIN only: the case below); the invoices and credit notes read by an AUDITOR (the buyer masked).
  { group: 'orders', method: 'POST', url: `/api/admin/orders/${UUID}/return`, body: INVALID, min: 'OPERATOR' },
  { group: 'invoices', method: 'GET', url: '/api/admin/invoices', min: 'AUDITOR' },
  { group: 'invoices', method: 'GET', url: '/api/admin/invoices?month=2026-11&kind=CREDIT_NOTE&q=INV-2026', min: 'AUDITOR' },
  { group: 'invoices', method: 'GET', url: '/api/admin/invoices.csv?month=2026-11', min: 'AUDITOR' },
  { group: 'invoices', method: 'GET', url: `/api/admin/invoices/${UUID}/pdf`, min: 'AUDITOR' },
  // Step S6: the segments (choice 27).
  { group: 'segments', method: 'GET', url: '/api/admin/segments', min: 'AUDITOR' },
  { group: 'segments', method: 'GET', url: '/api/admin/segments/names', min: 'AUDITOR' },
  { group: 'segments', method: 'GET', url: '/api/admin/segments/options', min: 'AUDITOR' },
  { group: 'segments', method: 'POST', url: '/api/admin/segments/count', body: INVALID, min: 'OPERATOR' },
  { group: 'segments', method: 'POST', url: '/api/admin/segments', body: INVALID, min: 'OPERATOR' },
  { group: 'segments', method: 'GET', url: `/api/admin/segments/${UUID}`, min: 'AUDITOR' },
  { group: 'segments', method: 'PATCH', url: `/api/admin/segments/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'segments', method: 'DELETE', url: `/api/admin/segments/${UUID}`, min: 'OPERATOR' },
  { group: 'segments', method: 'GET', url: `/api/admin/segments/${UUID}/members.csv`, min: 'AUDITOR' },
  // Step S9: the Shopify exports read by an AUDITOR (the order CSV masked), the ids pasted back by an OPERATOR.
  { group: 'shopify', method: 'GET', url: '/api/admin/shopify/products.csv?currency=JPY', min: 'AUDITOR' },
  { group: 'shopify', method: 'GET', url: `/api/admin/models/${UUID}/shopify`, min: 'AUDITOR' },
  { group: 'shopify', method: 'PUT', url: `/api/admin/models/${UUID}/shopify`, body: INVALID, min: 'OPERATOR' },
  { group: 'shopify', method: 'GET', url: '/api/admin/shopify/orders.csv?from=2026-11-30&to=2026-11-01', min: 'AUDITOR' },
  { group: 'logistics', method: 'GET', url: '/api/admin/locations', min: 'AUDITOR' },
  { group: 'logistics', method: 'POST', url: '/api/admin/locations', body: INVALID, min: 'ADMIN' },
  { group: 'logistics', method: 'PATCH', url: `/api/admin/locations/${UUID}`, body: INVALID, min: 'ADMIN' },
  { group: 'logistics', method: 'GET', url: '/api/admin/carriers', min: 'AUDITOR' },
  { group: 'logistics', method: 'POST', url: '/api/admin/carriers', body: INVALID, min: 'ADMIN' },
  { group: 'logistics', method: 'PATCH', url: `/api/admin/carriers/${UUID}`, body: INVALID, min: 'ADMIN' },
  { group: 'atelier', method: 'GET', url: '/api/admin/atelier/stock', min: 'AUDITOR' },
  { group: 'atelier', method: 'GET', url: `/api/admin/atelier/stock?modelId=${UUID}&locationId=${UUID}`, min: 'AUDITOR' },
  { group: 'atelier', method: 'POST', url: '/api/admin/atelier/stock/transfer', body: INVALID, min: 'OPERATOR' },
  { group: 'atelier', method: 'POST', url: '/api/admin/atelier/stock/adjust', body: INVALID, min: 'OPERATOR' },
  { group: 'atelier', method: 'PUT', url: '/api/admin/atelier/thresholds', body: INVALID, min: 'OPERATOR' },
  { group: 'atelier', method: 'POST', url: '/api/admin/atelier/make', body: INVALID, min: 'OPERATOR' },
  { group: 'atelier', method: 'GET', url: '/api/admin/atelier/bench', min: 'AUDITOR' },
  { group: 'atelier', method: 'GET', url: `/api/admin/atelier/bench?view=ALL&origin=STOCK&skuId=${UUID}&locationId=${UUID}`, min: 'AUDITOR' },
  { group: 'atelier', method: 'GET', url: '/api/admin/atelier/bench.csv', min: 'AUDITOR' },
  { group: 'atelier', method: 'POST', url: `/api/admin/atelier/bench/${UUID}/start`, body: INVALID, min: 'OPERATOR' },
  { group: 'atelier', method: 'POST', url: `/api/admin/atelier/bench/${UUID}/done`, body: INVALID, min: 'OPERATOR' },
  { group: 'atelier', method: 'POST', url: `/api/admin/atelier/bench/${UUID}/cancel`, body: INVALID, min: 'OPERATOR' },
  { group: 'atelier', method: 'POST', url: '/api/admin/atelier/sheets', body: INVALID, min: 'OPERATOR' },
  { group: 'analytics', method: 'GET', url: '/api/admin/analytics/circle', min: 'AUDITOR' },
  { group: 'analytics', method: 'GET', url: '/api/admin/analytics/circle?days=367', min: 'AUDITOR' },
  { group: 'analytics', method: 'GET', url: '/api/admin/analytics/best-time?days=367', min: 'AUDITOR' },
  { group: 'analytics', method: 'GET', url: '/api/admin/analytics/best-time?tier=4', min: 'AUDITOR' },
  // GROWTH (plan NEXT-NINE, BP-29): read by an AUDITOR; RETAIL refused.
  { group: 'growth', method: 'GET', url: '/api/admin/growth?months=6', min: 'AUDITOR' },
  { group: 'growth', method: 'GET', url: '/api/admin/growth?currency=JPY', min: 'AUDITOR' },
  { group: 'growth', method: 'GET', url: '/api/admin/growth/collectors?page=0', min: 'AUDITOR' },
  { group: 'growth', method: 'GET', url: '/api/admin/growth/releases', min: 'AUDITOR' },
  { group: 'warranties', method: 'GET', url: '/api/admin/warranties', min: 'AUDITOR' },
  { group: 'anomalies', method: 'GET', url: '/api/admin/anomalies', min: 'AUDITOR' },
  { group: 'anomalies', method: 'GET', url: `/api/admin/anomalies?type=IMPOSSIBLE_TRAVEL&productId=${PID}&sort=risk`, min: 'AUDITOR' },
  { group: 'anomalies', method: 'GET', url: '/api/admin/anomalies/summary', min: 'AUDITOR' },
  { group: 'anomalies', method: 'GET', url: `/api/admin/anomalies/${UUID}/context`, min: 'AUDITOR' },
  { group: 'anomalies', method: 'PATCH', url: `/api/admin/anomalies/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'reports', method: 'GET', url: '/api/admin/reports', min: 'AUDITOR' },
  { group: 'reports', method: 'PATCH', url: `/api/admin/reports/${UUID}`, body: INVALID, min: 'OPERATOR' },
  { group: 'revocations', method: 'GET', url: '/api/admin/revocations', min: 'AUDITOR' },
  { group: 'revocations', method: 'POST', url: '/api/admin/revocations', body: INVALID, min: 'ADMIN' },
  { group: 'keys', method: 'GET', url: '/api/admin/keys', min: 'AUDITOR' },
  { group: 'keys', method: 'POST', url: '/api/admin/keys/rotate', body: INVALID, min: 'ADMIN' },
  { group: 'keys', method: 'POST', url: '/api/admin/keys/1/retire', body: INVALID, min: 'ADMIN' },
  { group: 'keys', method: 'POST', url: '/api/admin/keys/1/revoke', body: INVALID, min: 'ADMIN' },
  { group: 'admins', method: 'GET', url: '/api/admin/admins', min: 'ADMIN' },
  { group: 'admins', method: 'POST', url: `/api/admin/admins/${UUID}/totp/reset`, body: INVALID, min: 'ADMIN' },
  { group: 'admins', method: 'POST', url: '/api/admin/admins', body: INVALID, min: 'ADMIN' },
  { group: 'admins', method: 'PATCH', url: `/api/admin/admins/${UUID}/role`, body: INVALID, min: 'ADMIN' },
  { group: 'admins', method: 'POST', url: `/api/admin/admins/${UUID}/disable`, body: INVALID, min: 'ADMIN' },
  { group: 'admins', method: 'POST', url: `/api/admin/admins/${UUID}/enable`, body: INVALID, min: 'ADMIN' },
  { group: 'admins', method: 'POST', url: `/api/admin/admins/${UUID}/unlock`, body: INVALID, min: 'ADMIN' },
  { group: 'admins', method: 'GET', url: `/api/admin/admins/${UUID}/sessions`, min: 'ADMIN' },
  { group: 'admins', method: 'DELETE', url: `/api/admin/admins/${UUID}/sessions`, min: 'ADMIN' },
  { group: 'auth', method: 'GET', url: '/api/admin/auth/me', min: 'RETAIL' },
  { group: 'auth', method: 'POST', url: '/api/admin/auth/totp/enable', body: INVALID, min: 'RETAIL' },
  { group: 'password', method: 'POST', url: '/api/admin/auth/password', body: INVALID, min: 'RETAIL' },
  { group: 'retailers', method: 'GET', url: '/api/admin/retailers', min: 'RETAIL', roles: RETAILER_READERS },
  { group: 'retailers', method: 'GET', url: '/api/admin/retailers?active=true', min: 'RETAIL', roles: RETAILER_READERS },
  { group: 'retailers', method: 'POST', url: '/api/admin/retailers', body: INVALID, min: 'ADMIN' },
  { group: 'retailers', method: 'PATCH', url: `/api/admin/retailers/${UUID}`, body: INVALID, min: 'ADMIN' },
  { group: 'sale', method: 'POST', url: '/api/admin/sale/lookup', body: INVALID, min: 'RETAIL', roles: SELLERS },
  { group: 'sale', method: 'POST', url: '/api/admin/sale/activate', body: INVALID, min: 'RETAIL', roles: SELLERS },
  { group: 'audit', method: 'GET', url: '/api/admin/audit', min: 'AUDITOR' },
  { group: 'audit', method: 'GET', url: '/api/admin/audit/verify', min: 'AUDITOR' },
];

describe('admin role enforcement', () => {
  let h: Harness;
  const clients = {} as Record<AdminRole, Client>;

  beforeAll(async () => {
    h = await createHarness();
    for (const role of ROLES) clients[role] = await adminClient(h, role);
  });
  afterAll(() => h?.close());

  it('covers every admin route of the contract', () => {
    const groups = new Set(PROBES.map((p) => p.group));
    for (const g of [
      'dashboard',
      'analytics',
      'documents',
      'categories',
      'models',
      'collections',
      'products',
      'lifecycle',
      'codes',
      'certificates',
      'warranty',
      'services',
      'ownership',
      'genomes',
      'scans',
      'owners',
      'warranties',
      'anomalies',
      'reports',
      'revocations',
      'keys',
      'audit',
      'admins',
      'auth',
      'password',
      'retailers',
      'sale',
      'media',
      'lookbook',
      'drops',
      'circle',
      'tiers',
      'live',
      'orders',
      'invoices',
      'segments',
      'shopify',
      'logistics',
      'atelier',
      'messages',
      'program',
      'care',
      'guarantees',
      'sizes',
      'pairs',
      'growth',
      'system',
      'test-entrants',
      'suppliers',
    ]) {
      expect(groups.has(g)).toBe(true);
    }
  });

  for (const role of ROLES) {
    it(`${role}: allowed exactly where its rank reaches (or where the route names it)`, async () => {
      for (const p of PROBES) {
        const res = await clients[role].request(p.method, p.url, { ...(p.body !== undefined ? { body: p.body } : {}), ...(p.headers ? { headers: p.headers } : {}) });
        const label = `${role} ${p.method} ${p.url} → ${res.statusCode} ${res.body.slice(0, 120)}`;
        if (allows(p, role)) {
          expect([200, 201, 400, 404], label).toContain(res.statusCode);
          if (res.statusCode === 400) expect(errorOf(res).code, label).toBe('VALIDATION_FAILED');
        } else {
          expect(res.statusCode, label).toBe(403);
          expect(errorOf(res).code, label).toBe('FORBIDDEN');
        }
      }
    });
  }

  it('anonymous callers get 401 on every admin route', async () => {
    const anon = h.client();
    for (const p of PROBES) {
      const res = await anon.request(p.method, p.url, { ...(p.body !== undefined ? { body: p.body } : {}), ...(p.headers ? { headers: p.headers } : {}) });
      expect(res.statusCode, `${p.method} ${p.url}`).toBe(401);
    }
  });

  it('a customer session is not an admin session', async () => {
    const c = h.client();
    await c.post('/api/v1/account/register', { email: `cust-${randomUUID().slice(0, 6)}@example.com`, password: 'correct horse battery staple' });
    expect((await c.get('/api/admin/dashboard')).statusCode).toBe(401);
  });

  it('OPERATOR, AUDITOR, RETAIL and LOGISTICS get 403 on every Team route (A-02), before validation', async () => {
    const team = PROBES.filter((p) => p.url.startsWith('/api/admin/admins'));
    expect(team).toHaveLength(9);
    for (const role of ['OPERATOR', 'AUDITOR', 'RETAIL', 'LOGISTICS'] as const) {
      for (const p of team) {
        const res = await clients[role].request(p.method, p.url, p.body !== undefined ? { body: p.body } : {});
        expect(res.statusCode, `${role} ${p.method} ${p.url}`).toBe(403);
        expect(errorOf(res).code).toBe('FORBIDDEN');
      }
    }
  });

  it('RETAIL (A-08) can neither issue, nor download, nor read owners or scans: only the sale mode, the points of sale and its own account', async () => {
    const retail = clients.RETAIL;
    const refused: [string, string, unknown?][] = [
      ['POST', '/api/admin/products', { categoryCode: 'J', modelId: UUID, material: 'SILVER' }],
      ['GET', `/api/admin/codes/${UUID}/artifact.svg`],
      ['GET', `/api/admin/codes/${UUID}/artifact.pdf`],
      ['POST', '/api/admin/codes/print-sheet', { codeIds: [UUID] }],
      ['POST', '/api/admin/certificates', { items: [{ productId: PID, claimCode: 'X' }] }],
      ['GET', '/api/admin/owners'],
      ['GET', '/api/admin/scans'],
      ['GET', '/api/admin/products'],
      ['GET', `/api/admin/products/${PID}`],
      ['POST', `/api/admin/products/${PID}/warranty/activate`, {}],
      ['GET', '/api/admin/dashboard'],
      ['GET', '/api/admin/warranties'],
      ['GET', '/api/admin/audit'],
    ];
    for (const [method, url, body] of refused) {
      const res = await retail.request(method, url, body !== undefined ? { body } : {});
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(errorOf(res).code, `${method} ${url}`).toBe('FORBIDDEN');
    }
    const allowed = PROBES.filter((p) => p.min === 'RETAIL').map((p) => `${p.method} ${p.url.split('?')[0]}`);
    expect([...new Set(allowed)].sort()).toEqual(
      [
        'GET /api/admin/auth/me',
        'GET /api/admin/retailers',
        'POST /api/admin/auth/password',
        'POST /api/admin/auth/totp/enable',
        'POST /api/admin/sale/activate',
        'POST /api/admin/sale/lookup',
      ].sort(),
    );
    // Its own session: me, a TOTP enrolment started, sign-out.
    expect((await retail.get('/api/admin/auth/me')).statusCode).toBe(200);
    expect((await retail.post('/api/admin/auth/totp/setup')).statusCode).toBe(200);
    expect((await retail.post('/api/admin/auth/logout')).statusCode).toBe(200);
    expect((await retail.get('/api/admin/auth/me')).statusCode).toBe(401);
    clients.RETAIL = await adminClient(h, 'RETAIL');
  });

  it('LOGISTICS (plan NEXT LOT §3.5.6.1) reaches only its own account and the routes that name it: never the points of sale, the sale mode, owners, orders, the club, locations, carriers or settings', async () => {
    const agent = clients.LOGISTICS;
    const refused: [string, string, unknown?][] = [
      ['GET', '/api/admin/retailers'],
      ['GET', '/api/admin/retailers?active=true'],
      ['POST', '/api/admin/sale/lookup', INVALID],
      ['GET', '/api/admin/owners'],
      ['GET', '/api/admin/orders'],
      ['GET', `/api/admin/orders/${UUID}`],
      ['GET', '/api/admin/club/program'],
      ['GET', '/api/admin/drops'],
      ['GET', '/api/admin/locations'],
      ['GET', '/api/admin/carriers'],
      ['GET', '/api/admin/orders/alerts'],
      ['GET', '/api/admin/atelier/stock'],
      ['GET', '/api/admin/products'],
      ['GET', '/api/admin/dashboard'],
      ['POST', '/api/admin/products', { categoryCode: 'J', modelId: UUID, material: 'SILVER' }],
    ];
    for (const [method, url, body] of refused) {
      const res = await agent.request(method, url, body !== undefined ? { body } : {});
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(errorOf(res).code, `${method} ${url}`).toBe('FORBIDDEN');
    }
    const allowed = PROBES.filter((p) => allows(p, 'LOGISTICS')).map((p) => `${p.method} ${p.url.split('?')[0]}`);
    expect([...new Set(allowed)].sort()).toEqual(['GET /api/admin/auth/me', 'POST /api/admin/auth/password', 'POST /api/admin/auth/totp/enable'].sort());
    // Its own session: me (its role, never its locations' names), a TOTP enrolment started, sign-out.
    const me = await agent.get('/api/admin/auth/me');
    expect(me.statusCode).toBe(200);
    expect((JSON.parse(me.body) as { admin: { role: string } }).admin.role).toBe('LOGISTICS');
    expect((await agent.post('/api/admin/auth/totp/setup')).statusCode).toBe(200);
    expect((await agent.post('/api/admin/auth/logout')).statusCode).toBe(200);
    expect((await agent.get('/api/admin/auth/me')).statusCode).toBe(401);
    clients.LOGISTICS = await adminClient(h, 'LOGISTICS');
  });

  it('AUDITOR (A-08) reads the points of sale but never sells: the sale mode starts warranties, a mutation', async () => {
    for (const url of ['/api/admin/sale/lookup', '/api/admin/sale/activate']) {
      const res = await clients.AUDITOR.post(url, INVALID);
      expect(res.statusCode, url).toBe(403);
      expect(errorOf(res).code, url).toBe('FORBIDDEN');
      // RETAIL, OPERATOR and ADMIN pass the guard (then validation refuses the body).
      for (const role of SELLERS) expect((await clients[role].post(url, INVALID)).statusCode, `${role} ${url}`).toBe(400);
    }
    expect((await clients.AUDITOR.get('/api/admin/retailers')).statusCode).toBe(200);
  });

  it('OPERATOR may transition products but not revoke them', async () => {
    const res = await clients.OPERATOR.post(`/api/admin/products/${PID}/transitions`, { to: 'REVOKED', reason: 'x' });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('FORBIDDEN');
    // ADMIN gets past the role check (the product does not exist here).
    expect((await clients.ADMIN.post(`/api/admin/products/${PID}/transitions`, { to: 'REVOKED', reason: 'x' })).statusCode).toBe(404);
  });

  it('OPERATOR may take a return back to stock but not archive it: the archive retires the piece', async () => {
    const url = `/api/admin/orders/${UUID}/return`;
    const res = await clients.OPERATOR.post(url, { outcome: 'ARCHIVED', note: 'Returned damaged.' });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe('FORBIDDEN');
    // Back to stock, the OPERATOR gets past the role check; so does an ADMIN archiving (the order does not exist here).
    expect((await clients.OPERATOR.post(url, { outcome: 'RESTOCKED', locationId: UUID, note: 'Returned unworn.' })).statusCode).toBe(404);
    expect((await clients.ADMIN.post(url, { outcome: 'ARCHIVED', note: 'Returned damaged.' })).statusCode).toBe(404);
  });
});
