/**
 * What each admin role may do, mirroring the server guard (contract §3:
 * AUDITOR reads, OPERATOR mutates, ADMIN for keys, revocation,
 * reinstatement, categories, console users and points of sale). Every role
 * changes its own password and second factor. RETAIL (A-08), under AUDITOR,
 * only sells: the sale mode and the list of points of sale it picks from.
 * The server is the authority; the console only hides controls a role
 * cannot use, so nobody is offered a button that will answer 403.
 */
import type { AdminRole } from '../types.js';

/** As http/sessions.ts: a role unknown to this table ranks 0 and is refused everywhere. */
export const ROLE_RANK: Readonly<Record<AdminRole, number>> = Object.freeze({ RETAIL: 1, AUDITOR: 2, OPERATOR: 3, ADMIN: 4 });

export const CAPABILITY_MIN_ROLE = Object.freeze({
  /** The sale mode (#/sale): scan the piece, choose the point of sale, start the warranty. */
  sell: 'RETAIL',
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
  /** The register of points of sale: create, rename, deactivate (everyone who reads sees it). */
  manageRetailers: 'ADMIN',
} as const satisfies Record<string, AdminRole>);

export type Capability = keyof typeof CAPABILITY_MIN_ROLE;

export function hasRole(role: AdminRole | null | undefined, min: AdminRole): boolean {
  if (!role) return false;
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[min];
}

export function can(role: AdminRole | null | undefined, cap: Capability): boolean {
  return hasRole(role, CAPABILITY_MIN_ROLE[cap]);
}

/** A seller's console (RETAIL): the sale mode and its own account, nothing of the registry. */
export function saleOnly(role: AdminRole | null | undefined): boolean {
  return can(role, 'sell') && !can(role, 'read');
}
