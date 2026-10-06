/**
 * Demo dataset: a small, believable ORBES maison: five categories, a
 * catalogue of models, 47 products across the lifecycle, eight customer
 * accounts, the points of sale where the pieces were sold, warranties,
 * service records, transfers, incidents and scan histories, with anomalies
 * that came out of real anomaly scoring and two customers' reports on scans
 * that were not authentic (open cases).
 *
 * Everything goes through the real services (issuance, warranty, ownership,
 * lifecycle, verification, anomaly): there are no hand-written rows, so
 * signatures, genomes, audit chain, status history and anomaly findings are
 * exactly what production would produce. Each scan's verification state is
 * asserted while seeding, so a behaviour change in a service fails the seed
 * loudly instead of producing a silently different demo.
 *
 * Time. Stories are timelines of steps with absolute dates (the catalogue's
 * life in 2025–2026) and dates relative to `now` (recent activity: the
 * dashboard's 24 h / 7 d counters, the open anomalies, a pending transfer, the
 * piece waiting for its first registration). All steps of all products are
 * merged and run in chronological order on a clock the caller hands over, so
 * the audit log, status histories and scan events read like real history.
 * At the end, the complete days are counted in the daily scan statistics, as
 * housekeeping does every night (services/scan-stats.ts): the console's
 * Analytics view opens on the demo's history.
 *
 * Highlights
 *   O26-J-00184  MONOLITHE RING · 925 STERLING SILVER · created 2026, sold
 *                (ACTIVATED) and unregistered: AUTHENTIC — FIRST REGISTRATION
 *   O26-J-00194  HORIZON CUFF, impossible travel (Tokyo → Paris → New York in
 *                95 minutes): an OPEN HIGH anomaly; the New York scanner says
 *                where they saw it, an OPEN case in the console's Cases queue
 *   O26-J-00193  ECLIPSE PENDANT reported stolen, then scanned by a stranger:
 *                SUSPICIOUS ACTIVITY and an OPEN anomaly; the stranger says
 *                where it was offered, an OPEN case
 *   O26-L-00018  APOGEE BELT in stock in Milan (ISSUED), its code scanned in
 *                Lyon by a stranger: AUTHENTIC, and an OPEN UNSOLD PIECE
 *                SCANNED finding (S-07)
 *
 * The club's tiers (TITANE from 1 piece held, PLATINE from 5, PALLADIUM from
 * 10: services/club.ts CLUB_TIER_THRESHOLDS): Camille Martin holds ten pieces
 * (PALLADIUM), Lucas Weber five (PLATINE), every other account fewer (TITANE).
 *
 * Demo only: emails are @example.com, passwords are random unless supplied,
 * and `seedDemo` refuses a production configuration.
 */
import { randomBytes } from 'node:crypto';
import type { AppContext } from '../../context.js';
import { pseudonymize } from '../../http/client.js';
import { REGISTRABLE_STATUSES } from '../../services/ownership.js';
import { aggregateScanStats } from '../../services/scan-stats.js';
import type { VerifyOutcome } from '../../services/verification.js';
import { utcDate } from '../../services/warranty.js';
import { noopLogger, type Actor, type Logger } from '../../types.js';
import type { Db } from '../connection.js';
import type { AnomalyStatus, ProductStatus, ReportChannel, ServiceType, VerificationState } from '../schema.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** The piece the demo opens with: ACTIVATED, never registered. */
export const DEMO_FIRST_REGISTRATION_PRODUCT_ID = 'O26-J-00184';

/** Absolute story dates end in early July 2026; recent activity needs `now` at least this late. */
export const DEMO_MIN_NOW = new Date('2026-08-01T00:00:00.000Z');

/** First step of the timeline (catalogue creation). Seed clocks should start here. */
export const DEMO_TIMELINE_START = new Date('2025-01-06T08:00:00.000Z');

/** Who the demo's back-office actions are attributed to in the audit log. */
export const DEMO_SEED_ACTOR: Readonly<Actor> = Object.freeze({ type: 'system' as const, id: 'demo-seed' });

export class DemoSeedError extends Error {
  override readonly name = 'DemoSeedError';
}

// ── Catalogue ──────────────────────────────────────────────────────────────

export interface DemoCategory {
  code: string;
  /** Immutable 5-bit index the category must have (packed into every identity). */
  index: number;
  name: string;
  warrantyMonths: number;
}

export const DEMO_CATEGORIES: readonly DemoCategory[] = Object.freeze([
  { code: 'J', index: 1, name: 'Jewelry', warrantyMonths: 24 },
  { code: 'L', index: 2, name: 'Leather Goods', warrantyMonths: 24 },
  { code: 'W', index: 3, name: 'Watches', warrantyMonths: 60 },
  { code: 'F', index: 4, name: 'Fragrance', warrantyMonths: 12 },
  { code: 'A', index: 5, name: 'Accessories', warrantyMonths: 24 },
]);

export const DEMO_COLLECTIONS = Object.freeze(['ORBITAL', 'MERIDIAN', 'ZENITH', 'NOCTURNE', 'EQUINOX'] as const);
type CollectionName = (typeof DEMO_COLLECTIONS)[number];

const CARE = {
  silver:
    'Wipe with a soft, dry cloth after wear. Store on its own in the ORBES pouch to avoid scratches. Keep away from perfume, chlorine and salt water.',
  gold: 'Clean with lukewarm soapy water and a soft brush, then dry with a lint-free cloth. Store separately. Bring it to an ORBES atelier for polishing.',
  leather:
    'Keep away from water, heat and direct sunlight. Nourish twice a year with a neutral leather balm. Store stuffed, in its dust bag.',
  watch: 'Water resistant to 50 m with the crown pushed in. Wind fully once a month if not worn. Service the movement every five years.',
  fragrance: 'Store upright, away from light and heat. Apply to pulse points from 15 cm.',
} as const;

export interface DemoModel {
  key: ModelKey;
  category: string;
  collection: CollectionName;
  name: string;
  type: string;
  skuPrefix: string;
  defaultMaterial: string;
  care: string;
}

type ModelKey =
  | 'MONOLITHE'
  | 'ORBITE'
  | 'ECLIPSE'
  | 'HORIZON'
  | 'ATLAS'
  | 'PERIGEE'
  | 'APOGEE'
  | 'SOLSTICE'
  | 'NOCTURNE'
  | 'EQUINOX'
  | 'PARALLAX';

export const DEMO_MODELS: readonly DemoModel[] = Object.freeze([
  { key: 'MONOLITHE', category: 'J', collection: 'ORBITAL', name: 'MONOLITHE', type: 'RING', skuPrefix: 'MNL-RG', defaultMaterial: '925 STERLING SILVER', care: CARE.silver },
  { key: 'ORBITE', category: 'J', collection: 'ORBITAL', name: 'ORBITE', type: 'SIGNET RING', skuPrefix: 'ORB-SG', defaultMaterial: '18K YELLOW GOLD', care: CARE.gold },
  { key: 'ECLIPSE', category: 'J', collection: 'ORBITAL', name: 'ECLIPSE', type: 'PENDANT', skuPrefix: 'ECL-PD', defaultMaterial: '925 STERLING SILVER', care: CARE.silver },
  { key: 'HORIZON', category: 'J', collection: 'ORBITAL', name: 'HORIZON', type: 'CUFF', skuPrefix: 'HRZ-CF', defaultMaterial: '925 STERLING SILVER', care: CARE.silver },
  { key: 'ATLAS', category: 'L', collection: 'MERIDIAN', name: 'ATLAS', type: 'CARDHOLDER', skuPrefix: 'ATL-CH', defaultMaterial: 'FULL-GRAIN CALF LEATHER', care: CARE.leather },
  { key: 'PERIGEE', category: 'L', collection: 'MERIDIAN', name: 'PERIGEE', type: 'WALLET', skuPrefix: 'PRG-WL', defaultMaterial: 'FULL-GRAIN CALF LEATHER', care: CARE.leather },
  { key: 'APOGEE', category: 'L', collection: 'MERIDIAN', name: 'APOGEE', type: 'BELT', skuPrefix: 'APG-BT', defaultMaterial: 'FULL-GRAIN CALF LEATHER', care: CARE.leather },
  { key: 'SOLSTICE', category: 'W', collection: 'ZENITH', name: 'SOLSTICE', type: 'AUTOMATIC WATCH', skuPrefix: 'SLS-AW', defaultMaterial: '316L STAINLESS STEEL', care: CARE.watch },
  { key: 'NOCTURNE', category: 'F', collection: 'NOCTURNE', name: 'NOCTURNE', type: 'EAU DE PARFUM 100 ML', skuPrefix: 'NCT-EDP', defaultMaterial: 'GLASS FLACON, BRUSHED STEEL CAP', care: CARE.fragrance },
  { key: 'EQUINOX', category: 'A', collection: 'EQUINOX', name: 'EQUINOX', type: 'KEY RING', skuPrefix: 'EQX-KR', defaultMaterial: '925 STERLING SILVER', care: CARE.silver },
  { key: 'PARALLAX', category: 'A', collection: 'EQUINOX', name: 'PARALLAX', type: 'CUFFLINKS', skuPrefix: 'PLX-CL', defaultMaterial: '925 STERLING SILVER', care: CARE.silver },
]);

// ── Places, boutiques, people ──────────────────────────────────────────────

/** Coarse scan location (1 decimal, as GeoResolver stores it). */
interface Place {
  country: string;
  lat: number;
  lon: number;
}

const PLACES = {
  PARIS: { country: 'FR', lat: 48.9, lon: 2.3 },
  LYON: { country: 'FR', lat: 45.8, lon: 4.8 },
  LONDON: { country: 'GB', lat: 51.5, lon: -0.1 },
  MILAN: { country: 'IT', lat: 45.5, lon: 9.2 },
  BERLIN: { country: 'DE', lat: 52.5, lon: 13.4 },
  MADRID: { country: 'ES', lat: 40.4, lon: -3.7 },
  BARCELONA: { country: 'ES', lat: 41.4, lon: 2.2 },
  TOKYO: { country: 'JP', lat: 35.7, lon: 139.7 },
  DUBAI: { country: 'AE', lat: 25.2, lon: 55.3 },
  NEW_YORK: { country: 'US', lat: 40.7, lon: -74 },
} as const satisfies Record<string, Place>;
type PlaceKey = keyof typeof PLACES;

const BOUTIQUES = {
  PARIS: { retailer: 'ORBES PARIS — SAINT-HONORÉ', place: 'PARIS' },
  LONDON: { retailer: 'ORBES LONDON — MOUNT STREET', place: 'LONDON' },
  MILAN: { retailer: 'ORBES MILANO — VIA DELLA SPIGA', place: 'MILAN' },
  TOKYO: { retailer: 'ORBES TOKYO — GINZA', place: 'TOKYO' },
  DUBAI: { retailer: 'ORBES DUBAI — THE DUBAI MALL', place: 'DUBAI' },
  ONLINE_DE: { retailer: 'ORBES.COM — ONLINE BOUTIQUE', place: 'BERLIN' },
  ONLINE_ES: { retailer: 'ORBES.COM — ONLINE BOUTIQUE', place: 'MADRID' },
} as const satisfies Record<string, { retailer: string; place: PlaceKey }>;
type BoutiqueKey = keyof typeof BOUTIQUES;

/** The register of points of sale (A-08): one per boutique, the online shop once (its country is the buyer's). */
const POINTS_OF_SALE: readonly { name: string; city: string | null; country: string | null }[] = [
  { name: BOUTIQUES.PARIS.retailer, city: 'Paris', country: 'FR' },
  { name: BOUTIQUES.LONDON.retailer, city: 'London', country: 'GB' },
  { name: BOUTIQUES.MILAN.retailer, city: 'Milan', country: 'IT' },
  { name: BOUTIQUES.TOKYO.retailer, city: 'Tokyo', country: 'JP' },
  { name: BOUTIQUES.DUBAI.retailer, city: 'Dubai', country: 'AE' },
  { name: BOUTIQUES.ONLINE_DE.retailer, city: null, country: null },
];

const ATELIER = 'ORBES ATELIER — PARIS';

export interface DemoAccount {
  key: AccountKey;
  email: string;
  displayName: string;
  country: string;
  home: PlaceKey;
  /** Account creation date (before its first use in any story). */
  since: string;
  device: 'Safari/iOS' | 'Chrome/Android';
}

type AccountKey = 'camille' | 'hugo' | 'amelia' | 'sofia' | 'lucas' | 'elena' | 'kenji' | 'noor';

/** Obviously fictitious customers (example.com is reserved for documentation, RFC 2606). */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = Object.freeze([
  { key: 'camille', email: 'camille.martin@example.com', displayName: 'Camille Martin', country: 'FR', home: 'PARIS', since: '2025-01-20T19:12', device: 'Safari/iOS' },
  { key: 'hugo', email: 'hugo.bernard@example.com', displayName: 'Hugo Bernard', country: 'FR', home: 'LYON', since: '2025-01-23T08:40', device: 'Chrome/Android' },
  { key: 'amelia', email: 'amelia.clarke@example.com', displayName: 'Amelia Clarke', country: 'GB', home: 'LONDON', since: '2025-01-27T21:05', device: 'Safari/iOS' },
  { key: 'sofia', email: 'sofia.rossi@example.com', displayName: 'Sofia Rossi', country: 'IT', home: 'MILAN', since: '2025-02-02T11:30', device: 'Safari/iOS' },
  { key: 'lucas', email: 'lucas.weber@example.com', displayName: 'Lucas Weber', country: 'DE', home: 'BERLIN', since: '2025-02-05T17:48', device: 'Chrome/Android' },
  { key: 'elena', email: 'elena.garcia@example.com', displayName: 'Elena García', country: 'ES', home: 'MADRID', since: '2025-02-09T10:02', device: 'Chrome/Android' },
  { key: 'kenji', email: 'kenji.tanaka@example.com', displayName: 'Kenji Tanaka', country: 'JP', home: 'TOKYO', since: '2025-02-14T03:25', device: 'Safari/iOS' },
  { key: 'noor', email: 'noor.haddad@example.com', displayName: 'Noor Haddad', country: 'AE', home: 'DUBAI', since: '2025-02-18T15:10', device: 'Safari/iOS' },
]);

// ── Products ───────────────────────────────────────────────────────────────

/** Who scans: a logged-in customer, an anonymous passer-by, or boutique staff checking stock. */
type Who = { account: AccountKey } | { stranger: number } | { boutique: BoutiqueKey };

type When = string | Date;

/** The answer to WHERE DID YOU SEE OR BUY THIS PIECE? sent a few minutes after a scan that was not authentic (C-02). */
interface DemoReport {
  channel: ReportChannel;
  place?: string;
  note?: string;
}

interface Story {
  activate(at: When, boutique: BoutiqueKey): void;
  /** With `report`, the scanner then answers the question, which opens a case in the console's Cases queue. */
  scan(at: When, who: Who, place: PlaceKey, expect: VerificationState, opts?: { oldIssue?: number; report?: DemoReport }): void;
  /** Scan by the customer (FIRST REGISTRATION) followed by the registration itself. */
  register(at: When, account: AccountKey, place?: PlaceKey): void;
  /** Transfer code offered by `from`; with `accept`, redeemed by `to` who then scans the piece. */
  transfer(at: When, from: AccountKey, accept?: { at: When; to: AccountKey }): void;
  service(at: When, type: ServiceType, location: string, notes: string, completeAt?: When): void;
  incident(at: When, account: AccountKey, type: 'LOST' | 'STOLEN'): void;
  status(at: When, to: ProductStatus, reason: string): void;
  revokeCode(at: When, reason: string): void;
  reissue(at: When, reason: string): void;
  voidWarranty(at: When, reason: string): void;
  triage(at: When, anomalyType: string, status: AnomalyStatus, note: string): void;
}

interface Time {
  /** `now` minus a duration. */
  ago(days: number, hours?: number, minutes?: number): Date;
}

interface ProductDef {
  productId: string;
  model: ModelKey;
  variant?: string;
  material?: string;
  batch?: string;
  /** Ships with a claim code (default true). */
  claimSecret?: boolean;
  issuedAt: string;
  /** State of an anonymous scan of the current code right after seeding. */
  expect: VerificationState;
  scenario: string;
  story?(s: Story, t: Time): void;
}

/** Public description of one demo product (no secrets, no timeline). */
export interface DemoProductInfo {
  productId: string;
  model: string;
  type: string;
  category: string;
  variant: string | null;
  material: string;
  scenario: string;
  /** State an anonymous scan of the current code returns right after seeding. */
  expectedState: VerificationState;
  /** Superseded or revoked earlier issues that are still out there, with their anonymous scan state. */
  previousIssues: { issue: number; expectedState: VerificationState }[];
}

const PRODUCTS: readonly ProductDef[] = [
  // ── Jewelry 2026 (ORBITAL) ──────────────────────────────────────────────
  {
    productId: 'O26-J-00184',
    model: 'MONOLITHE',
    variant: 'SIZE 52',
    batch: 'B2604-MNL',
    issuedAt: '2026-04-08T09:00',
    expect: 'AUTHENTIC_FIRST_REGISTRATION',
    scenario: 'Sold in Paris this week, not registered yet: the next scan offers FIRST REGISTRATION (claim code required).',
    story: (s, t) => s.activate(t.ago(6, 3), 'PARIS'),
  },
  {
    productId: 'O26-J-00185',
    model: 'MONOLITHE',
    variant: 'SIZE 54',
    batch: 'B2604-MNL',
    issuedAt: '2026-04-08T09:05',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Camille Martin, registered with its claim code the evening of purchase.',
    story: (s, t) => {
      s.activate('2026-04-18T15:00', 'PARIS');
      s.register('2026-04-18T19:30', 'camille');
      s.scan('2026-06-02T08:15', { account: 'camille' }, 'PARIS', 'AUTHENTIC_OWNERSHIP_VERIFIED');
      s.scan(t.ago(4, 6), { account: 'camille' }, 'PARIS', 'AUTHENTIC_OWNERSHIP_VERIFIED');
    },
  },
  {
    productId: 'O26-J-00186',
    model: 'MONOLITHE',
    variant: 'SIZE 50',
    batch: 'B2604-MNL',
    issuedAt: '2026-04-08T09:10',
    expect: 'AUTHENTIC',
    scenario:
      'In stock in Paris (ISSUED): authentic, not sold. Checked by the boutique on a phone outside the console, so the scan raised UNSOLD PIECE SCANNED; dismissed with a note.',
    story: (s, t) => {
      s.scan(t.ago(12, 2), { boutique: 'PARIS' }, 'PARIS', 'AUTHENTIC');
      s.triage(t.ago(11, 5), 'UNSOLD_PIECE_SCAN', 'DISMISSED', 'Stock check by the Paris boutique on a phone that was not signed in to the console.');
    },
  },
  {
    productId: 'O26-J-00187',
    model: 'MONOLITHE',
    variant: 'SIZE 56',
    material: '18K WHITE GOLD',
    batch: 'B2604-MNG',
    issuedAt: '2026-04-08T09:15',
    expect: 'AUTHENTIC',
    scenario: 'In stock (ISSUED), white-gold variant.',
  },
  {
    productId: 'O26-J-00188',
    model: 'HORIZON',
    batch: 'B2604-HRZ',
    issuedAt: '2026-04-08T09:25',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Camille Martin, one of her ten pieces (PALLADIUM).',
    story: (s) => {
      s.activate('2026-05-23T15:00', 'PARIS');
      s.register('2026-05-23T19:00', 'camille');
    },
  },
  {
    productId: 'O26-J-00189',
    model: 'ECLIPSE',
    batch: 'B2604-ECL',
    issuedAt: '2026-04-08T09:30',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Lucas Weber, his fifth piece (PLATINE).',
    story: (s) => {
      s.activate('2026-05-28T10:00', 'ONLINE_DE');
      s.register('2026-05-30T19:00', 'lucas');
    },
  },
  {
    productId: 'O26-J-00190',
    model: 'ORBITE',
    variant: 'SIZE 58',
    batch: 'B2601-ORB',
    issuedAt: '2026-02-03T10:00',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Bought by Hugo Bernard, transferred to Amelia Clarke (TRANSFERRED).',
    story: (s) => {
      s.activate('2026-02-14T14:00', 'PARIS');
      s.register('2026-02-14T18:00', 'hugo', 'PARIS');
      s.scan('2026-04-03T09:20', { account: 'hugo' }, 'LYON', 'AUTHENTIC_OWNERSHIP_VERIFIED');
      s.transfer('2026-06-20T10:00', 'hugo', { at: '2026-06-23T12:00', to: 'amelia' });
    },
  },
  {
    productId: 'O26-J-00191',
    model: 'ORBITE',
    variant: 'SIZE 54',
    batch: 'B2601-ORB',
    issuedAt: '2026-02-03T10:05',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Sofia Rossi, at the Paris atelier for a resize (SERVICED, open service).',
    story: (s, t) => {
      s.activate('2026-03-01T15:30', 'MILAN');
      s.register('2026-03-01T17:00', 'sofia');
      s.service(t.ago(9, 4), 'RESIZE', ATELIER, 'Resize from 54 to 56 requested by the client.');
    },
  },
  {
    productId: 'O26-J-00192',
    model: 'ECLIPSE',
    batch: 'B2601-ECL',
    issuedAt: '2026-01-20T11:00',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Lucas Weber; polished at the atelier in May (completed service).',
    story: (s) => {
      s.activate('2026-02-10T10:00', 'ONLINE_DE');
      s.register('2026-02-12T19:45', 'lucas');
      s.service('2026-05-04T09:30', 'POLISH', ATELIER, 'Complimentary polish.', '2026-05-11T16:00');
      s.scan('2026-05-12T18:10', { account: 'lucas' }, 'BERLIN', 'AUTHENTIC_OWNERSHIP_VERIFIED');
    },
  },
  {
    productId: 'O26-J-00193',
    model: 'ECLIPSE',
    batch: 'B2601-ECL',
    issuedAt: '2026-01-20T11:05',
    expect: 'SUSPICIOUS_ACTIVITY',
    scenario: 'Reported STOLEN by Elena García, then scanned by a stranger in Barcelona: SUSPICIOUS ACTIVITY, open anomaly, and an open case where the stranger says it was offered.',
    story: (s, t) => {
      s.activate('2026-03-07T12:00', 'ONLINE_ES');
      s.register('2026-03-08T20:30', 'elena');
      s.incident(t.ago(20, 2), 'elena', 'STOLEN');
      s.scan(t.ago(2, 7), { stranger: 1 }, 'BARCELONA', 'SUSPICIOUS_ACTIVITY', {
        report: { channel: 'PRIVATE', place: 'Barcelona, a seller met through a classified ad', note: 'Offered well below the boutique price, without its box.' },
      });
    },
  },
  {
    productId: 'O26-J-00194',
    model: 'HORIZON',
    batch: 'B2603-HRZ',
    issuedAt: '2026-03-10T09:00',
    expect: 'AUTHENTIC_REGISTERED',
    scenario:
      'Owned by Kenji Tanaka in Tokyo. Three days ago its code was scanned in Tokyo, Paris and New York within 95 minutes: impossible travel, open HIGH anomaly, and an open case where the New York scanner says they saw it.',
    story: (s, t) => {
      s.activate('2026-04-02T05:00', 'TOKYO');
      s.register('2026-04-02T12:00', 'kenji');
      s.scan('2026-05-20T10:40', { account: 'kenji' }, 'TOKYO', 'AUTHENTIC_OWNERSHIP_VERIFIED');
      const burst = t.ago(3, 3);
      s.scan(burst, { account: 'kenji' }, 'TOKYO', 'AUTHENTIC_OWNERSHIP_VERIFIED');
      s.scan(new Date(burst.getTime() + 40 * 60_000), { stranger: 2 }, 'PARIS', 'SUSPICIOUS_ACTIVITY');
      s.scan(new Date(burst.getTime() + 95 * 60_000), { stranger: 3 }, 'NEW_YORK', 'SUSPICIOUS_ACTIVITY', {
        report: { channel: 'ONLINE', place: 'a marketplace listing', note: 'The listing showed several cuffs with the same code.' },
      });
      s.scan(t.ago(2, 1), { account: 'kenji' }, 'TOKYO', 'AUTHENTIC_OWNERSHIP_VERIFIED');
    },
  },
  {
    productId: 'O26-J-00195',
    model: 'HORIZON',
    batch: 'B2603-HRZ',
    claimSecret: false,
    issuedAt: '2026-03-10T09:05',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Registered by Noor Haddad without a claim code (REGISTERED, awaiting proof review).',
    story: (s) => {
      s.activate('2026-05-16T16:00', 'DUBAI');
      s.register('2026-05-16T20:00', 'noor');
    },
  },
  {
    productId: 'O26-J-00196',
    model: 'ECLIPSE',
    batch: 'B2601-ECL',
    claimSecret: false,
    issuedAt: '2026-01-20T11:10',
    expect: 'AUTHENTIC_FIRST_REGISTRATION',
    scenario: 'Sold in London two days ago, no claim card: FIRST REGISTRATION without a claim code.',
    story: (s, t) => s.activate(t.ago(2, 5), 'LONDON'),
  },
  {
    productId: 'O26-J-00197',
    model: 'MONOLITHE',
    variant: 'SIZE 52',
    batch: 'B2603-MNL',
    issuedAt: '2026-03-02T09:00',
    expect: 'REVOKED',
    scenario: 'Withdrawn before sale (REVOKED): casting porosity found in its batch.',
    story: (s) => s.status('2026-03-20T14:00', 'REVOKED', 'Withdrawn before sale: casting porosity found in batch B2603-MNL.'),
  },
  {
    productId: 'O26-J-00198',
    model: 'ORBITE',
    variant: 'SIZE 60',
    batch: 'B2601-ORB',
    issuedAt: '2026-02-03T10:10',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Amelia Clarke. Its engraving was damaged and the code re-issued (issue 2); the old code verifies as REVOKED.',
    story: (s, t) => {
      s.activate('2026-02-21T13:00', 'LONDON');
      s.register('2026-02-21T18:30', 'amelia');
      s.reissue('2026-06-05T11:00', 'Engraving damaged during resizing; a new code was engraved.');
      s.scan('2026-06-06T09:00', { account: 'amelia' }, 'LONDON', 'AUTHENTIC_OWNERSHIP_VERIFIED');
      s.scan(t.ago(15, 3), { stranger: 4 }, 'LONDON', 'REVOKED', { oldIssue: 1 });
      s.triage(t.ago(14, 2), 'POST_REVOCATION_SCAN', 'DISMISSED', 'Old hang-tag scanned at a resale appraisal; the owner holds the replacement code.');
    },
  },
  {
    productId: 'O26-J-00199',
    model: 'MONOLITHE',
    variant: 'SIZE 54',
    material: '18K WHITE GOLD',
    batch: 'B2604-MNG',
    issuedAt: '2026-04-08T09:20',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Camille Martin, who offered it to someone yesterday (transfer pending).',
    story: (s, t) => {
      s.activate('2026-04-25T11:00', 'PARIS');
      s.register('2026-04-25T18:00', 'camille');
      s.transfer(t.ago(1, 4), 'camille');
    },
  },

  // ── Jewelry 2025 ─────────────────────────────────────────────────────────
  {
    productId: 'O25-J-00041',
    model: 'MONOLITHE',
    variant: 'SIZE 52',
    batch: 'B2502-MNL',
    issuedAt: '2025-03-03T09:00',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Camille Martin since March 2025.',
    story: (s) => {
      s.activate('2025-03-15T16:00', 'PARIS');
      s.register('2025-03-15T20:00', 'camille');
      s.scan('2025-09-01T09:00', { account: 'camille' }, 'PARIS', 'AUTHENTIC_OWNERSHIP_VERIFIED');
      s.scan('2026-01-10T18:30', { account: 'camille' }, 'PARIS', 'AUTHENTIC_OWNERSHIP_VERIFIED');
    },
  },
  {
    productId: 'O25-J-00042',
    model: 'ECLIPSE',
    batch: 'B2502-ECL',
    issuedAt: '2025-03-03T09:05',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Bought by Hugo Bernard, given to Lucas Weber for Christmas (TRANSFERRED).',
    story: (s) => {
      s.activate('2025-04-12T15:00', 'PARIS');
      s.register('2025-04-12T19:00', 'hugo', 'PARIS');
      s.transfer('2025-12-20T10:00', 'hugo', { at: '2025-12-24T19:00', to: 'lucas' });
    },
  },
  {
    productId: 'O25-J-00043',
    model: 'HORIZON',
    batch: 'B2503-HRZ',
    issuedAt: '2025-04-01T09:00',
    expect: 'SUSPICIOUS_ACTIVITY',
    scenario: 'Reported LOST by Sofia Rossi in July 2026.',
    story: (s) => {
      s.activate('2025-05-02T12:00', 'MILAN');
      s.register('2025-05-02T19:00', 'sofia');
      s.incident('2026-07-02T08:00', 'sofia', 'LOST');
    },
  },
  {
    productId: 'O25-J-00044',
    model: 'ORBITE',
    variant: 'SIZE 56',
    batch: 'B2503-ORB',
    issuedAt: '2025-04-01T09:05',
    expect: 'REVOKED',
    scenario: 'Boutique display piece retired from circulation (RETIRED).',
    story: (s) => s.status('2026-01-15T10:00', 'RETIRED', 'Display piece retired from circulation and destroyed by the atelier.'),
  },
  {
    productId: 'O25-J-00045',
    model: 'MONOLITHE',
    variant: 'SIZE 54',
    batch: 'B2503-MNL',
    issuedAt: '2025-04-01T09:10',
    expect: 'REVOKED',
    scenario: 'Went missing from stock; copies of its code were reported online (COUNTERFEIT_FLAGGED).',
    story: (s) =>
      s.status('2025-11-04T09:00', 'COUNTERFEIT_FLAGGED', 'Missing from Milan stock; copies of its code reported in online marketplace listings.'),
  },
  {
    productId: 'O25-J-00046',
    model: 'ORBITE',
    variant: 'SIZE 54',
    batch: 'B2505-ORB',
    issuedAt: '2025-06-02T09:00',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Camille Martin since June 2025, one of her ten pieces (PALLADIUM).',
    story: (s) => {
      s.activate('2025-06-14T15:00', 'PARIS');
      s.register('2025-06-14T20:30', 'camille');
    },
  },

  // ── Leather goods 2026 (MERIDIAN) ───────────────────────────────────────
  {
    productId: 'O26-L-00012',
    model: 'ATLAS',
    variant: 'BLACK',
    batch: 'L2602-ATL',
    issuedAt: '2026-02-16T08:00',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Sofia Rossi.',
    story: (s, t) => {
      s.activate('2026-03-01T15:40', 'MILAN');
      s.register('2026-03-01T18:00', 'sofia');
      s.scan(t.ago(0, 3), { account: 'sofia' }, 'MILAN', 'AUTHENTIC_OWNERSHIP_VERIFIED');
    },
  },
  {
    productId: 'O26-L-00013',
    model: 'ATLAS',
    variant: 'TAN',
    batch: 'L2602-ATL',
    issuedAt: '2026-02-16T08:05',
    expect: 'AUTHENTIC',
    scenario: 'In stock (ISSUED).',
  },
  {
    productId: 'O26-L-00014',
    model: 'ATLAS',
    variant: 'BLACK',
    batch: 'L2602-ATL',
    issuedAt: '2026-02-16T08:10',
    expect: 'AUTHENTIC_FIRST_REGISTRATION',
    scenario: 'Sold in Paris four days ago, not registered yet (claim code required).',
    story: (s, t) => s.activate(t.ago(4, 2), 'PARIS'),
  },
  {
    productId: 'O26-L-00015',
    model: 'PERIGEE',
    variant: 'BLACK',
    batch: 'L2602-PRG',
    issuedAt: '2026-02-16T08:15',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Lucas Weber; cleaned at the atelier in June (completed service).',
    story: (s) => {
      s.activate('2026-03-14T09:00', 'ONLINE_DE');
      s.register('2026-03-16T20:15', 'lucas');
      s.service('2026-06-10T10:00', 'CLEANING', ATELIER, 'Deep clean and edge paint touch-up.', '2026-06-18T15:00');
    },
  },
  {
    productId: 'O26-L-00016',
    model: 'PERIGEE',
    variant: 'COGNAC',
    batch: 'L2602-PRG',
    issuedAt: '2026-02-16T08:20',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Bought by Amelia Clarke, transferred to Kenji Tanaka (TRANSFERRED).',
    story: (s) => {
      s.activate('2026-03-28T12:00', 'LONDON');
      s.register('2026-03-28T19:00', 'amelia');
      s.transfer('2026-07-01T09:00', 'amelia', { at: '2026-07-03T11:00', to: 'kenji' });
    },
  },
  {
    productId: 'O26-L-00017',
    model: 'APOGEE',
    variant: '90 CM · BLACK',
    batch: 'L2602-APG',
    issuedAt: '2026-02-16T08:25',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Noor Haddad, at the atelier for a buckle repair (SERVICED).',
    story: (s, t) => {
      s.activate('2026-04-11T13:00', 'DUBAI');
      s.register('2026-04-11T18:20', 'noor');
      s.service(t.ago(5, 6), 'REPAIR', ATELIER, 'Buckle hinge replaced under warranty.');
    },
  },
  {
    productId: 'O26-L-00018',
    model: 'APOGEE',
    variant: '85 CM · TAN',
    batch: 'L2602-APG',
    issuedAt: '2026-02-16T08:30',
    expect: 'AUTHENTIC',
    scenario: 'In stock in Milan (ISSUED), never sold, yet its code was scanned in Lyon yesterday, outside the maison: AUTHENTIC all the same, and an open UNSOLD PIECE SCANNED finding.',
    story: (s, t) => s.scan(t.ago(0, 20), { stranger: 5 }, 'LYON', 'AUTHENTIC'),
  },
  {
    productId: 'O26-L-00019',
    model: 'PERIGEE',
    variant: 'BLACK',
    batch: 'L2602-PRG',
    issuedAt: '2026-02-16T08:35',
    expect: 'REVOKED',
    scenario: 'Owned by Hugo Bernard; its code card was lost in transit, so the code was revoked pending a replacement.',
    story: (s, t) => {
      s.activate('2026-05-09T11:00', 'PARIS');
      s.register('2026-05-09T21:00', 'hugo', 'PARIS');
      s.revokeCode(t.ago(10, 1), 'Code card lost in transit; replacement code pending.');
    },
  },

  // ── Leather goods 2025 ───────────────────────────────────────────────────
  {
    productId: 'O25-L-00007',
    model: 'ATLAS',
    variant: 'BLACK',
    batch: 'L2502-ATL',
    issuedAt: '2025-02-10T08:00',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Elena García since March 2025.',
    story: (s) => {
      s.activate('2025-03-20T10:00', 'ONLINE_ES');
      s.register('2025-03-22T19:30', 'elena');
    },
  },
  {
    productId: 'O25-L-00008',
    model: 'APOGEE',
    variant: '95 CM · BLACK',
    batch: 'L2502-APG',
    issuedAt: '2025-02-10T08:05',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Amelia Clarke; warranty VOID after a third-party alteration.',
    story: (s) => {
      s.activate('2025-05-30T12:00', 'LONDON');
      s.register('2025-05-30T18:00', 'amelia');
      s.voidWarranty('2025-11-12T10:00', 'Strap shortened by a third party; warranty void.');
    },
  },
  {
    productId: 'O25-L-00009',
    model: 'ATLAS',
    variant: 'BLACK',
    batch: 'L2508-ATL',
    issuedAt: '2025-08-25T08:00',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Camille Martin since September 2025, one of her ten pieces (PALLADIUM).',
    story: (s) => {
      s.activate('2025-09-20T16:00', 'PARIS');
      s.register('2025-09-20T21:00', 'camille');
    },
  },

  // ── Watches (ZENITH) ─────────────────────────────────────────────────────
  {
    productId: 'O26-W-00003',
    model: 'SOLSTICE',
    variant: '39 MM',
    batch: 'W2601-SLS',
    issuedAt: '2026-01-12T09:00',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Hugo Bernard, 60-month warranty.',
    story: (s) => {
      s.activate('2026-02-14T14:30', 'PARIS');
      s.register('2026-02-14T19:00', 'hugo', 'PARIS');
    },
  },
  {
    productId: 'O26-W-00004',
    model: 'SOLSTICE',
    variant: '39 MM',
    batch: 'W2601-SLS',
    issuedAt: '2026-01-12T09:05',
    expect: 'AUTHENTIC_FIRST_REGISTRATION',
    scenario: 'Sold in Dubai yesterday, not registered yet.',
    story: (s, t) => s.activate(t.ago(1, 2), 'DUBAI'),
  },
  {
    productId: 'O26-W-00005',
    model: 'SOLSTICE',
    variant: '42 MM',
    material: '18K ROSE GOLD',
    batch: 'W2601-SLG',
    issuedAt: '2026-01-12T09:10',
    expect: 'AUTHENTIC',
    scenario: 'In stock (ISSUED), rose-gold variant.',
  },
  {
    productId: 'O26-W-00006',
    model: 'SOLSTICE',
    variant: '38 MM',
    batch: 'W2601-SLS',
    issuedAt: '2026-01-12T09:15',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Camille Martin, one of her ten pieces (PALLADIUM).',
    story: (s) => {
      s.activate('2026-06-20T14:00', 'PARIS');
      s.register('2026-06-20T20:00', 'camille');
    },
  },
  {
    productId: 'O25-W-00011',
    model: 'SOLSTICE',
    variant: '42 MM',
    batch: 'W2504-SLS',
    issuedAt: '2025-05-05T09:00',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Kenji Tanaka; in for its movement inspection (SERVICED).',
    story: (s, t) => {
      s.activate('2025-06-20T04:00', 'TOKYO');
      s.register('2025-06-20T11:00', 'kenji');
      s.service(t.ago(7, 2), 'INSPECTION', 'ORBES TOKYO — GINZA', 'Movement inspection and water-resistance test.');
    },
  },

  // ── Fragrance (NOCTURNE) ─────────────────────────────────────────────────
  {
    productId: 'O26-F-00021',
    model: 'NOCTURNE',
    batch: 'F2603-NCT',
    claimSecret: false,
    issuedAt: '2026-03-02T08:00',
    expect: 'AUTHENTIC',
    scenario: 'In stock (ISSUED).',
  },
  {
    productId: 'O26-F-00022',
    model: 'NOCTURNE',
    batch: 'F2603-NCT',
    claimSecret: false,
    issuedAt: '2026-03-02T08:05',
    expect: 'AUTHENTIC_FIRST_REGISTRATION',
    scenario: 'Sold in London three days ago, no claim card.',
    story: (s, t) => s.activate(t.ago(3, 4), 'LONDON'),
  },
  {
    productId: 'O26-F-00023',
    model: 'NOCTURNE',
    batch: 'F2603-NCT',
    issuedAt: '2026-03-02T08:10',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Noor Haddad.',
    story: (s) => {
      s.activate('2026-04-30T12:00', 'DUBAI');
      s.register('2026-04-30T17:00', 'noor');
    },
  },
  {
    productId: 'O25-F-00009',
    model: 'NOCTURNE',
    batch: 'F2504-NCT',
    issuedAt: '2025-04-14T08:00',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Camille Martin; its 12-month warranty has EXPIRED.',
    story: (s) => {
      s.activate('2025-05-10T15:00', 'PARIS');
      s.register('2025-05-10T21:00', 'camille');
    },
  },

  // ── Accessories (EQUINOX) ────────────────────────────────────────────────
  {
    productId: 'O26-A-00008',
    model: 'EQUINOX',
    batch: 'A2601-EQX',
    issuedAt: '2026-01-26T08:00',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Camille Martin.',
    story: (s) => {
      s.activate('2026-02-14T15:00', 'PARIS');
      s.register('2026-02-14T21:00', 'camille');
    },
  },
  {
    productId: 'O26-A-00009',
    model: 'PARALLAX',
    batch: 'A2601-PLX',
    issuedAt: '2026-01-26T08:05',
    expect: 'AUTHENTIC',
    scenario: 'In stock (ISSUED).',
  },
  {
    productId: 'O26-A-00010',
    model: 'PARALLAX',
    batch: 'A2601-PLX',
    issuedAt: '2026-01-26T08:10',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Bought by Kenji Tanaka, transferred to Hugo Bernard (TRANSFERRED).',
    story: (s) => {
      s.activate('2026-02-28T05:00', 'TOKYO');
      s.register('2026-02-28T11:00', 'kenji');
      s.transfer('2026-06-10T09:00', 'kenji', { at: '2026-06-12T18:00', to: 'hugo' });
    },
  },
  {
    productId: 'O26-A-00011',
    model: 'PARALLAX',
    batch: 'A2601-PLX',
    issuedAt: '2026-01-26T08:15',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Camille Martin, the tenth of her pieces (PALLADIUM).',
    story: (s) => {
      s.activate('2026-07-04T15:00', 'PARIS');
      s.register('2026-07-04T19:30', 'camille');
    },
  },
  {
    productId: 'O25-A-00004',
    model: 'EQUINOX',
    batch: 'A2502-EQX',
    issuedAt: '2025-02-24T08:00',
    expect: 'AUTHENTIC_REGISTERED',
    scenario: 'Owned by Lucas Weber since April 2025.',
    story: (s) => {
      s.activate('2025-04-05T10:00', 'ONLINE_DE');
      s.register('2025-04-06T18:30', 'lucas');
    },
  },
];

const PRODUCT_ID_RE = /^O(\d{2})-([A-Z])-(\d{5})$/;

/** The demo products, their scenarios and the state an anonymous scan returns after seeding. */
export function listDemoProducts(): DemoProductInfo[] {
  return PRODUCTS.map((p) => {
    const model = modelOf(p.model);
    const previousIssues: DemoProductInfo['previousIssues'] = [];
    // Collect re-issues by running the story against a recorder.
    let reissues = 0;
    p.story?.(recorderStory(() => reissues++), { ago: () => DEMO_MIN_NOW });
    for (let i = 1; i <= reissues; i++) previousIssues.push({ issue: i, expectedState: 'REVOKED' });
    return {
      productId: p.productId,
      model: model.name,
      type: model.type,
      category: categoryOf(model.category).name,
      variant: p.variant ?? null,
      material: p.material ?? model.defaultMaterial,
      scenario: p.scenario,
      expectedState: p.expect,
      previousIssues,
    };
  });
}

/** 'EMPTY' (no products), 'SEEDED' (the demo is there) or 'OTHER_DATA' (products, but not the demo's). */
export async function demoSeedStatus(db: Db): Promise<'EMPTY' | 'SEEDED' | 'OTHER_DATA'> {
  const marker = await db.selectFrom('products').select('id').where('product_id', '=', DEMO_FIRST_REGISTRATION_PRODUCT_ID).executeTakeFirst();
  if (marker) return 'SEEDED';
  const any = await db.selectFrom('products').select('id').limit(1).executeTakeFirst();
  return any ? 'OTHER_DATA' : 'EMPTY';
}

// ── Seeding ────────────────────────────────────────────────────────────────

/** The clock the seed drives. Must be the clock `ctx` was created with (e.g. createManualClock()). */
export interface SeedClock {
  now(): Date;
  set(d: Date | string | number): void;
}

export interface SeedDemoOptions {
  clock: SeedClock;
  /** End of the timeline (default: the real current time). Must be ≥ DEMO_MIN_NOW. */
  now?: Date;
  /** Password of every demo account (≥ 12 chars). Default: random, returned once in the result. */
  accountPassword?: string;
  log?: Logger;
}

export interface DemoSeedResult {
  products: number;
  productsByStatus: Record<string, number>;
  accounts: { email: string; displayName: string }[];
  /** The demo accounts' password; present only when it was generated (shown once). */
  generatedAccountPassword?: string;
  /** Claim codes of the pieces that can still be registered (demo secrets, shown once). */
  claimCodes: { productId: string; claimCode: string; registrable: boolean }[];
  scans: number;
  anomalies: { open: number; total: number };
  keyId: number;
  timeline: { start: string; end: string; steps: number };
}

interface ProductState {
  uuid: string;
  codeId: string;
  data: string;
  issue: number;
  glyphs: number[];
  claimCode?: string;
  previous: { issue: number; data: string }[];
}

interface World {
  ctx: AppContext;
  pepper: string;
  password: string;
  catalogue: CatalogueIds;
  /** Point-of-sale name → retailers.id. */
  retailers: Map<string, string>;
  products: Map<string, ProductState>;
  accounts: Map<AccountKey, string>;
  /** One-time secrets between two steps: registration tokens and transfer codes. */
  pending: Map<string, string>;
  openServices: Map<string, string[]>;
}

interface Step {
  at: Date;
  /** Tie-breaker: product order, then step order within its story. */
  order: number;
  label: string;
  run(w: World): Promise<void>;
}

/**
 * Load the demo dataset into an empty database through the real services.
 *
 * `ctx` must have been created with `clock: opts.clock.now` (the seed moves
 * time through it). Refuses production, a non-empty product table, and a
 * category registry whose indices differ from the demo's.
 */
export async function seedDemo(ctx: AppContext, opts: SeedDemoOptions): Promise<DemoSeedResult> {
  const log = opts.log ?? noopLogger;
  if (ctx.config.env === 'production') throw new DemoSeedError('the demo dataset is never loaded into a production environment');
  const now = opts.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new DemoSeedError('invalid `now`');
  if (now.getTime() < DEMO_MIN_NOW.getTime()) {
    throw new DemoSeedError(`the demo timeline needs now ≥ ${DEMO_MIN_NOW.toISOString()}`);
  }
  assertDrivesContextClock(ctx, opts.clock);
  const status = await demoSeedStatus(ctx.db);
  if (status === 'SEEDED') throw new DemoSeedError('the demo dataset is already loaded (reset the database to seed again)');
  if (status === 'OTHER_DATA') throw new DemoSeedError('the database already holds products; the demo dataset only loads into an empty database');

  let password = opts.accountPassword;
  let generated: string | undefined;
  if (password === undefined) {
    // 18 random bytes → 24 base64url chars; satisfies the 12-character policy with a wide margin.
    password = generated = randomBytes(18).toString('base64url');
  } else if (typeof password !== 'string' || password.length < 12) {
    throw new DemoSeedError('the demo account password must be at least 12 characters');
  }

  const steps = buildTimeline(now);
  log.info({ steps: steps.length, products: PRODUCTS.length }, 'demo seed: starting');

  opts.clock.set(DEMO_TIMELINE_START);
  const key = await ctx.keys.ensureActiveKey(DEMO_SEED_ACTOR);
  await ensureCatalogue(ctx);
  const world: World = {
    ctx,
    pepper: ctx.config.ipHashPepper,
    password,
    catalogue: await loadCatalogueIds(ctx.db),
    retailers: await ensureRetailers(ctx),
    products: new Map(),
    accounts: new Map(),
    pending: new Map(),
    openServices: new Map(),
  };

  for (const step of steps) {
    opts.clock.set(step.at);
    try {
      await step.run(world);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new DemoSeedError(`demo seed failed at ${step.at.toISOString()} (${step.label}): ${message}`);
    }
  }
  opts.clock.set(now);
  // What housekeeping would have done day after day: the complete days counted in the daily statistics.
  const statsRows = await aggregateScanStats(ctx.db, now);
  log.info({ statsRows }, 'demo seed: timeline complete');

  return summarise(world, key.keyId, steps.length, now, generated);
}

// ── Timeline construction ──────────────────────────────────────────────────

type CatalogueIds = { models: Map<ModelKey, string>; collections: Map<CollectionName, string> };

function buildTimeline(now: Date): Step[] {
  const time: Time = {
    ago: (days, hours = 0, minutes = 0) => new Date(now.getTime() - ((days * 24 + hours) * 60 + minutes) * 60_000),
  };
  const steps: Step[] = [];
  let order = 0;

  for (const a of DEMO_ACCOUNTS) {
    steps.push({ at: at(a.since), order: order++, label: `account ${a.email}`, run: (w) => createAccount(w, a) });
  }

  for (const p of PRODUCTS) {
    const own: Step[] = [];
    const add = (when: When, label: string, run: (w: World) => Promise<void>) =>
      own.push({ at: at(when), order: order++, label: `${p.productId} ${label}`, run });
    add(p.issuedAt, 'issue', (w) => issue(w, p));
    p.story?.(storyFor(p.productId, add), time);
    // Each story must read forward in time, and never past `now`.
    for (let i = 1; i < own.length; i++) {
      if (own[i].at.getTime() <= own[i - 1].at.getTime()) {
        throw new DemoSeedError(`internal: ${own[i].label} is not after ${own[i - 1].label}`);
      }
    }
    if (own.some((s) => s.at.getTime() > now.getTime())) throw new DemoSeedError(`internal: ${p.productId} has steps after now`);
    steps.push(...own);
  }
  return steps.sort((a, b) => a.at.getTime() - b.at.getTime() || a.order - b.order);
}

type AddStep = (when: When, label: string, run: (w: World) => Promise<void>) => void;

function storyFor(productId: string, add: AddStep): Story {
  return {
    activate: (when, boutique) => add(when, `activate (${boutique})`, (w) => activate(w, productId, when, boutique)),
    scan: (when, who, place, expect, opts) => {
      add(when, `scan by ${whoLabel(who)} in ${place}`, async (w) => {
        const outcome = await scan(w, productId, who, place, expect, opts?.oldIssue);
        if (opts?.report) w.pending.set(`report:${productId}`, outcome.scanId);
      });
      const report = opts?.report;
      if (report) {
        add(new Date(at(when).getTime() + 4 * 60_000), `report by ${whoLabel(who)}`, async (w) => {
          const scanId = w.pending.get(`report:${productId}`);
          if (!scanId) throw new Error('no scan to report on');
          w.pending.delete(`report:${productId}`);
          // As POST /api/v1/reports records it: the signed-in account, else the public with the IP pseudonym.
          const actor: Actor = 'account' in who ? accountActor(w, who.account) : { type: 'system', id: 'public', ipHash: ipHash(w, who) };
          await w.ctx.services.reports.submit({ scanId, channel: report.channel, place: report.place ?? null, note: report.note ?? null }, actor);
        });
      }
    },
    register: (when, account, place) => {
      const start = at(when);
      add(start, `registration scan by ${account}`, async (w) => {
        const home = place ?? accountDef(account).home;
        const outcome = await scan(w, productId, { account }, home, 'AUTHENTIC_FIRST_REGISTRATION');
        if (!outcome.registration) throw new Error('no registration token in a FIRST_REGISTRATION outcome');
        w.pending.set(`reg:${productId}`, outcome.registration.token);
      });
      add(new Date(start.getTime() + 3 * 60_000), `registration by ${account}`, (w) => register(w, productId, account));
    },
    transfer: (when, from, accept) => {
      add(when, `transfer offered by ${from}`, (w) => offerTransfer(w, productId, from));
      if (accept) {
        const acceptAt = at(accept.at);
        // F-03: the recipient scans the piece, signed in, then enters its transfer code with the token of that scan.
        add(new Date(acceptAt.getTime() - 4 * 60_000), `transfer scan by ${accept.to}`, async (w) => {
          const outcome = await scan(w, productId, { account: accept.to }, accountDef(accept.to).home, 'AUTHENTIC_REGISTERED');
          if (!outcome.transfer) throw new Error('no transfer token in the scan of a piece whose transfer is pending');
          w.pending.set(`transfer-scan:${productId}`, outcome.transfer.token);
        });
        add(acceptAt, `transfer accepted by ${accept.to}`, (w) => acceptTransfer(w, productId, accept.to));
        add(new Date(acceptAt.getTime() + 10 * 60_000), `scan by new owner ${accept.to}`, async (w) => {
          await scan(w, productId, { account: accept.to }, accountDef(accept.to).home, 'AUTHENTIC_OWNERSHIP_VERIFIED');
        });
      }
    },
    service: (when, type, location, notes, completeAt) => {
      add(when, `service ${type} opened`, (w) => openService(w, productId, type, location, notes));
      if (completeAt !== undefined) add(completeAt, `service ${type} completed`, (w) => completeService(w, productId));
    },
    incident: (when, account, type) =>
      add(when, `${type} reported by ${account}`, async (w) => {
        await w.ctx.services.ownership.reportIncident(accountId(w, account), productId, type, accountActor(w, account));
      }),
    status: (when, to, reason) =>
      add(when, `status → ${to}`, async (w) => {
        await w.ctx.services.lifecycle.transition(productId, to, { reason }, DEMO_SEED_ACTOR);
      }),
    revokeCode: (when, reason) =>
      add(when, 'code revoked', async (w) => {
        await w.ctx.services.issuance.revokeCode(state(w, productId).codeId, reason, DEMO_SEED_ACTOR);
      }),
    reissue: (when, reason) => add(when, 'code re-issued', (w) => reissue(w, productId, reason)),
    voidWarranty: (when, reason) =>
      add(when, 'warranty voided', async (w) => {
        await w.ctx.services.warranty.void(productId, reason, DEMO_SEED_ACTOR);
      }),
    triage: (when, anomalyType, status, note) =>
      add(when, `anomaly ${anomalyType} → ${status}`, async (w) => {
        const page = await w.ctx.services.anomaly.list({ productId, type: anomalyType }, { page: 1, pageSize: 10 });
        const open = page.items.find((a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED');
        if (!open) throw new Error(`no open ${anomalyType} anomaly to triage`);
        await w.ctx.services.anomaly.updateStatus(open.id, { status, note }, DEMO_SEED_ACTOR);
      }),
  };
}

/** A Story that only counts re-issues (used to describe products without running them). */
function recorderStory(onReissue: () => void): Story {
  const nop = () => {};
  return {
    activate: nop,
    scan: nop,
    register: nop,
    transfer: nop,
    service: nop,
    incident: nop,
    status: nop,
    revokeCode: nop,
    reissue: () => onReissue(),
    voidWarranty: nop,
    triage: nop,
  };
}

// ── Step implementations ───────────────────────────────────────────────────

async function ensureCatalogue(ctx: AppContext): Promise<void> {
  const existing = await ctx.categories.list();
  for (const c of DEMO_CATEGORIES) {
    const found = existing.find((e) => e.code === c.code);
    if (found) {
      if (found.index !== c.index) {
        throw new DemoSeedError(`category ${c.code} has index ${found.index}; the demo needs ${c.index}`);
      }
      continue;
    }
    // Indices are permanent: check before creating rather than undo afterwards.
    const used = new Set((await ctx.categories.list()).map((e) => e.index));
    let lowest = 1;
    while (used.has(lowest)) lowest++;
    if (lowest !== c.index) throw new DemoSeedError(`category ${c.code} would get index ${lowest}; the demo needs ${c.index}`);
    await ctx.categories.create({ code: c.code, name: c.name, warrantyMonths: c.warrantyMonths }, DEMO_SEED_ACTOR);
  }

  const now = ctx.clock();
  for (const name of DEMO_COLLECTIONS) {
    const found = await ctx.db.selectFrom('collections').select('id').where('name', '=', name).executeTakeFirst();
    if (found) continue;
    await ctx.db.transaction().execute(async (tx) => {
      const row = await tx.insertInto('collections').values({ name, created_at: now }).returning('id').executeTakeFirstOrThrow();
      await ctx.audit.record({ actor: DEMO_SEED_ACTOR, action: 'collection.create', targetType: 'collection', targetId: row.id, details: { name } }, tx);
    });
  }
  const collections = await ctx.db.selectFrom('collections').select(['id', 'name']).execute();
  for (const m of DEMO_MODELS) {
    const found = await ctx.db.selectFrom('models').select('id').where('sku_prefix', '=', m.skuPrefix).executeTakeFirst();
    if (found) continue;
    const collectionId = collections.find((c) => c.name === m.collection)?.id ?? null;
    await ctx.db.transaction().execute(async (tx) => {
      const row = await tx
        .insertInto('models')
        .values({
          category_id: categoryOf(m.category).index,
          collection_id: collectionId,
          name: m.name,
          type: m.type,
          sku_prefix: m.skuPrefix,
          default_material: m.defaultMaterial,
          care_instructions: m.care,
          created_at: now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.audit.record(
        {
          actor: DEMO_SEED_ACTOR,
          action: 'model.create',
          targetType: 'model',
          targetId: row.id,
          details: { name: m.name, type: m.type, skuPrefix: m.skuPrefix, category: m.category, collectionId },
        },
        tx,
      );
    });
  }
}

async function loadCatalogueIds(db: Db): Promise<CatalogueIds> {
  const models = new Map<ModelKey, string>();
  const rows = await db.selectFrom('models').select(['id', 'sku_prefix']).execute();
  for (const m of DEMO_MODELS) {
    const row = rows.find((r) => r.sku_prefix === m.skuPrefix);
    if (!row) throw new DemoSeedError(`model ${m.skuPrefix} is missing`);
    models.set(m.key, row.id);
  }
  const collections = new Map<CollectionName, string>();
  const cols = await db.selectFrom('collections').select(['id', 'name']).execute();
  for (const name of DEMO_COLLECTIONS) {
    const row = cols.find((c) => c.name === name);
    if (!row) throw new DemoSeedError(`collection ${name} is missing`);
    collections.set(name, row.id);
  }
  return { models, collections };
}

async function createAccount(w: World, a: DemoAccount): Promise<void> {
  const { account, session } = await w.ctx.services.auth.registerAccount(
    { email: a.email, password: w.password, displayName: a.displayName, country: a.country },
    { ipHash: ipHash(w, { account: a.key }) },
  );
  // The sign-up session is not kept: it would be a live bearer token nobody holds.
  await w.ctx.sessions.revoke(session.token);
  w.accounts.set(a.key, account.id);
}

async function issue(w: World, p: ProductDef): Promise<void> {
  const m = PRODUCT_ID_RE.exec(p.productId);
  if (!m) throw new Error(`invalid demo product id ${p.productId}`);
  const model = modelOf(p.model);
  if (m[2] !== model.category) throw new Error(`${p.productId}: model ${model.name} is not in category ${m[2]}`);
  const issuedAt = at(p.issuedAt);
  const productionDate = utcDate(new Date(issuedAt.getTime() - 9 * 86_400_000));
  const r = await w.ctx.services.issuance.issueProduct(
    {
      categoryCode: m[2],
      year: 2000 + Number(m[1]),
      serial: Number(m[3]),
      modelId: w.catalogue.models.get(model.key)!,
      collectionId: w.catalogue.collections.get(model.collection)!,
      ...(p.variant ? { variant: p.variant } : {}),
      material: p.material ?? model.defaultMaterial,
      ...(p.batch ? { productionBatch: p.batch } : {}),
      productionDate,
      withClaimSecret: p.claimSecret ?? true,
    },
    DEMO_SEED_ACTOR,
  );
  if (r.product.productId !== p.productId) throw new Error(`issued ${r.product.productId}, expected ${p.productId}`);
  w.products.set(p.productId, {
    uuid: r.product.id,
    codeId: r.code.id,
    data: r.code.data,
    issue: r.code.issue,
    glyphs: [...r.genome.glyphs],
    ...(r.claimCode ? { claimCode: r.claimCode } : {}),
    previous: [],
  });
}

async function activate(w: World, productId: string, when: When, boutique: BoutiqueKey): Promise<void> {
  const b = BOUTIQUES[boutique];
  const retailerId = w.retailers.get(b.retailer);
  if (!retailerId) throw new DemoSeedError(`no point of sale ${b.retailer}`);
  await w.ctx.services.warranty.activate(productId, { purchaseDate: utcDate(at(when)), retailerId, country: PLACES[b.place].country }, DEMO_SEED_ACTOR);
}

/** The register of points of sale, as the console's Points of sale page keeps it (A-08). */
async function ensureRetailers(ctx: AppContext): Promise<Map<string, string>> {
  const existing = new Map((await ctx.services.retailers.list()).map((r) => [r.name, r.id]));
  for (const p of POINTS_OF_SALE) {
    if (!existing.has(p.name)) existing.set(p.name, (await ctx.services.retailers.create(p, DEMO_SEED_ACTOR)).id);
  }
  return existing;
}

async function scan(w: World, productId: string, who: Who, placeKey: PlaceKey, expect: VerificationState, oldIssue?: number): Promise<VerifyOutcome> {
  const p = state(w, productId);
  let data = p.data;
  if (oldIssue !== undefined) {
    const old = p.previous.find((c) => c.issue === oldIssue);
    if (!old) throw new Error(`no previous issue ${oldIssue}`);
    data = old.data;
  }
  const place = PLACES[placeKey];
  const rnd = prng(`${productId}|${w.ctx.clock().toISOString()}|${whoLabel(who)}`);
  const confidence = p.glyphs.map(() => round2(0.86 + rnd() * 0.13));
  const outcome = await w.ctx.services.verification.verify(
    {
      code: data,
      genome: { glyphs: [...p.glyphs], confidence },
      client: {
        source: 'camera',
        decodeMs: Math.round(35 + rnd() * 110),
        rsErrors: Math.floor(rnd() * 4),
        rsErasures: Math.floor(rnd() * 2),
        moduleSizePx: round2(6 + rnd() * 6),
      },
    },
    {
      deviceHash: pseudonymize(w.pepper, 'device', `demo-device/${whoLabel(who)}`),
      ipHash: ipHash(w, who),
      geo: { country: place.country, lat: place.lat, lon: place.lon },
      userAgentFamily: 'account' in who ? accountDef(who.account).device : 'stranger' in who ? 'Chrome/Android' : 'Safari/iOS',
      ...('account' in who ? { accountId: accountId(w, who.account) } : {}),
    },
  );
  if (outcome.state !== expect) throw new Error(`verification returned ${outcome.state}, the story expects ${expect}`);
  return outcome;
}

async function register(w: World, productId: string, account: AccountKey): Promise<void> {
  const token = w.pending.get(`reg:${productId}`);
  if (!token) throw new Error('no registration token');
  w.pending.delete(`reg:${productId}`);
  const p = state(w, productId);
  await w.ctx.services.ownership.registerFirst(
    accountId(w, account),
    { registrationToken: token, claimCode: p.claimCode ?? null },
    accountActor(w, account),
  );
  // A claim code is single-purpose: once used it is no longer a demo secret worth printing.
  delete p.claimCode;
}

async function offerTransfer(w: World, productId: string, from: AccountKey): Promise<void> {
  const offer = await w.ctx.services.ownership.initiateTransfer(accountId(w, from), productId, accountActor(w, from));
  w.pending.set(`transfer:${productId}`, offer.transferCode);
}

async function acceptTransfer(w: World, productId: string, to: AccountKey): Promise<void> {
  const code = w.pending.get(`transfer:${productId}`);
  const token = w.pending.get(`transfer-scan:${productId}`);
  if (!code) throw new Error('no transfer code');
  if (!token) throw new Error('no transfer scan');
  w.pending.delete(`transfer:${productId}`);
  w.pending.delete(`transfer-scan:${productId}`);
  await w.ctx.services.ownership.acceptTransfer(accountId(w, to), { transferCode: code, productId, transferToken: token }, accountActor(w, to));
}

async function openService(w: World, productId: string, type: ServiceType, location: string, notes: string): Promise<void> {
  // The workshop that receives the piece performs the service.
  const record = await w.ctx.services.warranty.openService(productId, { type, location, notes, performedBy: location }, DEMO_SEED_ACTOR);
  const list = w.openServices.get(productId) ?? [];
  list.push(record.id);
  w.openServices.set(productId, list);
}

async function completeService(w: World, productId: string): Promise<void> {
  const id = w.openServices.get(productId)?.shift();
  if (!id) throw new Error('no open service to complete');
  await w.ctx.services.warranty.completeService(id, { notes: 'Returned to the client.' }, DEMO_SEED_ACTOR);
}

async function reissue(w: World, productId: string, reason: string): Promise<void> {
  const p = state(w, productId);
  const code = await w.ctx.services.issuance.reissueCode(productId, reason, DEMO_SEED_ACTOR);
  p.previous.push({ issue: p.issue, data: p.data });
  p.codeId = code.id;
  p.data = code.data;
  p.issue = code.issue;
}

async function summarise(w: World, keyId: number, steps: number, now: Date, generatedPassword: string | undefined): Promise<DemoSeedResult> {
  const db = w.ctx.db;
  const statuses = await db
    .selectFrom('products')
    .select((eb) => ['status', eb.fn.countAll<number>().as('n')])
    .where('product_id', 'in', PRODUCTS.map((p) => p.productId))
    .groupBy('status')
    .execute();
  const productsByStatus: Record<string, number> = {};
  for (const r of statuses) productsByStatus[r.status] = Number(r.n);
  const scans = await db.selectFrom('scan_events').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
  const anomalies = await db
    .selectFrom('anomalies')
    .select((eb) => [eb.fn.countAll<number>().as('total'), eb.fn.countAll<number>().filterWhere('status', '=', 'OPEN').as('open')])
    .executeTakeFirstOrThrow();

  const products = await db.selectFrom('products').select(['product_id', 'status', 'ownership_state']).execute();
  const claimCodes: DemoSeedResult['claimCodes'] = [];
  for (const p of PRODUCTS) {
    const s = w.products.get(p.productId);
    if (!s?.claimCode) continue;
    const row = products.find((r) => r.product_id === p.productId);
    claimCodes.push({
      productId: p.productId,
      claimCode: s.claimCode,
      registrable: row !== undefined && row.ownership_state === 'UNREGISTERED' && REGISTRABLE_STATUSES.includes(row.status),
    });
  }

  return {
    products: PRODUCTS.length,
    productsByStatus,
    accounts: DEMO_ACCOUNTS.map((a) => ({ email: a.email, displayName: a.displayName })),
    ...(generatedPassword ? { generatedAccountPassword: generatedPassword } : {}),
    claimCodes,
    scans: Number(scans.n),
    anomalies: { open: Number(anomalies.open), total: Number(anomalies.total) },
    keyId,
    timeline: { start: DEMO_TIMELINE_START.toISOString(), end: now.toISOString(), steps },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function assertDrivesContextClock(ctx: AppContext, clock: SeedClock): void {
  const probe = new Date('2025-01-01T00:00:00.000Z');
  const before = clock.now();
  clock.set(probe);
  const seen = ctx.clock().getTime();
  clock.set(before);
  if (seen !== probe.getTime()) {
    throw new DemoSeedError('the seed clock does not drive the context clock: create the context with { clock: seedClock.now }');
  }
}

/** 'YYYY-MM-DDTHH:MM' (UTC) or a Date. */
function at(when: When): Date {
  if (when instanceof Date) return when;
  const d = new Date(`${when}:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new DemoSeedError(`internal: bad date ${when}`);
  return d;
}

function modelOf(key: ModelKey): DemoModel {
  const m = DEMO_MODELS.find((x) => x.key === key);
  if (!m) throw new DemoSeedError(`internal: unknown model ${key}`);
  return m;
}

function categoryOf(code: string): DemoCategory {
  const c = DEMO_CATEGORIES.find((x) => x.code === code);
  if (!c) throw new DemoSeedError(`internal: unknown category ${code}`);
  return c;
}

function accountDef(key: AccountKey): DemoAccount {
  const a = DEMO_ACCOUNTS.find((x) => x.key === key);
  if (!a) throw new DemoSeedError(`internal: unknown account ${key}`);
  return a;
}

function accountId(w: World, key: AccountKey): string {
  const id = w.accounts.get(key);
  if (!id) throw new Error(`account ${key} does not exist yet`);
  return id;
}

function accountActor(w: World, key: AccountKey): Actor {
  return { type: 'account', id: accountId(w, key), ipHash: ipHash(w, { account: key }) };
}

function state(w: World, productId: string): ProductState {
  const s = w.products.get(productId);
  if (!s) throw new Error(`product ${productId} has not been issued yet`);
  return s;
}

function whoLabel(who: Who): string {
  if ('account' in who) return who.account;
  if ('stranger' in who) return `stranger-${who.stranger}`;
  return `boutique-${who.boutique.toLowerCase()}`;
}

/** Pseudonymous IP of a demo actor: documentation addresses (RFC 5737), hashed like real requests. */
function ipHash(w: World, who: Who): string {
  const index = 'account' in who ? DEMO_ACCOUNTS.findIndex((a) => a.key === who.account) + 10 : 'stranger' in who ? 100 + who.stranger : 200;
  const net = 'account' in who ? '198.51.100' : 'stranger' in who ? '203.0.113' : '192.0.2';
  return pseudonymize(w.pepper, 'ip', `${net}.${index}`);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Small deterministic PRNG (FNV-1a seed, mulberry32): plausible client metrics without randomness in tests. */
function prng(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
