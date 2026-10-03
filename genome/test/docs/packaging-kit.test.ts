/**
 * docs/launch/PACKAGING-KIT.md, the packaging text, certificate card copy,
 * French lexicon and announcement draft (FR and EN), against
 * BRAND-DESIGN-SYSTEM §4 and the code it describes:
 *
 *  - no forbidden term, English (BRAND §4.5 and §4.1) or French (the kit's
 *    own lexicon), outside the marked lexicon block, and no exclamation mark;
 *  - the lexicon quotes every term of §4.5 and at least those the brief names;
 *  - the official address in every part, the "verify only" mention in both
 *    languages, and no other web address;
 *  - the three steps and the "verify only" line word for word as the
 *    certificate card draws them (CERTIFICATE_COPY), so card and packaging
 *    never drift apart;
 *  - the second-hand sentence (J-02) in both languages, its English the very
 *    RESALE_GUIDANCE that /verify shows under AUTHENTIC — REGISTERED;
 *  - the announcement held until the H1/H2 review of COMPLIANCE §7; each of
 *    its drafts, website, social and e-mail, in both languages, says that a
 *    printed code can be copied and names ORBES Client Services (BRAND §4.6),
 *    and each social post fits in 280 characters;
 *  - the kit linked from LAUNCH §10.
 *
 * CUSTOMER_COPY lists the documents held to the lexicon; a new public-facing
 * document under docs/launch/ joins it. The staff's sales playbook
 * (docs/launch/SALES-PLAYBOOK.md, J-09) has its own test with the same terms,
 * sales-playbook.test.ts, since its code spans quote the console.
 */
import { describe, expect, it } from 'vitest';
import { CERTIFICATE_COPY } from '../../src/server/render/certificate.js';
import { RESALE_GUIDANCE } from '../../src/web/verify/copy.js';
import {
  EXTRA_FORBIDDEN_EN,
  LEXICON_BEGIN,
  LEXICON_END,
  PACKAGING_KIT,
  brandForbiddenTerms,
  findForbidden,
  forbiddenTerms,
  frenchForbiddenTerms,
  readDoc,
  section,
  splitLexicon,
} from './lexicon.js';

const CUSTOMER_COPY = [PACKAGING_KIT] as const;

const kit = readDoc(PACKAGING_KIT);
const parts = {
  packaging: section(kit, '## 1. Packaging text'),
  card: section(kit, '## 2. Certificate card'),
  resale: section(kit, '## 3. Second-hand purchase'),
  lexicon: section(kit, '## 4. French lexicon'),
  announcement: section(kit, '## 5. Announcement draft'),
};

const ADDRESS = 'theorbes.com/verify';
const VERIFY_ONLY = { en: 'Verify only at theorbes.com/verify', fr: 'Vérifiez uniquement sur theorbes.com/verify' };
/** The J-02 sentence, as /verify shows it under AUTHENTIC — REGISTERED (RESALE_GUIDANCE), and its French. */
const RESALE = {
  en: RESALE_GUIDANCE,
  fr: 'Vous achetez cette pièce ? Demandez au vendeur un code de transfert depuis son compte ORBES : seul le propriétaire enregistré de la pièce peut en créer un.',
};
/** The terms the brief names for the French lexicon. */
const BRIEF_FR = ['infalsifiable', '100 % authentique', 'certifié original', 'blockchain'];

describe('forbidden-term matcher', () => {
  it('finds whole words in either case, across spaces and hyphens, with plural and feminine endings', () => {
    const terms = ['QR', 'TAMPER-PROOF', 'volé', '100 % authentique', "propulsé par l'IA", 'crypto', 'Contact support'];
    expect(findForbidden('Scan the qr code', terms)).toHaveLength(1);
    expect(findForbidden('a tamper proof seal, TAMPER-PROOF', terms)).toHaveLength(2);
    expect(findForbidden('des pièces volées', terms)).toHaveLength(1);
    expect(findForbidden('une pièce 100 % authentique', terms)).toHaveLength(1);
    expect(findForbidden('propulsé par l’IA', terms)).toHaveLength(1);
    expect(findForbidden('please contact support', terms)).toHaveLength(1);
    // Not inside other words.
    expect(findForbidden('cryptographic signature, ORBES Client Services, SQRT, envolé', terms)).toEqual([]);
  });

  it('inflects every word of a term, not only the last', () => {
    const terms = ['code-barres', 'certifié original', 'original certifié', 'COUNTERFEIT', 'Web3'];
    for (const text of ['codes-barres', 'certifiée originale', 'certifiés originaux', 'originaux certifiés', 'counterfeiting', 'counterfeited', 'Web 3', 'web-3']) {
      expect(findForbidden(text, terms), text).toHaveLength(1);
    }
    // The kit lists the singular spelling too, so « code-barre » is caught as well.
    expect(findForbidden('un code-barre', frenchForbiddenTerms())).not.toEqual([]);
    expect(findForbidden('originality, webs, counterfeitless', terms)).toEqual([]);
  });

  it('reads the English terms from BRAND §4.5 and the French ones from the kit lexicon', () => {
    const en = brandForbiddenTerms();
    expect(en.length).toBeGreaterThanOrEqual(30);
    for (const t of ['REAL', 'GENUINE', '100 % GENUINE', 'CERTIFIED ORIGINAL', 'QR', 'blockchain', 'TAMPER-PROOF', 'WARNING', 'Contact support', 'Something went wrong']) {
      expect(en).toContain(t);
    }
    const fr = frenchForbiddenTerms();
    expect(fr.length).toBeGreaterThanOrEqual(30);
    for (const t of BRIEF_FR) expect(fr).toContain(t);
  });
});

describe('packaging kit (docs/launch/PACKAGING-KIT.md)', () => {
  it('marks exactly one lexicon block, inside the lexicon section', () => {
    expect(kit.split(LEXICON_BEGIN)).toHaveLength(2);
    expect(kit.split(LEXICON_END)).toHaveLength(2);
    expect(parts.lexicon).toContain(LEXICON_BEGIN);
    expect(parts.lexicon).toContain(LEXICON_END);
  });

  for (const doc of CUSTOMER_COPY) {
    it(`${doc}: no forbidden term, English or French, outside the marked lexicon`, () => {
      expect(findForbidden(splitLexicon(readDoc(doc)).rest, forbiddenTerms())).toEqual([]);
    });
  }

  it('quotes every term of BRAND §4.5 in its lexicon, which translates it', () => {
    const { lexicon } = splitLexicon(kit);
    const missing = [...brandForbiddenTerms(), ...EXTRA_FORBIDDEN_EN].filter((t) => findForbidden(lexicon, [t]).length === 0);
    expect(missing).toEqual([]);
  });

  it('writes no exclamation mark (BRAND §4.1)', () => {
    const text = splitLexicon(kit).rest.replace(/<!--[\s\S]*?-->/g, '');
    expect(text.match(/!(?!\[)/g) ?? []).toEqual([]);
  });

  it('teaches one address, theorbes.com/verify, on the packaging, the card and the announcement, in both languages', () => {
    for (const name of ['packaging', 'card', 'announcement'] as const) expect(parts[name], name).toContain(ADDRESS);
    for (const lang of ['en', 'fr'] as const) {
      expect(parts.packaging).toContain(VERIFY_ONLY[lang]);
      expect(parts.announcement).toContain(VERIFY_ONLY[lang]);
    }
    expect(parts.packaging).toContain(VERIFY_ONLY.fr.toUpperCase());
    // No other web address: a typo in a printed domain would send customers elsewhere.
    const hosts = new Set([...kit.matchAll(/(?<![\w.-])(?:[a-z0-9-]+\.)+(?:com|net|org|fr|eu|io|app|co|shop|store|link|ly)(?![\w-])/gi)].map((m) => m[0].toLowerCase()));
    expect([...hosts].sort()).toEqual(['theorbes.com', 'verify.theorbes.com']);
  });

  it('prints the three steps and the verify-only line word for word as the certificate card draws them', () => {
    expect(CERTIFICATE_COPY.steps).toHaveLength(3);
    for (const line of [...CERTIFICATE_COPY.steps, CERTIFICATE_COPY.verifyOnly, CERTIFICATE_COPY.claimCode]) {
      expect(parts.packaging, line).toContain(line);
      expect(parts.card, line).toContain(line);
    }
    // In order, numbered as on the card.
    const printed = CERTIFICATE_COPY.steps.map((s, i) => `${i + 1}  ${s}`).join('\n');
    expect(parts.packaging).toContain(printed);
    expect(CERTIFICATE_COPY.verifyOnly.toLowerCase()).toBe(VERIFY_ONLY.en.toLowerCase());
  });

  it('keeps the claim code off the piece and gives the second-hand sentence in English and French', () => {
    expect(parts.card).toMatch(/never on the piece/i);
    expect(parts.card).toMatch(/jamais sur la pièce/i);
    for (const lang of ['en', 'fr'] as const) {
      expect(parts.card, `card verso, ${lang}`).toContain(RESALE[lang]);
      expect(parts.resale, `§3, ${lang}`).toContain(RESALE[lang]);
    }
  });

  it('writes in §3 the very sentence /verify shows under AUTHENTIC — REGISTERED (RESALE_GUIDANCE, J-02)', () => {
    // §3's table holds the sentence once: its English cell is RESALE_GUIDANCE, nothing more, nothing less.
    const rows = parts.resale
      .split('\n')
      .filter((l) => l.startsWith('|'))
      .map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    expect(rows[0]).toEqual(['EN', 'FR']);
    expect(rows.slice(2)).toEqual([[RESALE_GUIDANCE, RESALE.fr]]);
    expect(RESALE_GUIDANCE).toBe('Buying this piece? Ask the seller for a transfer code from their ORBES account: only its registered owner can create one.');
    // And the kit names its source in the code.
    expect(kit).toContain('`RESALE_GUIDANCE`, `genome/src/web/verify/copy.ts` (J-02)');
  });

  it('holds the announcement until the H1/H2 review of COMPLIANCE §7, which names H1 and H2', () => {
    expect(parts.announcement).toContain('À publier seulement après la revue H1/H2 de COMPLIANCE §7.');
    expect(parts.announcement).toContain('Publish only after the H1/H2 review of COMPLIANCE §7.');
    const compliance = section(readDoc('docs/COMPLIANCE.md'), '## 7.');
    expect(compliance).toMatch(/^\| H1 \|/m);
    expect(compliance).toMatch(/^\| H2 \|/m);
    expect(compliance).toMatch(/before the public launch announcement/);
  });

  it('says in every draft, as BRAND §4.6 asks, that a printed code can be copied, and offers ORBES Client Services', () => {
    /** The EN and FR drafts of one channel of §5, as plain text. */
    const drafts = (channel: string) => {
      const [, en, fr, ...extra] = section(parts.announcement, channel).split(/^\*\*(?:EN|FR)\*\*$/m);
      expect(extra, channel).toEqual([]);
      return { en: en.replace(/^>\s?/gm, '').trim(), fr: fr.replace(/^>\s?/gm, '').trim() };
    };
    for (const channel of ['### Website', '### Social', '### E-mail']) {
      const { en, fr } = drafts(channel);
      expect(en, `${channel}, EN`).toContain('A printed code can be copied');
      expect(fr, `${channel}, FR`).toContain('Un code imprimé peut être copié');
      for (const draft of [en, fr]) expect(draft, channel).toContain('ORBES Client Services');
    }
    // A post is read on its own, and still fits once [DATE] holds the longest date.
    const social = drafts('### Social');
    for (const post of [social.en.replace('[DATE]', '30 September 2027'), social.fr.replace('[DATE]', '30 septembre 2027')]) {
      expect([...post].length, post).toBeLessThanOrEqual(280);
    }
  });

  it('is the packaging and website text of LAUNCH §10', () => {
    const launch = section(readDoc('docs/LAUNCH.md'), '## 10.');
    expect(launch).toContain('(launch/PACKAGING-KIT.md)');
    expect(launch).toContain(VERIFY_ONLY.en);
  });
});
