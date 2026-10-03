/**
 * The web app declares the wire types of the public API itself (it must not
 * import server modules). These checks keep both sides in step: the
 * assignments below fail `tsc` if the server's outcome stops fitting the
 * browser's type, and the runtime checks compare the state lists.
 */
import { describe, expect, it } from 'vitest';
import { DROP_ENTRY_STATUSES as SERVER_ENTRY_STATUSES, REPORT_CHANNELS as SERVER_CHANNELS, VERIFICATION_STATES as SERVER_STATES } from '../../src/server/db/schema.js';
import type { ClubStatus as ServerClubStatus } from '../../src/server/services/club.js';
import {
  DROP_STATES as SERVER_DROP_STATES,
  type AccountDropEntry as ServerAccountDropEntry,
  type DrawEntry as ServerDrawEntry,
  type DropCard as ServerDropCard,
  type DropSheet as ServerDropSheet,
} from '../../src/server/services/drops.js';
import type { Page } from '../../src/server/types.js';
import { INCIDENT_TYPES as SERVER_INCIDENTS, type OwnedProduct } from '../../src/server/services/ownership.js';
import type {
  CertificateLookup as ServerCertificateLookup,
  CertificateOffer as ServerCertificateOffer,
  OwnerCertificate as ServerOwnerCertificate,
} from '../../src/server/services/ownership-certificates.js';
import type { LookbookCard as ServerLookbookCard, LookbookSheet as ServerLookbookSheet } from '../../src/server/services/lookbook.js';
import type { VerifyInput as ServerVerifyInput, VerifyOutcome as ServerVerifyOutcome } from '../../src/server/services/verification.js';
import {
  DROP_ENTRY_STATUSES,
  DROP_STATES,
  INCIDENT_TYPES,
  REPORT_CHANNELS,
  VERIFICATION_STATES,
  type ClubEntry,
  type ClubStatus,
  type DrawEntriesPage,
  type DrawEntry,
  type DropCard,
  type DropSheet,
  type CertificateLookup,
  type CertificateOffer,
  type LookbookCard,
  type LookbookSheet,
  type OwnedPiece,
  type OwnerCertificate,
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
// …and the releases' (P-R03): a release of the list, its page, its draw's entries, the account's entries and status.
export const dropCardFits = (c: Json<ServerDropCard>): DropCard => c;
export const dropSheetFits = (s: Json<ServerDropSheet>): DropSheet => s;
export const drawEntryFits = (e: Json<ServerDrawEntry>): DrawEntry => e;
export const drawPageFits = (p: Json<Page<ServerDrawEntry>>): DrawEntriesPage => p;
export const clubEntryFits = (e: Json<ServerAccountDropEntry>): ClubEntry => e;
export const clubStatusFits = (s: Json<ServerClubStatus>): ClubStatus => s;
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

  it('are structurally compatible (checked by tsc)', () => {
    expect(typeof outcomeFits).toBe('function');
    expect(typeof inputFits).toBe('function');
    expect(typeof pieceFits).toBe('function');
    expect(typeof lookupFits).toBe('function');
    expect(typeof ownerCertificateFits).toBe('function');
    expect(typeof offerFits).toBe('function');
    expect(typeof cardFits).toBe('function');
    expect(typeof sheetFits).toBe('function');
    for (const fits of [dropCardFits, dropSheetFits, drawEntryFits, drawPageFits, clubEntryFits, clubStatusFits]) expect(typeof fits).toBe('function');
    expect(productKeysMatch).toBe(true);
  });
});
