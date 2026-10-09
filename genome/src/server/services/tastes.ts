/**
 * YOUR TASTES (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.2 W.5, step 1.3; migration 0040 `account_tastes`): a
 * collector's favourite pieces (a type of the catalogue, « RING ») and favourite finishes (a variant's label,
 * « Gold »), chosen « from the catalogue (its types and variants), updated automatically », and saved inside YOUR
 * PROFILE's one SAVE (services/profiles.ts).
 *
 *   options  the choices, read live on each call from the models shown PUBLIC in THE COLLECTION (a variant through its
 *            main model), active, not discontinued, with an address: their types, and the labels of the models of a
 *            group of variants, each label with the casing and the colour most of them carry (ties to the earliest
 *            published, then the lowest id). Salon (RESERVED) and HIDDEN models are left out; no material is offered.
 *   read     an account's tastes: a saved key among the choices takes the catalogue's label (and colour); one that is
 *            not is `retired` and keeps its stored label, after the current ones of its group.
 *   write    the whole set, in the caller's transaction (which holds the account): a key already held is kept, even
 *            retired; a new one must be a current choice (400 TASTE_UNKNOWN); 30 of a kind at most (400
 *            TASTES_TOO_MANY). Rows not chosen any more are deleted, new ones inserted with their current label; a key
 *            kept keeps its `created_at`. No audit entry of its own: it returns the counts, which YOUR PROFILE's one
 *            `account.profile.update` carries, never the words.
 *
 * A key is the words trimmed, inner spaces made single, in capitals (src/shared/profile-rules.ts tasteKey). The keys of
 * the choices are computed by the database itself (`upper(regexp_replace(btrim(…), '\s+', ' ', 'g'))`), so a stored
 * key always meets migration 0040's CHECK, whatever the words; what a collector sends is matched to them through
 * `tasteKey`.
 */
import { sql } from 'kysely';
import type { Db } from '../db/connection.js';
import type { TasteKind } from '../db/schema.js';
import { badRequest } from '../errors.js';
import { tasteKey, TASTES_MAX } from '../../shared/profile-rules.js';
import { systemClock, type Clock } from '../types.js';

export { tasteKey, TASTES_MAX } from '../../shared/profile-rules.js';

/** A favourite piece the catalogue offers: its key, and its label (the key: the types are written in capitals). */
export interface TasteOption {
  key: string;
  label: string;
}

/** A favourite finish the catalogue offers: its key, the casing and the colour most of its models carry. */
export interface FinishOption extends TasteOption {
  swatch: string;
}

/** What the catalogue offers now, each list in alphabetical order. */
export interface TasteOptions {
  pieces: TasteOption[];
  finishes: FinishOption[];
}

/** A saved taste: the catalogue's words while it is offered, else its own (`retired`: NO LONGER IN THE COLLECTION). */
export interface Taste {
  key: string;
  label: string;
  swatch?: string;
  retired: boolean;
}

/** An account's tastes, the current ones first in alphabetical order, then the retired ones. */
export interface AccountTastes {
  pieces: Taste[];
  finishes: Taste[];
}

/** What a save of the tastes changed: how many of each are held after it, how many were added and removed. */
export interface TasteCounts {
  pieces: number;
  finishes: number;
  added: number;
  removed: number;
}

/** The tastes a save sends: the whole set of keys of each kind. */
export interface TastesInput {
  pieces: readonly string[];
  finishes: readonly string[];
}

// ── Errors ─────────────────────────────────────────────────────────────────

export const tasteUnknown = () => badRequest('TASTE_UNKNOWN', 'Choose among the pieces and finishes of the collection.');
export const tastesTooMany = () => badRequest('TASTES_TOO_MANY', `Choose up to ${TASTES_MAX} favourite pieces and ${TASTES_MAX} favourite finishes.`);

// ── Reading the catalogue ──────────────────────────────────────────────────

interface ChoiceRow {
  id: string;
  published_at: Date | null;
  type_key: string;
  variant_label: string | null;
  variant_swatch: string | null;
  finish_key: string | null;
  in_group: boolean;
}

/** The value most rows carry; ties to the first in the rows' order (the earliest published, then the lowest id). */
function majority(values: readonly string[]): string {
  const seen = new Map<string, { n: number; first: number }>();
  values.forEach((v, i) => {
    const s = seen.get(v);
    if (s) s.n++;
    else seen.set(v, { n: 1, first: i });
  });
  let best: [string, { n: number; first: number }] | null = null;
  for (const e of seen) if (!best || e[1].n > best[1].n || (e[1].n === best[1].n && e[1].first < best[1].first)) best = e;
  return best![0];
}

const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** The choices the catalogue offers now (see the header). One read of `models`, no cache. */
export async function tasteOptions(db: Db): Promise<TasteOptions> {
  const r = await sql<ChoiceRow>`
    SELECT m.id, m.published_at,
           upper(regexp_replace(btrim(m.type), '\\s+', ' ', 'g')) AS type_key,
           m.variant_label, m.variant_swatch,
           CASE WHEN m.variant_label IS NOT NULL THEN upper(regexp_replace(btrim(m.variant_label), '\\s+', ' ', 'g')) END AS finish_key,
           (m.variant_of IS NOT NULL OR EXISTS (SELECT 1 FROM models v WHERE v.variant_of = m.id)) AS in_group
      FROM models m
      JOIN models mm ON mm.id = coalesce(m.variant_of, m.id)
     WHERE mm.lookbook = 'PUBLIC' AND m.active AND m.slug IS NOT NULL AND m.discontinued_at IS NULL
     ORDER BY m.published_at ASC NULLS LAST, m.id ASC`.execute(db);
  const pieces = new Map<string, TasteOption>();
  const finishes = new Map<string, { labels: string[]; swatches: string[] }>();
  for (const row of r.rows) {
    if (tasteKey(row.type_key) !== null && !pieces.has(row.type_key)) pieces.set(row.type_key, { key: row.type_key, label: row.type_key });
    if (row.in_group && row.finish_key !== null && row.variant_label !== null && row.variant_swatch !== null && tasteKey(row.finish_key) !== null) {
      const f = finishes.get(row.finish_key) ?? { labels: [], swatches: [] };
      f.labels.push(row.variant_label);
      f.swatches.push(row.variant_swatch);
      finishes.set(row.finish_key, f);
    }
  }
  return {
    pieces: [...pieces.values()].sort(byKey),
    finishes: [...finishes].map(([key, f]) => ({ key, label: majority(f.labels), swatch: majority(f.swatches) })).sort(byKey),
  };
}

/** The choices of a kind, by their key as `tasteKey` reads it (what a collector sends is matched through it). */
function choicesOf(options: TasteOptions, kind: TasteKind): Map<string, TasteOption & { swatch?: string }> {
  const list: (TasteOption & { swatch?: string })[] = kind === 'PIECE' ? options.pieces : options.finishes;
  return new Map(list.map((o) => [tasteKey(o.key) ?? o.key, o]));
}

/** The keys sent for a kind, each through `tasteKey`, once each (400 TASTE_UNKNOWN for words that are no key). */
function keysOf(v: unknown): string[] {
  if (!Array.isArray(v)) throw tasteUnknown();
  const keys = new Set<string>();
  for (const w of v) {
    const k = tasteKey(w);
    if (k === null) throw tasteUnknown();
    keys.add(k);
  }
  return [...keys];
}

// ── Service ────────────────────────────────────────────────────────────────

export interface TasteServiceDeps {
  db: Db;
  clock?: Clock;
}

export class TasteService {
  private readonly db: Db;
  private readonly clock: Clock;

  constructor(deps: TasteServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock ?? systemClock;
  }

  /** What the catalogue offers now: its types and its variants' finishes (see the header). */
  options(db: Db = this.db): Promise<TasteOptions> {
    return tasteOptions(db);
  }

  /** An account's tastes, each current one in the catalogue's words, the retired ones after them in their own. */
  async read(db: Db, accountId: string, options?: TasteOptions): Promise<AccountTastes> {
    const offered = options ?? (await tasteOptions(db));
    const rows = await db.selectFrom('account_tastes').select(['kind', 'value_key', 'label']).where('account_id', '=', accountId).orderBy('value_key').execute();
    const out: AccountTastes = { pieces: [], finishes: [] };
    for (const kind of ['PIECE', 'FINISH'] as const) {
      const choices = choicesOf(offered, kind);
      const current: Taste[] = [];
      const retired: Taste[] = [];
      for (const row of rows.filter((x) => x.kind === kind)) {
        const o = choices.get(tasteKey(row.value_key) ?? row.value_key);
        if (o) current.push({ key: row.value_key, label: o.label, ...(o.swatch !== undefined ? { swatch: o.swatch } : {}), retired: false });
        else retired.push({ key: row.value_key, label: row.label, retired: true });
      }
      out[kind === 'PIECE' ? 'pieces' : 'finishes'] = [...current.sort(byKey), ...retired.sort(byKey)];
    }
    return out;
  }

  /**
   * Save the account's tastes whole, in the caller's transaction (which holds the account FOR NO KEY UPDATE): see the
   * header. Nothing changed, nothing written (`added` and `removed` 0).
   */
  async write(tx: Db, accountId: string, input: unknown, options?: TasteOptions): Promise<TasteCounts> {
    if (typeof input !== 'object' || input === null) throw tasteUnknown();
    const x = input as Partial<Record<keyof TastesInput, unknown>>;
    const wanted = { PIECE: keysOf(x.pieces), FINISH: keysOf(x.finishes) };
    if (wanted.PIECE.length > TASTES_MAX || wanted.FINISH.length > TASTES_MAX) throw tastesTooMany();
    const offered = options ?? (await tasteOptions(tx));
    const held = await tx.selectFrom('account_tastes').select(['kind', 'value_key']).where('account_id', '=', accountId).forUpdate().execute();
    const now = this.clock();
    const inserts: { account_id: string; kind: TasteKind; value_key: string; label: string; created_at: Date }[] = [];
    const removals: { kind: TasteKind; value_key: string }[] = [];
    for (const kind of ['PIECE', 'FINISH'] as const) {
      const mine = new Map(held.filter((h) => h.kind === kind).map((h) => [tasteKey(h.value_key) ?? h.value_key, h.value_key]));
      const choices = choicesOf(offered, kind);
      const keep = new Set<string>();
      for (const k of wanted[kind]) {
        if (mine.has(k)) keep.add(k);
        else {
          const o = choices.get(k);
          if (!o) throw tasteUnknown();
          inserts.push({ account_id: accountId, kind, value_key: o.key, label: o.label, created_at: now });
        }
      }
      for (const [k, stored] of mine) if (!keep.has(k)) removals.push({ kind, value_key: stored });
    }
    for (const r of removals) await tx.deleteFrom('account_tastes').where('account_id', '=', accountId).where('kind', '=', r.kind).where('value_key', '=', r.value_key).execute();
    if (inserts.length > 0) await tx.insertInto('account_tastes').values(inserts).onConflict((oc) => oc.doNothing()).execute();
    return { pieces: wanted.PIECE.length, finishes: wanted.FINISH.length, added: inserts.length, removed: removals.length };
  }
}
