/**
 * GET /api/admin/system/status (AUDITOR) — the server's status for the console's Server panel (test entrants, §7):
 * `{ now, latest, history, visitorData }`, the samples of the last 10 minutes taken every 2 s by the app's sampler
 * (services/system-status.ts), oldest first, the newest also as `latest`, and the bytes of the customer intelligence's
 * recorded data as last measured (plan CUSTOMER INTELLIGENCE §3.4 A.10.7). A value this host cannot give is null.
 */
import type { FastifyPluginAsync } from 'fastify';
import type { SystemStatus } from '../../services/system-status.js';
import type { AdminRouteDeps } from './index.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The server's status of this app (services/system-status.ts), started and stopped with it (app.ts). */
    systemStatus: SystemStatus;
  }
}

export const adminSystemRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app) => {
  app.get('/api/admin/system/status', async () => app.systemStatus.status());
};
