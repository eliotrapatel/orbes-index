/**
 * The console's share of plan NOCTURNE's step N1, as pure functions: a model's variants (how a model is named where
 * one is chosen, ADD A VARIANT's values and refusals and the SKU prefix it proposes, a label and its colour changed
 * together, what a Catalogue row says), a draw's price in the release's dialog and page, and the piece's field set at
 * issuance named Size. The server checks everything again; these say a mistake before anything is sent, in the
 * server's bounds.
 */
import { describe, expect, it } from 'vitest';
import { VARIANT_LABEL_MAX as SERVER_LABEL_MAX } from '../../src/server/services/catalog.js';
import { DRAW_PRICE_MAX_MINOR } from '../../src/server/services/drops.js';
import { DROP_LIMITS, drawPriceProblem, drawPriceText, dropChange, dropFormValues, dropInput, dropProblem } from '../../src/web/admin/model/club.js';
import { formatMoney } from '../../src/web/admin/model/live.js';
import { productAttributes } from '../../src/web/admin/model/product.js';
import {
  dotChange,
  dotFormValues,
  dotProblem,
  keepsLabel,
  modelChoice,
  proposeVariantPrefix,
  swatchOf,
  VARIANT_LABEL_MAX,
  variantFormValues,
  variantInput,
  variantLine,
  variantProblem,
} from '../../src/web/admin/model/variants.js';
import type { Drop, Model, ModelVariant, ProductDetail } from '../../src/web/admin/types.js';

const variant = (label: string, extra: Partial<ModelVariant> = {}): ModelVariant => ({
  id: `v-${label}`,
  name: 'MONOLITHE',
  label,
  swatch: '#16224A',
  skuPrefix: `MNL-${label.slice(0, 2).toUpperCase()}`,
  imageUrl: null,
  lookbook: 'HIDDEN',
  slug: null,
  active: true,
  ...extra,
});

const model = (extra: Partial<Model> = {}): Model =>
  ({ id: 'm1', name: 'MONOLITHE', type: 'BRACELET', skuPrefix: 'MNL-ST', variantOf: null, variantLabel: null, variantSwatch: null, variants: [], ...extra }) as Model;

describe('the console\'s variants (NOCTURNE N1)', () => {
  it('holds a label to the server\'s bound and a colour to #RRGGBB', () => {
    expect(VARIANT_LABEL_MAX).toBe(SERVER_LABEL_MAX);
    expect(swatchOf('#16224a')).toBe('#16224A');
    expect(swatchOf('b88a3a')).toBe('#B88A3A');
    for (const bad of ['', '#16224', 'blue', undefined]) expect(swatchOf(bad), String(bad)).toBeNull();
  });

  it('names a model with its label where one is chosen: a model and its variants share a name', () => {
    expect(modelChoice(model())).toBe('MONOLITHE · BRACELET');
    expect(modelChoice(model({ variantLabel: 'Blue' }))).toBe('MONOLITHE · BRACELET · BLUE');
    expect(modelChoice(model({ variantLabel: 'Night blue' }), 'MNL-BL')).toBe('MONOLITHE · BRACELET · NIGHT BLUE · MNL-BL');
  });

  it('says on a Catalogue row where a model stands among its variants', () => {
    expect(variantLine(model())).toBeNull();
    expect(variantLine(model({ variantLabel: 'Steel' }))).toBe('STEEL');
    expect(variantLine(model({ variantLabel: 'Steel', variants: [variant('Gold'), variant('Blue')] }))).toBe('STEEL · 2 variants');
    expect(variantLine(model({ variantLabel: 'Blue', variantOf: { id: 'm0', name: 'MONOLITHE', label: 'Steel' } }))).toBe('Variant of MONOLITHE · BLUE');
  });

  it('ADD A VARIANT: asks the main model\'s own dot while it has none, proposes a SKU prefix, and says what the server would refuse', () => {
    const fresh = model();
    expect(variantFormValues(fresh)).toEqual({ mainLabel: '', mainSwatch: '#a7a29a', label: '', swatch: '#a7a29a', skuPrefix: '' });
    expect(variantFormValues(model({ variantLabel: 'Steel', variantSwatch: '#9D9B96' }))).toEqual({ label: '', swatch: '#a7a29a', skuPrefix: '' });
    expect(proposeVariantPrefix(fresh, 'Blue')).toBe('MNL-BL');
    expect(proposeVariantPrefix({ skuPrefix: 'ZENITH' }, ' night  blue ')).toBe('ZENITH-NI');
    expect(proposeVariantPrefix(fresh, 'Éclat')).toBe('MNL-EC');
    expect(proposeVariantPrefix(fresh, '')).toBe('');
    const values = (extra: Record<string, string> = {}) => ({ mainLabel: 'Steel', mainSwatch: '#9d9b96', label: 'Blue', swatch: '#16224a', skuPrefix: 'MNL-BL', ...extra });
    expect(variantProblem(fresh, values())).toBeNull();
    expect(variantProblem(fresh, values({ mainLabel: '' }))).toBe('Give this model a label: Steel.');
    expect(variantProblem(fresh, values({ mainSwatch: 'grey' }))).toBe('This model’s colour is #RRGGBB: choose it with the picker.');
    expect(variantProblem(fresh, values({ label: ' ' }))).toBe('Give the variant a label: Steel.');
    expect(variantProblem(fresh, values({ label: 'x'.repeat(41) }))).toBe('A label is one line of 1 to 40 characters.');
    expect(variantProblem(fresh, values({ swatch: 'blue' }))).toBe('The variant’s colour is #RRGGBB: choose it with the picker.');
    expect(variantProblem(fresh, values({ label: 'STEEL' }))).toBe('This model or another of its variants already has this label.');
    expect(variantProblem(model({ variantLabel: 'Steel', variants: [variant('Gold')] }), values({ label: 'gold' }))).toBe('This model or another of its variants already has this label.');
    expect(variantProblem(fresh, values({ skuPrefix: 'MNL BL!' }))).toBe('SKU prefix: 1 to 32 letters, digits, dots, underscores or hyphens.');
    expect(variantProblem(fresh, values({ skuPrefix: 'mnl-st' }))).toBe('A variant has its own SKU prefix.');
    expect(variantProblem(model({ variantOf: { id: 'm0', name: 'MONOLITHE', label: 'Steel' } }), values())).toBe('This model is a variant: add the variant to its main model.');
    // What is sent: trimmed, the colours in capitals, the SKU prefix too; the main model's dot only while it has none.
    expect(variantInput(fresh, values({ label: '  Night   blue ', skuPrefix: ' mnl-nb ' }))).toEqual({ label: 'Night blue', swatch: '#16224A', skuPrefix: 'MNL-NB', mainLabel: 'Steel', mainSwatch: '#9D9B96' });
    expect(variantInput(model({ variantLabel: 'Steel' }), values())).toEqual({ label: 'Blue', swatch: '#16224A', skuPrefix: 'MNL-BL' });
  });

  it('a label and its colour change together; a variant and a model with variants keep theirs; a model alone may drop its own', () => {
    const blue = model({ id: 'v1', variantLabel: 'Blue', variantSwatch: '#16224A', variantOf: { id: 'm0', name: 'MONOLITHE', label: 'Steel' } });
    expect(dotFormValues(blue)).toEqual({ label: 'Blue', swatch: '#16224a' });
    expect(dotFormValues(model())).toEqual({ label: '', swatch: '#a7a29a' });
    expect(keepsLabel(blue)).toBe(true);
    expect(keepsLabel(model({ variants: [variant('Gold')] }))).toBe(true);
    expect(keepsLabel(model())).toBe(false);
    expect(dotProblem(blue, { label: '', swatch: '#16224a' }, ['Steel'])).toBe('A variant, and a model with variants, keep their label: each is one of the model’s dots.');
    expect(dotProblem(blue, { label: 'steel', swatch: '#16224a' }, ['Steel'])).toBe('This model or another of its variants already has this label.');
    expect(dotProblem(blue, { label: 'Night', swatch: 'x' }, ['Steel'])).toBe('The colour is #RRGGBB: choose it with the picker.');
    expect(dotProblem(model(), { label: '', swatch: '#a7a29a' }, [])).toBeNull();
    expect(dotChange(blue, { label: 'Night blue', swatch: '#0a0a0a' })).toEqual({ variantLabel: 'Night blue', variantSwatch: '#0A0A0A' });
    expect(dotChange(blue, { label: 'Blue', swatch: '#16224a' })).toEqual({});
    expect(dotChange(model({ variantLabel: 'Silver', variantSwatch: '#D7D5D0' }), { label: '', swatch: '#d7d5d0' })).toEqual({ variantLabel: null, variantSwatch: null });
  });
});

describe('a draw\'s price in the console (NOCTURNE, addition 5)', () => {
  const NOW = new Date('2026-10-05T16:49:00.000Z');
  const base = { id: 'd1', title: 'MONOLITHE, THE OCTOBER DRAW', description: null, model: { id: 'm1', name: 'MONOLITHE', type: 'BRACELET', active: true, variant: null }, quantity: 12, opensAt: '2026-10-05T10:00:00.000Z', closesAt: '2026-10-11T18:00:00.000Z', purchaseWindowHours: 48, earlyAccessHours: 0, priceMinor: null, currency: null } as unknown as Drop;
  const values = (extra: Record<string, string> = {}) => ({ ...dropFormValues(base, NOW), ...extra });

  it('is typed in units with its currency, optional, in the server\'s bound', () => {
    expect(DROP_LIMITS.priceMax).toBe(DRAW_PRICE_MAX_MINOR);
    expect(dropFormValues(null, NOW)).toMatchObject({ price: '', currency: 'EUR' });
    expect(dropFormValues({ ...base, priceMinor: 420_050, currency: 'CHF' } as Drop, NOW)).toMatchObject({ price: '4200.50', currency: 'CHF' });
    expect(dropProblem(values())).toBeNull();
    expect(dropProblem(values({ price: '4 200' }))).toBeNull();
    for (const bad of ['abc', '-1', '4200.555', '10000001']) expect(drawPriceProblem(values({ price: bad })), bad).toBe('The price is an amount in units: 4200, or 4200.50.');
    expect(drawPriceProblem(values({ price: '4200', currency: 'JPY' }))).toBe('A draw is priced in EUR, GBP, USD, CHF.');
  });

  it('sends the price with its currency, or neither; a change sends both', () => {
    expect(dropInput(values())).toMatchObject({ priceMinor: null, currency: null });
    expect(dropInput(values({ price: '4200', currency: 'EUR' }))).toMatchObject({ priceMinor: 420_000, currency: 'EUR' });
    expect(dropChange(base, values())).toEqual({});
    expect(dropChange(base, values({ price: '4200' }))).toEqual({ priceMinor: 420_000, currency: 'EUR' });
    const priced = { ...base, priceMinor: 420_000, currency: 'EUR' } as Drop;
    expect(dropChange(priced, values({ price: '4200', currency: 'EUR' }))).toEqual({});
    expect(dropChange(priced, values({ price: '' }))).toEqual({ priceMinor: null, currency: null });
    expect(dropChange(priced, values({ price: '4200', currency: 'USD' }))).toEqual({ priceMinor: 420_000, currency: 'USD' });
  });

  it('reads on the release\'s page as the house writes a price, or None', () => {
    expect(drawPriceText(base)).toBe('None');
    expect(drawPriceText({ priceMinor: 420_000, currency: 'EUR' })).toBe(formatMoney(420_000, 'EUR'));
    expect(formatMoney(420_000, 'EUR').replace(/\s/g, ' ')).toBe('€ 4 200');
  });
});

describe('the piece\'s field set at issuance, named Size (NOCTURNE N1)', () => {
  it('reads Size on the product page, a value written before as it is', () => {
    const rows = productAttributes({
      product: {
        category: { code: 'J', name: 'Jewelry' },
        collection: 'ORBITAL',
        model: { name: 'MONOLITHE', type: 'BRACELET' },
        variant: 'Size 52',
        material: '925 STERLING SILVER',
        sku: 'MNL-ST-52',
        productionBatch: null,
        productionDate: null,
        createdAt: '2026-10-01T08:00:00.000Z',
        serial: 184,
        authPolicy: 'PRINTED_CODE',
        hasClaimSecret: true,
      },
    } as unknown as ProductDetail);
    expect(rows.map((r) => r.label)).toContain('Size');
    expect(rows.map((r) => r.label)).not.toContain('Variant');
    expect(rows.find((r) => r.label === 'Size')!.value).toBe('SIZE 52');
  });
});
