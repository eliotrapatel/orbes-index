/**
 * THE PROGRAM and SHIPPING in the console (plan NEXT-NINE, BP-19 T2) — pure helpers, no DOM.
 *
 *  - THE PROGRAM (Club → Tiers, ADMIN): every figure of the tiers' benefits the owner called configurable, as the
 *    section lists it and the Edit program dialog holds it: the early access by default (PALLADIUM's window at least
 *    PLATINE's), the free shipping, the yearly care, the Messages priority, the welcome gift of each tier (an active
 *    model of the catalogue), the credit (its amounts, currency, validity and channels), the experiences' tiers; what
 *    the server would refuse before anything is sent (services/club-program.ts), and what to send.
 *  - SHIPPING (Orders → Settings, ADMIN): the optional rates, per currency and service, '—' for none.
 */
import { formatDateTime } from '../format.js';
import { formatMoney, moneyField, parseMoney } from './live.js';
import {
  CREDIT_CHANNELS,
  HOUSE_CURRENCIES,
  SHIPPING_FREE_LEVELS,
  SHIPPING_SERVICES,
  type ClubProgram,
  type ClubProgramSheet,
  type CreditChannel,
  type GiftModel,
  type HouseCurrency,
  type ShippingFreeLevel,
  type ShippingRate,
  type ShippingService,
} from '../types.js';

/** The bounds the server holds THE PROGRAM to (services/club-program.ts PROGRAM_LIMITS). */
export const PROGRAM_LIMITS = Object.freeze({
  hours: Object.freeze({ min: 0, max: 336 }),
  care: Object.freeze({ min: 0, max: 20 }),
  credit: Object.freeze({ min: 0, max: 100_000_000 }),
  validity: Object.freeze({ min: 1, max: 60 }),
  fee: Object.freeze({ min: 0, max: 100_000_000 }),
});

const TIER_WORDS: Readonly<Record<1 | 2 | 3, string>> = Object.freeze({ 1: 'TITANE', 2: 'PLATINE', 3: 'PALLADIUM' });

/** The free shipping a tier gives, in words. */
export const SHIPPING_FREE_LABELS: Readonly<Record<ShippingFreeLevel, string>> = Object.freeze({ NONE: 'None', STANDARD: 'Standard', EXPRESS: 'Express' });
/** A delivery service, in words. */
export const SHIPPING_SERVICE_LABELS: Readonly<Record<ShippingService, string>> = Object.freeze({ STANDARD: 'Standard', EXPRESS: 'Express' });
/** The channels a credit is taken off, in words. */
export const CREDIT_CHANNEL_LABELS: Readonly<Record<CreditChannel, string>> = Object.freeze({ DRAW: 'Draw', LIVE: 'LIVE RELEASE', SALON: 'The private salon' });

/** `4 hours`, `1 hour`, `None` (0). */
export function hoursText(n: number): string {
  return n === 0 ? 'None' : `${n} ${n === 1 ? 'hour' : 'hours'}`;
}

/** A tier's yearly care: `1 piece a year`, `Every piece`, `None`. */
export function careText(n: number | null): string {
  if (n === null) return 'Every piece';
  return n === 0 ? 'None' : `${n} ${n === 1 ? 'piece' : 'pieces'} a year`;
}

/** The Messages priority: `From PLATINE`, `Off`. */
export function priorityText(t: 0 | 2 | 3): string {
  return t === 0 ? 'Off' : `From ${TIER_WORDS[t]}`;
}

/** An experience's tier: `From PALLADIUM`. */
export function fromTier(t: 1 | 2 | 3): string {
  return `From ${TIER_WORDS[t]}`;
}

/** A gift model as THE PROGRAM's select lists it: `MONOLITHE · 3 sizes · 4 available`, `HALO · one size · 0 available`. */
export function giftOptionLabel(m: Pick<GiftModel, 'name' | 'sizes' | 'available'>): string {
  const sizes = m.sizes === 1 ? 'one size' : `${m.sizes} sizes`;
  return `${m.name} · ${sizes} · ${m.available} available`;
}

/** A tier's gift, as the section says it: the model's name, `None`, and a note when the model is discontinued. */
export function giftText(m: GiftModel | null): { value: string; note: string | null } {
  if (!m) return { value: 'None', note: null };
  return {
    value: m.name,
    note: m.active ? null : 'This gift’s model is discontinued: no gift is added until another is chosen.',
  };
}

/** A credit: `€ 50 · valid 12 months`, `None`. */
export function creditText(minor: number, p: Pick<ClubProgram, 'creditCurrency' | 'creditValidityMonths'>): string {
  if (minor === 0) return 'None';
  const m = p.creditValidityMonths;
  return `${formatMoney(minor, p.creditCurrency)} · valid ${m} ${m === 1 ? 'month' : 'months'}`;
}

/** The channels a credit is taken off: `Draw, LIVE RELEASE, The private salon`. */
export function channelsText(channels: readonly CreditChannel[]): string {
  return CREDIT_CHANNELS.filter((c) => channels.includes(c)).map((c) => CREDIT_CHANNEL_LABELS[c]).join(', ');
}

/** Who changed THE PROGRAM, and when: `Changed by a@orbes.test on 06 OCT 2026 · 14:02 UTC`, or `The defaults`. */
export function changedText(s: Pick<ClubProgramSheet, 'updatedAt' | 'updatedBy'>): string {
  if (!s.updatedAt) return 'The defaults';
  return `Changed${s.updatedBy ? ` by ${s.updatedBy.email}` : ''} on ${formatDateTime(s.updatedAt)}`;
}

// ── The dialog ─────────────────────────────────────────────────────────────

/** The care's select: `ALL` (every piece, PALLADIUM only), then 0 (none) to 20. */
export function careOptions(all: boolean): { value: string; label: string }[] {
  const counts = Array.from({ length: PROGRAM_LIMITS.care.max + 1 }, (_, n) => ({ value: String(n), label: n === 0 ? 'None' : `${n} ${n === 1 ? 'piece' : 'pieces'} a year` }));
  return all ? [{ value: 'ALL', label: 'Every piece' }, ...counts] : counts;
}

/** The gift's select: None, the active models, and the model chosen now when it is no longer active (it may stay). */
export function giftOptions(s: Pick<ClubProgramSheet, 'giftOptions'>, current: GiftModel | null): { value: string; label: string }[] {
  const options = [{ value: '', label: 'None' }, ...s.giftOptions.map((m) => ({ value: m.id, label: giftOptionLabel(m) }))];
  if (current && !s.giftOptions.some((m) => m.id === current.id)) options.push({ value: current.id, label: `${current.name} · discontinued` });
  return options;
}

/** THE PROGRAM as the dialog holds it. */
export function programValues(p: ClubProgram): Record<string, string> {
  return {
    earlyAccessPalladiumHours: String(p.earlyAccessPalladiumHours),
    earlyAccessPlatineHours: String(p.earlyAccessPlatineHours),
    shippingFreePlatine: p.shippingFreePlatine,
    shippingFreePalladium: p.shippingFreePalladium,
    carePiecesPlatine: String(p.carePiecesPlatine),
    carePiecesPalladium: p.carePiecesPalladium === null ? 'ALL' : String(p.carePiecesPalladium),
    messagesPriorityMinTier: String(p.messagesPriorityMinTier),
    giftPlatineModelId: p.giftPlatineModelId ?? '',
    giftPalladiumModelId: p.giftPalladiumModelId ?? '',
    creditPlatine: moneyField(p.creditPlatineMinor),
    creditPalladium: moneyField(p.creditPalladiumMinor),
    creditCurrency: p.creditCurrency,
    creditValidityMonths: String(p.creditValidityMonths),
    creditDraw: p.creditChannels.includes('DRAW') ? 'true' : '',
    creditLive: p.creditChannels.includes('LIVE') ? 'true' : '',
    creditSalon: p.creditChannels.includes('SALON') ? 'true' : '',
    experienceMembersEveningMinTier: String(p.experienceMembersEveningMinTier),
    experienceLaunchPreviewMinTier: String(p.experienceLaunchPreviewMinTier),
    experiencePartnerMinTier: String(p.experiencePartnerMinTier),
  };
}

const wholeIn = (v: string | undefined, { min, max }: { min: number; max: number }): number | null => {
  const t = (v ?? '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
};

/** What the server would refuse in THE PROGRAM's dialog, said before anything is sent; null when it holds. */
export function programProblem(v: Record<string, string>): string | null {
  const palladium = wholeIn(v.earlyAccessPalladiumHours, PROGRAM_LIMITS.hours);
  const platine = wholeIn(v.earlyAccessPlatineHours, PROGRAM_LIMITS.hours);
  if (palladium === null || platine === null) return `Each early access is ${PROGRAM_LIMITS.hours.min} to ${PROGRAM_LIMITS.hours.max} hours.`;
  if (palladium < platine) return 'PALLADIUM’s early access starts no later than PLATINE’s.';
  for (const k of ['creditPlatine', 'creditPalladium'] as const) {
    const minor = parseMoney(v[k]);
    if (minor === null || minor > PROGRAM_LIMITS.credit.max) return 'A credit is an amount in units: 50, or 50.50 (0 for none).';
  }
  if (!(HOUSE_CURRENCIES as readonly string[]).includes(v.creditCurrency ?? '')) return 'Choose the credit’s currency.';
  if (wholeIn(v.creditValidityMonths, PROGRAM_LIMITS.validity) === null) return `A credit is valid ${PROGRAM_LIMITS.validity.min} to ${PROGRAM_LIMITS.validity.max} months.`;
  if (v.creditDraw !== 'true' && v.creditLive !== 'true' && v.creditSalon !== 'true') return 'The credit is taken off at least one kind of order.';
  return null;
}

/** THE PROGRAM to send, from the dialog (programProblem first). */
export function programInput(v: Record<string, string>): ClubProgram {
  const tier = (x: string | undefined) => Number(x) as 1 | 2 | 3;
  return {
    earlyAccessPalladiumHours: Number(v.earlyAccessPalladiumHours!.trim()),
    earlyAccessPlatineHours: Number(v.earlyAccessPlatineHours!.trim()),
    shippingFreePlatine: (SHIPPING_FREE_LEVELS as readonly string[]).includes(v.shippingFreePlatine ?? '') ? (v.shippingFreePlatine as ShippingFreeLevel) : 'NONE',
    shippingFreePalladium: (SHIPPING_FREE_LEVELS as readonly string[]).includes(v.shippingFreePalladium ?? '') ? (v.shippingFreePalladium as ShippingFreeLevel) : 'NONE',
    carePiecesPlatine: Number(v.carePiecesPlatine ?? 0),
    carePiecesPalladium: v.carePiecesPalladium === 'ALL' ? null : Number(v.carePiecesPalladium ?? 0),
    messagesPriorityMinTier: Number(v.messagesPriorityMinTier ?? 0) as 0 | 2 | 3,
    giftPlatineModelId: v.giftPlatineModelId || null,
    giftPalladiumModelId: v.giftPalladiumModelId || null,
    creditPlatineMinor: parseMoney(v.creditPlatine) ?? 0,
    creditPalladiumMinor: parseMoney(v.creditPalladium) ?? 0,
    creditCurrency: v.creditCurrency as HouseCurrency,
    creditValidityMonths: Number(v.creditValidityMonths!.trim()),
    creditChannels: [...(v.creditDraw === 'true' ? ['DRAW' as const] : []), ...(v.creditLive === 'true' ? ['LIVE' as const] : []), ...(v.creditSalon === 'true' ? ['SALON' as const] : [])],
    experienceMembersEveningMinTier: tier(v.experienceMembersEveningMinTier),
    experienceLaunchPreviewMinTier: tier(v.experienceLaunchPreviewMinTier),
    experiencePartnerMinTier: tier(v.experiencePartnerMinTier),
  };
}

/** THE PROGRAM's figures alone, in one order (a sheet carries more: its gifts, lines and author). */
function figures(p: ClubProgram): string {
  const keys = Object.keys(programValuesKeys).sort() as (keyof ClubProgram)[];
  return JSON.stringify(keys.map((k) => (k === 'creditChannels' ? [...p.creditChannels].sort() : p[k])));
}
const programValuesKeys: Record<keyof ClubProgram, true> = {
  earlyAccessPalladiumHours: true,
  earlyAccessPlatineHours: true,
  shippingFreePlatine: true,
  shippingFreePalladium: true,
  carePiecesPlatine: true,
  carePiecesPalladium: true,
  messagesPriorityMinTier: true,
  giftPlatineModelId: true,
  giftPalladiumModelId: true,
  creditPlatineMinor: true,
  creditPalladiumMinor: true,
  creditCurrency: true,
  creditValidityMonths: true,
  creditChannels: true,
  experienceMembersEveningMinTier: true,
  experienceLaunchPreviewMinTier: true,
  experiencePartnerMinTier: true,
};

/** Whether the dialog changes THE PROGRAM. */
export function programChanged(p: ClubProgram, next: ClubProgram): boolean {
  return figures(p) !== figures(next);
}

// ── SHIPPING ───────────────────────────────────────────────────────────────

/** The rate's field name in the dialog: `EUR-STANDARD`. */
export const rateField = (currency: HouseCurrency, service: ShippingService) => `${currency}-${service}`;

/** A cell of the table: its fee, or `—` when none is set. */
export function rateText(rates: readonly ShippingRate[], currency: HouseCurrency, service: ShippingService): string {
  const r = rates.find((x) => x.currency === currency && x.service === service);
  return r ? formatMoney(r.feeMinor, currency) : '—';
}

/** The rates as the dialog holds them: an amount, or empty. */
export function ratesValues(rates: readonly ShippingRate[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of HOUSE_CURRENCIES) {
    for (const s of SHIPPING_SERVICES) {
      const r = rates.find((x) => x.currency === c && x.service === s);
      out[rateField(c, s)] = r ? moneyField(r.feeMinor) : '';
    }
  }
  return out;
}

/** What the server would refuse in the rates' dialog. */
export function ratesProblem(v: Record<string, string>): string | null {
  for (const c of HOUSE_CURRENCIES) {
    for (const s of SHIPPING_SERVICES) {
      const t = (v[rateField(c, s)] ?? '').trim();
      if (!t) continue;
      const minor = parseMoney(t);
      if (minor === null || minor > PROGRAM_LIMITS.fee.max) return `${c} ${SHIPPING_SERVICE_LABELS[s]}: an amount in units, 20 or 20.50, or empty for none.`;
    }
  }
  return null;
}

/** The rates to send: the cells filled; an empty one is cleared. */
export function ratesInput(v: Record<string, string>): ShippingRate[] {
  const out: ShippingRate[] = [];
  for (const c of HOUSE_CURRENCIES) {
    for (const s of SHIPPING_SERVICES) {
      const t = (v[rateField(c, s)] ?? '').trim();
      const minor = t ? parseMoney(t) : null;
      if (minor !== null) out.push({ currency: c, service: s, feeMinor: minor });
    }
  }
  return out;
}

/** Whether the dialog changes the rates. */
export function ratesChanged(rates: readonly ShippingRate[], next: readonly ShippingRate[]): boolean {
  const key = (r: readonly ShippingRate[]) => JSON.stringify([...r].map((x) => `${x.currency}-${x.service}-${x.feeMinor}`).sort());
  return key(rates) !== key(next);
}
