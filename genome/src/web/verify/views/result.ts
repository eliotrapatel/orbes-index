/**
 * Result: the state, then the photographs (authentic results, F-04), the
 * GENOME, the product lines and the four tabs.
 *
 *          ◯                    tone mark (seal / moon / empty orbit)
 *      A U T H E N T I C        state title, tracked
 *      FIRST REGISTRATION       sub-title when the server title has one
 *   one sentence from the server
 *   ─ Buying this piece? … ─    AUTHENTIC — REGISTERED only (J-02), then
 *    I HAVE A TRANSFER CODE     a link to OWNERSHIP, RECEIVING THIS PIECE
 *   ┌                      ┐
 *     [ this piece ] [ model ]  photographs on ivory, when ORBES has them
 *   └                      ┘
 *   ┌                      ┐
 *     GENOME  O26-J-00184
 *     ◔ · ◯ · ◕ · …            core renderGenomeSvg orbit, the ORBES monogram at its centre (decision 12)
 *     G1-E1DC-BE52 · GENOME-01
 *        MONOLITHE              the ceremony of a first registration (P-D01):
 *          ORBIT                the glyphs appear one by one, then the model
 *      SHARE THE GENOME         and its collection, and the image to share
 *   └                      ┘
 *   MONOLITHE / RING / JEWELRY / 925 STERLING SILVER / CREATED 2026
 *   DISCONTINUED · 2027              once an ADMIN discontinued its model (P-R06)
 *            SEE THE MODEL           its model's sheet in THE COLLECTION
 *                                    (P-R02), a text link, when it is PUBLIC
 *   PRODUCT · WARRANTY · CARE · OWNERSHIP
 *   SCAN ANOTHER · footnote · VERIFIED · REF
 *   (the legal pages, J-06, and DB-IP's attribution: NOCTURNE's footer, views/shell.ts, in a new tab)
 *
 * Other results show no product lines and no tabs, only a line for ORBES
 * Client Services and, when it is configured, CONTACT ORBES CLIENT SERVICES
 * (an email prefilled with the reference and the result), its phone and
 * hours; UNUSUAL ACTIVITY adds, when the server offers it, the section DO
 * YOU HOLD THE CERTIFICATE CARD? (registration with the claim code) or DO
 * YOU HOLD A TRANSFER CODE? (F-03: receiving the piece with it); then
 * WHERE DID YOU SEE OR BUY THIS PIECE?, an optional answer attached to the
 * scan. A warranty that no longer applies offers the same contact in its
 * tab, and FORGOTTEN PASSWORD? in the OWNERSHIP panel offers it to a
 * customer who needs a recovery code (C-04).
 *
 * The ceremony (P-D01) is the result VIEW AS OWNER opens right after a first
 * registration: the GENOME plate comes first, above the photographs; its
 * eight glyphs appear one by one (opacity and scale of each `data-layer=genome`
 * group, delayed by its `--i`, set through the CSSOM), then the name of the
 * model and its collection, with a short vibration where the device has one.
 * SHARE THE GENOME is a text link (the hairline button stays the foot's): its
 * PNG is drawn when the result is built (share-image.ts), so the tap shares a
 * ready file. With reduced motion, all of it is shown at once, without motion.
 *
 * Everything shown comes from the server outcome through resultViewModel().
 */
import { bracket } from '../../shared/corners.js';
import { h, prefersReducedMotion } from '../../shared/dom.js';
import { CEREMONY, RECEIVING } from '../copy.js';
import { genomeBlock, genomeFromModel } from '../genome-view.js';
import { prepareShareImage, shareGenomeImage } from '../share-image.js';
import { initialTab, type CeremonyModel, type ResultViewModel, type TabId } from '../view-model.js';
import { contactBlock, lookbookLink, toneMark, viewRoot, withNumerals } from './common.js';
import { OwnershipPanel, type OwnershipDeps } from './ownership.js';
import { carePanel, productPanel, warrantyPanel } from './panels.js';
import { photoPlate } from './photos.js';
import { reportSection, type ReportDeps } from './report.js';
import { tabsView, type TabsView } from './tabs.js';

export interface ResultHandlers {
  onScanAgain(): void;
  /** Verify the same code again (after an ownership change); `ceremony`: right after a first registration (P-D01). */
  onRefresh?(opts?: { ceremony?: boolean }): void;
  ownership: Omit<OwnershipDeps, 'onRescan'>;
  /** Sends the answer to WHERE DID YOU SEE OR BUY THIS PIECE? (results that were not authentic). */
  report?: ReportDeps;
  /** SEE THE MODEL (P-R02): open its model's sheet in the app. */
  onModel?(slug: string): void;
}

export interface ResultView {
  root: HTMLElement;
  /** The result is on screen: the ceremony's vibration (P-D01) follows its names. */
  shown(): void;
  dispose(): void;
}

/** The ceremony's vibration (P-D01): two short pulses, as the names appear under the GENOME. */
export const CEREMONY_VIBRATION: readonly number[] = [18, 90, 18];

/**
 * The ceremony under the GENOME (P-D01): the name of the model and its collection, then SHARE THE GENOME, shown once
 * its image is ready (a browser that cannot draw it offers no link). The PNG is drawn now, before any tap.
 */
function ceremonyBlock(c: CeremonyModel, glyphs: Parameters<typeof prepareShareImage>[0], alive: () => boolean): HTMLElement {
  let image: Blob | null = null;
  const share = h('button', {
    class: 'textlink ceremony__share',
    attrs: { type: 'button', hidden: true },
    // Within the tap: the file is ready, so the share sheet opens before anything is awaited.
    on: { click: () => void (image && shareGenomeImage(image)) },
    text: CEREMONY.share,
  });
  void prepareShareImage(glyphs, c).then((blob) => {
    if (!blob || !alive()) return;
    image = blob;
    share.hidden = false;
  });
  return h(
    'section',
    { class: 'ceremony', attrs: { 'aria-label': CEREMONY.label } },
    h('p', { class: 'ceremony__name' }, ...withNumerals(c.name)),
    c.collection ? h('p', { class: 'ceremony__collection' }, ...withNumerals(c.collection)) : null,
    share,
  );
}

export function resultView(vm: ResultViewModel, handlers: ResultHandlers): ResultView {
  const root = viewRoot('result', 'result-title');
  root.dataset.state = vm.state;
  root.dataset.tone = vm.tone;
  // Short results (no genome, no tabs) sit in the optical centre instead of hanging from the top.
  if (!vm.genome && vm.tabs.length === 0) root.classList.add('is-compact');
  let ownership: OwnershipPanel | null = null;
  let tabs: TabsView | null = null;
  let disposed = false;
  // P-D01: the ceremony needs a GENOME the page can draw faithfully (the same check as its figure).
  const ceremonyGenome = vm.ceremony && vm.genome ? genomeFromModel(vm.genome) : null;
  const ceremony = vm.ceremony && ceremonyGenome ? vm.ceremony : null;
  let ceremonyNames: HTMLElement | null = null;
  let vibration: (() => void) | null = null;

  // The link under the second-hand guidance (J-02): the OWNERSHIP tab, on RECEIVING THIS PIECE (or on the tab itself
  // when the panel no longer shows that section, once the piece has been received).
  const openNoticeLink = (tab: TabId): void => {
    // Selecting the tab builds its panel on first selection.
    tabs?.select(tab);
    if (tab === 'ownership' && ownership?.showReceiving()) return;
    tabs?.select(tab, true);
  };

  const head = h(
    'header',
    { class: 'result__head' },
    h('span', { class: 'wordmark wordmark--small result__wordmark', attrs: { 'aria-hidden': 'true' }, text: 'ORBES' }),
    h('div', { class: 'result__mark' }, toneMark(vm.tone)),
    h(
      'h1',
      { class: 'result__title', id: 'result-title' },
      h('span', { class: 'result__title-main', text: vm.titleMain }),
      vm.titleSub ? h('span', { class: 'result__title-sub micro indent-micro', text: vm.titleSub }) : null,
    ),
    vm.message ? h('p', { class: 'result__message prose', text: vm.message }) : null,
    vm.notice ? h('p', { class: 'result__notice', attrs: { role: 'note' }, text: vm.notice }) : null,
    vm.notice && vm.noticeLink
      ? h('button', {
          class: 'textlink result__notice-link',
          attrs: { type: 'button' },
          on: { click: () => openNoticeLink(vm.noticeLink!.tab) },
          text: vm.noticeLink.label,
        })
      : null,
  );

  const sections: (HTMLElement | null)[] = [];
  let plate: HTMLElement | null = null;
  if (vm.genome) {
    plate = h('div', { class: 'result__genome' }, genomeBlock(vm.genome));
    if (ceremony && ceremonyGenome) {
      const block = ceremonyBlock(ceremony, ceremonyGenome, () => !disposed);
      ceremonyNames = block.querySelector<HTMLElement>('.ceremony__name');
      plate.append(block);
      if (!prefersReducedMotion()) {
        // Each glyph of the orbit is one group of the layer genome, in order (glyph 0 at north, then clockwise).
        root.classList.add('is-ceremony');
        plate.querySelectorAll<SVGGElement>('.genome-svg g[data-layer="genome"]').forEach((g, i) => g.style.setProperty('--i', String(i)));
      }
    }
    plate = bracket(plate);
  }
  if (ceremony && plate) {
    // The ceremony opens on the GENOME, above the photographs.
    sections.push(plate, photoPlate(vm.photos));
  } else {
    // At the head of an authentic result, above the GENOME: what the customer compares with the piece in hand.
    sections.push(photoPlate(vm.photos), plate);
  }
  if (vm.productLines.length > 0) {
    const slug = vm.lookbook;
    sections.push(
      h(
        'section',
        { class: 'result__lines', attrs: { 'aria-label': 'Product' } },
        h('ul', { class: 'lines' }, ...vm.productLines.map((line) => h('li', { class: 'lines__line', text: line }))),
        // Under the lines that name the model: its sheet in THE COLLECTION, a text link (the hairline button stays the foot's).
        slug ? lookbookLink(handlers.onModel ? () => handlers.onModel!(slug) : undefined, { slug, extraClass: 'result__model-link' }) : null,
      ),
    );
  }

  if (vm.tabs.length > 0) {
    const build = (id: TabId): HTMLElement => {
      switch (id) {
        case 'product':
          return productPanel(vm);
        case 'warranty':
          return warrantyPanel(vm);
        case 'care':
          return carePanel(vm);
        case 'ownership':
          ownership = new OwnershipPanel(vm.ownership, { ...handlers.ownership, onRescan: handlers.onScanAgain, onRefresh: handlers.onRefresh, contact: vm.recoveryContact });
          return h('div', { class: 'panel' }, ownership.root);
      }
    };
    // Registration, and the transfer of a piece to its recipient (F-03), open straight on OWNERSHIP.
    tabs = tabsView(vm.tabs, build, initialTab(vm));
    sections.push(tabs.root);
  } else if (vm.tone !== 'authentic') {
    // The help line, then (when Client Services is configured) the prefilled email, the phone and the hours.
    sections.push(
      h(
        'section',
        { class: 'result__help' },
        h('p', { class: 'prose', text: 'ORBES Client Services can help with any question about this piece. Please quote the reference below.' }),
        vm.contact?.placement === 'help' ? contactBlock(vm.contact) : null,
      ),
    );
    // UNUSUAL ACTIVITY with a registration token (the server's step 10 exception): the buyer holding
    // the certificate card may still register, with its claim code. Sign-in, then the claim code; no product data.
    if (vm.ownership.kind === 'register') {
      ownership = new OwnershipPanel(vm.ownership, { ...handlers.ownership, onRescan: handlers.onScanAgain, onRefresh: handlers.onRefresh, contact: vm.recoveryContact });
      sections.push(
        h(
          'section',
          { class: 'result__card', attrs: { 'aria-labelledby': 'card-title' } },
          h('h2', { class: 'result__card-title', id: 'card-title', text: 'DO YOU HOLD THE CERTIFICATE CARD?' }),
          h('p', {
            class: 'prose result__card-text',
            text: 'If this piece was delivered to you with its ORBES certificate card, you may register it in your name with the claim code printed under the scratch-off panel.',
          }),
          ownership.root,
        ),
      );
    }
    // UNUSUAL ACTIVITY with a transfer window (F-03, the same exception for a transfer): the reader signed in when the
    // scan was made may still receive the piece with the transfer code its owner gave. No product data.
    if (vm.ownership.kind === 'registered' && vm.ownership.underReview === true) {
      ownership = new OwnershipPanel(vm.ownership, { ...handlers.ownership, onRescan: handlers.onScanAgain, onRefresh: handlers.onRefresh, contact: vm.recoveryContact });
      sections.push(
        h(
          'section',
          { class: 'result__card', attrs: { 'aria-labelledby': 'transfer-card-title' } },
          h('h2', { class: 'result__card-title', id: 'transfer-card-title', text: RECEIVING.cardTitle }),
          h('p', { class: 'prose result__card-text', text: RECEIVING.cardText }),
          ownership.root,
        ),
      );
    }
    // Under the contact (and under the certificate-card or transfer-code section when there is one, which follows the
    // help line): where the piece was seen or bought, attached to this scan. Optional.
    if (vm.report && handlers.report) sections.push(reportSection(vm.report, handlers.report));
  }

  const foot = h(
    'footer',
    { class: 'result__foot' },
    h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => handlers.onScanAgain() }, text: vm.tone === 'authentic' ? 'SCAN ANOTHER' : 'SCAN AGAIN' }),
    vm.footnote ? h('p', { class: 'result__footnote', text: vm.footnote }) : null,
    h(
      'p',
      { class: 'result__meta' },
      vm.verifiedAt ? h('span', { text: `VERIFIED ${vm.verifiedAt}` }) : null,
      vm.reference ? h('span', { text: `REF ${vm.reference}` }) : null,
    ),
  );

  root.append(head, ...sections.filter((x): x is HTMLElement => x !== null), foot);

  const shown = (): void => {
    if (!ceremony || disposed) return;
    const vibrate = (): void => void navigator.vibrate?.([...CEREMONY_VIBRATION]);
    const names = ceremonyNames;
    // With motion, as the names rise under the glyphs (their animation); without, at once.
    if (names && root.classList.contains('is-ceremony')) {
      vibration = () => {
        if (!disposed) vibrate();
      };
      names.addEventListener('animationstart', vibration, { once: true });
    } else vibrate();
  };
  return {
    root,
    shown,
    dispose: () => {
      disposed = true;
      if (vibration) ceremonyNames?.removeEventListener('animationstart', vibration);
      (ownership as OwnershipPanel | null)?.dispose();
    },
  };
}
