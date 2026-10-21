/**
 * An email in the house's look (macro scope E0; lot M1 plan §4.1): the words of a kind (email/copy.ts, or the console's
 * own) filled with the trigger's values, as plain text and as HTML, rendered once at enqueue so the outbox keeps exactly
 * what is sent.
 *
 * The look, for mail clients (tables and inline styles, no web font, no script, no form):
 *  - the vault's ground #0a0a0a and its ivory #f6f2ea, ash #a7a29a for the quiet lines, a hairline;
 *  - the monogram (a PNG on its ink disc, GET /api/v1/email/monogram.png, never an SVG: most clients refuse one) and
 *    ORBES tracked in capitals, in Helvetica Neue and its fallbacks;
 *  - the button: a hairline frame, its words tracked in capitals;
 *  - under the hairline, why the email is received, STOP THESE EMAILS on an email that can be stopped, ORBES · PARIS.
 * A client that prefers light reads the same email on white with the ink (the `color-scheme` meta and one media query,
 * as the app's light mode); the others keep the ground.
 *
 * Every value and every word is escaped: a placeholder never adds markup (a first name comes from a public form). A
 * link value must be an absolute http(s) address, or its button is left out.
 */
import { MONOGRAM_BOUNDS, MONOGRAM_PATHS } from '../../core/render/monogram.js';
import { EMAIL_SUBJECT_MAX, type EmailKind } from '../db/schema.js';
import { svgToPng } from '../render/png.js';
import { PARIS_TIME_ZONE } from '../services/schedule.js';
import { EMAIL_DEFAULTS, EMAIL_FRAME, OPT_IN_KINDS, type EmailWords } from './copy.js';

/** The house's colours in an email (web/shared/brand.css: the vault's ground, ink, soft and hairline; light.css's). */
export const EMAIL_COLOURS = Object.freeze({
  ground: '#0a0a0a',
  ivory: '#f6f2ea',
  ash: '#a7a29a',
  hairline: '#2b2a29',
  light: Object.freeze({ ground: '#ffffff', ink: '#0a0a0a', soft: '#5c5c5c', hairline: '#e2e2e2' }),
});

/** The monogram's address under the platform's origin (routes/email.ts). */
export const EMAIL_MONOGRAM_PATH = '/api/v1/email/monogram.png';
/** The monogram's size in the email (CSS pixels); the PNG is drawn at twice that for sharp screens. */
export const EMAIL_MONOGRAM_SIZE = 44;

/** A value a trigger gives a placeholder: words, a link, an instant (written in Paris time), or nothing. */
export type EmailValue = string | Date | null | undefined;
export type EmailValues = Readonly<Record<string, EmailValue>>;

export interface RenderInput {
  kind: EmailKind;
  /** The kind's words: the console's, or EMAIL_DEFAULTS. */
  words: EmailWords;
  values: EmailValues;
  /** The platform's origin (the monogram's address). */
  origin: string;
  /** The page that stops this email (an email that can be stopped), or null. */
  unsubscribeUrl: string | null;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** A value, at most (characters): a placeholder never floods an email. */
const VALUE_MAX = 500;

/** `Wednesday 5 November at 19:00`: an instant in Paris time, as the emails write it. */
export function emailWhen(at: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: PARIS_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month} at ${parts.hour}:${parts.minute}`;
}

/** Whether a placeholder holds an address (its button, its link). */
const isLinkName = (name: string): boolean => name === 'link' || /(?:Link|Url)$/.test(name);

/** An absolute http(s) address without credentials or space, or null. */
export function safeLink(value: string): string | null {
  if (!/^https?:\/\/[^\s<>"'`]+$/.test(value) || value.length > 2_048) return null;
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.username === '' && u.password === '' ? value : null;
  } catch {
    return null;
  }
}

/** The values as words: an instant in Paris time, every control character a space, at most VALUE_MAX characters. */
function words(values: EmailValues): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, raw] of Object.entries(values)) {
    if (raw === undefined || raw === null) continue;
    const text = (raw instanceof Date ? emailWhen(raw) : String(raw)).replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').replace(/ {2,}/g, ' ').trim().slice(0, VALUE_MAX);
    if (isLinkName(name)) {
      const link = safeLink(text);
      if (link !== null) out.set(name, link);
    } else {
      out.set(name, text);
    }
  }
  // The greeting never reads « , »: without a first name, Hello.
  if (!out.get('firstName')) out.set('firstName', EMAIL_FRAME.noName);
  return out;
}

/** `{name}` filled with its value; a placeholder without one stays as it is written. */
function fill(template: string, values: Map<string, string>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (whole, name: string) => values.get(name) ?? whole);
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A body's blocks: its paragraphs, and its buttons (`[WORDS]({link})` alone in a paragraph). */
type Block = { kind: 'p'; text: string } | { kind: 'button'; label: string; href: string };

function blocks(body: string, values: Map<string, string>): Block[] {
  const out: Block[] = [];
  for (const raw of body.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    const paragraph = raw.trim();
    if (paragraph === '') continue;
    const button = /^\[([^\]\n]{1,80})\]\(([^)\s]+)\)$/.exec(paragraph);
    if (button) {
      const href = safeLink(fill(button[2]!, values));
      if (href !== null) out.push({ kind: 'button', label: fill(button[1]!, values).trim().toUpperCase(), href });
      continue;
    }
    out.push({ kind: 'p', text: fill(paragraph, values) });
  }
  return out;
}

/** The subject as sent: filled, one line, at most EMAIL_SUBJECT_MAX characters; the kind's default when it is empty. */
function subjectOf(kind: EmailKind, template: string, values: Map<string, string>): string {
  const line = (t: string) => fill(t, values).replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, EMAIL_SUBJECT_MAX).trim();
  return line(template) || line(EMAIL_DEFAULTS[kind].subject);
}

/** Why this email is received (the frame's line under the hairline). */
function reasonOf(kind: EmailKind): string {
  if (kind === 'FOUNDING_ANNOUNCEMENT' || kind === 'RELEASE_NOTICE') return EMAIL_FRAME.reason[kind];
  return EMAIL_FRAME.reason.account;
}

const FONT = `'Helvetica Neue', Helvetica, Arial, sans-serif`;

/** The kind's email, in text and in HTML. */
export function renderEmail(input: RenderInput): RenderedEmail {
  const values = words(input.values);
  const subject = subjectOf(input.kind, input.words.subject, values);
  const body = blocks(input.words.body, values);
  const unsubscribe = OPT_IN_KINDS.has(input.kind) && input.unsubscribeUrl !== null ? safeLink(input.unsubscribeUrl) : null;
  const reason = reasonOf(input.kind);

  const text = [
    EMAIL_FRAME.wordmark,
    '',
    ...body.flatMap((b) => (b.kind === 'p' ? [b.text, ''] : [`${b.label}: ${b.href}`, ''])),
    '—',
    '',
    reason,
    ...(unsubscribe ? [`${EMAIL_FRAME.stop}: ${unsubscribe}`] : []),
    '',
    EMAIL_FRAME.foot,
    '',
  ].join('\n');

  const c = EMAIL_COLOURS;
  const preheader = body.find((b, i) => b.kind === 'p' && i > 0) ?? body.find((b) => b.kind === 'p');
  const paragraph = (t: string) =>
    `<tr><td class="o-ink" style="padding:0 0 22px 0;font-family:${FONT};font-size:15px;line-height:1.65;color:${c.ivory};">${escapeHtml(t).replace(/\n/g, '<br>')}</td></tr>`;
  // A button followed by another sits close to it: the two read as one choice.
  const button = (label: string, href: string, next: Block | undefined) =>
    `<tr><td style="padding:6px 0 ${next?.kind === 'button' ? 8 : 30}px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="o-button" style="border:1px solid ${c.ivory};"><a class="o-ink" href="${escapeHtml(href)}" style="display:inline-block;padding:15px 28px;font-family:${FONT};font-size:12px;line-height:1;letter-spacing:0.24em;color:${c.ivory};text-decoration:none;">${escapeHtml(label)}</a></td></tr></table></td></tr>`;
  const monogram = `${input.origin}${EMAIL_MONOGRAM_PATH}`;
  const html = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="dark light">',
    '<meta name="supported-color-schemes" content="dark light">',
    `<title>${escapeHtml(subject)}</title>`,
    '<style>',
    ':root{color-scheme:dark light;supported-color-schemes:dark light;}',
    'a{color:inherit;}',
    '@media (prefers-color-scheme: light){',
    `.o-ground{background:${c.light.ground}!important;}`,
    `.o-ink{color:${c.light.ink}!important;}`,
    `.o-soft{color:${c.light.soft}!important;}`,
    `.o-rule{border-top-color:${c.light.hairline}!important;}`,
    `.o-button{border-color:${c.light.ink}!important;}`,
    '}',
    '@media (max-width:620px){.o-frame{padding:40px 24px!important;}}',
    '</style>',
    '</head>',
    `<body class="o-ground" style="margin:0;padding:0;background:${c.ground};">`,
    preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader.kind === 'p' ? preheader.text : '')}</div>` : '',
    `<table role="presentation" class="o-ground" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${c.ground};">`,
    '<tr><td align="center" style="padding:0;">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">`,
    `<tr><td class="o-frame" style="padding:56px 32px 48px 32px;">`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">',
    `<tr><td align="center" style="padding:0 0 14px 0;"><img src="${escapeHtml(monogram)}" width="${EMAIL_MONOGRAM_SIZE}" height="${EMAIL_MONOGRAM_SIZE}" alt="" style="display:block;border:0;width:${EMAIL_MONOGRAM_SIZE}px;height:${EMAIL_MONOGRAM_SIZE}px;"></td></tr>`,
    `<tr><td align="center" class="o-ink" style="padding:0 0 40px 0;font-family:${FONT};font-size:13px;line-height:1;letter-spacing:0.42em;color:${c.ivory};">${EMAIL_FRAME.wordmark}</td></tr>`,
    ...body.map((b, i) => (b.kind === 'p' ? paragraph(b.text) : button(b.label, b.href, body[i + 1]))),
    `<tr><td class="o-rule" style="padding:0;border-top:1px solid ${c.hairline};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>`,
    `<tr><td class="o-soft" style="padding:24px 0 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${c.ash};">${escapeHtml(reason)}</td></tr>`,
    unsubscribe
      ? `<tr><td style="padding:14px 0 0 0;"><a class="o-soft" href="${escapeHtml(unsubscribe)}" style="font-family:${FONT};font-size:11px;line-height:1.6;letter-spacing:0.2em;color:${c.ash};text-decoration:underline;">${EMAIL_FRAME.stop}</a></td></tr>`
      : '',
    `<tr><td class="o-soft" style="padding:28px 0 0 0;font-family:${FONT};font-size:11px;line-height:1;letter-spacing:0.24em;color:${c.ash};">${escapeHtml(EMAIL_FRAME.foot)}</td></tr>`,
    '</table>',
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');

  return { subject, text, html: `${html}\n` };
}

// ── The monogram ───────────────────────────────────────────────────────────

/** The monogram's PNG, drawn once: the master outlines in ivory on an ink disc (it reads on a light page too). */
export function emailMonogramSvg(): string {
  const size = 96;
  const ink = 64;
  const b = MONOGRAM_BOUNDS;
  const k = ink / b.w;
  const tx = (size - ink) / 2 - b.x * k;
  const ty = (size - b.h * k) / 2 - b.y * k;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${EMAIL_COLOURS.ground}"/>` +
    `<g fill="${EMAIL_COLOURS.ivory}" transform="matrix(${k} 0 0 ${k} ${tx} ${ty})">${MONOGRAM_PATHS.map((d) => `<path d="${d}"/>`).join('')}</g>` +
    `</svg>`
  );
}

let monogramPng: Promise<Uint8Array> | null = null;

/** The monogram's PNG (96 × 96, shown at 44), drawn on first use and kept. */
export function emailMonogramPng(): Promise<Uint8Array> {
  monogramPng ??= svgToPng(emailMonogramSvg(), { widthPx: EMAIL_MONOGRAM_SIZE * 2, dpi: 144 }).catch((e) => {
    monogramPng = null;
    throw e;
  });
  return monogramPng;
}
