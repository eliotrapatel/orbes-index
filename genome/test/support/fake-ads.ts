/**
 * Local ad platforms for the tests (lot M4, K27 §3.6): one node:http server on 127.0.0.1 answering Meta's events edge,
 * TikTok's event/track, Google Ads' uploadClickConversions and Google's OAuth token, as each platform does when it takes
 * the request. No test ever calls a real platform: the senders get this server's origin as their base URL, and the
 * client lists it as its test origin.
 *
 *   const ads = await startFakeAds();
 *   const http = new AdsHttp({ testOrigins: [ads.origin] });
 *   await new MetaSender(keys, http, { baseUrl: ads.origin, sourceUrl }).send(event);
 *   ads.requests[0].json; // the body as the platform received it
 *   ads.answer(/events$/, { status: 400, body: { error: { message: 'Invalid OAuth access token.' } } }); // the next answer
 *   await ads.close();
 *
 * Each request is kept (`requests`: method, path, headers, raw body and its JSON). An answer can be replaced once or for
 * good (`answer`, `answerAlways`): a status, a body (text or JSON), headers (a redirect's Location), a delay, or a body
 * of `bytes` bytes.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeAdsRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  json: unknown;
}

export interface FakeAdsAnswer {
  status?: number;
  body?: string | object;
  headers?: Record<string, string>;
  /** Wait this long before answering (ms). */
  delayMs?: number;
  /** A body of this many bytes ('x'), instead of `body`. */
  bytes?: number;
}

export interface FakeAds {
  /** `http://127.0.0.1:<port>`. */
  origin: string;
  requests: FakeAdsRequest[];
  /** The next request whose path matches gets this answer (once). */
  answer(path: RegExp, answer: FakeAdsAnswer | ((req: FakeAdsRequest) => FakeAdsAnswer)): void;
  /** Every request whose path matches gets this answer, until `reset`. */
  answerAlways(path: RegExp, answer: FakeAdsAnswer | ((req: FakeAdsRequest) => FakeAdsAnswer)): void;
  /** Forgets the requests and the replaced answers. */
  reset(): void;
  close(): Promise<void>;
}

/** The paths of the platforms, as their senders build them. */
export const FAKE_ADS_PATHS = Object.freeze({
  meta: /^\/v[0-9.]+\/[0-9]+\/events$/,
  tiktok: /^\/open_api\/v[0-9.]+\/event\/track\/$/,
  google: /^\/v[0-9]+\/customers\/[0-9]+:uploadClickConversions$/,
  oauth: /^\/token$/,
});

let tokens = 0;

/** How each platform answers a request it takes. */
function defaultAnswer(req: FakeAdsRequest): FakeAdsAnswer {
  if (req.method !== 'POST') return { status: 405, body: { error: 'method' } };
  if (FAKE_ADS_PATHS.meta.test(req.path)) return { status: 200, body: { events_received: 1, messages: [], fbtrace_id: 'FAKE' } };
  if (FAKE_ADS_PATHS.tiktok.test(req.path)) return { status: 200, body: { code: 0, message: 'OK', request_id: 'FAKE' } };
  if (FAKE_ADS_PATHS.google.test(req.path)) {
    const validateOnly = (req.json as { validateOnly?: boolean } | null)?.validateOnly === true;
    return { status: 200, body: validateOnly ? {} : { results: [{ conversionAction: 'customers/0/conversionActions/0' }] } };
  }
  if (FAKE_ADS_PATHS.oauth.test(req.path)) {
    tokens += 1;
    return { status: 200, body: { access_token: `fake-access-token-${tokens}`, expires_in: 3599, token_type: 'Bearer' } };
  }
  return { status: 404, body: { error: 'not found' } };
}

export async function startFakeAds(): Promise<FakeAds> {
  const requests: FakeAdsRequest[] = [];
  let once: { path: RegExp; answer: FakeAdsAnswer | ((req: FakeAdsRequest) => FakeAdsAnswer) }[] = [];
  let always: { path: RegExp; answer: FakeAdsAnswer | ((req: FakeAdsRequest) => FakeAdsAnswer) }[] = [];

  const handle = async (incoming: IncomingMessage, res: ServerResponse): Promise<void> => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    let json: unknown = null;
    try {
      json = body === '' ? null : JSON.parse(body);
    } catch {
      json = null;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(incoming.headers)) if (typeof v === 'string') headers[k] = v;
    const req: FakeAdsRequest = { method: incoming.method ?? '', path: incoming.url ?? '', headers, body, json };
    requests.push(req);

    const i = once.findIndex((o) => o.path.test(req.path));
    const chosen = i >= 0 ? once.splice(i, 1)[0]!.answer : always.find((a) => a.path.test(req.path))?.answer;
    const answer = chosen === undefined ? defaultAnswer(req) : typeof chosen === 'function' ? chosen(req) : chosen;
    if (answer.delayMs) await new Promise((r) => setTimeout(r, answer.delayMs));
    if (res.destroyed) return;
    const text = answer.bytes !== undefined ? 'x'.repeat(answer.bytes) : typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body ?? {});
    res.writeHead(answer.status ?? 200, { 'content-type': typeof answer.body === 'string' || answer.bytes !== undefined ? 'text/plain' : 'application/json', ...answer.headers });
    res.end(text);
  };

  const server = createServer((incoming, res) => {
    handle(incoming, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    answer(path, answer) {
      once.push({ path, answer });
    },
    answerAlways(path, answer) {
      always.push({ path, answer });
    },
    reset() {
      requests.length = 0;
      once = [];
      always = [];
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
