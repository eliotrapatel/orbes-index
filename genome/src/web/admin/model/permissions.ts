/**
 * What each admin role may do, mirroring the server guard (contract §3:
 * AUDITOR reads, OPERATOR mutates, ADMIN for keys, revocation,
 * reinstatement, categories (created, activated, deactivated), console users,
 * points of sale, a customer's recovery code, lock and export, the draw
 * of a drop, a model discontinued or reinstated, a LIVE RELEASE ended now or
 * an entry removed from it, a release's test entrants sent, stopped and
 * ended, a returned piece archived, the settings of the
 * orders: their delays, the locations, the carriers and the shipping rates; a
 * conversation of the Messages board assigned; THE PROGRAM of the club's tiers; the defaults of THE HOUSE'S
 * GUARANTEE). Every role
 * changes its own password and second factor. RETAIL (A-08), under AUDITOR,
 * only sells: the sale mode and the list of points of sale it picks from.
 * The sale mode names its roles (CAPABILITY_ROLES): RETAIL, OPERATOR and
 * ADMIN; the read-only AUDITOR, though above RETAIL, does not sell.
 * LOGISTICS (plan NEXT LOT §3.5.6.1), a person at the logistics agent ranked
 * with RETAIL, gets the Logistics page of its own locations and its own
 * account, nothing else (`logisticsOnly`).
 * The server is the authority; the console only hides controls a role
 * cannot use, so nobody is offered a button that will answer 403.
 */
import type { AdminRole } from '../types.js';

/** As http/sessions.ts: a role unknown to this table ranks 0 and is refused everywhere. */
export const ROLE_RANK: Readonly<Record<AdminRole, number>> = Object.freeze({ RETAIL: 1, LOGISTICS: 1, AUDITOR: 2, OPERATOR: 3, ADMIN: 4 });

export const CAPABILITY_MIN_ROLE = Object.freeze({
  /** The sale mode (#/sale): scan the piece, choose the point of sale, start the warranty. Exactly CAPABILITY_ROLES.sell. */
  sell: 'RETAIL',
  read: 'AUDITOR',
  /** Growth (plan NEXT-NINE, BP-29): the report and COLLECTORS BY VALUE, the emails masked for an AUDITOR; never RETAIL. */
  readGrowth: 'AUDITOR',
  verifyAudit: 'AUDITOR',
  /** Customers' emails in clear (the server masks them for an AUDITOR: j***@example.com). */
  readClientEmails: 'OPERATOR',
  /** The Generator (plan NEXT LOT §3.5.4.5, step 5.13): ADMIN only, for one-offs; its pieces never enter Logistics' stock. */
  issue: 'ADMIN',
  transition: 'OPERATOR',
  reissueCode: 'OPERATOR',
  /** NEW CLAIM CODE (plan NEXT LOT §3.4): a lost card's code replaced for a piece not registered yet ("OPERATOR too"). */
  renewClaimCode: 'OPERATOR',
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
  /**
   * The Club's drops (P-R03): create, edit, publish and cancel a drop; conclude an entry, offer the next place. And its
   * LIVE RELEASES: their settings, silhouette, board link, publication and cancellation; the live controls (pause, resume,
   * extend, add pieces, free a hold, let in, a host message); Client Services' outcome of a reservation.
   */
  manageDrops: 'OPERATOR',
  /** The draw of a drop (P-R03), once, after its entries close: ADMIN, with a phrase to type. */
  drawDrop: 'ADMIN',
  /** END NOW of a LIVE RELEASE: no new turn, the line ended; ADMIN, with a phrase to type. */
  endLiveRelease: 'ADMIN',
  /** Remove an entry from a LIVE RELEASE (its place, or the piece it holds, to the next in line): ADMIN. */
  removeLiveEntry: 'ADMIN',
  /**
   * Test entrants (plan TEST ENTRANTS): SEND TEST ENTRANTS and ADD MORE (a phrase to type), STOP, CONFIRM or RELEASE a
   * test entrant by hand, END TEST (a phrase to type): ADMIN. An AUDITOR and an OPERATOR read the tests and the server.
   */
  runTestEntrants: 'ADMIN',
  /** The Club's circle (P-X01): write, publish and withdraw a post, set its photographs. */
  manageCircle: 'OPERATOR',
  /** The Club's tiers (P-X04): the words of each tier's benefits (never its threshold). */
  manageClubTiers: 'OPERATOR',
  /** THE PROGRAM (plan NEXT-NINE, BP-19 T2): every figure of the tiers' benefits (never a threshold). */
  manageClubProgram: 'ADMIN',
  /** The Club's requests (P-X08): close a request of the private salon, with a note. */
  closeShopRequest: 'OPERATOR',
  /** The Messages board (CS-01): answer a conversation, take it, close it. */
  answerMessages: 'OPERATOR',
  /** The Messages board (CS-01): assign a conversation to an active OPERATOR or ADMIN. */
  assignMessages: 'ADMIN',
  /** The Yearly care board (BP-19 T6): send the prepaid label, receive the piece, ship it back, complete, cancel. */
  manageCare: 'OPERATOR',
  /** THE HOUSE'S GUARANTEE (IN-01): grant one from the client sheet, change it, revoke it. */
  grantGuarantee: 'OPERATOR',
  /** THE HOUSE'S GUARANTEE (IN-01): the Grant dialog's defaults in Orders → Settings. */
  manageGuaranteeSettings: 'ADMIN',
  /**
   * The orders (plan LIVE RELEASE+): their steps (paid, shipped, delivered, cancelled), their location, terms and buyer,
   * the piece picked from the stock; the buyer's details in clear (an AUDITOR reads them masked).
   */
  manageOrders: 'OPERATOR',
  /** A return to the archive: its piece RETIRED, which verifies as REVOKED (revocation-class, as revokeProduct). */
  archiveReturn: 'ADMIN',
  /** The settings of the orders: the delays after which an order is late, the locations, the carriers and their tracking links, the shipping rates. */
  manageLogistics: 'ADMIN',
  /** Supplier orders (plan NEXT LOT §3.5.4.2): the suppliers added and changed, a model's supplier set; never LOGISTICS. */
  manageSupplierOrders: 'OPERATOR',
  /**
   * Logistics (plan NEXT LOT §3.5.6.1): act on the receptions, the packing and shipping, the returns received. Exactly
   * CAPABILITY_ROLES.logistics: the agent (LOGISTICS), OPERATOR and ADMIN.
   */
  logistics: 'OPERATOR',
  /** Logistics: read the stock, the receptions, the orders to ship. Exactly CAPABILITY_ROLES.readLogistics: the agent and AUDITOR and up. */
  readLogistics: 'AUDITOR',
  /** Logistics (plan NEXT LOT §3.5.4.1): a reception confirmed (the identities issued) or sent back to the agent. */
  confirmReceptions: 'OPERATOR',
  /** Logistics (plan NEXT LOT §3.5.4.1): the agent's corrections approved or declined, with a note. */
  approveCorrections: 'OPERATOR',
  /** Logistics: transfer, minimum, a count corrected at once, pieces counted in (ORBES is the approver). */
  manageStock: 'OPERATOR',
  /** Order cases (plan NEXT LOT §3.5.4.4): a parcel problem decided (ship another piece, or refund). */
  decideParcels: 'OPERATOR',
  /** Order cases: a return or a size exchange decided (refund, or ship the other size). */
  decideReturns: 'OPERATOR',
  /** Order cases: a lost parcel decided, its pieces revoked: ADMIN, as revoking anywhere in the console. */
  decideLostParcel: 'ADMIN',
  /** The segments (plan LIVE RELEASE+, choice 27): built, renamed, changed and deleted; an AUDITOR reads them and their CSV, masked. */
  manageSegments: 'OPERATOR',
  /** Discontinue a model (P-R06: inactive, said DISCONTINUED on its pieces' results) and reinstate it: ADMIN, with a phrase to type. */
  discontinueModel: 'ADMIN',
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
  /** The Sign-up page (plan CUSTOMER INTELLIGENCE §3.1 P.10): the answers to « How did you hear about ORBES? » added, renamed, moved, set aside. */
  manageHeardOptions: 'ADMIN',
  /** Links (plan CUSTOMER INTELLIGENCE §3.4 A.10): the page, a link's page and the collectors behind a figure, emails masked for an AUDITOR. */
  readLinks: 'AUDITOR',
  /** Links: New link, Edit, Archive and Unarchive, the Channels (added, renamed, moved, removed while unused). */
  manageLinks: 'OPERATOR',
} as const satisfies Record<string, AdminRole>);

export type Capability = keyof typeof CAPABILITY_MIN_ROLE;

/**
 * Capabilities held by exactly these roles rather than by a rank and above (the server's `roles` guard). The sale
 * mode starts warranties: the seller's, and every role that mutates, but not the read-only AUDITOR.
 */
export const CAPABILITY_ROLES: Readonly<Partial<Record<Capability, readonly AdminRole[]>>> = Object.freeze({
  sell: Object.freeze(['RETAIL', 'OPERATOR', 'ADMIN'] as const),
  /** As routes/admin/logistics.ts LOGISTICS_ACT and LOGISTICS_READ (plan NEXT LOT §3.5.6.1). */
  logistics: Object.freeze(['LOGISTICS', 'OPERATOR', 'ADMIN'] as const),
  readLogistics: Object.freeze(['LOGISTICS', 'AUDITOR', 'OPERATOR', 'ADMIN'] as const),
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

/** The agent's console (LOGISTICS, plan NEXT LOT §3.5.3): the Logistics page of its locations and its own account, nothing else. */
export function logisticsOnly(role: AdminRole | null | undefined): boolean {
  return can(role, 'readLogistics') && !can(role, 'read');
}
