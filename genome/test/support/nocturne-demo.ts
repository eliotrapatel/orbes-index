/**
 * The NOCTURNE demo (plan NOCTURNE, fidelity rule 2): the content of the 43 validated boards, seeded through the real
 * services on a fixed clock, for the parity tool (scripts/parity.ts) and the NOCTURNE browser tests (the content and the
 * overflow tests). The story the boards tell, on Monday 5 October 2026 at 18:49 in Paris (NOW):
 *
 *   the collection ORBITAL: MONOLITHE in steel, gold and blue, a model and its two variants (N1: steel the main model,
 *     gold and blue added with ADD A VARIANT, the dots Steel · Gold · Blue), sizes 16 · 17 · 18, the owner's three
 *     photographs (test/fixtures/nocturne/bangle-*.webp); ZENITH in THE PRIVATE SALON, € 4 800, offered from TITANE;
 *   the account you@example.com, TITANE, two pieces: MONOLITHE in steel O26-J-00184, size 17, registered on 3 Oct 2026,
 *     no order (a boutique sale); MONOLITHE in gold, size 17, from the draw of 14 September, delivered and registered on
 *     22 Sep 2026;
 *   its four orders: the LIVE RELEASE of 5 Oct in steel (RESERVED, size 16, € 5 050, ENGRAVING € 150); the draw in gold
 *     (DELIVERED, its invoice); the draw in steel (RETURNED on 2 Oct, its credit note); ZENITH from the salon (CANCELLED);
 *   the releases: MONOLITHE IN BLUE, a LIVE RELEASE on Thursday 8 October at 21:00 Paris, 25 pieces, one per collector,
 *     for owners, 5 collectors who will be there (`rules`: with A SURPRISE IN EVERY BOX and its three access rules joined
 *     by OR, C27); the release of Thursday 22 October, not yet revealed, 12 pieces, from PLATINE, its two reveals; the
 *     steel draw MONOLITHE, THE OCTOBER DRAW, € 4 200 (N1: a draw's price), 12 pieces, entries from 5 Oct 10:00 UTC to
 *     11 Oct 18:00 UTC; the past
 *     releases (the LIVE of 5 Oct in steel and the draw of 14 Sep in gold, a piece secured in each; the draw of
 *     September in steel, whose piece came back; the LIVE of 28 Sep in gold), the question after (a collector whose turn
 *     passed on 5 Oct);
 *   the circle: the invitation AN EVENING AT THE ATELIER (12 Oct 2026, 17:00 UTC, 3 places left of 12, answered YES),
 *     the poll for PLATINE and PALLADIUM, the note THE ANGLED LINK;
 *   the scan cases of C9 and C11–C17: a piece to register, the account's own, one registered to it read signed out,
 *     a piece under review (a burst of scans of copies of its code), a piece reported stolen, a forged signature, a code
 *     ORBES signed for no piece, a revoked code, a piece never delivered, a piece being passed on.
 *
 * Variants (each its own stage, the same story unless said):
 *   full              the story above (C1–C41)
 *   rules             the blue LIVE RELEASE with its surprise and its access rules (C27, C28)
 *   draw-leads        no LIVE RELEASE announced: the October draw leads NOW (C42)
 *   draw-soon         the October draw before its entries open (ENTRIES OPEN SOON, C42 state 2)
 *   draw-early        the October draw in its early access (EARLY ACCESS, C42 state 2)
 *   collection-leads  nothing announced: the newest public model leads NOW (C43)
 *   room              a LIVE RELEASE whose room is open, three minutes before its opening (C21)
 *   live              a LIVE RELEASE live now, a collector at each step of the line and each end (the room's screens)
 *   afterroom         a LIVE RELEASE sold out a few minutes ago, its after-room open (C26)
 *   afterroom-ends    three LIVE RELEASES of the last two hours whose after-rooms ended with a guest still in their
 *                     line: sold out, closed at their time, ended by ORBES; and a guest who never entered one
 *   draws             a draw in every state an entry or a page shows (lot E's direct reservations included): closed
 *                     and not drawn, cancelled, drawn with a place held, a waiting list and a place lapsed, concluded
 *                     with its order PAID, in its early access with every piece reserved, open with every piece
 *                     reserved; a collector (r.castel) with an entry in each, and the October draw withdrawn
 *   stress            the extreme content of fidelity rule 5
 *   empty             every empty state: no model shown, no release, an account without a piece, and an owner
 *                     (one piece of a model kept out of the collection) before an empty circle
 *
 * Ids written by the server (scan references, order and entry references, genomes, invoice numbers) are the server's;
 * the parity tool's comparisons treat them as live data.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromBase64Url } from '../../src/core/bytes.js';
import { computeGenome } from '../../src/core/genome/genome.js';
import { packIdentity } from '../../src/core/identity.js';
import { encodePayload, frameCodeData, signingMessage, unframeCodeData } from '../../src/core/payload.js';
import type { AppContext } from '../../src/server/context.js';
import { deriveDropSeedKey } from '../../src/server/services/drops.js';
import { deriveLiveTurnKey } from '../../src/server/services/live.js';
import { ensureSku } from '../../src/server/services/stock.js';
import { SYSTEM_ACTOR, type Actor, type ManualClock } from '../../src/server/types.js';
import { createLiveRelease, holdPieces, type LiveFixture, type LiveReleaseOptions } from './live.js';

export type DemoVariant =
  | 'full'
  | 'rules'
  | 'draw-leads'
  | 'draw-soon'
  | 'draw-early'
  | 'collection-leads'
  | 'room'
  | 'live'
  | 'afterroom'
  | 'afterroom-ends'
  | 'draws'
  | 'stress'
  | 'empty';

export const DEMO_VARIANTS: readonly DemoVariant[] = Object.freeze([
  'full',
  'rules',
  'draw-leads',
  'draw-soon',
  'draw-early',
  'collection-leads',
  'room',
  'live',
  'afterroom',
  'afterroom-ends',
  'draws',
  'stress',
  'empty',
]);

/** NOW: Monday 5 October 2026, 18:49 in Paris (16:49 UTC), the boards' afternoon. Every clock of the stage is fixed here. */
export const NOCTURNE_NOW = new Date('2026-10-05T16:49:00.000Z');

/** The console's user of the stage (a test value of this demo only). */
export const NOCTURNE_ADMIN = Object.freeze({ email: 'console@example.com', password: 'nocturne-demo-console-password' });
/** The password of every demo account (a test value of this demo only); the captures sign in by a session cookie. */
export const NOCTURNE_PASSWORD = 'nocturne-demo-password';

/** ORBES Client Services as the boards show them. */
export const NOCTURNE_CLIENT_SERVICES = Object.freeze({ email: 'clientservices@example.com', phone: '+33 1 23 45 67 89', hours: 'Monday to Friday, 10:00 to 18:00 (Paris)' });

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'nocturne');
/** The owner's three photographs of the bracelet (copied from the canvas's assets). */
export function nocturnePhoto(kind: 'steel' | 'blue' | 'gold'): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, `bangle-${kind}.webp`)));
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;
const at = (iso: string) => new Date(iso);

/** A code to photograph: its framed data and glyphs. */
export interface DemoCode {
  data: Uint8Array;
  glyphs: number[];
}

export interface DemoAccount {
  id: string;
  email: string;
  /** A session opened at NOW (its cookie signs a capture in). */
  token: string;
  actor: Actor & { id: string };
}

/** What the captures need of a seeded demo. */
export interface NocturneDemo {
  variant: DemoVariant;
  accounts: Record<string, DemoAccount>;
  /** Pieces by role → their reference (O26-J-…). */
  pieces: Record<string, string>;
  /** Codes to photograph or film, by role. */
  codes: Record<string, DemoCode>;
  /** The claim codes of the pieces still to register, by role (test values of this demo, printed on no card). */
  claimCodes: Record<string, string>;
  /** Releases by role → their id. */
  releases: Record<string, string>;
  /** Posts of the circle by role → their id. */
  posts: Record<string, string>;
  /** Models by role → their slug in THE COLLECTION. */
  slugs: Record<string, string>;
  /** The secrets of the links an owner or the console shares (a certificate's, a boutique board's), by role. */
  links: Record<string, string>;
}

interface World {
  ctx: AppContext;
  clock: ManualClock;
  admin: Actor & { id: string };
  f: LiveFixture;
  demo: NocturneDemo;
  models: Record<string, string>;
  collection: string;
  /** Pieces held by the demo, by role → { uuid, productId, codeId, claimCode }. */
  issued: Record<string, { uuid: string; productId: string; codeId: string; data: string; glyphs: number[]; claimCode?: string }>;
}

/** Seed the demo `variant` on a fresh context whose clock is `clock` (left at NOW). */
export async function seedNocturne(ctx: AppContext, clock: ManualClock, variant: DemoVariant): Promise<NocturneDemo> {
  clock.set(at('2026-08-31T08:00:00Z'));
  const adminId = (await ctx.db.selectFrom('admin_users').select('id').where('email_normalized', '=', NOCTURNE_ADMIN.email).executeTakeFirstOrThrow()).id;
  const admin = { type: 'admin' as const, id: adminId };
  if (!(await ctx.categories.getByCode('J'))) await ctx.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
  const demo: NocturneDemo = { variant, accounts: {}, pieces: {}, codes: {}, claimCodes: {}, releases: {}, posts: {}, slugs: {}, links: {} };
  const w: World = {
    ctx,
    clock,
    admin,
    demo,
    models: {},
    collection: '',
    issued: {},
    f: {
      db: ctx.db,
      clock,
      audit: ctx.audit,
      drops: ctx.services.drops,
      live: ctx.services.live,
      liveConsole: ctx.services.liveConsole,
      seedKey: deriveDropSeedKey(ctx.config),
      turnKey: deriveLiveTurnKey(ctx.config),
      admin,
      modelId: '',
    },
  };
  if (variant === 'empty') await seedEmpty(w);
  else if (variant === 'stress') await seedStress(w);
  else {
    await seedCatalogue(w);
    await seedStory(w, variant);
    if (variant === 'full' || variant === 'rules') await seedScanCases(w);
    if (variant === 'room') await seedRoom(w);
    if (variant === 'live') await seedLive(w);
    if (variant === 'afterroom') await seedAfterRoom(w);
    if (variant === 'afterroom-ends') await seedAfterRoomEnds(w);
    if (variant === 'draws') await seedDraws(w);
  }
  clock.set(NOCTURNE_NOW);
  // Every account's session opened now: a capture signs in with its cookie.
  for (const a of Object.values(demo.accounts)) {
    a.token = (await ctx.sessions.create({ subjectType: 'account', subjectId: a.id })).token;
  }
  return demo;
}

// ── Pieces of the story ────────────────────────────────────────────────────

async function account(w: World, key: string, email: string, pieces = 0, model?: string): Promise<DemoAccount> {
  const { account: a, session } = await w.ctx.services.auth.registerAccount({ email, password: NOCTURNE_PASSWORD }, {});
  await w.ctx.sessions.revoke(session.token);
  if (pieces > 0) await holdPieces(w.ctx.db, a.id, pieces, model ?? w.models.steel!, { variant: '17', startedAt: new Date(w.clock.now().getTime() - DAY) });
  const out: DemoAccount = { id: a.id, email, token: '', actor: { type: 'account', id: a.id } };
  w.demo.accounts[key] = out;
  return out;
}

/** The dots of MONOLITHE (N1): each variant's label and colour, the colour the middle of its board's gradient (build.py). */
export const NOCTURNE_VARIANTS = Object.freeze({
  steel: { label: 'Steel', swatch: '#9D9B96' },
  gold: { label: 'Gold', swatch: '#B88A3A' },
  blue: { label: 'Blue', swatch: '#16224A' },
});

async function seedCatalogue(w: World): Promise<void> {
  const { ctx, admin } = w;
  w.collection = (await ctx.services.catalog.createCollection({ name: 'ORBITAL' }, admin)).id;
  const care = 'Store this piece on its own, away from humidity, perfume and cosmetics. Wipe it with a soft, dry cloth after wearing. ORBES Client Services offers inspection, cleaning and polishing.';
  const story = 'Two rails of metal held apart, then closed by one angled link: a form built like architecture, cut to lie flat on the wrist.';
  // N1: MONOLITHE in steel, then its variants added from it (ADD A VARIANT, which gives steel its own dot), in the
  // order of the dots: Steel · Gold · Blue.
  w.clock.set(at('2026-08-31T08:00:00Z'));
  const steel = await ctx.services.catalog.createModel(
    { categoryCode: 'J', collectionId: w.collection, name: 'MONOLITHE', type: 'BRACELET', skuPrefix: 'MNL-ST', defaultMaterial: '925 STERLING SILVER', careInstructions: care },
    admin,
  );
  w.models.steel = steel.id;
  w.clock.set(at('2026-08-31T08:01:00Z'));
  const main = { mainLabel: NOCTURNE_VARIANTS.steel.label, mainSwatch: NOCTURNE_VARIANTS.steel.swatch };
  w.models.gold = (await ctx.services.catalog.createVariant(steel.id, { ...NOCTURNE_VARIANTS.gold, skuPrefix: 'MNL-GD', ...main }, admin)).id;
  w.clock.set(at('2026-08-31T08:02:00Z'));
  w.models.blue = (await ctx.services.catalog.createVariant(steel.id, { ...NOCTURNE_VARIANTS.blue, skuPrefix: 'MNL-BL' }, admin)).id;
  const make = async (key: string, material: string, opts: { slug: string; lookbook: 'PUBLIC' | 'RESERVED'; photo: 'steel' | 'blue' | 'gold'; priceLabel?: string; create?: { name: string; prefix: string } }) => {
    const id = opts.create
      ? (await ctx.services.catalog.createModel({ categoryCode: 'J', collectionId: w.collection, name: opts.create.name, type: 'BRACELET', skuPrefix: opts.create.prefix, defaultMaterial: material, careInstructions: care }, admin)).id
      : w.models[key]!;
    await ctx.services.media.setModelImage(id, { mime: 'image/webp', bytes: nocturnePhoto(opts.photo) }, admin);
    await ctx.services.catalog.updateModel(
      id,
      {
        defaultMaterial: material,
        careInstructions: care,
        lookbook: opts.lookbook,
        slug: opts.slug,
        story,
        specs: `Metal: ${material}\nClosure: Hinged`,
        careGuide: 'Wipe the bracelet with a soft, dry cloth after wearing.\nKeep it in its box, away from perfume and from other pieces.',
        ...(opts.priceLabel ? { priceLabel: opts.priceLabel, privateMinTier: 1 } : {}),
      },
      admin,
    );
    w.models[key] = id;
    w.demo.slugs[key] = opts.slug;
    return id;
  };
  // Published in this order: MONOLITHE in steel is the newest public model (it leads NOW when nothing is announced).
  w.clock.set(at('2026-08-31T09:00:00Z'));
  await make('gold', '18K YELLOW GOLD', { slug: 'monolithe-gold', lookbook: 'PUBLIC', photo: 'gold' });
  w.clock.set(at('2026-08-31T09:10:00Z'));
  await make('blue', '925 STERLING SILVER, BLUE LACQUER', { slug: 'monolithe-blue', lookbook: 'PUBLIC', photo: 'blue' });
  w.clock.set(at('2026-08-31T09:20:00Z'));
  await make('steel', '925 STERLING SILVER', { slug: 'monolithe', lookbook: 'PUBLIC', photo: 'steel' });
  w.clock.set(at('2026-08-31T09:30:00Z'));
  await make('zenith', '18K YELLOW GOLD', { slug: 'zenith', lookbook: 'RESERVED', photo: 'gold', priceLabel: '€ 4 800', create: { name: 'ZENITH', prefix: 'ZNT-BR' } });
  w.f.modelId = w.models.steel!;
  // The sizes of the house, the SKUs of each MONOLITHE.
  for (const key of ['steel', 'blue', 'gold']) for (const size of ['16', '17', '18']) await ensureSku(w.ctx.db, w.models[key]!, size);
}

/** Issue a piece of `model` under `role`, its serial named when given; sold (its warranty started) unless `sold` is false. */
async function issue(w: World, role: string, model: string, opts: { serial?: number; variant?: string; material?: string; sold?: string | false } = {}) {
  const r = await w.ctx.services.issuance.issueProduct(
    {
      categoryCode: 'J',
      year: 2026,
      ...(opts.serial ? { serial: opts.serial } : {}),
      modelId: w.models[model]!,
      collectionId: w.collection,
      variant: opts.variant ?? '17',
      material: opts.material ?? (model === 'gold' ? '18K YELLOW GOLD' : '925 STERLING SILVER'),
      productionBatch: 'B-2026-09',
      productionDate: '2026-08-28',
      withClaimSecret: true,
    },
    w.admin,
  );
  if (opts.sold !== false) {
    await w.ctx.services.warranty.activate(r.product.id, { purchaseDate: opts.sold ?? w.clock.now().toISOString().slice(0, 10), retailer: 'ORBES PARIS', country: 'FR' }, w.admin);
  }
  w.issued[role] = { uuid: r.product.id, productId: r.product.productId, codeId: r.code.id, data: r.code.data, glyphs: [...r.genome.glyphs], ...(r.claimCode ? { claimCode: r.claimCode } : {}) };
  w.demo.pieces[role] = r.product.productId;
  w.demo.codes[role] = { data: fromBase64Url(r.code.data), glyphs: [...r.genome.glyphs] };
  if (r.claimCode) w.demo.claimCodes[role] = r.claimCode;
  return w.issued[role]!;
}

/** The account registers a piece it holds, with its claim code, from a scan of it. */
async function register(w: World, who: DemoAccount, code: { data: string; claimCode?: string }): Promise<void> {
  const scan = await w.ctx.services.verification.verify({ code: code.data }, { accountId: who.id });
  if (!scan.registration) throw new Error(`no registration offered (${scan.state})`);
  await w.ctx.services.ownership.registerFirst(who.id, { registrationToken: scan.registration.token, claimCode: code.claimCode ?? null }, who.actor);
}

const orderOfEntry = async (w: World, entryId: string) => (await w.ctx.db.selectFrom('orders').select('id').where('drop_entry_id', '=', entryId).executeTakeFirstOrThrow()).id;
const benchOf = async (w: World, orderId: string) => (await w.ctx.db.selectFrom('bench_items').select('id').where('order_id', '=', orderId).executeTakeFirstOrThrow()).id;
const carrier = async (w: World, name: string) => (await w.ctx.db.selectFrom('carriers').select('id').where('name', '=', name).executeTakeFirstOrThrow()).id;
const titled = async (w: World, id: string, title: string, description?: string) => {
  await w.ctx.db.updateTable('drops').set({ title, ...(description ? { description } : {}) }).where('id', '=', id).execute();
};

/** A draw of the past: created, published, the account entered, drawn, its place confirmed; its order's id. */
async function pastDraw(w: World, o: { model: string; title: string; opens: string; closes: string; quantity: number; who: DemoAccount; confirmAt: string }): Promise<string> {
  const { ctx, admin, clock } = w;
  clock.set(new Date(at(o.opens).getTime() - 2 * DAY));
  const d = await ctx.services.drops.create({ modelId: w.models[o.model]!, title: o.title, quantity: o.quantity, opensAt: at(o.opens), closesAt: at(o.closes), earlyAccessHours: 0 }, admin);
  await ctx.services.drops.publish(d.id, admin);
  clock.set(new Date(at(o.opens).getTime() + HOUR));
  await ctx.services.drops.enter(o.who.id, d.id, o.who.actor);
  clock.set(new Date(at(o.closes).getTime() + MINUTE));
  await ctx.services.drops.draw(d.id, admin);
  clock.set(at(o.confirmAt));
  const entry = await ctx.db.selectFrom('drop_entries').select('id').where('drop_id', '=', d.id).where('account_id', '=', o.who.id).executeTakeFirstOrThrow();
  await ctx.services.drops.confirm(d.id, entry.id, 'Confirmed by phone.', admin);
  w.demo.releases[`draw:${o.title}`] = d.id;
  return orderOfEntry(w, entry.id);
}

/** Make the order's piece at the atelier: started, done; the piece issued and linked to the order. */
async function make(w: World, orderId: string, role: string, startAt: string, doneAt: string) {
  w.clock.set(at(startAt));
  const bench = await benchOf(w, orderId);
  await w.ctx.services.atelier.start(bench, w.admin);
  w.clock.set(at(doneAt));
  const done = await w.ctx.services.atelier.done(bench, { productionBatch: 'B-2026-09-DRAW' }, w.admin);
  const code = await w.ctx.services.issuance.printableCode(done.codeId);
  w.issued[role] = { uuid: '', productId: done.productId, codeId: done.codeId, data: code.data, glyphs: code.glyphs, ...(done.claimCode ? { claimCode: done.claimCode } : {}) };
  w.demo.pieces[role] = done.productId;
  w.demo.codes[role] = { data: fromBase64Url(code.data), glyphs: code.glyphs };
  return w.issued[role]!;
}

async function seedStory(w: World, variant: DemoVariant): Promise<void> {
  const { ctx, admin, clock } = w;
  clock.set(at('2026-09-01T09:00:00Z'));
  // A piece still in stock, never sold (C36, state 5): its serial puts the draws' pieces at O26-J-00198 and O26-J-00199.
  await issue(w, 'stock', 'steel', { serial: 197, sold: false });
  const you = await account(w, 'you', 'you@example.com');
  const guest = await account(w, 'guest', 'h.morel@example.com');
  await account(w, 'newcomer', 't.nguyen@example.com');
  await account(w, 'owner', 'm.okafor@example.com');
  const platine = await account(w, 'platine', 'a.lindqvist@example.com');
  const crowd: DemoAccount[] = [];
  for (let i = 1; i <= 8; i++) crowd.push(await account(w, `crowd${i}`, `collector.${i}@example.com`));
  const voters: DemoAccount[] = [];
  for (let i = 1; i <= 3; i++) voters.push(await account(w, `voter${i}`, `owner.${i}@example.com`));
  const absent = await account(w, 'absent', 'j.serrano@example.com');

  // ── The draw of September in steel: its piece shipped, registered on 18 Sep (DELIVERED), returned on 2 Oct ──
  const steelOrder = await pastDraw(w, { model: 'steel', title: 'MONOLITHE IN STEEL', opens: '2026-09-10T10:00:00Z', closes: '2026-09-13T18:00:00Z', quantity: 12, who: you, confirmAt: '2026-09-14T09:00:00Z' });
  clock.set(at('2026-09-14T09:10:00Z'));
  await ctx.services.orders.setTerms(steelOrder, { sizeLabel: '18', priceMinor: 420_000, currency: 'EUR' }, admin);
  await ctx.services.orders.setBuyer(steelOrder, { name: 'You', address: '14 rue de Turenne\n75004 Paris\nFrance' }, admin);
  clock.set(at('2026-09-15T10:00:00Z'));
  await ctx.services.orders.transition(steelOrder, { to: 'PAID' }, admin);
  const steelPiece = await make(w, steelOrder, 'returned', '2026-09-15T11:00:00Z', '2026-09-16T09:00:00Z');
  clock.set(at('2026-09-16T10:00:00Z'));
  await ctx.services.warranty.activate(steelPiece.productId, { purchaseDate: '2026-09-16', retailer: 'ORBES PARIS', country: 'FR' }, admin);
  await ctx.services.orders.transition(steelOrder, { to: 'SHIPPED', carrierId: await carrier(w, 'Colissimo'), trackingNumber: '6A10987654321', declaredValueMinor: 420_000 }, admin);
  clock.set(at('2026-09-18T15:00:00Z'));
  await register(w, you, steelPiece);

  // ── The draw of 14 September in gold: its piece shipped on 18 Sep, registered on 22 Sep (DELIVERED) ──
  const goldOrder = await pastDraw(w, { model: 'gold', title: 'MONOLITHE IN GOLD', opens: '2026-09-14T10:00:00Z', closes: '2026-09-14T18:00:00Z', quantity: 12, who: you, confirmAt: '2026-09-15T09:00:00Z' });
  clock.set(at('2026-09-15T09:10:00Z'));
  await ctx.services.orders.setTerms(goldOrder, { sizeLabel: '17', priceMinor: 420_000, currency: 'EUR' }, admin);
  await ctx.services.orders.setBuyer(goldOrder, { name: 'You', address: '14 rue de Turenne\n75004 Paris\nFrance' }, admin);
  clock.set(at('2026-09-16T10:00:00Z'));
  await ctx.services.orders.transition(goldOrder, { to: 'PAID' }, admin);
  const goldPiece = await make(w, goldOrder, 'gold', '2026-09-16T11:00:00Z', '2026-09-17T16:00:00Z');
  // The other collectors' pieces (held since June): PLATINE, the crowd of the releases and the circle (TITANE), the voters.
  const since = { startedAt: at('2026-06-01T10:00:00Z') };
  await holdPieces(ctx.db, platine.id, 3, w.models.steel!, { variant: '17', ...since });
  for (const c of crowd) await holdPieces(ctx.db, c.id, 1, w.models.blue!, { variant: '16', ...since });
  for (const v of voters) await holdPieces(ctx.db, v.id, 3, w.models.gold!, { variant: '18', ...since });
  await holdPieces(ctx.db, guest.id, 1, w.models.gold!, { variant: '18', ...since });
  await holdPieces(ctx.db, absent.id, 1, w.models.steel!, { variant: '16', ...since });
  clock.set(at('2026-09-18T09:00:00Z'));
  await ctx.services.warranty.activate(goldPiece.productId, { purchaseDate: '2026-09-18', retailer: 'ORBES PARIS', country: 'FR' }, admin);
  await ctx.services.orders.transition(goldOrder, { to: 'SHIPPED', carrierId: await carrier(w, 'Colissimo'), trackingNumber: '6A12345678901', declaredValueMinor: 420_000 }, admin);

  // ── ZENITH from THE PRIVATE SALON: requested on 20 Sep, accepted, cancelled on 24 Sep ──
  clock.set(at('2026-09-20T10:00:00Z'));
  const { request } = await ctx.services.salon.request(you.id, 'zenith', 'In size 17, please.', you.actor);
  clock.set(at('2026-09-20T15:00:00Z'));
  await ctx.services.salon.close(request.id, { note: 'A ZENITH in size 17.', outcome: 'ACCEPTED' }, admin);
  const zenithOrder = (await ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
  await ctx.services.orders.setTerms(zenithOrder, { sizeLabel: '17', priceMinor: 480_000, currency: 'EUR' }, admin);
  clock.set(at('2026-09-22T12:00:00Z'));
  await register(w, you, goldPiece);
  clock.set(at('2026-09-24T11:00:00Z'));
  await ctx.services.orders.transition(zenithOrder, { to: 'CANCELLED', note: 'The client chose another piece.' }, admin);

  // ── The LIVE of 28 September in gold: nobody of the story took part ──
  clock.set(at('2026-09-25T10:00:00Z'));
  const live28 = await createLiveRelease(w.f, { modelId: w.models.gold!, opensAt: at('2026-09-28T17:00:00Z'), minTier: 1, sizes: [{ label: '16', stock: 8 }, { label: '17', stock: 9 }, { label: '18', stock: 8 }], quantityLine: '25 PIECES', priceMinor: 505_000 });
  await titled(w, live28.id, 'MONOLITHE IN GOLD', 'The gold of MONOLITHE, released live: twenty-five pieces, in the sizes of the house.');
  clock.set(at('2026-09-28T18:01:00Z'));
  await ctx.services.live.advance(live28.id);
  w.demo.releases.live28 = live28.id;

  // ── The piece of the boutique: MONOLITHE in steel O26-J-00184, sold and registered on 3 Oct ──
  clock.set(at('2026-10-02T09:00:00Z'));
  await ctx.services.orders.returnOrder(steelOrder, { outcome: 'ARCHIVED', note: 'Returned within fourteen days: the client preferred the gold.' }, admin);
  clock.set(at('2026-10-03T10:00:00Z'));
  const boutique = await issue(w, 'yours', 'steel', { serial: 184, sold: '2026-10-03' });
  await ctx.services.media.setProductPhoto(boutique.productId, { mime: 'image/webp', bytes: nocturnePhoto('steel') }, admin);
  clock.set(at('2026-10-03T11:30:00Z'));
  await register(w, you, boutique);

  // ── The circle: the note of 1 Oct, the invitation and the poll of 3 Oct ──
  const circle = ctx.services.circle;
  clock.set(at('2026-10-01T09:00:00Z'));
  const note = await circle.create({ kind: 'NOTE', title: 'THE ANGLED LINK', body: 'One angled link closes MONOLITHE: cut at the bench, then polished by hand until the two rails meet without a seam.' }, admin);
  await ctx.services.media.addCirclePostPhoto(note.id, { mime: 'image/webp', bytes: nocturnePhoto('steel') }, admin);
  await circle.publish(note.id, admin);
  w.demo.posts.note = note.id;

  // ── The LIVE RELEASE of this morning: MONOLITHE IN STEEL, 05:00 Paris; you secure size 16 at 05:03, the guest's turn passes ──
  clock.set(at('2026-10-01T10:00:00Z'));
  const morning = await createLiveRelease(w.f, {
    modelId: w.models.steel!,
    opensAt: at('2026-10-05T03:00:00Z'),
    minTier: 1,
    turnSeconds: 300,
    sizes: [{ label: '16', stock: 8 }, { label: '17', stock: 9 }, { label: '18', stock: 8 }],
    quantityLine: '25 PIECES',
    priceMinor: 505_000,
    addons: [{ label: 'ENGRAVING', line: 'Your initials inside the band', priceMinor: 15_000 }],
  });
  await titled(w, morning.id, 'MONOLITHE IN STEEL', 'The steel of MONOLITHE, released live: twenty-five pieces, in the sizes of the house.');
  w.demo.releases.morning = morning.id;

  clock.set(at('2026-10-03T08:00:00Z'));
  const invitation = await circle.create(
    {
      kind: 'INVITATION',
      title: 'AN EVENING AT THE ATELIER',
      body: 'The atelier opens its doors for one evening: the bench where each piece is finished, and the first pieces of the next release.',
      eventAt: at('2026-10-12T17:00:00Z'),
      eventPlace: 'THE ATELIER, PARIS',
      capacity: 12,
      modelId: w.models.steel!,
      externalUrl: 'https://www.youtube.com/watch?v=orbes-atelier',
    },
    admin,
  );
  for (const kind of ['gold', 'steel', 'blue'] as const) await ctx.services.media.addCirclePostPhoto(invitation.id, { mime: 'image/webp', bytes: nocturnePhoto(kind) }, admin);
  await circle.publish(invitation.id, admin);
  w.demo.posts.invitation = invitation.id;
  const poll = await circle.create({ kind: 'POLL', title: 'WHICH FINISH SHOULD FOLLOW BLUE?', body: 'After the blue, one more finish of MONOLITHE: tell the atelier which.', minTier: 2, pollOptions: ['BLACK', 'WHITE GOLD', 'BRONZE'] }, admin);
  await circle.publish(poll.id, admin);
  w.demo.posts.poll = poll.id;
  clock.set(at('2026-10-03T12:00:00Z'));
  await circle.rsvp(you.id, invitation.id, 'YES', you.actor);
  for (const c of crowd) await circle.rsvp(c.id, invitation.id, 'YES', c.actor);
  for (const [i, v] of voters.entries()) await circle.vote(v.id, poll.id, i === 2 ? 1 : 0);

  // A collector said I'LL BE THERE for the morning and never came: the question after waits in MY PIECES.
  clock.set(at('2026-10-04T18:00:00Z'));
  await ctx.services.live.setInterest(absent.id, morning.id, morning.sizes[1]!.id, absent.actor);
  // The morning's room: you and the guest; T0, the line; you secure size 16 with the engraving; the guest's turn passes.
  clock.set(at('2026-10-05T02:57:00Z'));
  const s16 = morning.sizes.find((s) => s.label === '16')!;
  const s18 = morning.sizes.find((s) => s.label === '18')!;
  await ctx.services.live.enter(you.id, morning.id, { sizeId: s16.id }, you.actor);
  await ctx.services.live.enter(guest.id, morning.id, { sizeId: s18.id }, guest.actor);
  clock.set(at('2026-10-05T03:00:00Z'));
  await ctx.services.live.advance(morning.id);
  clock.set(at('2026-10-05T03:02:40Z'));
  const turnOf = async (who: DemoAccount) => (await ctx.services.live.entry(who.id, morning.id))?.turn?.token ?? null;
  const yourTurn = await turnOf(you);
  if (!yourTurn) throw new Error('no turn for you in the morning release');
  await ctx.services.live.press(you.id, morning.id, yourTurn);
  clock.advance(1_500);
  await ctx.services.live.secure(you.id, morning.id, yourTurn, you.actor);
  await ctx.services.live.setAddons(you.id, morning.id, [morning.addons[0]!.id], you.actor);
  clock.set(at('2026-10-05T03:03:20Z'));
  await ctx.services.live.confirm(you.id, morning.id, you.actor);
  // The guest's turn runs out (5 minutes), then the release closes at its hour.
  clock.set(at('2026-10-05T03:10:00Z'));
  await ctx.services.live.advance(morning.id);
  clock.set(at('2026-10-05T04:01:00Z'));
  await ctx.services.live.advance(morning.id);

  // ── Announced: the blue LIVE RELEASE, the release of 22 October, the October draw ──
  const announceLive = variant === 'full' || variant === 'rules' || variant === 'room' || variant === 'live' || variant === 'afterroom';
  const announceDraw = variant !== 'collection-leads' && variant !== 'room' && variant !== 'live' && variant !== 'afterroom' && variant !== 'afterroom-ends';
  if (announceLive && (variant === 'full' || variant === 'rules')) {
    clock.set(at('2026-10-01T12:00:00Z'));
    const rules: Partial<LiveReleaseOptions> = {};
    let segmentId: string | null = null;
    if (variant === 'rules') {
      segmentId = (await ctx.services.segments.create({ name: 'The guests of the atelier', criteria: { match: 'ALL', rules: [{ kind: 'TIER', tiers: [3] }] } }, admin)).id;
      Object.assign(rules, { minTier: 2, minParticipations: 3, accessSegmentId: segmentId, accessCombine: 'OR', surprise: 'A silk pouch, hand-stitched in the atelier.' });
    }
    const blue = await createLiveRelease(w.f, {
      modelId: w.models.blue!,
      opensAt: at('2026-10-08T19:00:00Z'),
      minTier: 1,
      sizes: [{ label: '16', stock: 8 }, { label: '17', stock: 9 }, { label: '18', stock: 8 }],
      quantityLine: '25 PIECES',
      priceMinor: 505_000,
      addons: [{ label: 'ENGRAVING', line: 'Your initials inside the band', priceMinor: 15_000 }],
      ...rules,
    });
    await titled(w, blue.id, 'MONOLITHE IN BLUE', 'The blue of MONOLITHE, released live: twenty-five pieces, in the sizes of the house.');
    w.demo.releases.blue = blue.id;
    // The invitation shows the release among what it leads to (TO SEE).
    await ctx.services.circle.update(w.demo.posts.invitation!, { dropId: blue.id }, admin);
    clock.set(at('2026-10-04T10:00:00Z'));
    const interested = variant === 'rules' ? voters.concat(platine) : crowd.slice(0, 5);
    for (const [i, c] of interested.entries()) await ctx.services.live.setInterest(c.id, blue.id, blue.sizes[i % 3]!.id, c.actor);
    if (variant === 'rules') {
      // A fifth collector who will be there: a PALLADIUM account of the selection.
      const selected = await account(w, 'palladium', 'selected.owner@example.com', 5, w.models.gold);
      await ctx.services.live.setInterest(selected.id, blue.id, blue.sizes[1]!.id, selected.actor);
      // A release for the selected collectors alone (C28, state 5).
      const select = await createLiveRelease(w.f, { modelId: w.models.blue!, opensAt: at('2026-10-15T19:00:00Z'), sizes: [{ label: '17', stock: 6 }], quantityLine: '6 PIECES', accessSegmentId: segmentId });
      await titled(w, select.id, 'MONOLITHE IN BLUE, FOR THE CIRCLE');
      w.demo.releases.selected = select.id;
    }
    clock.set(at('2026-10-05T07:00:00Z'));
    const veiled = await createLiveRelease(w.f, {
      modelId: w.models.steel!,
      opensAt: at('2026-10-22T19:00:00Z'),
      minTier: 2,
      sizes: [{ label: '16', stock: 4 }, { label: '17', stock: 4 }, { label: '18', stock: 4 }],
      quantityLine: '12 PIECES',
      priceMinor: 505_000,
      published: false,
    });
    // Its silhouette, shown from its stage (the canvas draws the seal until then); set before the announcement.
    await ctx.services.media.setLiveSilhouette(veiled.id, { mime: 'image/webp', bytes: nocturnePhoto('steel') }, admin);
    await ctx.db
      .updateTable('drops')
      .set({ title: 'MONOLITHE IN BLACK', published_at: clock.now(), silhouette_at: at('2026-10-19T10:00:00Z'), name_at: at('2026-10-20T10:00:00Z'), photo_at: at('2026-10-20T10:00:00Z') })
      .where('id', '=', veiled.id)
      .execute();
    w.demo.releases.veiled = veiled.id;
  }
  if (announceDraw) {
    const opens = variant === 'draw-soon' ? at('2026-10-07T10:00:00Z') : at('2026-10-05T10:00:00Z');
    const early = variant === 'draw-early' ? 72 : variant === 'draw-soon' ? 24 : 0;
    const drawOpens = variant === 'draw-early' ? at('2026-10-06T10:00:00Z') : opens;
    clock.set(at('2026-10-01T12:30:00Z'));
    const d = await ctx.services.drops.create(
      {
        modelId: w.models.steel!,
        title: 'MONOLITHE, THE OCTOBER DRAW',
        description: 'Twelve pieces of MONOLITHE in steel, drawn among the entries of October.',
        quantity: 12,
        opensAt: drawOpens,
        closesAt: at('2026-10-11T18:00:00Z'),
        purchaseWindowHours: 48,
        earlyAccessHours: early,
        // N1 (addition 5): the draw's price, shown on its card and page, taken by its orders.
        priceMinor: 420_000,
        currency: 'EUR',
      },
      admin,
    );
    await ctx.services.drops.publish(d.id, admin);
    w.demo.releases.draw = d.id;
  }
  w.demo.pieces.gold = goldPiece.productId;
}

/** The scan cases (C9, C11–C17, C35–C37): each its own piece, so a capture that changes one leaves the others. */
async function seedScanCases(w: World): Promise<void> {
  const { ctx, admin, clock, demo } = w;
  const owner = demo.accounts.owner!;
  clock.set(at('2026-10-04T10:00:00Z'));
  // A piece sold this weekend, to register: AUTHENTIC — FIRST REGISTRATION (C9, C36).
  await issue(w, 'first', 'steel', { sold: '2026-10-04' });
  // Its twin for the ceremony (registered by a capture).
  await issue(w, 'ceremony', 'steel', { sold: '2026-10-04' });
  // A piece sold, unregistered, whose code is copied: a burst of scans from many places (C15).
  const copied = await issue(w, 'copied', 'steel', { sold: '2026-10-04' });
  // The owner's pieces: one reported stolen, one passed on (a transfer pending), one reported lost by them, one in service.
  const stolen = await issue(w, 'stolen', 'steel', { sold: '2026-09-20' });
  const passing = await issue(w, 'passing', 'gold', { sold: '2026-09-20' });
  const lost = await issue(w, 'lost', 'blue', { sold: '2026-09-20' });
  const service = await issue(w, 'service', 'steel', { sold: '2026-09-20' });
  // A piece whose owner shares its ownership certificate (/verify/c#…, kept as it is by NOCTURNE).
  const certified = await issue(w, 'certified', 'gold', { sold: '2026-09-20' });
  for (const p of [stolen, passing, lost, service, certified]) await register(w, owner, p);
  // A revoked code (REVOKED).
  const revoked = await issue(w, 'revoked', 'steel', { sold: '2026-09-20' });
  clock.set(at('2026-10-04T15:00:00Z'));
  await ctx.services.ownership.reportIncident(owner.id, stolen.productId, 'STOLEN', owner.actor);
  await ctx.services.ownership.reportIncident(owner.id, lost.productId, 'LOST', owner.actor);
  await ctx.services.warranty.openService(service.productId, { type: 'POLISH', location: 'PARIS', notes: 'Polished at the atelier.', performedBy: 'PARIS' }, admin);
  await ctx.services.ownership.initiateTransfer(owner.id, passing.productId, owner.actor);
  await ctx.services.issuance.revokeCode(revoked.codeId, 'The card was reported destroyed.', admin);
  demo.links.certificate = (await ctx.services.ownershipCertificates.create(owner.id, certified.productId, { validDays: 30 }, owner.actor)).token;
  // The burst: copies of the code scanned from 22 places within the minute, just now.
  clock.set(new Date(NOCTURNE_NOW.getTime() - 40_000));
  for (let i = 0; i < 22; i++) await ctx.services.verification.verify({ code: copied.data }, { deviceHash: `nocturne-copy-device-${i}`, ipHash: `nocturne-copy-ip-${i}`, geo: { country: 'FR' } });

  // A forged signature (one flipped bit): INVALID SIGNATURE (C16).
  const base = unframeCodeData(fromBase64Url(w.issued.first!.data));
  const sig = base.signature.slice();
  sig[17]! ^= 0x04;
  demo.codes.forged = { data: frameCodeData(base.payloadBytes, sig), glyphs: w.issued.first!.glyphs };
  // A code ORBES signed for an identity it never issued: UNKNOWN ORBES CODE (C16, state 2).
  const payload = { ...base.payload, identity: { ...base.payload.identity, serial: 990 } };
  const payloadBytes = encodePayload(payload);
  const signer = await ctx.keys.activeSigner();
  const unknown = frameCodeData(payloadBytes, await signer.sign(signingMessage(payloadBytes)));
  demo.codes.unknown = { data: unknown, glyphs: [...computeGenome(packIdentity(payload.identity)).glyphs] };
}

// ── The room, the line, the after-room ─────────────────────────────────────

/** A LIVE RELEASE whose room is open: its T0 three minutes after NOW; you said I'LL BE THERE in size 17. */
async function seedRoom(w: World): Promise<void> {
  const { ctx, clock, demo } = w;
  clock.set(at('2026-10-04T12:00:00Z'));
  const r = await createLiveRelease(w.f, {
    modelId: w.models.blue!,
    opensAt: new Date(NOCTURNE_NOW.getTime() + 3 * MINUTE),
    minTier: 1,
    sizes: [{ label: '16', stock: 8 }, { label: '17', stock: 9 }, { label: '18', stock: 8 }],
    quantityLine: '25 PIECES',
    priceMinor: 505_000,
    addons: [{ label: 'ENGRAVING', line: 'Your initials inside the band', priceMinor: 15_000 }],
  });
  await titled(w, r.id, 'MONOLITHE IN BLUE', 'The blue of MONOLITHE, released live: twenty-five pieces, in the sizes of the house.');
  demo.releases.room = r.id;
  const you = demo.accounts.you!;
  await ctx.services.live.setInterest(you.id, r.id, r.sizes[1]!.id, you.actor);
  clock.set(new Date(NOCTURNE_NOW.getTime() - MINUTE));
  for (let i = 1; i <= 4; i++) {
    const c = demo.accounts[`crowd${i}`]!;
    await ctx.services.live.enter(c.id, r.id, { sizeId: r.sizes[i % 3]!.id }, c.actor);
  }
  clock.set(new Date(NOCTURNE_NOW.getTime() - 30_000));
  await ctx.services.live.message(r.id, 'Welcome to the vault. The door opens at the hour.', w.admin);
  // The boutique board's secret link (the board is kept as it is by NOCTURNE).
  demo.links.board = (await ctx.services.live.issueBoardLink(r.id, w.admin)).token;
}

/**
 * A LIVE RELEASE live now (T0 twenty minutes ago), a collector at each step: in the line, at its turn, a piece secured,
 * confirmed, sold out in its size; and each end: the turn passed, the hold ended, the place released, left, removed.
 * Everyone joins after T0, in order of arrival: their places do not depend on the draw's seed.
 */
async function seedLive(w: World): Promise<void> {
  const { ctx, clock, demo } = w;
  const t0 = new Date(NOCTURNE_NOW.getTime() - 20 * MINUTE);
  clock.set(at('2026-10-04T12:00:00Z'));
  const r = await createLiveRelease(w.f, {
    modelId: w.models.blue!,
    opensAt: t0,
    closesAt: new Date(t0.getTime() + 2 * HOUR),
    minTier: 1,
    turnSeconds: 300,
    payMinutes: 10,
    sizes: [{ label: '16', stock: 2 }, { label: '17', stock: 1 }, { label: '18', stock: 6 }],
    quantityLine: '9 PIECES',
    priceMinor: 505_000,
    addons: [
      { label: 'ENGRAVING', line: 'Your initials inside the band', priceMinor: 15_000 },
      { label: 'GIFT BOX', priceMinor: 9_000 },
    ],
  });
  await titled(w, r.id, 'MONOLITHE IN BLUE', 'The blue of MONOLITHE, released live: nine pieces, in the sizes of the house.');
  demo.releases.live = r.id;
  const [s16, s17, s18] = r.sizes;
  clock.set(t0);
  await ctx.services.live.advance(r.id);
  const live = ctx.services.live;
  const tokenOf = async (a: DemoAccount) => (await live.entry(a.id, r.id))?.turn?.token ?? null;
  const step = async (ms: number) => {
    clock.advance(ms);
    await live.advance(r.id);
  };
  const join = async (key: string, size: { id: string }) => {
    const a = await account(w, key, `${key}@example.com`, 1, w.models.blue);
    await live.enter(a.id, r.id, { sizeId: size.id }, a.actor);
    await step(1_000);
    return a;
  };
  const secure = async (a: DemoAccount) => {
    const token = await tokenOf(a);
    if (!token) throw new Error(`no turn for ${a.email}`);
    await live.press(a.id, r.id, token);
    clock.advance(1_500);
    await live.secure(a.id, r.id, token, a.actor);
  };
  // The ends, first (size 18): a turn passed, a hold ended, a place released, a collector who left, one removed.
  clock.set(new Date(t0.getTime() + MINUTE));
  const missed = await join('missed', s18!);
  await step(301_000);
  const expired = await join('expired', s18!);
  await secure(expired);
  const expiredEntry = (await ctx.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', expired.id).executeTakeFirstOrThrow()).id;
  await live.freeHold(r.id, expiredEntry, w.admin);
  await step(1_000);
  const released = await join('released', s18!);
  await secure(released);
  await live.release(released.id, r.id, released.actor);
  await step(1_000);
  const left = await join('left', s18!);
  await live.leave(left.id, r.id, left.actor);
  const removed = await join('removed', s18!);
  const removedEntry = (await ctx.db.selectFrom('live_entries').select('id').where('drop_id', '=', r.id).where('account_id', '=', removed.id).executeTakeFirstOrThrow()).id;
  await live.remove(r.id, removedEntry, w.admin);
  void missed;
  // Now: size 17's one piece secured and confirmed, a collector behind it (sold out in size 17); size 16's two pieces,
  // one secured (to confirm), one at its turn, a collector in the line behind them; size 18 confirmed.
  clock.set(new Date(NOCTURNE_NOW.getTime() - 2 * MINUTE));
  const buyer = await join('buyer', s17!);
  await join('soldout', s17!);
  await secure(buyer);
  await live.confirm(buyer.id, r.id, buyer.actor);
  const confirmed = await join('confirmed', s18!);
  await secure(confirmed);
  await live.setAddons(confirmed.id, r.id, [r.addons[0]!.id], confirmed.actor);
  await live.confirm(confirmed.id, r.id, confirmed.actor);
  const securedA = await join('secured', s16!);
  await join('turn', s16!);
  await join('line', s16!);
  await secure(securedA);
  await live.setAddons(securedA.id, r.id, [r.addons[0]!.id], securedA.actor);
  await step(1_000);
  await live.message(r.id, 'The door is open. Take your time at the seal.', w.admin);
}

/** A LIVE RELEASE of one piece, sold out five minutes ago with you still in the line: its after-room is open. */
async function seedAfterRoom(w: World): Promise<void> {
  const { ctx, clock, demo } = w;
  const t0 = new Date(NOCTURNE_NOW.getTime() - 12 * MINUTE);
  clock.set(at('2026-10-04T12:00:00Z'));
  const r = await createLiveRelease(w.f, {
    modelId: w.models.steel!,
    opensAt: t0,
    minTier: 1,
    sizes: [{ label: '17', stock: 1 }],
    quantityLine: '1 PIECE',
    priceMinor: 505_000,
    turnSeconds: 300,
    payMinutes: 10,
    afterRoom: { modelId: w.models.gold!, priceMinor: 505_000, sizes: [{ label: '16', stock: 2 }, { label: '17', stock: 2 }], addons: [{ label: 'GIFT BOX', line: 'Wrapped by hand in the atelier', priceMinor: 9_000 }], delayMinutes: 1, lengthMinutes: 15 },
  });
  await titled(w, r.id, 'MONOLITHE IN STEEL', 'One piece of MONOLITHE in steel, released live.');
  await titled(w, r.afterRoom!.id, 'MONOLITHE IN STEEL · THE AFTER-ROOM');
  demo.releases.afterroom = r.id;
  const you = demo.accounts.you!;
  const rival = demo.accounts.crowd1!;
  clock.set(new Date(t0.getTime() - MINUTE));
  await ctx.services.live.enter(rival.id, r.id, { sizeId: r.sizes[0]!.id }, rival.actor);
  clock.set(t0);
  await ctx.services.live.advance(r.id);
  clock.set(new Date(t0.getTime() + 30_000));
  await ctx.services.live.enter(you.id, r.id, { sizeId: r.sizes[0]!.id }, you.actor);
  await ctx.services.live.advance(r.id);
  const token = (await ctx.services.live.entry(rival.id, r.id))?.turn?.token;
  if (!token) throw new Error('no turn for the rival');
  await ctx.services.live.press(rival.id, r.id, token);
  clock.advance(1_500);
  await ctx.services.live.secure(rival.id, r.id, token, rival.actor);
  clock.set(new Date(NOCTURNE_NOW.getTime() - 5 * MINUTE));
  await ctx.services.live.confirm(rival.id, r.id, rival.actor);
  await ctx.services.live.advance(r.id);
  clock.set(new Date(NOCTURNE_NOW.getTime() - 3 * MINUTE));
  await ctx.services.live.advance(r.id);
  await ctx.services.live.advance(r.afterRoom!.id);
}

/**
 * Three LIVE RELEASES of one piece, each sold out with two guests left in its line, each with an after-room of one piece
 * (opened a minute after the sell-out, for five minutes): the first guest takes its turn there, and the after-room ends
 * with the second (the role named) still in its line: SOLD OUT (the first guest's piece confirmed), CLOSED (its five
 * minutes over while the first guest holds the piece), ENDED (by ORBES). A fourth guest of the first release never
 * entered its after-room (`arOver`). Every one of them is over by NOW.
 */
async function seedAfterRoomEnds(w: World): Promise<void> {
  const { ctx, clock, demo } = w;
  const live = ctx.services.live;
  const scenario = async (key: string, minutesAgo: number, end: 'SOLD_OUT' | 'CLOSED' | 'ENDED', also?: string) => {
    const t0 = new Date(NOCTURNE_NOW.getTime() - minutesAgo * MINUTE);
    clock.set(new Date(t0.getTime() - DAY));
    const r = await createLiveRelease(w.f, {
      modelId: w.models.steel!,
      opensAt: t0,
      minTier: 1,
      sizes: [{ label: '17', stock: 1 }],
      quantityLine: '1 PIECE',
      priceMinor: 505_000,
      turnSeconds: 300,
      payMinutes: 10,
      afterRoom: { modelId: w.models.gold!, priceMinor: 505_000, sizes: [{ label: '17', stock: 1 }], delayMinutes: 1, lengthMinutes: 5 },
    });
    await titled(w, r.id, 'MONOLITHE IN STEEL', 'One piece of MONOLITHE in steel, released live.');
    await titled(w, r.afterRoom!.id, 'MONOLITHE IN STEEL · THE AFTER-ROOM');
    demo.releases[key] = r.id;
    const lower = key.toLowerCase();
    const buyer = await account(w, `${key}Buyer`, `${lower}.buyer@example.com`, 1, w.models.steel);
    const first = await account(w, `${key}First`, `${lower}.first@example.com`, 1, w.models.steel);
    const guest = await account(w, key, `${lower}@example.com`, 1, w.models.steel);
    const other = also ? await account(w, also, `${also.toLowerCase()}@example.com`, 1, w.models.steel) : null;
    const size = r.sizes[0]!.id;
    const afterId = r.afterRoom!.id;
    const afterSize = r.afterRoom!.sizes[0]!.id;
    clock.set(new Date(t0.getTime() - MINUTE));
    await live.enter(buyer.id, r.id, { sizeId: size }, buyer.actor);
    clock.set(t0);
    await live.advance(r.id);
    for (const a of [first, guest, other]) {
      if (!a) continue;
      clock.advance(10_000);
      await live.enter(a.id, r.id, { sizeId: size }, a.actor);
      await live.advance(r.id);
    }
    const take = async (a: DemoAccount, id: string) => {
      const token = (await live.entry(a.id, id))?.turn?.token;
      if (!token) throw new Error(`no turn for ${a.email}`);
      await live.press(a.id, id, token);
      clock.advance(1_500);
      await live.secure(a.id, id, token, a.actor);
    };
    // The release sells out; a minute later its after-room opens to the guests still in the line.
    await take(buyer, r.id);
    clock.advance(30_000);
    await live.confirm(buyer.id, r.id, buyer.actor);
    await live.advance(r.id);
    clock.advance(61_000);
    await live.advance(r.id);
    await live.advance(afterId);
    for (const a of [first, guest]) {
      clock.advance(5_000);
      await live.enter(a.id, afterId, { sizeId: afterSize }, a.actor);
      await live.advance(afterId);
    }
    await take(first, afterId);
    if (end === 'SOLD_OUT') {
      clock.advance(30_000);
      await live.confirm(first.id, afterId, first.actor);
    } else if (end === 'CLOSED') {
      clock.advance(6 * MINUTE);
    } else {
      clock.advance(30_000);
      await live.end(afterId, w.admin);
    }
    await live.advance(afterId);
    await live.advance(r.id);
  };
  await scenario('arSoldOut', 100, 'SOLD_OUT', 'arOver');
  await scenario('arClosed', 70, 'CLOSED');
  await scenario('arEnded', 40, 'ENDED');
}

/**
 * A draw in every state an entry or a page shows (lot E's direct reservations, P-X02, included), each its own, and a
 * collector, r.castel (TITANE: one piece since 14 September), with an entry in most: a place held (selected over an
 * account without a piece, who is on the waiting list), the waiting list (behind a PLATINE account), a place lapsed, a
 * purchase concluded whose order is PAID, a draw past its close not yet drawn (where the PLATINE account withdrew while
 * it was open), a draw cancelled, and the October draw, entered then withdrawn. The PLATINE account reserved the only
 * piece of a draw in its early access and of a draw now open.
 */
async function seedDraws(w: World): Promise<void> {
  const { ctx, admin, clock, demo } = w;
  const drops = ctx.services.drops;
  const platine = demo.accounts.platine!;
  const newcomer = demo.accounts.newcomer!;
  clock.set(at('2026-09-15T09:00:00Z'));
  const entrant = await account(w, 'entrant', 'r.castel@example.com', 1, w.models.gold);
  const draw = async (key: string, o: { model: string; title: string; quantity?: number; created: string; opens: string; closes: string; window?: number; early?: number }) => {
    clock.set(at(o.created));
    const d = await drops.create(
      {
        modelId: w.models[o.model]!,
        title: o.title,
        quantity: o.quantity ?? 1,
        opensAt: at(o.opens),
        closesAt: at(o.closes),
        purchaseWindowHours: o.window ?? 48,
        earlyAccessHours: o.early ?? 0,
      },
      admin,
    );
    await drops.publish(d.id, admin);
    demo.releases[key] = d.id;
    return d.id;
  };
  const enter = async (id: string, when: string, ...who: DemoAccount[]) => {
    clock.set(at(when));
    for (const a of who) await drops.enter(a.id, id, a.actor);
  };
  const entryOf = async (id: string, a: DemoAccount) => (await ctx.db.selectFrom('drop_entries').select('id').where('drop_id', '=', id).where('account_id', '=', a.id).executeTakeFirstOrThrow()).id;
  const drawAt = async (id: string, when: string) => {
    clock.set(at(when));
    await drops.draw(id, admin);
  };

  // A place lapsed: drawn on 22 Sep, held until 24 Sep, lapsed on 25 Sep.
  const lapsed = await draw('lapsed', { model: 'gold', title: 'MONOLITHE IN GOLD, THE EQUINOX DRAW', created: '2026-09-18T09:00:00Z', opens: '2026-09-20T10:00:00Z', closes: '2026-09-22T18:00:00Z' });
  await enter(lapsed, '2026-09-21T10:00:00Z', entrant);
  await drawAt(lapsed, '2026-09-22T18:01:00Z');
  clock.set(at('2026-09-25T09:00:00Z'));
  await drops.lapse(lapsed, await entryOf(lapsed, entrant), 'The place was not taken up.', admin);

  // A purchase concluded on 24 Sep, its order PAID on 25 Sep.
  const concluded = await draw('concluded', { model: 'blue', title: 'MONOLITHE IN BLUE, THE SEPTEMBER DRAW', created: '2026-09-18T09:30:00Z', opens: '2026-09-21T10:00:00Z', closes: '2026-09-23T18:00:00Z' });
  await enter(concluded, '2026-09-22T10:00:00Z', entrant);
  await drawAt(concluded, '2026-09-23T18:01:00Z');
  clock.set(at('2026-09-24T09:00:00Z'));
  const concludedEntry = await entryOf(concluded, entrant);
  await drops.confirm(concluded, concludedEntry, 'Confirmed by phone.', admin);
  const order = await orderOfEntry(w, concludedEntry);
  clock.set(at('2026-09-24T09:10:00Z'));
  await ctx.services.orders.setTerms(order, { sizeLabel: '17', priceMinor: 505_000, currency: 'EUR' }, admin);
  await ctx.services.orders.setBuyer(order, { name: 'R. Castel', address: '3 place des Vosges\n75004 Paris\nFrance' }, admin);
  clock.set(at('2026-09-25T10:00:00Z'));
  await ctx.services.orders.transition(order, { to: 'PAID' }, admin);

  // Drawn on 4 Oct: a place held until 7 Oct (over an account without a piece, on the waiting list), and the waiting
  // list (behind the PLATINE account).
  const selected = await draw('selected', { model: 'steel', title: 'MONOLITHE IN STEEL, THE LAST DRAW OF SEPTEMBER', created: '2026-09-26T09:00:00Z', opens: '2026-09-28T10:00:00Z', closes: '2026-10-04T18:00:00Z', window: 72 });
  const waitlisted = await draw('waitlisted', { model: 'blue', title: 'MONOLITHE IN BLUE, THE FIRST DRAW OF OCTOBER', created: '2026-09-26T09:30:00Z', opens: '2026-09-28T10:00:00Z', closes: '2026-10-04T18:00:00Z', window: 72 });
  await enter(selected, '2026-09-29T10:00:00Z', entrant, newcomer);
  await enter(waitlisted, '2026-09-29T11:00:00Z', platine, entrant);

  // Past its close this noon, not drawn yet: entered; the PLATINE account withdrew while it was open.
  const closed = await draw('closed', { model: 'gold', title: 'MONOLITHE IN GOLD, THE WEEKEND DRAW', created: '2026-09-29T09:00:00Z', opens: '2026-10-01T10:00:00Z', closes: '2026-10-05T10:00:00Z' });
  // Cancelled on 4 Oct, with an entry.
  const cancelled = await draw('cancelled', { model: 'blue', title: 'MONOLITHE IN BLUE, THE ATELIER DRAW', created: '2026-09-29T09:30:00Z', opens: '2026-10-01T10:00:00Z', closes: '2026-10-10T18:00:00Z' });
  // Every piece reserved by the PLATINE account: one in its early access (entries open on 7 Oct), one open since this morning.
  const full = await draw('full', { model: 'gold', title: 'MONOLITHE IN GOLD, THE PRIVATE DRAW', created: '2026-10-01T09:00:00Z', opens: '2026-10-07T10:00:00Z', closes: '2026-10-11T18:00:00Z', early: 72 });
  const openFull = await draw('openFull', { model: 'blue', title: 'MONOLITHE IN BLUE, THE CLUB DRAW', created: '2026-10-01T09:30:00Z', opens: '2026-10-05T10:00:00Z', closes: '2026-10-11T18:00:00Z', early: 48 });
  await enter(closed, '2026-10-02T10:00:00Z', entrant, platine);
  await enter(cancelled, '2026-10-02T10:30:00Z', entrant);
  clock.set(at('2026-10-03T09:00:00Z'));
  await drops.withdraw(platine.id, closed, platine.actor);
  clock.set(at('2026-10-03T12:00:00Z'));
  await drops.reserve(platine.id, openFull, platine.actor);
  clock.set(at('2026-10-04T10:00:00Z'));
  await drops.cancel(cancelled, admin);
  clock.set(at('2026-10-04T12:00:00Z'));
  await drops.reserve(platine.id, full, platine.actor);
  await drawAt(selected, '2026-10-04T18:01:00Z');
  await drawAt(waitlisted, '2026-10-04T18:02:00Z');

  // The October draw (open since 10:00 UTC): entered, then withdrawn.
  await enter(demo.releases.draw!, '2026-10-05T11:00:00Z', entrant);
  clock.set(at('2026-10-05T12:00:00Z'));
  await drops.withdraw(entrant.id, demo.releases.draw!, entrant.actor);
}

// ── The extreme content (fidelity rule 5) and the empty states ─────────────

/**
 * The stress case: a 24-character model name without a photograph, a 14-character free-text field, an account of 6 pieces
 * and 4 orders (a price in USD, a long amount, a long tracking number), 8 posts, a LIVE RELEASE under an hour away with its
 * room open and a long host message, another more than 9 days away.
 */
async function seedStress(w: World): Promise<void> {
  const { ctx, admin, clock } = w;
  await seedCatalogue(w);
  clock.set(at('2026-09-01T09:00:00Z'));
  const long = await ctx.services.catalog.createModel({ categoryCode: 'J', collectionId: w.collection, name: 'MONOLITHE ARCHITECTURALE', type: 'ARTICULATED BRACELET', skuPrefix: 'MNL-AR', defaultMaterial: '925 STERLING SILVER, BRUSHED AND POLISHED', careInstructions: null }, admin);
  await ctx.services.catalog.updateModel(long.id, { lookbook: 'PUBLIC', slug: 'monolithe-architecturale', story: 'A model without a photograph yet.', specs: 'Metal: 925 sterling silver, brushed and polished by hand\nClosure: Hinged, with a hidden clasp' }, admin);
  w.models.long = long.id;
  w.demo.slugs.long = 'monolithe-architecturale';
  // Fidelity rule 5: a variant's label of 14 characters (N1), shown beside the 24-character name.
  const cobalt = await ctx.services.catalog.createVariant(long.id, { label: 'Brushed cobalt', swatch: '#2C3E78', skuPrefix: 'MNL-AR-BC', mainLabel: 'Polished', mainSwatch: '#D7D5D0' }, admin);
  await ctx.services.catalog.updateModel(cobalt.id, { lookbook: 'PUBLIC', slug: 'monolithe-architecturale-brushed-cobalt', defaultMaterial: '925 STERLING SILVER, BRUSHED COBALT' }, admin);
  w.models.cobalt = cobalt.id;
  w.demo.slugs.cobalt = 'monolithe-architecturale-brushed-cobalt';
  const you = await account(w, 'you', 'you@example.com');
  // Six pieces, the first of the long model with a 14-character field.
  clock.set(at('2026-09-02T10:00:00Z'));
  const roles = ['long', 'steel', 'gold', 'blue', 'steel', 'gold'];
  for (const [i, model] of roles.entries()) {
    const p = await issue(w, `piece${i + 1}`, model, { serial: 300 + i, sold: '2026-09-02', ...(i === 0 ? { variant: 'BRUSHED COBALT', material: '925 STERLING SILVER, BRUSHED AND POLISHED' } : {}) });
    await register(w, you, p);
  }
  // Four orders from the salon, each with its terms: a price in USD, a long amount, a long tracking number.
  await ctx.services.catalog.updateModel(long.id, { lookbook: 'RESERVED', priceLabel: '€ 125 400', privateMinTier: 1 }, admin);
  await ctx.services.catalog.updateModel(cobalt.id, { lookbook: 'RESERVED', priceLabel: '€ 125 400', privateMinTier: 1 }, admin);
  const terms = [
    { sizeLabel: '17', priceMinor: 12_540_000, currency: 'EUR' },
    { sizeLabel: '16', priceMinor: 640_000, currency: 'USD' },
    { sizeLabel: '18', priceMinor: 505_000, currency: 'EUR' },
    { sizeLabel: '17', priceMinor: 480_000, currency: 'EUR' },
  ];
  for (const [i, t] of terms.entries()) {
    clock.set(new Date(at('2026-09-10T10:00:00Z').getTime() + i * DAY));
    const slug = i === 0 ? 'monolithe-architecturale' : 'zenith';
    const { request } = await ctx.services.salon.request(you.id, slug, null, you.actor);
    await ctx.services.salon.close(request.id, { note: 'Accepted.', outcome: 'ACCEPTED' }, admin);
    const order = (await ctx.db.selectFrom('orders').select('id').where('shop_request_id', '=', request.id).executeTakeFirstOrThrow()).id;
    await ctx.services.orders.setTerms(order, t, admin);
    await ctx.services.orders.setBuyer(order, { name: 'You', address: '14 rue de Turenne\n75004 Paris\nFrance' }, admin);
    if (i === 1) {
      await ctx.services.orders.transition(order, { to: 'PAID' }, admin);
      const bench = await benchOf(w, order);
      await ctx.services.atelier.start(bench, admin);
      await ctx.services.atelier.done(bench, { productionBatch: 'B-2026-09-STRESS' }, admin);
      await ctx.services.orders.transition(order, { to: 'SHIPPED', carrierId: await carrier(w, 'Chronopost'), trackingNumber: 'XY48291563748201937465012FR', declaredValueMinor: 640_000 }, admin);
    }
  }
  // Eight posts in the circle.
  clock.set(at('2026-09-20T09:00:00Z'));
  for (let i = 1; i <= 8; i++) {
    const kind = i % 3 === 0 ? 'INVITATION' : i % 3 === 1 ? 'NOTE' : 'POLL';
    const post = await ctx.services.circle.create(
      {
        kind,
        title: i === 1 ? 'A NOTE WHOSE TITLE RUNS LONGER THAN ANY THE ATELIER HAS WRITTEN SO FAR' : `POST ${i} OF THE CIRCLE`,
        body: 'The atelier writes to the owners of an ORBES piece.',
        ...(kind === 'INVITATION' ? { eventAt: new Date(NOCTURNE_NOW.getTime() + (i + 3) * DAY), eventPlace: 'THE ATELIER, 14 RUE DE TURENNE, PARIS', capacity: 120 } : {}),
        ...(kind === 'POLL' ? { pollOptions: ['A FINISH IN BRUSHED BLACK RHODIUM', 'WHITE GOLD', 'BRONZE', 'ANOTHER IDEA OF THE ATELIER'] } : {}),
      },
      admin,
    );
    if (i === 2) await ctx.services.media.addCirclePostPhoto(post.id, { mime: 'image/webp', bytes: nocturnePhoto('gold') }, admin);
    await ctx.services.circle.publish(post.id, admin);
    clock.advance(HOUR);
    if (i === 1) w.demo.posts.long = post.id;
    if (i === 2) w.demo.posts.longPoll = post.id;
  }
  // A LIVE RELEASE in 42 minutes, its room open an hour before, a host message of the longest length (140 characters); another in 9 days and 3 hours.
  clock.set(at('2026-10-01T10:00:00Z'));
  const soon = await createLiveRelease(w.f, {
    modelId: long.id,
    opensAt: new Date(NOCTURNE_NOW.getTime() + 42 * MINUTE),
    roomOpensMinutes: 60,
    minTier: 1,
    sizes: [{ label: '16', stock: 40 }, { label: '17', stock: 40 }, { label: '18', stock: 40 }],
    quantityLine: '120 PIECES · NEVER MORE, NEVER AGAIN',
    perAccount: 3,
    priceMinor: 12_540_000,
    addons: [{ label: 'ENGRAVING OF YOUR INITIALS AND A DATE', line: 'Engraved inside the band by the atelier, by hand', priceMinor: 125_000 }],
  });
  await titled(w, soon.id, 'MONOLITHE ARCHITECTURALE, THE SECOND EDITION', 'The longest name of the house, released live.');
  w.demo.releases.soon = soon.id;
  const far = await createLiveRelease(w.f, { modelId: w.models.steel!, opensAt: new Date(NOCTURNE_NOW.getTime() + 9 * DAY + 3 * HOUR), minTier: 1, sizes: [{ label: '17', stock: 12 }], quantityLine: '12 PIECES', priceMinor: 640_000 });
  await ctx.db.updateTable('drops').set({ currency: 'USD' }).where('id', '=', far.id).execute();
  await titled(w, far.id, 'MONOLITHE IN STEEL, NEW YORK');
  w.demo.releases.far = far.id;
  clock.set(new Date(NOCTURNE_NOW.getTime() - MINUTE));
  await ctx.services.live.message(
    soon.id,
    'Welcome to the vault. The door opens at the hour, the places drawn by tier then at random: keep this page open, choose a size, hold the seal',

    admin,
  );
}

/**
 * Every empty state: no model shown, no release, nothing in the circle, an account without a piece or an order (you).
 * The owner holds one piece of a model kept out of the collection (its lookbook HIDDEN): the circle opens to it, and
 * nothing is published there.
 */
async function seedEmpty(w: World): Promise<void> {
  const { ctx, admin } = w;
  w.clock.set(at('2026-09-01T09:00:00Z'));
  w.collection = (await ctx.services.catalog.createCollection({ name: 'ORBITAL' }, admin)).id;
  const hidden = await ctx.services.catalog.createModel({ categoryCode: 'J', collectionId: w.collection, name: 'MONOLITHE', type: 'BRACELET', skuPrefix: 'MNL-ST', defaultMaterial: '925 STERLING SILVER', careInstructions: null }, admin);
  w.models.steel = hidden.id;
  await account(w, 'you', 'you@example.com');
  await account(w, 'owner', 'm.okafor@example.com', 1, hidden.id);
}
