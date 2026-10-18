/**
 * The desktop's content parity (plan DESKTOP §2(j), step 13; desktop.content-parity.harness.ts): every word of a phone's
 * state is shown by its computer twin (the desk-* state made from it), or moved on purpose as DESKTOP_MOVED lists it.
 *
 * The parity itself is checked on the pages, in the desktop shards of the content test (nocturne.content.harness.ts,
 * desk-1 … desk-12, which open every desk state: the phone's values are looked for there, and those moved to another
 * page on that page). This file holds the list to the baselines (test/fixtures/nocturne-baseline.json), with no browser:
 *
 *  - every desk state made from a phone's names a phone state of the baseline, and is its twin unless NOT_TWINS says
 *    why it shows another screen; NOT_TWINS names desk states that exist;
 *  - DESKTOP_MOVED: each entry names phone states with a computer twin and values those states show on the phone, says
 *    why and where they are now, and is one of shown apart, moved to a page, left out, or a count of another moment of
 *    the run; and is needed: none excuses a value its twin already shows (each listed value, or for a state's every
 *    value moved, at least one value, is missing from the twin's recorded words);
 *  - DESKTOP_WORDS: each phone phrase is a phrase the phone shows, and where a twin shows it on the phone, the
 *    computer's phrase is in the twin's words and the phone's is not.
 */
import { describe, expect, it } from 'vitest';
import { DESK_STATES, normalizeText, PHONE_STATES } from '../support/nocturne-states.js';
import { DESKTOP_MOVED, DESKTOP_WORDS, NOT_TWINS, phoneTwin, shownOrBroken } from './desktop.content-parity.harness.js';
import { readBaseline } from './nocturne.content.harness.js';

const baseline = readBaseline();
/** A value of the baseline as the page read it: its marks written as a text of their shape. */
const SAMPLE: Readonly<Record<string, string>> = { genome: 'G1-0A0A-0A0A', code: 'AAAA-AAAA-AAAA', hex: 'a'.repeat(64), id: '00000000-0000-4000-8000-000000000000', link: 'http://127.0.0.1/x', ref: '0a1b2c3d', date: '1 janvier 2026' };
const asShown = (v: string) => normalizeText(v.replace(/«([a-z]+)»/g, (_, m: string) => SAMPLE[m] ?? m));
const deskTexts = (id: string) => baseline.states[id]!.values.map(asShown);
const phoneIds = new Set(PHONE_STATES.map((s) => s.id));
/** Each phone state's computer twins. */
const twins = new Map<string, string[]>();
for (const s of DESK_STATES) {
  const t = phoneTwin(s);
  if (t) twins.set(t, [...(twins.get(t) ?? []), s.id]);
}

describe('the desktop’s content parity: DESKTOP_MOVED and DESKTOP_WORDS held to the baselines', () => {
  it('every desk state made from a phone’s names one of the baseline, and is its twin unless NOT_TWINS says why', () => {
    const problems: string[] = [];
    let made = 0;
    for (const s of DESK_STATES) {
      const ref = s.refs.find((r) => r.startsWith('phone: '))?.slice('phone: '.length);
      if (!ref) continue;
      made++;
      if (!phoneIds.has(ref) || !baseline.states[ref]) problems.push(`${s.id}: ${ref} is no phone state of the baseline`);
      if (!baseline.states[s.id]) problems.push(`${s.id}: not in the baseline`);
      const name = s.id.replace(/^desk-(light-)?/, '').replace(/-(1024|1920)$/, '');
      if (!phoneTwin(s) && !Object.hasOwn(NOT_TWINS, name)) problems.push(`${s.id}: no twin and no reason`);
    }
    for (const [name, reason] of Object.entries(NOT_TWINS)) {
      if (!DESK_STATES.some((s) => s.id === `desk-${name}`)) problems.push(`NOT_TWINS: no desk state ${name}`);
      if (reason.length < 40) problems.push(`NOT_TWINS: ${name} says too little`);
    }
    expect(problems).toEqual([]);
    expect(made).toBeGreaterThan(200);
    expect([...twins.values()].flat().length).toBeGreaterThan(200);
  });

  it('each DESKTOP_MOVED entry names phone values of states with a twin, says why and where, and is needed', () => {
    const problems: string[] = [];
    DESKTOP_MOVED.forEach((m, i) => {
      const label = `DESKTOP_MOVED[${i}] (${m.states.join(', ')})`;
      const kinds = [m.shownAs, m.where, m.removed, m.run].filter((k) => k !== undefined).length;
      if (kinds !== 1) problems.push(`${label}: ${kinds} kinds (one of shownAs, where, removed, run)`);
      if (m.reason.length < 40 || m.now.length < 10) problems.push(`${label}: says too little`);
      if (m.states.length === 0) problems.push(`${label}: no state`);
      for (const id of m.states) {
        const phone = baseline.states[id];
        const of = twins.get(id) ?? [];
        if (!phone || of.length === 0) {
          problems.push(`${label}: ${id} is no phone state with a computer twin`);
          continue;
        }
        const values = phone.values.map(normalizeText);
        for (const v of m.values ?? []) if (!values.includes(normalizeText(v))) problems.push(`${label}: «${v}» is not a value of ${id}`);
        // Needed: the twin's recorded words do not already show what it excuses.
        for (const twin of of) {
          const texts = deskTexts(twin);
          const unshown = (m.values ?? phone.values).filter((v) => !shownOrBroken(texts, v));
          if (m.values ? unshown.length < m.values.length && of.length === 1 : unshown.length === 0) {
            const shown = (m.values ?? []).filter((v) => shownOrBroken(texts, v));
            problems.push(`${label}: ${twin} already shows ${m.values ? shown.map((v) => `«${v}»`).join(', ') : 'every value of the state'}`);
          }
        }
        if (m.values && of.length > 1) {
          // A value listed for a state of several twins (its windows, its modes): missing from one of them at least.
          for (const v of m.values) if (of.every((twin) => shownOrBroken(deskTexts(twin), v))) problems.push(`${label}: every twin of ${id} shows «${v}»`);
        }
      }
    });
    expect(problems).toEqual([]);
  });

  it('each DESKTOP_WORDS phrase is the phone’s, and the computer’s phrase stands in its place on every twin that shows it', () => {
    const problems: string[] = [];
    const phoneValues = PHONE_STATES.flatMap((s) => (baseline.states[s.id]?.values ?? []).map((v) => ({ id: s.id, v: normalizeText(v) })));
    for (const w of DESKTOP_WORDS) {
      const [p, c] = [normalizeText(w.phone), normalizeText(w.computer)];
      const on = phoneValues.filter((x) => (w.whole ? x.v === p : x.v.includes(p)));
      if (on.length === 0) problems.push(`«${w.phone}»: no phone state shows it`);
      if (w.reason.length < 20) problems.push(`«${w.phone}»: says too little`);
      for (const id of new Set(on.map((x) => x.id))) {
        // A state whose every value moved to another page (a sheet's page under it): its words are read there, on the pages.
        if (DESKTOP_MOVED.some((m) => m.states.includes(id) && !m.values && m.where)) continue;
        for (const twin of twins.get(id) ?? []) {
          const texts = deskTexts(twin).join('\n');
          if (!texts.includes(c)) problems.push(`«${w.phone}»: ${twin} does not show «${w.computer}»`);
          if (w.whole ? deskTexts(twin).includes(p) : texts.includes(p)) problems.push(`«${w.phone}»: ${twin} still shows it`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
