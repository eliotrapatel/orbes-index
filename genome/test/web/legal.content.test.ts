/**
 * The content of the legal pages (J-06, src/web/legal/content/) against its
 * sources:
 *
 *  - the terms of use and the legal notice against their drafts in
 *    docs/legal/ (J-04): the same sections under the same headings, and in
 *    each one the drafts' paragraphs and list items in order and word for
 *    word (link targets aside), but for what holds a field to complete
 *    ([À COMPLÉTER: …]): the company and the publication director read
 *    ORBES (LEGAL_IDENTITY); any other field goes with the clause that holds
 *    it (back to the comma or the full stop before it, docs/legal/README.md),
 *    or with its whole sentence, and then with the bold lead of that sentence
 *    and the sentences that refer back to it ("those conditions"): the words
 *    that still need the field are never published without it; the review
 *    lines (*Code: …*) are not published, and no field to complete shows;
 *    the terms never call the ORBES CODE "the seal" nor the GENOME a
 *    signature (BRAND §2.1);
 *  - the privacy policy against the code: the cookies the server sets, their
 *    names and lifetimes, the IP pseudonym, the rounding of the location and
 *    DB-IP, the session's length, the scrypt hashes, the retention left unset
 *    in production, the backups' archives, the masked access log, a CSP
 *    that loads nothing from another site; what a LIVE RELEASE records (the
 *    network's keyed fingerprint of its /24 or /48 and its 30 days, the
 *    country alone, an interest deleted when withdrawn, the export without
 *    the fingerprint);
 *  - the FAQ against the code and the customer's copy: every duration and
 *    limit equals its constant, every label of the app it quotes exists, and
 *    the second-hand answer is RESALE_GUIDANCE (J-02), in French as the
 *    packaging kit translates it;
 *  - all four in both languages: the same sections, links that lead
 *    somewhere, the lexicon of BRAND §4.5 (English, and the kit's French)
 *    without exception, and no exclamation mark.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_TTL_HOURS } from '../../src/server/config.js';
import { roundCoord } from '../../src/server/geo/resolver.js';
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE_S } from '../../src/server/http/device.js';
import { CONTENT_SECURITY_POLICY } from '../../src/server/http/security.js';
import { UP as LIVE_MIGRATION } from '../../src/server/db/migrations/0021_live_release.js';
import { RECOVERY_CODE_TTL_MS, TRANSFER_FREEZE_MS } from '../../src/server/services/account-recovery.js';
import { LIVE_NETWORK_RETENTION_DAYS, liveNetworkHash, liveNetworkPrefix } from '../../src/server/services/live.js';
import { CLAIM_ATTEMPT_LIMIT, CLAIM_ATTEMPT_WINDOW_MS, TRANSFER_TTL_MS } from '../../src/server/services/ownership.js';
import { SCAN_TOKEN_TTL_MS, TRANSFER_TOKEN_TTL_MS } from '../../src/server/services/scan-tokens.js';
import { cookieName, SESSION_COOKIE } from '../../src/server/services/sessions.js';
import { RESALE_GUIDANCE_FR } from '../../src/web/legal/content/faq.js';
import { DOCUMENTS, LANGS, LANGUAGE_NAMES, LEGAL_VERSION, WORDS, type Block, type Lang, type LegalDocument } from '../../src/web/legal/content/index.js';
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
/** What a field of the legal identity reads as on the page (LEGAL_IDENTITY): the drafts now name the company. */
const IDENTITY: Readonly<Record<string, string>> = {
  'company name': LEGAL_IDENTITY.companyName,
  'raison sociale': LEGAL_IDENTITY.companyName,
};
const fieldsOf = (s: string): string[] => [...s.matchAll(PLACEHOLDER)].map((m) => m[1].trim());
/** A unit whose every field is one of the legal identity, which the page reads as ORBES. */
const identityOnly = (s: string): boolean => fieldsOf(s).length > 0 && fieldsOf(s).every((f) => f in IDENTITY);
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
/** The bold lead of a clause, "**Conditions.**": a unit of its own. */
const isLead = (u: string): boolean => /^\*\*[^*]+\*\*$/.test(u.trim());
/** A sentence that points back at the one before it: what it says needs the text that one holds. */
const BACK_REFERENCE = /\b(?:those|these|such) conditions\b|\bces conditions\b/i;

/**
 * The words of a unit once each field that waits is left out with the clause that holds it, as docs/legal/README.md
 * says: the words since the comma or the full stop before it ("the client service of ORBES, reachable at […]" keeps
 * "the client service of ORBES"; "the consumer mediator […]" keeps nothing of its sentence). The company and the
 * publication director read ORBES.
 */
function withoutFields(unit: string): string[] {
  const out: string[] = [];
  let clause: string[] = [];
  for (const m of prose(unit).matchAll(/\[À COMPLÉTER ?:([^\]]*)\]|[\p{L}\p{N}]+|[,.]/gu)) {
    if (m[1] !== undefined) {
      const identity = IDENTITY[m[1].trim()];
      if (identity) clause.push(...words(identity));
      else clause = [];
    } else if (m[0] === ',' || m[0] === '.') {
      out.push(...clause);
      clause = [];
    } else clause.push(m[0]);
  }
  return [...out, ...clause];
}

/** Whether `p` is the draft unit `d`, which holds a field, as the page may publish it without that field. */
function keepsWithoutField(d: string, p: string): boolean {
  if (hasPlaceholder(p) || words(p).length === 0) return false;
  // The company read as ORBES, its parenthesis ("ORBES") left out: only the draft's own words.
  if (identityOnly(d)) return subsequence(words(p), words(filled(d)));
  const kept = withoutFields(d);
  return kept.length > 0 && kept.join(' ') === words(p).join(' ');
}

/** Why `published` is not `draft` as the pages publish a draft, or null when it is. */
function unitsDiffer(draft: string[], published: string[]): string | null {
  let j = 0;
  /** A unit holding a field was left out whole, earlier in this block. */
  let leftOut = false;
  for (let i = 0; i < draft.length; i++) {
    const d = draft[i];
    const p = published[j];
    const same = p !== undefined && prose(p) === prose(d);
    // A sentence that refers back to a sentence left out with its field goes with it.
    if (leftOut && BACK_REFERENCE.test(prose(d))) {
      if (same) return `"${p}" refers back to a sentence left out with its field`;
      continue;
    }
    if (same) {
      j++;
      continue;
    }
    if (!hasPlaceholder(d)) {
      // The bold lead of a sentence that goes whole with its field goes with it.
      const next = draft[i + 1];
      if (isLead(d) && next !== undefined && hasPlaceholder(next) && !identityOnly(next) && (p === undefined || !keepsWithoutField(next, p))) continue;
      return `"${d}" is missing or changed`;
    }
    // A unit that waits for a field: published without it (and the clause that holds it), or left out whole.
    const laterDraft = draft.slice(i + 1).some((x) => prose(x) === prose(p ?? ''));
    if (p !== undefined && !laterDraft && keepsWithoutField(d, p)) j++;
    else leftOut = true;
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
    // A block none of whose units can be published before its fields are filled is left out whole.
    if (unitsDiffer(units(d), []) === null) continue;
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
    // A field goes with the clause that holds it, back to the comma or the full stop before it…
    expect(sectionProblems('t', ['- **X**: the client service of ORBES, reachable at [À COMPLÉTER: email].'], ['- **X**: the client service of ORBES.'])).toEqual([]);
    expect(sectionProblems('t', ['- Host: Vercel Inc., Covina. Phone: [À COMPLÉTER: phone].'], ['- Host: Vercel Inc., Covina.'])).toEqual([]);
    expect(sectionProblems('t', ['- Host: Vercel Inc., Covina. Phone: [À COMPLÉTER: phone].'], ['- Host: Vercel Inc., Covina. Phone:'])).not.toEqual([]);
    // …so the words that still need it are never published without it (article 19 names no mediator).
    const mediator = ['In a dispute, turn to ORBES. You may also use, free of charge, the consumer mediator [À COMPLÉTER: name of the mediator].'];
    expect(sectionProblems('t', mediator, ['In a dispute, turn to ORBES. You may also use, free of charge, the consumer mediator.'])).not.toEqual([]);
    expect(sectionProblems('t', mediator, ['In a dispute, turn to ORBES.'])).toEqual([]);
    // A sentence that refers back to one left out with its field goes too, and so does the lead of that one (article 11).
    const warranty = ['**Conditions.** The conditions are set out in [À COMPLÉTER: document]. ORBES may void the warranty in the cases those conditions provide for. The statutory guarantees remain due.'];
    expect(sectionProblems('t', warranty, ['**Conditions.** ORBES may void the warranty in the cases those conditions provide for. The statutory guarantees remain due.'])).not.toEqual([]);
    expect(sectionProblems('t', warranty, ['ORBES may void the warranty in the cases those conditions provide for. The statutory guarantees remain due.'])).not.toEqual([]);
    expect(sectionProblems('t', warranty, ['The statutory guarantees remain due.'])).toEqual([]);
    const garantie = ["**Conditions.** Elles figurent dans [À COMPLÉTER : document]. ORBES peut annuler la garantie dans les cas que ces conditions prévoient. Les garanties légales restent dues."];
    expect(sectionProblems('t', garantie, ["**Conditions.** ORBES peut annuler la garantie dans les cas que ces conditions prévoient. Les garanties légales restent dues."])).not.toEqual([]);
    expect(sectionProblems('t', garantie, ['Les garanties légales restent dues.'])).toEqual([]);
    // A lead whose sentence is published stays.
    expect(sectionProblems('t', ['**Lead.** Kept. [À COMPLÉTER: x]'], ['Kept.'])).not.toEqual([]);
  });

  it('shows no field to complete and no review line, and names the publisher CONGLOMERAT LLC (choice 16)', () => {
    for (const page of LEGAL_PAGES) {
      for (const lang of LANGS) {
        const text = readText(DOCUMENTS[page][lang], lang);
        expect(text, `${page}.${lang}`).not.toMatch(/COMPLÉTER|\[|\]|\*Code|Brouillon|Draft for legal review|TODO|TBD/);
      }
    }
    expect(LEGAL_IDENTITY.companyName).toBe('CONGLOMERAT LLC');
    for (const lang of LANGS) {
      const notice = readText(DOCUMENTS.notice[lang], lang);
      for (const s of ['CONGLOMERAT LLC', 'Wyoming', '30 N Gould St, Ste N, Sheridan, WY 82801', 'support@theorbes.com']) expect(notice, `${lang}: ${s}`).toContain(s);
      expect(notice, lang).not.toMatch(/RCS|capital|VAT|TVA|directeur de la publication|publication director/i);
      // The hosts' details still wait in the drafts, left out of the page.
      expect(readDoc(`docs/legal/legal-notice.${lang}.md`)).toContain('[À COMPLÉTER');
    }
  });

  it('never conflates the three marks (BRAND §2.1): the ORBES CODE is not "the seal", the GENOME is no signature', () => {
    for (const page of LEGAL_PAGES) {
      for (const lang of LANGS) {
        const text = readText(DOCUMENTS[page][lang], lang);
        // "the seal" (the hardware checks say "seal" for a tamper seal, never with the article), "le sceau".
        expect(text, `${page}.${lang}`).not.toMatch(/\bthe seal\b|\bsceau\b/i);
        // The CODE's signature authenticates; the GENOME is glyphs derived from the identity.
        expect(text, `${page}.${lang}`).not.toMatch(/visual signature|signature visuelle|GENOME[^.;:\n]*\bsignature\b/i);
      }
    }
    const definition = (lang: Lang, term: string): string => {
      const item = sectionText(DOCUMENTS.terms[lang], 'article-2').split('\n').find((l) => l.startsWith(`- **${term}**`));
      if (!item) throw new Error(`no definition of ${term} (${lang})`);
      return item;
    };
    expect(definition('en', 'ORBES CODE')).toContain('the ORBES SEAL is its centre');
    expect(definition('fr', 'ORBES CODE')).toContain("l'ORBES SEAL en est le centre");
    expect(definition('en', 'ORBES identity')).toContain('eight glyphs');
    expect(definition('fr', 'Identité ORBES')).toContain('huit signes');
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

  it('says verifications are kept 90 days, the SCAN_RETENTION_DAYS the owner set in production (choice 17)', () => {
    // The template keeps it commented; the production .env sets SCAN_RETENTION_DAYS=90 (runbook §3.5).
    expect(env).toMatch(/^# SCAN_RETENTION_DAYS=/m);
    expect(env).not.toMatch(/^SCAN_RETENTION_DAYS=/m);
    expect(compose).toContain('SCAN_RETENTION_DAYS: ${SCAN_RETENTION_DAYS:-}');
    expect(sectionText(DOCUMENTS.privacy.en, 'retention')).toContain('**Verifications**: kept 90 days. Older verifications are deleted with everything attached to them');
    expect(sectionText(DOCUMENTS.privacy.fr, 'retention')).toContain("**Vérifications** : conservées 90 jours. Les vérifications plus anciennes sont supprimées avec tout ce qui s'y rattache");
    expect(readDoc('docs/launch/DEPLOY-RECOMMANDATIONS-2026-10.md')).toContain('SCAN_RETENTION_DAYS=90');
  });

  it('dates the backups as backup.sh keeps them: 14 daily and 8 weekly archives, and no event archive past 63 days, about two months', () => {
    expect(backup).toContain('KEEP_DAILY="$(env_get BACKUP_KEEP_DAILY 14)"');
    expect(backup).toContain('KEEP_WEEKLY="$(env_get BACKUP_KEEP_WEEKLY 8)"');
    // The production .env template keeps the same numbers.
    expect(env).toMatch(/^BACKUP_KEEP_DAILY=14$/m);
    expect(env).toMatch(/^BACKUP_KEEP_WEEKLY=8$/m);
    // Scheduled archives come every night, so their count bounds their age (14 days; 8 weeks and the current one).
    // Event archives (pre-deploy-*, pre-restore, post-rotation…) come at no fixed pace: their age is bounded too,
    // in daily/ and weekly/, by the age of the oldest weekly copy (genome/test/ops/vps-scripts.test.ts runs it).
    expect(backup).toContain('WEEKLY_MAX_AGE_DAYS=$((KEEP_WEEKLY * 7 + 7))');
    expect(backup).toContain('prune_old_events "$DAILY" "$WEEKLY_MAX_AGE_DAYS"');
    expect(backup).toContain('prune_old_events "$WEEKLY" "$WEEKLY_MAX_AGE_DAYS"');
    expect(backup).toMatch(/-mmin "\+\$\(\(days \* 1440\)\)"/);
    expect(8 * 7 + 7).toBe(63);
    expect(sectionText(DOCUMENTS.privacy.en, 'retention')).toContain('encrypted: about two months');
    expect(sectionText(DOCUMENTS.privacy.fr, 'retention')).toContain('chiffrées : deux mois environ');
  });

  it('says a signed-in verification records the account and a pseudonym of the session, as the verification route does', () => {
    const route = readDoc('genome/src/server/routes/public.ts');
    expect(route).toContain('meta.accountId = viewer.account.id;');
    expect(route).toContain("meta.sessionHash = pseudonymize(ctx.config.ipHashPepper, 'session', viewer.session.id);");
    expect(sectionText(DOCUMENTS.privacy.en, 'verification')).toContain('- if you are signed in to your ORBES account, that account, and a pseudonym of your session.');
    expect(sectionText(DOCUMENTS.privacy.fr, 'verification')).toContain('- si vous êtes connecté à votre compte ORBES, ce compte, et un pseudonyme de votre session.');
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

  it('says what a LIVE RELEASE records, as the code keeps it: the network as a keyed fingerprint for 30 days, the country alone', () => {
    // The network: the /24 of an IPv4 address (its first three parts), the /48 of an IPv6 one (its first three groups).
    expect(liveNetworkPrefix('203.0.113.77')).toBe('203.0.113.0/24');
    expect(liveNetworkPrefix('2001:db8:1234:5678::1')).toBe('2001:db8:1234::/48');
    // Keyed with the server's secret: one network, one fingerprint; another secret, another fingerprint; never the address.
    const a = liveNetworkHash('pepper-a', '203.0.113.77');
    expect(a).toHaveLength(32);
    expect(Buffer.from(liveNetworkHash('pepper-a', '203.0.113.200')).equals(Buffer.from(a))).toBe(true);
    expect(Buffer.from(liveNetworkHash('pepper-b', '203.0.113.77')).equals(Buffer.from(a))).toBe(false);
    expect(readDoc('genome/src/server/routes/live.ts')).toContain('networkHash: liveNetworkHash(ctx.config.ipHashPepper, request.ip), country: ctx.geo.resolve(request).country ?? null');
    // An entry keeps no address, no user agent, no coordinate: the country, two letters.
    const entries = LIVE_MIGRATION.find((sql) => sql.startsWith('CREATE TABLE live_entries'))!;
    expect(entries).toContain("country          text        NULL CHECK (country ~ '^[A-Z]{2}$')");
    expect(entries).not.toMatch(/\bip\b|ip_hash|user_agent|latitude|longitude/);
    expect(LIVE_NETWORK_RETENTION_DAYS).toBe(30);
    for (const [lang, says] of [
      ['en', ['HMAC-SHA-256 of the first three parts of an IPv4 address, or of the first three groups of an IPv6 one', `it is erased ${LIVE_NETWORK_RETENTION_DAYS} days after the end of the release`, 'never the address itself', 'Withdrawing it deletes it.', 'the fingerprint of your network excepted', 'in milliseconds']],
      ['fr', ["HMAC-SHA-256 des trois premières parties d'une adresse IPv4, ou des trois premiers groupes d'une adresse IPv6", `elle est effacée ${LIVE_NETWORK_RETENTION_DAYS} jours après la fin de la sortie`, "jamais l'adresse elle-même", 'Le retirer le supprime.', "l'empreinte de votre réseau exceptée", 'en millisecondes']],
    ] as const) {
      const text = sectionText(DOCUMENTS.privacy[lang], 'live');
      for (const s of says) expect(text, `${lang}: ${s}`).toContain(s);
    }
    expect(sectionText(DOCUMENTS.privacy.en, 'retention')).toContain(`the fingerprint of the network, ${LIVE_NETWORK_RETENTION_DAYS} days after the end of the release`);
    expect(sectionText(DOCUMENTS.privacy.fr, 'retention')).toContain(`l'empreinte du réseau, ${LIVE_NETWORK_RETENTION_DAYS} jours après la fin de la sortie`);
    // A withdrawn interest is deleted; the export leaves the network's fingerprint out, and keeps the gesture's length.
    const live = readDoc('genome/src/server/services/live.ts');
    expect(live).toContain(".deleteFrom('live_interest').where('drop_id', '=', id).where('account_id', '=', account)");
    const exported = /export interface ExportedLiveEntry \{([\s\S]*?)\n\}/.exec(live)?.[1] ?? '';
    expect(exported).toContain('gestureMs: number | null;');
    expect(exported).toContain('country: string | null;');
    expect(exported).not.toMatch(/network/i);
  });

  it('says which LIVE RELEASE actions reach the audit log, as the code records them: the account’s and the staff’s on an entry, the rest as counts', () => {
    // What the policy names, each with the `drop.live.*` action that records it.
    const NAMED: ReadonlyArray<readonly [string, string, string]> = [
      ['drop.live.interest', "I'LL BE THERE", "I'LL BE THERE"],
      ['drop.live.interest.withdraw', 'its withdrawal', 'son retrait'],
      ['drop.live.enter', 'entering', "l'entrée"],
      ['drop.live.size', 'changing size', 'le changement de taille'],
      ['drop.live.leave', 'leaving', 'le départ'],
      ['drop.live.secure', 'securing the piece with the length of your hold', 'la pièce sécurisée avec la durée de votre appui'],
      ['drop.live.addons', 'the options', 'les options'],
      ['drop.live.confirm', 'PAY', 'PAY'],
      ['drop.live.release', 'giving the piece back', 'la pièce rendue'],
      ['drop.live.let_in', 'letting you in', 'vous faire entrer'],
      ['drop.live.free', 'freeing your piece', 'libérer votre pièce'],
      ['drop.live.remove', 'removing your entry', 'retirer votre entrée'],
      ['drop.live.resolve', 'concluding or cancelling your reservation, never its note', 'conclure ou annuler votre réservation, jamais sa note'],
    ];
    // What the code records about one account: an action whose details carry the entry, or the interest's own.
    const code = ['genome/src/server/services/live.ts', 'genome/src/server/services/live-console.ts'].map(readDoc).join('\n');
    const details = new Map<string, string[]>();
    for (const m of code.matchAll(/action: '(drop\.live\.[a-z_.]+)',[\s\S]{0,200}?details: \{([^}]*)\}/g)) details.set(m[1]!, [...(details.get(m[1]!) ?? []), m[2]!]);
    const personal = [...details].filter(([action, d]) => action.startsWith('drop.live.interest') || d.some((x) => /\bentryId\b/.test(x))).map(([action]) => action);
    expect(personal.sort()).toEqual(NAMED.map(([action]) => action).sort());
    expect(details.get('drop.live.secure')!.join()).toContain('gestureMs');
    expect(details.get('drop.live.resolve')!.join()).not.toMatch(/note:/);
    // The engine's own: the line at the opening and the end, as counts, naming no entry.
    expect(details.get('drop.live.queue')).toEqual([' entries: placed.length ']);
    expect(details.get('drop.live.end')!.join()).not.toMatch(/entryId|account/);
    for (const [lang, i, counts] of [['en', 1, 'The line formed at the opening and the end of a release are written there as counts only.'], ['fr', 2, "La file formée à l'ouverture et la fin d'une sortie n'y sont inscrites qu'en nombres."]] as const) {
      const text = sectionText(DOCUMENTS.privacy[lang], 'live');
      for (const row of NAMED) expect(text, `${lang}: ${row[0]}`).toContain(row[i]);
      expect(text).toContain(counts);
    }
  });

  it('covers what the plan names: data collected, the IP hash, the device cookie, the location, accounts, retention, hosting, DB-IP', () => {
    const ids = DOCUMENTS.privacy.en.sections.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['controller', 'verification', 'account', 'cookies', 'recipients', 'location', 'retention', 'rights', 'live']));
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

  it('move LEGAL_VERSION with any change of a text: the published content is pinned to its version', () => {
    // The fingerprint of the four documents, both languages. A text that changes without a new LEGAL_VERSION fails
    // here: give LEGAL_VERSION the date of the change and add its line with the fingerprint this test reports. A line
    // never changes once its version is published in production. 2026-10-03: the first version, completed that day
    // (OPS-D2 and J-04/J-06 review) before any deployment of the legal pages.
    // 2026-10-03 was revised the same day it went live (publisher, contact, Wyoming law, 90-day retention: choices 16-18).
    // 2026-10-04: deployment A of the plan of 2026-10-03, one version for the whole deployment (the releases of P-R03
    // and their early access, P-X02: terms article 12; the circle, P-X01: terms article 13; the tiers' benefits, P-X04;
    // the privacy policy's entries, reservations, answers, votes and visits); its items until that deployment move this
    // line, never another.
    // 2026-10-06: deployment D, the LIVE RELEASE (plan of 2026-10-04), one version for the whole deployment (the terms'
    // article 13 and the articles it moves, the privacy policy's LIVE RELEASES). 2026-10-05 is deployment B+C's, on its
    // own branch: D comes after it. The date is a placeholder until deployment D is fixed (its runbook, §0 rule 6): this
    // line and LEGAL_VERSION then take that day, with the fingerprint of the texts as they are then.
    const PUBLISHED: Readonly<Record<string, string>> = { '2026-10-03': 'fe10caab21e4062e', '2026-10-04': '5d76e46ec2b9bfb3', '2026-10-06': 'f59b54e84cfe2f93' };
    const fingerprint = createHash('sha256').update(JSON.stringify(DOCUMENTS)).digest('hex').slice(0, 16);
    expect({ version: LEGAL_VERSION, fingerprint }).toEqual({ version: LEGAL_VERSION, fingerprint: PUBLISHED[LEGAL_VERSION] });
    expect(Object.keys(PUBLISHED).sort().at(-1)).toBe(LEGAL_VERSION);
    expect(new Set(Object.values(PUBLISHED)).size).toBe(Object.keys(PUBLISHED).length);
  });

  it('name the pages as the /verify app links them: PRIVACY · TERMS · LEGAL · HELP', () => {
    expect(LEGAL_PAGES.map((p) => WORDS.en.nav[p])).toEqual(['PRIVACY', 'TERMS', 'LEGAL', 'HELP']);
    expect(LEGAL_PAGES.map((p) => WORDS.fr.nav[p])).toEqual(['CONFIDENTIALITÉ', 'CONDITIONS', 'MENTIONS LÉGALES', 'AIDE']);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.(ts)$/.test(e.name) ? [join(dir, e.name)] : []));
}
