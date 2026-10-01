/**
 * JSON shapes of the admin API (PLATFORM-CONTRACTS §3), as the browser sees
 * them: dates arrive as ISO strings, byte fields as hex/base64url strings.
 *
 * The enum lists mirror src/server/db/schema.ts. They are duplicated rather
 * than imported because server modules are Node-only and must never enter
 * the browser bundle; test/web/admin.model.test.ts asserts they stay equal.
 */

export const PRODUCT_STATUSES = [
  'ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED', 'TRANSFERRED', 'SERVICED',
  'RESOLD', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const OWNERSHIP_STATES = ['UNREGISTERED', 'REGISTERED', 'OWNED', 'TRANSFER_PENDING'] as const;
export type OwnershipState = (typeof OWNERSHIP_STATES)[number];

export const KEY_STATUSES = ['ACTIVE', 'RETIRED', 'REVOKED'] as const;
export type KeyStatus = (typeof KEY_STATUSES)[number];

export const CODE_STATUSES = ['ACTIVE', 'SUPERSEDED', 'REVOKED'] as const;
export type CodeStatus = (typeof CODE_STATUSES)[number];

export const ADMIN_ROLES = ['ADMIN', 'OPERATOR', 'AUDITOR'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const SERVICE_TYPES = ['INSPECTION', 'CLEANING', 'POLISH', 'RESIZE', 'REPAIR', 'REPLACEMENT', 'AUTHENTICATION'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const VERIFICATION_STATES = [
  'AUTHENTIC', 'AUTHENTIC_FIRST_REGISTRATION', 'AUTHENTIC_REGISTERED', 'AUTHENTIC_OWNERSHIP_VERIFIED',
  'SUSPICIOUS_ACTIVITY', 'REVOKED', 'UNKNOWN', 'INVALID_SIGNATURE', 'MALFORMED_CODE',
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const ANOMALY_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type AnomalySeverity = (typeof ANOMALY_SEVERITIES)[number];

export const ANOMALY_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'] as const;
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number];

export const REVOCATION_TARGET_TYPES = ['CODE', 'PRODUCT', 'KEY'] as const;
export type RevocationTargetType = (typeof REVOCATION_TARGET_TYPES)[number];

export const WARRANTY_STATUSES = ['NOT_STARTED', 'ACTIVE', 'EXPIRED', 'VOID'] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

/** Authenticator kinds a product policy may combine (contract §2.11); only PRINTED_CODE is implemented. */
export const AUTH_POLICY_KINDS = ['PRINTED_CODE', 'SECURE_NFC', 'SECURE_ELEMENT', 'TAMPER_EVIDENT'] as const;

export const ARTIFACT_THEMES = ['black', 'inverted', 'ivory'] as const;
export type ArtifactTheme = (typeof ARTIFACT_THEMES)[number];
export type ArtifactFormat = 'svg' | 'png' | 'pdf';

type Iso = string;

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Items<T> {
  items: T[];
}

// ── Auth ───────────────────────────────────────────────────────────────────

export interface AdminProfile {
  id: string;
  email: string;
  role: AdminRole;
  totpEnabled: boolean;
}

export interface AdminSession {
  admin: AdminProfile;
  csrfToken: string;
  mfaPassed: boolean;
  mfaRequired: boolean;
}

export interface TotpEnrollment {
  secret: string;
  otpauthUri: string;
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export interface DashboardData {
  generatedAt: Iso;
  products: { total: number; byStatus: Record<ProductStatus, number> };
  scans: { last24h: number; last7d: number };
  anomalies: { open: number; openBySeverity: Record<AnomalySeverity, number> };
  activeKey: { keyId: number; kid: string; activatedAt: Iso | null } | null;
  recentEvents: {
    scanId: string;
    occurredAt: Iso;
    eventType: string;
    state: string;
    productId: string | null;
    country: string | null;
  }[];
}

// ── Catalogue ──────────────────────────────────────────────────────────────

export interface Category {
  index: number;
  code: string;
  name: string;
  warrantyMonths: number;
  active: boolean;
  createdAt: Iso;
}

export interface Collection {
  id: string;
  name: string;
  models: number;
  createdAt: Iso;
}

export interface Model {
  id: string;
  name: string;
  type: string;
  skuPrefix: string;
  category: { index: number; code: string; name: string };
  collection: { id: string; name: string | null } | null;
  defaultMaterial: string | null;
  careInstructions: string | null;
  createdAt: Iso;
}

// ── Products, genomes, codes ───────────────────────────────────────────────

export interface ProductOverview {
  id: string;
  productId: string;
  sku: string;
  category: string;
  categoryCode: string;
  collection: string | null;
  model: string;
  modelType: string;
  variant: string | null;
  material: string;
  productionBatch: string | null;
  productionDate: string | null;
  genomeId: string | null;
  genomePattern: string | null;
  genomeFingerprint: string | null;
  codeId: string | null;
  codeVersion: number | null;
  codeIssue: number | null;
  status: ProductStatus;
  ownershipState: OwnershipState;
  warrantyStart: string | null;
  warrantyEnd: string | null;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface ProductJson {
  id: string;
  productId: string;
  packedIdentity: number;
  year: number;
  categoryIndex: number;
  categoryCode: string;
  serial: number;
  sku: string;
  modelId: string;
  collectionId: string | null;
  variant: string | null;
  material: string;
  productionBatch: string | null;
  productionDate: string | null;
  status: ProductStatus;
  ownershipState: OwnershipState;
  authPolicy: string;
  hasClaimSecret: boolean;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface GenomeJson {
  id: string;
  productId: string;
  version: number;
  versionLabel: string;
  value: number;
  glyphs: number[];
  ids: string[];
  pattern: string;
  fingerprint: string;
  createdAt: Iso;
}

export interface CodeJson {
  id: string;
  productId: string;
  keyId: number;
  codeVersion: number;
  issue: number;
  issuedDay: number;
  issuedAt: string;
  nonce: string;
  payloadHash: string;
  status: CodeStatus;
  revokedAt: Iso | null;
  revocationReason: string | null;
  createdAt: Iso;
}

/** OPERATOR responses (issue, re-issue) carry the scannable base64url data once. */
export interface IssuedCodeJson extends CodeJson {
  data: string;
}

export type LiveCodeCheck = { valid: true; keyStatus: string } | { valid: false; reason: string; keyStatus: string | null };

export interface IssueResponse {
  product: ProductJson;
  genome: GenomeJson;
  code: IssuedCodeJson;
  claimCode?: string;
}

export interface IssueInput {
  categoryCode: string;
  modelId: string;
  material: string;
  year?: number;
  collectionId?: string;
  sku?: string;
  variant?: string;
  productionBatch?: string;
  productionDate?: string;
  serial?: number;
  withClaimSecret?: boolean;
  authPolicy?: string;
}

export interface StatusHistoryEntry {
  id: string;
  from: ProductStatus | null;
  to: ProductStatus;
  reason: string | null;
  actorType: string;
  actorId: string | null;
  at: Iso;
}

export interface StatusChange {
  id: string;
  productId: string;
  from: ProductStatus;
  to: ProductStatus;
  reason: string | null;
  at: Iso;
}

export interface LifecycleSnapshot {
  status: ProductStatus;
  allowed: ProductStatus[];
  returnTo: ProductStatus | null;
  canReinstate: boolean;
}

export interface CurrentOwner {
  accountId: string;
  acquiredVia: string;
  verified: boolean;
  since: Iso;
  transferPending: boolean;
}

export interface OwnershipHistoryEntry {
  id: string;
  accountId: string;
  email: string;
  displayName: string | null;
  acquiredVia: string;
  verified: boolean;
  startedAt: Iso;
  endedAt: Iso | null;
  endedReason: string | null;
}

export interface TransferRecord {
  id: string;
  fromAccountId: string;
  toAccountId: string | null;
  status: string;
  createdAt: Iso;
  expiresAt: Iso;
  completedAt: Iso | null;
}

export interface WarrantyRecord {
  productId: string;
  purchaseDate: string | null;
  retailer: string | null;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  durationMonths: number;
  voidedAt: Iso | null;
  voidReason: string | null;
  status: WarrantyStatus;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface ServiceRecord {
  id: string;
  productId: string;
  type: ServiceType;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  location: string | null;
  notes: string | null;
  openedAt: Iso;
  closedAt: Iso | null;
  performedBy: string | null;
}

export interface AnomalyRecord {
  id: string;
  productId: string | null;
  productUuid: string | null;
  codeId: string | null;
  type: string;
  severity: AnomalySeverity;
  riskScore: number;
  details: Record<string, unknown>;
  status: AnomalyStatus;
  occurrences: number;
  firstSeenAt: Iso;
  lastSeenAt: Iso;
  resolvedBy: string | null;
  resolvedAt: Iso | null;
  resolutionNote: string | null;
}

export interface ProductDetail {
  product: ProductJson & {
    category: { index: number; code: string; name: string };
    model: { id: string; name: string; type: string; skuPrefix: string; care: string | null };
    collection: string | null;
  };
  genome: GenomeJson | null;
  genomes: GenomeJson[];
  codes: (CodeJson & { verification: LiveCodeCheck })[];
  scans: { count: number; lastAt: Iso | null };
  ownership: { current: CurrentOwner | null; owners: OwnershipHistoryEntry[]; transfers: TransferRecord[] };
  warranty: WarrantyRecord | null;
  services: ServiceRecord[];
  anomalies: AnomalyRecord[];
  statusHistory: StatusHistoryEntry[];
  lifecycle: LifecycleSnapshot;
}

// ── Registries ─────────────────────────────────────────────────────────────

export interface ScanRecord {
  id: string;
  occurredAt: Iso;
  eventType: string;
  state: string;
  productId: string | null;
  codeId: string | null;
  packedIdentity: number | null;
  accountId: string | null;
  deviceHash: string | null;
  country: string | null;
  region: string | null;
  lat: number | null;
  lon: number | null;
  userAgentFamily: string | null;
  clientMetrics: Record<string, unknown> | null;
  latencyMs: number | null;
  authentication: {
    signatureValid: boolean;
    genomeCheck: string;
    keyId: number | null;
    reasons: string[];
    riskScore: number;
    authenticators: unknown;
  } | null;
}

export interface OwnerRecord {
  id: string;
  email: string;
  displayName: string | null;
  country: string | null;
  status: string;
  createdAt: Iso;
  products: number;
  productsEver: number;
}

export interface RevocationRecord {
  id: string;
  targetType: RevocationTargetType;
  targetId: string;
  reasonCode: string;
  reason: string | null;
  createdBy: string;
  createdAt: Iso;
  liftedAt: Iso | null;
  liftedBy: string | null;
}

export interface KeyJson {
  keyId: number;
  kid: string;
  alg: string;
  publicKey: string;
  status: KeyStatus;
  provider: string;
  createdAt: Iso;
  activatedAt: Iso | null;
  retiredAt: Iso | null;
  revokedAt: Iso | null;
  compromisedAt: Iso | null;
  revocationReason: string | null;
}

export interface AuditEntry {
  id: number;
  occurredAt: Iso;
  actorType: 'admin' | 'account' | 'system';
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  ipHash: string | null;
  prevHash: string;
  hash: string;
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  firstBadId?: number;
  head: { id: number; hash: string } | null;
}
