/**
 * The content of the legal pages (J-06, src/web/legal/content/) against its
 * sources:
 *
 *  - the terms of use and the legal notice against their drafts in
 *    docs/legal/ (J-04): the same sections under the same headings, and in
 *    each one the drafts' paragraphs and list items in order and word for
 *    word (link targets aside), but for what holds a field to complete
 *    ([À COMPLÉTER: …]): such a sentence or item is left out, or published
 *    with only words of its own (the company's name read as ORBES,
 *    LEGAL_IDENTITY), never a word the draft does not have; the review lines
 *    (*Code: …*) are not published, and no field to complete shows;
 *  - the privacy policy against the code: the cookies the server sets, their
 *    names and lifetimes, the IP pseudonym, the rounding of the location and
 *    DB-IP, the session's length, the scrypt hashes, the retention left unset
 *    in production, the backups' archives, the masked access log, a CSP
 *    that loads nothing from another site;
 *  - the FAQ against the code and the customer's copy: every duration and
 *    limit equals its constant, every label of the app it quotes exists, and
 *    the second-hand answer is RESALE_GUIDANCE (J-02), in French as the
 *    packaging kit translates it;
 *  - all four in both languages: the same sections, links that lead
 *    somewhere, the lexicon of BRAND §4.5 (English, and the kit's French)
 *    without exception, and no exclamation mark.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_TTL_HOURS } from '../../src/server/config.js';
import { roundCoord } from '../../src/server/geo/resolver.js';
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE_S } from '../../src/server/http/device.js';
import { CONTENT_SECURITY_POLICY } from '../../src/server/http/security.js';
import { RECOVERY_CODE_TTL_MS, TRANSFER_FREEZE_MS } from '../../src/server/services/account-recovery.js';
import { CLAIM_ATTEMPT_LIMIT, CLAIM_ATTEMPT_WINDOW_MS, TRANSFER_TTL_MS } from '../../src/server/services/ownership.js';
import { SCAN_TOKEN_TTL_MS, TRANSFER_TOKEN_TTL_MS } from '../../src/server/services/scan-tokens.js';
import { cookieName, SESSION_COOKIE } from '../../src/server/services/sessions.js';
import { RESALE_GUIDANCE_FR } from '../../src/web/legal/content/faq.js';
import { DOCUMENTS, LANGS, LANGUAGE_NAMES, WORDS, type Block, type Lang, type LegalDocument } from '../../src/web/legal/content/index.js';
import { LEGAL_IDENTITY } from '../../src/web/legal/content/notice.js';
import { parseBlock, plainText } from '../../src/web/legal/model.js';
import { LEGAL_PAGES } from '../../src/web/shared/legal.js';
import { RESALE_GUIDANCE } from '../../src/web/verify/copy.js';
import { PACKAGING_KIT, REPO, findForbidden, forbiddenTerms, readDoc, section } from '../docs/lexicon.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const PRODUCTION = { env: 'production' } as const;

const textBlocks = (doc: LegalDocument): string[] => [...doc.intro, ...doc.sections.flatMap((s) => s.blocks)].filter((b): b is string => typeof b === 'string');
/** What a page reads (its title, summary, headings and text), links and emphasis dropped. */
const readText = (doc: LegalDocument, lang: Lang): string =>
  [doc.title, doc.summary, ...doc.sections.map((s) => s.title), ...textBlocks(doc).map((b) => plainText(parseBlock(b, lang)))].join('\n');
const sectionText = (doc: LegalDocument, id: string): string => {
  const s = doc.sections.find((x) => x.id === id);
  if (!s) throw new Error(`no section ${id}`);
  return s.blocks.filter((b): b is string => typeof b === 'string').join('\n');
};

// ── The drafts of docs/legal and the way the pages publish them ────────────

interface DraftSection {
  title: string;
  blocks: string[];
}

/** A draft: its preamble's blocks, then its sections (## …), each block a paragraph or a list; the *Code: …* lines dropped. */
function parseDraft(md: string): { preamble: string[]; sections: DraftSection[] } {
  const blocksOf = (text: string) =>
    text
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0 && !/^\*Code ?: /.test(b));
  const [head, ...parts] = md.split(/^## /m);
  return {
    preamble: blocksOf(head.split('\n').slice(1).join('\n')),
    sections: parts.map((p) => {
      const [title, ...rest] = p.split('\n');
      return { title: title.trim(), blocks: blocksOf(rest.join('\n')) };
    }),
  };
}

const PLACEHOLDER = /\[À COMPLÉTER ?:([^\]]*)\]/g;
const hasPlaceholder = (s: string): boolean => s.includes('[À COMPLÉTER');
/** What a field to complete reads as on the page meanwhile: the company and its director read ORBES, the rest nothing. */
const IDENTITY: Readonly<Record<string, string>> = {
  'company name': LEGAL_IDENTITY.companyName,
  'raison sociale': LEGAL_IDENTITY.companyName,
  'name of the publication director': LEGAL_IDENTITY.publicationDirector,
  'nom du directeur de la publication': LEGAL_IDENTITY.publicationDirector,
};
const filled = (s: string): string => s.replace(PLACEHOLDER, (_, hint: string) => ` ${IDENTITY[hint.trim()] ?? ''} `);
/** The words a reader sees: a link's target is an address, not words. */
const prose = (s: string): string => s.replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1').replace(/\s+/g, ' ').trim();
const words = (s: string): string[] => prose(s).match(/[\p{L}\p{N}]+/gu) ?? [];
const isList = (block: string): boolean => block.split('\n').every((l) => l.startsWith('- '));
/** The units a block is compared by: a list's items, a paragraph's sentences (a bold lead is one). */
const units = (block: string): string[] => (isList(block) ? block.split('\n').map((l) => l.slice(2).trim()) : block.split(/(?<=[.?!](?:\*\*)?)\s+(?=\S)/).map((s) => s.trim()));
const subsequence = (short: string[], long: string[]): boolean => {
  let i = 0;
  for (const w of long) if (i < short.length && w === short[i]) i++;
  return i === short.length;
};

/** Why `published` is not `draft` as the pages publish a draft, or null when it is. */
function unitsDiffer(draft: string[], published: string[]): string | null {
  let j = 0;
  for (let i = 0; i < draft.length; i++) {
    const d = draft[i];
    const p = published[j];
    if (p !== undefined && prose(p) === prose(d)) {
      j++;
      continue;
    }
    if (!hasPlaceholder(d)) return `"${d}" is missing or changed`;
    // A sentence or item that waits for a field: left out, or kept with only its own words (the company read as ORBES).
    const laterDraft = draft.slice(i + 1).some((x) => prose(x) === prose(p ?? ''));
    if (p !== undefined && !laterDraft && !hasPlaceholder(p) && words(p).length > 0 && subsequence(words(p), words(filled(d)))) j++;
  }
  return j === published.length ? null : `"${published[j]}" is not in the draft`;
}

/** The problems of one published section against its draft: each draft block in order, a block of fields only left out. */
function sectionProblems(where: string, draft: string[], published: readonly Block[]): string[] {
  const text = published.filter((b): b is string => typeof b === 'string');
  const problems: string[] = [];
  let j = 0;
  for (const d of draft) {
    const p = text[j];
    const why = p !== undefined && isList(p) === isList(d) ? unitsDiffer(units(d), units(p)) : 'no block';
    if (why === null) {
      j++;
      continue;
    }
    if (units(d).every(hasPlaceholder)) continue;
    problems.push(`${where}: ${why}`);
  }
  if (j < text.length) problems.push(`${where}: "${text[j]}" is not in the draft`);
  return problems;
}

const DRAFTS = {
  terms: { en: parseDraft(readDoc('docs/legal/terms.en.md')), fr: parseDraft(readDoc('docs/legal/terms.fr.md')) },
  notice: { en: parseDraft(readDoc('docs/legal/legal-notice.en.md')), fr: parseDraft(readDoc('docs/legal/legal-notice.fr.md')) },
} as const;

describe('legal pages: the terms of use and the legal notice, published from their drafts (docs/legal, J-04)', () => {
  for (const page of ['terms', 'notice'] as const) {
    for (const lang of LANGS) {
      it(`${page} (${lang}): the drafts' sections, under their headings, in order`, () => {
        const doc = DOCUMENTS[page][lang];
        expect(doc.sections.map((s) => s.title)).toEqual(DRAFTS[page][lang].sections.map((s) => s.title));
      });

      it(`${page} (${lang}): every paragraph and item of the drafts, word for word, but for the fields still to complete`, () => {
        const doc = DOCUMENTS[page][lang];
        const problems = DRAFTS[page][lang].sections.flatMap((s, i) => sectionProblems(`${page}.${lang} ${s.title}`, s.blocks, doc.sections[i]?.blocks ?? []));
        expect(problems).toEqual([]);
      });
    }
  }

  it('teaches the comparison what it must refuse: a dropped clause, an invented word, a field shown as it is', () => {
    const draft = ['**Creation.** The account is created. ORBES checks nothing. [À COMPLÉTER: age, on counsel\'s advice.]'];
    expect(sectionProblems('t', draft, ['**Creation.** The account is created. ORBES checks nothing.'])).toEqual([]);
    expect(sectionProblems('t', draft, ['**Creation.** The account is created.'])).not.toEqual([]);
    expect(sectionProblems('t', draft, ['**Creation.** The account is created. ORBES checks nothing. You must be 18.'])).not.toEqual([]);
    expect(sectionProblems('t', ['Published by [À COMPLÉTER: company name] ("ORBES").'], ['Published by ORBES.'])).toEqual([]);
    expect(sectionProblems('t', ['Published by [À COMPLÉTER: company name] ("ORBES").'], ['Published by ORBES SAS.'])).not.toEqual([]);
    expect(sectionProblems('t', ['- A: [À COMPLÉTER: x]\n- B: kept'], ['- B: kept'])).toEqual([]);
    expect(sectionProblems('t', ['- A: kept\n- B: kept'], ['- B: kept'])).not.toEqual([]);
  });

  it('shows no field to complete, no review line, and reads the company as ORBES until its identity is given', () => {
    for (const page of LEGAL_PAGES) {
      for (const lang of LANGS) {
        const text = readText(DOCUMENTS[page][lang], lang);
        expect(text, `${page}.${lang}`).not.toMatch(/COMPLÉTER|\[|\]|\*Code|Brouillon|Draft for legal review|TODO|TBD/);
      }
    }
    expect(LEGAL_IDENTITY).toEqual({ companyName: 'ORBES', publicationDirector: 'ORBES' });
    // The drafts still wait for the identity: once counsel fills them, the comparison above asks for this page to follow.
    for (const lang of LANGS) expect(readDoc(`docs/legal/legal-notice.${lang}.md`)).toContain('[À COMPLÉTER');
  });

  it('opens the legal notice with the scope and the law of its draft, and names both hosts', () => {
    for (const lang of LANGS) {
      const preamble = new Set(DRAFTS.notice[lang].preamble.flatMap(units).map(prose));
      const intro = DOCUMENTS.notice[lang].intro.filter((b): b is string => typeof b === 'string').flatMap(units);
      expect(intro.length).toBeGreaterThan(1);
      for (const u of intro) expect(preamble.has(prose(u)), u).toBe(true);
      const text = readText(DOCUMENTS.notice[lang], lang);
      for (const s of ['2004-575', 'Vercel Inc.', 'OVHcloud', 'Canada', 'IP Geolocation by DB-IP']) expect(text, s).toContain(s);
    }
  });
});

// ── The privacy policy, from the code ──────────────────────────────────────

const env = readDoc('deploy/vps/.env.example');
const compose = readDoc('deploy/vps/compose.yaml');
const backup = readDoc('deploy/vps/scripts/backup.sh');

describe('legal pages: the privacy policy, written from the code', () => {
  const en = readText(DOCUMENTS.privacy.en, 'en');
  const fr = readText(DOCUMENTS.privacy.fr, 'fr');

  it('names the cookies the server sets, with their production names and lifetimes, and no other', () => {
    const device = cookieName(PRODUCTION, DEVICE_COOKIE);
    const session = cookieName(PRODUCTION, SESSION_COOKIE.account);
    const admin = cookieName(PRODUCTION, SESSION_COOKIE.admin);
    expect([device, session, admin]).toEqual(['__Host-orbes_device', '__Host-orbes_session', '__Host-orbes_admin']);
    for (const text of [en, fr]) {
      expect([...new Set(text.match(/__Host-[a-z_]+/g))].sort()).toEqual([admin, device, session]);
    }
    // The device cookie lives 2 years; a session at most 30 days.
    expect(DEVICE_COOKIE_MAX_AGE_S).toBe(2 * 365 * 24 * 3600);
    expect(sectionText(DOCUMENTS.privacy.en, 'cookies')).toContain('kept 2 years');
    expect(sectionText(DOCUMENTS.privacy.fr, 'cookies')).toContain('gardé 2 ans');
    const days = DEFAULT_SESSION_TTL_HOURS.account / 24;
    expect(days).toBe(30);
    expect(sectionText(DOCUMENTS.privacy.en, 'cookies')).toContain(`${days} days at most`);
    expect(sectionText(DOCUMENTS.privacy.fr, 'cookies')).toContain(`${days} jours au plus`);
    expect(sectionText(DOCUMENTS.privacy.en, 'account')).toContain(`session of ${days} days at most`);
    expect(sectionText(DOCUMENTS.privacy.fr, 'account')).toContain(`session de ${days} jours au plus`);
    // The server sets no other cookie: every setCookie names one of these two kinds.
    const calls = sourceFiles(join(REPO, 'genome/src/server')).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\.setCookie\(\s*([A-Za-z]+)\(/g)].map((m) => m[1]));
    expect(calls.length).toBeGreaterThan(0);
    expect([...new Set(calls)].sort()).toEqual(['deviceCookieName', 'sessionCookieName']);
  });

  it('says the IP address is kept only as a keyed hash, the location rounded to about 10 km from the local DB-IP file', () => {
    expect(en).toContain('HMAC-SHA-256');
    expect(fr).toContain('HMAC-SHA-256');
    // 0.1°: about 11 km of latitude, "about 10 km" on the page.
    for (const v of [48.8566, 2.3522, -33.8688, 151.2093]) expect(Math.abs(roundCoord(v) - v)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(roundCoord(48.8566)).toBe(48.9);
    expect(en).toContain('about 10 km');
    expect(fr).toContain('10 km environ');
    // The production stack locates scans with the DB-IP file (GEO_MODE=mmdb), installed on the server.
    expect(env).toMatch(/^GEO_MODE=mmdb$/m);
    expect(compose).toContain('GEO_MODE: ${GEO_MODE:-mmdb}');
    for (const text of [en, fr]) expect(text).toContain('IP Geolocation by DB-IP');
    // Caddy's access log masks the address (its last part), as the page says.
    const caddy = readDoc('deploy/vps/Caddyfile');
    expect(caddy).toMatch(/request>remote_ip ip_mask \{\s*ipv4 24\s*ipv6 48\s*\}/);
    expect(caddy).toMatch(/request>client_ip ip_mask \{\s*ipv4 24\s*ipv6 48\s*\}/);
  });

  it('says verifications are kept without a time limit while SCAN_RETENTION_DAYS is unset in production', () => {
    expect(env).toMatch(/^# SCAN_RETENTION_DAYS=/m);
    expect(env).not.toMatch(/^SCAN_RETENTION_DAYS=/m);
    expect(compose).toContain('SCAN_RETENTION_DAYS: ${SCAN_RETENTION_DAYS:-}');
    expect(sectionText(DOCUMENTS.privacy.en, 'retention')).toContain('no retention period has been set yet, so they are kept without a time limit');
    expect(sectionText(DOCUMENTS.privacy.fr, 'retention')).toContain("aucune durée de conservation n'est encore fixée ; elles sont donc conservées sans limite de temps");
  });

  it('dates the backups as backup.sh keeps them: 14 daily and 8 weekly archives, about two months', () => {
    expect(backup).toContain('KEEP_DAILY="$(env_get BACKUP_KEEP_DAILY 14)"');
    expect(backup).toContain('KEEP_WEEKLY="$(env_get BACKUP_KEEP_WEEKLY 8)"');
    // The production .env template keeps the same numbers.
    expect(env).toMatch(/^BACKUP_KEEP_DAILY=14$/m);
    expect(env).toMatch(/^BACKUP_KEEP_WEEKLY=8$/m);
    expect(sectionText(DOCUMENTS.privacy.en, 'retention')).toContain('encrypted: about two months');
    expect(sectionText(DOCUMENTS.privacy.fr, 'retention')).toContain('chiffrées : deux mois environ');
  });

  it('names scrypt for the hashes, a CSP that loads nothing from another site, the hosts and the rights', () => {
    expect(readDoc('genome/src/server/crypto/scrypt.ts')).toContain('scrypt$<log2 N>$<r>$<p>$<salt base64url>$<hash base64url>');
    expect(en).toContain('(scrypt)');
    expect(fr).toContain('(scrypt)');
    expect(CONTENT_SECURITY_POLICY).toMatch(/default-src 'self';/);
    expect(CONTENT_SECURITY_POLICY).toMatch(/script-src 'self';/);
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/https?:/);
    for (const [text, says] of [
      [en, ['loads no script from another site', 'Canada', 'outside the European Union', 'Vercel Inc.', 'OVHcloud', 'CNIL', 'theorbes.com/verify', 'It does not cover the other pages of theorbes.com']],
      [fr, ["ne charge aucun script d'un autre site", 'Canada', "hors de l'Union européenne", 'Vercel Inc.', 'OVHcloud', 'CNIL', 'theorbes.com/verify', 'Elle ne couvre pas les autres pages de theorbes.com']],
    ] as const) {
      for (const s of says) expect(text, s).toContain(s);
    }
  });

  it('covers what the plan names: data collected, the IP hash, the device cookie, the location, accounts, retention, hosting, DB-IP', () => {
    const ids = DOCUMENTS.privacy.en.sections.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['controller', 'verification', 'account', 'cookies', 'recipients', 'location', 'retention', 'rights']));
    // The contact of ORBES Client Services, where the page asks the reader to write to them.
    for (const lang of LANGS) expect(DOCUMENTS.privacy[lang].sections[0].blocks).toContainEqual({ contact: true });
  });
});

// ── The FAQ ────────────────────────────────────────────────────────────────

/** The French second-hand sentence, as the packaging kit's §3 table translates RESALE_GUIDANCE. */
function kitResaleFr(): string {
  const rows = section(readDoc(PACKAGING_KIT), '## 3. Second-hand purchase')
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  expect(rows[2][0]).toBe(RESALE_GUIDANCE);
  return rows[2][1];
}

describe('legal pages: the FAQ', () => {
  const faq = DOCUMENTS.faq;

  it('answers what the plan asks: a result, unusual activity, second-hand, a lost claim code, the transfer, the data', () => {
    for (const lang of LANGS) {
      expect(faq[lang].sections.map((s) => s.id)).toEqual(expect.arrayContaining(['result', 'unusual-activity', 'second-hand', 'claim-code', 'transfer', 'data']));
    }
  });

  it('opens the second-hand answer with the sentence /verify shows (RESALE_GUIDANCE, J-02), in French as the kit says it', () => {
    expect(faq.en.sections.find((s) => s.id === 'second-hand')!.blocks[0]).toBe(RESALE_GUIDANCE);
    expect(RESALE_GUIDANCE_FR).toBe(kitResaleFr());
    expect(faq.fr.sections.find((s) => s.id === 'second-hand')!.blocks[0]).toBe(RESALE_GUIDANCE_FR);
    // The FAQ module imports it, the same constant as /verify's.
    expect(readDoc('genome/src/web/legal/content/faq.ts')).toContain("import { RESALE_GUIDANCE } from '../../shared/resale.js';");
  });

  it('gives every duration and limit as the code has it', () => {
    expect(TRANSFER_TTL_MS / DAY).toBe(7);
    expect(TRANSFER_TOKEN_TTL_MS / MIN).toBe(15);
    expect(SCAN_TOKEN_TTL_MS / MIN).toBe(15);
    expect(RECOVERY_CODE_TTL_MS / MIN).toBe(30);
    expect(TRANSFER_FREEZE_MS / HOUR).toBe(72);
    expect(CLAIM_ATTEMPT_WINDOW_MS).toBe(HOUR);
    const says: Record<Lang, Record<string, string[]>> = {
      en: {
        transfer: [`valid for ${TRANSFER_TTL_MS / DAY} days`, `within ${TRANSFER_TOKEN_TTL_MS / MIN} minutes of that scan`],
        'claim-code': [`After ${CLAIM_ATTEMPT_LIMIT} wrong claim codes within an hour`],
        password: [`for ${RECOVERY_CODE_TTL_MS / MIN} minutes`, `pauses for ${TRANSFER_FREEZE_MS / HOUR} hours`],
        data: ['about 10 km'],
      },
      fr: {
        transfer: [`vaut ${TRANSFER_TTL_MS / DAY} jours`, `dans les ${TRANSFER_TOKEN_TTL_MS / MIN} minutes qui suivent ce scan`],
        'claim-code': [`Après ${CLAIM_ATTEMPT_LIMIT} claim codes erronés en une heure`],
        password: [`vaut ${RECOVERY_CODE_TTL_MS / MIN} minutes`, `pendant ${TRANSFER_FREEZE_MS / HOUR} heures`],
        data: ['10 km environ'],
      },
    };
    for (const lang of LANGS) {
      for (const [id, phrases] of Object.entries(says[lang])) {
        for (const p of phrases) expect(sectionText(faq[lang], id), `${lang} ${id}: ${p}`).toContain(p);
      }
    }
  });

  it('quotes only labels the app shows', () => {
    const app = [...sourceFiles(join(REPO, 'genome/src/web/verify')), ...sourceFiles(join(REPO, 'genome/src/server/services'))].map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const label of ['CREATE TRANSFER CODE', 'OWNERSHIP', 'MY PIECES', 'PIECE FOUND', 'FORGOTTEN PASSWORD?', 'WHERE DID YOU SEE OR BUY THIS PIECE?', 'UNUSUAL ACTIVITY DETECTED', 'AUTHENTIC — REGISTERED', 'REF']) {
      expect(app, label).toContain(label);
      expect([readText(faq.en, 'en'), readText(DOCUMENTS.privacy.en, 'en')].join('\n'), label).toContain(label);
    }
  });
});

// ── All four, both languages ───────────────────────────────────────────────

describe('legal pages: both languages, links, lexicon', () => {
  it('have the same sections in both languages, each with its own anchor', () => {
    for (const page of LEGAL_PAGES) {
      const ids = (lang: Lang) => DOCUMENTS[page][lang].sections.map((s) => s.id);
      expect(ids('fr'), page).toEqual(ids('en'));
      expect(new Set(ids('en')).size, page).toBe(ids('en').length);
      for (const id of ids('en')) expect(id, page).toMatch(/^[a-z0-9-]+$/);
      for (const lang of LANGS) {
        const doc = DOCUMENTS[page][lang];
        expect(doc.title.length, `${page}.${lang}`).toBeGreaterThan(0);
        expect(doc.summary.length, `${page}.${lang}`).toBeGreaterThan(0);
        for (const s of doc.sections) expect(s.blocks.length, `${page}.${lang} ${s.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('link only where a link leads: the legal pages, an anchor of the same page, an https address', () => {
    for (const page of LEGAL_PAGES) {
      for (const lang of LANGS) {
        const doc = DOCUMENTS[page][lang];
        const ids = new Set(doc.sections.map((s) => s.id));
        for (const block of textBlocks(doc)) {
          const written = [...block.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
          const parsed = parseBlock(block, lang);
          const runs = parsed.kind === 'list' ? parsed.items.flat() : parsed.runs;
          const links = runs.filter((r) => r.kind === 'link');
          // Every link written is a link on the page: none is refused and read as plain words.
          expect(links.length, `${page}.${lang}: ${block}`).toBe(written.length);
          for (const target of written.filter((t) => t.startsWith('#'))) expect(ids.has(target.slice(1)), `${page}.${lang}: ${target}`).toBe(true);
        }
      }
    }
  });

  it('write no word of the lexicon (BRAND §4.5, English and the kit\'s French), without exception, and no exclamation mark', () => {
    const lexicon = forbiddenTerms();
    for (const page of LEGAL_PAGES) {
      for (const lang of LANGS) {
        const text = readText(DOCUMENTS[page][lang], lang);
        expect(findForbidden(text, lexicon), `${page}.${lang}`).toEqual([]);
        expect(text.match(/!/g) ?? [], `${page}.${lang}`).toEqual([]);
      }
    }
    const chrome = LANGS.flatMap((lang) => {
      const w = WORDS[lang];
      return [w.indexTitle, w.indexLead, w.navLabel, ...Object.values(w.nav), w.languageLabel, w.version('2026-10-03'), w.verify, w.writeTo, w.call, LANGUAGE_NAMES[lang]];
    });
    expect(findForbidden(chrome.join('\n'), lexicon)).toEqual([]);
    expect(chrome.join('\n')).not.toContain('!');
  });

  it('name the pages as the /verify app links them: PRIVACY · TERMS · LEGAL · HELP', () => {
    expect(LEGAL_PAGES.map((p) => WORDS.en.nav[p])).toEqual(['PRIVACY', 'TERMS', 'LEGAL', 'HELP']);
    expect(LEGAL_PAGES.map((p) => WORDS.fr.nav[p])).toEqual(['CONFIDENTIALITÉ', 'CONDITIONS', 'MENTIONS LÉGALES', 'AIDE']);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.(ts)$/.test(e.name) ? [join(dir, e.name)] : []));
}
