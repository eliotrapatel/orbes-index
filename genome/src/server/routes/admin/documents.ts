/**
 * The staff documents the console shows under Documents: the sales and
 * shipping playbook (J-09) and the packaging kit (D-02), as Markdown, with
 * the illustrations they embed.
 *
 *   GET /api/admin/documents              the list (id, title, summary, language)
 *   GET /api/admin/documents/:id          one document: its Markdown
 *   GET /api/admin/documents/assets/:name one of its illustrations
 *
 * AUDITOR, like every read (RETAIL never reads them: its sale shell has no
 * Documents). The files are copies of docs/launch/*.md and of the images they
 * cite, shipped with the server image (src/server/documents/); a test holds
 * each copy to its source, so a change of the playbook or the kit must be
 * copied here. Read once at first use and kept in memory: they are small.
 */
import { readFileSync } from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { DomainError } from '../../errors.js';
import type { AdminRouteDeps } from './index.js';

export interface StaffDocument {
  id: string;
  file: string;
  title: string;
  summary: string;
  lang: 'fr' | 'en';
}

export const STAFF_DOCUMENTS: readonly StaffDocument[] = Object.freeze([
  {
    id: 'sales-playbook',
    file: 'SALES-PLAYBOOK.md',
    title: 'Sales and shipping playbook',
    summary: 'One sheet per situation at the counter and for online orders, the 30-minute checklist, and the staff accounts.',
    lang: 'fr',
  },
  {
    id: 'packaging-kit',
    file: 'PACKAGING-KIT.md',
    title: 'Packaging kit',
    summary: 'The packaging text, the certificate card, the French lexicon and the launch announcement, in English and French.',
    lang: 'en',
  },
]);

/** The illustrations the documents embed, by the name the Markdown gives them (../assets/…). */
export const DOCUMENT_ASSETS: Readonly<Record<string, string>> = Object.freeze({
  'certificate-card-specimen.svg': 'image/svg+xml',
  'admin-02-product.png': 'image/png',
});

const DIR = new URL('../../documents/', import.meta.url);
const cache = new Map<string, Buffer>();

function load(name: string): Buffer {
  let b = cache.get(name);
  if (!b) {
    b = readFileSync(new URL(name, DIR));
    cache.set(name, b);
  }
  return b;
}

export const adminDocumentRoutes: FastifyPluginAsync<AdminRouteDeps> = async (app) => {
  app.get('/api/admin/documents', async () => ({
    documents: STAFF_DOCUMENTS.map(({ id, title, summary, lang }) => ({ id, title, summary, lang })),
  }));

  app.get('/api/admin/documents/assets/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const type = Object.prototype.hasOwnProperty.call(DOCUMENT_ASSETS, name) ? DOCUMENT_ASSETS[name] : undefined;
    if (!type) throw new DomainError('DOCUMENT_NOT_FOUND', 404, 'No such illustration.');
    reply.header('content-type', type);
    reply.header('cache-control', 'private, max-age=3600');
    reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    return reply.send(load(`assets/${name}`));
  });

  app.get('/api/admin/documents/:id', async (request) => {
    const { id } = request.params as { id: string };
    const doc = STAFF_DOCUMENTS.find((d) => d.id === id);
    if (!doc) throw new DomainError('DOCUMENT_NOT_FOUND', 404, 'No such document.');
    return { id: doc.id, title: doc.title, lang: doc.lang, markdown: load(doc.file).toString('utf8') };
  });
};
