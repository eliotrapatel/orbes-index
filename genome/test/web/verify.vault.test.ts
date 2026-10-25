/**
 * THE VAULT page's model (lot Q3, step Q3.11; plan §3.5–§3.11, §3b; MK #vault-page): its doors (MK's labels word for
 * word, WAITS UNTIL a Paris day), OPENED (the day, the bare label, what it held with € kept: OP-32; SAVE THE IMAGE, GIVE
 * IT, GIVEN: N33), the ledger's states (N21; THE HOUSE as it is: OP-21), the grid (CREDIT never €, RARE on the three, no
 * odds: D45), the words (his sentence: D16; "we" only in the vault's own words: D13; never "paid": D52), the odds as the
 * vault writes them, the quiet number and NOW's line (D18), the invitation's and the gift's addresses (N10), YOUR ORDERS'
 * piece won free (D20) and the I WAS THERE image (D11, N4).
 */
import { describe, expect, it } from 'vitest';
import { VAULT } from '../../src/web/verify/copy.js';
import { orderModel, orderVaultClaim } from '../../src/web/verify/orders-model.js';
import type { AccountOrder, AccountVaultsView } from '../../src/web/verify/types.js';
import { drawIWasThere, iWasThereWords, I_WAS_THERE, nameLines, type IWasThereContext } from '../../src/web/verify/vault/i-was-there.js';
import { giftCodeOf, giftUrl, isVaultPagePath, iWasThere, joinCodeOf, nowVaultLine, parisTime, revealAction, vaultDay, vaultGiftModel, vaultLinkOf, vaultOdds, vaultPageModel, vaultQuietNumber } from '../../src/web/verify/vault-model.js';

/** MK V's demo, as the server reads it. */
const DEMO: AccountVaultsView = {
  waiting: [
    { id: 'v1', source: 'LIVE', label: 'YOUR SIZE SOLD OUT', detail: 'MONOLITHE IN BLUE', line: 'YOUR SIZE SOLD OUT · MONOLITHE IN BLUE', givenAt: '2026-10-28T19:00:00Z', waitsUntil: '2026-11-27T20:00:00Z', waitsUntilDay: '2026-11-27' },
    { id: 'v2', source: 'TIER', label: 'A NEW TIER', detail: 'PLATINE', line: 'A NEW TIER · PLATINE', givenAt: '2026-10-31T10:00:00Z', waitsUntil: '2026-11-30T11:00:00Z', waitsUntilDay: '2026-11-30' },
  ],
  opened: [
    { id: 'o1', source: 'PIECE', label: 'A NEW PIECE', detail: 'MONOLITHE IN STEEL', givenDay: '2026-10-20', openedAt: '2026-10-28T10:00:00Z', openedDay: '2026-10-28', kind: 'CREDIT', prize: '€25', prizeLine: 'House credit, valid 30 days.', held: '€25 · HOUSE CREDIT', gift: null },
    { id: 'o2', source: 'LIVE', label: 'YOUR SIZE SOLD OUT', detail: 'MONOLITHE IN GOLD', givenDay: '2026-09-28', openedAt: '2026-10-03T10:00:00Z', openedDay: '2026-10-03', kind: 'I_WAS_THERE', prize: 'I WAS THERE', prizeLine: 'Your card for this release. Save it.', held: 'I WAS THERE', gift: null },
    { id: 'o3', source: 'PROFILE', label: 'A COMPLETE PROFILE', detail: null, givenDay: '2026-09-12', openedAt: '2026-09-12T10:00:00Z', openedDay: '2026-09-12', kind: 'CREDIT_TO_GIVE', prize: '€30 TO GIVE', prizeLine: 'For a friend’s first piece.', held: '€30 TO GIVE', gift: { code: 'ABCD-EFGH-JKMN', given: false } },
  ],
  ledger: [
    { source: 'LIVE', next: '2026-10-28' },
    { source: 'PIECE' },
    { source: 'TIER', tier: 'PLATINE', pieces: 7, next: { tier: 'PALLADIUM', pieces: 10, away: 3 } },
    { source: 'WORN' },
    { source: 'FRIEND' },
    { source: 'PROFILE', done: true, percent: 100 },
    { source: 'HOUSE' },
  ],
  waitingCount: 2,
  grid: (['CREDIT', 'ADDON', 'GUARANTEED', 'PRODUCT', 'CREDIT_TO_GIVE', 'I_WAS_THERE', 'VAULT_EDITION', 'THE_PIECE'] as const).map((kind) => ({ kind, rare: kind === 'GUARANTEED' || kind === 'VAULT_EDITION' || kind === 'THE_PIECE' })),
};

describe('THE VAULT page (lot Q3, step Q3.11; MK V)', () => {
  it('draws MK V\'s demo: YOUR VAULTS · 2 WAITING, each door its source line and WAITS UNTIL; OPENED compact with € kept and its actions', () => {
    const m = vaultPageModel(DEMO);
    expect(m.heading).toBe('YOUR VAULTS · 2 WAITING');
    expect(m.first).toBe(false);
    expect(m.none).toBeNull();
    expect(m.doors.map((d) => [d.line, d.until])).toEqual([
      ['YOUR SIZE SOLD OUT · MONOLITHE IN BLUE', 'WAITS UNTIL 27 NOVEMBER'],
      ['A NEW TIER · PLATINE', 'WAITS UNTIL 30 NOVEMBER'],
    ]);
    expect(m.opened.map((r) => [r.day, r.label, r.held, r.action?.kind ?? null])).toEqual([
      ['28 OCTOBER', 'A NEW PIECE', '€25 · HOUSE CREDIT', null],
      ['3 OCTOBER', 'YOUR SIZE SOLD OUT', 'I WAS THERE', 'save'],
      ['12 SEPTEMBER', 'A COMPLETE PROFILE', '€30 TO GIVE', 'give'],
    ]);
    // A credit to give accepted reads GIVEN; one no longer to give (its code gone), nothing.
    const given = vaultPageModel({ ...DEMO, opened: [{ ...DEMO.opened[2]!, gift: { code: null, given: true } }, { ...DEMO.opened[2]!, id: 'o4', gift: { code: null, given: false } }] });
    expect(given.opened.map((r) => r.action)).toEqual([{ kind: 'given' }, null]);
  });

  it('reads the ledger with this collector\'s state (N21; OP-21) and the grid of eight, RARE on three, CREDIT never €, no odds (D45)', () => {
    const m = vaultPageModel(DEMO);
    expect(m.ledger.map((r) => [r.label, r.line, r.state?.text ?? null, r.state?.link ?? null])).toEqual([
      ['A LIVE RELEASE', 'Your size sells out while you stay in the line.', 'NEXT: 28 OCTOBER', null],
      ['EACH PIECE', 'Each piece you buy, once registered.', 'WITH YOUR NEXT PIECE', null],
      ['A NEW TIER', 'Reaching the next tier.', 'PALLADIUM · 3 PIECES AWAY', null],
      ['WORN', 'A photograph of you wearing a piece, published in WORN.', 'SEND A PHOTOGRAPH', 'worn'],
      ['A FRIEND', 'A friend’s first piece.', 'INVITE A FRIEND', 'invite'],
      ['YOUR PROFILE', 'A complete profile, once.', 'DONE', null],
      ['THE HOUSE', 'At times, from the house.', 'AT ITS DISCRETION', null],
    ]);
    expect(m.ledger[2]!.progress).toEqual({ fraction: 0.7, of: '7 OF 10 PIECES' });
    expect(m.ledger[5]!.state?.done).toBe(true);
    // No next release: nothing on the right; PALLADIUM reached: the highest tier; a profile incomplete: its own value.
    const other = vaultPageModel({
      ...DEMO,
      ledger: [
        { source: 'LIVE', next: null },
        { source: 'TIER', tier: 'PALLADIUM', pieces: 12, next: null },
        { source: 'PROFILE', done: false, percent: 60 },
      ],
    });
    expect(other.ledger.map((r) => r.state?.text ?? null)).toEqual([null, 'PALLADIUM · THE HIGHEST TIER', '60% COMPLETE']);
    expect(other.ledger[2]!.state?.link).toBe('profile');
    expect(m.grid.map((g) => [g.label, g.rare])).toEqual([
      ['CREDIT', false],
      ['AN ADD-ON', false],
      ['GUARANTEED', true],
      ['A PIECE', false],
      ['CREDIT TO GIVE', false],
      ['I WAS THERE', false],
      ['VAULT EDITION', true],
      ['THE PIECE', true],
    ]);
    for (const g of m.grid) {
      expect(`${g.label} ${g.line}`).not.toMatch(/€|\bIN \d|odds/i);
    }
    expect(m.grid.find((g) => g.kind === 'GUARANTEED')!.line).toBe('A piece at the next LIVE release.');
  });

  it('says none waiting in one line, and a first visit shows neither YOUR VAULTS nor OPENED', () => {
    const empty = vaultPageModel({ ...DEMO, waiting: [], waitingCount: 0 });
    expect([empty.heading, empty.none, empty.first]).toEqual(['YOUR VAULTS', 'No vault is waiting.', false]);
    const first = vaultPageModel({ ...DEMO, waiting: [], opened: [], waitingCount: 0 });
    expect([first.first, first.none, first.doors.length, first.opened.length]).toEqual([true, null, 0, 0]);
    // A row the app cannot read is left out, never guessed.
    expect(vaultPageModel({ ...DEMO, waiting: [{ ...DEMO.waiting[0]!, waitsUntilDay: 'soon' }] }).doors).toEqual([]);
  });

  it('keeps his sentence word for word, MK\'s four labels, "we" out of the page\'s words, never "paid"', () => {
    expect(VAULT.page.lead).toBe('Vaults are given on specific occasions, to eligible collectors, at the ORBES team’s discretion.');
    expect(VAULT.page.overline).toBe('YOUR ACCOUNT · THE VAULT');
    expect(VAULT.page.press).toBe('PRESS AND HOLD');
    const words = JSON.stringify([VAULT.page, VAULT.ledger, VAULT.grid, VAULT.orders, VAULT.gift, VAULT.join, VAULT.now.open]);
    expect(words).not.toMatch(/\bwe\b|\bpaid\b|atelier|handmade|kept for you|set aside/i);
    expect(VAULT.ledger.HOUSE).toEqual({ label: 'THE HOUSE', line: 'At times, from the house.' });
    expect(VAULT.ledger.discretion).toBe('AT ITS DISCRETION');
  });

  it('writes the odds as the vault does, Paris days and times, the quiet number and NOW\'s line', () => {
    expect([vaultOdds('1 IN 10'), vaultOdds('1 IN 200'), vaultOdds('1 IN 2000'), vaultOdds('1 IN 1000000'), vaultOdds('ODDS')]).toEqual(['1 IN 10', '1 IN 200', '1 IN 2,000', '1 IN 1,000,000', 'ODDS']);
    expect([vaultDay('2026-11-27'), vaultDay('2026-01-01'), vaultDay('27/11')]).toEqual(['27 NOVEMBER', '1 JANUARY', '']);
    // 19:14 UTC on 21 October is 21:14 in Paris (summer time).
    expect(parisTime('2026-10-21T19:14:00Z')).toBe('21:14');
    expect([vaultQuietNumber(2), vaultQuietNumber(0), vaultQuietNumber(null)]).toEqual(['2', null, null]);
    expect(nowVaultLine(1)).toEqual({ label: 'A VAULT IS WAITING FOR YOU', action: 'OPEN' });
    expect(nowVaultLine(3)?.label).toBe('3 VAULTS ARE WAITING FOR YOU');
    expect(nowVaultLine(0)).toBeNull();
  });

  it('reads the page\'s, the invitation\'s and the gift\'s addresses', () => {
    expect([isVaultPagePath('/verify/vault'), isVaultPagePath('/verify/vault/'), isVaultPagePath('/verify/vaults')]).toEqual([true, true, false]);
    expect(joinCodeOf('/verify/join/abcd-efgh-jkmn')).toBe('ABCD-EFGH-JKMN');
    expect(joinCodeOf('/verify/join/ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN');
    expect([joinCodeOf('/verify/join/short'), joinCodeOf('/verify/join/ABCD-EFGH-JKMU'), giftCodeOf('/verify/join/ABCD-EFGH-JKMN')]).toEqual([null, null, null]);
    expect(giftCodeOf('/verify/gift/ABCD-EFGH-JKMN')).toBe('ABCD-EFGH-JKMN');
    expect([vaultLinkOf('/verify/join/x'), vaultLinkOf('/verify/gift/x'), vaultLinkOf('/verify/vault')]).toEqual(['join', 'gift', null]);
    expect(giftUrl('https://theorbes.com', 'ABCD-EFGH-JKMN')).toBe('https://theorbes.com/verify/gift/ABCD-EFGH-JKMN');
  });

  it('reads a credit to give for its friend: ACCEPT while it can be accepted, else why not', () => {
    const g = { amount: '€30', amountMinor: 3000, currency: 'EUR', expiresAt: '2026-11-27T10:00:00Z', expiresDay: '2026-11-27', state: 'OPEN' as const, canAccept: true, refusal: null };
    expect(vaultGiftModel(g)).toEqual({ title: 'A FRIEND SENT YOU A CREDIT', line: '€30 for your first piece, until 27 NOVEMBER.', canAccept: true, note: null });
    expect(vaultGiftModel({ ...g, canAccept: false, refusal: 'This credit is yours to give to a friend.' }).note).toBe('This credit is yours to give to a friend.');
    expect(vaultGiftModel({ ...g, state: 'ACCEPTED', canAccept: false }).note).toBe(VAULT.gift.accepted);
    expect(vaultGiftModel({ ...g, state: 'ENDED', canAccept: false }).canAccept).toBe(false);
  });

  it('puts SAVE THE IMAGE or GIVE IT under an opened reveal (N33), nothing under another reward', () => {
    const image = iWasThere('LIVE', 'YOUR SIZE SOLD OUT', 'MONOLITHE IN BLUE', '2026-10-05');
    expect(image).toEqual({ eyebrow: 'LIVE RELEASE', name: 'MONOLITHE IN BLUE', date: '5 OCTOBER 2026' });
    expect(iWasThere('TIER', 'A NEW TIER', 'PLATINE', '2026-10-05')).toEqual({ eyebrow: 'A NEW TIER', name: 'PLATINE', date: '5 OCTOBER 2026' });
    expect(revealAction({ kind: 'I_WAS_THERE', giftCode: null }, image)).toEqual({ kind: 'save', image });
    expect(revealAction({ kind: 'CREDIT_TO_GIVE', giftCode: 'ABCD-EFGH-JKMN' }, image)).toEqual({ kind: 'give', code: 'ABCD-EFGH-JKMN' });
    expect(revealAction({ kind: 'CREDIT', giftCode: null }, image)).toBeNull();
  });

  it('draws the I WAS THERE image on 1080 × 1350: the wordmark, I WAS THERE, the release and its date, nothing else (D11)', () => {
    const texts: string[] = [];
    const ctx: IWasThereContext = {
      fillStyle: '',
      font: '',
      textAlign: 'left',
      textBaseline: 'middle',
      globalAlpha: 1,
      fillRect: () => {},
      fillText: (t) => void texts.push(t),
      measureText: () => ({ width: 20 }),
      setTransform: () => {},
      fill: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }) as unknown as CanvasGradient,
    };
    (globalThis as unknown as { Path2D: unknown }).Path2D ??= class {};
    const m = { eyebrow: 'LIVE RELEASE', name: 'MONOLITHE IN BLUE', date: '5 OCTOBER 2026' };
    drawIWasThere(ctx, m, { display: 'G', reading: 'R' });
    expect(texts.join('')).toBe('ORBESIWASTHERELIVERELEASEMONOLITHEINBLUE5OCTOBER2026');
    expect(iWasThereWords(m)).toEqual(['ORBES', 'I WAS THERE', 'LIVE RELEASE', 'MONOLITHE IN BLUE', '5 OCTOBER 2026']);
    expect(nameLines('MONOLITHE IN BLUE')).toEqual(['MONOLITHE', 'IN BLUE']);
    expect([I_WAS_THERE.width, I_WAS_THERE.height]).toEqual([1080, 1350]);
  });
});

describe('YOUR ORDERS with THE VAULT (lot Q3 §3.8; D20)', () => {
  const order = (over: Partial<AccountOrder>): AccountOrder =>
    ({
      id: '11111111-1111-4111-8111-111111111111',
      reference: 'OR-11111111',
      channel: 'VAULT',
      release: null,
      model: 'MONOLITHE',
      modelVariant: 'Blue',
      size: { label: '17' },
      priceMinor: 0,
      currency: 'EUR',
      addons: [],
      addonItems: [],
      shipping: { service: 'STANDARD', minor: 0, currency: 'EUR', benefit: null, withOrder: null },
      status: 'RESERVED',
      reservedAt: '2026-10-04T09:30:00Z',
      paidAt: null,
      shippedAt: null,
      deliveredAt: null,
      cancelledAt: null,
      returnedAt: null,
      shipment: null,
      documents: { invoice: null, creditNote: null, others: [], careGuide: true, certificate: false, careConditions: true },
      imageUrl: null,
      address: null,
      vault: { free: true, claimBy: '2026-11-03T23:00:00Z' },
      ...over,
    }) as unknown as AccountOrder;

  it('reads a piece won free: FROM THE VAULT, FREE, its sentence until its Paris day, CLAIM IT (the address asked first)', () => {
    const m = orderModel(order({}))!;
    expect(m.line).toBe('FROM THE VAULT · MONOLITHE IN BLUE');
    expect(m.sentence).toBe('Yours, free. Choose its size and its address, then claim it. Yours until 4 NOVEMBER.');
    expect(m.rows).toContainEqual(['PRICE', 'FREE']);
    expect(m.rows).toContainEqual(['SHIPPING', 'FREE']);
    expect(orderVaultClaim(order({}), Date.parse('2026-10-05T16:49:00Z'))).toMatchObject({ until: '4 NOVEMBER', needsAddress: true, label: 'Claim MONOLITHE IN BLUE' });
    // Past its day, claimed, or bought under a right to buy: no CLAIM IT.
    expect(orderVaultClaim(order({}), Date.parse('2026-11-04T00:00:00Z'))).toBeNull();
    expect(orderVaultClaim(order({ status: 'PAID' }), Date.parse('2026-10-05T16:49:00Z'))).toBeNull();
    expect(orderVaultClaim(order({ priceMinor: 505_000, vault: { free: false, claimBy: null } }), Date.parse('2026-10-05T16:49:00Z'))).toBeNull();
  });
});
