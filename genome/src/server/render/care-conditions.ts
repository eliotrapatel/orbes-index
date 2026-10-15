/**
 * The ORBES CARE conditions as a PDF (plan ORBES CARE of 2026-10-15, answer 14, step 1.9): the terms' warranty article,
 * article 11, in the version in force, given with every order in its DOCUMENTS in MY PIECES, next to its invoice
 * (GET /api/v1/account/orders/:id/care-conditions.pdf, services/orders.ts careConditions). No printed card goes in the
 * box: this document is the written conditions.
 *
 * Its text lives here, in the server: the production image copies only src/core, src/shared and src/server
 * (Dockerfile), so the server cannot read the published terms (src/web/legal/content/terms.ts). CARE_CONDITIONS holds
 * article 11 in English and in French as the terms publish it: its title and its bold-led paragraphs, the review line
 * (*Code: …*) left out as the published page leaves it, the link to the legal notice as its words.
 * test/web/legal.content.test.ts holds it to terms.ts article 11, block by block, and CARE_CONDITIONS_VERSION to
 * LEGAL_VERSION (the terms publish it since step 4.1).
 *
 * A4, black on white, on the invoice's grid (./invoice.ts): the word ORBES, ORBES CARE CONDITIONS and the monogram;
 * VERSION (the version's date) and ORDER (the order it is given with); then ARTICLE 11 - ORBES CARE AND THE WARRANTIES
 * and its paragraphs, then ARTICLE 11 - ORBES CARE ET GARANTIES and its own, each paragraph wrapped to the column and
 * continued page after page as a supplier order's lines are (./supplier-order.ts), each page with its foot and
 * PAGE n OF m. As every ORBES document: lettering stroked from ./label-font.ts (capitals, accents dropped: the French
 * prints without its accents, the house's lettering having no font), no font in the file. Deterministic for one input
 * (the PDF's dates are the version's). `careConditionsTexts` gives the text each page draws, in order (the tests read
 * it, the lettering being outlines).
 */
import { MONOGRAM_BOUNDS, monogramPathData } from '../../core/render/monogram.js';
import { CertificateInputError, fmt, INK, longDate, MIN_STROKE_MM, PDF_TYPE, stroked } from './certificate.js';
import { INVOICE_LAYOUT } from './invoice.js';
import { measureText, textRun, toArticleText } from './label-font.js';
import { renderPdf, type PdfPage } from './pdf.js';
import { SHEET_PAGES } from './print-sheet.js';
import type { StrokePath } from './scene.js';

/** Article 11 in one language: its title and its paragraphs, each led by its bold words (`**Start.** …`). */
export interface CareConditionsArticle {
  title: string;
  blocks: readonly string[];
}

/**
 * The version of the terms in force, whose article 11 this file holds (YYYY-MM-DD): the date the PDF prints and its
 * file's date. It moves with LEGAL_VERSION (src/web/legal/content/index.ts): test/web/legal.content.test.ts holds the
 * two equal.
 */
export const CARE_CONDITIONS_VERSION = '2026-10-15';

/** Article 11 of the terms, in English and in French, as published (plan ORBES CARE §2(d)). */
export const CARE_CONDITIONS: Readonly<{ en: CareConditionsArticle; fr: CareConditionsArticle }> = Object.freeze({
  en: Object.freeze({
    title: 'Article 11 — ORBES CARE and the warranties',
    blocks: Object.freeze([
      '**ORBES CARE.** ORBES CARE is what ORBES gives a piece after its sale: its ORBES warranty, PRIVATE CARE, the care guide of its model and ORBES Client Services. MY PIECES presents it in the ORBES CARE tab of each piece. ORBES CARE is free of charge: no part of it is sold.',
      '**Two warranties.** Each piece has one of two ORBES warranties: the **lifetime warranty** (part A), for jewelry and for accessories other than leather goods (cufflinks, key rings…), or the **2-year warranty** (part B), for every other piece, leather goods among them. The ORBES CARE tab of each piece shows which one it has: ACTIVE · LIFETIME, or the date its warranty ends. Parts A and B each have their own rules; the rest of this article applies to both.',
      '**Guarantor.** The ORBES warranties are given free of charge by CONGLOMERAT LLC, 30 N Gould St, Ste N, Sheridan, WY 82801, United States, whose full identity is given in the legal notice, and reached through ORBES Client Services.',
      "**Start.** An ORBES warranty starts when ORBES, or an authorised retailer listed in the ORBES register of points of sale, activates it, on the date of purchase. In a boutique, the seller activates the warranty within 10 minutes of their scan of the piece, on the day's date and in the country of the point of sale.",
      "**How to claim.** Only the registered owner of the piece may claim under its warranty. They write to ORBES Client Services from the piece in MY PIECES (WRITE TO ORBES CLIENT SERVICES). ORBES Client Services sends a prepaid label, which the owner downloads from the ORBES CARE tab of the piece: the piece is always sent back to ORBES first, at ORBES's cost. ORBES examines it and answers in MESSAGES; the ORBES CARE tab shows where the claim stands and its outcome.",
      '**Follow-up.** The service shows the status of the warranty of each piece. The warranty stays with the piece when it changes hands; its registered owner at the time makes the claim.',
      '**A. The lifetime warranty.** It lasts for the life of the piece.',
      '**A.1 What it covers.** If the piece tarnishes, fades or breaks by accident, ORBES replaces it.',
      '**A.2 What it does not cover.** A piece that is lost, or whose theft is reported; a piece scratched, damaged on purpose or damaged by someone else; a piece altered or repaired outside ORBES.',
      "**A.3 What ORBES does.** When the claim is accepted, ORBES sends the same piece, new, once it has received the piece claimed for. The identity of the piece replaced is closed, and the new piece is registered with its own certificate card. If the model is no longer made, ORBES gives instead a credit of the piece's value toward a new piece. The piece's value is the price ORBES sold it at, or else the price of its model at ORBES on the day of the decision, in the currency of that price.",
      "**A.4 One free replacement.** Each piece has, from its original purchase, one free replacement, or the credit of its value. A replacement piece continues the piece it replaces and opens no free replacement of its own. After the free replacement, an accepted claim gives a credit of 30 % of the piece's value toward a new piece, and the piece is returned to its owner.",
      "**A.5 Credits.** A credit given under the lifetime warranty is valid 12 months, in the currency of the piece's value, and ORBES Client Services takes it off the invoice of a piece bought in that currency, on the orders the credits of the tiers apply to (article 12). It is never paid out in money.",
      '**A.6 Refusal.** ORBES declines a claim under the lifetime warranty only for a reason this part gives: a case it does not cover, a warranty voided, or a piece that shows no tarnish, fading or accidental break. It always says which.',
      '**B. The 2-year warranty.** It lasts 2 years from its start and ends on the date MY PIECES shows.',
      "**B.1 What it covers.** Manufacturing defects only. When the claim is accepted, ORBES repairs the piece or, when it cannot be repaired, replaces it with the same piece, new, once it has received the piece claimed for. A repaired piece is returned to its owner at ORBES's cost. The identity of a piece replaced is closed; the new piece is registered with its own certificate card and has its own 2-year warranty from the day ORBES sends it.",
      "**B.2 What it does not cover.** Anything that is not a manufacturing defect, among others wear, an accident, a scratch or damage, a piece lost or whose theft is reported. The 2-year warranty gives no credit and no free replacement: those are the lifetime warranty's (part A).",
      '**B.3 Refusal.** ORBES declines a claim under the 2-year warranty only for a reason this part gives: a piece that shows no manufacturing defect, a piece lost or whose theft is reported, a warranty ended or voided. It always says which.',
      '**Territory.** The ORBES warranties apply in every country where ORBES or an authorised retailer sells its pieces.',
      '**PRIVATE CARE.** From PLATINE (article 12), the pieces of an account have PRIVATE CARE: an inspection, a cleaning and a polishing of each piece by ORBES, free of charge, once a year each, asked for from the piece in MY PIECES, with a prepaid label both ways. It is a benefit of the tiers: THE CLUB describes it, and article 12 applies to it.',
      '**Your rights by law.** The ORBES warranties add to your rights and never take their place. Whatever they say, the seller owes the legal guarantee of conformity (articles L. 217-3 to L. 217-20 of the French Consumer Code, 2 years from delivery) and the guarantee against hidden defects (articles 1641 to 1648 and 2232 of the French Civil Code). These legal guarantees do not depend on registering the piece, nor on an ORBES account: the buyer claims them from the seller. A claim handled under the legal guarantee never uses the free replacement of the lifetime warranty, and is never settled by a credit.',
      '**Written conditions.** These conditions are given with each order, in English and in French, as a PDF in the DOCUMENTS of the order in MY PIECES, next to its invoice (ORBES CARE CONDITIONS), and stay published here.',
    ]),
  }),
  fr: Object.freeze({
    title: 'Article 11 — ORBES CARE et garanties',
    blocks: Object.freeze([
      "**ORBES CARE.** ORBES CARE réunit ce qu'ORBES donne à une pièce après sa vente : sa garantie ORBES, PRIVATE CARE, le guide d'entretien de son modèle et ORBES Client Services. MY PIECES le présente dans l'onglet ORBES CARE de chaque pièce. ORBES CARE est gratuit : rien n'y est vendu.",
      "**Deux garanties.** Chaque pièce a l'une des deux garanties ORBES : la **garantie à vie** (partie A), pour les bijoux et les accessoires autres que la maroquinerie (boutons de manchette, porte-clés…), ou la **garantie de 2 ans** (partie B), pour toute autre pièce, dont la maroquinerie. L'onglet ORBES CARE de chaque pièce indique laquelle elle a : ACTIVE · LIFETIME, ou la date de fin de sa garantie. Les parties A et B ont chacune leurs règles ; le reste de cet article s'applique aux deux.",
      "**Garant.** Les garanties ORBES sont accordées gratuitement par CONGLOMERAT LLC, 30 N Gould St, Ste N, Sheridan, WY 82801, États-Unis, dont l'identité complète figure dans les mentions légales, joignable par ORBES Client Services.",
      "**Début.** Une garantie ORBES commence à son activation par ORBES ou par un détaillant agréé inscrit au registre des points de vente d'ORBES, à la date d'achat. En boutique, le vendeur active la garantie dans les 10 minutes qui suivent son scan de la pièce, à la date du jour et au pays du point de vente.",
      "**Faire jouer la garantie.** Seul le propriétaire enregistré de la pièce peut faire jouer sa garantie. Il écrit à ORBES Client Services depuis la pièce dans MY PIECES (WRITE TO ORBES CLIENT SERVICES). ORBES Client Services lui envoie une étiquette prépayée, qu'il télécharge dans l'onglet ORBES CARE de la pièce : la pièce est toujours renvoyée d'abord à ORBES, aux frais d'ORBES. ORBES l'examine et répond dans MESSAGES ; l'onglet ORBES CARE indique où en est la demande et son issue.",
      "**Suivi.** Le service affiche l'état de la garantie de chaque pièce. La garantie reste attachée à la pièce quand celle-ci change de propriétaire ; son propriétaire enregistré du moment fait jouer la garantie.",
      '**A. La garantie à vie.** Elle dure toute la vie de la pièce.',
      "**A.1 Ce qu'elle couvre.** Si la pièce se ternit, se décolore ou se casse par accident, ORBES la remplace.",
      "**A.2 Ce qu'elle ne couvre pas.** Une pièce perdue, ou dont le vol est déclaré ; une pièce rayée, abîmée volontairement ou abîmée par un tiers ; une pièce modifiée ou réparée hors d'ORBES.",
      "**A.3 Ce que fait ORBES.** Quand la demande est acceptée, ORBES envoie la même pièce, neuve, une fois la pièce reçue. L'identité de la pièce remplacée est close, et la nouvelle pièce s'enregistre avec sa propre carte certificat. Si le modèle n'est plus fabriqué, ORBES accorde à la place un crédit de la valeur de la pièce, à valoir sur une nouvelle pièce. La valeur de la pièce est le prix auquel ORBES l'a vendue, ou à défaut le prix de son modèle chez ORBES le jour de la décision, dans la devise de ce prix.",
      "**A.4 Un remplacement offert.** Chaque pièce a, depuis son achat d'origine, un remplacement offert, ou le crédit de sa valeur. Une pièce de remplacement prolonge celle qu'elle remplace et n'ouvre pas de remplacement offert à son tour. Après le remplacement offert, une demande acceptée donne un crédit de 30 % de la valeur de la pièce, à valoir sur une nouvelle pièce, et la pièce est rendue à son propriétaire.",
      "**A.5 Crédits.** Un crédit accordé au titre de la garantie à vie vaut 12 mois, dans la devise de la valeur de la pièce ; ORBES Client Services le déduit de la facture d'une pièce achetée dans cette devise, sur les commandes auxquelles s'appliquent les crédits des paliers (article 12). Il n'est jamais versé en argent.",
      "**A.6 Refus.** ORBES ne refuse une demande au titre de la garantie à vie que pour un motif que donne cette partie : un cas qu'elle ne couvre pas, une garantie annulée, ou une pièce qui n'est ni ternie, ni décolorée, ni cassée par accident. ORBES dit toujours lequel.",
      "**B. La garantie de 2 ans.** Elle dure 2 ans à compter de son début et prend fin à la date qu'affiche MY PIECES.",
      "**B.1 Ce qu'elle couvre.** Les seuls défauts de fabrication. Quand la demande est acceptée, ORBES répare la pièce ou, si elle ne peut être réparée, la remplace par la même pièce, neuve, une fois la pièce reçue. Une pièce réparée est rendue à son propriétaire aux frais d'ORBES. L'identité d'une pièce remplacée est close ; la nouvelle pièce s'enregistre avec sa propre carte certificat et a sa propre garantie de 2 ans à compter du jour où ORBES l'envoie.",
      "**B.2 Ce qu'elle ne couvre pas.** Tout ce qui n'est pas un défaut de fabrication, notamment l'usure, un accident, une rayure ou un dommage, une pièce perdue ou dont le vol est déclaré. La garantie de 2 ans ne donne ni crédit ni remplacement offert : ils relèvent de la garantie à vie (partie A).",
      '**B.3 Refus.** ORBES ne refuse une demande au titre de la garantie de 2 ans que pour un motif que donne cette partie : une pièce sans défaut de fabrication, une pièce perdue ou dont le vol est déclaré, une garantie terminée ou annulée. ORBES dit toujours lequel.',
      "**Territoire.** Les garanties ORBES s'appliquent dans chaque pays où ORBES ou un détaillant agréé vend ses pièces.",
      "**PRIVATE CARE.** À partir de PLATINE (article 12), les pièces d'un compte ont PRIVATE CARE : une inspection, un nettoyage et un polissage de chaque pièce par ORBES, gratuits, une fois par an chacune, demandés depuis la pièce dans MY PIECES, avec une étiquette prépayée à l'aller et au retour. C'est un avantage des paliers : THE CLUB le décrit, et l'article 12 s'y applique.",
      "**Vos droits légaux.** Les garanties ORBES s'ajoutent à vos droits et ne les remplacent jamais. Quoi qu'elles disent, le vendeur reste tenu de la garantie légale de conformité (articles L. 217-3 à L. 217-20 du Code de la consommation, 2 ans à compter de la délivrance) et de la garantie des vices cachés (articles 1641 à 1648 et 2232 du Code civil). Ces garanties légales ne dépendent ni de l'enregistrement de la pièce ni d'un compte ORBES : l'acheteur les fait valoir auprès du vendeur. Une demande traitée au titre de la garantie légale n'use jamais le remplacement offert de la garantie à vie, et n'est jamais réglée par un crédit.",
      '**Conditions écrites.** Ces conditions sont remises avec chaque commande, en anglais et en français, en PDF dans les DOCUMENTS de la commande dans MY PIECES, à côté de sa facture (ORBES CARE CONDITIONS), et restent publiées ici.',
    ]),
  }),
});

/** What a care conditions PDF prints besides the article: the order it is given with. */
export interface CareConditionsDocument {
  /** `OR-1A2B3C4D` (services/orders.ts orderReference). */
  orderReference: string;
}

/** The fixed lettering (house voice: capitals, tracked). */
export const CARE_CONDITIONS_COPY = Object.freeze({
  title: 'ORBES CARE CONDITIONS',
  rows: Object.freeze({ version: 'VERSION', order: 'ORDER' }),
  page: (n: number, of: number) => `PAGE ${n} OF ${of}`,
  foot: 'ORBES · THEORBES.COM',
});

/** Page geometry in millimetres (A4 portrait, y down), on the invoice's grid. */
export const CARE_CONDITIONS_LAYOUT = Object.freeze({
  page: 'A4' as const,
  left: 22,
  right: 188,
  /** VERSION and ORDER, as an invoice's facts: label, then value at `valueOffset`. */
  facts: { x: 22, first: 58, valueOffset: 26 },
  ruleFacts: 70,
  /** The first baseline of the article on the first page, and on the pages after it (under their head). */
  first: 82,
  nextFirst: 58,
  /** The last baseline of a page, at most. */
  last: 276,
  /** An article's title: the room left above it after a paragraph, and from its baseline to its first line. */
  heading: { cap: 1.8, tracking: 0.5, before: 6, after: 7.5 },
  /** A paragraph's lines, and the room added between two paragraphs. */
  body: { cap: 1.45, tracking: 0.18, pitch: 3.6, paragraph: 2.2 },
  foot: { baseline: 287 },
});

const ORDER_RE = /^OR-[0-9A-F]{8}$/;

/** A paragraph as the lettering draws it: its bold marks dropped, accents dropped, capitals, its ellipsis '...'. */
export function careConditionsParagraph(block: string): string {
  return toArticleText(block.replace(/\*\*/g, ''));
}

/** Lettered text in lines of at most `width` mm at the body's size, cut between words (a word wider than the line alone on its own). */
export function wrapArticleText(text: string, width: number = CARE_CONDITIONS_LAYOUT.right - CARE_CONDITIONS_LAYOUT.left): string[] {
  const B = CARE_CONDITIONS_LAYOUT.body;
  const fits = (t: string) => measureText(t, B.tracking) * B.cap <= width;
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(' ').filter((x) => x.length > 0)) {
    const next = line ? `${line} ${w}` : w;
    if (line && !fits(next)) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

interface Drawn {
  text: string;
  cap: number;
  tracking: number;
  x: number;
  baseline: number;
  align: 'start' | 'end';
}

/** What each page draws, in order: the texts and their places; the rules' heights apart. */
function pagesOf(d: CareConditionsDocument): { texts: Drawn[]; rules: number[] }[] {
  if (typeof d.orderReference !== 'string' || !ORDER_RE.test(d.orderReference)) throw new CertificateInputError('not an order reference');
  const L = CARE_CONDITIONS_LAYOUT;
  const C = CARE_CONDITIONS_COPY;
  const R = INVOICE_LAYOUT.rows;
  const B = L.body;
  const H = L.heading;
  const pages: { texts: Drawn[]; rules: number[] }[] = [];
  let page: { texts: Drawn[]; rules: number[] } = { texts: [], rules: [] };
  const put = (text: string, cap: number, tracking: number, x: number, baseline: number, align: Drawn['align'] = 'start') => page.texts.push({ text, cap, tracking, x, baseline, align });
  const head = () => {
    put(INVOICE_LAYOUT.brand.text, INVOICE_LAYOUT.brand.cap, INVOICE_LAYOUT.brand.tracking, L.left, INVOICE_LAYOUT.brand.baseline);
    put(C.title, INVOICE_LAYOUT.title.cap, INVOICE_LAYOUT.title.tracking, L.left, INVOICE_LAYOUT.title.baseline);
    page.rules.push(INVOICE_LAYOUT.ruleTop);
  };
  let y: number = L.first;
  const newPage = () => {
    pages.push(page);
    page = { texts: [], rules: [] };
    head();
    // The pages after the first name the order where the first has the monogram.
    put(d.orderReference, R.labelCap, R.labelTracking, L.right, INVOICE_LAYOUT.title.baseline, 'end');
    y = L.nextFirst;
  };

  // The first page: the head, the version and the order.
  head();
  const facts: [string, string][] = [
    [C.rows.version, longDate(CARE_CONDITIONS_VERSION)],
    [C.rows.order, d.orderReference],
  ];
  facts.forEach(([label, value], i) => {
    const baseline = L.facts.first + i * R.pitch;
    put(label, R.labelCap, R.labelTracking, L.facts.x, baseline);
    put(value, R.valueCap, R.valueTracking, L.facts.x + L.facts.valueOffset, baseline);
  });
  page.rules.push(L.ruleFacts);

  // The article in English, then in French: its title (never alone at the foot of a page), its paragraphs line by line.
  [CARE_CONDITIONS.en, CARE_CONDITIONS.fr].forEach((article, n) => {
    if (n > 0) y += H.before;
    if (y + H.after + B.pitch > L.last) newPage();
    put(toArticleText(article.title), H.cap, H.tracking, L.left, y);
    y += H.after;
    for (const block of article.blocks) {
      for (const line of wrapArticleText(careConditionsParagraph(block))) {
        if (y > L.last) newPage();
        put(line, B.cap, B.tracking, L.left, y);
        y += B.pitch;
      }
      y += B.paragraph;
    }
  });
  pages.push(page);

  // Each page's foot, and its number when there are several.
  pages.forEach((p, i) => {
    p.texts.push({ text: C.foot, cap: INVOICE_LAYOUT.foot.cap, tracking: INVOICE_LAYOUT.foot.tracking, x: L.left, baseline: L.foot.baseline, align: 'start' });
    if (pages.length > 1) p.texts.push({ text: C.page(i + 1, pages.length), cap: INVOICE_LAYOUT.foot.cap, tracking: INVOICE_LAYOUT.foot.tracking, x: L.right, baseline: L.foot.baseline, align: 'end' });
  });
  return pages;
}

/** The text each page draws, in order (the lettering is outlines: the tests read this). */
export function careConditionsTexts(d: CareConditionsDocument): string[][] {
  return pagesOf(d).map((p) => p.texts.map((t) => t.text));
}

/** The pages of the conditions. Throws CertificateInputError on an order reference it cannot print. */
export function layoutCareConditions(d: CareConditionsDocument): PdfPage[] {
  const L = CARE_CONDITIONS_LAYOUT;
  const [pw, ph] = SHEET_PAGES[L.page];
  return pagesOf(d).map((p, i) => {
    const strokes: StrokePath[] = p.texts.map((t) => stroked(textRun(t.text, { capHeight: t.cap, tracking: t.tracking, x: t.x, baseline: t.baseline, align: t.align })));
    for (const y of p.rules) strokes.push({ d: `M${fmt(L.left)} ${fmt(y)}L${fmt(L.right)} ${fmt(y)}`, width: MIN_STROKE_MM });
    const shapes =
      i === 0
        ? (() => {
            const mh = INVOICE_LAYOUT.monogram.bottom - INVOICE_LAYOUT.monogram.top;
            const mw = (mh * MONOGRAM_BOUNDS.w) / MONOGRAM_BOUNDS.h;
            return monogramPathData({ x: L.right - mw, y: INVOICE_LAYOUT.monogram.top, width: mw }).map((m) => ({ d: m, color: INK }));
          })()
        : [];
    return { widthMm: pw, heightMm: ph, placements: [], marks: strokes, markColor: INK, shapes };
  });
}

/** The file of an order's conditions: `ORBES-CARE-CONDITIONS-OR-1A2B3C4D.pdf`. */
export function careConditionsFilename(orderReference: string): string {
  return `ORBES-CARE-CONDITIONS-${orderReference}.pdf`;
}

/** The ORBES CARE conditions of an order as an A4 PDF (RGB: a document). Deterministic for one input. */
export async function renderCareConditionsPdf(d: CareConditionsDocument): Promise<{ contentType: string; body: Uint8Array; filename: string }> {
  const pages = layoutCareConditions(d);
  const body = await renderPdf(pages, {
    title: `${CARE_CONDITIONS_COPY.title} ${d.orderReference}`,
    subject: `The ORBES CARE conditions (article 11 of the terms, version of ${CARE_CONDITIONS_VERSION}) given with order ${d.orderReference}.`,
    keywords: ['ORBES', 'ORBES CARE conditions', d.orderReference].join(', '),
    creationDate: new Date(`${CARE_CONDITIONS_VERSION}T00:00:00.000Z`),
  });
  return { contentType: PDF_TYPE, body, filename: careConditionsFilename(d.orderReference) };
}
