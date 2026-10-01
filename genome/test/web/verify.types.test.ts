/**
 * The web app declares the wire types of the public API itself (it must not
 * import server modules). These checks keep both sides in step: the
 * assignments below fail `tsc` if the server's outcome stops fitting the
 * browser's type, and the runtime checks compare the state lists.
 */
import { describe, expect, it } from 'vitest';
import { VERIFICATION_STATES as SERVER_STATES } from '../../src/server/db/schema.js';
import type { VerifyInput as ServerVerifyInput, VerifyOutcome as ServerVerifyOutcome } from '../../src/server/services/verification.js';
import { VERIFICATION_STATES, type VerifyInput, type VerifyOutcome } from '../../src/web/verify/types.js';

// Compile-time: every server outcome is a valid web outcome, every web request a valid server input.
export const outcomeFits = (o: ServerVerifyOutcome): VerifyOutcome => o;
export const inputFits = (i: VerifyInput): ServerVerifyInput => i;

describe('verify wire types', () => {
  it('know the same verification states as the server', () => {
    expect([...VERIFICATION_STATES].sort()).toEqual([...SERVER_STATES].sort());
  });

  it('are structurally compatible (checked by tsc)', () => {
    expect(typeof outcomeFits).toBe('function');
    expect(typeof inputFits).toBe('function');
  });
});
