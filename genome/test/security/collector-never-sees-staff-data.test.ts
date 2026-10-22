/**
 * The security sentinel of the customer intelligence lot (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.0 (k) and (n),
 * §3.6 C.9 « Nothing reaches the collector », C.13; step 9.13): what goes to the collector, in the app or in the
 * right-of-access JSON an ADMIN makes for them, never carries Client Services' tags, private notes, the engagement score
 * and its parts, the monthly history, a console login nor another collector's data.
 *
 * The house is the NOCTURNE demo (test/support/nocturne-demo.ts, the full story the e2e tests and the boards read), its
 * collector you@example.com signed in. Before any reading, the sentinel gives that collector what staff hold about it:
 * a tag and a private note written through ClientNoteService, an `account_scores` row (the morning's score and its five
 * parts), a `collector_history` row (a month's score, tier and activity) and a warranty claim on its first piece with
 * Client Services' note (plan ORBES CARE, step 1.7: the care status's `claim` and the export's `warrantyClaims` are
 * read as every reply is, never empty); the collector's own two messages about that piece and its latest order give
 * MESSAGES' thread its `ref`s (the desktop's subjects), read as every reply is. It checks the staff side reads them back
 * (the client sheet, its Intelligence, the history row) and that its scanner finds them there: without that seeding the
 * sentinel fails, so it never passes on an empty house.
 *
 * Then it reads, as the collector:
 *  - every GET of routes/account.ts, public.ts, club.ts, live.ts, messages.ts and ownership.ts, and the lot's /api/v1
 *    routes (GET /api/v1/account/sign-up, /profile, /wishlist; the replies of PUT /api/v1/account/profile and PUT
 *    /api/v1/account/wishlist/:slug; POST /api/v1/seen; GET /go/:code). The route files are read, so a GET added to them
 *    without being read here fails the sentinel; the few left out are named with their reason (a PDF, a stored photograph,
 *    the LIVE room's event stream, which carries the state its own GET carries). Lot M2 step M2.7: the piece's WORN, a
 *    sheet's WORN pages (public and the club's), with another collector's photograph published on the public sheet, so
 *    its credit is read and its account never is;
 *  - the right-of-access JSON of that account (GET /api/admin/owners/:id/export, ADMIN), which goes to the collector.
 *
 * Every reply is scanned: no key `tags`, `privateNotes`, `score`, `scores`, `engagement`, the parts' names or the
 * history's, nor who opened or decided a claim; no tag's or note's words (the claim's note too); no email of a console
 * login; no email nor id of another account.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookieName } from '../../src/server/services/sessions.js';
import { seedNocturne, type NocturneDemo } from '../support/nocturne-demo.js';
import { NOCTURNE_CONFIG } from '../support/nocturne-stage.js';
import { seedScore } from '../support/scores.js';
import { adminClient, createHarness, safeJson, type Client, type Harness } from '../api/support.js';

const ROUTES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'server', 'routes');
/** The collector's route files (§3.6 C.9) and the lot's (acquisition.ts: /go/:code). */
const COLLECTOR_FILES = ['account.ts', 'public.ts', 'club.ts', 'live.ts', 'messages.ts', 'ownership.ts', 'acquisition.ts'] as const;

/** The GETs not read here, each with why (none of them carries what staff hold). */
const NOT_READ: Readonly<Record<string, string>> = Object.freeze({
  '/api/v1/account/orders/:id/invoice.pdf': 'a PDF of the order, the collector’s own',
  '/api/v1/account/orders/:id/credit-note.pdf': 'a PDF of the order, the collector’s own',
  '/api/v1/account/orders/:id/documents/:number': 'a PDF of the order, the collector’s own',
  '/api/v1/account/orders/:id/certificate.pdf': 'a PDF of the piece, the collector’s own',
  '/api/v1/account/orders/:id/care-conditions.pdf': 'a PDF of the order’s ORBES CARE conditions, the published terms',
  '/api/v1/account/care/:id/label.pdf': 'a PDF label of a care request',
  '/api/v1/account/warranty-claims/:id/label.pdf': 'a PDF label of a warranty claim',
  '/api/v1/media/:sha256': 'a stored photograph',
  '/api/v1/live/:id/stream': 'the LIVE room’s event stream, the state GET /api/v1/live/:id/state carries',
  // Lot M2 step M2.7 (WORN): photographs' bytes.
  '/api/v1/account/worn/:id/photo': 'a WORN photograph, the collector’s own',
  '/api/v1/worn/:id/photo': 'a WORN photograph published',
});

/** Keys staff data would sit under: tags, private notes, the score and its parts, the monthly history, a team mark. */
const STAFF_KEYS = new Set([
  'tags',
  'tag',
  'privateNotes',
  'privateNote',
  'score',
  'scores',
  'engagement',
  'recencyPoints',
  'frequencyPoints',
  'spendPoints',
  'speedPoints',
  'attendancePoints',
  'recency_points',
  'frequency_points',
  'spend_points',
  'speed_points',
  'attendance_points',
  'collectorHistory',
  'firstMonth',
  'first_month',
  'teamAccount',
  // A warranty claim's staff side (plan ORBES CARE): who opened and who decided it.
  'openedBy',
  'decidedBy',
  'opened_by',
  'decided_by',
]);

const TAG = 'SENTINEL ZQX';
const NOTE = 'Sentinel note QZX: prefers a call after six.';
const SCORE = 87;
const CLAIM_NOTE = 'Sentinel claim note QXZ: the clasp, seen at the counter.';

/** What a reply carries that it must not: keys of STAFF_KEYS, and the forbidden words (found in its text). */
function findings(body: string, forbidden: readonly string[]): string[] {
  const out: string[] = [];
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (STAFF_KEYS.has(k)) out.push(`key ${path}.${k}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(json, '$');
  const lower = body.toLowerCase();
  for (const w of forbidden) if (w && lower.includes(w.toLowerCase())) out.push(`text ${w}`);
  return out;
}

/** The GET paths a route file declares (`app.get('/…'`). */
function getPaths(file: string): string[] {
  const src = readFileSync(join(ROUTES, file), 'utf8');
  return [...src.matchAll(/app\.get\(\s*'([^']+)'/g)].map((m) => m[1]!);
}

describe('the collector never sees staff data (§3.6 C.9, §3.0 (k); step 9.13)', () => {
  let h: Harness;
  let demo: NocturneDemo;
  let you: Client;
  let admin: Client;
  let youId = '';
  let claimId = '';
  /** Words no reply to the collector may hold: the tag, the note, console logins' emails, other accounts' emails and ids. */
  let forbidden: string[] = [];
  /** Every reply read, by what was asked. */
  const replies = new Map<string, LightMyRequestResponse>();

  beforeAll(async () => {
    h = await createHarness({ config: { ...NOCTURNE_CONFIG } });
    demo = await seedNocturne(h.ctx, h.clock, 'full');
    youId = demo.accounts.you!.id;
    admin = await adminClient(h, 'ADMIN');
    const staff = { type: 'admin' as const, id: (await h.t.db.selectFrom('admin_users').select('id').orderBy('created_at').executeTakeFirstOrThrow()).id };

    // What staff hold about the collector: a tag, a private note, the morning's score, a month of the history.
    await h.ctx.services.clientNotes.addTag(youId, TAG, staff);
    await h.ctx.services.clientNotes.addNote(youId, NOTE, staff);
    await seedScore(h.t.db, youId, SCORE, h.clock.now());
    await h.t.db.insertInto('collector_history').values({ account_id: youId, first_month: '2026-09-01', scores: [SCORE], tiers: [1], active: [true], last_month: '2026-09-01' }).execute();
    // A warranty claim on the collector's first piece (the one the care status below is read for), with Client Services' note.
    const first = await h.t.db
      .selectFrom('ownership as o')
      .innerJoin('products as p', 'p.id', 'o.product_id')
      .select('p.product_id')
      .where('o.account_id', '=', youId)
      .where('o.ended_at', 'is', null)
      .orderBy('o.started_at')
      .executeTakeFirstOrThrow();
    // A word in MESSAGES about that piece and about the collector's latest order, so the thread's `ref`s are read too.
    const order = await h.t.db.selectFrom('orders').select('id').where('account_id', '=', youId).orderBy('reserved_at', 'desc').executeTakeFirstOrThrow();
    const asYou = { type: 'account' as const, id: youId };
    await h.ctx.services.messages.write(youId, { body: 'About my piece.', context: { kind: 'PIECE', id: first.product_id } }, asYou);
    await h.ctx.services.messages.write(youId, { body: 'About my order.', context: { kind: 'ORDER', id: order.id } }, asYou);
    const conversation =
      (await h.t.db.selectFrom('client_conversations').select('id').where('account_id', '=', youId).executeTakeFirst()) ??
      (await h.t.db.insertInto('client_conversations').values({ account_id: youId, status: 'ANSWERED', last_message_at: h.clock.now() }).returning('id').executeTakeFirstOrThrow());
    claimId = (await h.ctx.services.warrantyClaims.open({ conversationId: conversation.id, productId: first.product_id, basis: 'WARRANTY', note: CLAIM_NOTE }, staff)).id;

    const accounts = await h.t.db.selectFrom('accounts').select(['id', 'email']).where('id', '<>', youId).execute();
    const logins = await h.t.db.selectFrom('admin_users').select('email').execute();
    forbidden = [TAG, NOTE, CLAIM_NOTE, staff.id, ...logins.map((l) => l.email), ...accounts.flatMap((a) => [a.email, a.id])];

    you = h.client();
    you.cookies.set(sessionCookieName(h.ctx.config, 'account'), demo.accounts.you!.token);
    // The session's CSRF token, for the PUTs.
    expect((await you.get('/api/v1/account/session')).statusCode).toBe(200);
    expect(you.csrf).toBeTruthy();
  }, 240_000);
  afterAll(() => h?.close());

  it('the seeding is there: staff read the tag, the note, the score and the history, and the scanner finds them in staff’s replies', async () => {
    const sheet = await admin.get(`/api/admin/owners/${youId}`);
    expect(sheet.statusCode).toBe(200);
    const s = safeJson(sheet) as { tags: string[]; privateNotes: { items: { text: string }[] } };
    expect(s.tags).toContain(TAG);
    expect(s.privateNotes.items.map((n) => n.text)).toContain(NOTE);
    const intel = await admin.get(`/api/admin/owners/${youId}/intelligence`);
    expect(intel.statusCode).toBe(200);
    expect((safeJson(intel) as { engagement: { score: { score: number } | null } }).engagement.score?.score).toBe(SCORE);
    const history = await h.t.db.selectFrom('collector_history').select(['scores', 'last_month']).where('account_id', '=', youId).executeTakeFirstOrThrow();
    expect(history.scores).toEqual([SCORE]);
    // The scanner is not blind: it reports the staff side.
    expect(findings(sheet.body, forbidden)).toEqual(expect.arrayContaining(['key $.tags', `text ${TAG}`, `text ${NOTE}`, 'key $.privateNotes']));
    expect(findings(intel.body, forbidden)).toEqual(expect.arrayContaining(['key $.engagement']));
    // The claim: staff read its note and who opened it.
    const claim = await admin.get(`/api/admin/warranty-claims/${claimId}`);
    expect(claim.statusCode).toBe(200);
    expect(findings(claim.body, forbidden)).toEqual(expect.arrayContaining([`text ${CLAIM_NOTE}`, 'key $.openedBy']));
  });

  it('every collector GET (and the lot’s /api/v1 replies) carries no tag, note, score, history, console login nor another collector’s data', async () => {
    const db = h.t.db;
    const order = await db.selectFrom('orders').select('id').where('account_id', '=', youId).orderBy('reserved_at', 'desc').executeTakeFirstOrThrow();
    const piece = await db
      .selectFrom('ownership as o')
      .innerJoin('products as p', 'p.id', 'o.product_id')
      .select('p.product_id')
      .where('o.account_id', '=', youId)
      .where('o.ended_at', 'is', null)
      .orderBy('o.started_at')
      .executeTakeFirstOrThrow();
    const publicModel = await db.selectFrom('models').select('slug').where('lookbook', '=', 'PUBLIC').where('slug', 'is not', null).where('variant_of', 'is', null).orderBy('created_at').executeTakeFirstOrThrow();
    const reserved = (await db.selectFrom('models').select('slug').where('lookbook', '=', 'RESERVED').where('slug', 'is not', null).orderBy('created_at').executeTakeFirst()) ?? publicModel;
    const draw = await db.selectFrom('drops').select('id').where('mode', '=', 'DRAW').where('published_at', 'is not', null).orderBy('opens_at', 'desc').executeTakeFirstOrThrow();
    const live = await db.selectFrom('drops').select('id').where('mode', '=', 'LIVE').where('published_at', 'is not', null).where('parent_drop_id', 'is', null).orderBy('opens_at', 'desc').executeTakeFirstOrThrow();
    const post = await db.selectFrom('circle_posts').select('id').orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    const link = await h.ctx.services.links.create({ name: 'Sentinel link', channelId: (await h.ctx.services.links.channels())[0]!.id, destination: 'NOW' }, { type: 'admin', id: (await db.selectFrom('admin_users').select('id').executeTakeFirstOrThrow()).id });

    /** Each GET of the collector's route files, as read here. */
    const URLS: Record<string, string> = {
      '/api/v1/account/sign-up': '/api/v1/account/sign-up',
      // Lot M1 step M1.17: whether RESET BY EMAIL is offered, and YOUR PROFILE's release notices (409 EMAIL_OFF here).
      '/api/v1/account/reset': '/api/v1/account/reset',
      '/api/v1/account/email-preferences': '/api/v1/account/email-preferences',
      '/api/v1/account/session': '/api/v1/account/session',
      '/api/v1/account/me': '/api/v1/account/me',
      '/api/v1/account/products': '/api/v1/account/products',
      '/api/v1/account/sizes': '/api/v1/account/sizes',
      '/api/v1/account/profile': '/api/v1/account/profile',
      '/api/v1/account/wishlist': '/api/v1/account/wishlist',
      '/api/v1/account/addresses': '/api/v1/account/addresses',
      '/api/v1/account/orders': '/api/v1/account/orders',
      '/api/v1/account/participation': '/api/v1/account/participation',
      '/api/v1/account/questions': '/api/v1/account/questions',
      '/api/v1/account/orders/:id/care-guide': `/api/v1/account/orders/${order.id}/care-guide`,
      // Plan MACRO M3 §4.2 (D2): what can be added to the order now.
      '/api/v1/account/orders/:id/addons': `/api/v1/account/orders/${order.id}/addons`,
      '/api/v1/account/products/:productId/care': `/api/v1/account/products/${piece.product_id}/care`,
      // Lot M2 step M2.7: the piece's WORN.
      '/api/v1/account/products/:productId/worn': `/api/v1/account/products/${piece.product_id}/worn`,
      '/api/v1/products/:productId/service-history': `/api/v1/products/${piece.product_id}/service-history`,
      '/api/v1/health': '/api/v1/health',
      '/api/v1/keys': '/api/v1/keys',
      '/.well-known/orbes-keys.json': '/.well-known/orbes-keys.json',
      '/api/v1/categories': '/api/v1/categories',
      '/api/v1/client-services': '/api/v1/client-services',
      '/api/v1/lookbook': '/api/v1/lookbook',
      '/api/v1/lookbook/:slug': `/api/v1/lookbook/${publicModel.slug}`,
      '/api/v1/lookbook/:slug/worn': `/api/v1/lookbook/${publicModel.slug}/worn`,
      '/api/v1/drops': '/api/v1/drops',
      '/api/v1/drops/:id': `/api/v1/drops/${draw.id}`,
      '/api/v1/drops/:id/entries': `/api/v1/drops/${draw.id}/entries`,
      '/api/v1/drops/:id/calendar.ics': `/api/v1/drops/${draw.id}/calendar.ics`,
      '/api/v1/releases/past': '/api/v1/releases/past',
      '/api/v1/the-club': '/api/v1/the-club',
      '/api/v1/releases/rules': '/api/v1/releases/rules',
      '/api/v1/club/lookbook': '/api/v1/club/lookbook',
      '/api/v1/club/lookbook/:slug': `/api/v1/club/lookbook/${reserved.slug}`,
      '/api/v1/club/lookbook/:slug/worn': `/api/v1/club/lookbook/${reserved.slug}/worn`,
      '/api/v1/club/status': '/api/v1/club/status',
      '/api/v1/club/drops/:id/entry': `/api/v1/club/drops/${draw.id}/entry`,
      '/api/v1/club/circle': '/api/v1/club/circle',
      '/api/v1/club/circle/:id': `/api/v1/club/circle/${post.id}`,
      '/api/v1/live': '/api/v1/live',
      '/api/v1/live/next': '/api/v1/live/next',
      '/api/v1/live/clock': '/api/v1/live/clock',
      '/api/v1/live/:id': `/api/v1/live/${live.id}`,
      '/api/v1/live/:id/calendar.ics': `/api/v1/live/${live.id}/calendar.ics`,
      '/api/v1/live/mine': '/api/v1/live/mine',
      '/api/v1/live/:id/after-room': `/api/v1/live/${live.id}/after-room`,
      '/api/v1/live/:id/state': `/api/v1/live/${live.id}/state`,
      '/api/v1/live/:id/question': `/api/v1/live/${live.id}/question`,
      '/api/v1/account/messages': '/api/v1/account/messages',
      '/api/v1/account/messages/unread': '/api/v1/account/messages/unread',
      '/api/v1/account/messages/unread-count': '/api/v1/account/messages/unread-count',
      // Lot M2 step M2.2: MESSAGES' house messages (a moment delivered below, so the reply is a real one).
      '/api/v1/account/house-messages': '/api/v1/account/house-messages',
      '/api/v1/ownership/certificates': '/api/v1/ownership/certificates',
      '/go/:code': `/go/${link.code}`,
    };

    // A house message of the collector's own (plan MACRO M2 §1.2: the first registration's moment, its piece named).
    await db
      .insertInto('house_deliveries')
      .values({ account_id: youId, source: 'MOMENT', moment: 'FIRST_REGISTRATION', title: 'YOUR FIRST PIECE', body: 'Its words.', piece_ref: piece.product_id, dedupe_key: `FIRST_REGISTRATION:${youId}` })
      .onConflict((oc) => oc.column('dedupe_key').doNothing())
      .execute();

    // WORN (lot M2 step M2.7): another collector's photograph published on the public sheet, its credit only to be read.
    const theirs = await db
      .selectFrom('ownership as o')
      .innerJoin('accounts as a', 'a.id', 'o.account_id')
      .innerJoin('products as p', 'p.id', 'o.product_id')
      .select(['o.id', 'o.account_id', 'o.product_id'])
      .where('o.ended_at', 'is', null)
      .where('o.account_id', '<>', youId)
      .where('a.status', '=', 'ACTIVE')
      .where('p.status', '<>', 'REVOKED')
      .orderBy('o.started_at')
      .executeTakeFirstOrThrow();
    const sheetModel = await db.selectFrom('models').select('id').where('slug', '=', publicModel.slug).executeTakeFirstOrThrow();
    const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const reviewer = await db.selectFrom('admin_users').select('id').executeTakeFirstOrThrow();
    const at = h.clock.now();
    await db
      .insertInto('worn_photos')
      .values({
        product_id: theirs.product_id, ownership_id: theirs.id, account_id: theirs.account_id, model_id: sheetModel.id,
        photo, photo_mime: 'image/jpeg', photo_sha256: createHash('sha256').update(photo).digest('hex'), width: 4, height: 5,
        credit_first_name: 'Sentinel', credit_country: 'FR', consent_at: at, consent_version: '2026-10-21',
        status: 'PUBLISHED', reviewed_by: reviewer.id, reviewed_at: at, published_at: at, created_at: at,
      })
      .execute();

    // The route files read: every GET they declare is read here or named in NOT_READ.
    const declared = COLLECTOR_FILES.flatMap(getPaths);
    expect(declared.length).toBeGreaterThan(40);
    for (const path of declared) expect(path in URLS || path in NOT_READ, `${path}: read it in the sentinel, or say why not in NOT_READ`).toBe(true);
    for (const path of [...Object.keys(URLS), ...Object.keys(NOT_READ)]) expect(declared, `${path} is no GET of the collector's route files any more`).toContain(path);

    for (const [path, url] of Object.entries(URLS)) {
      const res = await you.get(url);
      replies.set(`GET ${path}`, res);
      expect(res.statusCode, `GET ${url} → ${res.body.slice(0, 200)}`).toBeLessThan(500);
    }
    // The collector's own screens answer: the sentinel reads real replies, not refusals.
    for (const path of ['/api/v1/account/me', '/api/v1/account/products', '/api/v1/account/profile', '/api/v1/account/wishlist', '/api/v1/account/orders', '/api/v1/account/participation', '/api/v1/club/status', '/api/v1/club/circle', '/api/v1/account/messages', '/api/v1/account/messages/unread-count', '/api/v1/account/house-messages', '/api/v1/ownership/certificates', '/api/v1/live/mine', '/api/v1/account/sign-up', '/api/v1/lookbook/:slug', '/api/v1/club/drops/:id/entry']) {
      expect(replies.get(`GET ${path}`)!.statusCode, path).toBe(200);
    }
    expect(replies.get('GET /go/:code')!.statusCode).toBe(302);
    // WORN's replies are real ones: the piece's, and the public sheet's with another collector's photograph credited.
    for (const path of ['/api/v1/account/products/:productId/worn', '/api/v1/lookbook/:slug/worn']) expect(replies.get(`GET ${path}`)!.statusCode, path).toBe(200);
    expect((safeJson(replies.get('GET /api/v1/lookbook/:slug/worn')!) as { photos: { credit: { firstName: string } }[] }).photos.map((p) => p.credit.firstName)).toContain('Sentinel');
    // The piece's care status carries its claim (plan ORBES CARE): the sentinel reads a real one.
    expect((safeJson(replies.get('GET /api/v1/account/products/:productId/care')!) as { claim: { id: string } | null }).claim?.id).toBe(claimId);
    // MESSAGES carries each context's `ref` (desktop: a reply on a subject attaches it again): the sentinel reads real
    // ones, and each is the collector's own (a piece it holds or held, its order) or a scan, release or model it wrote about.
    const thread = safeJson(replies.get('GET /api/v1/account/messages')!) as { messages: { concerning: { kind: string; ref?: string | null } | null }[] };
    const refs = thread.messages.flatMap((m) => (m.concerning?.ref ? [{ kind: m.concerning.kind, ref: m.concerning.ref }] : []));
    expect(refs.map((r) => r.kind)).toEqual(expect.arrayContaining(['PIECE', 'ORDER']));
    for (const { kind, ref } of refs) {
      expect(['PIECE', 'ORDER', 'RELEASE', 'SCAN', 'MODEL'], ref).toContain(kind);
      if (kind === 'PIECE') {
        const held = await db.selectFrom('ownership as o').innerJoin('products as p', 'p.id', 'o.product_id').select('o.id').where('o.account_id', '=', youId).where('p.product_id', '=', ref).executeTakeFirst();
        expect(held, `PIECE ${ref}`).toBeDefined();
      }
      if (kind === 'ORDER') expect((await db.selectFrom('orders').select('account_id').where('id', '=', ref).executeTakeFirstOrThrow()).account_id).toBe(youId);
    }
    expect(safeJson(replies.get('GET /api/v1/account/messages/unread-count')!)).toEqual({ count: expect.any(Number) });

    // The lot's replies to the collector's own writes: YOUR PROFILE saved as read, a heart on a model, a batch of views.
    const read = safeJson(replies.get('GET /api/v1/account/profile')!) as {
      profile: { version: number; firstName: string | null; lastName: string | null; country: string | null; city: string | null; phone: unknown; instagram: string | null; heard: { optionId: string; other: string | null } | null; tastes: { pieces: { key: string }[]; finishes: { key: string }[] } };
    };
    const p = read.profile;
    const saved = await you.request('PUT', '/api/v1/account/profile', {
      body: {
        version: p.version,
        firstName: p.firstName,
        lastName: p.lastName,
        country: p.country,
        city: p.city,
        phone: p.phone,
        instagram: p.instagram,
        heard: p.heard ? { optionId: p.heard.optionId, other: p.heard.other } : null,
        tastes: { pieces: p.tastes.pieces.map((t) => t.key), finishes: p.tastes.finishes.map((t) => t.key) },
      },
    });
    expect(saved.statusCode, saved.body.slice(0, 200)).toBe(200);
    replies.set('PUT /api/v1/account/profile', saved);
    const heart = await you.request('PUT', `/api/v1/account/wishlist/${publicModel.slug}`);
    expect(heart.statusCode, heart.body.slice(0, 200)).toBeLessThan(300);
    replies.set('PUT /api/v1/account/wishlist/:slug', heart);
    const seen = await you.post('/api/v1/seen', { v: 1, d: { s: true, t: 0, w: 390 }, e: [{ p: 'NOW', ms: 2_000, ago: 0 }] });
    expect(seen.statusCode, seen.body.slice(0, 200)).toBe(204);
    replies.set('POST /api/v1/seen', seen);

    const found: string[] = [];
    for (const [what, res] of replies) for (const f of findings(res.body, forbidden)) found.push(`${what}: ${f}`);
    expect(found).toEqual([]);
  });

  it('the right-of-access JSON of the account, which goes to the collector, carries none of it either (§3.0 (k))', async () => {
    const res = await admin.get(`/api/admin/owners/${youId}/export`);
    expect(res.statusCode).toBe(200);
    const x = safeJson(res) as Record<string, unknown>;
    // Everything else held is there: its profile, its wishlist, its browsing, its origin.
    for (const key of ['account', 'profile', 'tastes', 'wishlist', 'browsing', 'origin', 'orders', 'warrantyClaims']) expect(Object.keys(x), key).toContain(key);
    expect((x.account as { id: string }).id).toBe(youId);
    expect((x.warrantyClaims as { id: string }[]).map((c) => c.id)).toEqual([claimId]);
    expect(findings(res.body, forbidden)).toEqual([]);
  });
});
