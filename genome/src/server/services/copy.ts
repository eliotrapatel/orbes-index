/**
 * Public brand copy for verification results.
 *
 * Restrained by design: each message states only what the system proved (a
 * valid ORBES signature, a registry entry, a lifecycle status, a consistent
 * scan history). None claims that the physical object is genuine, because a
 * printed code can be copied. None reveals internal statuses, scores or why
 * a result was reached.
 */
import type { VerificationState } from '../db/schema.js';

export interface VerificationCopy {
  title: string;
  message: string;
}

export const VERIFICATION_COPY: Readonly<Record<VerificationState, Readonly<VerificationCopy>>> = Object.freeze({
  AUTHENTIC: Object.freeze({
    title: 'AUTHENTIC',
    message: 'This ORBES identity was issued and signed by ORBES and is registered to an active product.',
  }),
  AUTHENTIC_FIRST_REGISTRATION: Object.freeze({
    title: 'AUTHENTIC — FIRST REGISTRATION',
    message:
      'This ORBES identity was issued and signed by ORBES and has not yet been registered. You may register it to your ORBES account.',
  }),
  AUTHENTIC_REGISTERED: Object.freeze({
    title: 'AUTHENTIC — REGISTERED',
    message: 'This ORBES identity was issued and signed by ORBES and is registered to its owner.',
  }),
  AUTHENTIC_OWNERSHIP_VERIFIED: Object.freeze({
    title: 'AUTHENTIC — OWNERSHIP VERIFIED',
    message: 'This ORBES identity was issued and signed by ORBES and is registered to your account.',
  }),
  SUSPICIOUS_ACTIVITY: Object.freeze({
    title: 'UNUSUAL ACTIVITY DETECTED',
    message:
      'The activity recorded for this ORBES identity requires review. Please contact ORBES Client Services before relying on it.',
  }),
  REVOKED: Object.freeze({
    title: 'REVOKED',
    message: 'This ORBES identity is no longer valid. Please contact ORBES Client Services.',
  }),
  UNKNOWN: Object.freeze({
    title: 'UNKNOWN ORBES CODE',
    message: 'This code is not registered with ORBES. Please contact ORBES Client Services.',
  }),
  INVALID_SIGNATURE: Object.freeze({
    title: 'INVALID SIGNATURE',
    message: 'The signature of this code could not be verified against a valid ORBES key.',
  }),
  MALFORMED_CODE: Object.freeze({
    title: 'UNREADABLE CODE',
    message: 'This code could not be read. Please scan it again in even light, holding the camera steady.',
  }),
});

/** Owner-facing variant when the owner's own product shows unusual activity elsewhere. */
export const UNUSUAL_ACTIVITY_OWNER_COPY: Readonly<VerificationCopy> = Object.freeze({
  title: 'AUTHENTIC — OWNERSHIP VERIFIED',
  message:
    'This ORBES identity is registered to your account. Unusual activity has been recorded for it; ORBES Client Services can assist you.',
});

export function copyFor(state: VerificationState, notice?: 'UNUSUAL_ACTIVITY'): VerificationCopy {
  if (state === 'AUTHENTIC_OWNERSHIP_VERIFIED' && notice === 'UNUSUAL_ACTIVITY') return { ...UNUSUAL_ACTIVITY_OWNER_COPY };
  const c = VERIFICATION_COPY[state];
  if (!c) throw new TypeError(`copyFor: unknown state ${String(state)}`);
  return { ...c };
}
