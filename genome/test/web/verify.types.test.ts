/**
 * The web app declares the wire types of the public API itself (it must not
 * import server modules). These checks keep both sides in step: the
 * assignments below fail `tsc` if the server's outcome stops fitting the
 * browser's type, and the runtime checks compare the state lists.
 */
import { describe, expect, it } from 'vitest';
import { REPORT_CHANNELS as SERVER_CHANNELS, VERIFICATION_STATES as SERVER_STATES } from '../../src/server/db/schema.js';
import { INCIDENT_TYPES as SERVER_INCIDENTS, type OwnedProduct } from '../../src/server/services/ownership.js';
import type {
  CertificateLookup as ServerCertificateLookup,
  CertificateOffer as ServerCertificateOffer,
  OwnerCertificate as ServerOwnerCertificate,
} from '../../src/server/services/ownership-certificates.js';
import type { VerifyInput as ServerVerifyInput, VerifyOutcome as ServerVerifyOutcome } from '../../src/server/services/verification.js';
import {
  INCIDENT_TYPES,
  REPORT_CHANNELS,
  VERIFICATION_STATES,
  type CertificateLookup,
  type CertificateOffer,
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

  it('are structurally compatible (checked by tsc)', () => {
    expect(typeof outcomeFits).toBe('function');
    expect(typeof inputFits).toBe('function');
    expect(typeof pieceFits).toBe('function');
    expect(typeof lookupFits).toBe('function');
    expect(typeof ownerCertificateFits).toBe('function');
    expect(typeof offerFits).toBe('function');
  });
});
