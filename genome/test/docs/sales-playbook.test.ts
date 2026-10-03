/**
 * docs/launch/SALES-PLAYBOOK.md (J-09), the sales and shipping playbook, in
 * French, against BRAND-DESIGN-SYSTEM §4 and the code it is written from:
 *
 *  - every code span quotes the software word for word: a whole string
 *    literal of genome/src or genome/scripts (comments stripped, a template's
 *    substitutions written "…": `This scan stays valid for … minutes.`), an
 *    exported name (`SCAN_TOKEN_TTL_MS`), an environment variable the code
 *    reads, or a file of the repository; outside the software only the
 *    identity's placeholder `O26-…`, the console's address, the server's
 *    directory and shell commands (checked against ADMIN_USAGE below). The
 *    labels of MY PIECES (F-01), of the reception of a piece (F-03) and of
 *    the ownership certificate (F-06) are among them;
 *  - the forbidden lexicon of the packaging kit's test (D-02: BRAND §4.5,
 *    "product", the kit's French lexicon) outside the playbook's marked
 *    lexicon block (§8), and no exclamation mark. One exemption, for the
 *    staff instructions: a code span may hold such a word only when it is,
 *    case for case, a label or a status of the software (a whole literal that
 *    starts with a capital: `Products`, `STOLEN`; never a key or an attribute
 *    such as 'token' or 'alert'), one of its constants, or a file;
 *  - every phrase to say to a customer (the blockquotes) held to the lexicon
 *    without that exemption and without any code span; each sheet a customer
 *    hears (§1 to §6) has at least one;
 *  - §3: one section per result of API §9.3 (VERIFICATION_COPY, and the
 *    owner's unusual-activity variant), its served sentence word for word,
 *    and its phrase;
 *  - §0: the numbers equal to the code's constants, and the phrases saying
 *    the same numbers (§4's transfer window: F-03's TRANSFER_TOKEN_TTL_MS);
 *  - §4: F-03's refusal of another piece's transfer code, as served;
 *  - the sale's closing sentence (CLIENT_REGISTRATION), the second-hand
 *    sentence (RESALE_GUIDANCE, and the kit's French word for word), and the
 *    shell commands of §10 as scripts/admin.ts knows them, the TOTP secret
 *    read from ADMIN_TOTP_SECRET, never on a command line;
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
import { SCAN_TOKEN_TTL_MS, TRANSFER_TOKEN_TTL_MS } from '../../src/server/services/scan-tokens.js';
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

/**
 * Text compared without regard to apostrophes, underscores or runs of spaces, case kept: `COUNTERFEIT FLAGGED` is
 * `COUNTERFEIT_FLAGGED` (the console humanizes its statuses), `Products` is not 'products'.
 */
const normalize = (s: string): string =>
  s
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/[_\s]+/g, ' ')
    .trim();

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? typescriptFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

/** Words before which a `/` starts a regular expression, not a division. */
const BEFORE_REGEXP = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

/**
 * The string literals of a JavaScript source (esbuild's output: no types), whole: '…', "…" and each template literal,
 * its substitutions written "…" (`REGISTRATION OPEN UNTIL ${until}` → `REGISTRATION OPEN UNTIL …`). Comments and
 * regular expressions are skipped, so their quotes start nothing. Escapes are kept as the character they escape.
 */
function stringLiterals(js: string): string[] {
  const out: string[] = [];
  let i = 0;
  const char = (): string => (js[i] === '\\' ? js[(i += 2) - 1] : js[i++]);
  /** Code up to the end, or, inside a template's `${`, up to its closing brace. */
  const code = (nested: boolean): void => {
    let depth = 0;
    let last = ''; // the last character of code, or 'a' after a word
    let word = '';
    while (i < js.length) {
      const c = js[i];
      if (c === "'" || c === '"') {
        i++;
        let s = '';
        while (i < js.length && js[i] !== c) s += char();
        i++;
        out.push(s);
        [last, word] = [c, ''];
      } else if (c === '`') {
        i++;
        template();
        [last, word] = ['`', ''];
      } else if (c === '/' && js[i + 1] === '/') {
        while (i < js.length && js[i] !== '\n') i++;
      } else if (c === '/' && js[i + 1] === '*') {
        const end = js.indexOf('*/', i + 2);
        i = end < 0 ? js.length : end + 2;
      } else if (c === '/' && !(/[\w$)\]}'"`]/.test(last) && !BEFORE_REGEXP.has(word))) {
        // A regular expression: up to its closing slash outside a character class, then its flags.
        let inClass = false;
        for (i++; i < js.length && js[i] !== '\n'; i++) {
          if (js[i] === '\\') i++;
          else if (js[i] === '[') inClass = true;
          else if (js[i] === ']') inClass = false;
          else if (js[i] === '/' && !inClass) break;
        }
        for (i++; /[a-z]/.test(js[i] ?? ''); i++);
        [last, word] = [')', ''];
      } else if (/[\w$]/.test(c)) {
        const start = i;
        while (i < js.length && /[\w$]/.test(js[i])) i++;
        [last, word] = ['a', js.slice(start, i)];
      } else {
        if (c === '{') depth++;
        if (c === '}' && depth-- === 0 && nested) {
          i++;
          return;
        }
        if (!/\s/.test(c)) [last, word] = [c, ''];
        i++;
      }
    }
  };
  const template = (): void => {
    const parts: string[] = [];
    let s = '';
    while (i < js.length && js[i] !== '`') {
      if (js[i] === '$' && js[i + 1] === '{') {
        parts.push(s);
        s = '';
        i += 2;
        code(true);
      } else s += char();
    }
    i++;
    out.push([...parts, s].join('…'));
  };
  code(false);
  return out;
}

const SOURCES = ['src', 'scripts'].flatMap((d) => typescriptFiles(join(REPO, 'genome', d))).map((f) => readFileSync(f, 'utf8'));

/** Every string literal of the console, the verify app, the server and the scripts, whole and normalized; never a comment. */
const LITERALS = new Set(
  SOURCES.flatMap((src) => stringLiterals(transformSync(src, { loader: 'ts', legalComments: 'none', charset: 'utf8' }).code)).map(normalize),
);
/** The names the software exports (`SCAN_TOKEN_TTL_MS`, `RESALE_GUIDANCE`). */
const EXPORTS = new Set(
  SOURCES.flatMap((src) => [...src.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])),
);
/** The environment variables the software reads (`ADMIN_PASSWORD`). */
const ENVIRONMENT = new Set(SOURCES.flatMap((src) => [...src.matchAll(/\b(?:env|process\.env)\.([A-Z][A-Z0-9_]+)\b/g)].map((m) => m[1])));

/** A file or directory of the repository, named by its path (`genome/src/web/admin/views/product.ts`). */
const isRepositoryPath = (span: string): boolean => /[/.]/.test(span) && existsSync(join(REPO, span));

/** A code span that quotes the software: a whole literal, an exported name, an environment variable it reads, a file. */
const quotesSoftware = (span: string): boolean => LITERALS.has(normalize(span)) || EXPORTS.has(span) || ENVIRONMENT.has(span) || isRepositoryPath(span);

/**
 * A code span that may hold a forbidden word, the software's own: a label or a status as the screen shows it (a whole
 * literal that starts with a capital; a lowercase literal such as 'token' or 'alert' is a key or an attribute, never
 * a word on screen), one of its constants (`SCAN_TOKEN_TTL_MS`), or a file of the repository.
 */
const isSoftware = (span: string): boolean =>
  (/^\p{Lu}/u.test(span) && LITERALS.has(normalize(span))) || (/^[A-Z][A-Z0-9_]*$/.test(span) && EXPORTS.has(span)) || isRepositoryPath(span);

/** Code spans that quote no text of the software: the identity's placeholder, the console's address, the server's directory, shell commands. */
const NOT_QUOTED: readonly RegExp[] = [
  /^O26-…$/,
  /^https:\/\/verify\.theorbes\.com\/admin$/,
  /^\/opt\/orbes\/orbes-index\/deploy\/vps$/,
  /^(?:docker compose |scripts\/admin\.ts |ADMIN_PASSWORD=|read -rs |unset |clear$|--[a-z]+(?: |$))/,
];

/**
 * The labels the playbook leans on for MY PIECES (F-01), the reception of a piece with the scan's window (F-03) and
 * the ownership certificate (F-06), as /verify shows them.
 */
const OWNER_LABELS: readonly string[] = [
  'MY PIECES',
  'REPORT LOST / STOLEN',
  'CONFIRM REPORT',
  'PIECE FOUND',
  'CHANGE PASSWORD',
  'RECEIVING THIS PIECE',
  'VERIFY AGAIN',
  'RECEIVE THIS PIECE',
  'OWNERSHIP CERTIFICATE',
  'CREATE CERTIFICATE',
  'CREATE LINK',
  'WITHDRAW',
  'NO LONGER VALID',
];
/** F-03's 409 TRANSFER_PRODUCT_MISMATCH, as /verify serves it. */
const TRANSFER_PRODUCT_MISMATCH = 'This transfer code is not for this piece. Check the code with the owner of this piece.';

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
    const own = [
      'Products',
      'Product',
      'PRODUCT',
      'PRODUCT ID',
      'STOLEN',
      'COUNTERFEIT FLAGGED',
      'LOST STOLEN SCAN',
      'Counterfeit signals by country',
      'SCAN_TOKEN_TTL_MS',
      'SALE_TOKEN_TTL_MS',
      'genome/src/web/admin/views/product.ts',
    ];
    for (const span of own) expect(isSoftware(span), span).toBe(true);
    // A whole literal, never a piece of one or of an identifier; a label as the screen writes it, never a lowercase key
    // ('token', role 'alert'); and comments are stripped first: a word the code only explains is not one it shows.
    const notOwn = [
      'token',
      'fake',
      'QR',
      'counterfeit',
      'genuine',
      'crypto',
      'alert',
      'Counterfeit',
      '100 % GENUINE',
      'produit',
      'pièce volée',
      'contrefaçon',
      'a counterfeit piece',
      'genome/src/web/admin/views/produit.ts',
    ];
    for (const span of notOwn) expect(isSoftware(span), span).toBe(false);
  });

  it('reads the software’s literals whole: quotes, templates with their substitutions, never a comment or a regular expression', () => {
    const js = [
      "const a = 'it\\'s', b = \"say \\\"so\\\"\";",
      'const t = `REGISTRATION OPEN UNTIL ${f(`inner ${x}`, { y: 1 })} today`;',
      "const r = /don't ['\"`]/g.test(a) ? a / 2 / 3 : 'after';",
      'function g() { return /"not a string"/.source; }',
      "// 'a comment'",
      "/* 'another' */ const z = 'last';",
    ].join('\n');
    expect(stringLiterals(js).sort()).toEqual(["it's", 'say "so"', 'inner …', 'REGISTRATION OPEN UNTIL … today', 'after', 'last'].sort());
  });

  it('quotes the software in every code span: its labels, statuses, constants and files, word for word', () => {
    const unquoted = codeSpans(playbook).filter((span) => !quotesSoftware(span) && !NOT_QUOTED.some((r) => r.test(span)));
    expect(unquoted).toEqual([]);
    // The spans the brief's sheets lean on, from the console and from /verify.
    for (const span of ['Activate warranty', 'READY TO SELL', 'Recovery code', 'This scan stays valid for … minutes.', 'REGISTRATION OPEN UNTIL …', 'UPLOAD A PHOTO']) {
      expect(codeSpans(playbook), span).toContain(span);
      expect(quotesSoftware(span), span).toBe(true);
    }
    // A label that drifts by one word, a piece of a literal, or a word only in a comment quotes nothing.
    for (const span of ['Activate warranty now', 'Activate warrant', 'REGISTRATION OPEN UNTIL', 'Scan the code', 'counterfeit simulation']) {
      expect(quotesSoftware(span), span).toBe(false);
    }
  });

  it('names MY PIECES (F-01), the reception of a piece (F-03) and the ownership certificate (F-06) as their code has them', () => {
    for (const label of OWNER_LABELS) {
      expect(codeSpans(playbook), label).toContain(label);
      expect(quotesSoftware(label), label).toBe(true);
    }
    // The buyer handed the code of another piece reads F-03's refusal (409 TRANSFER_PRODUCT_MISMATCH), word for word.
    expect(sheet(4)).toContain(`*${TRANSFER_PRODUCT_MISMATCH}*`);
    expect(LITERALS.has(normalize(TRANSFER_PRODUCT_MISMATCH))).toBe(true);
    // The certificate attests a record, not the object (BRAND §4.6): the resale sheet says so, and the buyer still scans.
    const certificate = subsection(sheet(4), '### Le certificat de propriété (vente à distance)');
    expect(certificate).toContain('il ne dit pas AUTHENTIC');
    expect(quotes(certificate).join(' ')).toContain('scannez l\'ORBES CODE de la pièce');
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
    // The buyer's window (F-03): the transfer token's own constant.
    const transferWindowMs = TRANSFER_TOKEN_TTL_MS;
    expect(said(4)).toContain(`dans les ${transferWindowMs / MIN} minutes qui suivent le scan`);
    expect(sheet(4)).toContain(`plus de ${transferWindowMs / MIN} minutes ont passé`);
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
    // The TOTP secret, like the password, never on a command line (the shell history, the process list):
    // read without echo, passed by the environment, cleared from the screen and unset.
    expect(playbook).not.toMatch(/scripts\/admin\.ts totp-enable[^\n`]*--secret/);
    expect(ADMIN_USAGE).toContain('ADMIN_TOTP_SECRET');
    expect(operator).toMatch(
      /totp-setup[^\n]*\nread -rs ADMIN_TOTP_SECRET && export ADMIN_TOTP_SECRET[^\n]*\nclear\b[^\n]*\ndocker compose exec -e ADMIN_TOTP_SECRET app node --import tsx scripts\/admin\.ts totp-enable [^\n]*\nunset ADMIN_TOTP_SECRET\n/,
    );
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
