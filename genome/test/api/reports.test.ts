/**
 * The Cases queue of the console (C-02, phase 2): customers' reports on
 * scans that were not authentic, read by an AUDITOR with their scan, the
 * anomaly the scan took part in and the piece, and closed by an OPERATOR
 * with a note; the scans and anomalies lists carry them too.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/server/types.js';
import { adminClient, createHarness, errorOf, issue, safeJson, seedCatalog, type Client, type Harness } from './support.js';

interface CaseJson {
  id: string;
  scanId: string;
  channel: string;
  place: string | null;
  note: string | null;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  handledBy: { id: string; email: string } | null;
  handledAt: string | null;
  resolutionNote: string | null;
  scan: { occurredAt: string; state: string; productId: string | null; country: string | null; region: string | null };
  anomaly: { id: string; type: string; severity: string; status: string } | null;
}

describe('Cases: GET /api/admin/reports and PATCH /api/admin/reports/:id', () => {
  let h: Harness;
  let auditor: Client;
  let operator: Client;
  let lostPiece = '';
  const scans = { first: '', second: '', unreadable: '' };

  const verify = async (code: string) => safeJson(await h.client().post('/api/v1/verify', { code })) as { scanId: string; state: string };
  const report = (scanId: string, body: Record<string, unknown>) => h.client().post('/api/v1/reports', { scanId, ...body });
  const cases = async (c: Client, query = '') => {
    const res = await c.get(`/api/admin/reports${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return safeJson(res) as { items: CaseJson[]; total: number; page: number; pageSize: number };
  };

  beforeAll(async () => {
    h = await createHarness();
    const catalog = await seedCatalog(h.ctx);
    auditor = await adminClient(h, 'AUDITOR');
    operator = await adminClient(h, 'OPERATOR');

    // A piece reported lost and then scanned twice, a minute apart: UNUSUAL ACTIVITY, one LOST_STOLEN_SCAN
    // anomaly seen twice. Each scan gets a report. Then an unreadable code, with a report and no anomaly.
    const p = await issue(h.ctx, catalog);
    lostPiece = p.product.productId;
    await h.ctx.services.warranty.activate(lostPiece, { retailer: 'ORBES PARIS', country: 'FR' }, SYSTEM_ACTOR);
    await h.ctx.services.lifecycle.transition(lostPiece, 'LOST', { reason: 'Reported by its owner' }, SYSTEM_ACTOR);
    const first = await verify(p.code.data);
    expect(first.state).toBe('SUSPICIOUS_ACTIVITY');
    scans.first = first.scanId;
    expect((await report(first.scanId, { channel: 'ONLINE', where: 'a marketplace listing', note: 'Offered at a third of the price.' })).statusCode).toBe(201);
    h.clock.advance(60_000);
    scans.second = (await verify(p.code.data)).scanId;
    expect((await report(scans.second, { channel: 'PRIVATE', where: 'Lyon' })).statusCode).toBe(201);
    h.clock.advance(60_000);
    scans.unreadable = (await verify('abc+/=def')).scanId;
    expect((await report(scans.unreadable, { channel: 'BOUTIQUE' })).statusCode).toBe(201);
  });
  afterAll(() => h?.close());

  it('lists each case with its scan, the anomaly the scan took part in and its piece, newest first', async () => {
    const list = await cases(auditor);
    expect(list.total).toBe(3);
    expect(list.items.map((c) => c.scanId)).toEqual([scans.unreadable, scans.second, scans.first]);
    const [unreadable, second, first] = list.items;
    expect(first).toMatchObject({
      channel: 'ONLINE',
      place: 'a marketplace listing',
      note: 'Offered at a third of the price.',
      status: 'OPEN',
      handledBy: null,
      handledAt: null,
      resolutionNote: null,
      scan: { state: 'SUSPICIOUS_ACTIVITY', productId: lostPiece },
    });
    // Both scans of the lost piece took part in the same finding: the second recorded it last, the first
    // was made while it was being seen.
    expect(first.anomaly).toMatchObject({ type: 'LOST_STOLEN_SCAN', status: 'OPEN' });
    expect(second.anomaly?.id).toBe(first.anomaly?.id);
    expect(second).toMatchObject({ channel: 'PRIVATE', place: 'Lyon', note: null });
    // An unreadable code names no piece and took part in no anomaly.
    expect(unreadable).toMatchObject({ channel: 'BOUTIQUE', place: null, scan: { state: 'MALFORMED_CODE', productId: null }, anomaly: null });
    // Internal to the console only: the list is not cached.
    expect((await auditor.get('/api/admin/reports')).headers['cache-control']).toBe('no-store');
  });

  it('filters by status, by scan and by anomaly', async () => {
    expect((await cases(auditor, '?status=OPEN')).total).toBe(3);
    expect((await cases(auditor, '?status=CLOSED')).total).toBe(0);
    expect((await cases(auditor, `?scanId=${scans.second}`)).items.map((c) => c.scanId)).toEqual([scans.second]);
    const anomalyId = (await cases(auditor, `?scanId=${scans.first}`)).items[0].anomaly!.id;
    expect((await cases(auditor, `?anomalyId=${anomalyId}`)).items.map((c) => c.scanId)).toEqual([scans.second, scans.first]);
    expect((await cases(auditor, '?anomalyId=00000000-0000-4000-8000-000000000000')).total).toBe(0);
    for (const q of ['?status=PENDING', '?scanId=nope', '?anomalyId=42']) {
      const res = await auditor.get(`/api/admin/reports${q}`);
      expect(res.statusCode, q).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
  });

  it('shows the report on its scan in the scans list, and the reports of a finding in the anomalies list', async () => {
    const scanList = safeJson(await auditor.get(`/api/admin/scans?productId=${lostPiece}`)) as { items: { id: string; report: { channel: string; place: string | null; status: string } | null }[] };
    expect(scanList.items.map((s) => [s.id, s.report?.channel ?? null, s.report?.place ?? null])).toEqual([
      [scans.second, 'PRIVATE', 'Lyon'],
      [scans.first, 'ONLINE', 'a marketplace listing'],
    ]);
    // One scan, as a case links to it.
    const one = safeJson(await auditor.get(`/api/admin/scans?scanId=${scans.first}`)) as { items: { id: string; report: { note: string; status: string } }[]; total: number };
    expect(one.total).toBe(1);
    expect(one.items[0].report).toMatchObject({ note: 'Offered at a third of the price.', status: 'OPEN' });
    // A scan nobody reported on.
    const unreported = (await verify('xyz+/=uvw')).scanId;
    expect((safeJson(await auditor.get(`/api/admin/scans?scanId=${unreported}`)) as { items: { report: unknown }[] }).items[0].report).toBeNull();

    const anomalyId = (await cases(auditor, `?scanId=${scans.first}`)).items[0].anomaly!.id;
    const anomalies = safeJson(await auditor.get(`/api/admin/anomalies?id=${anomalyId}`)) as {
      items: { id: string; occurrences: number; reports: { count: number; open: number; latest: { channel: string; place: string | null } } | null }[];
      total: number;
    };
    expect(anomalies.total).toBe(1);
    expect(anomalies.items[0]).toMatchObject({ id: anomalyId, occurrences: 2, reports: { count: 2, open: 2, latest: { channel: 'PRIVATE', place: 'Lyon' } } });
    // A finding no customer reported on carries none.
    const all = safeJson(await auditor.get('/api/admin/anomalies')) as { items: { id: string; reports: unknown }[] };
    expect(all.items.filter((a) => a.id !== anomalyId).every((a) => a.reports === null)).toBe(true);
  });

  it('closes a case with a note (OPERATOR), audited scan.report.close without the customer\'s words, once', async () => {
    const [target] = (await cases(operator, `?scanId=${scans.first}`)).items;
    // A note is required, the status can only be CLOSED, and nothing else may be sent.
    for (const body of [{ status: 'CLOSED' }, { status: 'CLOSED', note: '   ' }, { status: 'OPEN', note: 'x' }, { status: 'CLOSED', note: 'x', handledBy: 'me' }]) {
      const res = await operator.patch(`/api/admin/reports/${target.id}`, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
    h.clock.advance(5 * 60_000);
    const res = await operator.patch(`/api/admin/reports/${target.id}`, { status: 'CLOSED', note: 'Listing reported to the platform; the owner was told.' });
    expect(res.statusCode, res.body).toBe(200);
    const closed = safeJson(res) as CaseJson;
    const me = safeJson(await operator.get('/api/admin/auth/me')) as { admin: { id: string; email: string } };
    expect(closed).toMatchObject({
      id: target.id,
      status: 'CLOSED',
      handledBy: { id: me.admin.id, email: me.admin.email },
      handledAt: h.clock.now().toISOString(),
      resolutionNote: 'Listing reported to the platform; the owner was told.',
      place: 'a marketplace listing',
    });

    const audit = await h.ctx.db.selectFrom('audit_logs').selectAll().where('target_id', '=', scans.first).orderBy('id').execute();
    expect(audit.map((a) => [a.action, a.target_type, a.actor_type])).toEqual([
      ['scan.report', 'scan', 'system'],
      ['scan.report.close', 'scan', 'admin'],
    ]);
    expect(audit[1]).toMatchObject({ actor_id: me.admin.id, details: { reportId: target.id } });
    expect(JSON.stringify(audit)).not.toMatch(/marketplace|third of the price|Listing reported/);

    const again = await operator.patch(`/api/admin/reports/${target.id}`, { status: 'CLOSED', note: 'Twice.' });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).code).toBe('REPORT_ALREADY_CLOSED');
    const unknown = await operator.patch('/api/admin/reports/00000000-0000-4000-8000-000000000000', { status: 'CLOSED', note: 'x' });
    expect(unknown.statusCode).toBe(404);
    expect(errorOf(unknown).code).toBe('REPORT_NOT_FOUND');

    // The queue keeps open cases first; the closed one is found under CLOSED.
    expect((await cases(auditor)).items.map((c) => c.status)).toEqual(['OPEN', 'OPEN', 'CLOSED']);
    expect((await cases(auditor, '?status=CLOSED')).items.map((c) => c.id)).toEqual([target.id]);
    // An AUDITOR reads the queue but cannot close a case.
    const [open] = (await cases(auditor, '?status=OPEN')).items;
    const refused = await auditor.patch(`/api/admin/reports/${open.id}`, { status: 'CLOSED', note: 'x' });
    expect(refused.statusCode).toBe(403);
    expect(errorOf(refused).code).toBe('FORBIDDEN');
  });
});
