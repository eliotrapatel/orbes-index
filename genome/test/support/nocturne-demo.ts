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
 *   queue             the live story without its release live now: two LIVE RELEASES with a pace (ONE QUEUE; first
 *                     written for M1), live now: one at 40 turns a minute, three collectors in its one queue (the crowd
 *                     ahead of them written in bulk), and one whose pace ORBES paused, a collector in its queue (seedQueue);
 *                     ONE QUEUE's Horizon band: a release of 24 pieces, 9 left, and one of 300 at its LAST PIECES, 18
 *                     left, a collector in each one's queue (seedBand)
 *   afterroom         a LIVE RELEASE sold out a few minutes ago, its after-room open (C26)
 *   afterroom-ends    three LIVE RELEASES of the last two hours whose after-rooms ended with a guest still in their
 *                     line: sold out, closed at their time, ended by ORBES; and a guest who never entered one
 *   draws             a draw in every state an entry or a page shows (lot E's direct reservations included): closed
 *                     and not drawn, cancelled, drawn with a place held, a waiting list and a place lapsed, concluded
 *                     with its order PAID, in its early access with every piece reserved, open with every piece
 *                     reserved; a collector (r.castel) with an entry in each, and the October draw withdrawn
 *   (plan NEXT-NINE, IN-01: THE HOUSE'S GUARANTEE, seeded last in the full, room and draws variants so nothing of the story
 *   moves: a collector holding one shown to it before the blue LIVE RELEASE; in the room, one shown and one not; in the
 *   draws, a draw open with a place guaranteed (shown and not), a draw open entered with one, a draw drawn with two
 *   guaranteed places, shown and not, and a guarantee waiting for the next release of ZENITH)
 *   (plan NEXT-NINE, AC-01: YOUR SIZES, seeded last in the full and room variants so nothing of the story moves:
 *   MONOLITHE reads a bracelet size; HALO, a ring of THE PRIVATE SALON from PALLADIUM in sizes 50 to 56; in the full
 *   demo two PALLADIUM collectors who saved their sizes, one of them with HALO requested in size 54, and an account
 *   without a piece that saves and clears its own; in the room, a TITANE collector who saved a bracelet of 17 cm)
 *   stress            the extreme content of fidelity rule 5; THE PROGRAM's welcome gift (a model of one size) and
 *                     the PALLADIUM credit in use on an order (BP-19 T5); nine past releases of MONOLITHE
 *                     ARCHITECTURALE in its two finishes, seeded last (plan NEXT-NINE, CO-01: SHOW ALL 9 RELEASES)
 *   empty             every empty state: no model shown, no release, an account without a piece, and an owner
 *                     (one piece of a model kept out of the collection) before an empty circle
 *   pairs             the full story, and PAIRS WELL WITH picked by the console on MONOLITHE (plan NEXT-NINE, BP-34):
 *                     ZENITH, then MONOLITHE ARCHITECTURALE (public in ORBITAL, its 24-character name, no photograph)
 *   claim-waiting     the full story; its one state (claim-waiting, test/support/nocturne-states.ts) then writes, on its
 *                     own stage, a shipped order of MONOLITHE in blue for you and a new claim code waiting on it (plan
 *                     NEXT LOT §3.4), so no other state sees them
 *   draw-selected     the full story, the October draw then opened to the segment Founding list (plan MACRO M1 §3.3,
 *                     F4): you joined the founding list on theorbes.com before the draw (matched to your account),
 *                     the guest (h.morel) did not (seedDrawSelected)
 *   email             the full story with the emails' channel on (its stage's configuration, test/support/nocturne-stage.ts:
 *                     an SMTP host nothing reaches, the sender never running on a stage) and RESET BY EMAIL, release
 *                     notices and the founding announcement switched on (plan MACRO M1 §4.4, E1–E3): you asked for
 *                     release notices; a link to choose a new password was sent to you at NOW; a founding list's
 *                     pre-registration (seedEmail)
 *   orders-delivery   the full story; its one state writes (plan NEXT LOT §3.6.B, C): an engraving price in euros, a
 *   orders-case       saved default address for you, put on the reserved LIVE order with the add-on's words, and a
 *   account-addresses paid order of MONOLITHE in blue with a priced engraving, packing begun; orders-case's, a delivered
 *                     order of MONOLITHE in blue whose return you asked for, its location's address the return address
 *                     (§3.6.D); account-addresses', two saved addresses for you, one the default (§3.6.B)
 *   account-profile   the full story; its two states (account-profile, then profile-tastes) write YOUR PROFILE for you
 *                     (plan CUSTOMER INTELLIGENCE §3.1 P.8): your names, country, city, how you heard of ORBES and a
 *                     default address; then your favourite piece and finish, and a finish no longer in the collection
 *   wishes            the full story; its states write YOUR WISHLIST for you (plan CUSTOMER INTELLIGENCE §3.2 W.10): the
 *                     heart pressed on MONOLITHE in blue (sheet-wished); YOUR WISHLIST empty, then with three wishes,
 *                     MONOLITHE in gold discontinued and ZENITH hidden since (wishlist-empty, wishlist)
 *   birthday-credit   the full story; its one state gives the account without a piece (t.nguyen) a date of birth
 *                     entered before its birthday, today, and the daily grant its birthday credit (plan CUSTOMER
 *                     INTELLIGENCE §3.5 SB.4.5): IN USE, BIRTHDAY CREDIT, for an account without a tier. On its own
 *                     stage, so no other state holds a date of birth
 *   care-used         the full story, THE PROGRAM's PLATINE PRIVATE CARE then set to 1 piece a year (plan ORBES CARE,
 *                     step 1.4: PLATINE's default is every piece), so the PLATINE account's second piece reads the
 *                     year's PRIVATE CARE used for another piece (piece-care-used)
 *   orbes-care        the full story, then ORBES CARE (plan ORBES CARE, step 5.1): a 2-year model of leather goods beside
 *                     the jewelry (Lifetime), a piece of each with its warranty, a PLATINE piece's lifetime warranty and
 *                     its certificate, and one warranty claim per collector at each moment its ORBES CARE tab shows: its
 *                     prepaid label sent; replaced, the new piece shipped; after the free replacement, a 30 % credit (IN
 *                     USE, WARRANTY CREDIT); refused after inspection, the piece returned; a 2-year piece repaired
 *   gallery           the full story, then a gallery on MONOLITHE in steel (desktop, D11: for the desktop states and the
 *                     owner's look only): the demo's own photographs of it in gold and in blue, after its cover, so a
 *                     model's page on a computer shows its grid of tiles and the viewer they open
 *   worn              the full story, then WORN (lot M2, D31 G1 to G3; seedWorn): you's profile signs a photograph
 *                     (Camille, France, the Instagram name camille.m), and three more pieces of MONOLITHE in steel hold
 *                     one each: in review, published, not published (the piece not clearly visible); a collector
 *                     without a first name or a country holds one piece of it (YOUR PROFILE first); seven more owners of
 *                     MONOLITHE in its three variants each a photograph published (eight on its sheet with you's), and
 *                     one of ZENITH one alone on its sheet (G4, G5)
 *   addons            the live story, then the catalogue add-ons (plan MACRO M3 §4.4, D2; seedAddons): POLISHING CLOTH
 *                     (€ 15), CHAIN EXTENDER (€ 30), TRAVEL POUCH (€ 45) and THE TRAVEL CASE FOR TWO PIECES, LINED
 *                     (€ 12 450.50: the longest name, the largest price), in stock at the default location; the secured
 *                     collector's hold with a CLOTH × 2 and an EXTENDER; you's place held in MONOLITHE IN GOLD, THE AUTUMN
 *                     DRAW (€ 4 200) with a CLOTH chosen; ZENITH priced € 4 800 for the salon's request; you's orders: the
 *                     morning's RESERVED with a CLOTH × 2, a MONOLITHE in blue PAID then given an EXTENDER (its own
 *                     invoice), a MONOLITHE in gold PAID with a TRAVEL POUCH, packing begun
 *   set               the full story, then THE SET (plan MACRO M3 §5.4, K44 T1 to T3; seedSet): THE ORBITAL SET, three
 *                     pieces (MONOLITHE in gold, HALO, CONSTELLATION ORBITALE, a necklace: the longest name), € 12 000;
 *                     its October draw open (6 sets; PLATINE reserved a set in its early access, HALO 56 full since; you's
 *                     YOUR SIZES a bracelet of 17 and a ring of 52, the necklace unsaved; s.girard entered); its first draw
 *                     drawn on 4 October (2 sets: you's place held, t.nguyen on the waiting list); you's sets of the draws
 *                     of September: one RESERVED, one DELIVERED on 28 September whose HALO was exchanged for 54; two LIVE
 *                     RELEASES of the set, one at its photograph's stage (it leads NOW), one not revealed yet
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
import { isDomainError } from '../../src/server/errors.js';
import { deriveLiveTurnKey } from '../../src/server/services/live.js';
import { defaultLocationId, ensureSku } from '../../src/server/services/stock.js';
import { SYSTEM_ACTOR, type Actor, type ManualClock } from '../../src/server/types.js';
import type { DecideClaimInput } from '../../src/server/services/warranty-claims.js';
import { countPiecesIn, packAndShip, stockPieces } from './fulfil.js';
import { createLiveRelease, holdPieces, pickAddons, type LiveFixture, type LiveReleaseOptions } from './live.js';
import { giveSizes, poolDraw, withDrawSizes } from './draws.js';
import { HOUSE_DEFAULT_WORDS, houseDate, houseMoney, renderHouseWords, type HouseMomentName, type HouseValues } from '../../src/shared/house-words.js';
import { WORN_CONSENT_VERSION } from '../../src/server/services/worn.js';

export type DemoVariant =
  | 'full'
  | 'rules'
  | 'draw-leads'
  | 'draw-soon'
  | 'draw-early'
  | 'collection-leads'
  | 'room'
  | 'live'
  | 'queue'
  | 'afterroom'
  | 'afterroom-ends'
  | 'draws'
  | 'stress'
  | 'empty'
  | 'pairs'
  | 'claim-waiting'
  | 'draw-sizes'
  | 'draw-selected'
  | 'email'
  | 'orders-delivery'
  | 'orders-case'
  | 'account-addresses'
  | 'account-profile'
  | 'wishes'
  | 'birthday-credit'
  | 'care-used'
  | 'orbes-care'
  | 'gallery'
  | 'house'
  | 'worn'
  | 'addons'
  | 'set'
  | 'set-live';

export const DEMO_VARIANTS: readonly DemoVariant[] = Object.freeze([
  'full',
  'rules',
  'draw-leads',
  'draw-soon',
  'draw-early',
  'collection-leads',
  'room',
  'live',
  'queue',
  'afterroom',
  'afterroom-ends',
  'draws',
  'stress',
  'empty',
  'pairs',
  'claim-waiting',
  'draw-sizes',
  'draw-selected',
  'email',
  'orders-delivery',
  'orders-case',
  'account-addresses',
  'account-profile',
  'wishes',
  'birthday-credit',
  'care-used',
  'orbes-care',
  'gallery',
  'house',
  'worn',
  'addons',
  'set',
  'set-live',
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
  // The pairs stage (plan NEXT-NINE, BP-34) tells the full story, then the console picks MONOLITHE's pairs; the
  // claim-waiting stage (plan NEXT LOT §3.4) tells the full story, its state writing the rest.
  // The draw-sizes stage (plan NEXT LOT §3.6.F) tells the full story, then adds a draw in sizes, open. The stages of the
  // collector's side of an order (plan NEXT LOT §3.6) tell the full story, their state writing the rest.
  const OWN_STAGES = ['pairs', 'claim-waiting', 'draw-sizes', 'draw-selected', 'email', 'orders-delivery', 'orders-case', 'account-addresses', 'account-profile', 'wishes', 'birthday-credit', 'care-used', 'orbes-care', 'gallery', 'worn', 'set', 'set-live'] as const;
  // The house messages' stage (lot M2, FROM ORBES) tells the draw-leads story, MESSAGES' own.
  // The add-ons' stage (lot M3, D2) tells the live story (a hold secured), then its own (seedAddons).
  const story = (variant === 'house' ? 'draw-leads' : variant === 'addons' ? 'live' : (OWN_STAGES as readonly DemoVariant[]).includes(variant) ? 'full' : variant) as Exclude<
    DemoVariant,
    (typeof OWN_STAGES)[number] | 'house' | 'addons'
  >;
  if (story === 'empty') await seedEmpty(w);
  else if (story === 'stress') await seedStress(w);
  else {
    await seedCatalogue(w);
    // The queue's stage tells the live story, its own releases in place of the live one.
    await seedStory(w, story === 'queue' ? 'live' : story);
    if (story === 'full' || story === 'rules') await seedScanCases(w);
    if (story === 'full') await seedYearlyCare(w);
    if (story === 'room') await seedRoom(w);
    if (story === 'live') await seedLive(w);
    if (story === 'queue') await seedQueue(w);
    if (story === 'afterroom') await seedAfterRoom(w);
    if (story === 'afterroom-ends') await seedAfterRoomEnds(w);
    if (story === 'draws') await seedDraws(w);
    if (story === 'full' || story === 'room' || story === 'draws') await seedGuarantees(w, story);
    if (story === 'full' || story === 'room') await seedSizes(w, story);
    if (variant === 'pairs') await seedPairs(w);
    if (variant === 'draw-sizes') await seedDrawSizes(w);
    if (variant === 'draw-selected') await seedDrawSelected(w);
    if (variant === 'email') await seedEmail(w);
    if (variant === 'care-used') await seedCareUsed(w);
    if (variant === 'orbes-care') await seedOrbesCare(w);
    if (variant === 'gallery') await seedGallery(w);
    if (variant === 'house') await seedHouse(w);
    if (variant === 'worn') await seedWorn(w);
    if (variant === 'addons') await seedAddons(w);
    if (variant === 'set') await seedSet(w);
    if (variant === 'set-live') await seedSetLive(w);
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
  // order of the dots: Steel · Gold · Blue. Plan ORBES CARE, step 5.1: the demo's models are jewelry, created at the
  // Lifetime warranty (the default of New model, answer 12), its variants copying it.
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
async function issue(w: World, role: string, model: string, opts: { serial?: number; variant?: string | null; material?: string; sold?: string | false; category?: string } = {}) {
  const r = await w.ctx.services.issuance.issueProduct(
    {
      categoryCode: opts.category ?? 'J',
      year: 2026,
      ...(opts.serial ? { serial: opts.serial } : {}),
      modelId: w.models[model]!,
      collectionId: w.collection,
      ...(opts.variant === null ? {} : { variant: opts.variant ?? '17' }),
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
const carrier = async (w: World, name: string) => (await w.ctx.db.selectFrom('carriers').select('id').where('name', '=', name).executeTakeFirstOrThrow()).id;
const titled = async (w: World, id: string, title: string, description?: string) => {
  await w.ctx.db.updateTable('drops').set({ title, ...(description ? { description } : {}) }).where('id', '=', id).execute();
};

/** A draw of the past: created, published, the account entered, drawn, its place confirmed; its order's id. */
async function pastDraw(w: World, o: { model: string; title: string; opens: string; closes: string; quantity: number; who: DemoAccount; confirmAt: string }): Promise<string> {
  const { ctx, admin, clock } = w;
  clock.set(new Date(at(o.opens).getTime() - 2 * DAY));
  const d = await poolDraw(ctx.services.drops, ctx.db, { modelId: w.models[o.model]!, title: o.title, quantity: o.quantity, opensAt: at(o.opens), closesAt: at(o.closes), earlyAccessHours: 0 }, admin);
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

/**
 * The order's piece (plan NEXT LOT §3.5: no more piece to make): a piece issued with the draw's batch when it was
 * finished, counted in where the order waits, which it then holds (test/support/fulfil.ts stockPieces, step 5.12); the
 * packing scan binds it when its parcel is packed (`ship`).
 */
async function make(w: World, orderId: string, role: string, doneAt: string) {
  const held = await w.ctx.db.selectFrom('orders').select(['sku_id', 'location_id']).where('id', '=', orderId).executeTakeFirstOrThrow();
  const [done] = await stockPieces(w.ctx, { skuId: held.sku_id!, locationId: held.location_id, count: 1, productionBatch: 'B-2026-09-DRAW', at: at(doneAt), clock: w.clock, forOrderIds: [orderId] }, w.admin);
  if (!done) throw new Error('make: no piece');
  w.issued[role] = { uuid: done.uuid, productId: done.productId, codeId: done.codeId, data: done.data, glyphs: done.glyphs, ...(done.claimCode ? { claimCode: done.claimCode } : {}) };
  w.demo.pieces[role] = done.productId;
  w.demo.codes[role] = { data: fromBase64Url(done.data), glyphs: done.glyphs };
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
  await ctx.services.orders.setBuyer(steelOrder, { name: 'Camille Laurent', address: '14 rue de Turenne\n75004 Paris\nFrance', country: 'FR' }, admin);
  clock.set(at('2026-09-15T10:00:00Z'));
  await ctx.services.orders.transition(steelOrder, { to: 'PAID' }, admin);
  const steelPiece = await make(w, steelOrder, 'returned', '2026-09-16T09:00:00Z');
  clock.set(at('2026-09-16T10:00:00Z'));
  // Packed and shipped through the agent's steps (the SHIPPED gate, plan NEXT LOT step 5.12), its warranty started by
  // hand at ORBES PARIS before SHIP, which leaves it as it is.
  await packAndShip(ctx, steelOrder, {
    carrierId: await carrier(w, 'Colissimo'),
    trackingNumber: '6A10987654321',
    declaredValueMinor: 420_000,
    beforeShip: async () => {
      await ctx.services.warranty.activate(steelPiece.productId, { purchaseDate: '2026-09-16', retailer: 'ORBES PARIS', country: 'FR' }, admin);
    },
  }, admin);
  clock.set(at('2026-09-18T15:00:00Z'));
  await register(w, you, steelPiece);

  // ── The draw of 14 September in gold: its piece shipped on 18 Sep, registered on 22 Sep (DELIVERED) ──
  const goldOrder = await pastDraw(w, { model: 'gold', title: 'MONOLITHE IN GOLD', opens: '2026-09-14T10:00:00Z', closes: '2026-09-14T18:00:00Z', quantity: 12, who: you, confirmAt: '2026-09-15T09:00:00Z' });
  clock.set(at('2026-09-15T09:10:00Z'));
  await ctx.services.orders.setTerms(goldOrder, { sizeLabel: '17', priceMinor: 420_000, currency: 'EUR' }, admin);
  await ctx.services.orders.setBuyer(goldOrder, { name: 'Camille Laurent', address: '14 rue de Turenne\n75004 Paris\nFrance', country: 'FR' }, admin);
  clock.set(at('2026-09-16T10:00:00Z'));
  await ctx.services.orders.transition(goldOrder, { to: 'PAID' }, admin);
  const goldPiece = await make(w, goldOrder, 'gold', '2026-09-17T16:00:00Z');
  // The other collectors' pieces (held since June): PLATINE, the crowd of the releases and the circle (TITANE), the voters
  // (PLATINE). PLATINE starts from five pieces (plan NEXT-NINE, BP-19 T1): the two more of PLATINE's and of each voter's
  // carry serials of 2025, so the serials of 2026 the story shows stay as they were.
  const since = { startedAt: at('2026-06-01T10:00:00Z') };
  await holdPieces(ctx.db, platine.id, 3, w.models.steel!, { variant: '17', ...since });
  await holdPieces(ctx.db, platine.id, 2, w.models.steel!, { variant: '17', year: 2025, ...since });
  for (const c of crowd) await holdPieces(ctx.db, c.id, 1, w.models.blue!, { variant: '16', ...since });
  for (const v of voters) await holdPieces(ctx.db, v.id, 3, w.models.gold!, { variant: '18', ...since });
  for (const v of voters) await holdPieces(ctx.db, v.id, 2, w.models.gold!, { variant: '18', year: 2025, ...since });
  await holdPieces(ctx.db, guest.id, 1, w.models.gold!, { variant: '18', ...since });
  await holdPieces(ctx.db, absent.id, 1, w.models.steel!, { variant: '16', ...since });
  clock.set(at('2026-09-18T09:00:00Z'));
  await packAndShip(ctx, goldOrder, {
    carrierId: await carrier(w, 'Colissimo'),
    trackingNumber: '6A12345678901',
    declaredValueMinor: 420_000,
    beforeShip: async () => {
      await ctx.services.warranty.activate(goldPiece.productId, { purchaseDate: '2026-09-18', retailer: 'ORBES PARIS', country: 'FR' }, admin);
    },
  }, admin);

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

  // ── The circle: the note of 1 Oct, the poll and the invitation of 3 Oct ──
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

  // The poll an hour before the invitation (both of 3 Oct): the newest-first feed draws invitation, poll, note, as C8 does.
  clock.set(at('2026-10-03T07:00:00Z'));
  const poll = await circle.create({ kind: 'POLL', title: 'WHICH FINISH SHOULD FOLLOW BLUE?', body: 'After the blue, one more finish of MONOLITHE: tell the atelier which.', minTier: 2, pollOptions: ['BLACK', 'WHITE GOLD', 'BRONZE'] }, admin);
  await circle.publish(poll.id, admin);
  w.demo.posts.poll = poll.id;
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
  clock.set(at('2026-10-03T12:00:00Z'));
  await circle.rsvp(you.id, invitation.id, 'YES', you.actor);
  // PLATINE answered YES too, as C8 draws the invitation: in place of the crowd's first, so 3 places stay of 12.
  for (const c of crowd.slice(1)) await circle.rsvp(c.id, invitation.id, 'YES', c.actor);
  await circle.rsvp(platine.id, invitation.id, 'YES', platine.actor);
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
      // A fifth collector who will be there: a PALLADIUM account (10 pieces) of the selection, five of them with serials
      // of 2025 (the serials of 2026 the story shows stay as they were).
      const selected = await account(w, 'palladium', 'selected.owner@example.com', 5, w.models.gold);
      await holdPieces(ctx.db, selected.id, 5, w.models.gold!, { variant: '17', year: 2025, startedAt: new Date(w.clock.now().getTime() - DAY) });
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
    // The early access by tier (plan NEXT-NINE, BP-19 T3): draw-early opens at 18:00 UTC, PALLADIUM from 4 hours
    // before and PLATINE from 2 hours before (THE PROGRAM's defaults), NOW (16:49 UTC) inside PLATINE's window;
    // draw-soon keeps one window of 24 hours for both tiers.
    const early = variant === 'draw-early' ? 4 : variant === 'draw-soon' ? 24 : 0;
    const platineEarly = variant === 'draw-early' ? 2 : early;
    const drawOpens = variant === 'draw-early' ? at('2026-10-05T18:00:00Z') : opens;
    clock.set(at('2026-10-01T12:30:00Z'));
    // A draw of before the sizes (plan NEXT LOT §3.6.F: one pool), as every draw of this demo but `draw-sizes`'s.
    const d = await poolDraw(
      ctx.services.drops,
      ctx.db,
      {
        modelId: w.models.steel!,
        title: 'MONOLITHE, THE OCTOBER DRAW',
        description: 'Twelve pieces of MONOLITHE in steel, drawn among the entries of October.',
        quantity: 12,
        opensAt: drawOpens,
        closesAt: at('2026-10-11T18:00:00Z'),
        purchaseWindowHours: 48,
        earlyAccessHours: early,
        earlyAccessPlatineHours: platineEarly,
        // N1 (addition 5): the draw's price, shown on its card and page, taken by its orders.
        priceMinor: 420_000,
        currency: 'EUR',
      },
      admin,
    );
    w.demo.releases.draw = d.id;
  }
  w.demo.pieces.gold = goldPiece.productId;
}

/** The scan cases (C9, C11–C17, C35–C37): each its own piece, so a capture that changes one leaves the others. */
async function seedScanCases(w: World): Promise<void> {
  const { ctx, admin, clock, demo } = w;
  const owner = demo.accounts.owner!;
  clock.set(at('2026-10-04T10:00:00Z'));
  // Before plan NEXT LOT §3.5 (step 5.5) two orders of the story took a serial each for a piece to make (ZENITH's,
  // cancelled, and a draw's order waiting): the scan cases start two serials further on, so the serials the boards show
  // stay as they were (O26-J-00224 to O26-J-00232 in the full story).
  const next = Number((await ctx.db.selectFrom('products').select((eb) => eb.fn.max('serial').as('max')).where('year', '=', 2026).executeTakeFirstOrThrow()).max) + 1;
  // A piece sold this weekend, to register: AUTHENTIC — FIRST REGISTRATION (C9, C36).
  await issue(w, 'first', 'steel', { serial: next + 2, sold: '2026-10-04' });
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
  // Its code, for the new owner who receives the piece (C37).
  demo.links.transfer = (await ctx.services.ownership.initiateTransfer(owner.id, passing.productId, owner.actor)).transferCode;
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
 * ONE QUEUE (lot Q1, step Q1.2): a release's turns come by its batches, the next one on the minute from T0. The demo
 * gives each collector its turn at the second the room gave it before ONE QUEUE (NEXT BATCH NOW, at most the 5 000 of
 * the fixtures' pace, where a piece is free), so every state keeps its times; nothing free, nothing given.
 */
async function turnsNow(w: World, dropId: string): Promise<void> {
  await w.ctx.services.live.nextBatch(dropId, w.admin).catch((e: unknown) => {
    if (!isDomainError(e) || e.code !== 'LIVE_NOTHING_FREE') throw e;
  });
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
    await turnsNow(w, r.id);
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

/** `n` accounts of a crowd, written in bulk (no password to sign in with: they are never signed in). */
async function crowdOf(w: World, n: number, tag: string): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 500) {
    const values = Array.from({ length: Math.min(500, n - i) }, (_, k) => {
      const email = `${tag}.${i + k + 1}@example.com`;
      return { email, email_normalized: email, password_hash: 'unused' };
    });
    ids.push(...(await w.ctx.db.insertInto('accounts').values(values).returning('id').execute()).map((a) => a.id));
  }
  return ids;
}

/**
 * A paced release's line written in bulk, after its T0, in arrival order: `accounts[i]` at place i + 1, joined at `at`,
 * its size the release's sizes in turn (each demo account's own given by `sizeOf`).
 */
async function bulkLine(w: World, dropId: string, sizes: readonly { id: string }[], accounts: readonly string[], at: Date, sizeOf: ReadonlyMap<string, string>): Promise<void> {
  for (let i = 0; i < accounts.length; i += 500) {
    const values = accounts.slice(i, i + 500).map((accountId, k) => ({
      drop_id: dropId,
      account_id: accountId,
      size_id: sizeOf.get(accountId) ?? sizes[(i + k) % sizes.length]!.id,
      quantity: 1,
      tier: sizeOf.has(accountId) ? 1 : 0,
      status: 'QUEUED' as const,
      position: i + k + 1,
      joined_at: at,
      queued_at: at,
    }));
    await w.ctx.db.insertInto('live_entries').values(values).execute();
  }
}

/**
 * ONE QUEUE (lot Q1; first written for M1's W2, W5, W6): two LIVE RELEASES live now, each with its pace. MONOLITHE IN
 * BLUE, 40 turns every minute from its T0 five minutes ago: its line (5 240, written in bulk half a minute after T0), its
 * batches giving the turns its nine pieces allow, its next batch due in a minute; `admitted` (drawn place 150), `queued`
 * (612) and `queueFar` (5 199) in its one queue, in size 17, each reading its place in that size and its time left
 * (the queue's snapshot). MONOLITHE IN GOLD, 10 every two minutes from its T0 four minutes ago, its pace paused by ORBES
 * a minute ago: `queuePaused` (drawn place 22) in size 17, its time frozen.
 */
async function seedQueue(w: World): Promise<void> {
  const { ctx, clock, demo } = w;
  const live = ctx.services.live;
  clock.set(at('2026-10-04T12:00:00Z'));
  const t0 = new Date(NOCTURNE_NOW.getTime() - 5 * MINUTE);
  const r = await createLiveRelease(w.f, {
    modelId: w.models.blue!,
    opensAt: t0,
    closesAt: new Date(t0.getTime() + 3 * HOUR),
    minTier: 1,
    turnSeconds: 300,
    payMinutes: 10,
    sizes: [{ label: '16', stock: 3 }, { label: '17', stock: 3 }, { label: '18', stock: 3 }],
    quantityLine: '9 PIECES',
    priceMinor: 505_000,
    pace: { batch: 40, minutes: 1 },
  });
  await titled(w, r.id, 'MONOLITHE IN BLUE', 'The blue of MONOLITHE, released live: nine pieces, in the sizes of the house.');
  demo.releases.queue = r.id;
  const admitted = await account(w, 'admitted', 'admitted@example.com', 1, w.models.blue);
  const queued = await account(w, 'queued', 'queued@example.com', 1, w.models.blue);
  const far = await account(w, 'queueFar', 'queue.far@example.com', 1, w.models.blue);
  // T0: the line formed (nobody in the room), the first batch lets nobody in.
  clock.set(t0);
  await live.advance(r.id);
  const line = await crowdOf(w, 5240 - 3, 'queue');
  line.splice(149, 0, admitted.id);
  line.splice(611, 0, queued.id);
  line.splice(5198, 0, far.id);
  const s17 = r.sizes[1]!.id;
  await bulkLine(w, r.id, r.sizes, line, new Date(t0.getTime() + 30_000), new Map([admitted.id, queued.id, far.id].map((id) => [id, s17])));
  for (let k = 1; k <= 5; k++) {
    clock.set(new Date(t0.getTime() + k * MINUTE));
    await live.advance(r.id);
  }

  clock.set(at('2026-10-04T12:00:00Z'));
  const t1 = new Date(NOCTURNE_NOW.getTime() - 4 * MINUTE);
  const g = await createLiveRelease(w.f, {
    modelId: w.models.gold!,
    opensAt: t1,
    closesAt: new Date(t1.getTime() + 2 * HOUR),
    minTier: 1,
    turnSeconds: 300,
    payMinutes: 10,
    sizes: [{ label: '16', stock: 2 }, { label: '17', stock: 2 }, { label: '18', stock: 2 }],
    quantityLine: '6 PIECES',
    priceMinor: 505_000,
    pace: { batch: 10, minutes: 2 },
  });
  await titled(w, g.id, 'MONOLITHE IN GOLD', 'The gold of MONOLITHE, released live: six pieces, in the sizes of the house.');
  demo.releases.queuePaused = g.id;
  const paused = await account(w, 'queuePaused', 'queue.paused@example.com', 1, w.models.gold);
  clock.set(t1);
  await live.advance(g.id);
  const second = await crowdOf(w, 60 - 1, 'paused');
  second.splice(21, 0, paused.id);
  await bulkLine(w, g.id, g.sizes, second, new Date(t1.getTime() + 20_000), new Map([[paused.id, g.sizes[1]!.id]]));
  clock.set(new Date(t1.getTime() + 2 * MINUTE));
  await live.advance(g.id);
  clock.set(new Date(NOCTURNE_NOW.getTime() - MINUTE));
  await live.pausePace(g.id, w.admin);
  // ONE QUEUE (lot Q1, step Q1.8; MK Q4): the host's message, FROM ORBES alone over the queue, its pause in the screen.
  await live.message(g.id, 'Thank you for being here tonight.', w.admin);

  // ONE QUEUE's Horizon band (lot Q1, step Q1.7; MK Q9, Q10): a small release, and one at its LAST PIECES.
  await seedBand(w, { key: 'queueSmall', model: w.models.steel!, title: 'MONOLITHE IN STEEL', stock: [8, 8, 8], taken: [5, 6, 4], waiting: 2 });
  await seedBand(w, { key: 'queueLast', model: w.models.gold!, title: 'MONOLITHE IN GOLD', stock: [100, 100, 100], taken: [92, 98, 92], waiting: 1 });

  // The one waiting screen in every state (lot Q1, step Q1.8; MK #queue): each a release of 300 pieces in sizes 16, 17
  // and 18 (one of ONE SIZE), a collector in its queue in size 17, the mockup's figures. MONOLITHE IN BLUE throughout.
  const blue = { model: w.models.blue!, title: 'MONOLITHE IN BLUE', stock: [100, 100, 100] };
  // MK Q1: YOUR PLACE 4, 176 OF 300 LEFT · 3 IN SIZE 17.
  await seedBand(w, { ...blue, key: 'queueWait', taken: [14, 97, 13], waiting: 3 });
  // MK Q3: the same, the release paused by ORBES a minute ago: PAUSED and its line above the frozen time.
  await seedBand(w, { ...blue, key: 'queueReleasePaused', taken: [14, 97, 13], waiting: 3, then: (id) => w.ctx.services.live.pause(id, w.admin) });
  // MK Q8: every piece of size 17 held in a turn, none paid: 176 OF 300 LEFT · 0 IN SIZE 17, still the waiting screen.
  await seedBand(w, { ...blue, key: 'queueHeld', taken: [14, 100, 10], waiting: 3 });
  // MK Q5: YOUR PLACE 42, 9 pieces left in size 17, the pace slowed by ORBES to 1 every 5 minutes: the estimate past
  // the close, from 60 minutes in its decided words (ESTIMATED 1 H … MIN LEFT).
  await seedBand(w, { ...blue, key: 'queueClose', taken: [19, 91, 19], waiting: 41, then: (id) => w.ctx.services.live.setPace(id, { batch: 1, minutes: 5 }, w.admin) });
  // MK Q6: a release in ONE SIZE, its next batch in half a minute, this collector next: ESTIMATED LESS THAN A MINUTE LEFT.
  await seedBand(w, { model: w.models.blue!, title: 'MONOLITHE IN BLUE', key: 'queueOne', labels: ['ONE SIZE'], stock: [300], taken: [112], waiting: 0, sizeOf: 0, sinceMs: 3.5 * MINUTE });
  // MK Q2: during the 10-minute hold (T0 four minutes ago, 25 turns a minute from its end): YOUR PLACE 39, 300 OF 300
  // LEFT, nothing said of the hold; MK Q7b: a late comer who entered two minutes ago, after the opening, behind them.
  await seedBand(w, {
    ...blue,
    key: 'queueHold',
    taken: [0, 0, 0],
    waiting: 38,
    holdMinutes: 10,
    sinceMs: 4 * MINUTE,
    pace: { batch: 25, minutes: 1 },
    then: async (id, sizes) => {
      const late = await account(w, 'queueLate', 'queue.late@example.com', 1, w.models.blue);
      await w.ctx.services.live.enter(late.id, id, { sizeId: sizes[1]!.id }, late.actor);
    },
  });
  // Production's A PIECE HAS RETURNED on the turn (lot Q1, step Q1.10; N11): the turn of a size seen full.
  await seedReturned(w);
  // MK #after-wait: the after-room's waiting screen.
  await seedAfterWait(w);
  // MK #room-draw: the draw at the opening.
  await seedDraw(w);
}

/** How many releases stage the returned turn: each run of its state takes one (a phone, a computer, in dark and light). */
export const RETURNED_COPIES = 6;

/**
 * Production's A PIECE HAS RETURNED (lot Q1, step Q1.10; N11, D51): MONOLITHE IN BLUE, 201 pieces in sizes 16, 17 and 18,
 * size 17's one piece held in a turn by the first in its line (its first batch, two minutes after its T0, three minutes
 * ago), `queueReturned` second in size 17, first in its queue there: its page sees the size full. Its state's act gives
 * the piece back (the turn left) and lets `queueReturned` in: its turn comes on a size it saw full. One release per run
 * of the state (`queueReturned1` …), the account in each, since each run gives its turn.
 */
async function seedReturned(w: World): Promise<void> {
  const { ctx, clock, demo } = w;
  const live = ctx.services.live;
  clock.set(at('2026-10-04T12:00:00Z'));
  const you = await account(w, 'queueReturned', 'queue.returned@example.com', 1, w.models.blue);
  for (let n = 1; n <= RETURNED_COPIES; n++) {
    clock.set(at('2026-10-04T12:00:00Z'));
    const t0 = new Date(NOCTURNE_NOW.getTime() - 3 * MINUTE);
    const r = await createLiveRelease(w.f, {
      modelId: w.models.blue!,
      opensAt: t0,
      closesAt: new Date(t0.getTime() + 2 * HOUR),
      minTier: 1,
      turnSeconds: 300,
      payMinutes: 10,
      sizes: [{ label: '16', stock: 100 }, { label: '17', stock: 1 }, { label: '18', stock: 100 }],
      quantityLine: '201 PIECES',
      priceMinor: 505_000,
      pace: { batch: 1, minutes: 2 },
    });
    await titled(w, r.id, 'MONOLITHE IN BLUE', 'MONOLITHE IN BLUE, released live: 201 pieces, in the sizes of the house.');
    demo.releases[`queueReturned${n}`] = r.id;
    clock.set(t0);
    await live.advance(r.id);
    const [holder] = await crowdOf(w, 1, `returned${n}`);
    const s17 = r.sizes[1]!.id;
    await bulkLine(w, r.id, r.sizes, [holder!, you.id], new Date(t0.getTime() + 20_000), new Map([[holder!, s17], [you.id, s17]]));
    clock.set(new Date(t0.getTime() + 2 * MINUTE));
    await live.advance(r.id);
    await live.message(r.id, 'Thank you for being here tonight.', w.admin);
  }
}

/**
 * The draw at the opening (lot Q1, step Q1.9; MK #room-draw, 3b): MONOLITHE IN BLUE, 300 pieces in sizes 16, 17 and 18,
 * its T0 three seconds before NOW, `drawing` in its room in size 17 since two minutes before it; its line not formed yet
 * (the release not advanced past T0), so the page shows the room at its draw (DRAWING THE PLACES) and waits for its place.
 */
async function seedDraw(w: World): Promise<void> {
  const { ctx, clock, demo } = w;
  clock.set(at('2026-10-04T12:00:00Z'));
  const t0 = new Date(NOCTURNE_NOW.getTime() - 3_000);
  const r = await createLiveRelease(w.f, {
    modelId: w.models.blue!,
    opensAt: t0,
    closesAt: new Date(t0.getTime() + HOUR),
    minTier: 1,
    turnSeconds: 300,
    payMinutes: 10,
    sizes: [{ label: '16', stock: 100 }, { label: '17', stock: 100 }, { label: '18', stock: 100 }],
    quantityLine: '300 PIECES',
    priceMinor: 505_000,
    pace: { batch: 25, minutes: 1 },
    holdMinutes: 10,
  });
  await titled(w, r.id, 'MONOLITHE IN BLUE', 'MONOLITHE IN BLUE, released live: 300 pieces, in the sizes of the house.');
  demo.releases.drawing = r.id;
  const drawing = await account(w, 'drawing', 'drawing@example.com', 1, w.models.blue);
  clock.set(new Date(t0.getTime() - 2 * MINUTE));
  await ctx.services.live.enter(drawing.id, r.id, { sizeId: r.sizes[1]!.id }, drawing.actor);
  clock.set(new Date(t0.getTime() - 30_000));
  await ctx.services.live.message(r.id, 'Thank you for being here tonight.', w.admin);
}

/**
 * ONE QUEUE's Horizon band (lot Q1, step Q1.7): a paced LIVE RELEASE live now in sizes 16, 17 and 18 (`stock` each),
 * its first batch (two minutes after its T0, three minutes ago) giving its turns to the `taken` of each size, first in
 * its line; then `waiting` in size 17, then the account `key`, in size 17 too: its place in its size `waiting` + 1, the
 * pieces left the stock less those turns. MK Q9: 24 pieces, 9 left, 2 in size 17, place 3; MK Q10: 300 pieces, 18
 * left (LAST PIECES), 2 in size 17, place 2.
 */
async function seedBand(
  w: World,
  o: {
    key: string;
    model: string;
    title: string;
    stock: readonly number[];
    taken: readonly number[];
    waiting: number;
    /** Its sizes' labels (16, 17, 18 by default; ['ONE SIZE'] for a release in one size). */
    labels?: readonly string[];
    /** The size of the waiting and of `key` (its index; 1, size 17, by default). */
    sizeOf?: number;
    /** Its T0 this long before NOW (three minutes by default); its first batch two minutes after T0. */
    sinceMs?: number;
    holdMinutes?: number;
    /** Its pace (by default `taken` turns every two minutes: the first batch gives them all). */
    pace?: { batch: number; minutes: number };
    /** Done once the first batch is given (ORBES's controls, a late comer), at that moment. */
    then?: (dropId: string, sizes: readonly { id: string }[]) => Promise<unknown>;
  },
): Promise<void> {
  const { ctx, clock, demo } = w;
  const live = ctx.services.live;
  clock.set(at('2026-10-04T12:00:00Z'));
  const t0 = new Date(NOCTURNE_NOW.getTime() - (o.sinceMs ?? 3 * MINUTE));
  const quantity = o.stock.reduce((n, x) => n + x, 0);
  const given = o.taken.reduce((n, x) => n + x, 0);
  const labels = o.labels ?? o.stock.map((_, i) => String(16 + i));
  const r = await createLiveRelease(w.f, {
    modelId: o.model,
    opensAt: t0,
    closesAt: new Date(t0.getTime() + 2 * HOUR),
    minTier: 1,
    turnSeconds: 300,
    payMinutes: 10,
    sizes: o.stock.map((stock, i) => ({ label: labels[i]!, stock })),
    quantityLine: `${quantity} PIECES`,
    priceMinor: 505_000,
    pace: o.pace ?? { batch: given, minutes: 2 },
    holdMinutes: o.holdMinutes,
  });
  await titled(w, r.id, o.title, `${o.title}, released live: ${quantity} pieces, in the sizes of the house.`);
  demo.releases[o.key] = r.id;
  const you = await account(w, o.key, `${o.key.toLowerCase()}@example.com`, 1, o.model);
  clock.set(t0);
  await live.advance(r.id);
  const crowd = await crowdOf(w, given + o.waiting, o.key.toLowerCase());
  const sizeOf = new Map<string, string>();
  let k = 0;
  o.taken.forEach((n, i) => {
    for (let j = 0; j < n; j++) sizeOf.set(crowd[k++]!, r.sizes[i]!.id);
  });
  for (let j = 0; j < o.waiting; j++) sizeOf.set(crowd[k++]!, r.sizes[o.sizeOf ?? 1]!.id);
  sizeOf.set(you.id, r.sizes[o.sizeOf ?? 1]!.id);
  await bulkLine(w, r.id, r.sizes, [...crowd, you.id], new Date(t0.getTime() + 20_000), sizeOf);
  clock.set(new Date(t0.getTime() + 2 * MINUTE));
  await live.advance(r.id);
  await o.then?.(r.id, r.sizes);
  await live.message(r.id, 'Thank you for being here tonight.', w.admin);
}

/**
 * The after-room's waiting screen (lot Q1, step Q1.8; MK #after-wait, D29): a LIVE RELEASE of one piece in size 17, sold
 * out four minutes ago with eleven guests and `afterWait` still in its line; its after-room (12 pieces: 10 in size 16, 2
 * in size 17) open since three minutes ago. Its guests took their places two minutes ago, in their order of the line:
 * two in size 17 and seven in size 16 in a turn at once (no pace), then one in size 17 waiting, then `afterWait`: its
 * place 2 in size 17, 3 OF 12 LEFT · 0 IN SIZE 17, no time.
 */
async function seedAfterWait(w: World): Promise<void> {
  const { ctx, clock, demo } = w;
  const live = ctx.services.live;
  const t0 = new Date(NOCTURNE_NOW.getTime() - 12 * MINUTE);
  clock.set(at('2026-10-04T12:00:00Z'));
  const r = await createLiveRelease(w.f, {
    modelId: w.models.blue!,
    opensAt: t0,
    minTier: 0,
    sizes: [{ label: '17', stock: 1 }],
    quantityLine: '1 PIECE',
    priceMinor: 505_000,
    turnSeconds: 300,
    payMinutes: 10,
    afterRoom: { modelId: w.models.blue!, priceMinor: 505_000, sizes: [{ label: '16', stock: 10 }, { label: '17', stock: 2 }], delayMinutes: 1, lengthMinutes: 30 },
  });
  await titled(w, r.id, 'MONOLITHE IN BLUE', 'One piece of MONOLITHE in blue, released live.');
  await titled(w, r.afterRoom!.id, 'MONOLITHE IN BLUE · THE AFTER-ROOM');
  demo.releases.afterWait = r.id;
  const actor = (id: string) => ({ type: 'account' as const, id });
  const [rival, ...guests] = await crowdOf(w, 11, 'afterwait');
  const you = await account(w, 'afterWait', 'after.wait@example.com', 1, w.models.blue);
  clock.set(new Date(t0.getTime() - MINUTE));
  await live.enter(rival!, r.id, { sizeId: r.sizes[0]!.id }, actor(rival!));
  clock.set(t0);
  await live.advance(r.id);
  clock.set(new Date(t0.getTime() + 30_000));
  for (const g of [...guests, you.id]) await live.enter(g, r.id, { sizeId: r.sizes[0]!.id }, actor(g));
  await live.advance(r.id);
  const token = (await live.entry(rival!, r.id))?.turn?.token;
  if (!token) throw new Error('no turn for the rival');
  await live.press(rival!, r.id, token);
  clock.advance(1_500);
  await live.secure(rival!, r.id, token, actor(rival!));
  clock.set(new Date(NOCTURNE_NOW.getTime() - 4 * MINUTE));
  await live.confirm(rival!, r.id, actor(rival!));
  await live.advance(r.id);
  clock.set(new Date(NOCTURNE_NOW.getTime() - 3 * MINUTE));
  await live.advance(r.id);
  await live.advance(r.afterRoom!.id);
  clock.set(new Date(NOCTURNE_NOW.getTime() - 2 * MINUTE));
  const [s16, s17] = r.afterRoom!.sizes;
  const sizeOf = [s17, s17, s16, s16, s16, s16, s16, s16, s16, s17];
  for (const [i, g] of guests.entries()) {
    await live.enter(g, r.afterRoom!.id, { sizeId: sizeOf[i]!.id }, actor(g));
    await live.advance(r.afterRoom!.id);
  }
  await live.enter(you.id, r.afterRoom!.id, { sizeId: s17!.id }, you.actor);
  await live.advance(r.afterRoom!.id);
  await live.message(r.afterRoom!.id, 'Thank you for being here tonight.', w.admin);
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
    const d = await poolDraw(
      drops,
      ctx.db,
      {
        modelId: w.models[o.model]!,
        title: o.title,
        quantity: o.quantity ?? 1,
        opensAt: at(o.opens),
        closesAt: at(o.closes),
        purchaseWindowHours: o.window ?? 48,
        // One window for both tiers, as the draws of lot E had it.
        earlyAccessHours: o.early ?? 0,
        earlyAccessPlatineHours: o.early ?? 0,
      },
      admin,
    );
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
  await ctx.services.orders.setBuyer(order, { name: 'R. Castel', address: '3 place des Vosges\n75004 Paris\nFrance', country: 'FR' }, admin);
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

// ── THE HOUSE'S GUARANTEE (plan NEXT-NINE, IN-01) ──────────────────────────

/**
 * The house's guarantees, granted by the console last of all (no piece is issued: the accounts hold none, so no serial of
 * the story moves). `full`: `holder` before the blue LIVE RELEASE (I'LL BE THERE). `room`: `roomHolder` (shown, for 2
 * pieces) and `roomQuiet` (not shown), neither in the room yet. `draws`: `holder` (shown) and `quiet` (not shown) on a
 * draw open since this morning, neither entered (THE GUARANTEED DRAW); `holder` entered with one on a second (THE
 * ENTERED DRAW); both entered with theirs on a draw drawn on 4 Oct with two collectors ranked (THE GUARANTEED DRAW OF
 * OCTOBER); and `holder`'s guarantee waiting for the next release of ZENITH.
 */
async function seedGuarantees(w: World, variant: 'full' | 'room' | 'draws'): Promise<void> {
  const { ctx, admin, clock, demo } = w;
  const grant = (a: DemoAccount, input: { scope: 'RELEASE' | 'MODEL'; targetId: string; pieces?: number; validUntil: string; visible?: boolean }) =>
    ctx.services.guarantees.grant(a.id, { pieces: 1, visible: true, ...input }, admin);
  if (variant === 'full') {
    clock.set(at('2026-10-05T08:00:00Z'));
    const holder = await account(w, 'holder', 'c.marchand@example.com');
    await grant(holder, { scope: 'RELEASE', targetId: demo.releases.blue!, validUntil: '2026-12-31' });
    return;
  }
  if (variant === 'room') {
    clock.set(at('2026-10-05T08:00:00Z'));
    const holder = await account(w, 'roomHolder', 'c.marchand@example.com');
    const quiet = await account(w, 'roomQuiet', 'e.weiss@example.com');
    await grant(holder, { scope: 'RELEASE', targetId: demo.releases.room!, pieces: 2, validUntil: '2026-12-31' });
    await grant(quiet, { scope: 'RELEASE', targetId: demo.releases.room!, validUntil: '2026-12-31', visible: false });
    return;
  }
  const drops = ctx.services.drops;
  const draw = async (key: string, o: { model: string; title: string; quantity: number; created: string; opens: string; closes: string }) => {
    clock.set(at(o.created));
    const d = await poolDraw(drops, ctx.db, { modelId: w.models[o.model]!, title: o.title, quantity: o.quantity, opensAt: at(o.opens), closesAt: at(o.closes), earlyAccessHours: 0, earlyAccessPlatineHours: 0 }, admin);
    demo.releases[key] = d.id;
    return d.id;
  };
  clock.set(at('2026-09-29T08:00:00Z'));
  const holder = await account(w, 'holder', 'c.marchand@example.com');
  const quiet = await account(w, 'quiet', 'e.weiss@example.com');
  const ranked = [await account(w, 'ranked1', 'n.duval@example.com'), await account(w, 'ranked2', 'p.renaud@example.com')];
  // Drawn on 4 Oct: two guaranteed places (2 pieces shown to `holder`, 1 not shown to `quiet`), then the ranked list.
  const drawn = await draw('guaranteedDrawn', { model: 'steel', title: 'MONOLITHE IN STEEL, THE GUARANTEED DRAW OF OCTOBER', quantity: 4, created: '2026-09-29T09:00:00Z', opens: '2026-10-01T10:00:00Z', closes: '2026-10-04T18:00:00Z' });
  clock.set(at('2026-09-30T09:00:00Z'));
  await grant(holder, { scope: 'RELEASE', targetId: drawn, pieces: 2, validUntil: '2026-12-31' });
  await grant(quiet, { scope: 'RELEASE', targetId: drawn, validUntil: '2026-12-31', visible: false });
  clock.set(at('2026-10-02T10:00:00Z'));
  for (const a of [holder, quiet, ...ranked]) await drops.enter(a.id, drawn, a.actor);
  clock.set(at('2026-10-04T18:05:00Z'));
  await drops.draw(drawn, admin);
  // Open since this morning: a place guaranteed for 2 pieces (shown) and one not shown, neither entered yet.
  const open = await draw('guaranteed', { model: 'gold', title: 'MONOLITHE IN GOLD, THE GUARANTEED DRAW', quantity: 3, created: '2026-10-04T19:00:00Z', opens: '2026-10-05T10:00:00Z', closes: '2026-10-11T18:00:00Z' });
  const entered = await draw('guaranteedEntered', { model: 'blue', title: 'MONOLITHE IN BLUE, THE ENTERED DRAW', quantity: 2, created: '2026-10-04T19:30:00Z', opens: '2026-10-05T10:00:00Z', closes: '2026-10-11T18:00:00Z' });
  clock.set(at('2026-10-05T09:00:00Z'));
  await grant(holder, { scope: 'RELEASE', targetId: open, pieces: 2, validUntil: '2026-11-30' });
  await grant(quiet, { scope: 'RELEASE', targetId: open, validUntil: '2026-11-30', visible: false });
  await grant(holder, { scope: 'RELEASE', targetId: entered, validUntil: '2026-12-15' });
  await grant(holder, { scope: 'MODEL', targetId: w.models.zenith!, validUntil: '2027-01-03' });
  clock.set(at('2026-10-05T11:30:00Z'));
  await drops.enter(holder.id, entered, holder.actor);
}

// ── YOUR SIZES (plan NEXT-NINE, AC-01) ─────────────────────────────────────

/**
 * YOUR SIZES, seeded last (no serial of 2026 moves: the pieces held carry serials of 2025). MONOLITHE reads a bracelet
 * size (its variants inherit it). In the full demo: HALO, a ring of THE PRIVATE SALON offered from PALLADIUM (no other
 * account of the story reads it) in sizes 50 · 52 · 54 · 56; `sized`, PALLADIUM, who saved a ring of 52 and a bracelet
 * of 17 cm (HALO's 52 and the blue release's 17 preselected); `sizedRequested`, PALLADIUM, who saved 54 and requested
 * HALO in size 54; `sizer`, without a piece, who saves and clears its sizes in the writes. In the room: `sized`, TITANE,
 * a bracelet of 17 cm saved and no I'LL BE THERE (its room preselects 17, TO CONFIRM).
 */
/**
 * Plan NEXT LOT §3.6.F, the draw-sizes stage: MONOLITHE in steel drawn in its sizes, 16 (3 pieces), 17 (5) and 18 (1),
 * published on 2 October with an early access of 24 hours for both tiers, in which the PLATINE account reserved the one
 * piece of 18 (FULL, 1 RESERVED DIRECTLY); entries open since 4 October 10:00 UTC, closing on 9 October 18:00 UTC. The
 * account with its sizes saved (BRACELET 17) reads it with its size preselected from YOUR SIZES.
 */
async function seedDrawSizes(w: World): Promise<void> {
  const { ctx, admin, clock, demo } = w;
  clock.set(at('2026-10-02T09:00:00Z'));
  // A draw's sizes are its model's (plan NEXT LOT §5.1 #20): the steel, of no type in the demo, is given its bracelet
  // sizes for the draw's creation and publication only, nothing a collector reads changed.
  const d = await withDrawSizes(ctx.db, w.models.steel!, ['16', '17', '18'], async () => {
    const created = await ctx.services.drops.create(
      {
        modelId: w.models.steel!,
        title: 'MONOLITHE, A DRAW IN SIZES',
        description: 'Nine pieces of MONOLITHE in steel, each in its size, drawn among the entries of October.',
        sizes: [
          { label: '16', pieces: 3 },
          { label: '17', pieces: 5 },
          { label: '18', pieces: 1 },
        ],
        opensAt: at('2026-10-04T10:00:00Z'),
        closesAt: at('2026-10-09T18:00:00Z'),
        purchaseWindowHours: 48,
        earlyAccessHours: 24,
        earlyAccessPlatineHours: 24,
        priceMinor: 420_000,
        currency: 'EUR',
      },
      admin,
    );
    return ctx.services.drops.publish(created.id, admin);
  }, 'BRACELET');
  clock.set(at('2026-10-03T12:00:00Z'));
  const platine = demo.accounts.platine!;
  await ctx.services.drops.reserve(platine.id, d.id, platine.actor, { sizeId: d.sizes.find((z) => z.label === '18')!.id });
  demo.releases.drawSizes = d.id;
}

/**
 * Plan MACRO M1 §3.3 (F4): the October draw opened to a segment, FOR SELECTED COLLECTORS. You joined the founding list on
 * theorbes.com on 20 September (the form's own path, matched to your account at once); ORBES made the segment Founding
 * list (the FOUNDING_LIST rule) on 28 September. The draw is already published by the story, so its segment is written
 * as the console would have set it before the publication (a draw's segment no longer changes once published).
 */
async function seedDrawSelected(w: World): Promise<void> {
  const { ctx, admin, clock, demo } = w;
  clock.set(at('2026-09-20T18:00:00Z'));
  await ctx.services.founding.register({ email: demo.accounts.you!.email, firstName: 'Camille', country: 'FR', consent: true, website: '' }, { type: 'system', id: 'public' });
  clock.set(at('2026-09-28T09:00:00Z'));
  const segment = await ctx.services.segments.create({ name: 'Founding list', criteria: { match: 'ALL', rules: [{ kind: 'FOUNDING_LIST' }] } }, admin);
  await ctx.db.updateTable('drops').set({ access_segment_id: segment.id }).where('id', '=', demo.releases.draw!).execute();
}

/**
 * Plan MACRO M1 §4.4 (E1–E3; lot M1, step M1.19), the stage `email`: the console switches RESET BY EMAIL, release notices
 * and the founding announcement on; you ask, in YOUR PROFILE, to be told when a release is announced; Inès joined the
 * founding list on theorbes.com on 20 September; at NOW you ask for a link to choose a new password (RESET BY EMAIL), its
 * address and code read back from the email written in the outbox (never sent: the stage's sender does not run). The
 * links of the emails (the reset link's fragment, the STOP THESE EMAILS tokens) are kept in demo.links.
 */
async function seedEmail(w: World): Promise<void> {
  const { ctx, admin, clock, demo } = w;
  const you = demo.accounts.you!;
  for (const kind of ['PASSWORD_RESET', 'RELEASE_NOTICE', 'FOUNDING_ANNOUNCEMENT'] as const) await ctx.services.email.setEnabled(kind, true, admin);
  await ctx.services.emails.setPreferences(you.id, { releaseNotices: true }, you.actor);
  clock.set(at('2026-09-20T18:00:00Z'));
  await ctx.services.founding.register({ email: 'ines.fabre@example.com', firstName: 'Inès', country: 'FR', consent: true, website: '' }, { type: 'system', id: 'public' });
  const founding = await ctx.db.selectFrom('preregistrations').select('id').where('email_normalized', '=', 'ines.fabre@example.com').executeTakeFirstOrThrow();
  clock.set(NOCTURNE_NOW);
  await ctx.services.recovery.requestByEmail(you.email);
  const sent = await ctx.db.selectFrom('email_outbox').select('body_text').where('kind', '=', 'PASSWORD_RESET').where('account_id', '=', you.id).orderBy('created_at', 'desc').executeTakeFirstOrThrow();
  const link = /\/verify\/reset#([^\s)\]>]+)/.exec(sent.body_text);
  if (!link) throw new Error('no reset link in the email');
  demo.links.reset = link[1]!;
  demo.links.unsubscribe = ctx.services.email.unsubscribeToken('RELEASE_NOTICE', you.id);
  demo.links.unsubscribeFounding = ctx.services.email.unsubscribeToken('FOUNDING_ANNOUNCEMENT', founding.id);
}

/**
 * Lot M2 (macro scope D24, M3 and M4; plan §1.5), the stage `house`: MESSAGES of you with three house messages and no
 * conversation. YOUR FIRST PIECE (a moment, the day after its first registration: CARING FOR YOUR PIECE and YOUR SIZES)
 * and A CREDIT ENDS SOON (IN USE), both read; then, this morning, a message of ORBES to TITANE and above, unread.
 */
async function seedHouse(w: World): Promise<void> {
  const { ctx, admin, clock, demo } = w;
  const you = demo.accounts.you!;
  const yours = demo.pieces.yours;
  if (!yours) throw new Error('seedHouse: no piece yours');
  const moment = (m: HouseMomentName, values: HouseValues) => ({
    title: renderHouseWords(HOUSE_DEFAULT_WORDS[m].title, values),
    body: renderHouseWords(HOUSE_DEFAULT_WORDS[m].body, values),
  });
  await ctx.db
    .insertInto('house_deliveries')
    .values([
      {
        account_id: you.id,
        source: 'MOMENT',
        moment: 'FIRST_REGISTRATION',
        ...moment('FIRST_REGISTRATION', { piece: 'MONOLITHE IN STEEL' }),
        piece_ref: yours,
        dedupe_key: `FIRST_REGISTRATION:${you.id}`,
        delivered_at: at('2026-09-16T07:30:00Z'),
        read_at: at('2026-09-16T19:02:00Z'),
      },
      {
        account_id: you.id,
        source: 'MOMENT',
        moment: 'CREDIT_EXPIRING',
        ...moment('CREDIT_EXPIRING', { amount: houseMoney(5000, 'EUR'), expires: houseDate('2026-10-10') }),
        dedupe_key: `CREDIT_EXPIRING:demo:${you.id}`,
        delivered_at: at('2026-10-03T07:30:00Z'),
        read_at: at('2026-10-03T12:41:00Z'),
      },
    ])
    .execute();
  clock.set(at('2026-10-05T08:10:00Z'));
  const message = await ctx.services.houseMessages.create(
    {
      title: 'THE AUTUMN RELEASES',
      body: 'The autumn releases open in the coming weeks. Each one is announced in THE RELEASES first, with its date and its hour in Paris.\n\nThank you for being part of ORBES.',
      audience: { tier: 1 },
    },
    admin,
  );
  await ctx.services.houseMessages.send(message.id, { phrase: 'SEND' }, admin);
  await ctx.services.houseMessages.deliverDue(at('2026-10-05T08:15:00Z'));
}

/**
 * Lot M2 (macro scope D31, G1 to G3; plan §2.3, step M2.10), the stage `worn`: you's profile with its first name,
 * country and Instagram name; three more pieces of MONOLITHE in steel for you, their photographs sent on 3 October (the
 * demo's own photographs of the model: no person in them), one left in review, one published on 4 October, one not
 * published (PIECE_NOT_VISIBLE); a collector without a first name or a country (l.bernard) holding one piece of it. The
 * pieces' roles: wornReview, wornPublished, wornRefused, wornProfile; `yours` sends none (CHOOSE A PHOTOGRAPH).
 */
async function seedWorn(w: World): Promise<void> {
  const { ctx, admin, clock, demo } = w;
  const you = demo.accounts.you!;
  await ctx.db.updateTable('accounts').set({ country: 'FR' }).where('id', '=', you.id).execute();
  await ctx.db
    .insertInto('account_profiles')
    .values({ account_id: you.id, first_name: 'Camille', instagram: 'camille.m' })
    .onConflict((oc) => oc.column('account_id').doUpdateSet({ first_name: 'Camille', instagram: 'camille.m' }))
    .execute();
  const since = at('2026-09-20T10:00:00Z');
  const held = await holdPieces(ctx.db, you.id, 3, w.models.steel!, { variant: '17', startedAt: since });
  const roles = ['wornReview', 'wornPublished', 'wornRefused'] as const;
  const serial = async (id: string) => (await ctx.db.selectFrom('products').select('product_id').where('id', '=', id).executeTakeFirstOrThrow()).product_id;
  const photos = [nocturnePhoto('steel'), nocturnePhoto('gold'), nocturnePhoto('blue')];
  const sent: string[] = [];
  for (const [i, role] of roles.entries()) {
    demo.pieces[role] = await serial(held[i]!);
    clock.set(at(`2026-10-03T1${i}:00:00Z`));
    const r = await ctx.services.worn.send(you.id, demo.pieces[role]!, { mime: 'image/webp', bytes: photos[i]! }, { instagram: role !== 'wornRefused', consent: WORN_CONSENT_VERSION }, you.actor);
    sent.push(r.photo!.id);
  }
  clock.set(at('2026-10-04T09:12:00Z'));
  await ctx.services.worn.publish(sent[1]!, admin);
  await ctx.services.worn.refuse(sent[2]!, 'PIECE_NOT_VISIBLE', admin);
  const newcomer = await account(w, 'wornNewcomer', 'l.bernard@example.com');
  const [piece] = await holdPieces(ctx.db, newcomer.id, 1, w.models.steel!, { variant: '17', startedAt: since });
  demo.pieces.wornProfile = await serial(piece!);
  // Step M2.11 (G3 to G5), WORN on the sheets: seven more owners of MONOLITHE, in each of its variants, each a photograph
  // published (with you's, eight on its sheet, the newest first; some show their Instagram name), and one owner of ZENITH
  // (THE PRIVATE SALON) a photograph alone on its sheet.
  for (const [i, o] of WORN_OWNERS.entries()) {
    const a = await account(w, o.key, o.email);
    await ctx.db.updateTable('accounts').set({ country: o.country }).where('id', '=', a.id).execute();
    await ctx.db.insertInto('account_profiles').values({ account_id: a.id, first_name: o.firstName, instagram: o.instagram }).execute();
    const [held] = await holdPieces(ctx.db, a.id, 1, w.models[o.model]!, { variant: '17', startedAt: since });
    clock.set(at(o.published));
    const r = await ctx.services.worn.send(a.id, await serial(held!), { mime: 'image/webp', bytes: nocturnePhoto(o.photo) }, { instagram: o.instagram !== null, consent: WORN_CONSENT_VERSION }, a.actor);
    clock.set(new Date(at(o.published).getTime() + (i + 1) * MINUTE));
    await ctx.services.worn.publish(r.photo!.id, admin);
  }
}

/**
 * The owners whose photographs WORN shows on the stage `worn` (step M2.11): MONOLITHE's in steel, gold and blue (the
 * sheet shows them alike, never a variant), ZENITH's alone; each published on its day (newest first on the sheet).
 */
const WORN_OWNERS: readonly { key: string; email: string; firstName: string; country: string; instagram: string | null; model: 'steel' | 'gold' | 'blue' | 'zenith'; photo: 'steel' | 'gold' | 'blue'; published: string }[] = [
  { key: 'wornLea', email: 'lea.moretti@example.com', firstName: 'Léa', country: 'IT', instagram: 'lea.moretti', model: 'gold', photo: 'gold', published: '2026-10-05T07:40:00Z' },
  { key: 'wornYuki', email: 'yuki.tanaka@example.com', firstName: 'Yuki', country: 'JP', instagram: null, model: 'blue', photo: 'blue', published: '2026-10-03T08:10:00Z' },
  { key: 'wornAmara', email: 'amara.okafor@example.com', firstName: 'Amara', country: 'GB', instagram: 'amara.wears', model: 'steel', photo: 'steel', published: '2026-10-02T09:30:00Z' },
  { key: 'wornSofia', email: 'sofia.ruiz@example.com', firstName: 'Sofía', country: 'ES', instagram: null, model: 'gold', photo: 'gold', published: '2026-09-30T16:05:00Z' },
  { key: 'wornNoah', email: 'noah.keller@example.com', firstName: 'Noah', country: 'US', instagram: 'noah.k', model: 'blue', photo: 'blue', published: '2026-09-28T11:20:00Z' },
  { key: 'wornInes', email: 'ines.benali@example.com', firstName: 'Inès', country: 'MA', instagram: null, model: 'steel', photo: 'steel', published: '2026-09-26T14:45:00Z' },
  { key: 'wornJonas', email: 'jonas.weber@example.com', firstName: 'Jonas', country: 'DE', instagram: 'jonas.weber', model: 'gold', photo: 'gold', published: '2026-09-24T10:00:00Z' },
  { key: 'wornHana', email: 'hana.seo@example.com', firstName: 'Hana', country: 'KR', instagram: 'hana.seo', model: 'zenith', photo: 'gold', published: '2026-10-01T12:00:00Z' },
];

/** The catalogue add-ons of the demo (plan MACRO M3 §4.4, D2), by role → their id. */
export const NOCTURNE_ADDONS = Object.freeze({
  cloth: { name: 'POLISHING CLOTH', line: 'A soft cloth to keep the metal bright.', skuCode: 'ADD-CLOTH', priceMinor: 1_500 },
  extender: { name: 'CHAIN EXTENDER', line: 'Five centimetres more, to wear it longer.', skuCode: 'ADD-EXTENDER', priceMinor: 3_000 },
  pouch: { name: 'TRAVEL POUCH', line: null, skuCode: 'ADD-POUCH', priceMinor: 4_500 },
  // The longest name and the largest price of the stage (its rows wrap, never cut).
  case: { name: 'THE TRAVEL CASE FOR TWO PIECES, LINED', line: 'Lined to keep two pieces apart, with its own cloth, for the longest journeys.', skuCode: 'ADD-CASE', priceMinor: 1_245_050 },
});

/**
 * The add-ons' stage (plan MACRO M3 §4.4, D2), after the live story: the four add-ons, priced in euros, ten of each
 * counted in at the default location; the secured collector's hold given a CLOTH × 2 and an EXTENDER (the release's
 * ENGRAVING kept); you's place held in a draw with a price (THE AUTUMN DRAW, € 4 200), a CLOTH chosen on it; ZENITH
 * priced € 4 800 (its salon request offers them); you's orders: the morning's LIVE order (RESERVED) given a CLOTH × 2,
 * a MONOLITHE in blue sold by Client Services, PAID, then given an EXTENDER (its own invoice), and a MONOLITHE in gold,
 * PAID with a TRAVEL POUCH, the agent's packing begun.
 */
async function seedAddons(w: World): Promise<void> {
  const { ctx, admin, clock, demo } = w;
  const you = demo.accounts.you!;
  const secured = demo.accounts.secured!;
  const location = await defaultLocationId(ctx.db);
  clock.set(new Date(NOCTURNE_NOW.getTime() - 90_000));
  const ids: Record<string, string> = {};
  for (const [role, a] of Object.entries(NOCTURNE_ADDONS)) {
    const made = await ctx.services.addons.create({ name: a.name, line: a.line, skuCode: a.skuCode, weightG: 40, prices: { EUR: a.priceMinor } }, admin);
    await ctx.services.stock.adjust({ skuId: made.sku.id, locationId: location, delta: 10, note: 'Counted in.' }, admin);
    ids[role] = made.id;
  }
  // The hold: the release's ENGRAVING as chosen, and two add-ons of the catalogue. Lot Q2, step Q2.3: the release, under
  // way, picks the four (as migration 0060 writes the pick of a release not ended: every catalogue add-on of M3).
  const live = demo.releases.live!;
  await pickAddons(ctx.db, live, Object.keys(NOCTURNE_ADDONS).map((role) => ids[role]!));
  const held = await ctx.services.live.entry(secured.id, live);
  await ctx.services.live.setAddons(secured.id, live, (held?.addons ?? []).map((a) => a.id), secured.actor, [
    { addonId: ids.cloth!, units: 2 },
    { addonId: ids.extender!, units: 1 },
  ]);
  // ZENITH priced in euros: the salon's request offers the add-ons.
  await ctx.services.catalog.updateModel(w.models.zenith!, { basePriceMinor: 480_000, baseCurrency: 'EUR' }, admin);
  // A draw with a price, you's place held in it, a CLOTH chosen on it (Q2.3: its pick, the draws' default, the four).
  clock.set(at('2026-10-01T09:00:00Z'));
  const autumn = await poolDraw(
    ctx.services.drops,
    ctx.db,
    {
      modelId: w.models.gold!,
      title: 'MONOLITHE IN GOLD, THE AUTUMN DRAW',
      quantity: 1,
      opensAt: at('2026-10-02T10:00:00Z'),
      closesAt: at('2026-10-04T18:00:00Z'),
      purchaseWindowHours: 72,
      earlyAccessHours: 0,
      earlyAccessPlatineHours: 0,
      priceMinor: 420_000,
      currency: 'EUR',
    },
    admin,
  );
  demo.releases.autumn = autumn.id;
  clock.set(at('2026-10-03T10:00:00Z'));
  await ctx.services.drops.enter(you.id, autumn.id, you.actor);
  clock.set(at('2026-10-04T18:01:00Z'));
  await ctx.services.drops.draw(autumn.id, admin);
  clock.set(at('2026-10-05T09:00:00Z'));
  await ctx.services.drops.setAddonChoices(you.id, autumn.id, [{ addonId: ids.cloth!, units: 1 }], you.actor);
  // You's orders: the morning's, reserved, given a CLOTH × 2 (removable, before packing).
  clock.set(new Date(NOCTURNE_NOW.getTime() - 60_000));
  const morning = await ctx.db.selectFrom('orders').select('id').where('account_id', '=', you.id).where('channel', '=', 'LIVE').where('status', '=', 'RESERVED').executeTakeFirstOrThrow();
  await ctx.services.orderAddons.addForAccount(you.id, morning.id, { addonId: ids.cloth!, units: 2 }, you.actor);
  // A MONOLITHE in blue and one in gold, sold by ORBES Client Services and paid, each holding its piece.
  const paid = async (model: 'blue' | 'gold', material: string) => {
    const request = await ctx.db.insertInto('shop_requests').values({ account_id: you.id, model_id: w.models[model]!, created_at: clock.now() }).returning('id').executeTakeFirstOrThrow();
    await ctx.services.salon.close(request.id, { note: 'A MONOLITHE, size 17.', outcome: 'ACCEPTED' }, admin);
    const order = await ctx.db.selectFrom('orders').select(['id', 'location_id']).where('shop_request_id', '=', request.id).executeTakeFirstOrThrow();
    const sku = (await ctx.db.selectFrom('skus').select('id').where('model_id', '=', w.models[model]!).where('size_label', '=', '17').executeTakeFirstOrThrow()).id;
    const piece = await ctx.services.issuance.issueProduct(
      { categoryCode: 'J', year: 2026, modelId: w.models[model]!, variant: '17', material, productionBatch: 'B-2026-10', productionDate: '2026-10-01', withClaimSecret: true },
      admin,
    );
    await countPiecesIn(ctx, { skuId: sku, locationId: order.location_id, productRefs: [piece.product.productId] }, admin);
    await ctx.services.orders.setTerms(order.id, { sizeLabel: '17', priceMinor: 420_000, currency: 'EUR' }, admin);
    await ctx.services.orders.transition(order.id, { to: 'PAID' }, admin);
    return order.id;
  };
  const gold = await paid('gold', '18K YELLOW GOLD');
  await ctx.services.orderAddons.addForAccount(you.id, gold, { addonId: ids.pouch!, units: 1 }, you.actor);
  await ctx.services.orders.setAddress(you.id, gold, { address: { name: 'Camille Laurent', address: '8 rue Saint-Honoré\n75001 Paris', country: 'FR', phone: '+33 6 12 34 56 78' }, save: false }, you.actor);
  await ctx.services.logistics.startPacking(gold, admin, null);
  clock.advance(MINUTE / 2);
  const blue = await paid('blue', '925 STERLING SILVER, BLUE LACQUER');
  await ctx.services.orderAddons.addForAccount(you.id, blue, { addonId: ids.extender!, units: 1 }, you.actor);
}

/** THE SET of the demo (plan MACRO M3 §5.4): its name, code, price, and its pieces' sizes by piece. */
export const NOCTURNE_SET = Object.freeze({ name: 'THE ORBITAL SET', code: 'ORBITAL-SET', priceMinor: 1_200_000, necklace: 'CONSTELLATION ORBITALE' });

/**
 * THE SET's stage (plan MACRO M3 §5.4, K44 T1 to T3), after the full story: a necklace of the longest name, CONSTELLATION
 * ORBITALE (42, 45, 50 cm); MONOLITHE in gold (16 to 18), HALO (50 to 56) and the necklace given their size types; THE
 * ORBITAL SET of the three, € 12 000. Its draws: of 2 September (you's set, delivered on 28 September, its HALO exchanged
 * for a 54 on 1 October), of 21 September (you's set, RESERVED since the 25th), the first of 1 October (drawn on the 4th:
 * PLATINE's in 18 · 54 · 45, ranked first by its tier; you's place held in 17 · 52 · 45; t.nguyen on the waiting list in 17 · 52 · 45), and the
 * October draw, open (6 sets: PLATINE reserved one in 17 · 56 · 45 in its early access, HALO 56 full since; s.girard
 * entered in 16 · 54 · 42; you's YOUR SIZES a bracelet of 17 and a ring of 52). Its LIVE RELEASES: of 7 October, at its
 * photograph's stage (it leads NOW), and of 20 October, not revealed yet.
 */
/**
 * THE ORBITAL SET (plan MACRO M3 §5.4, K44 T1): CONSTELLATION ORBITALE (a necklace, the longest name) added to the
 * collection, MONOLITHE in gold, HALO and the necklace given their sizes, the set of the three at € 12 000; you's YOUR
 * SIZES a bracelet of 17 and a ring of 52, the necklace unsaved. On 1 September (the set and LIVE stages' first act).
 */
async function orbitalSet(w: World): Promise<{ id: string }> {
  const { ctx, admin, clock, demo } = w;
  const db = ctx.db;
  const you = demo.accounts.you!;
  clock.set(at('2026-09-01T08:00:00Z'));
  const care = 'Store this piece on its own, away from humidity, perfume and cosmetics. Wipe it with a soft, dry cloth after wearing. ORBES Client Services offers inspection, cleaning and polishing.';
  const neck = (await ctx.services.catalog.createModel({ categoryCode: 'J', collectionId: w.collection, name: NOCTURNE_SET.necklace, type: 'NECKLACE', skuPrefix: 'CST-NK', defaultMaterial: '18K YELLOW GOLD', careInstructions: care }, admin)).id;
  await ctx.services.media.setModelImage(neck, { mime: 'image/webp', bytes: nocturnePhoto('blue') }, admin);
  w.models.necklace = neck;
  await giveSizes(db, w.models.gold!, ['16', '17', '18'], 'BRACELET');
  await giveSizes(db, w.models.halo!, ['50', '52', '54', '56'], 'RING');
  await giveSizes(db, neck, ['42', '45', '50'], 'NECKLACE');
  const set = await ctx.services.sets.create({ name: NOCTURNE_SET.name, code: NOCTURNE_SET.code, modelIds: [w.models.gold!, w.models.halo!, neck], basePriceMinor: NOCTURNE_SET.priceMinor, baseCurrency: 'EUR' }, admin);
  await ctx.services.sizes.set(you.id, { BRACELET: 17, RING: 52 }, you.actor);
  return set;
}

async function seedSet(w: World): Promise<void> {
  const { ctx, admin, clock, demo } = w;
  const db = ctx.db;
  const you = demo.accounts.you!;
  const newcomer = demo.accounts.newcomer!;
  const platine = demo.accounts.platine!;
  const sizer = demo.accounts.sizer!;
  const set = await orbitalSet(w);
  const location = await defaultLocationId(db);
  type Sizes = readonly [string, string, string];
  // A set's draw: its sizes per piece, published; each size's id by piece and label.
  const setDraw = async (o: { title: string; description: string; sizes: { piece: number; label: string; pieces: number }[]; opens: string; closes: string; early?: number }) => {
    clock.set(new Date(at(o.opens).getTime() - 2 * DAY));
    const created = await ctx.services.drops.create(
      {
        setId: set.id,
        title: o.title,
        description: o.description,
        sizes: o.sizes,
        opensAt: at(o.opens),
        closesAt: at(o.closes),
        purchaseWindowHours: 72,
        earlyAccessHours: o.early ?? 0,
        earlyAccessPlatineHours: o.early ?? 0,
        priceMinor: NOCTURNE_SET.priceMinor,
        currency: 'EUR',
      },
      admin,
    );
    const d = await ctx.services.drops.publish(created.id, admin);
    const choose = (labels: Sizes) => ({ sizes: labels.map((label, i) => ({ piece: i + 1, sizeId: d.sizes.find((z) => z.piece === i + 1 && z.label === label)!.id })) });
    return { id: d.id, choose };
  };
  const confirmFor = async (dropId: string, who: DemoAccount) => {
    const entry = await db.selectFrom('drop_entries').select('id').where('drop_id', '=', dropId).where('account_id', '=', who.id).executeTakeFirstOrThrow();
    await ctx.services.drops.confirm(dropId, entry.id, 'Confirmed by phone.', admin);
    return (await db.selectFrom('orders').select('id').where('drop_entry_id', '=', entry.id).orderBy('set_piece').execute()).map((o) => o.id);
  };
  const thirds = [
    { piece: 1, label: '16', pieces: 1 },
    { piece: 1, label: '17', pieces: 1 },
    { piece: 2, label: '52', pieces: 1 },
    { piece: 2, label: '54', pieces: 1 },
    { piece: 3, label: '45', pieces: 2 },
  ];

  // ── The draw of 2 September: you's set, paid, shipped, delivered on 28 September; its HALO exchanged for a 54 ──
  const sep = await setDraw({ title: 'THE ORBITAL SET, IN SEPTEMBER', description: 'Two sets of THE ORBITAL SET, drawn among the entries of September.', sizes: thirds, opens: '2026-09-02T10:00:00Z', closes: '2026-09-04T18:00:00Z' });
  clock.set(at('2026-09-03T10:00:00Z'));
  await ctx.services.drops.enter(you.id, sep.id, you.actor, sep.choose(['17', '52', '45']));
  clock.set(at('2026-09-04T18:01:00Z'));
  await ctx.services.drops.draw(sep.id, admin);
  clock.set(at('2026-09-05T09:00:00Z'));
  const delivered = await confirmFor(sep.id, you);
  await ctx.services.orders.setAddress(you.id, delivered[0]!, { address: { name: 'Camille Laurent', address: '14 rue de Turenne\n75004 Paris', country: 'FR', phone: '+33 6 12 34 56 78' }, save: false }, you.actor);
  clock.set(at('2026-09-20T10:00:00Z'));
  for (const id of delivered) await ctx.services.orders.transition(id, { to: 'PAID' }, admin);
  for (const id of delivered) {
    const held = await db.selectFrom('orders').select(['sku_id', 'location_id']).where('id', '=', id).executeTakeFirstOrThrow();
    await stockPieces(ctx, { skuId: held.sku_id!, locationId: held.location_id, count: 1, productionBatch: 'B-2026-09-SET', at: at('2026-09-24T09:00:00Z'), clock, forOrderIds: [id] }, admin);
  }
  clock.set(at('2026-09-26T10:00:00Z'));
  await packAndShip(ctx, delivered[0]!, { carrierId: await carrier(w, 'Colissimo'), trackingNumber: '6A10000000033', declaredValueMinor: NOCTURNE_SET.priceMinor }, admin);
  clock.set(at('2026-09-28T15:00:00Z'));
  for (const id of delivered) await ctx.services.orders.transition(id, { to: 'DELIVERED' }, admin);
  // HALO's size exchanged: asked on the 29th, the piece received and exchanged on 1 October.
  const halo54 = (await db.selectFrom('skus').select('id').where('model_id', '=', w.models.halo!).where('size_label', '=', '54').executeTakeFirstOrThrow()).id;
  clock.set(at('2026-09-29T09:00:00Z'));
  await stockPieces(ctx, { skuId: halo54, locationId: location, count: 1, productionBatch: 'B-2026-09-SET' }, admin);
  await ctx.services.orderCases.request(you.id, delivered[1]!, { kind: 'EXCHANGE', reason: 'SIZE', note: 'One size up, please.', sizeLabel: '54' }, you.actor);
  const exchange = await db.selectFrom('order_cases').select('id').where('order_id', '=', delivered[1]!).executeTakeFirstOrThrow();
  clock.set(at('2026-10-01T10:00:00Z'));
  await ctx.services.orderCases.receive(exchange.id, { pieceState: 'OK' }, admin, null);
  await ctx.services.orderCases.decide(exchange.id, { decision: 'EXCHANGE', pieceTo: 'RESTOCKED', note: 'Exchanged for a 54.' }, admin, { admin: true });

  // ── The draw of 21 September: you's set, RESERVED since the 25th ──
  const autumn = await setDraw({ title: 'THE ORBITAL SET, IN AUTUMN', description: 'Two sets of THE ORBITAL SET, drawn among the entries of the autumn.', sizes: thirds, opens: '2026-09-21T10:00:00Z', closes: '2026-09-24T18:00:00Z' });
  clock.set(at('2026-09-22T10:00:00Z'));
  await ctx.services.drops.enter(you.id, autumn.id, you.actor, autumn.choose(['17', '52', '45']));
  clock.set(at('2026-09-24T18:01:00Z'));
  await ctx.services.drops.draw(autumn.id, admin);
  clock.set(at('2026-09-25T09:00:00Z'));
  await confirmFor(autumn.id, you);

  // ── The first draw of October, drawn on the 4th: you's place held, t.nguyen on the waiting list ──
  const first = await setDraw({ title: 'THE ORBITAL SET, THE FIRST DRAW', description: 'Two sets of THE ORBITAL SET, each piece in its size.', sizes: [{ piece: 1, label: '17', pieces: 1 }, { piece: 1, label: '18', pieces: 1 }, ...thirds.slice(2)], opens: '2026-10-01T10:00:00Z', closes: '2026-10-04T18:00:00Z' });
  clock.set(at('2026-10-02T10:00:00Z'));
  await ctx.services.drops.enter(you.id, first.id, you.actor, first.choose(['17', '52', '45']));
  clock.set(at('2026-10-02T11:00:00Z'));
  await ctx.services.drops.enter(platine.id, first.id, platine.actor, first.choose(['18', '54', '45']));
  clock.set(at('2026-10-02T12:00:00Z'));
  await ctx.services.drops.enter(newcomer.id, first.id, newcomer.actor, first.choose(['17', '52', '45']));
  clock.set(at('2026-10-04T18:01:00Z'));
  await ctx.services.drops.draw(first.id, admin);
  demo.releases.setDrawn = first.id;

  // ── The October draw, open: PLATINE's set reserved in its early access (HALO 56 full since), s.girard entered ──
  const october = await setDraw({
    title: 'THE ORBITAL SET, THE OCTOBER DRAW',
    description: 'Six sets of THE ORBITAL SET: a bracelet, a ring and a necklace, each in its size, drawn among the entries of October.',
    sizes: [
      { piece: 1, label: '16', pieces: 2 },
      { piece: 1, label: '17', pieces: 3 },
      { piece: 1, label: '18', pieces: 1 },
      { piece: 2, label: '50', pieces: 1 },
      { piece: 2, label: '52', pieces: 2 },
      { piece: 2, label: '54', pieces: 2 },
      { piece: 2, label: '56', pieces: 1 },
      { piece: 3, label: '42', pieces: 2 },
      { piece: 3, label: '45', pieces: 3 },
      { piece: 3, label: '50', pieces: 1 },
    ],
    opens: '2026-10-03T10:00:00Z',
    closes: '2026-10-09T18:00:00Z',
    early: 24,
  });
  clock.set(at('2026-10-02T12:00:00Z'));
  await ctx.services.drops.reserve(platine.id, october.id, platine.actor, october.choose(['17', '56', '45']));
  clock.set(at('2026-10-04T09:00:00Z'));
  await ctx.services.drops.enter(sizer.id, october.id, sizer.actor, october.choose(['16', '54', '42']));
  demo.releases.setDraw = october.id;

  // ── Its LIVE RELEASES: of 7 October at its photograph's stage, of 20 October not revealed yet ──
  const liveSizes = [
    { piece: 1, label: '16', stock: 4 },
    { piece: 1, label: '17', stock: 4 },
    { piece: 1, label: '18', stock: 4 },
    { piece: 2, label: '52', stock: 6 },
    { piece: 2, label: '54', stock: 6 },
    { piece: 3, label: '45', stock: 12 },
  ];
  clock.set(at('2026-10-01T09:00:00Z'));
  const live = await ctx.services.liveConsole.create(
    {
      pace: { batch: 5000, minutes: 1 },
      holdMinutes: 0,
      setId: set.id,
      title: 'THE ORBITAL SET, RELEASED LIVE',
      description: 'THE ORBITAL SET released live: twelve sets, a bracelet, a ring and a necklace, each in its size.',
      opensAt: at('2026-10-07T19:00:00Z'),
      closesAt: at('2026-10-07T20:00:00Z'),
      minTier: 1,
      sizes: liveSizes,
      priceMinor: NOCTURNE_SET.priceMinor,
      currency: 'EUR',
      nameAt: at('2026-10-02T10:00:00Z'),
      photoAt: at('2026-10-03T10:00:00Z'),
    },
    admin,
  );
  await ctx.services.liveConsole.publish(live.id, {}, admin);
  demo.releases.setLive = live.id;
  clock.set(at('2026-10-04T09:00:00Z'));
  const veiled = await ctx.services.liveConsole.create(
    {
      pace: { batch: 5000, minutes: 1 },
      holdMinutes: 0,
      setId: set.id,
      title: 'THE ORBITAL SET, THE SECOND LIVE',
      opensAt: at('2026-10-20T19:00:00Z'),
      closesAt: at('2026-10-20T20:00:00Z'),
      minTier: 2,
      sizes: liveSizes,
      priceMinor: NOCTURNE_SET.priceMinor,
      currency: 'EUR',
      nameAt: at('2026-10-18T10:00:00Z'),
      photoAt: at('2026-10-19T10:00:00Z'),
    },
    admin,
  );
  await ctx.services.liveConsole.publish(veiled.id, {}, admin);
  demo.releases.setVeiled = veiled.id;
}

/**
 * THE SET's LIVE RELEASES in the room and live now (plan MACRO M3 §5.4, K44 T1 and T4; seedSetLive), on the full story:
 * THE ORBITAL SET (orbitalSet), five sets of a bracelet, a ring and a necklace each in its size (HALO 56 and MONOLITHE 16
 * one piece each), € 12 000, one per person. In its room (`setRoom`, T0 three minutes from now): you's YOUR SIZES
 * preselect the bracelet's 17 and the ring's 52, the necklace to choose; PLATINE entered with 18 · 54 · 42, ready; two
 * of the crowd in the room. Live now (`setNow`, T0 twenty minutes ago, the GIFT BOX offered with a set), a collector at
 * each step: a set confirmed with its GIFT BOX (17 · 56 · 45, the last 56), one sold out in HALO 56 behind it, a set held
 * (17 · 52 · 45) with the GIFT BOX chosen, one at its turn (16 · 54 · 42, the last 16) and one in the line behind it in 16;
 * 2 of the 5 sets left, 2 held.
 */
async function seedSetLive(w: World): Promise<void> {
  const { ctx, admin, clock, demo } = w;
  const live = ctx.services.live;
  const set = await orbitalSet(w);
  const sizes = [
    { piece: 1, label: '16', stock: 1 },
    { piece: 1, label: '17', stock: 2 },
    { piece: 1, label: '18', stock: 2 },
    { piece: 2, label: '52', stock: 2 },
    { piece: 2, label: '54', stock: 2 },
    { piece: 2, label: '56', stock: 1 },
    { piece: 3, label: '42', stock: 2 },
    { piece: 3, label: '45', stock: 3 },
  ];
  type Sizes = readonly [string, string, string];
  const chooser = (r: { sizes: readonly { id: string; label: string; piece?: number }[] }) => (labels: Sizes) => ({
    sizes: labels.map((label, i) => ({ piece: i + 1, sizeId: r.sizes.find((z) => z.piece === i + 1 && z.label === label)!.id })),
  });
  const description = 'THE ORBITAL SET released live: five sets, a bracelet, a ring and a necklace, each in its size.';

  // ── In its room: T0 three minutes from now ──
  clock.set(at('2026-10-04T09:00:00Z'));
  const room = await ctx.services.liveConsole.create(
    { pace: { batch: 5000, minutes: 1 }, holdMinutes: 0, setId: set.id, title: 'THE ORBITAL SET, RELEASED LIVE', description, opensAt: new Date(NOCTURNE_NOW.getTime() + 3 * MINUTE), closesAt: new Date(NOCTURNE_NOW.getTime() + 63 * MINUTE), roomOpensMinutes: 10, minTier: 1, sizes, priceMinor: NOCTURNE_SET.priceMinor, currency: 'EUR' },
    admin,
  );
  await ctx.services.liveConsole.publish(room.id, {}, admin);
  demo.releases.setRoom = room.id;
  const inRoom = chooser(room);
  clock.set(new Date(NOCTURNE_NOW.getTime() - 2 * MINUTE));
  const platine = demo.accounts.platine!;
  await live.enter(platine.id, room.id, inRoom(['18', '54', '42']), platine.actor);
  for (const key of ['crowd1', 'crowd2']) {
    const c = demo.accounts[key]!;
    await live.enter(c.id, room.id, inRoom(['17', '52', '45']), c.actor);
  }

  // ── Live now: T0 twenty minutes ago ──
  const t0 = new Date(NOCTURNE_NOW.getTime() - 20 * MINUTE);
  clock.set(at('2026-10-04T10:00:00Z'));
  const r = await ctx.services.liveConsole.create(
    {
      pace: { batch: 5000, minutes: 1 },
      holdMinutes: 0,
      setId: set.id,
      title: 'THE ORBITAL SET, LIVE NOW',
      description,
      opensAt: t0,
      closesAt: new Date(t0.getTime() + 2 * HOUR),
      minTier: 1,
      turnSeconds: 300,
      payMinutes: 10,
      sizes,
      priceMinor: NOCTURNE_SET.priceMinor,
      currency: 'EUR',
      addons: [{ label: 'GIFT BOX', line: 'One box for the three pieces', priceMinor: 9_000 }],
    },
    admin,
  );
  await ctx.services.liveConsole.publish(r.id, {}, admin);
  demo.releases.setNow = r.id;
  const choose = chooser(r);
  clock.set(t0);
  await live.advance(r.id);
  const step = async (ms: number) => {
    clock.advance(ms);
    await live.advance(r.id);
    await turnsNow(w, r.id);
  };
  const join = async (key: string, labels: Sizes) => {
    const a = await account(w, key, `${key}@example.com`, 1, w.models.blue);
    await live.enter(a.id, r.id, choose(labels), a.actor);
    await step(1_000);
    return a;
  };
  const secure = async (a: DemoAccount) => {
    const token = (await live.entry(a.id, r.id))?.turn?.token ?? null;
    if (!token) throw new Error(`no turn for ${a.email}`);
    await live.press(a.id, r.id, token);
    clock.advance(1_500);
    await live.secure(a.id, r.id, token, a.actor);
  };
  const gift = (await ctx.db.selectFrom('live_addons').select('id').where('drop_id', '=', r.id).executeTakeFirstOrThrow()).id;
  clock.set(new Date(NOCTURNE_NOW.getTime() - 3 * MINUTE));
  const buyer = await join('setBuyer', ['17', '56', '45']);
  await join('setSoldout', ['18', '56', '42']);
  await secure(buyer);
  await live.setAddons(buyer.id, r.id, [gift], buyer.actor);
  await live.confirm(buyer.id, r.id, buyer.actor);
  const held = await join('setSecured', ['17', '52', '45']);
  await join('setTurn', ['16', '54', '42']);
  await join('setLine', ['16', '52', '45']);
  await secure(held);
  await live.setAddons(held.id, r.id, [gift], held.actor);
  await step(1_000);
}

async function seedSizes(w: World, variant: 'full' | 'room'): Promise<void> {
  const { ctx, admin, clock } = w;
  clock.set(at('2026-10-05T12:00:00Z'));
  await ctx.services.sizes.setModelSizes(w.models.steel!, { sizeKind: 'BRACELET' }, admin);
  const since = { variant: '17', year: 2025, startedAt: at('2026-06-01T10:00:00Z') };
  if (variant === 'room') {
    const sized = await account(w, 'sized', 'v.lemaire@example.com');
    await holdPieces(ctx.db, sized.id, 1, w.models.steel!, since);
    await ctx.services.sizes.set(sized.id, { BRACELET: 17 }, sized.actor);
    return;
  }
  const care = 'Store this piece on its own, away from humidity, perfume and cosmetics. Wipe it with a soft, dry cloth after wearing. ORBES Client Services offers inspection, cleaning and polishing.';
  const halo = (await ctx.services.catalog.createModel({ categoryCode: 'J', collectionId: w.collection, name: 'HALO', type: 'RING', skuPrefix: 'HAL-RG', defaultMaterial: '18K YELLOW GOLD', careInstructions: care }, admin)).id;
  await ctx.services.media.setModelImage(halo, { mime: 'image/webp', bytes: nocturnePhoto('gold') }, admin);
  await ctx.services.catalog.updateModel(
    halo,
    {
      lookbook: 'RESERVED',
      slug: 'halo',
      story: 'One band of gold, closed without a seam: the ring of the house, worn alone.',
      specs: 'Metal: 18K yellow gold\nFinish: Polished',
      priceLabel: '€ 6 400',
      privateMinTier: 3,
    },
    admin,
  );
  w.models.halo = halo;
  w.demo.slugs.halo = 'halo';
  for (const size of ['50', '52', '54', '56']) await ensureSku(ctx.db, halo, size);
  await ctx.services.sizes.setModelSizes(halo, { sizeKind: 'RING' }, admin);
  const sized = await account(w, 'sized', 'v.lemaire@example.com');
  await holdPieces(ctx.db, sized.id, 10, w.models.steel!, since);
  await ctx.services.sizes.set(sized.id, { RING: 52, BRACELET: 17 }, sized.actor);
  const requested = await account(w, 'sizedRequested', 'o.benali@example.com');
  await holdPieces(ctx.db, requested.id, 10, w.models.steel!, since);
  await ctx.services.sizes.set(requested.id, { RING: 54 }, requested.actor);
  clock.set(at('2026-10-05T12:30:00Z'));
  await ctx.services.salon.request(requested.id, 'halo', null, requested.actor, '54');
  await account(w, 'sizer', 's.girard@example.com');
}

// ── The yearly care (plan NEXT-NINE, BP-19 T6) ─────────────────────────────

/** A prepaid label of the demo: the smallest PDF a carrier's site would give (a test file of this demo only). */
const DEMO_LABEL_PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

/**
 * The yearly care in the full demo, each step on a piece of a PLATINE account (its allowance: 1 piece a year), seeded
 * last so that no serial the story shows moves: the first voter's pieces may be cared for; PLATINE's first piece is
 * REQUESTED (its second, the year used); the second voter's has its prepaid label; the third voter's is on its way back
 * (IN SERVICE); and a fifth PLATINE account, its five pieces of 2025, has had its care done. Each piece's role is
 * `care…` in the demo's pieces.
 */
async function seedYearlyCare(w: World): Promise<void> {
  const { ctx, admin, clock, demo } = w;
  const serialsOf = async (accountId: string) =>
    (
      await ctx.db
        .selectFrom('ownership as o')
        .innerJoin('products as p', 'p.id', 'o.product_id')
        .select('p.product_id')
        .where('o.account_id', '=', accountId)
        .where('o.ended_at', 'is', null)
        .orderBy('p.year', 'desc')
        .orderBy('p.serial')
        .execute()
    ).map((r) => r.product_id);
  const to = { name: 'Ana Lindqvist', address: '8 rue de Sévigné\n75004 Paris\nFrance' };
  const ask = async (a: DemoAccount, serial: string, address = to) => (await ctx.services.care.request(a.id, serial, address, a.actor)).request!.id;
  const [platine, voter1, voter2, voter3] = ['platine', 'voter1', 'voter2', 'voter3'].map((k) => demo.accounts[k]!);
  clock.set(at('2026-06-01T10:00:00Z'));
  const cared = await account(w, 'cared', 'l.fontaine@example.com');
  await holdPieces(ctx.db, cared.id, 5, w.models.gold!, { variant: '18', year: 2025, startedAt: at('2026-06-01T10:00:00Z') });
  const [p1, p2] = await serialsOf(platine.id);
  demo.pieces.careAvailable = (await serialsOf(voter1.id))[0]!;
  demo.pieces.careRequested = p1!;
  demo.pieces.careUsed = p2!;
  demo.pieces.careLabel = (await serialsOf(voter2.id))[0]!;
  demo.pieces.careReturning = (await serialsOf(voter3.id))[0]!;
  demo.pieces.careDone = (await serialsOf(cared.id))[0]!;
  // PLATINE asks on 1 October.
  clock.set(at('2026-10-01T09:00:00Z'));
  await ask(platine, demo.pieces.careRequested, to);
  // The second voter's label, sent on 2 October.
  const label = await ask(voter2, demo.pieces.careLabel, { name: 'Owner Two', address: '3 place des Vosges\n75004 Paris' });
  clock.set(at('2026-10-02T10:00:00Z'));
  await ctx.services.care.sendLabel(label, { pdf: DEMO_LABEL_PDF, carrierId: await carrier(w, 'Colissimo'), tracking: '6A20261002001' }, admin);
  // The third voter's piece: its label on 1 October, at the atelier on 3 October, shipped back on 5 October.
  clock.set(at('2026-09-28T09:00:00Z'));
  const back = await ask(voter3, demo.pieces.careReturning, { name: 'Owner Three', address: '21 rue des Archives\n75004 Paris' });
  clock.set(at('2026-10-01T10:00:00Z'));
  await ctx.services.care.sendLabel(back, { pdf: DEMO_LABEL_PDF, carrierId: await carrier(w, 'Colissimo'), tracking: '6A20261001001' }, admin);
  clock.set(at('2026-10-03T10:00:00Z'));
  await ctx.services.care.receive(back, admin);
  clock.set(at('2026-10-05T09:00:00Z'));
  await ctx.services.care.shipBack(back, { carrierId: await carrier(w, 'Chronopost'), tracking: 'XY20261005001FR' }, admin);
  // The fifth account's care, asked for in September and done on 25 September.
  clock.set(at('2026-09-10T09:00:00Z'));
  const done = await ask(cared, demo.pieces.careDone, { name: 'Louise Fontaine', address: '5 rue Charlot\n75003 Paris' });
  clock.set(at('2026-09-11T09:00:00Z'));
  await ctx.services.care.sendLabel(done, { pdf: DEMO_LABEL_PDF, carrierId: await carrier(w, 'Colissimo'), tracking: '6A20260911001' }, admin);
  clock.set(at('2026-09-15T09:00:00Z'));
  await ctx.services.care.receive(done, admin);
  clock.set(at('2026-09-24T09:00:00Z'));
  await ctx.services.care.shipBack(done, { carrierId: await carrier(w, 'Colissimo'), tracking: '6A20260924001' }, admin);
  clock.set(at('2026-09-25T09:00:00Z'));
  await ctx.services.care.complete(done, { notes: 'Inspected, cleaned and polished.' }, admin);
}

/**
 * The stage care-used (plan ORBES CARE, step 1.4): THE PROGRAM's PLATINE PRIVATE CARE set to 1 piece a year after the
 * full story (PLATINE's default is now every piece), so the PLATINE account, its first piece REQUESTED, reads the
 * year's PRIVATE CARE used on its second.
 */
async function seedCareUsed(w: World): Promise<void> {
  const { ctx, admin } = w;
  await ctx.services.clubProgram.update({ ...(await ctx.services.clubProgram.read()), carePiecesPlatine: 1 }, admin);
}

/**
 * The stage gallery (desktop, D11), after the full story: MONOLITHE in steel's gallery, the demo's own photographs of
 * the bracelet in gold and in blue added after its cover (its steel photograph), as the console adds them (POST
 * /api/admin/models/:id/gallery). Test support only: for the desktop states and the owner's look.
 */
async function seedGallery(w: World): Promise<void> {
  const { ctx, admin, clock } = w;
  clock.set(at('2026-10-04T09:20:00Z'));
  for (const kind of ['gold', 'blue'] as const) await ctx.services.media.addModelGalleryImage(w.models.steel!, { mime: 'image/webp', bytes: nocturnePhoto(kind) }, admin);
}

/**
 * The stage orbes-care (plan ORBES CARE, step 5.1), after the full story: what a piece's ORBES CARE tab shows, each case
 * on a collector of its own. ATLAS, a cardholder of leather goods, is a 2-year model (answer 10: manufacturing defects
 * only) beside the jewelry, Lifetime. The PLATINE account's third piece is sold with its lifetime warranty; your piece
 * of MONOLITHE in steel is shared by a certificate. Each claim is opened from its collector's conversation, its label sent, the piece received and
 * decided by ORBES Client Services (answer 11), as the console does: a label sent on 2 October; a piece replaced and
 * its replacement shipped on 26 September; a piece whose free replacement was used, then a 30 % credit on its
 * replacement (YOUR TIER, IN USE: WARRANTY CREDIT); a claim refused after inspection, the piece returned; a 2-year piece
 * repaired and returned.
 */
async function seedOrbesCare(w: World): Promise<void> {
  const { ctx, admin, clock, demo } = w;
  const colissimo = await carrier(w, 'Colissimo');
  const chronopost = await carrier(w, 'Chronopost');
  // ATLAS, the 2-year model (Leather Goods: 24 months, the terms' 2 years).
  clock.set(at('2026-08-31T10:00:00Z'));
  if (!(await ctx.categories.getByCode('L'))) await ctx.categories.create({ code: 'L', name: 'Leather Goods', warrantyMonths: 24 }, SYSTEM_ACTOR);
  w.models.atlas = (
    await ctx.services.catalog.createModel(
      {
        categoryCode: 'L',
        collectionId: null,
        name: 'ATLAS',
        type: 'CARDHOLDER',
        skuPrefix: 'ATL-CH',
        defaultMaterial: 'FULL-GRAIN CALF LEATHER',
        careInstructions: 'Keep away from water, heat and direct sunlight. Nourish twice a year with a neutral leather balm. Store it in its dust bag.',
        warrantyLifetime: false,
      },
      admin,
    )
  ).id;
  // The collectors, each with a piece bought on 2 September and registered the next day, and a word in MESSAGES.
  const collector = async (key: string, email: string, role: string, model: string, words: string, opts: { variant?: string | null; category?: string; material?: string } = {}) => {
    clock.set(at('2026-09-02T10:00:00Z'));
    const who = demo.accounts[key] ?? (await account(w, key, email));
    const piece = await issue(w, role, model, { sold: '2026-09-02', ...opts });
    clock.set(at('2026-09-03T18:00:00Z'));
    await register(w, who, piece);
    return { who, piece, words };
  };
  const write = async (c: { who: DemoAccount; piece: { productId: string }; words: string }, when: string) => {
    clock.set(at(when));
    await ctx.services.messages.write(c.who.id, { body: c.words, context: { kind: 'PIECE', id: c.piece.productId } }, c.who.actor);
    return (await ctx.db.selectFrom('client_conversations').select('id').where('account_id', '=', c.who.id).executeTakeFirstOrThrow()).id;
  };
  const claim = async (c: { who: DemoAccount; piece: { productId: string }; words: string }, opened: string) => {
    const conversationId = await write(c, opened);
    return (await ctx.services.warrantyClaims.open({ conversationId, productId: c.piece.productId, basis: 'WARRANTY' }, admin)).id;
  };
  const label = async (id: string, when: string, tracking: string) => {
    clock.set(at(when));
    await ctx.services.warrantyClaims.label(id, { pdf: DEMO_LABEL_PDF, carrierId: colissimo, tracking }, admin);
  };
  const receive = async (id: string, when: string) => {
    clock.set(at(when));
    await ctx.services.warrantyClaims.receive(id, admin);
  };
  const decide = async (id: string, when: string, input: DecideClaimInput) => {
    clock.set(at(when));
    await ctx.services.warrantyClaims.decide(id, input, admin);
  };
  const ship = async (id: string, when: string, tracking: string, replacementProductId?: string) => {
    clock.set(at(when));
    await ctx.services.warrantyClaims.ship(id, { carrierId: chronopost, tracking, ...(replacementProductId ? { replacementProductId } : {}) }, admin);
  };

  // The PLATINE account's third piece, sold with its lifetime warranty (pieces-orbes-care).
  const platine = demo.accounts.platine!;
  const third = (
    await ctx.db
      .selectFrom('ownership as o')
      .innerJoin('products as p', 'p.id', 'o.product_id')
      .select(['p.id', 'p.product_id'])
      .where('o.account_id', '=', platine.id)
      .where('o.ended_at', 'is', null)
      .orderBy('p.year', 'desc')
      .orderBy('p.serial')
      .execute()
  )[2]!;
  clock.set(at('2026-09-04T10:00:00Z'));
  await ctx.services.warranty.activate(third.id, { purchaseDate: '2026-06-01', retailer: 'ORBES PARIS', country: 'FR' }, admin);
  demo.pieces.careLifetime = third.product_id;
  // The certificate of your piece of MONOLITHE in steel, Lifetime, shared on 4 October (certificate-lifetime).
  clock.set(at('2026-10-04T10:00:00Z'));
  const you = demo.accounts.you!;
  demo.links.certificateLifetime = (await ctx.services.ownershipCertificates.create(you.id, demo.pieces.yours!, { validDays: 30 }, you.actor)).token;

  // A collector of leather goods: a 2-year piece without a claim, and another repaired under its warranty.
  await collector('leather', 'r.duval@example.com', 'twoYears', 'atlas', '', { variant: null, category: 'L', material: 'FULL-GRAIN CALF LEATHER' });
  const repaired = await collector('leather', 'r.duval@example.com', 'claimRepaired', 'atlas', 'The stitching of my cardholder has come undone along one edge.', { variant: null, category: 'L', material: 'FULL-GRAIN CALF LEATHER' });
  const rep = await claim(repaired, '2026-09-14T08:30:00Z');
  await label(rep, '2026-09-14T15:00:00Z', '6A20260914101');
  await receive(rep, '2026-09-17T10:00:00Z');
  await decide(rep, '2026-09-21T10:00:00Z', { outcome: 'REPAIR' });
  await ship(rep, '2026-09-24T10:00:00Z', 'XY20260924101FR');

  // Its prepaid label sent on 2 October (pieces-claim-label).
  const waiting = await collector('claimant1', 'c.dubois@example.com', 'claimLabel', 'gold', 'One of the links of my bracelet has broken.');
  const lab = await claim(waiting, '2026-10-02T08:30:00Z');
  await label(lab, '2026-10-02T15:00:00Z', '6A20261002101');

  // Replaced: the same piece, new, shipped on 26 September (pieces-claim-replaced).
  const replaced = await collector('claimant2', 'p.girard@example.com', 'claimReplaced', 'gold', 'The gold of my bracelet has faded on one side.');
  const rpl = await claim(replaced, '2026-09-18T08:30:00Z');
  await label(rpl, '2026-09-18T15:00:00Z', '6A20260918101');
  await receive(rpl, '2026-09-22T10:00:00Z');
  clock.set(at('2026-09-23T09:00:00Z'));
  const fresh = await issue(w, 'claimReplacement', 'gold', { sold: false });
  await decide(rpl, '2026-09-24T10:00:00Z', { outcome: 'REPLACEMENT', replacementProductId: fresh.productId });
  await ship(rpl, '2026-09-26T10:00:00Z', 'XY20260926101FR');

  // After the free replacement (its replacement registered), a further accepted claim: a 30 % credit of the piece's
  // value, valid 12 months (pieces-claim-part-credit, tier-warranty-credit).
  const credited = await collector('claimant3', 's.renard@example.com', 'claimFirst', 'gold', 'My bracelet broke when it fell.');
  const first = await claim(credited, '2026-09-07T08:30:00Z');
  await label(first, '2026-09-07T15:00:00Z', '6A20260907101');
  await receive(first, '2026-09-09T10:00:00Z');
  clock.set(at('2026-09-09T11:00:00Z'));
  const second = await issue(w, 'claimPartCredit', 'gold', { sold: false });
  await decide(first, '2026-09-10T10:00:00Z', { outcome: 'REPLACEMENT', replacementProductId: second.productId });
  await ship(first, '2026-09-11T10:00:00Z', 'XY20260911101FR');
  clock.set(at('2026-09-13T18:00:00Z'));
  await register(w, credited.who, second);
  const again = await claim({ who: credited.who, piece: second, words: 'The new bracelet broke too, caught in a door.' }, '2026-09-25T08:30:00Z');
  await label(again, '2026-09-25T15:00:00Z', '6A20260925101');
  await receive(again, '2026-09-28T10:00:00Z');
  await decide(again, '2026-09-29T10:00:00Z', { outcome: 'PART_CREDIT', ...(await valueUnknown(w, second.uuid)) });
  await ship(again, '2026-10-01T10:00:00Z', 'XY20261001101FR');

  // Refused after inspection (a scratch, not covered), the piece returned (pieces-claim-refused).
  const refused = await collector('claimant4', 'n.petit@example.com', 'claimRefused', 'gold', 'My bracelet is scratched on its top.');
  const ref = await claim(refused, '2026-09-21T08:30:00Z');
  await label(ref, '2026-09-21T15:00:00Z', '6A20260921101');
  await receive(ref, '2026-09-24T10:00:00Z');
  await decide(ref, '2026-09-25T10:00:00Z', { outcome: 'REFUSED', refusalReason: 'SCRATCHED' });
  await ship(ref, '2026-09-28T10:00:00Z', 'XY20260928101FR');
}

/** The value of a piece the server finds none for (no order, no base price) is entered by staff: € 3 900 here. */
async function valueUnknown(w: World, productUuid: string): Promise<{ valueMinor?: number }> {
  const sheet = (await w.ctx.db.selectFrom('warranty_claims').select('id').where('product_id', '=', productUuid).where('status', '=', 'RECEIVED').executeTakeFirstOrThrow()).id;
  const known = (await w.ctx.services.warrantyClaims.sheet(sheet)).decision.value;
  return known ? {} : { valueMinor: 390_000 };
}

// ── The extreme content (fidelity rule 5) and the empty states ─────────────

/**
 * The stress case: a 24-character model name without a photograph, a 14-character free-text field, two pieces to scan
 * of it with a Size of 14 characters, an account of 10 pieces and 4 orders (a price in USD, a long amount, a long tracking
 * number), 8 posts, a LIVE RELEASE under an hour away with its room open and a long host message, another more than 9
 * days away.
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
  // Six pieces registered, the first of the long model with a 14-character field.
  clock.set(at('2026-09-02T10:00:00Z'));
  const roles = ['long', 'steel', 'gold', 'blue', 'steel', 'gold'];
  for (const [i, model] of roles.entries()) {
    const p = await issue(w, `piece${i + 1}`, model, { serial: 300 + i, sold: '2026-09-02', ...(i === 0 ? { variant: 'BRUSHED COBALT', material: '925 STERLING SILVER, BRUSHED AND POLISHED' } : {}) });
    await register(w, you, p);
  }
  // Four more, so that the account holds ten: PALLADIUM, the highest tier (plan NEXT-NINE, BP-19 T1). They carry serials of
  // 2025 and are held from the account's first day, before the six: the serials of 2026 the boards show, the long model
  // first, stay as they were.
  await holdPieces(ctx.db, you.id, 4, w.models.steel!, { variant: '17', year: 2025, startedAt: at('2026-09-01T09:00:00Z') });
  // Two pieces to scan of the 24-character model in its 14-character variant, each with a Size of 14 characters (fidelity
  // rule 5 on a result, C9, and on the ceremony of a first registration, C36): unregistered, the second one registered
  // by a capture.
  for (const role of ['stressFirst', 'stressCeremony']) await issue(w, role, 'cobalt', { variant: '17 · WIDE BAND', material: '925 STERLING SILVER, BRUSHED COBALT', sold: '2026-09-02' });
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
    await ctx.services.orders.setBuyer(order, { name: 'Camille Laurent', address: '14 rue de Turenne\n75004 Paris\nFrance', country: 'FR' }, admin);
    if (i === 1) {
      await ctx.services.orders.transition(order, { to: 'PAID' }, admin);
      const held = await ctx.db.selectFrom('orders').select(['sku_id', 'location_id']).where('id', '=', order).executeTakeFirstOrThrow();
      await stockPieces(ctx, { skuId: held.sku_id!, locationId: held.location_id, count: 1, productionBatch: 'B-2026-09-STRESS', forOrderIds: [order] }, admin);
      await packAndShip(ctx, order, { carrierId: await carrier(w, 'Chronopost'), trackingNumber: 'XY48291563748201937465012FR', declaredValueMinor: 640_000 }, admin);
    }
  }
  // THE PROGRAM (plan NEXT-NINE, BP-19 T5): the welcome gift of PLATINE and PALLADIUM, a model of one size with one piece
  // counted in stock, chosen after the four orders (none of them carries a gift); and the PALLADIUM credit (€ 100, made
  // with the first order: the account reached PALLADIUM before it) in use on the last order, RESERVED at € 4 800.
  clock.set(at('2026-09-14T10:00:00Z'));
  const charm = await ctx.services.catalog.createModel({ categoryCode: 'J', collectionId: null, name: 'ORBITAL CHARM', type: 'PENDANT', skuPrefix: 'ORB-CH', defaultMaterial: '925 STERLING SILVER' }, admin);
  // Its one piece in stock, counted in (plan NEXT LOT step 5.12: a piece behind the count, for the packing scan).
  await stockPieces(ctx, { skuId: await ensureSku(ctx.db, charm.id, null), locationId: (await ctx.db.selectFrom('stock_locations').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id, count: 1 }, admin);
  const program = await ctx.services.clubProgram.read();
  await ctx.services.clubProgram.update({ ...program, giftPlatineModelId: charm.id, giftPalladiumModelId: charm.id }, admin);
  const last = await ctx.db.selectFrom('orders').select('id').where('account_id', '=', you.id).where('channel', '=', 'SALON').where('status', '=', 'RESERVED').where('price_minor', '=', 480_000).executeTakeFirstOrThrow();
  await ctx.services.orders.applyCredit(last.id, 10_000, admin);
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
  await seedModelReleases(w);
}

/**
 * Plan NEXT-NINE, BP-34 (the pairs stage): MONOLITHE ARCHITECTURALE shown in ORBITAL (public, no photograph yet), then the
 * console picks MONOLITHE's PAIRS WELL WITH: ZENITH (THE PRIVATE SALON, from TITANE), then MONOLITHE ARCHITECTURALE.
 */
async function seedPairs(w: World): Promise<void> {
  const { ctx, admin, clock } = w;
  clock.set(at('2026-10-04T09:00:00Z'));
  const long = await ctx.services.catalog.createModel({ categoryCode: 'J', collectionId: w.collection, name: 'MONOLITHE ARCHITECTURALE', type: 'ARTICULATED BRACELET', skuPrefix: 'MNL-AR', defaultMaterial: '925 STERLING SILVER, BRUSHED AND POLISHED', careInstructions: null }, admin);
  await ctx.services.catalog.updateModel(long.id, { lookbook: 'PUBLIC', slug: 'monolithe-architecturale', story: 'A model without a photograph yet.' }, admin);
  w.models.long = long.id;
  w.demo.slugs.long = 'monolithe-architecturale';
  clock.set(at('2026-10-04T09:10:00Z'));
  await ctx.services.catalog.setPairs(w.models.steel!, [w.models.zenith!, long.id], admin);
}

/**
 * Plan NEXT-NINE, CO-01: nine past releases of MONOLITHE ARCHITECTURALE in September, seeded last so nothing of the
 * extreme content moves: six draws drawn and three LIVE RELEASES closed at their time, in its two finishes, nobody
 * entered. Its sheet lists the six newest under THE RELEASES OF THIS MODEL, then SHOW ALL 9 RELEASES.
 */
async function seedModelReleases(w: World): Promise<void> {
  const { ctx, admin, clock } = w;
  const releases: { day: number; kind: 'DRAW' | 'LIVE'; model: 'long' | 'cobalt' }[] = [
    { day: 3, kind: 'DRAW', model: 'long' },
    { day: 6, kind: 'DRAW', model: 'cobalt' },
    { day: 9, kind: 'LIVE', model: 'long' },
    { day: 12, kind: 'DRAW', model: 'cobalt' },
    { day: 15, kind: 'DRAW', model: 'long' },
    { day: 18, kind: 'LIVE', model: 'long' },
    { day: 21, kind: 'DRAW', model: 'cobalt' },
    { day: 24, kind: 'DRAW', model: 'long' },
    { day: 27, kind: 'LIVE', model: 'cobalt' },
  ];
  for (const r of releases) {
    const opens = at(`2026-09-${String(r.day).padStart(2, '0')}T10:00:00Z`);
    clock.set(new Date(opens.getTime() - 2 * DAY));
    if (r.kind === 'DRAW') {
      const d = await poolDraw(ctx.services.drops, ctx.db, { modelId: w.models[r.model]!, title: 'MONOLITHE ARCHITECTURALE, A DRAW OF SEPTEMBER', quantity: 4, opensAt: opens, closesAt: new Date(opens.getTime() + 8 * HOUR), earlyAccessHours: 0 }, admin);
      clock.set(new Date(opens.getTime() + 8 * HOUR + MINUTE));
      await ctx.services.drops.draw(d.id, admin);
    } else {
      const l = await createLiveRelease(w.f, { modelId: w.models[r.model]!, opensAt: opens, minTier: 1, sizes: [{ label: '17', stock: 12 }], quantityLine: '12 PIECES', priceMinor: 12_540_000 });
      await titled(w, l.id, 'MONOLITHE ARCHITECTURALE, LIVE');
      clock.set(new Date(opens.getTime() + 2 * HOUR));
      await ctx.services.live.advance(l.id);
    }
  }
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
