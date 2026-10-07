/**
 * Result (plan NOCTURNE, screen 2; C9, C13–C16, C36, C37): the state, the GENOME, THE MODEL's photograph, the piece's
 * lines and the four tabs, on the ground, centred, in NOCTURNE's pieces (views/nocturne.ts).
 *
 *               ◉                    tone mark (authentic: ring and core; caution: ring and moon; void: the ring)
 *          A U T H E N T I C         the word, 30 px
 *         FIRST REGISTRATION         its sub-title, when the server's title has one
 *   one sentence from the server
 *   Buying this piece? …             AUTHENTIC — REGISTERED only (J-02), in ivory, then I HAVE A TRANSFER CODE, a
 *     I HAVE A TRANSFER CODE         text link to OWNERSHIP, RECEIVING THIS PIECE
 *            GENOME
 *       ◔ · ◯ · ◕ · …               core renderGenomeSvg orbit, in ivory, the ORBES monogram at its centre (decision 12)
 *          O26-J-00184
 *   G1-E1DC-BE52 · GENOME-01
 *   [ THE MODEL's photograph ]       full width, shown whole, never the piece's own (decision 9)
 *   THE MODEL
 *   Photographed by ORBES. Compare it with the piece in your hands.
 *           MONOLITHE                the model's name, then its lines: BRACELET / JEWELRY / 925 STERLING SILVER /
 *           BRACELET …               SIZE 17 / CREATED 2026 / DISCONTINUED · 2027 (P-R06)
 *         SEE THE MODEL              its model's sheet in THE COLLECTION (P-R02), when it is PUBLIC
 *   PRODUCT  WARRANTY  CARE  OWNERSHIP   underlined tabs (`.tabsx`), registration opening on OWNERSHIP
 *   This verification confirms …     the assurance note (positive results)
 *   VERIFIED 5 OCT 2026 · 18:49    REF 54ADC7BD
 *   [ SCAN ANOTHER ]                 the hairline button
 *   (the header, the rail and the SCAN ring above and below: views/shell.ts; the footer with the legal pages and DB-IP)
 *
 * Other results show no product lines and no tabs: the GENOME when the server sends it, a line for ORBES Client
 * Services (the reference below is attached to the message) and WRITE TO ORBES CLIENT SERVICES (plan NEXT-NINE, CS-01:
 * the write sheet, the scan attached) (C15, C16); UNUSUAL ACTIVITY adds, when the server offers it, the section DO YOU HOLD
 * THE CERTIFICATE CARD? (registration with the claim code) or DO YOU HOLD A TRANSFER CODE? (F-03: receiving the piece
 * with it); then WHERE DID YOU SEE OR BUY THIS PIECE?, an optional answer attached to the scan: open under UNUSUAL
 * ACTIVITY (C15), a row that opens (+) under the others (C16). A warranty that no longer applies offers the same button
 * in its tab, and FORGOTTEN PASSWORD? in the OWNERSHIP panel keeps the email of ORBES Client Services for a customer who
 * needs a recovery code (C-04).
 *
 * The ceremony (P-D01) is the result VIEW AS OWNER opens right after a first registration: the GENOME comes first,
 * at 220 px (C36), above the photograph; its eight glyphs appear one by one (opacity and scale of each
 * `data-layer=genome` group, delayed by its `--i`, set through the CSSOM), then the name of the model and its
 * collection, with a short vibration where the device has one. SHARE THE GENOME is a text link: its PNG is drawn
 * when the result is built (share-image.ts), so the tap shares a ready file. Under it, SHARE TO STORIES (plan
 * NEXT-NINE, BP-10): the full-width hairline button of the REGISTERED story card (story-card.ts, views/story.ts), shown
 * once its card is drawn, never without the model's photograph. With reduced motion, all of it is shown at once,
 * without motion.
 *
 * Everything shown comes from the server outcome through resultViewModel().
 */
import { h, prefersReducedMotion } from '../../shared/dom.js';
import { CEREMONY, LOOKBOOK, MESSAGES, PHOTOS, RECEIVING } from '../copy.js';
import { genomeFromModel, nocturneGenome } from '../genome-view.js';
import { lookbookSheetPath } from '../lookbook-model.js';
import { prepareShareImage, shareGenomeImage } from '../share-image.js';
import { storyCardModel, StoryCards, type StoryCardModel } from '../story-card.js';
import { initialTab, type CeremonyModel, type PhotoModel, type ResultViewModel, type TabId } from '../view-model.js';
import { viewRoot, withNumerals } from './common.js';
import { button, fadedPhoto, textLink, toneMark } from './nocturne.js';
import { OwnershipPanel, type OwnershipDeps } from './ownership.js';
import { carePanel, productPanel, warrantyPanel } from './panels.js';
import { reportSection, type ReportDeps } from './report.js';
import { storyButton } from './story.js';
import { tabsView, type TabsView } from './tabs.js';
import { writeButton } from './write.js';

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
 * The ceremony under the GENOME (P-D01, C36): the name of the model and its collection, then SHARE THE GENOME, shown
 * once its image is ready (a browser that cannot draw it offers no link). The PNG is drawn now, before any tap.
 */
function ceremonyBlock(c: CeremonyModel, glyphs: Parameters<typeof prepareShareImage>[0], alive: () => boolean, story: StoryCardModel | null): HTMLElement {
  let image: Blob | null = null;
  const share = textLink(CEREMONY.share, { onOpen: () => void (image && shareGenomeImage(image)), extraClass: 'n-ceremony__share' }) as HTMLButtonElement;
  const line = h('p', { class: 'n-ceremony__share-line', attrs: { hidden: true } }, share);
  void prepareShareImage(glyphs, c).then((blob) => {
    if (!blob || !alive()) return;
    image = blob;
    line.hidden = false;
  });
  return h(
    'section',
    { class: 'n-ctr n-px n-ceremony', attrs: { 'aria-label': CEREMONY.label } },
    h('p', { class: 'n-g n-t1 n-ceremony__name' }, ...withNumerals(c.name)),
    c.collection ? h('p', { class: 'n-g n-lb n-ceremony__collection' }, ...withNumerals(c.collection)) : null,
    line,
    // BP-10: SHARE TO STORIES under SHARE THE GENOME, its REGISTERED card drawn now, rising with it (2.8 s).
    story ? h('div', { class: 'n-ceremony__story' }, storyButton(new StoryCards().card('registered', story), story)) : null,
  );
}

/**
 * THE MODEL's photograph (decision 9), full width and whole, without the fade (as drawn), its caption, then the app's
 * sentence for it (a result, C9; a piece's page, C4). A photograph that cannot be loaded (removed meanwhile) takes its section with it: never a broken
 * image.
 */
export function modelPhoto(photos: readonly PhotoModel[], opts: { extraClass?: string } = {}): HTMLElement | null {
  const photo = photos[0];
  if (!photo) return null;
  const frame = fadedPhoto(photo.src, photo.alt, { fade: false, eager: true, extraClass: 'n-result__photo' });
  const section = h(
    'section',
    { class: ['n-result__model', opts.extraClass], attrs: { 'aria-label': 'Photograph of the model' } },
    frame,
    h('div', { class: 'n-cap2' }, h('span', { class: 'n-g n-lb n-result__caption', text: photo.caption })),
    h('p', { class: 'n-px n-sm n-result__photo-note', text: PHOTOS.note(1) }),
  );
  frame.querySelector('img')?.addEventListener('error', () => (section.hidden = true), { once: true });
  return section;
}

export function resultView(vm: ResultViewModel, handlers: ResultHandlers): ResultView {
  const root = viewRoot('result', 'result-title');
  root.classList.add('n-result');
  root.dataset.state = vm.state;
  root.dataset.tone = vm.tone;
  let ownership: OwnershipPanel | null = null;
  let tabs: TabsView | null = null;
  let disposed = false;
  // P-D01: the ceremony needs a GENOME the page can draw faithfully (the same check as its figure).
  const ceremonyGenome = vm.ceremony && vm.genome ? genomeFromModel(vm.genome) : null;
  const ceremony = vm.ceremony && ceremonyGenome ? vm.ceremony : null;
  let ceremonyNames: HTMLElement | null = null;
  let vibration: (() => void) | null = null;
  const panelOf = (): OwnershipPanel =>
    new OwnershipPanel(vm.ownership, { ...handlers.ownership, onRescan: handlers.onScanAgain, onRefresh: handlers.onRefresh, contact: vm.recoveryContact });

  // The link under the second-hand guidance (J-02): the OWNERSHIP tab, on RECEIVING THIS PIECE (or on the tab itself
  // when the panel no longer shows that section, once the piece has been received).
  const openNoticeLink = (tab: TabId): void => {
    // Selecting the tab builds its panel on first selection.
    tabs?.select(tab);
    if (tab === 'ownership' && ownership?.showReceiving()) return;
    tabs?.select(tab, true);
  };

  const head = h(
    'section',
    { class: 'n-ctr n-result__head', attrs: { 'aria-label': 'Result' } },
    toneMark(vm.tone),
    h(
      'h1',
      { class: 'n-g n-result__title', id: 'result-title' },
      h('span', { class: 'n-result__word', text: vm.titleMain }),
      vm.titleSub ? h('span', { class: 'n-g n-lb n-result__sub', text: vm.titleSub }) : null,
    ),
    vm.message ? h('p', { class: 'n-px n-tx n-result__message', text: vm.message }) : null,
  );

  // Under the message (C13): the second-hand guidance in ivory, then I HAVE A TRANSFER CODE; or the owner's notice.
  const notice = vm.notice
    ? h(
        'div',
        { class: 'n-px n-ctr n-result__notice-block' },
        h('p', { class: 'n-tx n-ivc n-result__notice', attrs: { role: 'note' }, text: vm.notice }),
        vm.noticeLink ? h('p', { class: 'n-result__notice-line' }, textLink(vm.noticeLink.label, { onOpen: () => openNoticeLink(vm.noticeLink!.tab), extraClass: 'n-result__notice-link' })) : null,
      )
    : null;

  const sections: (HTMLElement | null)[] = [head, notice];
  let genome: HTMLElement | null = null;
  if (vm.genome) {
    genome = nocturneGenome(vm.genome, { size: ceremony ? 220 : 200, extraClass: 'n-result__genome' });
    if (ceremony && ceremonyGenome) {
      const block = ceremonyBlock(ceremony, ceremonyGenome, () => !disposed, vm.story ? storyCardModel('registered', vm.story) : null);
      ceremonyNames = block.querySelector<HTMLElement>('.n-ceremony__name');
      genome = h('div', { class: 'n-result__ceremony' }, genome, block);
      if (!prefersReducedMotion()) {
        // Each glyph of the orbit is one group of the layer genome, in order (glyph 0 at north, then clockwise).
        root.classList.add('is-ceremony');
        genome.querySelectorAll<SVGGElement>('.genome-svg g[data-layer="genome"]').forEach((g, i) => g.style.setProperty('--i', String(i)));
      }
    }
  }
  // The GENOME first, then THE MODEL's photograph (C9); the ceremony opens on the GENOME too.
  sections.push(genome, modelPhoto(vm.photos));

  if (vm.modelName || vm.pieceLines.length > 0) {
    const slug = vm.lookbook;
    sections.push(
      h(
        'section',
        { class: 'n-ctr n-result__lines', attrs: { 'aria-label': 'The piece' } },
        vm.modelName ? h('h2', { class: 'n-g n-t1 n-result__name' }, ...withNumerals(vm.modelName)) : null,
        h('ul', { class: 'n-lines n-result__line-list' }, ...vm.pieceLines.map((line) => h('li', { class: 'n-g n-lines__line' }, ...withNumerals(line)))),
        // Under the lines that name the model: its sheet in THE COLLECTION, a text link (the hairline button stays the foot's).
        slug
          ? h('p', { class: 'n-result__model-line' }, textLink(LOOKBOOK.seeModel, { href: lookbookSheetPath(slug), onOpen: handlers.onModel ? () => handlers.onModel!(slug) : undefined, extraClass: 'n-result__model-link' }))
          : null,
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
          ownership = panelOf();
          return h('div', { class: 'n-result__panel' }, ownership.root);
      }
    };
    // Registration, and the transfer of a piece to its recipient (F-03), open straight on OWNERSHIP.
    tabs = tabsView(vm.tabs, build, initialTab(vm), { kind: 'tabsx' });
    tabs.root.classList.add('n-px', 'n-result__tabs');
    sections.push(tabs.root);
  } else if (vm.tone !== 'authentic') {
    // The help line, then WRITE TO ORBES CLIENT SERVICES, the scan attached (CS-01).
    sections.push(
      h(
        'section',
        { class: ['n-px', 'n-result__help', vm.genome ? null : 'n-result__help--first'], attrs: { 'aria-label': 'ORBES Client Services' } },
        h('p', { class: 'n-tx', text: MESSAGES.help }),
        vm.write?.placement === 'help' ? writeButton(vm.write.context) : null,
      ),
    );
    // UNUSUAL ACTIVITY with a registration token (the server's step 10 exception): the buyer holding
    // the certificate card may still register, with its claim code. Sign-in, then the claim code; no product data.
    if (vm.ownership.kind === 'register') {
      ownership = panelOf();
      sections.push(
        h(
          'section',
          { class: 'n-px n-sec n-result__card', attrs: { 'aria-labelledby': 'card-title' } },
          h('h2', { class: 'n-g n-t3 n-result__card-title', id: 'card-title', text: 'DO YOU HOLD THE CERTIFICATE CARD?' }),
          h('p', {
            class: 'n-tx n-result__card-text',
            text: 'If this piece was delivered to you with its ORBES certificate card, you may register it in your name with the claim code printed under the scratch-off panel.',
          }),
          ownership.root,
        ),
      );
    }
    // UNUSUAL ACTIVITY with a transfer window (F-03, the same exception for a transfer): the reader signed in when the
    // scan was made may still receive the piece with the transfer code its owner gave. No product data.
    if (vm.ownership.kind === 'registered' && vm.ownership.underReview === true) {
      ownership = panelOf();
      sections.push(
        h(
          'section',
          { class: 'n-px n-sec n-result__card', attrs: { 'aria-labelledby': 'transfer-card-title' } },
          h('h2', { class: 'n-g n-t3 n-result__card-title', id: 'transfer-card-title', text: RECEIVING.cardTitle }),
          h('p', { class: 'n-tx n-result__card-text', text: RECEIVING.cardText }),
          ownership.root,
        ),
      );
    }
    // Under the contact (and under the certificate-card or transfer-code section when there is one, which follows the
    // help line): where the piece was seen or bought, attached to this scan. Optional: open under UNUSUAL ACTIVITY
    // (C15), a row that opens under the other results (C16).
    if (vm.report && handlers.report) sections.push(reportSection(vm.report, handlers.report, { folded: vm.state !== 'SUSPICIOUS_ACTIVITY' }));
  }

  const meta = (label: string, value: string): HTMLElement =>
    h('span', { class: 'n-g n-lb n-result__meta-item' }, `${label} `, h('span', { class: 'n-num n-ivc n-result__meta-value', text: value }));
  const foot = h(
    'footer',
    { class: 'n-result__foot' },
    vm.footnote ? h('p', { class: 'n-px n-sm n-result__footnote', text: vm.footnote }) : null,
    h('p', { class: 'n-px n-sb n-result__meta' }, vm.verifiedAt ? meta('VERIFIED', vm.verifiedAt) : null, vm.reference ? meta('REF', vm.reference) : null),
    h('div', { class: 'n-px n-result__again' }, button(vm.tone === 'authentic' ? 'SCAN ANOTHER' : 'SCAN AGAIN', { outline: true, onClick: () => handlers.onScanAgain() })),
  );

  root.append(...sections.filter((x): x is HTMLElement => x !== null), foot);

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
