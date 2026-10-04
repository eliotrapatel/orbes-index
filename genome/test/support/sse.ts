/**
 * Server-Sent Events over real HTTP for the API tests (the LIVE RELEASES' streams: routes/live.ts, routes/admin/live.ts):
 * a request kept open, its events parsed as an EventSource reads them (`event:`, `data:`, `retry:`, comments), its
 * refusal's JSON body when it is not a 200.
 */
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface Sse {
  status: number;
  headers: IncomingHttpHeaders;
  /** The body of a refusal (JSON), when not 200. */
  body: unknown;
  events: SseEvent[];
  comments: string[];
  retry: number | null;
  ended: boolean;
  close(): void;
  /** Wait for an event (from `from` on) matching `test`. */
  next(test: (e: SseEvent) => boolean, from?: number): Promise<SseEvent>;
}

export function openSse(base: string, path: string, opts: { cookies?: Map<string, string>; method?: 'GET' | 'POST'; body?: unknown; origin?: string } = {}): Promise<Sse> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = { accept: 'text/event-stream' };
    if (opts.cookies?.size) headers.cookie = [...opts.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
    }
    if (opts.origin) headers.origin = opts.origin;
    const req = httpRequest(`${base}${path}`, { method: opts.method ?? 'GET', headers }, (res) => {
      const sse: Sse = {
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: undefined,
        events: [],
        comments: [],
        retry: null,
        ended: false,
        close: () => req.destroy(),
        async next(test, from = 0) {
          for (let i = 0; i < 200; i++) {
            const found = sse.events.slice(from).find(test);
            if (found) return found;
            if (sse.ended) break;
            await new Promise((r) => setTimeout(r, 10));
          }
          throw new Error(`no such event; got ${JSON.stringify(sse.events.map((e) => e.event))}`);
        },
      };
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let cut: number;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          let event = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) sse.comments.push(line.slice(1).trim());
            else if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) data += line.slice(6);
            else if (line.startsWith('retry: ')) sse.retry = Number(line.slice(7));
          }
          if (data) sse.events.push({ event, data: JSON.parse(data) as Record<string, unknown> });
        }
      });
      res.on('end', () => {
        sse.ended = true;
        if (sse.status !== 200 && buffer) sse.body = JSON.parse(buffer);
      });
      res.on('close', () => (sse.ended = true));
      if (sse.status === 200) resolve(sse);
      else res.on('end', () => resolve(sse));
    });
    req.on('error', (e) => ((e as NodeJS.ErrnoException).code === 'ECONNRESET' ? undefined : reject(e)));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
