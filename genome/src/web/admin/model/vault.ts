/**
 * CLUB > THE VAULT in the console (lot Q3, step Q3.12; plan §4; vault/SCOPE.md E12 "Console: CLUB > THE VAULT: the
 * table, a switch per source, GIVE A VAULT (collector or segment), the switch on each LIVE release, the report"): every
 * word of the tab, the client sheet's THE VAULT block and the LIVE release's switch, and the pure rules the views read
 * (the odds' sum and the floor, the pickers, the forms, the reach, the report's lines). The server is the authority
 * (services/vault.ts): what is checked here only says the server's refusal before the request.
 *
 * The console's existing patterns (D62 "never console mockups"): tables, dialogs and definition lists as Club → Drops,
 * Tiers and Segments. Times and days are Paris's.
 */
import { formatCount } from '../format.js';
import { dayText, parisDayText } from './client-profile.js';
import { formatMoney, moneyField, parseMoney } from './live.js';
import { modelChoice } from './variants.js';
import {
  HOUSE_CURRENCIES,
  type AddonView,
  type AdminVault,
  type Model,
  type VaultGiven,
  type VaultMoney,
  type VaultReport,
  type VaultRewardInput,
  type VaultRewardKind,
  type VaultRewardMode,
  type VaultRewardSetting,
  type VaultSettings,
  type VaultSource,
  type VaultSourceSetting,
  type VaultState,
  type VaultWonFigures,
} from '../types.js';
import type { Tone } from './tone.js';

/** The draw's parts (services/vault.ts VAULT_DRAW_PARTS): each row of "1 IN N" holds round(1 000 000 / N). */
export const VAULT_DRAW_PARTS = 1_000_000;

/** The server's bounds (schema.ts): odds, quantity, amount, a VAULT EDITION's line, a source's vaults and cap, the note. */
export const VAULT_LIMITS = Object.freeze({ oddsMax: 1_000_000, quantityMax: 100_000_000, amountMax: 100_000_000, line: 120, perOccasion: { min: 1, max: 10 }, cap: { min: 1, max: 100 }, note: 500 });

/** Every word of CLUB > THE VAULT. */
export const VAULT_COPY = Object.freeze({
  tab: 'THE VAULT',
  lead: 'What the owners’ club of /verify offers. THE VAULT: a vault given on seven occasions waits 30 days in YOUR ACCOUNT; opened, it gives one reward, drawn on the server from the one house table below. I WAS THERE, the floor, takes the odds the other rows leave. Test entrants never get a vault.',
  eyebrow: 'Club · THE VAULT',
  table: 'The table',
  tableNote: 'One table for every source. Each row its odds, 1 IN N, and its quantity, the limit; a row that cannot give sends its chance to I WAS THERE.',
  newReward: 'New reward',
  editReward: 'Edit reward',
  deactivate: 'Deactivate',
  activate: 'Activate',
  up: 'Up',
  down: 'Down',
  sources: 'Sources',
  sourcesNote: 'Each occasion its switch, the vaults it gives and how many times an account receives them. An ADMIN changes them.',
  give: 'Give a vault',
  giveTitle: 'GIVE A VAULT',
  giveSection: 'Give a vault',
  giveText: 'THE HOUSE gives a vault to one collector (by email), or one to each member of a segment (an ADMIN). The reach is shown before anything is given; test entrants and inactive accounts are left out. The collector reads a FROM ORBES message, never the note.',
  report: 'Report',
  csv: 'Download CSV',
  from: 'First day',
  to: 'Last day',
  apply: 'Show',
  noReward: 'No row but I WAS THERE: every vault holds the card.',
  saved: 'Reward saved.',
  added: 'Reward added.',
  deactivated: 'Reward deactivated.',
  activated: 'Reward active again.',
  moved: 'Order saved.',
  sourceSaved: 'Source saved.',
  floorFixed: 'The floor: always there, its odds the rest.',
  service: 'A service cannot be a vault’s reward.',
  oddsOver: 'The odds of the active rewards add up to more than one in one. Lower one first.',
  periodProblem: 'Give a first and a last day, the last not before the first.',
  noVault: 'No vault given to this client.',
  clientNote: 'Read-only: what each vault was given for, its state and what it held. Only a returned piece takes an unopened vault back.',
});

// ── Sources ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Each source as the console names it. */
export const VAULT_SOURCE_NAMES: Readonly<Record<VaultSource, string>> = Object.freeze({
  LIVE: 'LIVE release',
  PIECE: 'Piece bought',
  TIER: 'New tier',
  WORN: 'WORN photograph',
  FRIEND: 'Friend’s first piece',
  PROFILE: 'Complete profile',
  HOUSE: 'THE HOUSE',
});

/** When each source gives (round 5, D3). */
export const VAULT_SOURCE_WHEN: Readonly<Record<VaultSource, string>> = Object.freeze({
  LIVE: 'Its size sold out while the collector was still in the line, on a release with THE VAULT on.',
  PIECE: 'Each piece bought, on any channel, once registered to its buyer.',
  TIER: 'Each tier reached, TITANE at the first piece.',
  WORN: 'A WORN photograph published.',
  FRIEND: 'A friend’s first piece, through the personal invitation.',
  PROFILE: 'The profile completed.',
  HOUSE: 'GIVE A VAULT, to a collector or a segment.',
});

/** What a source's cap counts, in its own words (§4.1). */
export const VAULT_CAP_SCOPES: Readonly<Record<VaultSource, string | null>> = Object.freeze({
  LIVE: 'per release',
  PIECE: 'per piece',
  TIER: 'per tier',
  WORN: 'per piece',
  FRIEND: 'per friend',
  PROFILE: 'ever',
  HOUSE: null,
});

/** OP-29's defaults (D27 "these are only the defaults"): on, one vault per occasion, at most one occasion; the house's gifts uncapped. */
export const VAULT_SOURCE_DEFAULTS: Readonly<Record<VaultSource, { enabled: boolean; perOccasion: number; cap: number | null }>> = Object.freeze({
  LIVE: { enabled: true, perOccasion: 1, cap: 1 },
  PIECE: { enabled: true, perOccasion: 1, cap: 1 },
  TIER: { enabled: true, perOccasion: 1, cap: 1 },
  WORN: { enabled: true, perOccasion: 1, cap: 1 },
  FRIEND: { enabled: true, perOccasion: 1, cap: 1 },
  PROFILE: { enabled: true, perOccasion: 1, cap: 1 },
  HOUSE: { enabled: true, perOccasion: 1, cap: null },
});

const vaults = (n: number) => `${formatCount(n)} ${n === 1 ? 'vault' : 'vaults'}`;

/** Vaults one occasion gives: `1 vault`, `2 vaults`. */
export const perOccasionText = (n: number): string => vaults(n);

/** A source's cap in its words: `At most 1 per release`, `At most 1 ever`; THE HOUSE: `None: each gift is its own`. */
export function capText(source: VaultSource, cap: number | null): string {
  const scope = VAULT_CAP_SCOPES[source];
  if (cap === null || scope === null) return 'None: each gift is its own';
  return `At most ${formatCount(cap)} ${scope}`;
}

/** OP-29's default of a source, beside its setting: `Default: on · 1 vault · at most 1 per release`. */
export function sourceDefaultText(source: VaultSource): string {
  const d = VAULT_SOURCE_DEFAULTS[source];
  return `Default: ${d.enabled ? 'on' : 'off'} · ${perOccasionText(d.perOccasion)} · ${capText(source, d.cap).replace(/^At most/, 'at most').replace(/^None: each gift is its own$/, 'no cap')}`;
}

/** Whether a source reads its defaults. */
export function sourceIsDefault(s: VaultSourceSetting): boolean {
  const d = VAULT_SOURCE_DEFAULTS[s.source];
  return s.enabled === d.enabled && s.perOccasion === d.perOccasion && s.cap === d.cap;
}

export type SourceForm = { enabled: string; perOccasion: string; cap: string };

export function sourceFormValues(s: VaultSourceSetting): SourceForm {
  return { enabled: s.enabled ? 'true' : '', perOccasion: String(s.perOccasion), cap: s.cap === null ? '' : String(s.cap) };
}

const whole = (v: string | undefined): number | null => (/^\d{1,9}$/.test((v ?? '').trim()) ? Number((v ?? '').trim()) : null);

/** A source's form's problem, or null. */
export function sourceProblem(source: VaultSource, v: Record<string, string>): string | null {
  const per = whole(v.perOccasion);
  if (per === null || per < VAULT_LIMITS.perOccasion.min || per > VAULT_LIMITS.perOccasion.max) return `Vaults per occasion: a whole number from ${VAULT_LIMITS.perOccasion.min} to ${VAULT_LIMITS.perOccasion.max}.`;
  if (VAULT_CAP_SCOPES[source] !== null) {
    const cap = whole(v.cap);
    if (cap === null || cap < VAULT_LIMITS.cap.min || cap > VAULT_LIMITS.cap.max) return `The cap: a whole number from ${VAULT_LIMITS.cap.min} to ${VAULT_LIMITS.cap.max}.`;
  }
  return null;
}

/** A source's form as PUT …/sources/:source takes it. */
export function sourceInput(source: VaultSource, v: Record<string, string>): { enabled: boolean; perOccasion: number; cap: number | null } {
  return { enabled: v.enabled === 'true', perOccasion: whole(v.perOccasion) ?? 1, cap: VAULT_CAP_SCOPES[source] === null ? null : (whole(v.cap) ?? 1) };
}

/** Whether a source's form changes nothing. */
export function sourceUnchanged(s: VaultSourceSetting, v: Record<string, string>): boolean {
  const i = sourceInput(s.source, v);
  return i.enabled === s.enabled && i.perOccasion === s.perOccasion && i.cap === s.cap;
}

// ── The table ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Each kind as the console names it. */
export const VAULT_KIND_LABELS: Readonly<Record<VaultRewardKind, string>> = Object.freeze({
  CREDIT: 'House credit',
  ADDON: 'Free add-on',
  GUARANTEED: 'GUARANTEED',
  PRODUCT: 'Product',
  VAULT_EDITION: 'VAULT EDITION',
  THE_PIECE: 'THE PIECE',
  CREDIT_TO_GIVE: 'Credit to give',
  I_WAS_THERE: 'I WAS THERE',
});

/** The kinds New reward offers, in the table's order (the floor is always there: never added). */
export const NEW_REWARD_KINDS: readonly Exclude<VaultRewardKind, 'I_WAS_THERE'>[] = Object.freeze(['CREDIT', 'ADDON', 'PRODUCT', 'GUARANTEED', 'CREDIT_TO_GIVE', 'VAULT_EDITION', 'THE_PIECE'] as const);

/** What a kind gives, said under New reward's kind (round 2 and 3, D19, D20, D29, N11–N13). */
export const VAULT_KIND_HINTS: Readonly<Record<VaultRewardKind, string>> = Object.freeze({
  CREDIT: 'A credit of the amount set, in YOUR ACCOUNT for 30 days.',
  ADDON: 'An add-on free on the collector’s next order, within 30 days. Add-ons of kind PRODUCT only: a service is never a reward.',
  GUARANTEED: 'A piece at the next LIVE release, any model: a house guarantee of 1 piece.',
  PRODUCT: 'A model or an add-on of the catalogue, FREE (an order at 0, claimed within 30 days) or with a RIGHT TO BUY (24 hours, at its usual price).',
  VAULT_EDITION: 'A model marked VAULT ONLY in the Catalogue, never sold: free, an order at 0.',
  THE_PIECE: 'The model of the release the collector missed, in their size, free. Only a LIVE release’s vault; elsewhere its chance goes to I WAS THERE.',
  CREDIT_TO_GIVE: 'A credit the collector gives to a friend for their first piece, valid 30 days.',
  I_WAS_THERE: 'The card: the release, or the occasion, and its date.',
});

export const VAULT_MODE_LABELS: Readonly<Record<VaultRewardMode, string>> = Object.freeze({ FREE: 'FREE', RIGHT_TO_BUY: 'RIGHT TO BUY' });

/** `1 IN 200`, `1 IN 2 000`. */
export const oddsText = (n: number): string => `1 IN ${formatCount(n)}`;

/** The parts a row of "1 IN `oddsIn`" holds (services/vault.ts rewardParts). */
export function rewardParts(oddsIn: number): number {
  return Math.round(VAULT_DRAW_PARTS / oddsIn);
}

/** The floor's published odds for the parts it holds (services/vault.ts floorOddsIn); null when it holds none. */
export function floorOddsIn(floorParts: number): number | null {
  return floorParts > 0 ? Math.max(1, Math.round(VAULT_DRAW_PARTS / floorParts)) : null;
}

/** Parts as a share of the draw: `27.44 %`. */
export function partsShare(parts: number): string {
  return `${(Math.round((parts / VAULT_DRAW_PARTS) * 10_000) / 100).toFixed(2)} %`;
}

/** What a row is (§4.1): the credit's amount, the product or add-on and its mode, the VAULT EDITION's model and line, … */
export function rewardWhat(r: Pick<VaultRewardSetting, 'kind' | 'amountMinor' | 'currency' | 'modelName' | 'addonName' | 'mode' | 'line'>): string {
  const money = r.amountMinor !== null && r.currency ? formatMoney(r.amountMinor, r.currency) : '—';
  switch (r.kind) {
    case 'CREDIT':
      return `${money} of house credit, 30 days`;
    case 'CREDIT_TO_GIVE':
      return `${money} to give, for a friend’s first piece`;
    case 'ADDON':
      return `${r.addonName ?? '—'} · free on the next order`;
    case 'PRODUCT':
      return `${r.modelName ?? r.addonName ?? '—'} · ${r.mode ? VAULT_MODE_LABELS[r.mode] : '—'}`;
    case 'GUARANTEED':
      return 'A piece at the next LIVE release';
    case 'VAULT_EDITION':
      return r.line ? `${r.modelName ?? '—'} · ${r.line}` : (r.modelName ?? '—');
    case 'THE_PIECE':
      return 'The missed model, the collector’s size';
    case 'I_WAS_THERE':
      return 'The card: the release, or the occasion, and its date';
  }
}

/** A row's odds as the table says them: the floor's its published ones, `the rest`. */
export function rowOddsText(r: VaultRewardSetting, floor: VaultSettings['floor']): string {
  if (r.kind === 'I_WAS_THERE') return floor.oddsIn === null ? 'None left' : oddsText(floor.oddsIn);
  return r.oddsIn === null ? '—' : oddsText(r.oddsIn);
}

/** Under the table: the odds' sum and the floor's published odds (N15). */
export function oddsSumLine(s: Pick<VaultSettings, 'partsGiven' | 'floor'>): string {
  const floor = s.floor.oddsIn === null ? 'none: the table holds the whole draw' : `${oddsText(s.floor.oddsIn)} (${partsShare(s.floor.parts)})`;
  return `The rewards hold ${partsShare(s.partsGiven)} of the draw. I WAS THERE holds the rest, published as ${floor}.`;
}

/** The table's rows in its order, the floor among them where it was placed. */
export function tableRows(s: VaultSettings): VaultRewardSetting[] {
  return [...s.rewards].sort((a, b) => a.position - b.position);
}

/** The order with one row moved up (−1) or down (+1); null when it cannot move. */
export function movedOrder(rows: readonly VaultRewardSetting[], id: string, by: -1 | 1): string[] | null {
  const ids = rows.map((r) => r.id);
  const i = ids.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  return ids;
}

/** The status mark of a row: ACTIVE, or INACTIVE; the floor ALWAYS. */
export function rowStatus(r: VaultRewardSetting): { text: string; tone: Tone } {
  if (r.kind === 'I_WAS_THERE') return { text: 'ALWAYS', tone: 'solid' };
  return r.active ? { text: 'ACTIVE', tone: 'solid' } : { text: 'INACTIVE', tone: 'muted' };
}

/** The models a picker offers: PRODUCT the models sold (never a vault-only one), VAULT EDITION the vault-only ones. */
export function rewardModelOptions(models: readonly Model[], kind: 'PRODUCT' | 'VAULT_EDITION', current: string | null = null): { value: string; label: string }[] {
  const fits = (m: Model) => (kind === 'VAULT_EDITION' ? m.vaultOnly === true : m.vaultOnly !== true && m.active);
  return [
    { value: '', label: kind === 'VAULT_EDITION' ? 'Choose a vault-only model' : 'Choose a model' },
    ...models.filter((m) => fits(m) || m.id === current).map((m) => ({ value: m.id, label: modelChoice(m) })),
  ];
}

/** The add-ons a picker offers (§4.1, E7 "No access, status or service rewards"): of kind PRODUCT only, active, never a SERVICE. */
export function rewardAddonOptions(addons: readonly AddonView[], current: string | null = null): { value: string; label: string }[] {
  return [{ value: '', label: 'Choose an add-on' }, ...addons.filter((a) => a.kind === 'PRODUCT' && (a.active || a.id === current)).map((a) => ({ value: a.id, label: a.name }))];
}

export type RewardForm = {
  kind: string;
  amount: string;
  currency: string;
  productOf: string;
  modelId: string;
  addonId: string;
  mode: string;
  line: string;
  oddsIn: string;
  quantity: string;
  active: string;
};

/** The form of New reward (empty, credit in euros, FREE) or of a row's Edit. */
export function rewardFormValues(r: VaultRewardSetting | null): RewardForm {
  if (!r) return { kind: 'CREDIT', amount: '', currency: 'EUR', productOf: 'MODEL', modelId: '', addonId: '', mode: 'FREE', line: '', oddsIn: '', quantity: '', active: 'true' };
  return {
    kind: r.kind,
    amount: r.amountMinor === null ? '' : moneyField(r.amountMinor),
    currency: r.currency ?? 'EUR',
    productOf: r.addonId ? 'ADDON' : 'MODEL',
    modelId: r.modelId ?? '',
    addonId: r.addonId ?? '',
    mode: r.mode ?? 'FREE',
    line: r.line ?? '',
    oddsIn: r.oddsIn === null ? '' : String(r.oddsIn),
    quantity: r.quantity === null ? '' : String(r.quantity),
    active: r.active ? 'true' : '',
  };
}

const isKind = (v: string): v is VaultRewardKind => (VAULT_KIND_LABELS as Record<string, string>)[v] !== undefined;

/** Whether the form's kind takes an amount, a model, an add-on, a mode, a line. */
export const takesAmount = (kind: string) => kind === 'CREDIT' || kind === 'CREDIT_TO_GIVE';
export const takesModel = (v: Pick<RewardForm, 'kind' | 'productOf'>) => v.kind === 'VAULT_EDITION' || (v.kind === 'PRODUCT' && v.productOf !== 'ADDON');
export const takesAddon = (v: Pick<RewardForm, 'kind' | 'productOf'>) => v.kind === 'ADDON' || (v.kind === 'PRODUCT' && v.productOf === 'ADDON');

/** The row a form makes, whole for its kind, as POST and PUT …/rewards take it. */
export function rewardInput(v: Record<string, string>, opts: { withKind: boolean }): VaultRewardInput {
  const kind = v.kind as VaultRewardKind;
  const f = v as unknown as RewardForm;
  return {
    ...(opts.withKind ? { kind } : {}),
    oddsIn: whole(v.oddsIn) ?? 0,
    quantity: whole(v.quantity) ?? 0,
    ...(takesAmount(kind) ? { amountMinor: parseMoney(v.amount), currency: v.currency } : {}),
    ...(takesModel(f) ? { modelId: v.modelId || null } : {}),
    ...(takesAddon(f) ? { addonId: v.addonId || null } : {}),
    ...(kind === 'PRODUCT' ? { mode: (v.mode as VaultRewardMode) || 'FREE' } : {}),
    ...(kind === 'VAULT_EDITION' ? { line: v.line.trim() ? v.line.trim().replace(/\s+/g, ' ') : null } : {}),
    ...(opts.withKind ? {} : { active: v.active === 'true' }),
  };
}

/**
 * The parts the active rows would hold with this form saved (the floor's excepted): the table's, without the row edited
 * when it was active, with the form's odds when it is (to be) active.
 */
export function partsWith(s: Pick<VaultSettings, 'partsGiven' | 'rewards'>, v: Record<string, string>, editing: VaultRewardSetting | null): number | null {
  const odds = whole(v.oddsIn);
  if (odds === null || odds < 1 || odds > VAULT_LIMITS.oddsMax) return null;
  const before = editing && editing.active ? editing.parts : 0;
  const active = editing ? v.active === 'true' : true;
  return s.partsGiven - before + (active ? rewardParts(odds) : 0);
}

/** The live line under the form: the share the rewards would hold and the floor's odds after it; above one, the refusal. */
export function rewardOddsLine(s: Pick<VaultSettings, 'partsGiven' | 'rewards'>, v: Record<string, string>, editing: VaultRewardSetting | null): string | null {
  const parts = partsWith(s, v, editing);
  if (parts === null) return null;
  if (parts > VAULT_DRAW_PARTS) return VAULT_COPY.oddsOver;
  const floor = floorOddsIn(VAULT_DRAW_PARTS - parts);
  return `With it, the rewards hold ${partsShare(parts)} of the draw; I WAS THERE ${floor === null ? 'none' : oddsText(floor)}.`;
}

/** A reward form's problem, or null (the server says the rest: a vault-only model as a product, a service add-on). */
export function rewardProblem(s: Pick<VaultSettings, 'partsGiven' | 'rewards'>, v: Record<string, string>, editing: VaultRewardSetting | null, addons: readonly AddonView[] = []): string | null {
  const kind = editing ? editing.kind : v.kind;
  if (!kind || !isKind(kind) || kind === 'I_WAS_THERE') return 'Choose what the reward is.';
  const f = { ...(v as unknown as RewardForm), kind };
  if (takesAmount(kind)) {
    const amount = parseMoney(v.amount);
    if (amount === null || amount < 1 || amount > VAULT_LIMITS.amountMax) return 'The amount: in units, 25 or 25.50.';
    if (!(HOUSE_CURRENCIES as readonly string[]).includes(v.currency ?? '')) return `The currency is one of ${HOUSE_CURRENCIES.join(', ')}.`;
  }
  if (takesModel(f) && !v.modelId) return kind === 'VAULT_EDITION' ? 'Choose the vault-only model.' : 'Choose the model.';
  if (takesAddon(f)) {
    if (!v.addonId) return 'Choose the add-on.';
    if (addons.find((a) => a.id === v.addonId)?.kind === 'SERVICE') return VAULT_COPY.service;
  }
  if (kind === 'VAULT_EDITION' && [...v.line.trim()].length > VAULT_LIMITS.line) return `The line: at most ${VAULT_LIMITS.line} characters.`;
  const odds = whole(v.oddsIn);
  if (odds === null || odds < 1 || odds > VAULT_LIMITS.oddsMax) return `The odds: 1 IN a whole number from 1 to ${formatCount(VAULT_LIMITS.oddsMax)}.`;
  const quantity = whole(v.quantity);
  if (quantity === null || quantity > VAULT_LIMITS.quantityMax) return 'The quantity: a whole number, 0 or more.';
  if (editing && quantity < editing.given) return `The quantity is at least what was given: ${formatCount(editing.given)}.`;
  const parts = partsWith(s, v, editing);
  if (parts !== null && parts > VAULT_DRAW_PARTS) return VAULT_COPY.oddsOver;
  return null;
}

/** Whether an Edit changes nothing. */
export function rewardUnchanged(r: VaultRewardSetting, v: Record<string, string>): boolean {
  const a = rewardInput({ ...rewardFormValues(r), kind: r.kind }, { withKind: false });
  const b = rewardInput({ ...v, kind: r.kind }, { withKind: false });
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── GIVE A VAULT ──────────────────────────────────────────────────────────────────────────────────────────────

export type GiveTo = 'COLLECTOR' | 'SEGMENT';

/** Whom GIVE A VAULT may reach for this role: a collector (OPERATOR), a segment too (ADMIN). */
export function giveToOptions(admin: boolean): { value: GiveTo; label: string }[] {
  return [{ value: 'COLLECTOR', label: 'A collector' }, ...(admin ? [{ value: 'SEGMENT' as const, label: 'A segment (one vault to each member)' }] : [])];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** GIVE A VAULT's first dialog's problem, or null. */
export function giveProblem(v: Record<string, string>): string | null {
  if (v.to === 'SEGMENT') return v.segmentId ? null : 'Choose the segment.';
  if (!EMAIL_RE.test((v.email ?? '').trim())) return 'The collector’s email.';
  if ((v.note ?? '').trim().length > VAULT_LIMITS.note) return `The note: at most ${VAULT_LIMITS.note} characters.`;
  return null;
}

/** GIVE A VAULT's request from its form (`accountId` when the client sheet gives it). */
export function giveInput(v: Record<string, string>, opts: { accountId?: string; dryRun: boolean; giftId?: string }): { accountId?: string; email?: string; segmentId?: string; note?: string; dryRun: boolean; giftId?: string } {
  const note = (v.note ?? '').trim();
  return {
    ...(opts.accountId ? { accountId: opts.accountId } : v.to === 'SEGMENT' ? { segmentId: v.segmentId } : { email: (v.email ?? '').trim() }),
    ...(note ? { note } : {}),
    dryRun: opts.dryRun,
    ...(opts.giftId ? { giftId: opts.giftId } : {}),
  };
}

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** The reach, shown before GIVE (N25): `Reaches 1 collector: 1 vault each.` and who is left out. */
export function reachLines(g: VaultGiven, perOccasion: number): string[] {
  const out = g.leftOut.testEntrants + g.leftOut.inactive;
  return [
    g.reach === 0 ? 'Reaches nobody: nothing would be given.' : `Reaches ${plural(g.reach, 'collector', 'collectors')}: ${perOccasionText(perOccasion)} each.`,
    out === 0 ? 'Nobody left out.' : `Left out: ${plural(g.leftOut.testEntrants, 'test entrant', 'test entrants')}, ${plural(g.leftOut.inactive, 'inactive account', 'inactive accounts')}.`,
  ];
}

/** The toast once given. */
export function givenText(g: VaultGiven): string {
  return g.vaults === 0 ? 'No vault given.' : `${vaults(g.vaults)} given to ${plural(g.accounts, 'collector', 'collectors')}.`;
}

// ── The report ────────────────────────────────────────────────────────────────────────────────────────────────

/** Money in each currency, `€ 25 · £ 10`; `—` for none. */
export function moneyList(list: readonly VaultMoney[]): string {
  return list.length ? list.map((m) => formatMoney(m.minor, m.currency)).join(' · ') : '—';
}

/** A cost: its money and, apart, the units with no supplier price (N29). */
export function costText(f: Pick<VaultWonFigures, 'cost' | 'costUnknown'>): string {
  const unknown = f.costUnknown > 0 ? `${formatCount(f.costUnknown)} unknown` : null;
  if (f.cost.length === 0) return unknown ?? '—';
  return unknown ? `${moneyList(f.cost)} · ${unknown}` : moneyList(f.cost);
}

/** The report's summary: `12 given · 8 opened · 3 waiting · 1 expired · 0 returned`. */
export function reportSummary(r: VaultReport): string {
  return `${formatCount(r.givenTotal)} given · ${formatCount(r.opened)} opened · ${formatCount(r.waiting)} waiting · ${formatCount(r.expired)} expired · ${formatCount(r.revoked)} returned`;
}

/** The period read: `1 OCT 2026 to 30 OCT 2026, Paris days`. */
export function reportPeriodText(r: Pick<VaultReport, 'from' | 'to'>): string {
  return `${dayText(r.from)} to ${dayText(r.to)}, Paris days`;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A period's problem (both days or neither, the last not before the first), or null. */
export function reportPeriodProblem(from: string, to: string): string | null {
  if (!from && !to) return null;
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || to < from) return VAULT_COPY.periodProblem;
  return null;
}

/** The report's period from the address: both days or neither. */
export function reportPeriod(query: Record<string, string>): { from?: string; to?: string } {
  const from = query.from ?? '';
  const to = query.to ?? '';
  return DAY_RE.test(from) && DAY_RE.test(to) && to >= from ? { from, to } : {};
}

// ── The client sheet ──────────────────────────────────────────────────────────────────────────────────────────

/** A vault's state as the sheet says it; REVOKED is a returned piece's (D5, the only taking-back). */
export const VAULT_STATE_LABELS: Readonly<Record<VaultState, string>> = Object.freeze({ WAITING: 'WAITING', OPENED: 'OPENED', EXPIRED: 'EXPIRED', REVOKED: 'RETURNED' });

export const VAULT_STATE_TONES: Readonly<Record<VaultState, Tone>> = Object.freeze({ WAITING: 'solid', OPENED: 'outline', EXPIRED: 'muted', REVOKED: 'muted' });

/** A client's vault's source: the console's name, its detail after it (`LIVE release · MONOLITHE IN BLUE`). */
export function vaultSourceText(v: Pick<AdminVault, 'source' | 'detail'>): string {
  return v.detail ? `${VAULT_SOURCE_NAMES[v.source]} · ${v.detail}` : VAULT_SOURCE_NAMES[v.source];
}

/** Under its state: until when it waits, when it was opened or went back with its piece (Paris days). */
export function vaultStateNote(v: AdminVault): string {
  if (v.state === 'OPENED') return `Opened ${parisDayText(v.openedAt)}`;
  if (v.state === 'REVOKED') return `With its piece, ${parisDayText(v.revokedAt)}`;
  if (v.state === 'EXPIRED') return `Unopened by ${parisDayText(v.waitsUntil)}`;
  return `Until ${parisDayText(v.waitsUntil)}`;
}

/** What it held, with its odds (`€ 25 · HOUSE CREDIT · 1 IN 10`); `—` while unopened. */
export function vaultHeldText(v: Pick<AdminVault, 'held' | 'odds'>): string {
  if (!v.held) return '—';
  return v.odds ? `${v.held} · ${v.odds}` : v.held;
}

/** The sheet's note: how many wait now, of how many given. */
export function clientVaultsNote(list: readonly AdminVault[]): string {
  const waiting = list.filter((v) => v.state === 'WAITING').length;
  return `${formatCount(waiting)} waiting · ${formatCount(list.length)} given`;
}

// ── The LIVE release and the catalogue ────────────────────────────────────────────────────────────────────────

/** The LIVE release's switch (D4): its value, why it can no longer change, and its dialog's words. */
export const LIVE_VAULT = Object.freeze({
  label: 'THE VAULT',
  on: 'On',
  off: 'Off',
  onNote: 'A size sold out gives a vault to each collector still in its line (test entrants never).',
  offNote: 'Off by default: no vault from this release.',
  endedNote: 'The release has ended: the switch no longer changes.',
  turnOn: 'Turn on',
  turnOff: 'Turn off',
  turnOnTitle: 'THE VAULT on for this release',
  turnOffTitle: 'THE VAULT off for this release',
  turnOnText: 'From now until the end, when a size sells out, each collector still waiting or queued in it gets a vault (one per account for the release and its after-room). A release that closes with pieces left gives none.',
  turnOffText: 'From now on, a size that sells out gives no vault. The vaults already given stay.',
  onDone: 'THE VAULT is on for this release.',
  offDone: 'THE VAULT is off for this release.',
});

/** Whether THE VAULT's switch changes on this release (D4): a release's own (never an after-room's), until its end. */
export function liveVaultSwitchable(r: { phase: string; afterRoomOf?: { id: string } | null }, manageDrops: boolean): boolean {
  return manageDrops && !r.afterRoomOf && r.phase !== 'ENDED' && r.phase !== 'CANCELLED';
}

/** The release report's THE VAULT figures (§4.2): each its label (no figure), value, note and test id. */
export function liveVaultReportFigures(v: { on: boolean; given: number; opened: number }): [label: string, value: string, note: string, testId: string][] {
  return [
    ['Vaults given', formatCount(v.given), v.on ? 'SIZES SOLD OUT, THE LINE STILL WAITING' : 'THE VAULT WAS OFF', 'live-report-vaults-given'],
    ['Vaults opened', formatCount(v.opened), v.given === 0 ? 'NONE GIVEN' : `OF ${formatCount(v.given)} GIVEN`, 'live-report-vaults-opened'],
  ];
}

/** The model form's VAULT ONLY (§4.5). */
export const VAULT_ONLY = Object.freeze({
  label: 'VAULT ONLY',
  mark: 'VAULT ONLY',
  hint: 'Never sold: draws, LIVE releases, the private salon, YOUR WISHLIST and the Shopify export refuse it. Given only from THE VAULT, as a VAULT EDITION. The lookbook still shows it.',
  done: (on: boolean) => (on ? 'The model is VAULT ONLY.' : 'The model is sold again.'),
});

/** The Orders board's line on a VAULT order (§4.5). */
export const FROM_THE_VAULT = 'FROM THE VAULT';
