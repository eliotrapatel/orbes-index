import { describe, expect, it } from 'vitest';
import * as serverSchema from '../../src/server/db/schema.js';
import { ROLE_RANK as SERVER_ROLE_RANK } from '../../src/server/http/sessions.js';
import { ARTIFACT_DEFAULTS as SERVER_ARTIFACT_DEFAULTS, ARTIFACT_LIMITS as SERVER_ARTIFACT_LIMITS } from '../../src/server/render/artifact.js';
import { ARTIFACT_THEME_NAMES as SERVER_THEME_NAMES } from '../../src/server/render/scene.js';
import { ACTIVATABLE_STATUSES } from '../../src/server/services/warranty.js';
import { AUTH_POLICY_KINDS as SERVER_POLICY_KINDS } from '../../src/server/authenticators/index.js';
import { dashboardKpis, severityBars, statusBars } from '../../src/web/admin/model/dashboard.js';
import {
  ARTIFACT_DEFAULTS,
  ARTIFACT_LIMITS,
  ARTIFACT_SIZE_ADVICE,
  artifactSizeAdvice,
  buildArtifactOptions,
  buildPrintSheetOptions,
  isSheetSelectable,
  PRINT_SHEET_LIMITS,
  type PrintSheetForm,
  buildIssueInput,
  cellPitchNote,
  formatClaimCode,
  modelsFor,
  normalizePolicy,
  THEME_OPTIONS,
  type ArtifactForm,
  type IssueForm,
} from '../../src/web/admin/model/generator.js';
import { can, CAPABILITY_MIN_ROLE, ROLE_RANK } from '../../src/web/admin/model/permissions.js';
import { primaryCode, productActions, productAttributes, productSheet } from '../../src/web/admin/model/product.js';
import { chainVerdict, compromiseTime, confirmationPhrase, keyActions, phraseMatches, revocationTargetError, triageMoves } from '../../src/web/admin/model/registry.js';
import { toneOf } from '../../src/web/admin/model/tone.js';
import * as web from '../../src/web/admin/types.js';
import type { DashboardData, Model, ProductDetail } from '../../src/web/admin/types.js';

describe('admin enums mirror the server', () => {
  it('keeps every shared enum identical', () => {
    for (const name of [
      'PRODUCT_STATUSES',
      'OWNERSHIP_STATES',
      'KEY_STATUSES',
      'CODE_STATUSES',
      'ADMIN_ROLES',
      'SERVICE_TYPES',
      'VERIFICATION_STATES',
      'ANOMALY_SEVERITIES',
      'ANOMALY_STATUSES',
      'REVOCATION_TARGET_TYPES',
    ] as const) {
      expect([...web[name]], name).toEqual([...serverSchema[name]]);
    }
    expect([...web.AUTH_POLICY_KINDS]).toEqual([...SERVER_POLICY_KINDS]);
  });

  it('uses the server role ranks and artifact limits', () => {
    expect(ROLE_RANK).toEqual(SERVER_ROLE_RANK);
    for (const k of Object.keys(ARTIFACT_LIMITS) as (keyof typeof ARTIFACT_LIMITS)[]) expect(ARTIFACT_LIMITS[k], k).toBe(SERVER_ARTIFACT_LIMITS[k]);
    expect(ARTIFACT_DEFAULTS).toMatchObject({ widthMm: SERVER_ARTIFACT_DEFAULTS.widthMm, theme: SERVER_ARTIFACT_DEFAULTS.theme, dpi: SERVER_ARTIFACT_DEFAULTS.dpi });
    expect([...web.ARTIFACT_THEMES]).toEqual([...SERVER_THEME_NAMES]);
  });
});

describe('permissions', () => {
  it('follows AUDITOR < OPERATOR < ADMIN', () => {
    expect(can('AUDITOR', 'read')).toBe(true);
    expect(can('AUDITOR', 'issue')).toBe(false);
    expect(can('AUDITOR', 'download')).toBe(false);
    expect(can('OPERATOR', 'issue')).toBe(true);
    expect(can('OPERATOR', 'download')).toBe(true);
    expect(can('OPERATOR', 'manageKeys')).toBe(false);
    expect(can('OPERATOR', 'revokeProduct')).toBe(false);
    expect(can('ADMIN', 'manageKeys')).toBe(true);
    expect(can(null, 'read')).toBe(false);
    for (const cap of Object.keys(CAPABILITY_MIN_ROLE) as (keyof typeof CAPABILITY_MIN_ROLE)[]) expect(can('ADMIN', cap), cap).toBe(true);
  });
});

describe('tones', () => {
  it('reserves red for critical facts only', () => {
    expect(toneOf('severity', 'CRITICAL')).toBe('critical');
    expect(toneOf('verification', 'INVALID_SIGNATURE')).toBe('critical');
    const reds = serverSchema.PRODUCT_STATUSES.filter((s) => toneOf('product', s) === 'critical');
    expect(reds).toEqual([]);
    expect(toneOf('product', 'REVOKED')).toBe('alert');
    expect(toneOf('code', 'SUPERSEDED')).toBe('muted');
    expect(toneOf('product', 'SOMETHING_NEW')).toBe('outline');
    expect(toneOf('product', null)).toBe('muted');
  });
});

// ── Dashboard ──────────────────────────────────────────────────────────────

const dashboard: DashboardData = {
  generatedAt: '2026-10-01T12:00:00.000Z',
  products: {
    total: 30,
    byStatus: { ISSUED: 10, ACTIVATED: 0, REGISTERED: 0, OWNED: 20, TRANSFERRED: 0, SERVICED: 0, RESOLD: 0, RETIRED: 0, REVOKED: 0, COUNTERFEIT_FLAGGED: 0, LOST: 0, STOLEN: 0 },
  },
  scans: { last24h: 1520, last7d: 9001 },
  anomalies: { open: 3, openBySeverity: { LOW: 0, MEDIUM: 1, HIGH: 1, CRITICAL: 1 } },
  activeKey: { keyId: 2, kid: 'orbes-2026-10', activatedAt: '2026-10-01T00:00:00.000Z' },
  recentEvents: [],
};

describe('dashboard view model', () => {
  it('scales status bars to the largest value and keeps primary zero rows', () => {
    const rows = statusBars(dashboard.products.byStatus);
    expect(rows.map((r) => r.key)).toEqual(['ISSUED', 'ACTIVATED', 'REGISTERED', 'OWNED']);
    const owned = rows.find((r) => r.key === 'OWNED')!;
    expect(owned.fraction).toBe(1);
    expect(owned.share).toBe('67%');
    expect(rows.find((r) => r.key === 'ISSUED')!.fraction).toBe(0.5);
    expect(rows.find((r) => r.key === 'ACTIVATED')!.fraction).toBe(0);
    // A non-primary status appears as soon as it has products.
    expect(statusBars({ ...dashboard.products.byStatus, STOLEN: 1 }).map((r) => r.key)).toContain('STOLEN');
  });

  it('lists severities most severe first, all four always shown', () => {
    const rows = severityBars(dashboard.anomalies.openBySeverity);
    expect(rows.map((r) => r.key)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
    expect(rows[0].tone).toBe('critical');
    expect(severityBars({}).every((r) => r.fraction === 0 && r.share === '0%')).toBe(true);
  });

  it('flags a missing signing key and critical anomalies', () => {
    const k = dashboardKpis(dashboard);
    expect(k.map((x) => x.value)).toEqual(['30', '1 520', '3', '#2']);
    expect(k[2].tone).toBe('critical');
    const none = dashboardKpis({ ...dashboard, activeKey: null, anomalies: { open: 0, openBySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 } } });
    expect(none[3]).toMatchObject({ value: '—', tone: 'critical' });
    expect(none[2].tone).toBe('solid');
  });
});

// ── Product page ───────────────────────────────────────────────────────────

function detail(over: Partial<ProductDetail> = {}): ProductDetail {
  const base: ProductDetail = {
    product: {
      id: '11111111-1111-4111-8111-111111111111',
      productId: 'O26-J-00184',
      packedIdentity: 1,
      year: 2026,
      categoryIndex: 1,
      categoryCode: 'J',
      serial: 184,
      sku: 'MNL-RG-52',
      modelId: '22222222-2222-4222-8222-222222222222',
      collectionId: null,
      variant: '52',
      material: '925 STERLING SILVER',
      productionBatch: 'B-1',
      productionDate: '2026-09-01',
      status: 'OWNED',
      ownershipState: 'OWNED',
      authPolicy: 'PRINTED_CODE',
      hasClaimSecret: true,
      createdAt: '2026-09-02T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
      category: { index: 1, code: 'J', name: 'Jewelry' },
      model: { id: '22222222-2222-4222-8222-222222222222', name: 'MONOLITHE', type: 'RING', skuPrefix: 'MNL-RG', care: null },
      collection: 'ORBIT',
    },
    genome: {
      id: 'g',
      productId: 'O26-J-00184',
      version: 1,
      versionLabel: 'GENOME-01',
      value: 0x12345678,
      glyphs: [1, 2, 3, 4, 5, 6, 7, 8],
      ids: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      pattern: 'a·b·c·d·e·f·g·h',
      fingerprint: 'G1-1234-5678',
      createdAt: '2026-09-02T10:00:00.000Z',
    },
    genomes: [],
    codes: [
      {
        id: 'c1',
        productId: 'O26-J-00184',
        keyId: 1,
        codeVersion: 1,
        issue: 1,
        issuedDay: 1000,
        issuedAt: '2026-09-02',
        nonce: '01020304',
        payloadHash: 'ab'.repeat(32),
        status: 'SUPERSEDED',
        revokedAt: null,
        revocationReason: null,
        createdAt: '2026-09-02T10:00:00.000Z',
        verification: { valid: true, keyStatus: 'RETIRED' },
      },
      {
        id: 'c2',
        productId: 'O26-J-00184',
        keyId: 2,
        codeVersion: 1,
        issue: 2,
        issuedDay: 1001,
        issuedAt: '2026-09-03',
        nonce: '05060708',
        payloadHash: 'cd'.repeat(32),
        status: 'ACTIVE',
        revokedAt: null,
        revocationReason: null,
        createdAt: '2026-09-03T10:00:00.000Z',
        verification: { valid: true, keyStatus: 'ACTIVE' },
      },
    ],
    scans: { count: 14, lastAt: '2026-09-30T08:00:00.000Z' },
    ownership: {
      current: { accountId: 'acc', acquiredVia: 'FIRST_REGISTRATION', verified: true, since: '2026-09-04T00:00:00.000Z', transferPending: false },
      owners: [],
      transfers: [],
    },
    warranty: {
      productId: 'O26-J-00184',
      purchaseDate: '2026-09-04',
      retailer: 'ORBES PARIS',
      country: 'FR',
      startDate: '2026-09-04',
      endDate: '2028-09-04',
      durationMonths: 24,
      voidedAt: null,
      voidReason: null,
      status: 'ACTIVE',
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
    services: [],
    anomalies: [],
    statusHistory: [],
    lifecycle: { status: 'OWNED', allowed: ['TRANSFERRED', 'SERVICED', 'RESOLD', 'RETIRED', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'LOST', 'STOLEN'], returnTo: null, canReinstate: false },
  };
  return { ...base, ...over };
}

describe('product view model (spec §22)', () => {
  it('lays out the spec §22 sheet in order', () => {
    const rows = productSheet(detail());
    expect(rows.map((r) => r.label.toUpperCase())).toEqual(['PRODUCT', 'LIFECYCLE', 'GENOME', 'CODE STATUS', 'SIGNATURE', 'SCAN COUNT', 'OWNERSHIP', 'WARRANTY', 'ANOMALIES']);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.product.value).toBe('O26-J-00184');
    expect(by.genome).toMatchObject({ value: 'G1-1234-5678', mono: true });
    expect(by.code).toMatchObject({ value: 'ACTIVE', tone: 'solid' });
    expect(by.code.note).toContain('Issue 2');
    expect(by.signature).toMatchObject({ value: 'VALID', tone: 'solid' });
    expect(by.scans.value).toBe('14');
    expect(by.ownership.note).toContain('Verified');
    expect(by.warranty).toMatchObject({ value: 'ACTIVE' });
    expect(by.warranty.note).toBe('04 SEP 2026 → 04 SEP 2028');
    expect(by.anomalies).toMatchObject({ value: 'NONE', tone: 'solid' });
  });

  it('reports an invalid live signature and open critical anomalies in red', () => {
    const d = detail({
      anomalies: [
        { id: 'x', productId: 'O26-J-00184', productUuid: null, codeId: null, type: 'CODE_MISMATCH', severity: 'CRITICAL', riskScore: 100, details: {}, status: 'OPEN', occurrences: 1, firstSeenAt: '', lastSeenAt: '', resolvedBy: null, resolvedAt: null, resolutionNote: null },
        { id: 'y', productId: 'O26-J-00184', productUuid: null, codeId: null, type: 'SCAN_VELOCITY', severity: 'MEDIUM', riskScore: 35, details: {}, status: 'RESOLVED', occurrences: 1, firstSeenAt: '', lastSeenAt: '', resolvedBy: null, resolvedAt: null, resolutionNote: null },
      ],
    });
    d.codes[1] = { ...d.codes[1], verification: { valid: false, reason: 'SIGNATURE_INVALID', keyStatus: 'ACTIVE' } };
    const by = Object.fromEntries(productSheet(d).map((r) => [r.key, r]));
    expect(by.signature).toMatchObject({ value: 'INVALID', tone: 'critical', note: 'SIGNATURE INVALID' });
    expect(by.anomalies).toMatchObject({ value: '1 OPEN', tone: 'critical' });
  });

  it('handles a product without codes, owner or warranty', () => {
    const d = detail({ codes: [], warranty: null, ownership: { current: null, owners: [], transfers: [] }, genome: null });
    const by = Object.fromEntries(productSheet({ ...d, product: { ...d.product, ownershipState: 'UNREGISTERED' } }).map((r) => [r.key, r]));
    expect(by.code.value).toBe('NONE');
    expect(by.signature.value).toBe('—');
    expect(by.warranty).toMatchObject({ value: 'NOT STARTED', note: 'Not activated' });
    expect(by.ownership).toMatchObject({ value: 'UNREGISTERED', note: 'No registered owner' });
    expect(by.genome.value).toBe('NONE');
    expect(primaryCode([])).toBeNull();
  });

  it('picks the ACTIVE code, else the latest issue', () => {
    const d = detail();
    expect(primaryCode(d.codes)?.issue).toBe(2);
    expect(primaryCode(d.codes.map((c) => ({ ...c, status: 'REVOKED' as const })))?.issue).toBe(2);
  });

  it('offers actions by role and state', () => {
    const d = detail();
    const admin = productActions(d, 'ADMIN');
    expect(admin.transitions).toContain('REVOKED');
    expect(admin.revocableCodeId).toBe('c2');
    expect(admin.canReissue).toBe(true);
    expect(admin.canActivateWarranty).toBe(false); // already started
    expect(admin.canVoidWarranty).toBe(true);
    expect(admin.canOpenService).toBe(true);
    expect(admin.canConfirmOwnership).toBe(false); // verified

    const op = productActions(d, 'OPERATOR');
    expect(op.transitions).not.toContain('REVOKED');
    expect(op.transitions).not.toContain('RETIRED'); // terminal, verifies as REVOKED: ADMIN only
    expect(admin.transitions).toContain('RETIRED');
    expect(op.transitions).toContain('LOST');
    expect(op.revocableCodeId).toBeNull();
    expect(op.canDownload).toBe(true);

    const auditor = productActions(d, 'AUDITOR');
    expect(auditor).toMatchObject({ transitions: [], canReissue: false, canDownload: false, canVoidWarranty: false, canOpenService: false, revocableCodeId: null });
  });

  it('follows the server rules for warranty, re-issue and ownership confirmation', () => {
    const issued = detail({ warranty: null, lifecycle: { status: 'ISSUED', allowed: ['ACTIVATED'], returnTo: null, canReinstate: false } });
    expect(productActions(issued, 'OPERATOR').canActivateWarranty).toBe(true);
    for (const s of serverSchema.PRODUCT_STATUSES) {
      const d = detail({ warranty: null, lifecycle: { status: s, allowed: [], returnTo: null, canReinstate: false } });
      expect(productActions(d, 'OPERATOR').canActivateWarranty, s).toBe(ACTIVATABLE_STATUSES.includes(s));
    }
    const stolen = detail({ lifecycle: { status: 'STOLEN', allowed: ['OWNED', 'RETIRED'], returnTo: 'OWNED', canReinstate: false } });
    expect(productActions(stolen, 'OPERATOR').canReissue).toBe(false);
    const maxed = detail();
    maxed.codes[1] = { ...maxed.codes[1], issue: 255 };
    expect(productActions(maxed, 'OPERATOR').canReissue).toBe(false);
    const unverified = detail({ ownership: { current: { accountId: 'a', acquiredVia: 'FIRST_REGISTRATION', verified: false, since: '', transferPending: false }, owners: [], transfers: [] } });
    expect(productActions(unverified, 'OPERATOR').canConfirmOwnership).toBe(true);
    const revoked = detail({ lifecycle: { status: 'REVOKED', allowed: [], returnTo: 'OWNED', canReinstate: true } });
    expect(productActions(revoked, 'OPERATOR').canReinstate).toBe(false);
    expect(productActions(revoked, 'ADMIN').canReinstate).toBe(true);
  });

  it('lists catalogue attributes without cryptographic material', () => {
    const attrs = productAttributes(detail());
    expect(attrs.map((a) => a.label)).toContain('Production batch');
    expect(JSON.stringify(attrs)).not.toMatch(/payload|signature|nonce/i);
    expect(attrs.find((a) => a.label === 'Serial')?.value).toBe('00184');
  });
});

// ── Generator ──────────────────────────────────────────────────────────────

const form = (over: Partial<IssueForm> = {}): IssueForm => ({
  categoryCode: 'J',
  modelId: '22222222-2222-4222-8222-222222222222',
  collectionId: '',
  material: ' 925 STERLING SILVER ',
  variant: '',
  productionBatch: '',
  productionDate: '',
  year: '',
  serial: '',
  sku: '',
  authPolicy: 'PRINTED_CODE',
  withClaimSecret: false,
  ...over,
});
const NOW = new Date('2026-10-01T12:00:00Z');

describe('generator view model', () => {
  it('builds the minimal issue body, omitting empty optional fields', () => {
    const r = buildIssueInput(form(), NOW);
    expect(r).toEqual({ ok: true, value: { categoryCode: 'J', modelId: '22222222-2222-4222-8222-222222222222', material: '925 STERLING SILVER' } });
  });

  it('passes every optional field through when given', () => {
    const r = buildIssueInput(
      form({
        categoryCode: 'j',
        collectionId: '33333333-3333-4333-8333-333333333333',
        variant: '52',
        productionBatch: 'B-1',
        productionDate: '2026-09-30',
        year: '2026',
        serial: '184',
        sku: 'MNL-RG-52',
        authPolicy: 'printed_code+secure_nfc',
        withClaimSecret: true,
      }),
      NOW,
    );
    expect(r.ok && r.value).toEqual({
      categoryCode: 'J',
      modelId: '22222222-2222-4222-8222-222222222222',
      material: '925 STERLING SILVER',
      collectionId: '33333333-3333-4333-8333-333333333333',
      variant: '52',
      productionBatch: 'B-1',
      productionDate: '2026-09-30',
      year: 2026,
      serial: 184,
      sku: 'MNL-RG-52',
      authPolicy: 'PRINTED_CODE+SECURE_NFC',
      withClaimSecret: true,
    });
  });

  it('reports field errors', () => {
    const r = buildIssueInput(
      form({ categoryCode: '', modelId: 'x', material: '', productionDate: '2026-02-30', year: '1999', serial: '1.5', sku: '-bad', authPolicy: 'SECURE_NFC' }),
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['authPolicy', 'categoryCode', 'material', 'modelId', 'productionDate', 'serial', 'sku', 'year']);
    const future = buildIssueInput(form({ productionDate: '2026-10-05' }), NOW);
    expect(!future.ok && future.errors.productionDate).toMatch(/future/);
    const control = buildIssueInput(form({ variant: 'a\u0007b' }), NOW);
    expect(!control.ok && control.errors.variant).toBeTruthy();
  });

  it('normalises authentication policies like the server', () => {
    expect(normalizePolicy('')).toBe('PRINTED_CODE');
    expect(normalizePolicy(' printed_code + tamper_evident ')).toBe('PRINTED_CODE+TAMPER_EVIDENT');
    expect(normalizePolicy('SECURE_NFC')).toBeNull();
    expect(normalizePolicy('PRINTED_CODE+PRINTED_CODE')).toBeNull();
    expect(normalizePolicy('PRINTED_CODE+QUANTUM')).toBeNull();
  });

  it('filters models by category, sorted by name', () => {
    const m = (name: string, code: string) => ({ id: name, name, category: { code } }) as unknown as Model;
    expect(modelsFor([m('ZETA', 'J'), m('ALPHA', 'J'), m('BAG', 'L')], 'J').map((x) => x.name)).toEqual(['ALPHA', 'ZETA']);
  });

  it('validates artifact options within the server bounds', () => {
    const f = (o: Partial<ArtifactForm>): ArtifactForm => ({ widthMm: '30', theme: 'classic', label: false, decor: true, dpi: '', testPrint: false, kOnly: false, ...o });
    const ok = buildArtifactOptions(f({ widthMm: '25.555', theme: 'ivory', label: true, decor: false, dpi: '1200' }), 'png');
    expect(ok).toEqual({ ok: true, value: { widthMm: 25.56, theme: 'ivory', label: true, decor: false, dpi: 1200 } });
    const svg = buildArtifactOptions(f({ widthMm: '', theme: '', dpi: 'garbage' }), 'svg');
    expect(svg).toEqual({ ok: true, value: { widthMm: 30, theme: 'classic', label: false, decor: true } });
    expect(buildArtifactOptions(f({ widthMm: '9.5', testPrint: true }), 'pdf').ok).toBe(false); // under the server floor
    expect(buildArtifactOptions(f({ theme: 'neon' }), 'svg').ok).toBe(false);
    expect(buildArtifactOptions(f({ dpi: '71' }), 'png').ok).toBe(false);
    const huge = buildArtifactOptions(f({ widthMm: '500', dpi: '2400' }), 'png');
    expect(!huge.ok && huge.errors).toMatchObject({ dpi: expect.stringMatching(/too large/) });
    expect(cellPitchNote(30)).toBe('Cell pitch 0.60 mm');
    expect(cellPitchNote(Number.NaN)).toBe('');
  });

  it('names the colourways classic / inverted / ivory, labelled as in the brand system', () => {
    expect([...web.ARTIFACT_THEMES]).toEqual(['classic', 'inverted', 'ivory']);
    expect(ARTIFACT_DEFAULTS.theme).toBe('classic');
    expect(THEME_OPTIONS).toEqual([
      { value: 'classic', label: 'CLASSIC — BLACK ON WHITE' },
      { value: 'inverted', label: 'INVERTED — WHITE ON BLACK' },
      { value: 'ivory', label: 'IVORY — INK ON IVORY' },
    ]);
  });

  it('warns under 30 mm and refuses under 15 mm unless the file is marked as a test print', () => {
    const f = (widthMm: string, testPrint = false): ArtifactForm => ({ widthMm, theme: 'classic', label: false, decor: true, dpi: '', testPrint, kOnly: false });
    expect(ARTIFACT_SIZE_ADVICE).toEqual({ recommendedMinMm: 30, testPrintBelowMm: 15 });
    expect(artifactSizeAdvice(30, false)).toEqual({ level: 'ok' });
    expect(artifactSizeAdvice(25, false)).toEqual({ level: 'warn', message: expect.stringMatching(/below the 30 mm minimum/) });
    expect(artifactSizeAdvice(14.5, false)).toEqual({ level: 'refuse', message: expect.stringMatching(/Under 15 mm.*test print/) });
    expect(artifactSizeAdvice(14.5, true)).toEqual({ level: 'warn', message: expect.stringMatching(/test print/i) });
    expect(buildArtifactOptions(f('25'), 'pdf').ok).toBe(true);
    const refused = buildArtifactOptions(f('12'), 'pdf');
    expect(!refused.ok && refused.errors).toMatchObject({ widthMm: expect.stringMatching(/test print/) });
    expect(buildArtifactOptions(f('12', true), 'pdf')).toMatchObject({ ok: true, value: { widthMm: 12 } });
  });

  it('offers K-only black for PDF in the neutral colourways only', () => {
    const f = (o: Partial<ArtifactForm>): ArtifactForm => ({ widthMm: '30', theme: 'classic', label: false, decor: true, dpi: '', testPrint: false, kOnly: true, ...o });
    expect(buildArtifactOptions(f({}), 'pdf')).toEqual({ ok: true, value: { widthMm: 30, theme: 'classic', label: false, decor: true, kOnly: true } });
    expect(buildArtifactOptions(f({}), 'svg')).toEqual({ ok: true, value: { widthMm: 30, theme: 'classic', label: false, decor: true } });
    const ivory = buildArtifactOptions(f({ theme: 'ivory' }), 'pdf');
    expect(!ivory.ok && ivory.errors).toMatchObject({ kOnly: expect.stringMatching(/classic or inverted/) });
  });

  it('builds print-sheet options for 1 to 200 selected ACTIVE codes', () => {
    expect(PRINT_SHEET_LIMITS).toEqual({ maxCodes: 200, pages: ['A4', 'A3', 'LETTER'] });
    const f: PrintSheetForm = { widthMm: '', theme: 'classic', label: true, decor: true, dpi: '', testPrint: false, kOnly: false, page: 'A4' };
    expect(buildPrintSheetOptions(f, 2)).toEqual({ ok: true, value: { widthMm: 30, theme: 'classic', label: true, decor: true, page: 'A4' } });
    expect(buildPrintSheetOptions({ ...f, kOnly: true, page: 'A3' }, 2)).toEqual({ ok: true, value: { widthMm: 30, theme: 'classic', label: true, decor: true, page: 'A3', kOnly: true } });
    const none = buildPrintSheetOptions(f, 0);
    expect(!none.ok && none.errors).toMatchObject({ codes: expect.stringMatching(/Select/) });
    expect(buildPrintSheetOptions(f, 201).ok).toBe(false);
    expect(buildPrintSheetOptions({ ...f, page: 'B5' }, 1).ok).toBe(false);
    expect(buildPrintSheetOptions({ ...f, widthMm: '12' }, 1).ok).toBe(false); // test-print rule applies to sheets too
    expect(isSheetSelectable({ status: 'ACTIVE' })).toBe(true);
    for (const status of ['SUPERSEDED', 'REVOKED'] as const) expect(isSheetSelectable({ status })).toBe(false);
  });

  it('only an ADMIN manages console users', () => {
    expect(can('ADMIN', 'manageAdmins')).toBe(true);
    expect(can('OPERATOR', 'manageAdmins')).toBe(false);
  });

  it('groups claim codes for display', () => {
    expect(formatClaimCode('ABCD-EFGH-JKMN')).toBe('ABCD-EFGH-JKMN');
    expect(formatClaimCode('abcdefghjkmn')).toBe('ABCD-EFGH-JKMN');
    expect(formatClaimCode('short')).toBe('short');
  });
});

// ── Registry rules ─────────────────────────────────────────────────────────

describe('registry view rules', () => {
  it('offers the anomaly triage workflow', () => {
    expect(triageMoves('OPEN').map((m) => m.to)).toEqual(['ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']);
    expect(triageMoves('ACKNOWLEDGED').map((m) => m.to)).toEqual(['RESOLVED', 'DISMISSED', 'OPEN']);
    expect(triageMoves('RESOLVED')).toEqual([{ to: 'OPEN', label: 'Reopen', noteRequired: true }]);
    expect(triageMoves('OPEN').filter((m) => m.noteRequired).map((m) => m.to)).toEqual(['RESOLVED', 'DISMISSED']);
  });

  it('derives key actions and confirmation phrases', () => {
    expect(keyActions({ status: 'ACTIVE' })).toEqual({ canRetire: true, canRevoke: true, canAmend: false });
    expect(keyActions({ status: 'RETIRED' })).toEqual({ canRetire: false, canRevoke: true, canAmend: false });
    expect(keyActions({ status: 'REVOKED' })).toEqual({ canRetire: false, canRevoke: false, canAmend: true });
    expect(confirmationPhrase('revoke-key', 3)).toBe('REVOKE KEY 3');
    expect(confirmationPhrase('revoke-product', 'O26-J-00184')).toBe('REVOKE O26-J-00184');
    expect(confirmationPhrase('revoke-code', 2)).toBe('REVOKE ISSUE 2');
    expect(phraseMatches('  revoke   key 3 ', 'REVOKE KEY 3')).toBe(true);
    expect(phraseMatches('REVOKE KEY 4', 'REVOKE KEY 3')).toBe(false);
    expect(phraseMatches('', 'ROTATE')).toBe(false);
  });

  it('converts a UTC compromise time and refuses the future', () => {
    expect(compromiseTime('', NOW)).toEqual({ ok: true, iso: null });
    expect(compromiseTime('2026-09-30T08:15', NOW)).toEqual({ ok: true, iso: '2026-09-30T08:15:00.000Z' });
    expect(compromiseTime('2026-10-02T00:00', NOW).ok).toBe(false);
    expect(compromiseTime('yesterday', NOW).ok).toBe(false);
  });

  it('checks revocation targets by type', () => {
    expect(revocationTargetError('CODE', '11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(revocationTargetError('CODE', 'O26-J-00184')).toMatch(/UUID/);
    expect(revocationTargetError('PRODUCT', 'o26-j-00184')).toBeNull();
    expect(revocationTargetError('PRODUCT', 'ring')).toMatch(/product id/);
    expect(revocationTargetError('KEY', '255')).toBeNull();
    expect(revocationTargetError('KEY', '0')).toMatch(/1 to 255/);
    expect(revocationTargetError('KEY', '')).toBe('Enter the target.');
  });

  it('states the audit chain verdict', () => {
    expect(chainVerdict({ ok: true, checked: 1204, head: { id: 1204, hash: 'f'.repeat(64) } })).toMatchObject({ title: 'Chain intact', tone: 'solid' });
    expect(chainVerdict({ ok: true, checked: 1204, head: { id: 1204, hash: 'f'.repeat(64) } }).detail).toContain('1 204 entries');
    const bad = chainVerdict({ ok: false, checked: 41, firstBadId: 42, head: null });
    expect(bad).toMatchObject({ title: 'Chain broken', tone: 'critical' });
    expect(bad.detail).toContain('#42');
  });
});
