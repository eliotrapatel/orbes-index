/**
 * docs/legal/ (J-04), the drafts of the terms of use and of the legal notice,
 * against the code they are written from:
 *
 *  - TERMS-FACTS.md: every value equal to its exported constant (recomputed
 *    here, so a constant that changes fails this test), every code fragment
 *    found at the line, or within the range, the table cites (the message
 *    gives the line where it is now), every constant the rules lean on
 *    holding what the rule says (the statuses that end a certificate, those
 *    that allow a transfer, the tiers of the club and the statuses they leave
 *    out, the early access of the releases, the hosts of the circle's links,
 *    the private salon's note, price and tiers (P-X08), the settings of the
 *    LIVE RELEASES and the days their networks' fingerprints are kept, the
 *    steps of the orders, the issuer of their invoices and when their
 *    certificate is offered, the after-room's times, the releases a rule may
 *    require and the week of the question after), and every absence of §10
 *    (no email, no reset link, no undoing an accepted transfer, no account
 *    deletion, no age check, no vote of the circle and no note of the private
 *    salon in the audit log, no payment taken, no public view of a LIVE
 *    RELEASE's room, no call to an online store) holding in the code;
 *  - the two production settings that would change a rule
 *    (SESSION_TTL_ACCOUNT_HOURS, TRANSFER_ACCEPT_REQUIRE_PRODUCT) left
 *    commented out in deploy/vps/.env.example and empty in compose.yaml;
 *  - terms.fr.md and terms.en.md: the same articles, each ending with its
 *    *Code : …* line, citing the same rules in both languages; every rule
 *    cited, and the article that cites it giving its value in its language;
 *    the result clauses of BRAND §4.5 and §4.6 (AUTHENTIC qualifies the
 *    signed identity, a copy can verify like the original, registration is
 *    not a title of ownership); the second-hand sentence as /verify shows it
 *    (RESALE_GUIDANCE) and as the packaging kit translates it;
 *  - legal-notice.fr.md and legal-notice.en.md: the [À COMPLÉTER] fields the
 *    brief names (company name, RCS, share capital, publication director)
 *    and both hosts, Vercel Inc. for theorbes.com and OVHcloud, in Canada,
 *    for verify.theorbes.com;
 *  - the terms and the notices held to the forbidden lexicon of the
 *    packaging kit's test (BRAND §4.5 and §4.1, the kit's French lexicon),
 *    without exception, and to no exclamation mark;
 *  - the note for counsel on the Toubon law and the consumer mediator, the
 *    README that lists every file, relative links that resolve, and the
 *    drafts linked from LAUNCH §10 and BRAND §4.5.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_TTL_HOURS } from '../../src/server/config.js';
import { registerAccountBody } from '../../src/server/http/schemas.js';
import { RECOVERY_ATTEMPT_LIMIT, RECOVERY_ATTEMPT_WINDOW_MS, RECOVERY_CODE_TTL_MS, TRANSFER_FREEZE_MS } from '../../src/server/services/account-recovery.js';
import { ACCOUNT_LOGIN_THROTTLE, PASSWORD_MIN_LENGTH } from '../../src/server/services/auth.js';
import { CIRCLE_LINK_HOSTS } from '../../src/server/services/circle.js';
import { CLUB_EXCLUDED_STATUSES, CLUB_TIER_NAMES, CLUB_TIER_THRESHOLDS, tierForPieces, tierName } from '../../src/server/services/club.js';
import { AFTER_ROOM_DELAY_MINUTES, AFTER_ROOM_LENGTH_MINUTES } from '../../src/server/services/after-room.js';
import { VERIFICATION_COPY } from '../../src/server/services/copy.js';
import { DROP_SEED_BYTES, EARLY_ACCESS_HOURS, EARLY_ACCESS_MIN_TIER, PURCHASE_WINDOW_HOURS } from '../../src/server/services/drops.js';
import { DEFAULT_PROGRAM, PROGRAM_LIMITS } from '../../src/server/services/club-program.js';
import { INVOICE_ISSUER } from '../../src/server/services/invoices.js';
import { normalizeMinTier, PRICE_LABEL_MAX } from '../../src/server/services/lookbook.js';
import {
  LIVE_ADDONS_MAX,
  LIVE_GESTURE_MIN_MS,
  LIVE_MIN_PARTICIPATIONS,
  LIVE_NETWORK_RETENTION_DAYS,
  LIVE_PAY_MINUTES,
  LIVE_PER_ACCOUNT,
  LIVE_ROOM_OPENS_MINUTES,
  LIVE_TURN_SECONDS,
} from '../../src/server/services/live.js';
import { ORDER_CERTIFICATE_STATUSES, ORDER_TRANSITIONS } from '../../src/server/services/orders.js';
import {
  CERTIFICATE_DEFAULT_DAYS,
  CERTIFICATE_ENDING_STATUSES,
  CERTIFICATE_MAX_DAYS,
  CERTIFICATE_MIN_DAYS,
  MAX_OPEN_CERTIFICATES,
} from '../../src/server/services/ownership-certificates.js';
import {
  CLAIM_ATTEMPT_LIMIT,
  CLAIM_ATTEMPT_WINDOW_MS,
  REGISTRABLE_STATUSES,
  TRANSFER_TTL_MS,
  TRANSFERABLE_STATUSES,
} from '../../src/server/services/ownership.js';
import { LIVE_QUESTION_OPEN_DAYS } from '../../src/server/services/question.js';
import { SALE_TOKEN_TTL_MS } from '../../src/server/services/sale.js';
import { normalizeShopNote, SHOP_NOTE_MAX } from '../../src/server/services/salon.js';
import { SCAN_TOKEN_TTL_MS, TRANSFER_TOKEN_TTL_MS } from '../../src/server/services/scan-tokens.js';
import { dateInWords, LEGAL_VERSION } from '../../src/web/legal/content/index.js';
import { LEGAL_IDENTITY } from '../../src/web/legal/content/notice.js';
import { ASSURANCE_NOTE, LEGAL as LEGAL_COPY, RESALE_GUIDANCE } from '../../src/web/verify/copy.js';
import { PACKAGING_KIT, REPO, findForbidden, forbiddenTerms, readDoc, section } from './lexicon.js';

const LEGAL = 'docs/legal';
const FACTS = `${LEGAL}/TERMS-FACTS.md`;
const TERMS = { fr: `${LEGAL}/terms.fr.md`, en: `${LEGAL}/terms.en.md` } as const;
const NOTICE = { fr: `${LEGAL}/legal-notice.fr.md`, en: `${LEGAL}/legal-notice.en.md` } as const;
const COUNSEL = `${LEGAL}/counsel-note.fr.md`;
const README = `${LEGAL}/README.md`;
type Lang = keyof typeof TERMS;
const LANGS: readonly Lang[] = ['fr', 'en'];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ── TERMS-FACTS.md ─────────────────────────────────────────────────────────

const FACT_HEADER = '| Id | Règle | Valeur | Constante | Code | Ligne |';
const ABSENCE_HEADER = '| Id | Règle | Ce que le test vérifie |';

interface Fact {
  id: string;
  rule: string;
  value: string;
  /** The constant cell, its code spans joined by ", " ('—' when none). */
  constant: string;
  fragments: string[];
  /** Path relative to genome/src, and the 1-based line range the row cites. */
  file: string;
  start: number;
  end: number;
}

const cells = (row: string): string[] => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const spans = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** Rows of every table of `md` whose header row is exactly `header`, as cells. */
function tableRows(md: string, header: string): string[][] {
  const lines = md.split('\n');
  const rows: string[][] = [];
  lines.forEach((line, i) => {
    if (line !== header) return;
    for (const row of lines.slice(i + 2)) {
      if (!row.startsWith('|')) break;
      rows.push(cells(row));
    }
  });
  return rows;
}

/** `[server/services/auth.ts:176](../../genome/src/server/services/auth.ts#L176)`, or a range `…:323-326` / `#L323-L326`. */
const LINE_CELL = /^\[([\w./-]+):(\d+)(?:-(\d+))?\]\(\.\.\/\.\.\/genome\/src\/([\w./-]+)#L(\d+)(?:-L(\d+))?\)$/;

function parseFacts(md: string): Fact[] {
  return tableRows(md, FACT_HEADER).map((c) => {
    if (c.length !== 6) throw new Error(`a row of ${c.length} cells (a "|" inside a cell?): ${c.join(' | ')}`);
    const [id, rule, value, constant, code, line] = c;
    const m = LINE_CELL.exec(line);
    if (!m) throw new Error(`${id}: the line cell is not [path:line](../../genome/src/path#Lline): ${line}`);
    const [, textPath, textStart, textEnd, linkPath, linkStart, linkEnd] = m;
    if (textPath !== linkPath || textStart !== linkStart || (textEnd ?? '') !== (linkEnd ?? '')) {
      throw new Error(`${id}: the text and the target of the link differ: ${line}`);
    }
    return {
      id,
      rule,
      value,
      constant: constant === '—' ? '—' : spans(constant).join(', '),
      fragments: spans(code),
      file: linkPath,
      start: Number(linkStart),
      end: Number(linkEnd ?? linkStart),
    };
  });
}

const factsMd = readDoc(FACTS);
const facts = parseFacts(factsMd);
const absences = tableRows(factsMd, ABSENCE_HEADER).map(([id, rule, check]) => ({ id, rule, check }));

/** Lines (1-based) of `lines` that hold `fragment`. */
const where = (lines: readonly string[], fragment: string): number[] => lines.flatMap((l, i) => (l.includes(fragment) ? [i + 1] : []));

/**
 * What each constant of the table must say: the value cell, recomputed from the constant; the phrases the article
 * citing the rule writes, in French and in English; and, for a constant that is not a number, what it must hold for
 * the rule to be true.
 */
interface ConstantSpec {
  value: string;
  fr?: readonly string[];
  en?: readonly string[];
  holds?: () => void;
}

/** Minutes of a duration: a fraction would print as one ("15.5 minutes") and match no phrase. */
const minutes = (ms: number): number => ms / MIN;
const sameIn = (phrase: string) => ({ fr: [phrase], en: [phrase] });

const CONSTANTS: Record<string, ConstantSpec> = {
  VERIFICATION_COPY: {
    value: '—',
    holds: () => {
      const authentic = Object.entries(VERIFICATION_COPY).filter(([state]) => state.startsWith('AUTHENTIC'));
      expect(authentic.length).toBeGreaterThanOrEqual(4);
      for (const [state, copy] of authentic) expect(copy.message, state).toMatch(/^This ORBES identity was issued and signed by ORBES /);
      expect(VERIFICATION_COPY.SUSPICIOUS_ACTIVITY.message).toContain('requires review');
      expect(VERIFICATION_COPY.SUSPICIOUS_ACTIVITY.message).toContain('ORBES Client Services');
    },
  },
  ASSURANCE_NOTE: {
    value: '—',
    holds: () => {
      expect(ASSURANCE_NOTE).toContain('A printed code alone cannot prove');
      expect(ASSURANCE_NOTE).toContain('ORBES Client Services can inspect a piece on request');
    },
  },
  PASSWORD_MIN_LENGTH: { value: `${PASSWORD_MIN_LENGTH} caractères`, fr: [`${PASSWORD_MIN_LENGTH} caractères`], en: [`${PASSWORD_MIN_LENGTH} characters`] },
  DEFAULT_SESSION_TTL_HOURS: {
    value: `${DEFAULT_SESSION_TTL_HOURS.account / 24} jours`,
    fr: [`${DEFAULT_SESSION_TTL_HOURS.account / 24} jours`],
    en: [`${DEFAULT_SESSION_TTL_HOURS.account / 24} days`],
    holds: () => expect(DEFAULT_SESSION_TTL_HOURS.account % 24, 'whole days').toBe(0),
  },
  ACCOUNT_LOGIN_THROTTLE: {
    value: `${ACCOUNT_LOGIN_THROTTLE.maxFailures} essais en ${minutes(ACCOUNT_LOGIN_THROTTLE.windowMs)} minutes`,
    fr: [`${ACCOUNT_LOGIN_THROTTLE.maxFailures} essais`, `${minutes(ACCOUNT_LOGIN_THROTTLE.windowMs)} minutes`],
    en: [`${ACCOUNT_LOGIN_THROTTLE.maxFailures} attempts`, `${minutes(ACCOUNT_LOGIN_THROTTLE.windowMs)} minutes`],
  },
  RECOVERY_CODE_TTL_MS: { value: `${minutes(RECOVERY_CODE_TTL_MS)} minutes`, ...sameIn(`${minutes(RECOVERY_CODE_TTL_MS)} minutes`) },
  'RECOVERY_ATTEMPT_LIMIT, RECOVERY_ATTEMPT_WINDOW_MS': {
    value: `${RECOVERY_ATTEMPT_LIMIT} essais par heure`,
    fr: [`${RECOVERY_ATTEMPT_LIMIT} essais`, 'par heure'],
    en: [`${RECOVERY_ATTEMPT_LIMIT} attempts`, 'per hour'],
    holds: () => expect(RECOVERY_ATTEMPT_WINDOW_MS).toBe(HOUR),
  },
  TRANSFER_FREEZE_MS: {
    value: `${TRANSFER_FREEZE_MS / HOUR} heures`,
    fr: [`${TRANSFER_FREEZE_MS / HOUR} heures`],
    en: [`${TRANSFER_FREEZE_MS / HOUR} hours`],
    holds: () => expect(TRANSFER_FREEZE_MS % HOUR).toBe(0),
  },
  SCAN_TOKEN_TTL_MS: { value: `${minutes(SCAN_TOKEN_TTL_MS)} minutes`, ...sameIn(`${minutes(SCAN_TOKEN_TTL_MS)} minutes`) },
  REGISTRABLE_STATUSES: {
    value: '—',
    holds: () => {
      // A piece is registrable once handed over (its warranty activated), never from stock.
      expect(REGISTRABLE_STATUSES).toContain('ACTIVATED');
      expect(REGISTRABLE_STATUSES).not.toContain('ISSUED');
    },
  },
  'CLAIM_ATTEMPT_LIMIT, CLAIM_ATTEMPT_WINDOW_MS': {
    value: `${CLAIM_ATTEMPT_LIMIT} essais par heure`,
    fr: [`${CLAIM_ATTEMPT_LIMIT} essais`, 'par heure'],
    en: [`${CLAIM_ATTEMPT_LIMIT} attempts`, 'per hour'],
    holds: () => expect(CLAIM_ATTEMPT_WINDOW_MS).toBe(HOUR),
  },
  TRANSFER_TTL_MS: {
    value: `${TRANSFER_TTL_MS / DAY} jours`,
    fr: [`${TRANSFER_TTL_MS / DAY} jours`],
    en: [`${TRANSFER_TTL_MS / DAY} days`],
    holds: () => expect(TRANSFER_TTL_MS % DAY).toBe(0),
  },
  TRANSFERABLE_STATUSES: {
    value: '—',
    holds: () => {
      // In service, reported lost or stolen, revoked or withdrawn: not transferable (R35).
      for (const s of ['SERVICED', 'LOST', 'STOLEN', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'RETIRED', 'ISSUED'] as const) expect(TRANSFERABLE_STATUSES, s).not.toContain(s);
    },
  },
  TRANSFER_TOKEN_TTL_MS: { value: `${minutes(TRANSFER_TOKEN_TTL_MS)} minutes`, ...sameIn(`${minutes(TRANSFER_TOKEN_TTL_MS)} minutes`) },
  'CERTIFICATE_MIN_DAYS, CERTIFICATE_MAX_DAYS, CERTIFICATE_DEFAULT_DAYS': {
    value: `${CERTIFICATE_MIN_DAYS} à ${CERTIFICATE_MAX_DAYS} jours, ${CERTIFICATE_DEFAULT_DAYS} par défaut`,
    fr: [`${CERTIFICATE_MIN_DAYS} à ${CERTIFICATE_MAX_DAYS} jours`, `${CERTIFICATE_DEFAULT_DAYS} jours`],
    en: [`${CERTIFICATE_MIN_DAYS} to ${CERTIFICATE_MAX_DAYS} days`, `${CERTIFICATE_DEFAULT_DAYS} days`],
  },
  MAX_OPEN_CERTIFICATES: { value: `${MAX_OPEN_CERTIFICATES} liens`, fr: [`${MAX_OPEN_CERTIFICATES} liens`], en: [`${MAX_OPEN_CERTIFICATES} links`] },
  CERTIFICATE_ENDING_STATUSES: {
    value: '—',
    holds: () => {
      // A loss or theft reported, a revocation or a withdrawal ends a certificate (R49).
      for (const s of ['LOST', 'STOLEN', 'REVOKED', 'COUNTERFEIT_FLAGGED', 'RETIRED'] as const) expect(CERTIFICATE_ENDING_STATUSES, s).toContain(s);
    },
  },
  SALE_TOKEN_TTL_MS: { value: `${minutes(SALE_TOKEN_TTL_MS)} minutes`, ...sameIn(`${minutes(SALE_TOKEN_TTL_MS)} minutes`) },
  LEGAL: {
    value: '—',
    holds: () => {
      // R56: the sentence under CREATE ACCOUNT, and its two links (the terms, the privacy policy), nothing recorded.
      expect(LEGAL_COPY.accept).toBe('Creating an ORBES account means accepting the ORBES terms of use.');
      // In both its looks (NOCTURNE's, and the vault's on a LIVE RELEASE's page).
      const note = /export function termsNote\([^)]*\)[\s\S]*?\n\}/.exec(readDoc('genome/src/web/verify/views/common.ts'))?.[0] ?? '';
      expect(note.split('text: LEGAL.accept').length - 1).toBe(2);
      expect(note.split("href: legalPath('terms')").length - 1).toBe(2);
      expect(note.split("href: legalPath('privacy')").length - 1).toBe(2);
      // The request that creates an account carries no acceptance, no version of the terms.
      expect(Object.keys(registerAccountBody.shape).filter((k) => /accept|terms|consent|version/i.test(k))).toEqual([]);
    },
  },
  LEGAL_VERSION: {
    value: '—',
    holds: () => {
      // R57: a date, shown under each title in words.
      expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(dateInWords(LEGAL_VERSION, 'en')).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
    },
  },
  'CLUB_TIER_THRESHOLDS, CLUB_EXCLUDED_STATUSES': {
    value: `${CLUB_TIER_THRESHOLDS.slice(0, -1).join(', ')} et ${CLUB_TIER_THRESHOLDS.at(-1)} pièces`,
    fr: CLUB_TIER_NAMES.map((name, i) => `${name} dès ${CLUB_TIER_THRESHOLDS[i]}${i === 0 ? ` pièce${CLUB_TIER_THRESHOLDS[0] > 1 ? 's' : ''}` : ''}`),
    en: CLUB_TIER_NAMES.map((name, i) => `${name} from ${CLUB_TIER_THRESHOLDS[i]}${i === 0 ? ` piece${CLUB_TIER_THRESHOLDS[0] > 1 ? 's' : ''}` : ''}`),
    holds: () => {
      // R61: three tiers, named as the plan chose them (choice 7), each threshold reached by its count of pieces.
      expect(CLUB_TIER_NAMES).toEqual(['TITANE', 'PLATINE', 'PALLADIUM']);
      expect(CLUB_TIER_THRESHOLDS).toHaveLength(CLUB_TIER_NAMES.length);
      CLUB_TIER_THRESHOLDS.forEach((t, i) => {
        expect(tierForPieces(t)).toBe(i + 1);
        expect(tierForPieces(t - 1)).toBe(i);
      });
      // A piece revoked, set aside by ORBES after review or withdrawn does not count; one lost, stolen or in service does.
      expect([...CLUB_EXCLUDED_STATUSES].sort()).toEqual(['COUNTERFEIT_FLAGGED', 'RETIRED', 'REVOKED']);
    },
  },
  DROP_SEED_BYTES: { value: `${DROP_SEED_BYTES} octets`, fr: [`${DROP_SEED_BYTES} octets`], en: [`${DROP_SEED_BYTES} bytes`] },
  PURCHASE_WINDOW_HOURS: {
    value: `${PURCHASE_WINDOW_HOURS.default} heures par défaut, de ${PURCHASE_WINDOW_HOURS.min} à ${PURCHASE_WINDOW_HOURS.max}`,
    fr: [`${PURCHASE_WINDOW_HOURS.default} heures`],
    en: [`${PURCHASE_WINDOW_HOURS.default} hours`],
  },
  // R71 (plan NEXT-NINE, BP-19 T3): a window by tier, THE PROGRAM's by default, each within the drop's bounds.
  EARLY_ACCESS_HOURS: {
    value: `PALLADIUM ${DEFAULT_PROGRAM.earlyAccessPalladiumHours} heures et PLATINE ${DEFAULT_PROGRAM.earlyAccessPlatineHours} heures par défaut, de ${EARLY_ACCESS_HOURS.min} à ${EARLY_ACCESS_HOURS.max}`,
    fr: [`dès ${DEFAULT_PROGRAM.earlyAccessPalladiumHours} heures avant son ouverture`, `dès ${DEFAULT_PROGRAM.earlyAccessPlatineHours} heures avant, par défaut`],
    en: [`from ${DEFAULT_PROGRAM.earlyAccessPalladiumHours} hours before its opening`, `from ${DEFAULT_PROGRAM.earlyAccessPlatineHours} hours before, by default`],
    holds: () => {
      expect(PROGRAM_LIMITS.hours).toEqual({ min: EARLY_ACCESS_HOURS.min, max: EARLY_ACCESS_HOURS.max });
      expect(DEFAULT_PROGRAM.earlyAccessPlatineHours).toBeLessThanOrEqual(DEFAULT_PROGRAM.earlyAccessPalladiumHours);
    },
  },
  EARLY_ACCESS_MIN_TIER: {
    value: '—',
    holds: () => {
      // R72: PALLADIUM, then PLATINE from 5 pieces held (R61), reserve directly (BP-19 T3); TITANE does not.
      expect(EARLY_ACCESS_MIN_TIER).toBe(2);
      expect(tierName(EARLY_ACCESS_MIN_TIER)).toBe('PLATINE');
      expect(CLUB_TIER_THRESHOLDS[EARLY_ACCESS_MIN_TIER - 1]).toBe(5);
    },
    fr: ['PALLADIUM et PLATINE', 'au moment de sa demande'],
    en: ['PALLADIUM and PLATINE', 'at the time of the request'],
  },
  CIRCLE_LINK_HOSTS: {
    value: '—',
    holds: () => {
      // R82: the hosts the rule names, and no other (the terms say "sites authorised by ORBES" without naming them).
      expect([...CIRCLE_LINK_HOSTS].sort()).toEqual(['theorbes.com', 'vimeo.com', 'youtube.com']);
      const rule = facts.find((f) => f.id === 'R82')!.rule;
      for (const host of CIRCLE_LINK_HOSTS) expect(rule).toContain(host);
    },
  },
  PRICE_LABEL_MAX: {
    // R86: the price of a model of the private salon, the console's words (P-X08); the terms say "indicative", not its length.
    value: `${PRICE_LABEL_MAX} caractères`,
    holds: () => {
      expect(PRICE_LABEL_MAX).toBe(60);
      // R85: the tier a model of the salon is shown from is TITANE, PLATINE or PALLADIUM (1 to 3), nothing else.
      expect([1, 2, 3].map((t) => normalizeMinTier(t))).toEqual([1, 2, 3]);
      for (const t of [0, 4, 1.5, '2']) expect(() => normalizeMinTier(t), String(t)).toThrow();
      expect(CLUB_TIER_NAMES).toHaveLength(3);
    },
  },
  SHOP_NOTE_MAX: {
    // R87: the account's note on a request of the private salon, optional (P-X08).
    value: `${SHOP_NOTE_MAX} caractères`,
    fr: [`${SHOP_NOTE_MAX} caractères`],
    en: [`${SHOP_NOTE_MAX} characters`],
    holds: () => {
      expect(SHOP_NOTE_MAX).toBe(500);
      expect(normalizeShopNote('   ')).toBeNull();
      expect(normalizeShopNote('x'.repeat(SHOP_NOTE_MAX))).toHaveLength(SHOP_NOTE_MAX);
      expect(() => normalizeShopNote('x'.repeat(SHOP_NOTE_MAX + 1))).toThrow();
    },
  },
  // The LIVE RELEASES (plan of 2026-10-04): the defaults of the plan's choices 15 and 16 and their bounds.
  LIVE_ROOM_OPENS_MINUTES: {
    value: `${LIVE_ROOM_OPENS_MINUTES.default} minutes par défaut, de ${LIVE_ROOM_OPENS_MINUTES.min} à ${LIVE_ROOM_OPENS_MINUTES.max}`,
    fr: [`${LIVE_ROOM_OPENS_MINUTES.default} minutes avant`, `de ${LIVE_ROOM_OPENS_MINUTES.min} à ${LIVE_ROOM_OPENS_MINUTES.max} minutes`],
    en: [`${LIVE_ROOM_OPENS_MINUTES.default} minutes before`, `from ${LIVE_ROOM_OPENS_MINUTES.min} to ${LIVE_ROOM_OPENS_MINUTES.max} minutes`],
  },
  LIVE_PER_ACCOUNT: {
    value: `${LIVE_PER_ACCOUNT.default} pièce par défaut, au plus ${LIVE_PER_ACCOUNT.max}`,
    fr: [`jusqu'à ${LIVE_PER_ACCOUNT.max}`],
    en: [`up to ${LIVE_PER_ACCOUNT.max}`],
    // The articles say « one piece » in words: the default must be one.
    holds: () => expect(LIVE_PER_ACCOUNT.default).toBe(1),
  },
  LIVE_TURN_SECONDS: {
    value: `${LIVE_TURN_SECONDS.default} secondes par défaut, de ${LIVE_TURN_SECONDS.min} à ${LIVE_TURN_SECONDS.max}`,
    fr: [`${LIVE_TURN_SECONDS.default} secondes`, `de ${LIVE_TURN_SECONDS.min} à ${LIVE_TURN_SECONDS.max} secondes`],
    en: [`${LIVE_TURN_SECONDS.default} seconds`, `from ${LIVE_TURN_SECONDS.min} to ${LIVE_TURN_SECONDS.max} seconds`],
  },
  LIVE_GESTURE_MIN_MS: {
    value: `${String(LIVE_GESTURE_MIN_MS / 1000).replace('.', ',')} seconde`,
    fr: [`${String(LIVE_GESTURE_MIN_MS / 1000).replace('.', ',')} seconde`],
    en: [`${LIVE_GESTURE_MIN_MS / 1000} seconds`],
    // The ring of the page asks 1.5 s: the server's floor stays under it, so a held seal is never refused.
    holds: () => expect(LIVE_GESTURE_MIN_MS).toBeLessThan(1500),
  },
  LIVE_PAY_MINUTES: {
    value: `${LIVE_PAY_MINUTES.default} minutes par défaut, de ${LIVE_PAY_MINUTES.min} à ${LIVE_PAY_MINUTES.max}`,
    fr: [`pendant ${LIVE_PAY_MINUTES.default} minutes`, `de ${LIVE_PAY_MINUTES.min} à ${LIVE_PAY_MINUTES.max} minutes`],
    en: [`for ${LIVE_PAY_MINUTES.default} minutes`, `from ${LIVE_PAY_MINUTES.min} to ${LIVE_PAY_MINUTES.max} minutes`],
  },
  LIVE_ADDONS_MAX: { value: `${LIVE_ADDONS_MAX} options`, fr: [`${LIVE_ADDONS_MAX} au plus`], en: [`at most ${LIVE_ADDONS_MAX}`] },
  LIVE_NETWORK_RETENTION_DAYS: {
    value: `${LIVE_NETWORK_RETENTION_DAYS} jours`,
    fr: [`${LIVE_NETWORK_RETENTION_DAYS} jours`],
    en: [`${LIVE_NETWORK_RETENTION_DAYS} days`],
  },
  // The orders (plan LIVE RELEASE+ of 2026-10-04): their steps, the issuer of their invoices, their certificate.
  ORDER_TRANSITIONS: {
    value: '—',
    holds: () => {
      // R121: exactly the steps the plan's Interconnection names, CANCELLED and RETURNED final (article 14 lists them).
      expect(ORDER_TRANSITIONS).toEqual({ RESERVED: ['PAID', 'CANCELLED'], PAID: ['SHIPPED', 'CANCELLED'], SHIPPED: ['DELIVERED', 'RETURNED'], DELIVERED: ['RETURNED'], CANCELLED: [], RETURNED: [] });
    },
  },
  INVOICE_ISSUER: {
    value: '—',
    fr: [`${INVOICE_ISSUER.name} émet sa facture`, 'en anglais et sans TVA'],
    en: [`${INVOICE_ISSUER.name} issues its invoice`, 'in English and without VAT'],
    holds: () => {
      // R128: the publisher the legal notice names, at its registered office (choice 22).
      expect(INVOICE_ISSUER.name).toBe(LEGAL_IDENTITY.companyName);
      expect(INVOICE_ISSUER.address.join(', ')).toBe('30 N Gould St, Ste N, Sheridan, WY 82801, United States');
      // No VAT: an invoice leaves its VAT fields empty and its total is its subtotal.
      const issue = /export async function issueInvoice\([\s\S]*?\n\}/.exec(readDoc('genome/src/server/services/invoices.ts'))?.[0] ?? '';
      expect(issue).toContain('total_minor: total,');
      expect(issue).not.toMatch(/vat_rate_bp|vat_minor/);
    },
  },
  ORDER_CERTIFICATE_STATUSES: {
    value: '—',
    holds: () => {
      // R132: paid and neither cancelled nor returned (and the piece registered to the account, the row's other terms).
      expect([...ORDER_CERTIFICATE_STATUSES].sort()).toEqual(['DELIVERED', 'PAID', 'SHIPPED']);
    },
  },
  // The releases and the collectors (plan LIVE RELEASE+): the after-room's times, the participation rule, the question.
  'AFTER_ROOM_DELAY_MINUTES, AFTER_ROOM_LENGTH_MINUTES': {
    value: `${AFTER_ROOM_DELAY_MINUTES.default} minutes après l'épuisement par défaut, de ${AFTER_ROOM_DELAY_MINUTES.min} à ${AFTER_ROOM_DELAY_MINUTES.max} ; ouverte ${AFTER_ROOM_LENGTH_MINUTES.default} minutes par défaut, de ${AFTER_ROOM_LENGTH_MINUTES.min} à ${AFTER_ROOM_LENGTH_MINUTES.max}`,
    fr: [
      `${AFTER_ROOM_DELAY_MINUTES.default} minutes après l'épuisement`,
      `de ${AFTER_ROOM_DELAY_MINUTES.min} à ${AFTER_ROOM_DELAY_MINUTES.max} minutes`,
      `ouverte ${AFTER_ROOM_LENGTH_MINUTES.default} minutes`,
      `de ${AFTER_ROOM_LENGTH_MINUTES.min} à ${AFTER_ROOM_LENGTH_MINUTES.max} minutes`,
    ],
    en: [
      `${AFTER_ROOM_DELAY_MINUTES.default} minutes after the sell-out`,
      `from ${AFTER_ROOM_DELAY_MINUTES.min} to ${AFTER_ROOM_DELAY_MINUTES.max} minutes`,
      `open ${AFTER_ROOM_LENGTH_MINUTES.default} minutes`,
      `from ${AFTER_ROOM_LENGTH_MINUTES.min} to ${AFTER_ROOM_LENGTH_MINUTES.max} minutes`,
    ],
    // The plan's defaults (choice 2): 10 minutes after the sell-out, open 15.
    holds: () => expect([AFTER_ROOM_DELAY_MINUTES.default, AFTER_ROOM_LENGTH_MINUTES.default]).toEqual([10, 15]),
  },
  LIVE_MIN_PARTICIPATIONS: { value: `de ${LIVE_MIN_PARTICIPATIONS.min} à ${LIVE_MIN_PARTICIPATIONS.max} sorties` },
  LIVE_QUESTION_OPEN_DAYS: {
    value: `${LIVE_QUESTION_OPEN_DAYS} jours`,
    fr: [`pendant ${LIVE_QUESTION_OPEN_DAYS} jours`],
    en: [`for ${LIVE_QUESTION_OPEN_DAYS} days`],
  },
};

/** The rules the plan names for TERMS-FACTS, by the fragment of code that applies each one. */
const PLAN_RULES: Readonly<Record<string, string>> = {
  'one pending transfer': "'TRANSFER_ALREADY_PENDING'",
  'acceptance is final': "ended_reason: 'TRANSFERRED_OUT'",
  'confirmation by ORBES Client Services': 'set({ verified: true })',
  'no reset by email, the assisted recovery (C-04)': "app.post('/api/v1/account/recover'",
  'the 72-hour pause (C-04)': 'new Date(now.getTime() + TRANSFER_FREEZE_MS)',
  'the transfer bound to the scan (F-03)': 'throw transferProductMismatch()',
  'the shareable certificate (F-06)': 'days > CERTIFICATE_MAX_DAYS',
  'the account lock (A-06)': "set({ status: 'LOCKED', updated_at: now })",
  'the boutique sale (A-08)': 'ttlMs: SALE_TOKEN_TTL_MS,',
  'entering a release (P-R03)': "if (dropState(d, now) !== 'OPEN') throw dropNotOpen();",
  'the tiers, a constant of the code (P-R03)': 'CLUB_TIER_THRESHOLDS.filter((t) => n >= t).length',
  'the draw by tier, seniority, then the seed (P-R03)': 'keyed.sort((a, b) => b.tier - a.tier',
  'the seed published only after the draw (P-R03)': 'seed: r.drawn_at && r.seed ? toHex(r.seed) : null,',
  'a selection obliges no one, a lapse only after its time (P-R03)': 'throw placeHeld(e.respond_by)',
  'the lock withdraws the open entries (P-R03)': 'withdrawAccountEntries(tx, account.id)',
  'the early access window, 48 hours by default and set per release (P-X02)': 'throw earlyAccessNotOpen(from);',
  'only PLATINE and PALLADIUM, at the moment of the request (P-X02)': 'if (standing.tier < EARLY_ACCESS_MIN_TIER) throw tierRequired();',
  'first come, first served within the pieces, then full (P-X02)': 'if (Number(held.n) >= d.quantity) throw dropFull();',
  'one entry or reservation per account, the place held until respond_by (P-X02)': 'throw alreadyReserved();',
  'the draw only on the places left (P-X02)': 'const places = Math.max(0, d.quantity - Number(held.n));',
  'the circle for the owners, each post from its tier, read again at each request (P-X01)': "if (tier < 1) throw ownersOnly();",
  'an answer YES or NO until the event, within its places (P-X01)': 'if (Number(yes.n) >= p.capacity) throw circleFull();',
  'one final vote per poll (P-X01)': 'if (voted) throw alreadyVoted();',
  'the results after one\'s own vote (P-X01)': 'results: voted === null ? null :',
  'visits counted per day without any account (P-X01)': '.values({ day: now.toISOString().slice(0, 10), visits: 1 })',
  'answers audited (P-X01)': "action: 'circle.rsvp'",
  'external links on the allowed hosts only (P-X01)': 'if (!CIRCLE_LINK_HOSTS.some((h) => host === h',
  'the export lists the answers and votes (P-X01)': 'circleVotes: circle.votes,',
  'the tiers\' words set from the console, the thresholds never (P-X04)': "app.patch('/api/admin/club/tiers/:tier'",
  'the reserved models shown from their tier, 404 below (P-X08)': "if (m.lookbook === 'RESERVED' && m.private_min_tier > tier) throw lookbookNotFound();",
  'the price of the salon, a text of the console (P-X08)': 'if (s.length > PRICE_LABEL_MAX) throw validationError(',
  'a request on demand, concluded by ORBES Client Services, no payment and no email (P-X08)': ".insertInto('shop_requests')",
  'one open request per account and model (P-X08)': "if (isUniqueViolation(e, 'shop_requests_one_open')) throw shopRequestOpen();",
  'the console closes a request with a note (P-X08)': "if (words === null) throw validationError('Say in the note what was done for the client.');",
  'the export lists the requests (P-X08)': 'shopRequests,',
  'the lock closes the open requests, before the transfers are cancelled (P-X08)': 'closeAccountShopRequests(tx, account.id, actor, now)',
  'a discontinued model\'s pieces verify as before, said DISCONTINUED with the year (P-R06)': 'discontinuedYear: reg.modelDiscontinuedAt.getUTCFullYear()',
  'SUBSCRIBE of ORBES Care only once its address is published (P-M02)': "field('CARE_SUBSCRIBE_URL', zHttpsLink, e.CARE_SUBSCRIBE_URL) ?? null",
  'no stage of a LIVE RELEASE before its time (choice 30)': 'photo: t >= photoAt,',
  'access by tier, model or collection, read again at each step (choices 1, 35)': "if ((d.live_min_tier ?? 0) > 0) rules.push({ rule: 'TIER', met: async () => tier >= (d.live_min_tier ?? 0) });",
  'the room opens before T0 (choice 16)': 'if (now.getTime() < roomOpensAt(d).getTime()) throw roomNotOpen(roomOpensAt(d));',
  'the size never changes after T0 (choice 6)': 'throw sizeLocked();',
  'the line at T0 by tier, then the sealed seed (choices 2, 14)': 'const seed = openDropSeed(this.seedKey, d);',
  // (an after-room's guest at its own place instead: plan LIVE RELEASE+, choice 2)
  'arrivals after T0 behind, in arrival order (choice 2)': "? { status: 'QUEUED' as const, position: place ?? (await this.lastPosition(tx, id)) + 1, queued_at: now }",
  'the hold gesture checked on the server (choice 8)': 'if (gesture < LIVE_GESTURE_MIN_MS) throw holdTooShort();',
  'PAY confirms a reservation, nothing paid (choices 4, 33)': ".set({ status: 'CONFIRMED', confirmed_at: now })",
  'a piece returned goes to the next in line (choice 5)': ".set((eb) => ({ status: 'MISSED', ended_at: eb.ref('turn_expires_at') }))",
  'add-ons at their price when chosen (choice 34)': 'addons.map((a) => ({ entry_id: e.id, addon_id: a.id, price_minor: a.price_minor }))',
  'pieces added, each recorded with the quantity line (choice 36)': 'quantityLine: d.quantity_line',
  'a person in the line let take their turn (choice 3)': 'await this.grant(tx, d, [entry], now, admin);',
  'closed at the sell-out (choice 26)': "soldOutAt && soldOutAt.getTime() < d.closes_at.getTime() ? 'SOLD_OUT'",
  'the network\'s fingerprint erased after 30 days': 'const cutoff = new Date(now.getTime() - LIVE_NETWORK_RETENTION_DAYS * DAY_MS);',
  // LIVE RELEASE+ (plan of 2026-10-04).
  'an order per piece at PAY (choice 6, Interconnection)': 'notes.push(...(await ordersForLiveEntry(tx, e.id, actor, now)).notes);',
  'an order for a draw\'s entry confirmed (choice 6)': "const order = to === 'CONFIRMED' ? await orderForDrawEntry(tx, e.id, actor, now) : { order: null, notes: [] };",
  'an order for a salon request ACCEPTED (choice 6)': "const order = input.outcome === 'ACCEPTED' ? await orderForShopRequest(tx, requestId, actor, at) : { order: null, notes: [] };",
  'the legal steps of an order (Interconnection)': 'if (!isOrderTransitionAllowed(o.status, s.to)) throw stepNotAllowed(o.status, s.to);',
  'a piece in stock, or one to make with its identity reserved (choices 8, 15)': 'const identity = await reserveIdentity(tx, { modelId: o.model_id, skuId: o.sku_id, sizeLabel: o.size_label }, now);',
  'DELIVERED by itself at the buyer\'s registration (Interconnection)': 'const delivered = await deliverOnRegistration(tx, p.id, accountId, actor, now);',
  'a cancellation retires the reserved identity (Interconnection)': 'const retired = await retireReservedIdentity(tx, bench.product_id, reason, actor, now);',
  'a return takes the ownership back (choice 20)': "await tx.updateTable('ownership').set({ ended_at: endedAt, ended_reason: 'RETURNED' }).where('id', '=', owner.id).execute();",
  'the invoice issued by CONGLOMERAT LLC, without VAT (choice 22)': 'issuer: jsonText({ name: INVOICE_ISSUER.name, address: [...INVOICE_ISSUER.address] }),',
  'a credit note cancels the invoice once (choices 20, 22)': 'credits_invoice_id: invoice.id,',
  'the buyer never in the journal (decision 31)': 'buyer: o.buyer_name !== null',
  'MY PIECES reads its own orders (choice 6)': "app.get('/api/v1/account/orders', async (request) => {",
  'the ownership certificate once the piece is registered (choice 21)': 'certificate: ORDER_CERTIFICATE_STATUSES.includes(r.status) && r.ownership_id !== null && r.piece_status !== null',
  'the after-room\'s guests, those still waiting at the sell-out, in their order (choice 2)': ".where('status', 'in', ['WAITING', 'QUEUED'])",
  'the after-room unseen by anyone else (choice 2, decision 28)': 'if (isAfterRoom(d) && (await afterRoomPlace(this.db, d, account, now)) === null) throw dropNotFound();',
  'a surprise in every box, never said (choice 3)': 'surprise: (r.parent_drop_id ? r.parent_surprise : r.surprise_enabled) === true,',
  'taking part: a place in the line at T0, an entry at the draw (choice 4)': ".where('le.position', 'is not', null)",
  'access by participation and by segment, AND or OR (choices 4, 27)': "if (d.access_combine === 'OR') {",
  'segments read live, never stored (choice 27)': 'export function segmentMembers(db: Db, criteria: SegmentGroup, now: Date) {',
  'PAST: ended releases, never an after-room (choice 5, decision 28)': ".where('d.parent_drop_id', 'is', null)",
  'YOU TOOK PART, YOU SECURED A PIECE (choice 5)': "app.get('/api/v1/account/participation', async (request) => {",
  'the question after for a week (choice 11)': 'return { opensAt, closesAt: new Date(opensAt.getTime() + LIVE_QUESTION_OPEN_DAYS * DAY_MS) };',
  'activity counted per hour without any account (choice 10)': ".insertInto('activity_hourly')",
};

// ── Sources, for the absences of §10 ───────────────────────────────────────

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? typescriptFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}
const GENOME = join(REPO, 'genome');
/** The server, the web apps and the scripts, migrations aside (their CHECKs name every value the schema allows). */
const SOURCES = ['src', 'scripts']
  .flatMap((d) => typescriptFiles(join(GENOME, d)))
  .filter((f) => !f.includes(`${join('db', 'migrations')}`))
  .map((f) => ({ file: f.slice(GENOME.length + 1), text: readFileSync(f, 'utf8') }));
const matches = (re: RegExp): { file: string; match: RegExpMatchArray }[] =>
  SOURCES.flatMap(({ file, text }) => [...text.matchAll(re)].map((match) => ({ file, match })));
/** Every route the server declares: method and path. */
const ROUTES = SOURCES.filter(({ file }) => file.startsWith(join('src', 'server', 'routes'))).flatMap(({ text }) =>
  [...text.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map((m) => ({ method: m[1], path: m[2] })),
);

const ABSENCE_CHECKS: Readonly<Record<string, () => void>> = {
  N1: () => {
    const pkg = JSON.parse(readDoc('genome/package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.length).toBeGreaterThan(5);
    expect(deps.filter((d) => /mail|smtp|sendgrid|postmark|mailgun|mandrill|sparkpost|resend|client-ses/i.test(d))).toEqual([]);
    expect(matches(/\b(?:smtp|nodemailer|createTransport|sendMail)\b/gi).map((m) => m.file)).toEqual([]);
  },
  N2: () => {
    expect(ROUTES.length).toBeGreaterThan(50);
    // The console's own routes (a staff member's second factor, /api/admin) are not the customer's.
    const customerRoutes = ROUTES.filter((r) => !r.path.startsWith('/api/admin/'));
    expect(customerRoutes.length).toBeGreaterThan(20);
    expect(customerRoutes.filter((r) => /reset|forgot|magic|verify-email|confirm-email/i.test(r.path))).toEqual([]);
    // The customer's only password routes: the change (signed in, with the current one) and the assisted recovery (R12).
    const customer = ROUTES.filter((r) => r.path.startsWith('/api/v1/') && /password|recover/i.test(r.path)).map((r) => `${r.method} ${r.path}`);
    expect(customer.sort()).toEqual(['post /api/v1/account/password', 'post /api/v1/account/recover']);
  },
  N3: () => {
    // An ownership begins only by a first registration or a transfer, and ends only by a transfer, or when ORBES takes
    // it back with a return (plan LIVE RELEASE+, choice 20: the piece goes back to ORBES, to no account).
    expect(new Set(matches(/acquired_via:\s*'(\w+)'/g).map((m) => m.match[1]))).toEqual(new Set(['FIRST_REGISTRATION', 'TRANSFER']));
    expect(matches(/insertInto\('ownership'\)/g)).toHaveLength(matches(/acquired_via:\s*'(\w+)'/g).length);
    expect(new Set(matches(/ended_reason:\s*'(\w+)'/g).map((m) => m.match[1]))).toEqual(new Set(['TRANSFERRED_OUT', 'RETURNED']));
    expect(matches(/ended_reason:\s*'RETURNED'/g).map((m) => m.file)).toEqual([join('src', 'server', 'services', 'orders.ts')]);
    // No other write to an ownership row than its end and its verification; no raw SQL that would bypass them.
    const updated = matches(/updateTable\('ownership'\)\s*\.set\(\{([^}]*)\}\)/g).flatMap((m) => [...m.match[1].matchAll(/(\w+)\s*:/g)].map((k) => k[1]));
    expect(new Set(updated)).toEqual(new Set(['ended_at', 'ended_reason', 'verified']));
    expect(matches(/updateTable\('ownership'\)/g)).toHaveLength(matches(/updateTable\('ownership'\)\s*\.set\(\{/g).length);
    expect(matches(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+ownership\b/g).map((m) => m.file)).toEqual([]);
  },
  N4: () => {
    // Neither the customer's routes nor the console's: no tool deletes an account (counsel note §4, point 3).
    expect(ROUTES.filter((r) => r.method === 'delete' && (r.path.startsWith('/api/v1/account') || r.path.startsWith('/api/admin/owners')))).toEqual([]);
    expect(matches(/status:\s*'DELETED'|status\s*=\s*'DELETED'/g).map((m) => m.file)).toEqual([]);
    // No row of accounts is deleted, through Kysely or in raw SQL, by the server or a script.
    expect(matches(/deleteFrom\(\s*'accounts'\s*\)|\bDELETE\s+FROM\s+"?accounts\b/gi).map((m) => m.file)).toEqual([]);
  },
  N5: () => {
    expect(Object.keys(registerAccountBody.shape).sort()).toEqual(['country', 'displayName', 'email', 'password']);
  },
  N6: () => {
    // The vote of the circle (P-X01) writes its row and nothing in the audit log; no audit action names a vote.
    const circle = readDoc('genome/src/server/services/circle.ts');
    const vote = /\n {2}async vote\(accountId[\s\S]*?\n {2}\}\n/.exec(circle)?.[0] ?? '';
    expect(vote).toContain("insertInto('circle_poll_votes')");
    expect(vote).not.toMatch(/audit/);
    expect(matches(/action:\s*'([a-z.]*vote[a-z._]*)'/g).map((m) => m.match[1])).toEqual([]);
  },
  N7: () => {
    // The private salon (P-X08) audits a request and its closing with the model alone, its outcome and the order an
    // ACCEPTED one created (plan LIVE RELEASE+), and a lock's reason: never a note.
    const salon = readDoc('genome/src/server/services/salon.ts');
    const records = [...salon.matchAll(/audit\.record\(\{[^\n]*\}, tx\)/g)].map((m) => m[0]);
    expect(records).toHaveLength(3);
    for (const r of records) {
      expect(r).toMatch(/action: 'shop\.request(?:\.close)?'/);
      expect(r).toMatch(/details: \{ modelId(?:: [\w.]+)?(?:, outcome: (?:[\w.]+|'DECLINED'))?(?:, reason|, \.\.\.orderId)? \}/);
      expect(r).not.toMatch(/note|words|resolution/i);
    }
    // No other audit entry of the salon: every write of shop_requests is in services/salon.ts.
    expect(matches(/'shop\.request[a-z.]*'/g).every((m) => m.file === join('src', 'server', 'services', 'salon.ts'))).toBe(true);
  },
  N8: () => {
    // PAY confirms a reservation (the plan's choices 4 and 33): no payment library, no route that takes a payment.
    const pkg = JSON.parse(readDoc('genome/package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /stripe|whop|paypal|adyen|braintree|mollie|checkout|payment|billing/i.test(d))).toEqual([]);
    expect(ROUTES.filter((r) => /pay(?:ment)?s?\b|checkout|billing|charge/i.test(r.path))).toEqual([]);
    // The invoices of the orders paid (plan LIVE RELEASE+, M7) are documents read, never a payment taken.
    expect(ROUTES.filter((r) => /invoice/i.test(r.path) && r.method !== 'get')).toEqual([]);
    // The confirmation is a status, and the only one PAY writes.
    expect(ROUTES).toContainEqual({ method: 'post', path: '/api/v1/live/:id/confirm' });
  },
  N9: () => {
    // The room's state and stream: a signed-in viewer the rule lets in (or holding an entry), never a public route.
    const routes = readDoc('genome/src/server/routes/live.ts');
    for (const path of ['/api/v1/live/:id/state', '/api/v1/live/:id/stream']) {
      const declared = new RegExp(`app\\.get\\('${path.replace(/[/:.]/g, (c) => `\\${c}`)}',([^\n]*)\n([\\s\\S]*?)\n {2}\\}\\);`).exec(routes);
      expect(declared, path).not.toBeNull();
      expect(declared![1], path).not.toContain('PUBLIC');
      expect(declared![2], path).toContain('requireAccount(request)');
      expect(declared![2], path).toContain('liveRoom.viewer(');
    }
    // The boutique board names no one, and shows neither the room, the line, the sizes nor a message.
    const board = /export interface LiveBoard \{([\s\S]*?)\n\}/.exec(readDoc('genome/src/server/services/live-room.ts'))?.[1] ?? '';
    expect(board).toContain('quantityLine');
    expect(board).not.toMatch(/\b(?:account|email|inRoom|line|sizes|message|entries)\??:/);
  },
  N10: () => {
    // No call to an online store (plan LIVE RELEASE+, choice 9: Shopify not decided, exports only): no dependency for
    // one, and no request the server sends out at all.
    const pkg = JSON.parse(readDoc('genome/package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => /shopify/i.test(d))).toEqual([]);
    const server = SOURCES.filter(({ file }) => file.startsWith(join('src', 'server')));
    expect(server.length).toBeGreaterThan(50);
    expect(server.filter(({ text }) => /\bfetch\(|\bhttps?\.request\(|\bhttps?\.get\(/.test(text)).map(({ file }) => file)).toEqual([]);
    // The exports exist, as files of the console.
    expect(ROUTES).toContainEqual({ method: 'get', path: '/api/admin/shopify/orders.csv' });
    expect(ROUTES).toContainEqual({ method: 'get', path: '/api/admin/shopify/products.csv' });
  },
};

// ── The drafts ─────────────────────────────────────────────────────────────

interface Article {
  n: number;
  title: string;
  body: string;
  /** Ids of TERMS-FACTS the article cites; [] for a legal clause. */
  refs: string[];
}

const CODE_LINE: Readonly<Record<Lang, RegExp>> = { fr: /^\*Code : (.+)\.\*$/, en: /^\*Code: (.+)\.\*$/ };
const LEGAL_CLAUSE: Readonly<Record<Lang, string>> = { fr: '— (clause juridique)', en: '— (legal clause)' };

function parseArticles(md: string, lang: Lang): Article[] {
  return md
    .split(/^## /m)
    .slice(1)
    .map((part) => {
      const [heading, ...rest] = part.split('\n');
      const h = /^Article (\d+) — (.+)$/.exec(heading);
      if (!h) throw new Error(`${lang}: a section that is not an article: "## ${heading}"`);
      const body = rest.join('\n').trim();
      const last = body.split('\n').at(-1) ?? '';
      const c = CODE_LINE[lang].exec(last);
      if (!c) throw new Error(`${lang}: article ${h[1]} does not end with its code line: "${last}"`);
      const refs = c[1] === LEGAL_CLAUSE[lang] ? [] : c[1].split(', ');
      return { n: Number(h[1]), title: h[2], body, refs };
    });
}

const terms = { fr: readDoc(TERMS.fr), en: readDoc(TERMS.en) };
const articles = { fr: parseArticles(terms.fr, 'fr'), en: parseArticles(terms.en, 'en') };
const notices = { fr: readDoc(NOTICE.fr), en: readDoc(NOTICE.en) };

/** The text a reader sees: link targets are addresses, not words. */
const prose = (md: string): string => md.replace(/\]\([^)\s]+\)/g, ']');
/** The [À COMPLÉTER : …] fields of a draft, by their hint. */
const placeholders = (md: string): string[] => [...md.matchAll(/\[À COMPLÉTER ?:([^\]]*)\]/g)].map((m) => m[1].trim());

/** The French second-hand sentence, as the packaging kit's §3 table translates RESALE_GUIDANCE (J-02). */
function kitResaleFr(): string {
  const rows = section(readDoc(PACKAGING_KIT), '## 3. Second-hand purchase')
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map(cells);
  const [en, fr] = rows[2];
  expect(en).toBe(RESALE_GUIDANCE);
  return fr;
}

describe('TERMS-FACTS (docs/legal/TERMS-FACTS.md)', () => {
  it('numbers its rules R01… in order, and its absences N1…', () => {
    expect(facts.length).toBeGreaterThanOrEqual(40);
    expect(facts.map((f) => f.id)).toEqual(facts.map((_, i) => `R${String(i + 1).padStart(2, '0')}`));
    expect(absences.map((a) => a.id)).toEqual(absences.map((_, i) => `N${i + 1}`));
    for (const f of facts) {
      expect(f.rule.length, f.id).toBeGreaterThan(20);
      expect(f.fragments.length, `${f.id}: a fragment of code`).toBeGreaterThan(0);
    }
  });

  it('finds every fragment of code at the line it cites', () => {
    const drift: string[] = [];
    for (const f of facts) {
      const path = join(GENOME, 'src', f.file);
      if (!existsSync(path)) {
        drift.push(`${f.id}: no file genome/src/${f.file}`);
        continue;
      }
      const lines = readFileSync(path, 'utf8').split('\n');
      const range = lines.slice(f.start - 1, f.end);
      const at = `${f.file}:${f.start}${f.end === f.start ? '' : `-${f.end}`}`;
      if (f.end < f.start || range.length !== f.end - f.start + 1) drift.push(`${f.id}: ${at} is not a range of the file`);
      for (const fragment of f.fragments) {
        if (!range.some((l) => l.includes(fragment))) drift.push(`${f.id}: \`${fragment}\` is not at ${at}; it is now at line ${where(lines, fragment).join(', ') || '(nowhere)'}`);
      }
      // A range is as tight as its fragments: the first opens it, the last closes it.
      if (f.end !== f.start) {
        if (!lines[f.start - 1]?.includes(f.fragments[0])) drift.push(`${f.id}: ${at} does not start on \`${f.fragments[0]}\``);
        if (!lines[f.end - 1]?.includes(f.fragments.at(-1)!)) drift.push(`${f.id}: ${at} does not end on \`${f.fragments.at(-1)}\``);
      }
    }
    expect(drift).toEqual([]);
  });

  it('gives each constant its value, recomputed from the exported constant, and the constants hold what the rules say', () => {
    const cited = new Set(facts.map((f) => f.constant).filter((c) => c !== '—'));
    expect([...cited].sort()).toEqual(Object.keys(CONSTANTS).sort());
    for (const f of facts) {
      const spec = f.constant === '—' ? { value: '—' } : CONSTANTS[f.constant];
      expect(f.value, `${f.id} (${f.constant})`).toBe(spec.value);
    }
    for (const spec of Object.values(CONSTANTS)) spec.holds?.();
    // The registration and the reception of a transfer share the scan's window (R22, R37).
    expect(TRANSFER_TOKEN_TTL_MS).toBe(SCAN_TOKEN_TTL_MS);
  });

  it('covers every rule the plan names', () => {
    const fragments = facts.flatMap((f) => f.fragments);
    for (const [rule, fragment] of Object.entries(PLAN_RULES)) expect(fragments, rule).toContain(fragment);
  });

  it('keeps the production settings that would change a rule unset on the server', () => {
    const env = readDoc('deploy/vps/.env.example');
    expect(env).toMatch(new RegExp(`^# SESSION_TTL_ACCOUNT_HOURS=${DEFAULT_SESSION_TTL_HOURS.account}$`, 'm'));
    expect(env).not.toMatch(/^SESSION_TTL_ACCOUNT_HOURS=/m);
    expect(env).toMatch(/^# TRANSFER_ACCEPT_REQUIRE_PRODUCT=true\b/m);
    expect(env).not.toMatch(/^TRANSFER_ACCEPT_REQUIRE_PRODUCT=/m);
    const compose = readDoc('deploy/vps/compose.yaml');
    expect(compose).toContain('SESSION_TTL_ACCOUNT_HOURS: ${SESSION_TTL_ACCOUNT_HOURS:-}');
    expect(compose).toContain('TRANSFER_ACCEPT_REQUIRE_PRODUCT: ${TRANSFER_ACCEPT_REQUIRE_PRODUCT:-}');
    // Unset, the account session takes the exported default.
    expect(readDoc('genome/src/server/config.ts')).toContain('DEFAULT_SESSION_TTL_HOURS.account');
  });

  it('checks each absence of §10 in the code', () => {
    expect(absences.map((a) => a.id)).toEqual(Object.keys(ABSENCE_CHECKS));
  });

  for (const [id, check] of Object.entries(ABSENCE_CHECKS)) {
    it(`${id}: ${absences.find((a) => a.id === id)?.rule ?? '(missing from TERMS-FACTS)'}`, check);
  }

  it('reads every rule of N3 and N4 from real writes: the matchers find the code that registers, transfers and locks', () => {
    expect(matches(/acquired_via:\s*'(\w+)'/g)).toHaveLength(2);
    expect(matches(/status:\s*'LOCKED'/g).length).toBeGreaterThan(0);
    expect(ROUTES).toContainEqual({ method: 'delete', path: '/api/v1/ownership/certificates/:id' });
    // The console's owner routes are read (N4 looks there too), and so are the deletes of other tables.
    expect(ROUTES.filter((r) => r.path.startsWith('/api/admin/owners')).length).toBeGreaterThan(3);
    expect(matches(/deleteFrom\(\s*'(\w+)'\s*\)/g).map((m) => m.match[1])).toEqual(expect.arrayContaining(['sessions', 'scan_events']));
  });
});

describe('terms of use (docs/legal/terms.fr.md, terms.en.md)', () => {
  it('have the same articles in both languages, each ending with the rules it describes, the same in both', () => {
    expect(articles.fr.length).toBeGreaterThanOrEqual(12);
    expect(articles.fr.map((a) => a.n)).toEqual(articles.fr.map((_, i) => i + 1));
    expect(articles.en.map((a) => a.n)).toEqual(articles.fr.map((a) => a.n));
    for (const [fr, en] of articles.fr.map((a, i) => [a, articles.en[i]] as const)) expect(en.refs, `article ${fr.n}`).toEqual(fr.refs);
  });

  it('cite every rule of TERMS-FACTS, and only rules that exist', () => {
    const ids = [...facts.map((f) => f.id), ...absences.map((a) => a.id)];
    const cited = new Set(articles.fr.flatMap((a) => a.refs));
    expect(ids.filter((id) => !cited.has(id))).toEqual([]);
    expect([...cited].filter((id) => !ids.includes(id))).toEqual([]);
    // In order within an article: the rules first, then the absences, each by number.
    const rank = (id: string): number => (id.startsWith('R') ? 0 : 1000) + Number(id.slice(1));
    for (const a of articles.fr) expect([...a.refs].sort((x, y) => rank(x) - rank(y)), `article ${a.n}`).toEqual(a.refs);
  });

  for (const lang of LANGS) {
    it(`${lang}: the article that cites a rule gives its value, as the code has it`, () => {
      const missing: string[] = [];
      for (const f of facts) {
        if (f.constant === '—') continue;
        const phrases = CONSTANTS[f.constant][lang] ?? [];
        const text = articles[lang].filter((a) => a.refs.includes(f.id)).map((a) => a.body).join('\n');
        for (const p of phrases) if (!text.includes(p)) missing.push(`${f.id}: "${p}"`);
      }
      expect(missing).toEqual([]);
    });
  }

  it('say what a result proves as BRAND §4.5 and §4.6 do: the signed identity, a copy, registration is not a title', () => {
    const limits = section(readDoc('docs/BRAND-DESIGN-SYSTEM.md'), '### 4.6');
    expect(limits).toContain('**A copy verifies like the original.**');
    const result = {
      fr: articles.fr.find((a) => a.title === 'Ce que dit un résultat')!,
      en: articles.en.find((a) => a.title === 'What a result says')!,
    };
    const said = {
      fr: [
        "**AUTHENTIC qualifie l'identité ORBES, pas l'objet.**",
        'a été émise et signée par ORBES',
        "**Une copie peut vérifier comme l'original.**",
        'Un code imprimé peut être copié',
        "ORBES Client Services peut examiner une pièce sur demande.",
        "**UNUSUAL ACTIVITY DETECTED est une demande d'examen, jamais un verdict.**",
        "**L'enregistrement n'est pas un titre de propriété.**",
      ],
      en: [
        '**AUTHENTIC qualifies the ORBES identity, not the object.**',
        'was issued and signed by ORBES',
        '**A copy can verify like the original.**',
        'A printed code can be copied',
        'ORBES Client Services can inspect a piece on request.',
        '**UNUSUAL ACTIVITY DETECTED is a request for review, never a verdict.**',
        '**Registration is not a title of ownership.**',
      ],
    };
    for (const lang of LANGS) {
      expect(result[lang], lang).toBeDefined();
      for (const s of said[lang]) expect(result[lang].body, `${lang}: ${s}`).toContain(s);
      // The registration article says it again.
      const registration = articles[lang].find((a) => a.refs.includes('R22'))!;
      expect(registration.body).toContain(lang === 'fr' ? "L'enregistrement n'est pas un titre de propriété" : 'Registration is not a title of ownership');
    }
  });

  it('list every AUTHENTIC result /verify serves, and say what AUTHENTIC — OWNERSHIP VERIFIED means', () => {
    const titles = Object.values(VERIFICATION_COPY)
      .map((c) => c.title)
      .filter((t) => t.startsWith('AUTHENTIC'));
    expect(titles).toContain('AUTHENTIC');
    const list = {
      fr: /Un résultat AUTHENTIC \(([^)]+)\)/,
      en: /An AUTHENTIC result \(([^)]+)\)/,
    } as const;
    for (const lang of LANGS) {
      const body = articles[lang].find((a) => a.refs.includes('R02'))!.body;
      const listed = list[lang].exec(body)?.[1].split(lang === 'fr' ? /, | ou / : /, | or /);
      expect(listed?.sort(), lang).toEqual([...titles].sort());
      // The owner reads OWNERSHIP VERIFIED signed in, whether or not the ownership is verified in article 7's sense.
      expect(body).toContain(lang === 'fr' ? 'que sa propriété soit vérifiée ou non au sens de l\'article 7' : 'whether or not its ownership is verified in the sense of article 7');
    }
  });

  it('never conflate the three marks (BRAND §2.1): the ORBES CODE is not "the seal", the GENOME is no signature', () => {
    for (const lang of LANGS) {
      const text = prose(terms[lang]);
      expect(text, lang).not.toMatch(/\bthe seal\b|\bsceau\b/i);
      expect(text, lang).not.toMatch(/visual signature|signature visuelle|GENOME[^.;:\n]*\bsignature\b/i);
      const code = terms[lang].split('\n').find((l) => l.startsWith('- **ORBES CODE**'))!;
      expect(code, lang).toContain('ORBES SEAL');
      expect(code, lang).toMatch(lang === 'fr' ? /imprimé, marqué à chaud ou gravé/ : /printed, foiled or engraved/);
    }
  });

  it('give the second-hand sentence as /verify shows it and as the packaging kit translates it', () => {
    const transfer = { fr: articles.fr.find((a) => a.refs.includes('R33'))!, en: articles.en.find((a) => a.refs.includes('R33'))! };
    expect(transfer.en.body).toContain(`"${RESALE_GUIDANCE}"`);
    expect(transfer.fr.body).toContain(`« ${kitResaleFr()} »`);
  });

  it('teach one address for the service, theorbes.com/verify', () => {
    for (const lang of LANGS) {
      expect(terms[lang]).toContain('theorbes.com/verify');
      const hosts = new Set([...prose(terms[lang]).matchAll(/(?<![\w.-])(?:[a-z0-9-]+\.)+(?:com|net|org|fr|eu|io|app|co)(?![\w-])/gi)].map((m) => m[0].toLowerCase()));
      expect([...hosts].sort(), lang).toEqual(['theorbes.com', 'verify.theorbes.com']);
    }
  });
});

describe('legal notice (docs/legal/legal-notice.fr.md, legal-notice.en.md)', () => {
  // The owner's identity of 2026-10-03 (choice 16): a Wyoming company, to which French register fields do not apply.
  const IDENTITY: Readonly<Record<Lang, readonly string[]>> = {
    fr: ['Raison sociale : CONGLOMERAT LLC', 'Forme juridique : limited liability company (Wyoming, États-Unis)', 'Siège social : 30 N Gould St, Ste N, Sheridan, WY 82801, États-Unis', 'support@theorbes.com'],
    en: ['Company name: CONGLOMERAT LLC', 'Legal form: limited liability company (Wyoming, United States)', 'Registered office: 30 N Gould St, Ste N, Sheridan, WY 82801, United States', 'support@theorbes.com'],
  };

  for (const lang of LANGS) {
    it(`${lang}: names the publisher, and every remaining [À COMPLÉTER] field is well formed`, () => {
      const fields = placeholders(notices[lang]);
      for (const s of IDENTITY[lang]) expect(notices[lang], s).toContain(s);
      // No field of the French register remains (the intro says why they do not apply).
      expect(notices[lang]).not.toMatch(/^- (Immatriculation|Registration|Numéro de TVA|EU VAT)|^## (Directeur de la publication|Publication director)|au capital de|share capital of/m);
      // Every marker opens a field that closes: an unclosed one would print as text.
      expect(notices[lang].split('[À COMPLÉTER').length - 1).toBe(fields.length);
      expect(terms[lang].split('[À COMPLÉTER').length - 1).toBe(placeholders(terms[lang]).length);
    });

    it(`${lang}: names the hosts, Vercel Inc. for theorbes.com and OVHcloud, in Canada, for verify.theorbes.com`, () => {
      const lines = notices[lang].split('\n');
      const site = lines.find((l) => l.startsWith('- **theorbes.com**'));
      const verify = lines.find((l) => l.startsWith('- **verify.theorbes.com**'));
      expect(site).toContain('Vercel Inc.');
      expect(verify).toContain('OVHcloud');
      expect(verify).toContain('Canada');
      expect(notices[lang]).toContain('2004-575');
      // The GeoIP data's attribution (CC BY 4.0, NOTICE.md).
      expect(notices[lang]).toContain('IP Geolocation by DB-IP');
    });
  }
});

describe('customer copy of docs/legal', () => {
  const COPY = [TERMS.fr, TERMS.en, NOTICE.fr, NOTICE.en] as const;
  const lexicon = forbiddenTerms();

  for (const doc of COPY) {
    it(`${doc}: no forbidden term, English or French, and no exclamation mark`, () => {
      const text = prose(readDoc(doc));
      expect(findForbidden(text, lexicon)).toEqual([]);
      expect(text.match(/!(?!\[)/g) ?? []).toEqual([]);
    });
  }
});

describe('note for counsel, README and links', () => {
  it('raises the Toubon law on the warranty, the care and the instructions in English only, and the consumer mediator', () => {
    const note = readDoc(COUNSEL);
    const toubon = section(note, '## 2. Loi Toubon');
    for (const s of ['loi n° 94-665 du 4 août 1994', 'la garantie', "l'entretien", "le mode d'emploi", 'lang="en"']) expect(toubon, s).toContain(s);
    const mediator = section(note, '## 3. Médiateur de la consommation');
    for (const s of ['L. 612-1', 'médiateur']) expect(mediator, s).toContain(s);
    // Its table of fields names every field of the drafts.
    expect(section(note, '## 1. Champs à compléter')).toContain('Directeur de la publication');
  });

  it('lists every file of docs/legal in the README, and is linked from LAUNCH §10 and BRAND §4.5', () => {
    const readme = readDoc(README);
    const files = readdirSync(join(REPO, LEGAL)).filter((f) => f.endsWith('.md') && f !== 'README.md');
    expect(files.sort()).toEqual(['TERMS-FACTS.md', 'counsel-note.fr.md', 'legal-notice.en.md', 'legal-notice.fr.md', 'terms.en.md', 'terms.fr.md']);
    for (const f of files) expect(readme, f).toContain(`](${f})`);
    expect(readme).toContain('genome/test/docs/terms-facts.test.ts');
    expect(section(readDoc('docs/LAUNCH.md'), '## 10.')).toContain('(legal/README.md)');
    expect(section(readDoc('docs/BRAND-DESIGN-SYSTEM.md'), '### 4.5 Lexicon')).toContain('(legal/README.md)');
  });

  it('links only to files that exist', () => {
    const dead: string[] = [];
    for (const f of readdirSync(join(REPO, LEGAL)).filter((n) => n.endsWith('.md'))) {
      const md = readDoc(`${LEGAL}/${f}`);
      for (const [, target] of md.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(?:[a-z]+:|#)/i.test(target)) continue;
        if (!existsSync(resolve(dirname(join(REPO, LEGAL, f)), target.replace(/#.*$/, '')))) dead.push(`${f}: ${target}`);
      }
    }
    expect(dead).toEqual([]);
  });
});
