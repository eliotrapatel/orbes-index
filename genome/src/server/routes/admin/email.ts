/**
 * The emails in the console (plan MACRO M1 §4.2, §4.3; lot M1 step M1.17; services/email.ts, services/email-triggers.ts),
 * read by the Emails page and the Founding list's announcement panel (lot M1 step M1.18).
 *
 *   GET    /api/admin/email                             AUDITOR   the channel (off, or on with its host and sender),
 *                                                                  each kind's switch, words, placeholders and default
 *                                                                  words, the outbox's counts and last errors
 *   PUT    /api/admin/email/kinds/:kind/enabled         ADMIN     a kind on or off               email.kind.enable/.disable
 *   PUT    /api/admin/email/kinds/:kind/words           OPERATOR  a kind's subject and body (null: the default words)
 *                                                                                                   email.template.update
 *   GET    /api/admin/email/kinds/:kind/preview         AUDITOR   the kind as sent, its words and example values
 *   POST   /api/admin/email/kinds/:kind/preview         OPERATOR  the same with the words being written (nothing stored)
 *   POST   /api/admin/email/kinds/:kind/test            ADMIN     a test to the console member's own address, only
 *                                                                  while the channel is on (409 EMAIL_OFF)  email.test
 *   GET    /api/admin/email/outbox                      AUDITOR   the outbox, newest first (?status&kind&page&pageSize),
 *                                                                  addresses masked for an AUDITOR
 *   GET    /api/admin/email/outbox/:id                  AUDITOR   one email as it was sent (its text and HTML, to show
 *                                                                  in a sandboxed frame only); a reset link's code is
 *                                                                  never shown
 *   GET    /api/admin/email/announcement                AUDITOR   the founding announcement's panel (E1, F6)
 *   GET    /api/admin/email/announcement/:id/preview    AUDITOR   the announcement of the release :id as it would go now
 *   POST   /api/admin/email/announcement/:id            ADMIN     send it for the release :id, now or at its opening,
 *                                                                  the phrase SEND <8>          email.announcement.queue
 *   POST   /api/admin/email/announcement/:id/cancel     ADMIN     CANCEL SCHEDULED            email.announcement.cancel
 *
 * Never stored by a cache. RETAIL and LOGISTICS get 403.
 */
import type { FastifyPluginAsync } from 'fastify';
import { EMAIL_DEFAULTS, EMAIL_PLACEHOLDERS, PLACEHOLDER_WORDS } from '../../email/copy.js';
import { announcementBody, dropParams, emailDraftBody, emailEnabledBody, emailKindParams, emailOutboxParams, emailOutboxQuery, emailWordsBody, emptyBody, pageOf, parse } from '../../http/schemas.js';
import { adminActor, requireAdmin } from '../../http/sessions.js';
import type { EmailKindWords } from '../../services/email.js';
import type { EmailKind } from '../../db/schema.js';
import type { AdminRouteDeps } from './index.js';
import { clientEmail, readsClientEmails } from './serialize.js';

const OPERATOR = { guard: { minRole: 'OPERATOR' as const } };
const ADMIN = { guard: { minRole: 'ADMIN' as const } };

/**
 * An email's links as the console shows it: a reset link's code (`/verify/reset#<email>/<code>`) and an unsubscribe
 * link's token (`/verify/unsubscribe#<token>`, `/api/v1/email/unsubscribe?t=<token>`), never their secret part, so that
 * no staff member can use them.
 */
export function withoutLinkSecrets(words: string): string {
  return words.replace(/(\/verify\/(?:reset|unsubscribe))#[^\s"'<>)]*/g, '$1#…').replace(/(\/api\/v1\/email\/unsubscribe\?t=)[^\s"'<>)&]*/g, '$1…');
}

/** A kind as the console reads it: its switch and words, the placeholders its trigger fills, its default words. */
function kindJson(k: EmailKindWords) {
  return {
    ...k,
    placeholders: EMAIL_PLACEHOLDERS[k.kind].map((name) => ({ name, words: PLACEHOLDER_WORDS[name] })),
    defaults: EMAIL_DEFAULTS[k.kind],
  };
}

export const adminEmailRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app, { ctx }) => {
  const { email, emails } = ctx.services;
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/api/admin/email', async () => ({
    channel: email.channel(),
    kinds: (await email.kinds()).map(kindJson),
    outbox: await email.outboxCounts(),
  }));

  app.put('/api/admin/email/kinds/:kind/enabled', { config: ADMIN }, async (request) => {
    const { kind } = parse(emailKindParams, request.params);
    const b = parse(emailEnabledBody, request.body);
    return { kind: kindJson(await email.setEnabled(kind as EmailKind, b.enabled, adminActor(request))) };
  });

  app.put('/api/admin/email/kinds/:kind/words', { config: OPERATOR }, async (request) => {
    const { kind } = parse(emailKindParams, request.params);
    const b = parse(emailWordsBody, request.body);
    return { kind: kindJson(await email.setWords(kind as EmailKind, { ...(b.subject !== undefined ? { subject: b.subject } : {}), ...(b.body !== undefined ? { body: b.body } : {}) }, adminActor(request))) };
  });

  app.get('/api/admin/email/kinds/:kind/preview', async (request) => {
    const { kind } = parse(emailKindParams, request.params);
    return email.preview(kind as EmailKind);
  });

  app.post('/api/admin/email/kinds/:kind/preview', { config: OPERATOR }, async (request) => {
    const { kind } = parse(emailKindParams, request.params);
    const b = parse(emailDraftBody, request.body);
    return email.preview(kind as EmailKind, { ...(b.subject !== undefined ? { subject: b.subject } : {}), ...(b.body !== undefined ? { body: b.body } : {}) });
  });

  app.post('/api/admin/email/kinds/:kind/test', { config: ADMIN }, async (request, reply) => {
    const { kind } = parse(emailKindParams, request.params);
    const b = parse(emailDraftBody, request.body);
    const { admin } = requireAdmin(request);
    const r = await email.sendTest(kind as EmailKind, admin.email, adminActor(request), { ...(b.subject !== undefined ? { subject: b.subject } : {}), ...(b.body !== undefined ? { body: b.body } : {}) });
    reply.code(201);
    return r;
  });

  app.get('/api/admin/email/outbox', async (request) => {
    const q = parse(emailOutboxQuery, request.query);
    const page = await email.outbox({ ...(q.status ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}) }, pageOf(request.query));
    const inClear = readsClientEmails(request);
    return { ...page, items: page.items.map((e) => ({ ...e, to: clientEmail(e.to, inClear) })) };
  });

  app.get('/api/admin/email/outbox/:id', async (request) => {
    const { id } = parse(emailOutboxParams, request.params);
    const e = await email.outboxEmail(id);
    return { ...e, to: clientEmail(e.to, readsClientEmails(request)), text: withoutLinkSecrets(e.text), html: withoutLinkSecrets(e.html) };
  });

  app.get('/api/admin/email/announcement', async () => emails.announcement());

  app.get('/api/admin/email/announcement/:id/preview', async (request) => {
    const { id } = parse(dropParams, request.params);
    return emails.announcementPreview(id);
  });

  app.post('/api/admin/email/announcement/:id', { config: ADMIN }, async (request, reply) => {
    const { id } = parse(dropParams, request.params);
    const b = parse(announcementBody, request.body);
    const r = await emails.queueAnnouncement(id, { when: b.when, phrase: b.phrase }, adminActor(request));
    reply.code(201);
    return r;
  });

  app.post('/api/admin/email/announcement/:id/cancel', { config: ADMIN }, async (request) => {
    const { id } = parse(dropParams, request.params);
    parse(emptyBody, request.body);
    return emails.cancelAnnouncement(id, adminActor(request));
  });
};
