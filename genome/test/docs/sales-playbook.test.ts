/**
 * docs/launch/SALES-PLAYBOOK.md (J-09), the sales and shipping playbook, in
 * French, against BRAND-DESIGN-SYSTEM §4 and the code it is written from:
 *
 *  - the forbidden lexicon of the packaging kit's test (D-02: BRAND §4.5,
 *    "product", the kit's French lexicon) outside the playbook's marked
 *    lexicon block (§8), and no exclamation mark. One exemption, for the
 *    staff instructions: a code span quotes the software (a console label
 *    such as `Products`, a status such as `STOLEN`, a constant, a file), so it
 *    may hold such a word only when that very text is the software's own: in
 *    the sources of genome/src and genome/scripts once their comments are
 *    stripped, or the path of a file of the repository;
 *  - every phrase to say to a customer (the blockquotes) held to the lexicon
 *    without that exemption and without any code span; each sheet a customer
 *    hears (§1 to §6) has at least one;
 *  - §3: one section per result of API §9.3 (VERIFICATION_COPY, and the
 *    owner's unusual-activity variant), its served sentence word for word,
 *    and its phrase;
 *  - §0: the numbers equal to the code's constants, and the phrases saying
 *    the same numbers;
 *  - the sale's closing sentence (CLIENT_REGISTRATION), the second-hand
 *    sentence (RESALE_GUIDANCE, and the kit's French word for word), and the
 *    shell commands of §10 as scripts/admin.ts knows them;
 *  - §9: the six steps of the brief, at most 30 minutes in all;
 *  - theorbes.com and verify.theorbes.com as its only addresses, relative
 *    links that resolve, and the playbook linked from LAUNCH §7.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { ADMIN_USAGE } from '../../scripts/admin.js';
import { VERIFICATION_STATES } from '../../src/server/db/schema.js';
import { RECOVERY_ATTEMPT_LIMIT, RECOVERY_ATTEMPT_WINDOW_MS, RECOVERY_CODE_TTL_MS, TRANSFER_FREEZE_MS } from '../../src/server/services/account-recovery.js';
import { ADMIN_LOCKOUT_MS, ADMIN_LOCKOUT_THRESHOLD, PASSWORD_MIN_LENGTH } from '../../src/server/services/auth.js';
import { UNUSUAL_ACTIVITY_OWNER_COPY, VERIFICATION_COPY } from '../../src/server/services/copy.js';
import { CLAIM_ATTEMPT_LIMIT, CLAIM_ATTEMPT_WINDOW_MS, TRANSFER_TTL_MS } from '../../src/server/services/ownership.js';
import { SALE_TOKEN_TTL_MS } from '../../src/server/services/sale.js';
import { SCAN_TOKEN_TTL_MS } from '../../src/server/services/scan-tokens.js';
import { CLIENT_REGISTRATION } from '../../src/web/admin/model/sale.js';
import { RESALE_GUIDANCE } from '../../src/web/verify/copy.js';
import {
  LEXICON_BEGIN,
  LEXICON_END,
  PACKAGING_KIT,
  REPO,
  codeSpans,
  findForbidden,
  forbiddenTerms,
  readDoc,
  section,
  splitLexicon,
  withoutCodeSpans,
} from './lexicon.js';

const PLAYBOOK = 'docs/launch/SALES-PLAYBOOK.md';
const playbook = readDoc(PLAYBOOK);
const terms = forbiddenTerms();

/** The sheets the plan asks for, in this order. */
const SHEETS = [
  '## 0. Avant la première pièce',
  '## 1. Vente en boutique',
  '## 2. Expédition en ligne',
  '## 3. Client inquiet',
  '## 4. Revente',
  '## 5. Perte ou vol',
  '## 6. Mot de passe oublié',
  '## 7. Scans personnels du personnel',
  '## 8. Lexique interdit',
  '## 9. Checklist de 30 minutes sur une pièce test',
  '## 10. Créer un OPERATOR nominatif',
  '## 11. Validation',
] as const;
const sheet = (n: number): string => section(playbook, SHEETS[n]);

/** Text compared without regard to case, apostrophes, underscores or runs of spaces: `COUNTERFEIT FLAGGED` is `COUNTERFEIT_FLAGGED`. */
const normalize = (s: string): string =>
  s
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/[_\s]+/g, ' ')
    .toUpperCase()
    .trim();

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? typescriptFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

/** The code of the console, the verify app, the server and the scripts, without a single comment, normalized. */
const SOFTWARE = normalize(
  ['src', 'scripts']
    .flatMap((d) => typescriptFiles(join(REPO, 'genome', d)))
    .map((f) => transformSync(readFileSync(f, 'utf8'), { loader: 'ts', legalComments: 'none', charset: 'utf8' }).code)
    .join('\n'),
);

/** A code span that quotes the software: its text is in the code, or it is the path of a file of the repository. */
const isSoftware = (span: string): boolean => SOFTWARE.includes(normalize(span)) || existsSync(join(REPO, span));

/** The blockquotes of a markdown text (the phrases to say), each as plain text without its `>` markers. */
function quotes(md: string): string[] {
  const out: string[] = [];
  let current: string[] | null = null;
  for (const line of md.split('\n')) {
    if (line.startsWith('>')) (current ??= []).push(line.replace(/^>\s?/, ''));
    else if (current) {
      out.push(current.join(' ').trim());
      current = null;
    }
  }
  if (current) out.push(current.join(' ').trim());
  return out;
}

/** Body of the `###` subsection whose heading line is exactly `heading`, up to the next heading. */
function subsection(md: string, heading: string): string {
  const lines = md.split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`no heading "${heading}"`);
  let end = start + 1;
  while (end < lines.length && !/^#{1,3} /.test(lines[end])) end++;
  return lines.slice(start + 1, end).join('\n');
}

/** Cells of the rows of the first table in `md` whose header row is exactly `header`, separator excluded. */
function tableRows(md: string, header: string): string[][] {
  const lines = md.split('\n');
  const head = lines.indexOf(header);
  if (head < 0) throw new Error(`no table "${header}"`);
  const rows: string[][] = [];
  for (const line of lines.slice(head + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  }
  return rows;
}

describe('sales playbook (docs/launch/SALES-PLAYBOOK.md)', () => {
  it('has one sheet per situation of the plan, in order', () => {
    expect(playbook.split('\n').filter((l) => l.startsWith('## '))).toEqual([...SHEETS]);
  });

  it('marks exactly one lexicon block, in the lexicon sheet', () => {
    expect(playbook.split(LEXICON_BEGIN)).toHaveLength(2);
    expect(playbook.split(LEXICON_END)).toHaveLength(2);
    expect(sheet(8)).toContain(LEXICON_BEGIN);
    expect(sheet(8)).toContain(LEXICON_END);
    // The lexicon names the terms a seller is most tempted by, and points to the whole tables.
    const { lexicon } = splitLexicon(playbook);
    for (const t of ['100 % authentique', 'certifié original', 'contrefaçon', 'volé', 'QR code', 'produit']) expect(findForbidden(lexicon, [t]), t).not.toEqual([]);
    expect(lexicon).toContain('BRAND §4.5');
    expect(lexicon).toContain('(PACKAGING-KIT.md), §4');
  });

  it('writes no forbidden term, English or French, outside the lexicon, except where a code span quotes the software', () => {
    const { rest } = splitLexicon(playbook);
    // A link's target is an address, not words (`../assets/ui/admin-02-product.png`); 'links only to files that exist' checks it.
    expect(findForbidden(withoutCodeSpans(rest).replace(/\]\([^)\s]+\)/g, ']'), terms)).toEqual([]);
    const notSoftware = codeSpans(rest).filter((span) => findForbidden(span, terms).length > 0 && !isSoftware(span));
    expect(notSoftware).toEqual([]);
  });

  it('exempts only the software’s own words: a console label or status, a constant, a file of the repository', () => {
    for (const span of ['Products', 'STOLEN', 'COUNTERFEIT FLAGGED', 'LOST STOLEN SCAN', 'SCAN_TOKEN_TTL_MS', 'PRODUCT ID', 'genome/src/web/admin/views/product.ts']) {
      expect(isSoftware(span), span).toBe(true);
    }
    // Comments are stripped first: a word the code only explains is not one it shows.
    for (const span of ['100 % GENUINE', 'produit', 'pièce volée', 'contrefaçon', 'a counterfeit piece', 'genome/src/web/admin/views/produit.ts']) {
      expect(isSoftware(span), span).toBe(false);
    }
  });

  it('holds every phrase to say to the lexicon without exemption: no code span, no forbidden term', () => {
    const phrases = quotes(splitLexicon(playbook).rest);
    expect(phrases.length).toBeGreaterThanOrEqual(20);
    for (const q of phrases) {
      expect(q, q).not.toContain('`');
      expect(findForbidden(q, terms), q).toEqual([]);
    }
    // Every sheet a customer hears has its words.
    for (const n of [1, 2, 3, 4, 5, 6]) expect(quotes(sheet(n)).length, SHEETS[n]).toBeGreaterThan(0);
  });

  it('writes no exclamation mark (BRAND §4.1)', () => {
    const text = splitLexicon(playbook).rest.replace(/<!--[\s\S]*?-->/g, '');
    expect(text.match(/!(?!\[)/g) ?? []).toEqual([]);
  });

  it('gives each result of API §9.3 its meaning, its sentence as served and a phrase to say', () => {
    const worried = sheet(3);
    const results = [
      ...VERIFICATION_STATES.map((s) => ({ heading: `### ${VERIFICATION_COPY[s].title}`, message: VERIFICATION_COPY[s].message })),
      { heading: `### ${UNUSUAL_ACTIVITY_OWNER_COPY.title}, avec une activité inhabituelle`, message: UNUSUAL_ACTIVITY_OWNER_COPY.message },
    ];
    expect(worried.split('\n').filter((l) => l.startsWith('### '))).toHaveLength(results.length);
    for (const r of results) {
      const body = subsection(worried, r.heading);
      expect(body, r.heading).toContain(`Le client lit : *${r.message}*`);
      expect(body, r.heading).toContain('**Ce que cela veut dire.**');
      expect(body, r.heading).toContain('**Ce que vous faites.**');
      expect(quotes(body).length, r.heading).toBeGreaterThan(0);
    }
    // What a positive result proves, as BRAND §4.6 says it: a printed code can be copied, and a human can inspect.
    const proves = quotes(worried.split('### ')[0]).join(' ');
    expect(proves).toContain('Un code imprimé peut être copié');
    expect(proves).toContain('ORBES Client Services peut examiner une pièce sur demande');
  });

  it('teaches the numbers of the code (§0), and its phrases say the same', () => {
    const MIN = 60_000;
    const HOUR = 60 * MIN;
    const DAY = 24 * HOUR;
    // "par heure" in the table: both attempt limits count over one hour.
    expect(CLAIM_ATTEMPT_WINDOW_MS).toBe(HOUR);
    expect(RECOVERY_ATTEMPT_WINDOW_MS).toBe(HOUR);
    const expected: Record<string, string> = {
      SCAN_TOKEN_TTL_MS: `${SCAN_TOKEN_TTL_MS / MIN} minutes`,
      SALE_TOKEN_TTL_MS: `${SALE_TOKEN_TTL_MS / MIN} minutes`,
      CLAIM_ATTEMPT_LIMIT: String(CLAIM_ATTEMPT_LIMIT),
      TRANSFER_TTL_MS: `${TRANSFER_TTL_MS / DAY} jours`,
      RECOVERY_CODE_TTL_MS: `${RECOVERY_CODE_TTL_MS / MIN} minutes`,
      RECOVERY_ATTEMPT_LIMIT: String(RECOVERY_ATTEMPT_LIMIT),
      TRANSFER_FREEZE_MS: `${TRANSFER_FREEZE_MS / HOUR} heures`,
      PASSWORD_MIN_LENGTH: `${PASSWORD_MIN_LENGTH} caractères`,
      ADMIN_LOCKOUT_THRESHOLD: String(ADMIN_LOCKOUT_THRESHOLD),
      ADMIN_LOCKOUT_MS: `${ADMIN_LOCKOUT_MS / MIN} minutes`,
    };
    const rows = tableRows(sheet(0), '| Règle | Valeur | Source |');
    const taught = Object.fromEntries(rows.map(([, value, source]) => [source.replace(/`/g, ''), value]));
    expect(taught).toEqual(expected);

    const said = (n: number) => quotes(sheet(n)).join(' ');
    expect(sheet(3)).toContain(`pendant ${expected.SCAN_TOKEN_TTL_MS} après le scan`);
    expect(said(4)).toContain(`valable ${expected.TRANSFER_TTL_MS}`);
    expect(said(4)).toContain(`dans les ${expected.SCAN_TOKEN_TTL_MS} qui suivent le scan`);
    expect(said(6)).toContain(`valable ${expected.RECOVERY_CODE_TTL_MS}`);
    expect(said(6)).toContain(`pendant ${expected.TRANSFER_FREEZE_MS}`);
    expect(said(6)).toContain(`de ${expected.PASSWORD_MIN_LENGTH} au moins`);
    expect(sheet(1)).toContain(`dans les ${expected.SALE_TOKEN_TTL_MS} qui suivent le scan`);
  });

  it('closes a sale with the sentence of the sale mode, word for word, and hands over the card unscratched', () => {
    const shop = sheet(1);
    expect(shop).toContain(`\`${CLIENT_REGISTRATION}\``);
    expect(shop).toContain('zone à gratter intacte');
    expect(quotes(shop).join(' ')).toContain('theorbes.com/verify');
    // Online, the warranty starts in the console, with a country, before the parcel leaves.
    const online = sheet(2);
    expect(online).toContain('avant l\'envoi');
    expect(online).toContain('`Country` : le pays de livraison');
    expect(online).toMatch(/jamais à l'extérieur du colis/);
  });

  it('gives the second-hand sentence as /verify shows it (RESALE_GUIDANCE) and as the kit translates it', () => {
    const kitRows = section(readDoc(PACKAGING_KIT), '## 3. Second-hand purchase')
      .split('\n')
      .filter((l) => l.startsWith('|'))
      .map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    const [en, fr] = kitRows[2];
    expect(en).toBe(RESALE_GUIDANCE);
    const resale = sheet(4);
    expect(resale).toContain(`*${RESALE_GUIDANCE}*`);
    expect(quotes(resale)).toContain(fr);
  });

  it('creates a nominative OPERATOR with the commands scripts/admin.ts knows, the second factor enrolled from the shell', () => {
    const operator = sheet(10);
    // The brief's command, word for word, and its form on the server.
    expect(operator).toContain('`ADMIN_PASSWORD=… node --import tsx scripts/admin.ts create --email … --role OPERATOR`');
    expect(operator).toContain('docker compose exec -e ADMIN_PASSWORD app node --import tsx scripts/admin.ts create --email');
    const commands = [...playbook.matchAll(/scripts\/admin\.ts ([a-z-]+)/g)].map((m) => m[1]);
    expect(new Set(commands)).toEqual(new Set(['create', 'totp-setup', 'totp-enable', 'list', 'disable']));
    for (const c of commands) expect(ADMIN_USAGE, c).toMatch(new RegExp(`^  ${c}\\b`, 'm'));
    for (const flag of new Set([...playbook.matchAll(/scripts\/admin\.ts [^\n`]*/g)].flatMap((m) => [...m[0].matchAll(/--[a-z]+/g)].map((f) => f[0])))) {
      expect(ADMIN_USAGE, flag).toContain(flag);
    }
    expect(operator).toMatch(/totp-setup[\s\S]*totp-enable/);
    expect(operator).toContain('en main propre');
    expect(operator).toContain('SECURITY-MODEL §3.3');
  });

  it('times the checklist at 30 minutes at most, with the six steps of the brief, each written out', () => {
    const checklist = sheet(9);
    const rows = tableRows(checklist, '| Étape | Ce que vous faites | Durée |');
    const steps = rows.filter(([n]) => /^\d+$/.test(n));
    expect(steps.map(([n]) => Number(n))).toEqual(steps.map((_, i) => i + 1));
    const minutes = steps.map(([, , d]) => Number(/^(\d+) min$/.exec(d)?.[1]));
    for (const m of minutes) expect(m).toBeGreaterThan(0);
    const total = minutes.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(30);
    expect(rows.at(-1)).toEqual(['', '**Total**', `**${total} min**`]);
    // Scan, activate, register with a test account, transfer, read an UNKNOWN result, find the scan.
    const what = steps.map(([, w]) => w).join('\n');
    for (const word of ['Scanner', 'Activer', 'Enregistrer la pièce avec le compte test', 'Transférer', 'UNKNOWN', 'Retrouver le scan']) expect(what, word).toContain(word);
    // Each step of the table is written out under its own heading, with the same duration.
    for (const [n, w, d] of steps) expect(checklist, `step ${n}`).toContain(`### Étape ${n} — ${w} (${d})`);
  });

  it('teaches one customer address, theorbes.com/verify, and the console at verify.theorbes.com', () => {
    const hosts = new Set([...playbook.matchAll(/(?<![\w.-])(?:[a-z0-9-]+\.)+(?:com|net|org|fr|eu|io|app|co|shop|store|link|ly)(?![\w-])/gi)].map((m) => m[0].toLowerCase()));
    expect([...hosts].sort()).toEqual(['theorbes.com', 'verify.theorbes.com']);
    expect(playbook).toContain('`https://verify.theorbes.com/admin`');
  });

  it('links only to files that exist', () => {
    const here = dirname(join(REPO, PLAYBOOK));
    const targets = [...playbook.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((t) => !/^(?:[a-z]+:|#)/i.test(t));
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((t) => !existsSync(resolve(here, t.replace(/#.*$/, ''))))).toEqual([]);
  });

  it('is linked from LAUNCH §7, before the first sale', () => {
    expect(section(readDoc('docs/LAUNCH.md'), '## 7.')).toContain('(launch/SALES-PLAYBOOK.md)');
  });
});
