/**
 * LinkService (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.7.1 and A.15 « links.test.ts », step 4.3;
 * services/links.ts) and the address rules it shares with the console (src/shared/link-code.ts):
 *
 *  - create: the link and its LINK source in one transaction; the suggested address, `-2`, `-3` when taken; every
 *    refusal in its words; the destination checked (a published release, an active model, a page);
 *  - edit, never the address; archive and unarchive (idempotent); nothing changed, nothing audited;
 *  - the address race: two creates of one address at once, one 409 LINK_CODE_TAKEN;
 *  - channels: added last, renamed, moved, a name once whatever its case, removed only while unused;
 *  - resolve: each destination, a renamed model's current slug, an unknown code;
 *  - destinations: the published releases not cancelled, the active models;
 *  - the audit entries and their fields.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, createDb, type Db } from '../../src/server/db/connection.js';
import { migrateToLatest } from '../../src/server/db/migrate.js';
import { AuditService } from '../../src/server/services/audit.js';
import { destinationPath, LinkService } from '../../src/server/services/links.js';
import { freeCode, LINK_CODE_RE, suggestCode } from '../../src/shared/link-code.js';
import type { Actor } from '../../src/server/types.js';
import { createAdmin, createHarness, seedCatalog, type Harness } from '../api/support.js';

describe('the address rules (src/shared/link-code.ts)', () => {
  it('suggests the name in lower case, without accents, every other character a dash, cut to 32', () => {
    expect(suggestCode('Instagram bio')).toBe('instagram-bio');
    expect(suggestCode('Léa — TikTok')).toBe('lea-tiktok');
    expect(suggestCode('  Été 2026 / Story #2  ')).toBe('ete-2026-story-2');
    expect(suggestCode('Ça & Ñandú')).toBe('ca-nandu');
    expect(suggestCode('A very long campaign name for the autumn drop')).toBe('a-very-long-campaign-name-for-th');
    expect(suggestCode('A very long campaign name for t- x')).toBe('a-very-long-campaign-name-for-t');
    expect(suggestCode('—')).toBe('');
    for (const s of ['instagram-bio', 'lea-tiktok', 'a-very-long-campaign-name-for-th']) expect(LINK_CODE_RE.test(s), s).toBe(true);
  });

  it('adds -2, -3… to a taken address, still 32 characters at most', () => {
    const taken = new Set(['instagram-bio', 'instagram-bio-2']);
    expect(freeCode('instagram-bio', (c) => taken.has(c))).toBe('instagram-bio-3');
    expect(freeCode('lea', (c) => taken.has(c))).toBe('lea');
    const long = 'a'.repeat(31) + 'b';
    expect(freeCode(long, (c) => c === long)).toBe(`${'a'.repeat(30)}-2`);
    expect(freeCode('abcdefghijklmnopqrstuvwxyz-abcde', (c) => c === 'abcdefghijklmnopqrstuvwxyz-abcde')).toBe('abcdefghijklmnopqrstuvwxyz-abc-2');
  });
});

describe('LinkService (§3.4 A.7.1, step 4.3)', () => {
  let h: Harness;
  let links: LinkService;
  let actor: Actor;
  let instagram: string;
  let influencers: string;
  let modelId: string;
  let slug: string;
  let published: string;
  let draft: string;
  let cancelled: string;

  const drop = async (opts: { published?: boolean; cancelled?: boolean; title: string; opensAt: string }) =>
    (
      await h.ctx.db
        .insertInto('drops')
        .values({
          model_id: modelId,
          title: opts.title,
          quantity: 8,
          opens_at: new Date(opts.opensAt),
          closes_at: new Date(new Date(opts.opensAt).getTime() + 86_400_000),
          seed_enc: `v1.${'A'.repeat(16)}.${'B'.repeat(64)}`,
          seed_hash: new Uint8Array(32).fill(7),
          published_at: opts.published ? new Date('2026-10-01T10:00:00Z') : null,
          cancelled_at: opts.cancelled ? new Date('2026-10-02T10:00:00Z') : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  const audits = (action: string) => h.ctx.db.selectFrom('audit_logs').select(['action', 'actor_id', 'target_type', 'target_id', 'details']).where('action', '=', action).orderBy('id').execute();

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set('2026-10-12T09:00:00.000Z');
    links = h.ctx.services.links;
    const admin = await createAdmin(h.ctx, 'OPERATOR');
    actor = { type: 'admin', id: admin.id };
    const channels = await links.channels();
    instagram = channels.find((c) => c.name === 'Instagram')!.id;
    influencers = channels.find((c) => c.name === 'Influencers')!.id;
    const catalog = await seedCatalog(h.ctx);
    modelId = catalog.modelId;
    slug = `monolithe-${randomUUID().slice(0, 6)}`;
    await h.ctx.db.updateTable('models').set({ slug, lookbook: 'PUBLIC', published_at: new Date('2026-01-01T00:00:00Z') }).where('id', '=', modelId).execute();
    published = await drop({ published: true, title: 'MONOLITHE — LIVE', opensAt: '2026-10-14T18:00:00Z' });
    draft = await drop({ title: 'DRAFT', opensAt: '2026-11-01T18:00:00Z' });
    cancelled = await drop({ published: true, cancelled: true, title: 'CANCELLED', opensAt: '2026-10-20T18:00:00Z' });
  });
  afterAll(() => h?.close());

  it('makes a link and its LINK source in one transaction, its address suggested from its name, and audits it', async () => {
    const link = await links.create({ name: ' Instagram bio ', channelId: instagram, destination: 'NOW' }, actor);
    expect(link).toMatchObject({
      code: 'instagram-bio',
      name: 'Instagram bio',
      channel: { id: instagram, name: 'Instagram' },
      destination: 'NOW',
      dropId: null,
      modelId: null,
      cost: null,
      note: null,
      address: 'https://verify.orbes.test/go/instagram-bio',
      directAddress: 'https://verify.orbes.test/verify?o=instagram-bio',
      archivedAt: null,
      createdBy: { id: actor.id },
    });
    expect(await h.ctx.db.selectFrom('acquisition_sources').select(['kind', 'key', 'link_id']).where('link_id', '=', link.id).execute()).toEqual([{ kind: 'LINK', key: `L:${link.id}`, link_id: link.id }]);
    const [entry] = await audits('link.create');
    expect(entry).toMatchObject({ actor_id: actor.id, target_type: 'link', target_id: link.id });
    expect(entry!.details).toEqual({ linkId: link.id, code: 'instagram-bio', name: 'Instagram bio', channelId: instagram, destination: 'NOW', dropId: null, modelId: null, cost: null });
    // The same name again: -2, then -3.
    expect((await links.create({ name: 'Instagram bio', channelId: instagram, destination: 'NOW' }, actor)).code).toBe('instagram-bio-2');
    expect((await links.create({ name: 'Instagram  BIO', channelId: instagram, destination: 'NOW' }, actor)).code).toBe('instagram-bio-3');
  });

  it('goes to a published release, an active model or a page, with a cost and a note', async () => {
    const release = await links.create({ name: 'Léa — TikTok', channelId: influencers, destination: 'RELEASE', dropId: published, cost: { minor: 200_000, currency: 'EUR' }, note: 'Two stories.' }, actor);
    expect(release).toMatchObject({ code: 'lea-tiktok', destination: 'RELEASE', dropId: published, cost: { minor: 200_000, currency: 'EUR' }, note: 'Two stories.', directAddress: `https://verify.orbes.test/verify/releases/${published}?o=lea-tiktok` });
    const model = await links.create({ name: 'Press kit', channelId: instagram, destination: 'MODEL', modelId, code: 'press-kit' }, actor);
    expect(model).toMatchObject({ code: 'press-kit', modelId, directAddress: `https://verify.orbes.test/verify/lookbook/${slug}?o=press-kit` });
    for (const [destination, path] of [
      ['RELEASES', '/verify/releases'],
      ['COLLECTION', '/verify/lookbook'],
      ['CLUB', '/verify/club'],
      ['HOW', '/verify/releases/how'],
    ] as const) {
      const l = await links.create({ name: `Page ${destination}`, channelId: instagram, destination }, actor);
      expect(l.directAddress).toBe(`https://verify.orbes.test${path}?o=${l.code}`);
    }
  });

  it('refuses in its words: no name, a bad address, nowhere or a release not published, a cost without cents or currency, an unknown channel', async () => {
    const refuse = async (input: Parameters<LinkService['create']>[0], status: number, message: string) => {
      await expect(links.create(input, actor)).rejects.toMatchObject({ httpStatus: status, publicMessage: message });
    };
    const ok = { name: 'Refused', channelId: instagram, destination: 'NOW' };
    await refuse({ ...ok, name: '   ' }, 400, 'Give the link a name.');
    await refuse({ ...ok, name: 7 }, 400, 'Give the link a name.');
    await refuse({ ...ok, name: 'n'.repeat(81) }, 400, 'A link’s name is 80 characters at most.');
    for (const code of ['ab', 'Abc', '-abc', 'abc-', 'a_bc', 'a'.repeat(33), 'café']) await refuse({ ...ok, code }, 400, 'The address is 3 to 32 letters, figures or dashes, in lower case.');
    await refuse({ ...ok, name: '—' }, 400, 'The address is 3 to 32 letters, figures or dashes, in lower case.');
    for (const bad of [
      { destination: 'SALON' },
      { destination: undefined },
      { destination: 'RELEASE' },
      { destination: 'RELEASE', dropId: draft },
      { destination: 'RELEASE', dropId: randomUUID() },
      { destination: 'RELEASE', dropId: published, modelId },
      { destination: 'MODEL' },
      { destination: 'MODEL', modelId: randomUUID() },
      { destination: 'NOW', dropId: published },
    ]) {
      await refuse({ ...ok, ...bad }, 400, 'Choose where the link goes.');
    }
    for (const cost of [{ minor: 12.5, currency: 'EUR' }, { minor: -1, currency: 'EUR' }, { minor: 100, currency: 'JPY' }, { minor: 100 }, { minor: 100_000_000_001, currency: 'EUR' }, 'a lot']) {
      await refuse({ ...ok, cost }, 400, 'The cost is an amount with cents, in one currency.');
    }
    await refuse({ ...ok, note: 'n'.repeat(501) }, 400, 'A note is 500 characters at most.');
    await expect(links.create({ ...ok, channelId: randomUUID() }, actor)).rejects.toMatchObject({ code: 'CHANNEL_NOT_FOUND', httpStatus: 404 });
    // An inactive model is nowhere to go.
    const inactive = (await seedCatalog(h.ctx)).modelId;
    await h.ctx.db.updateTable('models').set({ active: false }).where('id', '=', inactive).execute();
    await refuse({ ...ok, destination: 'MODEL', modelId: inactive }, 400, 'Choose where the link goes.');
    // Nothing was made by the refusals.
    expect(await h.ctx.db.selectFrom('links').select('id').where('name', '=', 'Refused').execute()).toEqual([]);
  });

  it('answers 409 LINK_CODE_TAKEN to the second of two links made with one address at once', async () => {
    const results = await Promise.allSettled([
      links.create({ name: 'Race one', channelId: instagram, destination: 'NOW', code: 'race' }, actor),
      links.create({ name: 'Race two', channelId: instagram, destination: 'NOW', code: 'race' }, actor),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: 'LINK_CODE_TAKEN', httpStatus: 409, publicMessage: 'Another link already uses this address.' });
    expect(await h.ctx.db.selectFrom('acquisition_sources').innerJoin('links', 'links.id', 'acquisition_sources.link_id').select('links.code').where('links.code', '=', 'race').execute()).toHaveLength(1);
  });

  it('edits its name, channel, destination, cost and note, never its address; audits the changed fields only', async () => {
    const link = await links.create({ name: 'Story', channelId: instagram, destination: 'NOW', code: 'story-oct' }, actor);
    h.clock.set('2026-10-12T10:00:00.000Z');
    const edited = await links.update(link.id, { name: 'Story — October', channelId: influencers, destination: 'RELEASE', dropId: published, cost: { minor: 50_000, currency: 'GBP' }, note: ' Paid. ' }, actor);
    expect(edited).toMatchObject({ code: 'story-oct', name: 'Story — October', channel: { id: influencers }, destination: 'RELEASE', dropId: published, cost: { minor: 50_000, currency: 'GBP' }, note: 'Paid.' });
    expect(edited.updatedAt).toEqual(new Date('2026-10-12T10:00:00.000Z'));
    const last = (await audits('link.update')).at(-1)!;
    expect(last.details).toEqual({
      linkId: link.id,
      before: { name: 'Story', channelId: instagram, destination: 'NOW', dropId: null, cost: null, note: null },
      after: { name: 'Story — October', channelId: influencers, destination: 'RELEASE', dropId: published, cost: { minor: 50_000, currency: 'GBP' }, note: 'Paid.' },
    });
    // Its cost and note cleared; then nothing changed: nothing audited.
    expect(await links.update(link.id, { cost: null, note: null }, actor)).toMatchObject({ cost: null, note: null });
    const count = (await audits('link.update')).length;
    await links.update(link.id, { name: 'Story — October' }, actor);
    expect(await audits('link.update')).toHaveLength(count);
    // Never its address.
    await expect(links.update(link.id, { code: 'story-nov' }, actor)).rejects.toMatchObject({ httpStatus: 400, publicMessage: 'A link’s address never changes. Make a new link.' });
    await expect(links.update(link.id, { destination: 'RELEASE', dropId: draft }, actor)).rejects.toMatchObject({ publicMessage: 'Choose where the link goes.' });
    // Back to a page: the release is cleared with it.
    expect(await links.update(link.id, { destination: 'CLUB' }, actor)).toMatchObject({ destination: 'CLUB', dropId: null });
    await expect(links.update(randomUUID(), { name: 'x' }, actor)).rejects.toMatchObject({ code: 'LINK_NOT_FOUND', httpStatus: 404 });
    await expect(links.update('not-a-uuid', { name: 'x' }, actor)).rejects.toMatchObject({ code: 'LINK_NOT_FOUND' });
  });

  it('archives and unarchives, each once, and an archived link still resolves', async () => {
    const link = await links.create({ name: 'Old drop', channelId: instagram, destination: 'RELEASES' }, actor);
    const archived = await links.archive(link.id, actor);
    expect(archived.archivedAt).toEqual(expect.any(Date));
    await links.archive(link.id, actor);
    expect((await audits('link.archive')).filter((a) => a.target_id === link.id).map((a) => a.details)).toEqual([{ linkId: link.id, code: 'old-drop' }]);
    expect((await links.list()).some((l) => l.id === link.id)).toBe(false);
    expect((await links.list({ archived: true })).some((l) => l.id === link.id)).toBe(true);
    expect(await links.resolve('old-drop')).toBe('/verify/releases');
    expect((await links.unarchive(link.id, actor)).archivedAt).toBeNull();
    await links.unarchive(link.id, actor);
    expect((await audits('link.unarchive')).filter((a) => a.target_id === link.id)).toHaveLength(1);
    expect(await h.ctx.db.selectFrom('links').select(['archived_at', 'archived_by']).where('id', '=', link.id).executeTakeFirstOrThrow()).toEqual({ archived_at: null, archived_by: null });
  });

  it('resolves each destination at each request, a model by its current slug, a code in any case; null for an unknown code', async () => {
    expect(await links.resolve('instagram-bio')).toBe('/verify');
    expect(await links.resolve('INSTAGRAM-BIO')).toBe('/verify');
    expect(await links.resolve('lea-tiktok')).toBe(`/verify/releases/${published}`);
    expect(await links.resolve('press-kit')).toBe(`/verify/lookbook/${slug}`);
    const renamed = `${slug}-ii`;
    await h.ctx.db.updateTable('models').set({ slug: renamed }).where('id', '=', modelId).execute();
    expect(await links.resolve('press-kit')).toBe(`/verify/lookbook/${renamed}`);
    expect(await links.resolve('no-such-link')).toBeNull();
    expect(await links.resolve('<script>')).toBeNull();
    expect(destinationPath('MODEL', null, null)).toBe('/verify/lookbook');
  });

  it('offers the published releases not cancelled, and the active models', async () => {
    const d = await links.destinations();
    expect(d.releases.map((r) => r.id)).toContain(published);
    expect(d.releases.map((r) => r.id)).not.toContain(draft);
    expect(d.releases.map((r) => r.id)).not.toContain(cancelled);
    expect(d.releases.find((r) => r.id === published)).toEqual({ id: published, title: 'MONOLITHE — LIVE', mode: 'DRAW', opensAt: new Date('2026-10-14T18:00:00Z'), model: 'MONOLITHE' });
    expect(d.models.find((m) => m.id === modelId)).toMatchObject({ name: 'MONOLITHE', variantLabel: null, variantOf: null });
    expect(d.models.every((m) => typeof m.id === 'string')).toBe(true);
  });

  it('channels: added last, renamed, moved, a name once whatever its case, removed only while no link names it, each audited', async () => {
    const before = await links.channels();
    expect(before.find((c) => c.id === instagram)!.links).toBeGreaterThan(0);
    const made = await links.createChannel({ name: ' Newsletters ' }, actor);
    expect(made).toEqual({ id: expect.any(String), name: 'Newsletters', position: 80, links: 0 });
    expect((await links.channels()).at(-1)!.id).toBe(made.id);
    await expect(links.createChannel({ name: 'INSTAGRAM' }, actor)).rejects.toMatchObject({ code: 'CHANNEL_NAME_TAKEN', httpStatus: 409, publicMessage: 'Another channel has this name.' });
    await expect(links.createChannel({ name: '' }, actor)).rejects.toMatchObject({ httpStatus: 400, publicMessage: 'Give the channel a name.' });
    await expect(links.createChannel({ name: 'n'.repeat(41) }, actor)).rejects.toMatchObject({ httpStatus: 400 });
    await expect(links.createChannel({ name: 'Too far', position: 1000 }, actor)).rejects.toMatchObject({ httpStatus: 400 });
    expect(await links.updateChannel(made.id, { name: 'Letters', position: 5 }, actor)).toMatchObject({ name: 'Letters', position: 5 });
    expect((await links.channels())[0]!.id).toBe(made.id);
    await expect(links.updateChannel(made.id, { name: 'tiktok' }, actor)).rejects.toMatchObject({ code: 'CHANNEL_NAME_TAKEN' });
    const updates = (await audits('link_channel.update')).length;
    await links.updateChannel(made.id, { name: 'Letters' }, actor);
    expect(await audits('link_channel.update')).toHaveLength(updates);
    // Removed while unused; refused while a link names it, archived included.
    const press = (await links.channels()).find((c) => c.name === 'Press')!;
    const archived = await links.create({ name: 'Press archived', channelId: press.id, destination: 'NOW' }, actor);
    await links.archive(archived.id, actor);
    await expect(links.deleteChannel(press.id, actor)).rejects.toMatchObject({ code: 'CHANNEL_IN_USE', httpStatus: 409, publicMessage: 'Links use this channel: move them to another first.' });
    await links.deleteChannel(made.id, actor);
    expect((await links.channels()).some((c) => c.id === made.id)).toBe(false);
    await expect(links.deleteChannel(made.id, actor)).rejects.toMatchObject({ code: 'CHANNEL_NOT_FOUND', httpStatus: 404 });
    expect((await audits('link_channel.create')).at(-1)!.details).toEqual({ channelId: made.id, name: 'Newsletters', position: 80 });
    expect((await audits('link_channel.update')).at(-1)!.details).toEqual({ channelId: made.id, before: { name: 'Newsletters', position: 80 }, after: { name: 'Letters', position: 5 } });
    expect((await audits('link_channel.delete')).at(-1)!.details).toEqual({ channelId: made.id, name: 'Letters' });
  });
});

// ── PostgreSQL: the address race for real (§3.4 A.11 « Two staff make the same address at once ») ──────────────────
// PGlite above runs on one connection, so its « at once » is in turn; here a pool of 8 lets the two transactions race
// for the unique index. Runs in genome-ci with ORBES_TEST_POSTGRES_URL; skipped without it.
const adminUrl = process.env.ORBES_TEST_POSTGRES_URL;

describe.skipIf(!adminUrl)('LinkService on PostgreSQL', () => {
  let admin: Db;
  let db: Db;
  const name = `orbes_links_${randomBytes(6).toString('hex')}`;
  beforeAll(async () => {
    admin = createDb(adminUrl!);
    await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
    const u = new URL(adminUrl!);
    u.pathname = `/${name}`;
    db = createDb(u.toString(), { poolMax: 8 });
    await migrateToLatest(db);
  }, 120_000);
  afterAll(async () => {
    if (db) await closeDb(db);
    if (admin) {
      await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(admin);
      await closeDb(admin);
    }
  });

  it('makes one link of six made at once with one address; the others get 409 LINK_CODE_TAKEN', async () => {
    const operator = (await db.insertInto('admin_users').values({ email: 'race@orbes.test', email_normalized: 'race@orbes.test', password_hash: 'scrypt$x', role: 'OPERATOR' }).returning('id').executeTakeFirstOrThrow()).id;
    const channel = (await db.insertInto('link_channels').values({ name: 'Instagram', position: 10 }).returning('id').executeTakeFirstOrThrow()).id;
    const services = Array.from({ length: 6 }, () => new LinkService({ db, audit: new AuditService({ db }), publicOrigin: 'https://verify.theorbes.com' }));
    const results = await Promise.allSettled(services.map((s, i) => s.create({ name: `Race ${i}`, channelId: channel, destination: 'NOW', code: 'race' }, { type: 'admin', id: operator })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) expect(r.reason).toMatchObject({ code: 'LINK_CODE_TAKEN' });
    expect(await db.selectFrom('links').select('code').execute()).toEqual([{ code: 'race' }]);
    expect(await db.selectFrom('acquisition_sources').select('kind').where('kind', '=', 'LINK').execute()).toHaveLength(1);
  });
});
