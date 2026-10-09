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
import type { ProfileService, StaffProfileView } from '../../src/server/services/profiles.js';
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
import {
  addressFormOf,
  addressProblem,
  birthDateInput,
  birthDateProblem,
  heardSelectOptions,
  isOtherAnswer,
  OWNER_LEAD,
  OWNER_LEAD_MASKED,
  phoneText,
  profileErrorField,
  profileFormOf,
  profileFormProblem,
  profileInput,
  profileRows,
  profileTools,
  profileUnchanged,
  tasteChoices,
  TEAM_ACCOUNT_LINE,
} from '../../src/web/admin/model/client-profile.js';
import {
  canRemoveNote,
  noteCounter,
  noteLine,
  noteProblem,
  olderNotesLabel,
  removeTagLabel,
  NOTE_MAX as WEB_NOTE_MAX,
  NOTES_SHOWN as WEB_NOTES_SHOWN,
  TAG_LIMIT as WEB_TAG_LIMIT,
  TAG_MAX as WEB_TAG_MAX,
  TAGS_NOTES_COPY,
  tagProblem,
  tagSuggestionsFor,
  tagValue,
} from '../../src/web/admin/model/client-notes.js';
import { cleanTag, NOTE_MAX, NOTES_SHOWN, TAG_LIMIT, TAG_MAX, type TagSuggestion as ServerTagSuggestion } from '../../src/server/services/client-notes.js';

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
export const tagSuggestionFits = (t: ServerTagSuggestion): web.TagSuggestion => t;
// Step 5.5: what Edit the profile opens on (GET /api/admin/owners/:id/profile) is the server's profile and options.
export const clientProfileEditFits = (e: { profile: Json<StaffProfileView>; options: Json<Awaited<ReturnType<ProfileService['options']>>> }): web.ClientProfileEdit => e;

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

describe('the client sheet\'s Profile (plan CUSTOMER INTELLIGENCE §3.6 C.4.1, C.4.2, §3.0 (h), step 5.5)', () => {
  const profile = (extra: Partial<web.ClientProfile> = {}): web.ClientProfile => ({
    firstName: 'Camille',
    lastName: 'Durand',
    country: 'FR',
    birthDate: '1994-03-14',
    ageBand: '25-34',
    age: 32,
    birthDateBy: 'COLLECTOR',
    birthDateAt: '2026-10-09T08:00:00.000Z',
    birthDateCollectorAt: '2026-10-09T08:00:00.000Z',
    phone: { country: 'FR', number: '+33612345678' },
    city: 'Lyon',
    instagram: 'camille.dl',
    heard: { optionId: 'h-friend', label: 'A friend', other: null, setAside: false, at: '2026-10-08T12:00:00.000Z' },
    tastes: { pieces: [{ key: 'ring', label: 'RING', retired: false }, { key: 'cuff', label: 'CUFF', retired: false }], finishes: [{ key: 'gold', label: 'Gold', swatch: '#c9a227', retired: false }, { key: 'silver', label: 'Silver', swatch: '#c0c0c0', retired: true }] },
    address: { name: 'Camille Durand', lines: '12 rue de la République\n69002 Lyon', country: 'FR', phone: '+33 6 12 34 56 78' },
    otherAddresses: 2,
    completion: { percent: 90, missing: ['INSTAGRAM'] },
    version: 4,
    updatedBy: 'STAFF',
    updatedAt: '2026-10-08T12:02:00.000Z',
    withheld: [],
    teamAccount: false,
    ...extra,
  });
  const masked = (p: web.ClientProfile): web.ClientProfile => ({ ...p, birthDate: null, age: null, phone: null, city: null, instagram: null, address: null, withheld: ['birthDate', 'phone', 'city', 'address', 'instagram'] });
  const values = (p: web.ClientProfile) => Object.fromEntries(profileRows(p).map((r) => [r.label, r.value]));
  const notes = (p: web.ClientProfile) => Object.fromEntries(profileRows(p).map((r) => [r.label, r.note]));
  const edit = (p: web.ClientProfile = profile()): web.ClientProfileEdit => ({
    profile: p,
    options: {
      pieces: [{ key: 'cuff', label: 'CUFF' }, { key: 'ring', label: 'RING' }],
      finishes: [{ key: 'gold', label: 'Gold', swatch: '#c9a227' }],
      heard: [{ id: 'h-friend', label: 'A friend', other: false }, { id: 'h-other', label: 'Other', other: true }],
    },
  });

  it('changes the header\'s lead, the one existing text of the sheet that changes; an AUDITOR\'s keeps its ending and names what is withheld; a team account\'s line', () => {
    expect(OWNER_LEAD).toBe('The client’s account and tier, profile, tags and private notes, intelligence, pieces, orders, releases, answers, interest, segments and notes, transfers in progress and latest verifications.');
    expect(OWNER_LEAD_MASKED).toBe(`${OWNER_LEAD} Emails are masked for your role. Phone, date of birth, address, Instagram and cities are withheld.`);
    expect(TEAM_ACCOUNT_LINE).toBe('This account’s email is a console login’s: it is left out of the Collectors page and the export.');
  });

  it('draws the Profile\'s rows in C.4.2\'s order, in clear for an OPERATOR', () => {
    const p = profile();
    expect(profileRows(p).map((r) => r.label)).toEqual(['First name', 'Last name', 'Date of birth', 'Phone', 'City', 'Address', 'Instagram', 'How they heard', 'Favourite pieces', 'Favourite finishes', 'Profile', 'Last changed']);
    expect(values(p)).toMatchObject({
      'First name': 'Camille',
      'Date of birth': '14 MAR 1994 · 32 years',
      Phone: '+33 6 12 34 56 78',
      City: 'Lyon',
      Address: ['Camille Durand', '12 rue de la République, 69002 Lyon', 'France · +33 6 12 34 56 78'],
      Instagram: '@camille.dl',
      'How they heard': 'A friend',
      'Favourite pieces': 'RING · CUFF',
      'Favourite finishes': 'Gold · Silver (no longer in the collection)',
      Profile: '90% complete',
      'Last changed': '08 OCT 2026 · 14:02 Paris · by Client Services',
    });
    expect(notes(p)).toMatchObject({
      'Date of birth': 'Entered by the client on 09 OCT 2026',
      Phone: 'As typed, not verified',
      City: 'As typed by the client',
      Address: 'The default delivery address, from YOUR ADDRESSES · 2 more saved',
      'How they heard': 'Answered on 08 OCT 2026',
      'Favourite pieces': 'From the collection’s types',
      Profile: 'Missing: Instagram',
    });
    expect(profileRows(p).find((r) => r.label === 'Instagram')!.kind).toBe('instagram');
    expect(phoneText({ country: 'US', number: '+14155550123' })).toBe('+1 4 155 550 123');
  });

  it('withholds the date of birth (the age band only), the phone, the city, the address and the Instagram for an AUDITOR; the rest reads the same', () => {
    const p = masked(profile());
    expect(values(p)).toMatchObject({ 'First name': 'Camille', 'Last name': 'Durand', 'Date of birth': 'Withheld · 25–34', Phone: 'Withheld', City: 'Withheld', Address: 'Withheld', Instagram: 'Withheld', 'How they heard': 'A friend', Profile: '90% complete' });
    expect(profileRows(p).some((r) => r.kind === 'instagram' || r.kind === 'address')).toBe(false);
    expect(values(masked(profile({ ageBand: null, birthDate: null, age: null })))['Date of birth']).toBe('—');
    expect(profileTools(p, { canEdit: false, status: 'ACTIVE' })).toEqual({ edit: false, birthDate: false, address: null });
  });

  it('says each date of birth\'s story, an empty profile\'s lines, Other\'s words, the tools while the account is not DELETED', () => {
    expect(notes(profile({ birthDateBy: 'STAFF', birthDateAt: '2026-10-12T10:00:00.000Z' }))['Date of birth']).toBe('Changed by Client Services on 12 OCT 2026');
    expect(notes(profile({ birthDate: null, age: null, ageBand: null, birthDateBy: null, birthDateAt: null }))['Date of birth']).toBe('Removed by Client Services. The client entered it once and cannot enter it again: set it here.');
    const empty = profile({ firstName: null, lastName: null, birthDate: null, age: null, ageBand: null, birthDateBy: null, birthDateAt: null, birthDateCollectorAt: null, phone: null, city: null, instagram: null, heard: null, tastes: { pieces: [], finishes: [] }, address: null, otherAddresses: 0, completion: { percent: 10, missing: ['NAME', 'BIRTH_DATE', 'CITY', 'ADDRESS', 'PHONE', 'INSTAGRAM', 'PIECES', 'FINISHES', 'HEARD'] }, version: 0, updatedBy: null, updatedAt: null });
    expect(values(empty)).toMatchObject({ 'First name': '—', 'Date of birth': '—', Phone: '—', Address: '—', 'How they heard': 'Not answered', 'Favourite pieces': 'None chosen', 'Last changed': '—' });
    expect(notes(empty)).toMatchObject({ 'Date of birth': 'Not entered yet: the client enters it once in YOUR PROFILE.', Address: 'No address saved.', Profile: 'Missing: name, date of birth, city, address, phone, Instagram, favourite pieces, favourite finishes, how they heard' });
    expect(values(profile({ heard: { optionId: 'h-other', label: 'Other', other: 'Saw it at a shop in Milan', setAside: false, at: '2026-10-08T12:00:00.000Z' } }))['How they heard']).toBe('Other: “Saw it at a shop in Milan”');
    expect(notes(profile({ completion: { percent: 100, missing: [] } })).Profile).toBe('Every field is given');
    expect(profileTools(profile(), { canEdit: true, status: 'LOCKED' })).toEqual({ edit: true, birthDate: true, address: 'edit' });
    expect(profileTools(profile({ address: null }), { canEdit: true, status: 'ACTIVE' }).address).toBe('add');
    expect(profileTools(profile(), { canEdit: true, status: 'DELETED' })).toEqual({ edit: false, birthDate: false, address: null });
  });

  it('opens Edit the profile on the profile as it is, offers the answers and the client\'s set-aside one, the collection\'s choices then the retired ones', () => {
    const e = edit();
    expect(profileFormOf(e.profile)).toEqual({ firstName: 'Camille', lastName: 'Durand', country: 'FR', city: 'Lyon', phoneCountry: 'FR', phoneNumber: '612345678', instagram: 'camille.dl', heard: 'h-friend', heardOther: '', pieces: ['ring', 'cuff'], finishes: ['gold', 'silver'] });
    expect(heardSelectOptions(e).map((o) => o.label)).toEqual(['Not answered', 'A friend', 'Other']);
    const aside = edit(profile({ heard: { optionId: 'h-press', label: 'The press', other: null, setAside: true, at: '2026-10-08T12:00:00.000Z' } }));
    expect(heardSelectOptions(aside).at(-1)).toEqual({ value: 'h-press', label: 'The press (set aside)' });
    expect([isOtherAnswer(e, 'h-other'), isOtherAnswer(e, 'h-friend')]).toEqual([true, false]);
    expect(tasteChoices('finishes', e).map((c) => c.label)).toEqual(['Gold', 'Silver (no longer in the collection)']);
    expect(tasteChoices('pieces', e).map((c) => c.key)).toEqual(['cuff', 'ring']);
  });

  it('checks Edit the profile before sending it (a name or the country never cleared once given, the phone, Instagram, 30 choices), says « Nothing has changed. », sends the whole profile with the version read', () => {
    const e = edit();
    const f = profileFormOf(e.profile);
    expect(profileUnchanged(f, e)).toBe(true);
    expect(profileUnchanged({ ...f, phoneNumber: '06 12 34 56 78' }, e)).toBe(true);
    expect(profileUnchanged({ ...f, instagram: '@Camille.DL' }, e)).toBe(true);
    expect(profileUnchanged({ ...f, city: 'Paris' }, e)).toBe(false);
    expect(profileFormProblem({ ...f, firstName: '' }, e.profile, false)).toEqual({ field: 'firstName', message: 'Enter the first name: once given, it is changed, never cleared.' });
    expect(profileFormProblem({ ...f, lastName: 'x'.repeat(51) }, e.profile, false)?.field).toBe('lastName');
    expect(profileFormProblem({ ...f, country: '' }, e.profile, false)?.field).toBe('country');
    expect(profileFormProblem({ ...f, phoneCountry: '' }, e.profile, false)).toEqual({ field: 'phoneCountry', message: 'Choose the phone’s country code.' });
    expect(profileFormProblem({ ...f, phoneNumber: '06 12 ab' }, e.profile, false)?.field).toBe('phoneNumber');
    expect(profileFormProblem({ ...f, instagram: 'not a username' }, e.profile, false)?.field).toBe('instagram');
    expect(profileFormProblem({ ...f, heardOther: 'x'.repeat(101) }, e.profile, true)?.field).toBe('heardOther');
    expect(profileFormProblem({ ...f, pieces: Array.from({ length: 31 }, (_, i) => `p${i}`) }, e.profile, false)?.message).toBe('Choose up to 30 favourite pieces and 30 favourite finishes.');
    expect(profileFormProblem(f, e.profile, false)).toBeNull();
    expect(profileInput({ ...f, city: '  Paris ', heard: 'h-other', heardOther: ' A colleague ' }, 4, true)).toEqual({
      version: 4,
      firstName: 'Camille',
      lastName: 'Durand',
      country: 'FR',
      city: 'Paris',
      phone: { country: 'FR', number: '612345678' },
      instagram: 'camille.dl',
      heard: { optionId: 'h-other', other: 'A colleague' },
      tastes: { pieces: ['cuff', 'ring'], finishes: ['gold', 'silver'] },
    });
    expect(profileInput({ ...f, phoneNumber: '', heard: '', instagram: '' }, 4, false)).toMatchObject({ phone: null, heard: null, instagram: null });
  });

  it('puts a refusal of the server under the field it names, else under the dialog', () => {
    expect(profileErrorField('VALIDATION_FAILED', 'Your first name is 50 characters at most.')).toBe('firstName');
    expect(profileErrorField('VALIDATION_FAILED', 'Choose the country code of your phone.')).toBe('phoneCountry');
    expect(profileErrorField('VALIDATION_FAILED', 'This phone number is too short or too long.')).toBe('phoneNumber');
    expect(profileErrorField('VALIDATION_FAILED', 'Choose your country.')).toBe('country');
    expect(profileErrorField('VALIDATION_FAILED', 'Your city is 80 characters at most.')).toBe('city');
    expect(profileErrorField('VALIDATION_FAILED', 'Enter your Instagram username: letters, numbers, full stops and underscores, 30 at most.')).toBe('instagram');
    expect(profileErrorField('VALIDATION_FAILED', 'Your words are 100 characters at most.')).toBe('heardOther');
    expect(profileErrorField('HEARD_UNAVAILABLE', 'This answer is no longer offered. Choose another.')).toBe('heard');
    expect(profileErrorField('TASTE_UNKNOWN', 'Choose among the pieces and finishes of the collection.')).toBe('pieces');
    expect(profileErrorField('PROFILE_CHANGED', 'The client changed the profile meanwhile. It has been read again: check and save.')).toBeNull();
    expect(profileErrorField('ACCOUNT_DELETED', 'This account is deleted.')).toBeNull();
  });

  it('checks Change the date of birth (a reason, 500 at most, nothing changed) and Edit the address (H2\'s words), and sends them', () => {
    const p = profile();
    expect(birthDateProblem({ birthDate: '1994-03-14', why: 'x' }, p)).toBe('Nothing has changed.');
    expect(birthDateProblem({ birthDate: '1994-03-15', why: ' ' }, p)).toBe('Give the reason.');
    expect(birthDateProblem({ birthDate: '1994-03-15', why: 'x'.repeat(501) }, p)).toBe('Give the reason in 500 characters at most.');
    expect(birthDateProblem({ birthDate: '', why: 'A typo, said on the phone.' }, p)).toBeNull();
    expect(birthDateInput({ birthDate: '', why: ' A typo. ' }, 4)).toEqual({ version: 4, birthDate: null, why: 'A typo.' });
    expect(birthDateInput({ birthDate: '1994-03-15', why: 'A typo.' }, 4)).toEqual({ version: 4, birthDate: '1994-03-15', why: 'A typo.' });
    expect(addressFormOf(p)).toEqual({ name: 'Camille Durand', address: '12 rue de la République\n69002 Lyon', country: 'FR', phone: '+33 6 12 34 56 78' });
    expect(addressFormOf(profile({ address: null }))).toEqual({ name: 'Camille Durand', address: '', country: 'FR', phone: '+33 6 12 34 56 78' });
    expect(addressProblem(addressFormOf(p), p)).toBe('Nothing has changed.');
    expect(addressProblem({ ...addressFormOf(p), address: '' }, p)).toBe('Enter the name and the address.');
    expect(addressProblem({ ...addressFormOf(p), country: '' }, p)).toBe('Choose a country.');
    expect(addressProblem({ ...addressFormOf(p), phone: ' ' }, p)).toBe('Enter a phone number with its country code.');
    expect(addressProblem({ ...addressFormOf(p), name: 'C. Durand' }, p)).toBeNull();
    expect(typeof clientProfileEditFits).toBe('function');
  });
});

describe('the client sheet\'s Tags and private notes (plan CUSTOMER INTELLIGENCE §3.6 C.4.3, C.11, step 5.6)', () => {
  it('holds the server\'s bounds and words', () => {
    expect([WEB_TAG_LIMIT, WEB_TAG_MAX, WEB_NOTE_MAX, WEB_NOTES_SHOWN]).toEqual([TAG_LIMIT, TAG_MAX, NOTE_MAX, NOTES_SHOWN]);
    expect(TAGS_NOTES_COPY).toMatchObject({ title: 'Tags and private notes', note: 'Never shown to the client.', noTag: 'No tag.', noNote: 'No private note.', addTag: 'Add a tag', addNote: 'Add a private note', addNoteButton: 'Add note', tagAdded: 'Tag added.', tagRemoved: 'Tag removed.' });
    expect(TAGS_NOTES_COPY.removeBody).toBe('Remove this note? It disappears from the sheet; the audit log keeps that it was removed.');
    expect(typeof tagSuggestionFits).toBe('function');
  });

  it('keeps a tag as the server does: in capitals, its spaces collapsed, the typographic apostrophe accepted; refuses the rest and the 21st in the server\'s words', () => {
    for (const typed of ['friend  of the house', ' vip ', 'Friend of the house’s', 'café & co.', 'A-1']) expect(tagValue(typed), typed).toBe(cleanTag(typed));
    expect(tagValue('friend  of the house')).toBe('FRIEND OF THE HOUSE');
    expect(tagProblem('FRIEND OF THE HOUSE’S', [])).toBeNull();
    for (const bad of ['', '   ', 'x'.repeat(33), 'VIP!', 'a/b']) expect(tagProblem(bad, []), bad).toBe('A tag is 1 to 32 letters, digits or spaces (and & ’ - .).');
    const twenty = Array.from({ length: 20 }, (_, i) => `T${i}`);
    expect(tagProblem('NEW', twenty)).toBe('A client carries at most 20 tags.');
    expect(tagProblem('t3', twenty)).toBeNull();
    expect(tagSuggestionsFor([{ tag: 'VIP', accounts: 12 }, { tag: 'PRESS', accounts: 3 }], ['VIP'])).toEqual(['PRESS']);
    expect(removeTagLabel('VIP')).toBe('Remove the tag VIP');
  });

  it('checks a note (1 to 2,000 characters), counts what is left near the end, writes its line, offers Remove to its writer or an ADMIN, and the older notes', () => {
    expect(noteProblem('  ')).toBe('A note is 1 to 2,000 characters.');
    expect(noteProblem('x'.repeat(2001))).toBe('A note is 1 to 2,000 characters.');
    expect(noteProblem('Prefers a call after 18:00.\r\nNo email.')).toBeNull();
    expect(noteCounter('x'.repeat(1600))).toBe('');
    expect(noteCounter('x'.repeat(1601))).toBe('399 left');
    expect(noteCounter('x'.repeat(2000))).toBe('0 left');
    expect(noteLine({ at: '2026-10-08T12:02:00.000Z', by: 'camille@orbes.com' })).toBe('08 OCT 2026 · 14:02 Paris · camille@orbes.com');
    expect(noteLine({ at: '2026-10-08T12:02:00.000Z', by: null })).toBe('08 OCT 2026 · 14:02 Paris · ORBES');
    const n = { byId: 'a1' };
    expect(canRemoveNote(n, { id: 'a1', role: 'OPERATOR' })).toBe(true);
    expect(canRemoveNote(n, { id: 'a2', role: 'OPERATOR' })).toBe(false);
    expect(canRemoveNote(n, { id: 'a2', role: 'ADMIN' })).toBe(true);
    expect(canRemoveNote({ byId: null }, { id: 'a2', role: 'ADMIN' })).toBe(true);
    expect(canRemoveNote(n, { id: 'a1', role: 'AUDITOR' })).toBe(false);
    expect(olderNotesLabel(170, 50)).toBe('Show the 120 older notes');
    expect(olderNotesLabel(51, 50)).toBe('Show the 1 older note');
    expect(olderNotesLabel(50, 50)).toBeNull();
    expect(olderNotesLabel(1_200, 50)).toBe('Show the 1,150 older notes');
  });
});
