/**
 * What each admin role may do, mirroring the server guard (contract §3:
 * AUDITOR reads, OPERATOR mutates, ADMIN for keys, revocation,
 * reinstatement, categories (created, activated, deactivated), console users,
 * points of sale, a customer's recovery code, lock and export, and the draw
 * of a drop). Every role
 * changes its own password and second factor. RETAIL (A-08), under AUDITOR,
 * only sells: the sale mode and the list of points of sale it picks from.
 * The sale mode names its roles (CAPABILITY_ROLES): RETAIL, OPERATOR and
 * ADMIN; the read-only AUDITOR, though above RETAIL, does not sell.
 * The server is the authority; the console only hides controls a role
 * cannot use, so nobody is offered a button that will answer 403.
 */
import type { AdminRole } from '../types.js';

/** As http/sessions.ts: a role unknown to this table ranks 0 and is refused everywhere. */
export const ROLE_RANK: Readonly<Record<AdminRole, number>> = Object.freeze({ RETAIL: 1, AUDITOR: 2, OPERATOR: 3, ADMIN: 4 });

export const CAPABILITY_MIN_ROLE = Object.freeze({
  /** The sale mode (#/sale): scan the piece, choose the point of sale, start the warranty. Exactly CAPABILITY_ROLES.sell. */
  sell: 'RETAIL',
  read: 'AUDITOR',
  verifyAudit: 'AUDITOR',
  /** Customers' emails in clear (the server masks them for an AUDITOR: j***@example.com). */
  readClientEmails: 'OPERATOR',
  issue: 'OPERATOR',
  transition: 'OPERATOR',
  reissueCode: 'OPERATOR',
  /** Artifact downloads produce printable, verifying codes (server: OPERATOR). */
  download: 'OPERATOR',
  warranty: 'OPERATOR',
  service: 'OPERATOR',
  confirmOwnership: 'OPERATOR',
  triageAnomaly: 'OPERATOR',
  /** Close a case of the Cases queue, with a note (a customer's report on a scan). */
  closeCase: 'OPERATOR',
  createCatalog: 'OPERATOR',
  /** Edit a model (name, material, care, collection, active) or rename a collection: read live by /verify (A-10). */
  editCatalog: 'OPERATOR',
  /** Set or remove a model's reference photograph or the photograph of a piece (F-04): shown on /verify. */
  photograph: 'OPERATOR',
  /** The Club's drops (P-R03): create, edit, publish and cancel a drop; conclude an entry, offer the next place. */
  manageDrops: 'OPERATOR',
  /** The draw of a drop (P-R03), once, after its entries close: ADMIN, with a phrase to type. */
  drawDrop: 'ADMIN',
  /** The Club's circle (P-X01): write, publish and withdraw a post, set its photographs. */
  manageCircle: 'OPERATOR',
  /** Revoking or retiring a product (both end its public validity; RETIRED is terminal). */
  revokeProduct: 'ADMIN',
  reinstate: 'ADMIN',
  revokeCode: 'ADMIN',
  createRevocation: 'ADMIN',
  manageKeys: 'ADMIN',
  createCategory: 'ADMIN',
  /** Deactivate a category (no new piece in it) or activate it again. */
  activateCategory: 'ADMIN',
  /** Console users (Team page): create staff accounts, roles, disable and enable, unlock, sessions, reset a lost second factor. */
  manageAdmins: 'ADMIN',
  /** The register of points of sale: create, rename, deactivate (everyone who reads sees it). */
  manageRetailers: 'ADMIN',
  /** A one-time recovery code for a client who forgot the password (after an identity check). */
  issueRecoveryCode: 'ADMIN',
  /** Lock a client's account (sessions end, pending transfers cancelled, certificate links withdrawn) and unlock it. */
  lockAccount: 'ADMIN',
  /** Everything held about a client's account, for a request under the right of access. */
  exportAccount: 'ADMIN',
} as const satisfies Record<string, AdminRole>);

export type Capability = keyof typeof CAPABILITY_MIN_ROLE;

/**
 * Capabilities held by exactly these roles rather than by a rank and above (the server's `roles` guard). The sale
 * mode starts warranties: the seller's, and every role that mutates, but not the read-only AUDITOR.
 */
export const CAPABILITY_ROLES: Readonly<Partial<Record<Capability, readonly AdminRole[]>>> = Object.freeze({
  sell: Object.freeze(['RETAIL', 'OPERATOR', 'ADMIN'] as const),
});

export function hasRole(role: AdminRole | null | undefined, min: AdminRole): boolean {
  if (!role) return false;
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[min];
}

export function can(role: AdminRole | null | undefined, cap: Capability): boolean {
  const exact = CAPABILITY_ROLES[cap];
  if (exact) return !!role && role in ROLE_RANK && exact.includes(role);
  return hasRole(role, CAPABILITY_MIN_ROLE[cap]);
}

/** A seller's console (RETAIL): the sale mode and its own account, nothing of the registry. */
export function saleOnly(role: AdminRole | null | undefined): boolean {
  return can(role, 'sell') && !can(role, 'read');
}
