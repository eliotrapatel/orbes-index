/**
 * Standard boxes and packed weights (macro scope of 2026-10-20, D16 B1 and B2; lot M3 plan §1.1 and §1.2, step M3.2;
 * migration 0054): the owner lists his real boxes in Orders → Settings, each model (or variant) is given its box and its
 * packed weight on its page, and a parcel's box and weight are read while it is packed and written when it is PACKED
 * (services/parcels.ts, services/logistics.ts).
 *
 *   a box        its name (1 to 60 characters, one line, unique whatever the case: 409 BOX_NAME_TAKEN), its inside
 *                length, width and height (whole millimetres, 1 to 2 000), its empty weight (whole grams, 1 to 30 000)
 *                and its cost (whole minor units, 0 to 100 000 000, with a currency of two decimals: both or neither).
 *                Its inside length and width take the certificate card 79t flat, 95 × 62 mm, in either orientation
 *                (422 BOX_TOO_SMALL_FOR_CARD; CERTIFICATE_CARD_MM, held equal to render/certificate.ts by a test).
 *   the list     active boxes first, then those set aside, each by name, with how many models name it as their own.
 *   changes      ADMIN, as the other Orders → Settings writes: added (`create`), any of its six fields changed
 *                (`update`; a parcel packed in it keeps it), set aside (`setAside`: never offered for a model nor a
 *                parcel again; 409 BOX_IN_USE while an active model packs in it, its own or, for a variant without
 *                one, its main model's: give them another box first) and offered again (`reinstate`). A change that
 *                changes nothing writes nothing. Audited `box.create`, `box.update`, `box.set_aside`, `box.reinstate`
 *                with ids, fields and figures, never anything personal.
 *   a model      `modelPackings`: each model's box and packed weight as packing reads them, its own, else for a
 *                variant its main model's (the house's pattern for `size_kind` and `supplier_id`). CatalogService sets
 *                them (`setModelPacking`, OPERATOR, audited `model.packing`).
 *
 * Nothing here is read by a collector: a box, a weight and a cost are the house's side. The agent (LOGISTICS) reads a
 * parcel's box by its name and inside sides only, never its cost.
 */
import { sql } from 'kysely';
import { inTransaction, type Db } from '../db/connection.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import { BOX_COST_MINOR_MAX, BOX_EMPTY_WEIGHT_G_MAX, BOX_INSIDE_MM_MAX, BOX_NAME_MAX, CERTIFICATE_CARD_MM, type JsonObject } from '../db/schema.js';
import { conflict, DomainError, forbidden, notFound, validationError } from '../errors.js';
import { systemClock, type Actor, type Clock } from '../types.js';
import type { AuditService } from './audit.js';
import { cleanCurrency } from './suppliers.js';

// ── Rules ──────────────────────────────────────────────────────────────────

export { CERTIFICATE_CARD_MM };
export const BOX_LIMITS = Object.freeze({ name: BOX_NAME_MAX, insideMm: BOX_INSIDE_MM_MAX, emptyWeightG: BOX_EMPTY_WEIGHT_G_MAX, costMinor: BOX_COST_MINOR_MAX });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Whether inside sides take the certificate card flat, in either orientation (`boxes_card_fits`, migration 0054). */
export function cardFits(lengthMm: number, widthMm: number): boolean {
  return Math.max(lengthMm, widthMm) >= CERTIFICATE_CARD_MM.long && Math.min(lengthMm, widthMm) >= CERTIFICATE_CARD_MM.short;
}

/** A box's inside volume in mm³: how « the largest of the pieces' boxes » is chosen. */
export const insideVolume = (b: Pick<BoxRef, 'insideLengthMm' | 'insideWidthMm' | 'insideHeightMm'>): number => b.insideLengthMm * b.insideWidthMm * b.insideHeightMm;

// ── Errors ─────────────────────────────────────────────────────────────────

export const boxNotFound = () => notFound('Box', 'BOX_NOT_FOUND');
const boxNameTaken = () => conflict('BOX_NAME_TAKEN', 'Another box has this name.');
export const boxTooSmall = () =>
  new DomainError('BOX_TOO_SMALL_FOR_CARD', 422, `This box cannot take the ${CERTIFICATE_CARD_MM.long} × ${CERTIFICATE_CARD_MM.short} mm certificate card flat.`);
const boxInUse = (models: number) =>
  conflict('BOX_IN_USE', `${models === 1 ? '1 active model packs' : `${models} active models pack`} in this box: give ${models === 1 ? 'it' : 'them'} another box first.`);
/** 409 BOX_SET_ASIDE: a box set aside is offered for no model nor parcel. */
export const boxSetAside = () => conflict('BOX_SET_ASIDE', 'This box is set aside: reinstate it in Orders → Settings, or choose another.');

// ── Views ──────────────────────────────────────────────────────────────────

/** A box as packing names it: never its cost (the agent reads it). */
export interface BoxRef {
  id: string;
  name: string;
  insideLengthMm: number;
  insideWidthMm: number;
  insideHeightMm: number;
  emptyWeightG: number;
  active: boolean;
}

/** A box as Orders → Settings reads it (AUDITOR and above). */
export interface BoxView extends BoxRef {
  /** Its cost in minor units and its currency, both or neither. */
  costMinor: number | null;
  currency: string | null;
  /** How many models name it as their own box (a variant counts as its own model; one reading its main model's does not). */
  models: number;
  createdAt: Date;
  updatedAt: Date;
}

/** What a box is created or changed with; `undefined` leaves a field as it is. The cost and its currency go together. */
export interface BoxInput {
  name?: string;
  insideLengthMm?: number;
  insideWidthMm?: number;
  insideHeightMm?: number;
  emptyWeightG?: number;
  costMinor?: number | null;
  currency?: string | null;
}

type BoxColumns = {
  name?: string;
  inside_length_mm?: number;
  inside_width_mm?: number;
  inside_height_mm?: number;
  empty_weight_g?: number;
  cost_minor?: number | null;
  currency?: string | null;
};

/** The fields of a box and their columns, in the order an audit entry lists them. */
const FIELDS = [
  ['name', 'name'],
  ['insideLengthMm', 'inside_length_mm'],
  ['insideWidthMm', 'inside_width_mm'],
  ['insideHeightMm', 'inside_height_mm'],
  ['emptyWeightG', 'empty_weight_g'],
  ['costMinor', 'cost_minor'],
  ['currency', 'currency'],
] as const;

const BOX_REF_COLUMNS = ['id', 'name', 'inside_length_mm', 'inside_width_mm', 'inside_height_mm', 'empty_weight_g', 'active'] as const;

type BoxRefRow = { id: string; name: string; inside_length_mm: number; inside_width_mm: number; inside_height_mm: number; empty_weight_g: number; active: boolean };

export const boxRef = (r: BoxRefRow): BoxRef => ({
  id: r.id,
  name: r.name,
  insideLengthMm: r.inside_length_mm,
  insideWidthMm: r.inside_width_mm,
  insideHeightMm: r.inside_height_mm,
  emptyWeightG: r.empty_weight_g,
  active: r.active,
});

/** The boxes named, by id (any state: a model or a parcel may still name one set aside). */
export async function boxRefs(db: Db, ids: Iterable<string | null | undefined>): Promise<Map<string, BoxRef>> {
  const wanted = [...new Set([...ids].filter((x): x is string => typeof x === 'string'))];
  if (wanted.length === 0) return new Map();
  const rows = await db.selectFrom('boxes').select([...BOX_REF_COLUMNS]).where('id', 'in', wanted).execute();
  return new Map(rows.map((r) => [r.id, boxRef(r)]));
}

/** The active boxes, by name: what CHANGE BOX and a model's BOX offer. */
export async function activeBoxes(db: Db): Promise<BoxRef[]> {
  const rows = await db.selectFrom('boxes').select([...BOX_REF_COLUMNS]).where('active', '=', true).orderBy(sql`lower(name)`).orderBy('id').execute();
  return rows.map(boxRef);
}

/** A model's box and packed weight as packing reads them: its own, else (a variant) its main model's. */
export interface ModelPackingRow {
  modelId: string;
  /** The model's words on a parcel: MONOLITHE · Steel. */
  words: string;
  /** Its own box and weight (null: none). */
  ownBoxId: string | null;
  ownPackedWeightG: number | null;
  /** What packing uses: its own, else its main model's. */
  boxId: string | null;
  packedWeightG: number | null;
  /** A variant: its main model (id and name); null for a model alone or a main model. */
  main: { id: string; name: string } | null;
}

/** Each model's packing (see ModelPackingRow), by model id; a model unknown is absent. */
export async function modelPackings(db: Db, modelIds: Iterable<string>): Promise<Map<string, ModelPackingRow>> {
  const ids = [...new Set(modelIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom('models as m')
    .leftJoin('models as main', 'main.id', 'm.variant_of')
    .select(['m.id', 'm.name', 'm.variant_label', 'm.box_id', 'm.packed_weight_g', 'main.id as main_id', 'main.name as main_name', 'main.box_id as main_box_id', 'main.packed_weight_g as main_weight'])
    .where('m.id', 'in', ids)
    .execute();
  return new Map(
    rows.map((r) => [
      r.id,
      {
        modelId: r.id,
        words: [r.name, r.variant_label].filter((x): x is string => typeof x === 'string' && x !== '').join(' · '),
        ownBoxId: r.box_id,
        ownPackedWeightG: r.packed_weight_g,
        boxId: r.box_id ?? r.main_box_id ?? null,
        packedWeightG: r.packed_weight_g ?? r.main_weight ?? null,
        main: r.main_id ? { id: r.main_id, name: r.main_name! } : null,
      },
    ]),
  );
}

/** The active models that pack in a box: their own, or a variant without one reading its main model's. */
async function activeModelsIn(db: Db, boxId: string): Promise<number> {
  const r = await sql<{ n: number | string }>`
    SELECT count(*) AS n FROM models m LEFT JOIN models main ON main.id = m.variant_of
     WHERE m.active AND coalesce(m.box_id, main.box_id) = ${boxId}`.execute(db);
  return Number(r.rows[0]?.n ?? 0);
}

// ── Checking ───────────────────────────────────────────────────────────────

/** A box's name as the console types it: trimmed, one line, runs of spaces kept to one, 1 to BOX_NAME_MAX characters. */
function cleanBoxName(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '') throw validationError('The name is required.');
  const s = v.trim().replace(/\s+/g, ' ');
  if (CONTROL_CHARS.test(s)) throw validationError('The name contains invalid characters.');
  if ([...s].length > BOX_NAME_MAX) throw validationError(`The name must be at most ${BOX_NAME_MAX} characters.`);
  return s;
}

/** A whole number between `min` and `max`. */
function whole(v: unknown, min: number, max: number, label: string, unit: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw validationError(`${label} is a whole number of ${unit}, ${min} to ${max.toLocaleString('en-US')}.`);
  return v;
}

/** The columns a box input sets, checked; only the fields given (every one when creating). */
function columnsOf(input: BoxInput, creating: boolean): BoxColumns {
  const out: BoxColumns = {};
  if (creating || input.name !== undefined) out.name = cleanBoxName(input.name);
  if (creating || input.insideLengthMm !== undefined) out.inside_length_mm = whole(input.insideLengthMm, 1, BOX_INSIDE_MM_MAX, 'The inside length', 'millimetres');
  if (creating || input.insideWidthMm !== undefined) out.inside_width_mm = whole(input.insideWidthMm, 1, BOX_INSIDE_MM_MAX, 'The inside width', 'millimetres');
  if (creating || input.insideHeightMm !== undefined) out.inside_height_mm = whole(input.insideHeightMm, 1, BOX_INSIDE_MM_MAX, 'The inside height', 'millimetres');
  if (creating || input.emptyWeightG !== undefined) out.empty_weight_g = whole(input.emptyWeightG, 1, BOX_EMPTY_WEIGHT_G_MAX, 'The empty weight', 'grams');
  const costGiven = input.costMinor !== undefined;
  const currencyGiven = input.currency !== undefined;
  if (costGiven !== currencyGiven) throw validationError('A cost is given with its currency, or both are cleared.');
  if (costGiven) {
    const currency = cleanCurrency(input.currency);
    const cost = input.costMinor === null ? null : whole(input.costMinor, 0, BOX_COST_MINOR_MAX, 'The cost', 'cents');
    if ((cost === null) !== (currency === null)) throw validationError('A cost is given with its currency, or both are cleared.');
    out.cost_minor = cost;
    out.currency = currency;
  } else if (creating) {
    out.cost_minor = null;
    out.currency = null;
  }
  return out;
}

function knownBox(v: unknown): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw boxNotFound();
  return v.toLowerCase();
}

function assertStaff(actor: Actor): void {
  if (actor?.type !== 'admin' && actor?.type !== 'system') throw forbidden('Only ORBES staff can change the boxes.');
}

const adminIdOf = (actor: Actor): string | null => (actor?.type === 'admin' && typeof actor.id === 'string' && UUID_RE.test(actor.id) ? actor.id.toLowerCase() : null);

// ── The service ────────────────────────────────────────────────────────────

export interface BoxServiceDeps {
  db: Db;
  audit: AuditService;
  clock?: Clock;
}

export class BoxService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly clock: Clock;

  constructor(deps: BoxServiceDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.clock = deps.clock ?? systemClock;
  }

  /** Every box: the active ones first, then those set aside, each by name (GET /api/admin/boxes, AUDITOR). */
  list(): Promise<BoxView[]> {
    return this.rows();
  }

  /** One box (404 BOX_NOT_FOUND). */
  async get(boxId: string): Promise<BoxView> {
    const row = (await this.rows(knownBox(boxId)))[0];
    if (!row) throw boxNotFound();
    return row;
  }

  /**
   * A box added (POST /api/admin/boxes, ADMIN): its six fields checked, the card rule (422 BOX_TOO_SMALL_FOR_CARD), its
   * name free (409 BOX_NAME_TAKEN). Audited `box.create` with its name, sides, empty weight and cost.
   */
  async create(input: BoxInput, actor: Actor): Promise<BoxView> {
    assertStaff(actor);
    const c = columnsOf(input ?? {}, true);
    if (!cardFits(c.inside_length_mm!, c.inside_width_mm!)) throw boxTooSmall();
    const id = await this.named(() =>
      inTransaction(this.db, async (tx) => {
        const now = this.clock();
        const row = await tx
          .insertInto('boxes')
          .values({
            name: c.name!,
            inside_length_mm: c.inside_length_mm!,
            inside_width_mm: c.inside_width_mm!,
            inside_height_mm: c.inside_height_mm!,
            empty_weight_g: c.empty_weight_g!,
            cost_minor: c.cost_minor ?? null,
            currency: c.currency ?? null,
            created_by: adminIdOf(actor),
            created_at: now,
            updated_at: now,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const details: JsonObject = {
          name: c.name!,
          insideLengthMm: c.inside_length_mm!,
          insideWidthMm: c.inside_width_mm!,
          insideHeightMm: c.inside_height_mm!,
          emptyWeightG: c.empty_weight_g!,
          costMinor: c.cost_minor ?? null,
          currency: c.currency ?? null,
        };
        await this.audit.record({ actor, action: 'box.create', targetType: 'box', targetId: row.id, details }, tx);
        return row.id;
      }),
    );
    return this.get(id);
  }

  /**
   * A box changed (PATCH /api/admin/boxes/:id, ADMIN): the fields given, under its row lock, the card rule read on its
   * sides after the change. A parcel packed in it keeps it (`shipments.box_id`), a model too. Audited `box.update` with
   * each field changed, before and after; nothing changed, nothing written.
   */
  async update(boxId: string, input: BoxInput, actor: Actor): Promise<BoxView> {
    assertStaff(actor);
    const id = knownBox(boxId);
    const c = columnsOf(input ?? {}, false);
    if (Object.keys(c).length === 0) throw validationError('Nothing to change.');
    await this.named(() =>
      inTransaction(this.db, async (tx) => {
        const row = await tx.selectFrom('boxes').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
        if (!row) throw boxNotFound();
        // A bigint may come back as text from PostgreSQL's driver: compared and audited as a number.
        const before = { ...row, cost_minor: row.cost_minor === null ? null : Number(row.cost_minor) };
        const changed = FIELDS.filter(([, column]) => column in c && c[column] !== before[column]);
        if (changed.length === 0) return;
        const length = c.inside_length_mm ?? before.inside_length_mm;
        const width = c.inside_width_mm ?? before.inside_width_mm;
        if (!cardFits(length, width)) throw boxTooSmall();
        await tx
          .updateTable('boxes')
          .set({ ...Object.fromEntries(changed.map(([, column]) => [column, c[column]])), updated_at: this.clock() })
          .where('id', '=', id)
          .execute();
        const details: JsonObject = {};
        for (const [field, column] of changed) details[field] = { from: before[column], to: c[column] ?? null };
        await this.audit.record({ actor, action: 'box.update', targetType: 'box', targetId: id, details }, tx);
      }),
    );
    return this.get(id);
  }

  /**
   * A box set aside (POST /api/admin/boxes/:id/set-aside, ADMIN): offered for no model nor parcel again; 409 BOX_IN_USE
   * while an active model packs in it (its own, or its main model's). Under its row lock, which a model's packing takes
   * too (FOR SHARE), so no model is given it meanwhile. Audited `box.set_aside`; one already set aside: nothing written.
   */
  async setAside(boxId: string, actor: Actor): Promise<BoxView> {
    return this.setActive(boxId, false, actor);
  }

  /** A box offered again (POST /api/admin/boxes/:id/reinstate, ADMIN). Audited `box.reinstate`; one active: nothing written. */
  async reinstate(boxId: string, actor: Actor): Promise<BoxView> {
    return this.setActive(boxId, true, actor);
  }

  private async setActive(boxId: string, active: boolean, actor: Actor): Promise<BoxView> {
    assertStaff(actor);
    const id = knownBox(boxId);
    await inTransaction(this.db, async (tx) => {
      const before = await tx.selectFrom('boxes').select(['active', 'name']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw boxNotFound();
      if (before.active === active) return;
      if (!active) {
        const models = await activeModelsIn(tx, id);
        if (models > 0) throw boxInUse(models);
      }
      await tx.updateTable('boxes').set({ active, updated_at: this.clock() }).where('id', '=', id).execute();
      await this.audit.record({ actor, action: active ? 'box.reinstate' : 'box.set_aside', targetType: 'box', targetId: id, details: { name: before.name } }, tx);
    });
    return this.get(id);
  }

  /** The boxes with how many models name each, active first then by name (`id` narrows to one). */
  private async rows(id?: string): Promise<BoxView[]> {
    let q = this.db
      .selectFrom('boxes as b')
      .selectAll('b')
      .select((eb) => eb.selectFrom('models as m').select((e) => e.fn.countAll<number>().as('n')).whereRef('m.box_id', '=', 'b.id').as('models'));
    if (id !== undefined) q = q.where('b.id', '=', id);
    const rows = await q.orderBy('b.active', 'desc').orderBy(sql`lower(b.name)`).orderBy('b.id').execute();
    return rows.map((r) => ({
      ...boxRef(r),
      costMinor: r.cost_minor === null ? null : Number(r.cost_minor),
      currency: r.currency,
      models: Number(r.models ?? 0),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /** A name in use (the unique index whatever the case) answers 409 BOX_NAME_TAKEN. */
  private async named<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isUniqueViolation(e)) throw boxNameTaken();
      throw e;
    }
  }
}
