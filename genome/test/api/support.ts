/**
 * API test harness: an in-memory database, a full AppContext on a manual
 * clock, the Fastify app (driven with app.inject) and a small browser-like
 * client that keeps cookies and sends Origin / x-csrf-token like the web apps.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp, type BuildAppOptions } from '../../src/server/app.js';
import { testConfig, type ConfigOverrides } from '../../src/server/config.js';
import { createContext, type AppContext, type ContextOverrides } from '../../src/server/context.js';
import type { AdminRole } from '../../src/server/db/schema.js';
import { MemoryKeyProvider } from '../../src/server/keys/memory-provider.js';
import type { IssueProductInput, IssueResult } from '../../src/server/services/issuance.js';
import { createManualClock, SYSTEM_ACTOR, type ManualClock } from '../../src/server/types.js';
import { createTestDb, type TestDb } from '../support/db.js';

export const ORIGIN = 'https://verify.orbes.test';
export const PASSWORD = 'correct horse battery staple';

export interface Harness {
  app: FastifyInstance;
  ctx: AppContext;
  clock: ManualClock;
  t: TestDb;
  client(opts?: ClientOptions): Client;
  close(): Promise<void>;
}

export interface HarnessOptions {
  config?: ConfigOverrides;
  app?: BuildAppOptions;
  context?: ContextOverrides;
}

export async function createHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const t = await createTestDb();
  const clock = createManualClock(Date.now());
  const config = testConfig({ publicOrigin: ORIGIN, ...opts.config });
  const ctx = await createContext(config, {
    db: t.db,
    clock: clock.now,
    // The memory provider refuses to run in production; tests that use a production config still need keys.
    keyProvider: new MemoryKeyProvider({ env: 'test' }),
    ensureActiveKey: true,
    ...opts.context,
  });
  const app = await buildApp(ctx, { serveStatic: false, ...opts.app });
  return {
    app,
    ctx,
    clock,
    t,
    client: (o) => new Client(app, o),
    async close() {
      await app.close();
      await ctx.close();
      await t.close();
    },
  };
}

// ── Browser-like client ────────────────────────────────────────────────────

export interface ClientOptions {
  /** Origin header for unsafe methods (default ORIGIN; null = send none). */
  origin?: string | null;
  /** Remote address seen by the server (rate limiting / ip hash). */
  ip?: string;
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /** Skip the automatic x-csrf-token header. */
  noCsrf?: boolean;
  /** Override (or with null, drop) the Origin header for this request. */
  origin?: string | null;
}

export class Client {
  readonly cookies = new Map<string, string>();
  csrf: string | undefined;
  private readonly origin: string | null;
  private readonly ip: string;

  constructor(
    private readonly app: FastifyInstance,
    opts: ClientOptions = {},
  ) {
    this.origin = opts.origin === undefined ? ORIGIN : opts.origin;
    this.ip = opts.ip ?? '203.0.113.10';
  }

  async request(method: string, url: string, opts: RequestOptions = {}): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
    const unsafe = !['GET', 'HEAD'].includes(method.toUpperCase());
    const origin = opts.origin === undefined ? this.origin : opts.origin;
    if (unsafe && origin) headers.origin = origin;
    if (unsafe && this.csrf && !opts.noCsrf) headers['x-csrf-token'] = this.csrf;
    if (this.cookies.size > 0) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    Object.assign(headers, opts.headers);
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      headers,
      remoteAddress: this.ip,
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
    });
    for (const c of res.cookies as { name: string; value: string; expires?: Date; maxAge?: number }[]) {
      const expired = c.value === '' || (c.maxAge !== undefined && c.maxAge <= 0) || (c.expires !== undefined && c.expires.getTime() <= 0);
      if (expired) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    const json = safeJson(res);
    if (json && typeof json === 'object' && typeof (json as { csrfToken?: unknown }).csrfToken === 'string') {
      this.csrf = (json as { csrfToken: string }).csrfToken;
    }
    return res;
  }

  get(url: string, opts?: RequestOptions) {
    return this.request('GET', url, opts);
  }
  post(url: string, body?: unknown, opts: RequestOptions = {}) {
    return this.request('POST', url, { ...opts, ...(body !== undefined ? { body } : {}) });
  }
  patch(url: string, body?: unknown, opts: RequestOptions = {}) {
    return this.request('PATCH', url, { ...opts, ...(body !== undefined ? { body } : {}) });
  }
}

export function safeJson(res: LightMyRequestResponse): unknown {
  try {
    return JSON.parse(res.body);
  } catch {
    return undefined;
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────────

export interface Catalog {
  categoryCode: string;
  modelId: string;
  collectionId: string;
}

/** Category J (Jewelry), collection ORBIT and model MONOLITHE / RING. */
export async function seedCatalog(ctx: AppContext): Promise<Catalog> {
  const existing = await ctx.categories.getByCode('J');
  if (!existing) await ctx.categories.create({ code: 'J', name: 'Jewelry', warrantyMonths: 24 }, SYSTEM_ACTOR);
  const collection = await ctx.db.insertInto('collections').values({ name: `ORBIT-${randomUUID().slice(0, 8)}` }).returning('id').executeTakeFirstOrThrow();
  const model = await ctx.db
    .insertInto('models')
    .values({
      category_id: (await ctx.categories.getByCode('J'))!.index,
      collection_id: collection.id,
      name: 'MONOLITHE',
      type: 'RING',
      sku_prefix: `MNL-${randomUUID().slice(0, 6).toUpperCase()}`,
      default_material: '925 STERLING SILVER',
      care_instructions: 'Polish with a soft dry cloth.',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { categoryCode: 'J', modelId: model.id, collectionId: collection.id };
}

export async function issue(ctx: AppContext, catalog: Catalog, extra: Partial<IssueProductInput> = {}): Promise<IssueResult> {
  return ctx.services.issuance.issueProduct(
    { categoryCode: catalog.categoryCode, modelId: catalog.modelId, material: '925 STERLING SILVER', ...extra },
    SYSTEM_ACTOR,
  );
}

export async function createAdmin(ctx: AppContext, role: AdminRole): Promise<{ id: string; email: string; password: string }> {
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@orbes.test`;
  const a = await ctx.services.auth.createAdmin({ email, password: PASSWORD, role }, SYSTEM_ACTOR);
  return { id: a.id, email, password: PASSWORD };
}

/** A logged-in admin client of the given role. */
export async function adminClient(h: Harness, role: AdminRole, clientOpts: ClientOptions = {}): Promise<Client> {
  const creds = await createAdmin(h.ctx, role);
  const c = h.client(clientOpts);
  const res = await c.post('/api/admin/auth/login', { email: creds.email, password: creds.password });
  if (res.statusCode !== 200) throw new Error(`admin login failed: ${res.statusCode} ${res.body}`);
  return c;
}

/** A registered, logged-in customer client. */
export async function accountClient(h: Harness, clientOpts: ClientOptions = {}): Promise<{ client: Client; email: string }> {
  const c = h.client(clientOpts);
  const email = `owner-${randomUUID().slice(0, 8)}@example.com`;
  const res = await c.post('/api/v1/account/register', { email, password: PASSWORD, displayName: 'Owner' });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  return { client: c, email };
}

/** Assert the generic error shape: `{ error: { code, message } }` and nothing else. */
export function errorOf(res: LightMyRequestResponse): { code: string; message: string } {
  const body = safeJson(res) as { error?: { code: string; message: string } } | undefined;
  if (!body?.error) throw new Error(`not an error body: ${res.statusCode} ${res.body}`);
  return body.error;
}
