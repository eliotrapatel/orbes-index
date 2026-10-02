/**
 * What each admin role may do, mirroring the server guard (contract §3:
 * AUDITOR reads, OPERATOR mutates, ADMIN for keys, revocation,
 * reinstatement, categories and console users). Every role changes its own
 * password and second factor. The server is the authority; the console
 * only hides controls a role cannot use, so nobody is offered a button that
 * will answer 403.
 */
import type { AdminRole } from '../types.js';

export const ROLE_RANK: Readonly<Record<AdminRole, number>> = Object.freeze({ AUDITOR: 1, OPERATOR: 2, ADMIN: 3 });

export const CAPABILITY_MIN_ROLE = Object.freeze({
  read: 'AUDITOR',
  verifyAudit: 'AUDITOR',
  issue: 'OPERATOR',
  transition: 'OPERATOR',
  reissueCode: 'OPERATOR',
  /** Artifact downloads produce printable, verifying codes (server: OPERATOR). */
  download: 'OPERATOR',
  warranty: 'OPERATOR',
  service: 'OPERATOR',
  confirmOwnership: 'OPERATOR',
  triageAnomaly: 'OPERATOR',
  createCatalog: 'OPERATOR',
  /** Revoking or retiring a product (both end its public validity; RETIRED is terminal). */
  revokeProduct: 'ADMIN',
  reinstate: 'ADMIN',
  revokeCode: 'ADMIN',
  createRevocation: 'ADMIN',
  manageKeys: 'ADMIN',
  createCategory: 'ADMIN',
  /** Console users (Team page): create staff accounts, roles, disable and enable, unlock, sessions, reset a lost second factor. */
  manageAdmins: 'ADMIN',
} as const satisfies Record<string, AdminRole>);

export type Capability = keyof typeof CAPABILITY_MIN_ROLE;

export function hasRole(role: AdminRole | null | undefined, min: AdminRole): boolean {
  if (!role) return false;
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[min];
}

export function can(role: AdminRole | null | undefined, cap: Capability): boolean {
  return hasRole(role, CAPABILITY_MIN_ROLE[cap]);
}
