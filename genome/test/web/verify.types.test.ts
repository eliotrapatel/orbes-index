/**
 * The web app declares the wire types of the public API itself (it must not
 * import server modules). These checks keep both sides in step: the
 * assignments below fail `tsc` if the server's outcome stops fitting the
 * browser's type, and the runtime checks compare the state lists.
 */
import { describe, expect, it } from 'vitest';
import {
  CIRCLE_POST_KINDS as SERVER_CIRCLE_KINDS,
  CIRCLE_RSVP_ANSWERS as SERVER_CIRCLE_ANSWERS,
  DROP_ENTRY_STATUSES as SERVER_ENTRY_STATUSES,
  LIVE_END_REASONS as SERVER_LIVE_END_REASONS,
  LIVE_ENTRY_STATUSES as SERVER_LIVE_ENTRY_STATUSES,
  ORDER_CHANNELS as SERVER_ORDER_CHANNELS,
  ORDER_STATUSES as SERVER_ORDER_STATUSES,
  REPORT_CHANNELS as SERVER_CHANNELS,
  VERIFICATION_STATES as SERVER_STATES,
} from '../../src/server/db/schema.js';
import type { CircleCard as ServerCircleCard, CirclePostView as ServerCirclePost } from '../../src/server/services/circle.js';
import type { ClubStatus as ServerClubStatus } from '../../src/server/services/club.js';
import {
  DROP_STATES as SERVER_DROP_STATES,
  type AccountDropEntry as ServerAccountDropEntry,
  type DrawEntry as ServerDrawEntry,
  type DropCard as ServerDropCard,
  type DropSheet as ServerDropSheet,
} from '../../src/server/services/drops.js';
import type { LiveAccess as ServerLiveAccess, LiveEntryView as ServerLiveEntry, LiveInterestView as ServerLiveInterest } from '../../src/server/services/live.js';
import type {
  LiveAccountEntry as ServerLiveAccountEntry,
  LiveBanner as ServerLiveBanner,
  LiveBoard as ServerLiveBoard,
  LiveCard as ServerLiveCard,
  LiveEndedSheet as ServerLiveEndedSheet,
  LiveRoom as ServerLiveRoom,
  LiveSheet as ServerLiveSheet,
} from '../../src/server/services/live-room.js';
import type { Page } from '../../src/server/types.js';
import { INCIDENT_TYPES as SERVER_INCIDENTS, type OwnedProduct } from '../../src/server/services/ownership.js';
import type {
  CertificateLookup as ServerCertificateLookup,
  CertificateOffer as ServerCertificateOffer,
  OwnerCertificate as ServerOwnerCertificate,
} from '../../src/server/services/ownership-certificates.js';
import type { LookbookCard as ServerLookbookCard, LookbookSheet as ServerLookbookSheet, SalonCard as ServerSalonCard } from '../../src/server/services/lookbook.js';
import type { SalonSheet as ServerSalonSheet, ShopRequestView as ServerShopRequest } from '../../src/server/services/salon.js';
import type { AccountOrder as ServerAccountOrder, OrderCareGuide as ServerOrderCareGuide } from '../../src/server/services/orders.js';
import type { VerifyInput as ServerVerifyInput, VerifyOutcome as ServerVerifyOutcome } from '../../src/server/services/verification.js';
import {
  CIRCLE_ANSWERS,
  CIRCLE_POST_KINDS,
  DROP_ENTRY_STATUSES,
  DROP_STATES,
  INCIDENT_TYPES,
  LIVE_END_REASONS,
  LIVE_ENTRY_STATUSES,
  ORDER_CHANNELS,
  ORDER_STATUSES,
  REPORT_CHANNELS,
  VERIFICATION_STATES,
  type AccountOrder,
  type OrderCareGuide,
  type ClubEntry,
  type ClubStatus,
  type DrawEntriesPage,
  type DrawEntry,
  type DropCard,
  type DropSheet,
  type CertificateLookup,
  type CertificateOffer,
  type CircleCard,
  type CircleFeed,
  type CirclePost,
  type LiveAccess,
  type LiveAccountEntry,
  type LiveBanner,
  type LiveBoard,
  type LiveCard,
  type LiveEndedSheet,
  type LiveEntry,
  type LiveInterest,
  type LiveRoom,
  type LiveSheet,
  type LookbookCard,
  type LookbookSheet,
  type OwnedPiece,
  type OwnerCertificate,
  type ShopRequest,
  type VerifyInput,
  type VerifyOutcome,
} from '../../src/web/verify/types.js';

/** A server value as JSON carries it: dates become ISO strings. */
type Json<T> = T extends Date ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;

// Compile-time: every server outcome is a valid web outcome, every web request a valid server input.
export const outcomeFits = (o: ServerVerifyOutcome): VerifyOutcome => o;
export const inputFits = (i: VerifyInput): ServerVerifyInput => i;
// …and every piece of GET /api/v1/account/products, once serialised, a valid piece of MY PIECES (F-01).
export const pieceFits = (p: Json<OwnedProduct>): OwnedPiece => p;
// …and the ownership certificate's answers (F-06): the lookup, the owner's links, a new link.
export const lookupFits = (r: Json<ServerCertificateLookup>): CertificateLookup => r;
export const ownerCertificateFits = (c: Json<ServerOwnerCertificate>): OwnerCertificate => c;
export const offerFits = (o: Json<ServerCertificateOffer>): CertificateOffer => o;
// …and the lookbook's answers (P-R02): a model of a list, a model's sheet.
export const cardFits = (c: Json<ServerLookbookCard>): LookbookCard => c;
export const sheetFits = (s: Json<ServerLookbookSheet>): LookbookSheet => s;
// …and THE PRIVATE SALON's (P-X08): a card with its price and tier, a sheet with the account's request, a request made.
export const salonCardFits = (c: Json<ServerSalonCard>): LookbookCard => c;
export const salonSheetFits = (s: Json<ServerSalonSheet>): LookbookSheet => s;
export const shopRequestFits = (r: Json<ServerShopRequest>): ShopRequest => r;
// …and the releases' (P-R03): a release of the list, its page, its draw's entries, the account's entries and status.
export const dropCardFits = (c: Json<ServerDropCard>): DropCard => c;
export const dropSheetFits = (s: Json<ServerDropSheet>): DropSheet => s;
export const drawEntryFits = (e: Json<ServerDrawEntry>): DrawEntry => e;
export const drawPageFits = (p: Json<Page<ServerDrawEntry>>): DrawEntriesPage => p;
export const clubEntryFits = (e: Json<ServerAccountDropEntry>): ClubEntry => e;
export const clubStatusFits = (s: Json<ServerClubStatus>): ClubStatus => s;
// …and the circle's (P-X01): a post of the feed, a page of it, a post.
export const circleCardFits = (c: Json<ServerCircleCard>): CircleCard => c;
export const circleFeedFits = (p: Json<Page<ServerCircleCard>>): CircleFeed => p;
export const circlePostFits = (p: Json<ServerCirclePost>): CirclePost => p;
// …and the LIVE RELEASES' (plan of 2026-10-04): a card, a page (and an ended one), the room, the account's entry, its
// standing, its interest and its entries in MY PIECES.
export const liveCardFits = (c: Json<ServerLiveCard>): LiveCard => c;
export const liveSheetFits = (s: Json<ServerLiveSheet>): LiveSheet => s;
export const liveEndedFits = (s: Json<ServerLiveEndedSheet>): LiveEndedSheet => s;
export const liveRoomFits = (r: Json<ServerLiveRoom>): LiveRoom => r;
export const liveEntryFits = (e: Json<ServerLiveEntry>): LiveEntry => e;
export const liveAccessFits = (a: Json<ServerLiveAccess>): LiveAccess => a;
export const liveInterestFits = (i: Json<ServerLiveInterest>): LiveInterest => i;
export const liveMineFits = (e: Json<ServerLiveAccountEntry>): LiveAccountEntry => e;
// …and MY PIECES' orders (plan LIVE RELEASE+, choice 6): an order of GET /api/v1/account/orders.
export const accountOrderFits = (o: Json<ServerAccountOrder>): AccountOrder => o;
// …and an order's care guide (M6): GET /api/v1/account/orders/:id/care-guide.
export const careGuideFits = (g: Json<ServerOrderCareGuide>): OrderCareGuide => g;
export const liveBannerFits = (b: Json<ServerLiveBanner>): LiveBanner => b;
export const liveBoardFits = (b: Json<ServerLiveBoard>): LiveBoard => b;
/** The outcome's product, field for field: the web type names every field the server sends (`lookbook` included). */
type ProductKeys<T> = T extends { product?: infer P } ? keyof NonNullable<P> : never;
export const productKeysMatch: [ProductKeys<ServerVerifyOutcome>] extends [ProductKeys<VerifyOutcome>] ? ([ProductKeys<VerifyOutcome>] extends [ProductKeys<ServerVerifyOutcome>] ? true : false) : false = true;

describe('verify wire types', () => {
  it('know the same verification states as the server', () => {
    expect([...VERIFICATION_STATES].sort()).toEqual([...SERVER_STATES].sort());
  });

  it('know the same report channels as the server (POST /api/v1/reports)', () => {
    expect([...REPORT_CHANNELS]).toEqual([...SERVER_CHANNELS]);
  });

  it('know the same incident types as the server (MY PIECES, POST /api/v1/ownership/incidents)', () => {
    expect([...INCIDENT_TYPES]).toEqual([...SERVER_INCIDENTS]);
  });

  it('know the same states of a release as the server, but the DRAFT the public never reads, and the same statuses of an entry (P-R03)', () => {
    expect([...DROP_STATES]).toEqual(SERVER_DROP_STATES.filter((s) => s !== 'DRAFT'));
    expect([...DROP_ENTRY_STATUSES]).toEqual([...SERVER_ENTRY_STATUSES]);
  });

  it('know the same kinds of a post of the circle and the same answers to an invitation as the server (P-X01)', () => {
    expect([...CIRCLE_POST_KINDS]).toEqual([...SERVER_CIRCLE_KINDS]);
    expect([...CIRCLE_ANSWERS]).toEqual([...SERVER_CIRCLE_ANSWERS]);
  });

  it('know the same statuses of a LIVE RELEASE entry and the same ways it ends as the server', () => {
    expect([...LIVE_ENTRY_STATUSES]).toEqual([...SERVER_LIVE_ENTRY_STATUSES]);
    expect([...LIVE_END_REASONS]).toEqual([...SERVER_LIVE_END_REASONS]);
  });

  it('know the same steps and channels of an order as the server (plan LIVE RELEASE+, choice 6)', () => {
    expect([...ORDER_STATUSES]).toEqual([...SERVER_ORDER_STATUSES]);
    expect([...ORDER_CHANNELS]).toEqual([...SERVER_ORDER_CHANNELS]);
  });

  it('are structurally compatible (checked by tsc)', () => {
    expect(typeof outcomeFits).toBe('function');
    expect(typeof inputFits).toBe('function');
    expect(typeof pieceFits).toBe('function');
    expect(typeof lookupFits).toBe('function');
    expect(typeof ownerCertificateFits).toBe('function');
    expect(typeof offerFits).toBe('function');
    expect(typeof cardFits).toBe('function');
    expect(typeof sheetFits).toBe('function');
    for (const fits of [dropCardFits, dropSheetFits, drawEntryFits, drawPageFits, clubEntryFits, clubStatusFits, circleCardFits, circleFeedFits, circlePostFits]) expect(typeof fits).toBe('function');
    for (const fits of [liveCardFits, liveSheetFits, liveEndedFits, liveRoomFits, liveEntryFits, liveAccessFits, liveInterestFits, liveMineFits, accountOrderFits, careGuideFits]) expect(typeof fits).toBe('function');
    expect(productKeysMatch).toBe(true);
  });
});
