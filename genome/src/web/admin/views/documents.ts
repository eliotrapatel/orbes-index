/**
 * Documents: the staff's reference texts in the console. The sales and
 * shipping playbook (J-09) and the packaging kit (D-02), read in full with
 * their tables, quotes and illustrations, a contents column on the side,
 * and a print button. They come from GET /api/admin/documents (copies of
 * docs/launch, shipped with the server).
 */
import { h } from '../../shared/dom.js';
import { href } from '../router.js';
import { renderMarkdown } from '../ui/markdown.js';
import { pageHeader } from '../ui/components.js';
import type { ViewContext } from './context.js';

const LANG = { fr: 'Français', en: 'English · Français' } as const;
/** The documents a link can open, by the file name the Markdown cites. */
const DOCUMENT_IDS: Readonly<Record<string, string>> = Object.freeze({
  'SALES-PLAYBOOK.md': 'sales-playbook',
  'PACKAGING-KIT.md': 'packaging-kit',
});
const assetUrl = (name: string): string => `/api/admin/documents/assets/${encodeURIComponent(name)}`;

export async function documentsView(ctx: ViewContext): Promise<HTMLElement> {
  const { documents } = await ctx.api.documents();
  return h(
    'div',
    { class: 'docs' },
    pageHeader({ eyebrow: 'Library', title: 'Documents', lead: 'The reference texts of the team: how to sell and ship a piece, and what the packaging and the certificate card say.' }),
    h(
      'ul',
      { class: 'docs__list', data: { testid: 'documents' } },
      ...documents.map((d, i) =>
        h(
          'li',
          { class: 'docs__item' },
          h(
            'a',
            { class: 'docs__card', attrs: { href: href('document', { docId: d.id }) }, data: { testid: `document-${d.id}` } },
            h('span', { class: 'docs__index' }, String(i + 1).padStart(2, '0')),
            h('span', { class: 'docs__title' }, d.title),
            h('span', { class: 'docs__summary' }, d.summary),
            h('span', { class: 'docs__meta' }, LANG[d.lang], h('span', { class: 'docs__open', attrs: { 'aria-hidden': 'true' } }, 'Read', h('span', { class: 'docs__arrow' }, '→'))),
          ),
        ),
      ),
    ),
  );
}

export async function documentView(ctx: ViewContext): Promise<HTMLElement> {
  const doc = await ctx.api.document(ctx.route.params.docId ?? '');
  const { body, toc } = renderMarkdown(doc.markdown, { documentIds: DOCUMENT_IDS, assetUrl });
  // The document's own title (its first heading) heads the article; the page head names the library.
  const print = h('button', { class: 'btn btn--ghost', attrs: { type: 'button' } }, 'Print');
  print.addEventListener('click', () => window.print());
  const contents = h(
    'nav',
    { class: 'doc__toc', attrs: { 'aria-label': 'Contents' } },
    h('p', { class: 'doc__toc-title' }, 'Contents'),
    h(
      'ol',
      { class: 'doc__toc-list' },
      ...toc.map((t) => {
        const a = h('a', { class: 'doc__toc-link', attrs: { href: `#${t.id}` } }, t.text);
        // Hash routing owns the URL hash: scroll to the heading instead of navigating.
        a.addEventListener('click', (e) => {
          e.preventDefault();
          document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return h('li', null, a);
      }),
    ),
  );
  return h(
    'div',
    { class: 'doc', data: { testid: `doc-${doc.id}` } },
    pageHeader({
      eyebrow: 'Documents',
      title: doc.title,
      actions: [h('a', { class: 'btn btn--ghost', attrs: { href: href('documents') } }, 'All documents'), print],
    }),
    h('div', { class: 'doc__layout' }, toc.length ? contents : null, h('article', { class: 'doc__article', attrs: { lang: doc.lang } }, body)),
  );
}
