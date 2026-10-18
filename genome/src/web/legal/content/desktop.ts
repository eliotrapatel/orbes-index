/**
 * Desktop (BRIEF §5.8): the lines of the legal pages written for a phone (its sound, a tap), and their words
 * on a computer, in each language. The texts themselves (DOCUMENTS, LEGAL_VERSION) are unchanged: legal/main.ts reads
 * a heading or a block through `forComputer` only when the page is shown on a computer, and a phone reads them as they
 * are. Each pair is a whole phrase found once in its text.
 */
import type { Lang } from './types.js';

export const DESKTOP_WORDING: Readonly<Record<Lang, readonly (readonly [phone: string, computer: string])[]>> = Object.freeze({
  en: Object.freeze([
    // HELP, the sound an authentic result plays: the question, and its answer (a computer starts with the sound off).
    ['Why does my phone play a sound?', 'Why does my computer play a sound?'],
    ['turns it off on this device, which keeps the choice.', 'turns it on or off on this computer, where it starts off; the computer keeps the choice.'],
    // PRIVACY, the preference kept on the device: a computer also keeps the value on.
    [
      'the value off, written only when you press SOUND OFF at the foot of the app\'s first page; pressing SOUND ON again removes it.',
      'the value off, written when you press SOUND OFF at the foot of the app\'s first page, or, on a computer, where the sound starts off, the value on, written when you press SOUND ON; on a phone, pressing SOUND ON again removes it.',
    ],
    // TERMS, article 13, your turn: held with a mouse or a trackpad on a computer, not on its screen (as the French).
    ['to press and hold, on your screen, the ORBES CODE of the room', 'to press and hold the ORBES CODE of the room'],
    // TERMS, article 13, the question after.
    ['Answering takes one tap,', 'Answering takes one click,'],
  ] as const),
  fr: Object.freeze([
    // AIDE, the sound: the question, and its answer (a computer starts with the sound off). TERMS' « d'un geste » is
    // already said for any device.
    ['Pourquoi mon téléphone joue-t-il un son ?', 'Pourquoi mon ordinateur joue-t-il un son ?'],
    ['le coupe sur cet appareil, qui garde ce choix.', "l'active ou le coupe sur cet ordinateur, où il est coupé au départ ; l'ordinateur garde ce choix."],
    // CONFIDENTIALITÉ, the preference kept on the device: a computer also keeps the value on.
    [
      "la valeur off, écrite seulement quand vous appuyez sur SOUND OFF au pied de la première page de l'application ; appuyer de nouveau sur SOUND ON l'efface.",
      "la valeur off, écrite quand vous appuyez sur SOUND OFF au pied de la première page de l'application, ou, sur un ordinateur, où le son est coupé au départ, la valeur on, écrite quand vous appuyez sur SOUND ON ; sur un téléphone, appuyer de nouveau sur SOUND ON l'efface.",
    ],
    // CONDITIONS, article 13, your turn: held with a mouse or a trackpad on a computer, not on its screen.
    ["pour appuyer à l'écran sur l'ORBES CODE de la salle", "pour appuyer sur l'ORBES CODE de la salle"],
  ] as const),
});

/** `text` in a computer's words (every pair of its language replaced), or as it is when no pair is in it. */
export function forComputer(text: string, lang: Lang): string {
  return DESKTOP_WORDING[lang].reduce((t, [phone, computer]) => (t.includes(phone) ? t.replace(phone, computer) : t), text);
}

/**
 * Desktop (BRIEF §3: reading text at its measure beside the list of its sections): the name a screen reader
 * gives the list of a page's sections, shown beside its text on a computer only (legal/main.ts sectionsNav). Its
 * entries are the sections' own headings: no other word is added.
 */
export const SECTIONS_LABEL: Readonly<Record<Lang, string>> = Object.freeze({
  en: 'The sections of this page',
  fr: 'Les sections de cette page',
});
