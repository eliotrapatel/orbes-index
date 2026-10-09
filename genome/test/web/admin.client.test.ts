/**
 * The console's client sheet and Shopify readiness (plan LIVE RELEASE+, step S9), as pure functions: what the
 * Catalogue says of a model's base price and Shopify product, what the product export will hold, the ids pasted back
 * as the server reads them, the order export's period; the client sheet's steps, lines and words. And, at compile
 * time, that the console reads exactly what the server sends.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { ownerProfileBody } from '../../src/server/http/schemas.js';
import type { PrivateNotes as ServerPrivateNotes } from '../../src/server/services/client-notes.js';
import type { OwnerSheet as ServerOwnerSheet } from '../../src/server/services/owners.js';
import type { StaffProfileView } from '../../src/server/services/profiles.js';
import type { ClientOrder as ServerClientOrder } from '../../src/server/services/fulfilment.js';
import { SHOPIFY_PERIOD_MAX_DAYS as SERVER_PERIOD_MAX, shopifyIdOf, type ShopifyProduct as ServerShopifyProduct } from '../../src/server/services/shopify.js';
import { formatMoney } from '../../src/web/admin/model/live.js';
import { INTEREST_OUTCOME_LABELS, NOTE_ABOUT_LABELS, orderSteps, participationLine, RELEASE_KIND_LABELS } from '../../src/web/admin/model/owners.js';
import {
  basePriceText,
  defaultPeriod,
  pastedShopifyId,
  periodProblem,
  productExportSummary,
  SHOPIFY_CURRENCY_OPTIONS,
  SHOPIFY_PERIOD_MAX_DAYS,
  shopifyLinkInput,
  shopifyLinkProblem,
  shopifyStatus,
  shopifyValues,
  variantField,
} from '../../src/web/admin/model/shopify.js';
import type * as web from '../../src/web/admin/types.js';

/** A server value as JSON carries it: dates become ISO strings. */
type Json<T> = T extends Date ? string : T extends readonly (infer U)[] ? Json<U>[] : T extends object ? { [K in keyof T]: Json<T[K]> } : T;
/** The client sheet as the route sends it: the owner's sheet and the collector's orders (routes/admin/owners.ts). */
export const clientSheetFits = (s: Json<Omit<ServerOwnerSheet, 'owner'>> & { orders: Json<ServerClientOrder>[] }): Omit<web.OwnerSheet, 'owner'> => s;
export const shopifyProductFits = (p: Json<ServerShopifyProduct>): web.ShopifyProduct => p;
// Plan CUSTOMER INTELLIGENCE §3.1 P.9.2: the console's ClientProfile is the server's StaffProfileView, both ways; Edit
// the profile's body is what the route parses; a private note is the server's.
export const clientProfileFits = (p: Json<StaffProfileView>): web.ClientProfile => p;
export const clientProfileBack = (p: web.ClientProfile): Json<StaffProfileView> => p;
export const clientProfileInputFits = (b: web.ClientProfileInput): z.infer<typeof ownerProfileBody> => b;
export const privateNotesFit = (n: Json<ServerPrivateNotes>): web.PrivateNotes => n;

describe('the Catalogue\'s base price and Shopify product (N2)', () => {
  const m = (extra: Partial<web.Model> = {}) => ({ basePriceMinor: null, baseCurrency: null, shopify: { productId: null, variants: 3, linked: 0 }, ...extra }) as web.Model;

  it('says the base price, and how far the model is linked to its Shopify product', () => {
    expect(basePriceText(m())).toBe('None');
    expect(basePriceText(m({ basePriceMinor: 480_050, baseCurrency: 'EUR' }))).toBe(formatMoney(480_050, 'EUR'));
    expect(shopifyStatus(m())).toBe('NOT LINKED');
    expect(shopifyStatus(m({ shopify: { productId: '9001', variants: 3, linked: 2 } }))).toBe('LINKED · 2 OF 3 SIZES');
    expect(shopifyStatus(m({ shopify: { productId: '9001', variants: 3, linked: 3 } }))).toBe('LINKED');
    expect(typeof shopifyProductFits).toBe('function');
    expect(typeof clientSheetFits).toBe('function');
  });

  it('says what the product export holds in a currency, and what it leaves out', () => {
    const models = [m({ id: 'a', basePriceMinor: 1, baseCurrency: 'EUR' }), m({ id: 'b', basePriceMinor: 1, baseCurrency: 'EUR' }), m({ id: 'c', basePriceMinor: 1, baseCurrency: 'USD' }), m({ id: 'd' })];
    expect(productExportSummary(models, 'EUR')).toBe(
      '2 models priced in EUR, each a product with its sizes as variants and its photographs. 1 model priced in another currency is left out. 1 model without a base price is left out: set it with Edit. Each product is a draft, not published: Shopify decides nothing until the store is open.',
    );
    // NOCTURNE N1: a model and its variants are one product.
    const grouped = [...models, m({ id: 'e', basePriceMinor: 1, baseCurrency: 'EUR', variantOf: { id: 'a', name: 'MONOLITHE', label: 'Steel' } })];
    expect(productExportSummary(grouped, 'EUR')).toMatch(/^3 models priced in EUR, in 2 products: a model and its variants are one product, by Variant and Size, with their photographs\. /);
    expect(productExportSummary([m()], 'CHF')).toBe(
      'No model has a base price in CHF: the file holds its header only. 1 model without a base price is left out: set it with Edit. Each product is a draft, not published: Shopify decides nothing until the store is open.',
    );
    expect(SHOPIFY_CURRENCY_OPTIONS.map((o) => o.value)).toEqual(['EUR', 'GBP', 'USD', 'CHF']);
  });

  it('reads a pasted id as the server reads it: the number, or the address of its page', () => {
    const inputs = ['8123456789', ' https://admin.shopify.com/store/orbes/products/8123456789 ', 'https://admin.shopify.com/store/orbes/products/81/variants/4401?x=1', '', '0123', 'abc', '1'.repeat(21)];
    for (const kind of ['products', 'variants'] as const) {
      for (const input of inputs) {
        let server: string | null | undefined;
        try {
          server = shopifyIdOf(input, kind);
        } catch {
          server = undefined;
        }
        expect(pastedShopifyId(input, kind), `${kind} ${input}`).toBe(server);
      }
    }
  });

  it('opens the ids\' dialog with the model\'s, sends every size with its id, and says a mistake before it is sent', () => {
    const p: web.ShopifyProduct = {
      model: { id: 'm1', name: 'MONOLITHE', skuPrefix: 'MNL-RG' },
      handle: 'monolithe',
      productId: null,
      variants: [
        { size: null, sku: 'MNL-RG', known: true, variantId: null },
        { size: '52', sku: 'MNL-RG-52', known: true, variantId: null },
      ],
    };
    const v = shopifyValues(p);
    expect(v).toEqual({ productId: '', [variantField(0)]: '', [variantField(1)]: '' });
    expect(shopifyLinkProblem(p, v)).toBe('Nothing has changed.');
    expect(shopifyLinkProblem(p, { ...v, productId: 'nope' })).toMatch(/^The product id is the number/);
    expect(shopifyLinkProblem(p, { ...v, productId: '9001', [variantField(1)]: 'x' })).toMatch(/^A variant id is the number/);
    expect(shopifyLinkProblem(p, { ...v, [variantField(1)]: '52' })).toBe('A variant id is pasted with its product id.');
    expect(shopifyLinkProblem(p, { ...v, productId: '9001', [variantField(0)]: '7', [variantField(1)]: '7' })).toBe('Each variant id belongs to one size.');
    const filled = { productId: 'https://admin.shopify.com/store/orbes/products/9001', [variantField(0)]: '5200', [variantField(1)]: 'https://admin.shopify.com/store/orbes/products/9001/variants/5201' };
    expect(shopifyLinkProblem(p, filled)).toBeNull();
    expect(shopifyLinkInput(p, filled)).toEqual({ productId: '9001', variants: [{ size: null, variantId: '5200' }, { size: '52', variantId: '5201' }] });
    const linked = { ...p, productId: '9001', variants: p.variants.map((x, i) => ({ ...x, variantId: ['5200', '5201'][i]! })) };
    expect(shopifyLinkProblem(linked, shopifyValues(linked))).toBe('Nothing has changed.');
    // The product cleared: every variant goes with it.
    expect(shopifyLinkInput(linked, { ...shopifyValues(linked), productId: '' })).toEqual({ productId: null, variants: [{ size: null, variantId: null }, { size: '52', variantId: null }] });
    expect(shopifyLinkProblem(linked, { ...shopifyValues(linked), productId: '' })).toBe('A variant id is pasted with its product id.');
    expect(shopifyLinkProblem(linked, { productId: '', [variantField(0)]: '', [variantField(1)]: '' })).toBeNull();
  });

  it('proposes the month to today as the order export\'s period, and holds it to the server\'s bounds', () => {
    expect(defaultPeriod(new Date('2026-11-17T23:30:00.000Z'))).toEqual({ from: '2026-11-01', to: '2026-11-17' });
    expect(SHOPIFY_PERIOD_MAX_DAYS).toBe(SERVER_PERIOD_MAX);
    expect(periodProblem('2026-11-01', '2026-11-30')).toBeNull();
    expect(periodProblem('2026-01-01', '2026-12-31')).toBeNull();
    expect(periodProblem('2025-12-31', '2026-12-31')).toBeNull();
    expect(periodProblem('2025-12-30', '2026-12-31')).toBe('A period is at most 366 days.');
    expect(periodProblem('2026-11-30', '2026-11-01')).toBe('The last day comes on or after the first.');
    for (const [a, b] of [['', '2026-11-01'], ['2026-02-30', '2026-03-01'], ['2026-11', '2026-11-30']]) expect(periodProblem(a, b), `${a} ${b}`).toBe('Choose the first and the last day.');
  });
});

describe('the client sheet (N4)', () => {
  it('lists the steps an order reached, each with its date, in order', () => {
    const steps = { reservedAt: '2026-11-02T09:00:00.000Z', paidAt: '2026-11-03T09:00:00.000Z', shippedAt: null, deliveredAt: null, cancelledAt: '2026-11-04T09:00:00.000Z', returnedAt: null };
    expect(orderSteps({ steps })).toEqual([
      { step: 'RESERVED', at: '2026-11-02T09:00:00.000Z' },
      { step: 'PAID', at: '2026-11-03T09:00:00.000Z' },
      { step: 'CANCELLED', at: '2026-11-04T09:00:00.000Z' },
    ]);
    const all = { reservedAt: 'a', paidAt: 'b', shippedAt: 'c', deliveredAt: 'd', cancelledAt: null, returnedAt: 'e' };
    expect(orderSteps({ steps: all }).map((x) => x.step)).toEqual(['RESERVED', 'PAID', 'SHIPPED', 'DELIVERED', 'RETURNED']);
  });

  it('says the releases taken part in and the pieces secured, and names each outcome and note', () => {
    expect(participationLine({ count: 3, secured: 2 })).toBe('3 releases taken part in · 2 pieces secured');
    expect(participationLine({ count: 1, secured: 1 })).toBe('1 release taken part in · 1 piece secured');
    expect(participationLine({ count: 0, secured: 0 })).toBe('0 releases taken part in · 0 pieces secured');
    expect(Object.values(INTEREST_OUTCOME_LABELS)).toEqual(['UPCOMING', 'CAME', 'DID NOT COME', 'CANCELLED']);
    expect(NOTE_ABOUT_LABELS).toEqual({ ORDER: 'Order', DRAW: 'Draw', SALON: 'Private salon', LIVE: 'LIVE RELEASE' });
    expect(RELEASE_KIND_LABELS).toEqual({ LIVE: 'LIVE RELEASE', DRAW: 'DRAW' });
  });
});

// ── THE HOUSE'S GUARANTEE (plan NEXT-NINE, IN-01) ─────────────────────────────

import type { AdminGuarantee as ServerGuarantee, AdminReleaseGuarantee as ServerReleaseGuarantee, GrantOutcome as ServerGrant, GuaranteeSettingsSheet as ServerSettings } from '../../src/server/services/guarantees.js';
import { GUARANTEE_NOTE_MAX, GUARANTEE_PIECES, GUARANTEE_VALID_DAYS } from '../../src/server/services/guarantees.js';
import {
  changeInput,
  changeProblem,
  coversText,
  drawGuaranteeLine,
  GRANT_HINTS,
  grantInput,
  grantProblem,
  grantToast,
  grantValues,
  GUARANTEE_LIMITS,
  GUARANTEE_STATE_LABELS,
  guaranteeActions,
  guaranteedText,
  modelOptions,
  placesLeftForDraw,
  releaseOptions,
  settingsInput,
  settingsProblem,
  stockWarning,
} from '../../src/web/admin/model/guarantees.js';
import { CAPABILITY_MIN_ROLE, can } from '../../src/web/admin/model/permissions.js';
import { toneOf } from '../../src/web/admin/model/tone.js';
import { GUARANTEE_STATES as WEB_STATES } from '../../src/web/admin/types.js';
import { GUARANTEE_STATES as SERVER_STATES } from '../../src/server/services/guarantees.js';

export const guaranteeFits = (g: Json<ServerGuarantee>): web.Guarantee => g;
export const releaseGuaranteeFits = (g: Json<ServerReleaseGuarantee>): web.ReleaseGuarantee => g;
export const grantFits = (g: Json<ServerGrant>): web.GuaranteeGrant => g;
export const guaranteeSettingsFits = (s: Json<ServerSettings>): web.GuaranteeSettings => s;

describe('THE HOUSE’S GUARANTEE in the console (IN-01)', () => {
  const g = (o: Partial<web.Guarantee> = {}): web.Guarantee =>
    ({ id: 'g', scope: 'MODEL', target: { kind: 'MODEL', id: 'm', name: 'MONOLITHE', variant: null }, pieces: 1, validUntil: '2026-12-31T22:59:59.999Z', visible: true, note: null, status: 'ACTIVE', state: 'WAITING', ...o }) as web.Guarantee;

  it('holds the server’s bounds, states, roles and tones', () => {
    expect(typeof guaranteeFits).toBe('function');
    expect(GUARANTEE_LIMITS).toEqual({ pieces: { min: GUARANTEE_PIECES.min, max: GUARANTEE_PIECES.max }, validDays: { min: GUARANTEE_VALID_DAYS.min, max: GUARANTEE_VALID_DAYS.max }, note: GUARANTEE_NOTE_MAX });
    expect([...WEB_STATES]).toEqual([...SERVER_STATES]);
    expect(Object.keys(GUARANTEE_STATE_LABELS)).toEqual([...SERVER_STATES]);
    expect(Object.values(GUARANTEE_STATE_LABELS)).toEqual(['WAITING FOR A RELEASE', 'SET ASIDE', 'ENTERED', 'USED', 'EXPIRED', 'REVOKED']);
    expect([CAPABILITY_MIN_ROLE.grantGuarantee, CAPABILITY_MIN_ROLE.manageGuaranteeSettings]).toEqual(['OPERATOR', 'ADMIN']);
    expect(SERVER_STATES.map((s) => toneOf('guarantee', s))).toEqual(['outline', 'outline', 'solid', 'solid', 'muted', 'alert']);
  });

  it('says what a guarantee covers: the next release of a model (a variant after its name), of a collection, or a release', () => {
    expect(coversText(g())).toBe('Next release of MONOLITHE');
    expect(coversText(g({ target: { kind: 'MODEL', id: 'm', name: 'MONOLITHE', variant: 'Blue' } }))).toBe('Next release of MONOLITHE · Blue');
    expect(coversText(g({ target: { kind: 'COLLECTION', id: 'c', name: 'ÉCLIPSE', variant: null } }))).toBe('Next release of the ÉCLIPSE collection');
    expect(coversText(g({ target: { kind: 'RELEASE', id: 'd', name: 'MONOLITHE BLUE', variant: null } }))).toBe('MONOLITHE BLUE');
    const models = [
      { id: 'a', name: 'MONOLITHE', active: true, discontinuedAt: null, variantOf: null, variantLabel: 'Steel' },
      { id: 'b', name: 'MONOLITHE', active: true, discontinuedAt: null, variantOf: { id: 'a', name: 'MONOLITHE', label: 'Steel' }, variantLabel: 'Blue' },
      { id: 'c', name: 'ZENITH', active: false, discontinuedAt: null, variantOf: null, variantLabel: null },
    ] as unknown as web.Model[];
    expect(modelOptions(models)).toEqual([{ value: 'a', label: 'MONOLITHE' }, { value: 'b', label: 'MONOLITHE · Blue' }]);
    expect(GRANT_HINTS.model).toBe('A main model covers its variants; a variant covers itself.');
  });

  it('offers the draws in DRAFT, UPCOMING or OPEN and the LIVE RELEASES not ended, never an after-room, each with its rule', () => {
    const draw = (id: string, state: web.Drop['state']) => ({ id, title: id.toUpperCase(), state }) as web.Drop;
    const live = (id: string, o: Partial<web.LiveRelease>) => ({ id, title: id.toUpperCase(), phase: 'ANNOUNCED', over: false, afterRoomOf: null, access: { text: 'owners from PLATINE' }, ...o }) as web.LiveRelease;
    const options = releaseOptions(
      [draw('a', 'DRAFT'), draw('b', 'UPCOMING'), draw('c', 'OPEN'), draw('d', 'CLOSED'), draw('e', 'DRAWN'), draw('f', 'CANCELLED')],
      [live('g', {}), live('h', { phase: 'ENDED' }), live('i', { over: true }), live('j', { afterRoomOf: { id: 'g', title: 'G' } })],
    );
    expect(options.map((o) => o.value)).toEqual(['a', 'b', 'c', 'g']);
    expect(options[3]!.rule).toBe('A LIVE RELEASE for owners from PLATINE. A holder of the guarantee enters whatever the rule.');
  });

  it('checks a grant before it is sent, then sends only its target, pieces, day, shown and note; its toast says where it was set aside', () => {
    const start = grantValues({ pieces: 1, visible: true, defaultValidUntil: '2027-01-30' });
    expect(start).toMatchObject({ scope: 'MODEL', pieces: '1', validUntil: '2027-01-30', visible: 'true' });
    expect(grantProblem(start, '2026-11-01')).toBe('Choose the model.');
    expect(grantProblem({ ...start, scope: 'COLLECTION' }, '2026-11-01')).toBe('Choose the collection.');
    expect(grantProblem({ ...start, scope: 'RELEASE' }, '2026-11-01')).toBe('Choose the release.');
    const v = { ...start, modelId: 'm1', note: '  Waited at the boutique.  ' };
    expect(grantProblem(v, '2026-11-01')).toBeNull();
    expect(grantProblem({ ...v, pieces: '6' }, '2026-11-01')).toBe('A guarantee covers 1 to 5 pieces.');
    expect(grantProblem({ ...v, validUntil: '2026-10-31' }, '2026-11-01')).toBe('Valid until is today or later.');
    expect(grantProblem({ ...v, note: 'x'.repeat(501) }, '2026-11-01')).toBe('A note has at most 500 characters.');
    expect(grantInput(v)).toEqual({ scope: 'MODEL', targetId: 'm1', pieces: 1, validUntil: '2027-01-30', visible: true, note: 'Waited at the boutique.' });
    expect(grantInput({ ...v, scope: 'RELEASE', releaseId: 'd1', visible: '', note: '' })).toMatchObject({ targetId: 'd1', visible: false, note: null });
    expect(grantToast({ setAsideFor: { id: 'd', title: 'MONOLITHE BLUE' } })).toBe('Guarantee granted. Set aside for MONOLITHE BLUE.');
    expect(grantToast({ setAsideFor: null })).toBe('Guarantee granted. It is set aside when the next release is published.');
  });

  it('changes only what changed, while ACTIVE, for a role that grants', () => {
    const x = g({ pieces: 2, note: 'Old.' });
    const same = { pieces: '2', validUntil: '2026-12-31', visible: 'true', note: 'Old.' };
    expect(changeProblem(x, same, '2026-11-01')).toBe('Nothing has changed.');
    expect(changeInput(x, { ...same, pieces: '3', visible: '' })).toEqual({ pieces: 3, visible: false });
    expect(changeInput(x, { ...same, note: '' })).toEqual({ note: null });
    expect(changeInput(x, { ...same, validUntil: '2027-02-01' })).toEqual({ validUntil: '2027-02-01' });
    expect(guaranteeActions(x, true)).toEqual({ change: true, revoke: true });
    expect(guaranteeActions(g({ status: 'USED' }), true)).toEqual({ change: false, revoke: false });
    expect(guaranteeActions(x, false)).toEqual({ change: false, revoke: false });
  });

  it('says a release’s guaranteed places and pieces, the draw’s sentence, the places left, the stock’s floor, the defaults', () => {
    expect(guaranteedText({ places: 0, pieces: 0 })).toBe('None');
    expect(guaranteedText({ places: 2, pieces: 3 })).toBe('2 places · 3 pieces');
    expect(guaranteedText({ places: 1, pieces: 1 })).toBe('1 place · 1 piece');
    const d = { quantity: 6, heldPieces: 1, guaranteedEntered: { places: 2, pieces: 3 } };
    expect(placesLeftForDraw(d)).toBe(2);
    expect(drawGuaranteeLine(d)).toBe('2 guaranteed places, 3 pieces, are selected first; the draw ranks the other entries for the 2 places left.');
    expect(drawGuaranteeLine({ ...d, guaranteedEntered: { places: 0, pieces: 0 } })).toBeNull();
    expect(stockWarning(2, { pieces: 3 })).toBe('3 pieces of this release are guaranteed by the house: the stock cannot go below.');
    expect(stockWarning(3, { pieces: 3 })).toBeNull();
    expect(settingsProblem({ validDays: '731', pieces: '1' })).toBe('Valid for is 1 to 730 days.');
    expect(settingsProblem({ validDays: '90', pieces: '6' })).toBe('A guarantee covers 1 to 5 pieces.');
    expect(settingsInput({ validDays: '90', pieces: '2', visible: '' })).toEqual({ validDays: 90, pieces: 2, visible: false });
  });
});

describe('the client sheet\'s Profile, tags and private notes: who may do what (plan CUSTOMER INTELLIGENCE §3.6 C.9)', () => {
  it('lets an OPERATOR edit the profile, tag and write notes, an ADMIN remove another\'s note; an AUDITOR only reads, RETAIL and LOGISTICS never reach the sheet', () => {
    expect(CAPABILITY_MIN_ROLE).toMatchObject({ editClientProfile: 'OPERATOR', tagClients: 'OPERATOR', writeClientNotes: 'OPERATOR', removeAnyClientNote: 'ADMIN' });
    for (const c of ['editClientProfile', 'tagClients', 'writeClientNotes', 'removeAnyClientNote'] as const) {
      for (const role of ['RETAIL', 'LOGISTICS', 'AUDITOR'] as const) expect(can(role, c), `${role} ${c}`).toBe(false);
      expect(can('ADMIN', c), c).toBe(true);
    }
    expect(can('OPERATOR', 'removeAnyClientNote')).toBe(false);
    expect([typeof clientProfileFits, typeof clientProfileBack, typeof clientProfileInputFits, typeof privateNotesFit]).toEqual(['function', 'function', 'function', 'function']);
  });
});
