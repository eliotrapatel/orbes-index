/**
 * Counterfeit simulation scenarios (master spec §27), run through the real
 * stack by the lab (lab.ts). Each scenario builds its own world, plays the
 * attack with phones, printers and HTTP requests, and records checks.
 *
 * Expected states are those of §27 (as briefed for this suite). Where the
 * normative platform contract prescribes a different state, the check is a
 * GAP (listed in `knownGaps` and in the report); where the system behaves as
 * designed but cannot catch the counterfeit, the check is a LIMIT. Tests
 * require every other check to PASS and the GAP / LIMIT sets to be exactly
 * the known ones, so a fix or a regression both show up.
 */
import { fromBase64Url, writeU32BE } from '../../src/core/bytes.js';
import { computeGenome } from '../../src/core/genome/genome.js';
import { packIdentity, unpackIdentity } from '../../src/core/identity.js';
import {
  decodePayload,
  encodePayload,
  frameCodeData,
  issuedDayFromDate,
  PAYLOAD_V1_LENGTH,
  PayloadError,
  SIGNATURE_LENGTH,
  signingMessage,
  unframeCodeData,
  type CodePayloadV1,
} from '../../src/core/payload.js';
import { signEd25519 } from '../../src/server/crypto/ed25519-node.js';
import { DEFAULT_ANOMALY_CONFIG } from '../../src/server/config.js';
import { buildVerifyInput } from '../../src/web/verify/capture.js';
import type { VerifyInput } from '../../src/web/verify/types.js';
import { hashSeed, Prng } from '../support/prng.js';
import {
  AUTHENTIC_STATES,
  blankAnnulus,
  Lab,
  MINUTE,
  PLACES,
  scuff,
  tally,
  withGray,
  type AnomalyView,
  type Check,
  type DbFactory,
  type Scan,
  type Submission,
} from './lab.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface Scenario {
  id: number;
  key: string;
  title: string;
  /** What is simulated (report prose). */
  setup: string;
  /** Checks whose §27 expectation is not met although the contract is (documented gaps). */
  knownGaps: readonly string[];
  /** Checks where the system works as designed but cannot detect the counterfeit. */
  knownLimits: readonly string[];
  run(lab: Lab): Promise<void>;
}

/** An anomaly row and the world it was recorded in (a scenario may open a second world). */
export interface ScenarioAnomaly extends AnomalyView {
  world: string;
}

export interface ScenarioResult {
  id: number;
  key: string;
  title: string;
  setup: string;
  checks: Check[];
  anomalies: ScenarioAnomaly[];
  responses: number;
  /** Responses whose bytes were not an issued code: how many, and how many came back AUTHENTIC* (must be 0). */
  forged: { submissions: number; authentic: number; states: string };
  /** Genome cross-check results of camera scans of unaltered genuine artifacts. */
  genomeChecks: Record<string, number>;
  /** Distinct public states seen. */
  states: string[];
  captures: { photos: number; decoded: number; frames: number; decodeMs: number[] };
  durationMs: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** The 79 bytes a scan read (what a forger edits). */
function bytesOf(s: Scan): Uint8Array {
  if (!s.photo.decoded) throw new Error(`photo not decoded (${s.photo.reason})`);
  return fromBase64Url(s.photo.decoded.code);
}

/** The genome reading the scanner sent with a scan (a forger replays it with edited bytes). */
function genomeOf(s: Scan): VerifyInput['genome'] {
  return s.photo.decoded ? buildVerifyInput(s.photo.decoded, 'camera').genome : undefined;
}

/** Edit payload and/or signature, then recompute the (public) CRC-16, as any forger would. */
function reframe(data: Uint8Array, edit: { payload?: (p: Uint8Array) => void; signature?: (s: Uint8Array) => void }): Uint8Array {
  const { payloadBytes, signature } = unframeCodeData(data);
  const p = payloadBytes.slice();
  const s = signature.slice();
  edit.payload?.(p);
  edit.signature?.(s);
  return frameCodeData(p, s);
}

function isValidIdentity(packed: number): boolean {
  try {
    unpackIdentity(packed >>> 0);
    return true;
  } catch {
    return false;
  }
}

function tryDecodePayload(b: Uint8Array): CodePayloadV1 | undefined {
  try {
    return decodePayload(b);
  } catch (e) {
    if (e instanceof PayloadError) return undefined;
    throw e;
  }
}

/** Packed identity at payload bytes 2..5 (no range check: forged values may be out of range). */
function readPacked(payloadOrFrame: Uint8Array): number {
  const b = payloadOrFrame;
  return ((b[2] << 24) | (b[3] << 16) | (b[4] << 8) | b[5]) >>> 0;
}

/** Positions where two genomes differ. */
function glyphDiff(a: readonly number[], b: readonly number[]): number {
  return a.reduce((n, g, i) => n + (g === b[i] ? 0 : 1), 0);
}

const AUTH = 'AUTHENTIC*' as const;

// ── 1. Authentic code ──────────────────────────────────────────────────────

const authentic: Scenario = {
  id: 1,
  key: 'authentic',
  title: 'Authentic code (control)',
  setup:
    'A ring is issued through the admin generator (with a claim code), its 30 mm / 600 dpi PNG artifact downloaded from the admin API and photographed by phones in Paris: in the boutique before sale, by the buyer after the retail activation, by a friend after the buyer registered it with token + claim code, by the logged-in owner, then by eight more phones (every capture preset) in Paris and Lyon over the day.',
  knownGaps: [],
  knownLimits: [],
  async run(lab) {
    lab.at('2026-06-01T09:00:00Z');
    const p = await lab.issue({ claim: true });
    const art = await lab.artifact(p);
    const boutique = lab.device('boutique-tablet', PLACES.paris, { preset: 'clean' });
    const s1 = await lab.scan(boutique, art);
    await lab.expectState('1a', 'issued, not yet sold: stock check in the boutique', s1, 'AUTHENTIC');

    await lab.activate(p);
    lab.at('2026-06-01T09:10:00Z');
    const buyer = (await lab.customer('Buyer', PLACES.paris)).device;
    const s2 = await lab.scan(buyer, art);
    await lab.expectState('1b', 'sold (activated), unregistered: the buyer scans', s2, 'AUTHENTIC_FIRST_REGISTRATION');
    const reg = s2.body.registration;
    lab.expectTrue(
      '1c',
      'single-use registration token offered, claim code required',
      'token + claimCodeRequired',
      reg ? `token ${String(reg.token).length} chars, claimCodeRequired ${reg.claimCodeRequired}` : 'none',
      typeof reg?.token === 'string' && reg.token.length >= 40 && reg.claimCodeRequired === true,
    );
    const status = await lab.register(buyer, s2, p.claimCode);
    lab.expectTrue('1d', 'first registration (POST /api/v1/ownership/register, token + claim code)', 'HTTP 201', `HTTP ${status}`, status === 201);

    lab.at('2026-06-01T09:20:00Z');
    const friend = lab.device('friend-phone', PLACES.paris);
    const s3 = await lab.scan(friend, art);
    await lab.expectState('1e', 'owned product viewed by someone else', s3, 'AUTHENTIC_REGISTERED');
    lab.expectTrue('1f', 'ownership block for a stranger', 'registered: true, you: false', JSON.stringify(s3.body.ownership ?? null), s3.body.ownership?.registered === true && s3.body.ownership?.you === false);

    lab.at('2026-06-01T09:25:00Z');
    const s4 = await lab.scan(buyer, art);
    await lab.expectState('1g', 'owned product scanned by its logged-in owner', s4, 'AUTHENTIC_OWNERSHIP_VERIFIED');
    lab.expectTrue('1h', 'owner view: you = true, no unusual-activity notice', 'you: true, no notice', `you: ${s4.body.ownership?.you}, notice: ${s4.body.notice ?? 'none'}`, s4.body.ownership?.you === true && s4.body.notice === undefined);

    // Everyday genuine use: eight more phones (one per capture preset) during the day, same city.
    const day: Scan[] = [];
    for (let i = 0; i < 8; i++) {
      lab.at(`2026-06-01T${String(10 + i).padStart(2, '0')}:00:00Z`);
      day.push(await lab.scan(lab.device(`visitor-${i}`, i % 2 ? PLACES.paris : PLACES.lyon, {}), art));
    }
    lab.expectAll('1i', 'eight more phones (all capture presets) in Paris and Lyon over the day', day, 'AUTHENTIC_REGISTERED');

    const all = [s1, s2, s3, s4, ...day];
    const checks = await Promise.all(all.map(async (s) => (await lab.authEvent(s.scanId))?.genome_check ?? 'none'));
    lab.expectTrue('1j', 'genome cross-check on genuine camera scans', 'no MISMATCH', tally(checks), !checks.includes('MISMATCH') && checks.includes('MATCH'));
    await lab.expectAnomalies('1k', 'genuine use creates no anomaly', p, []);
    lab.redactionCheck('1z');
  },
};

// ── 2. Cloned code ─────────────────────────────────────────────────────────

const CLONE_CITIES = [PLACES.paris, PLACES.milan, PLACES.berlin, PLACES.london, PLACES.newYork, PLACES.tokyo, PLACES.dubai, PLACES.saoPaulo];

const cloned: Scenario = {
  id: 2,
  key: 'cloned',
  title: 'Cloned code (one artifact, many phones, many countries)',
  setup:
    'An activated ring is registered by its owner in Paris. An hour later the same printed artifact (copied onto counterfeits) is photographed by 24 different phones in 8 countries within 20 minutes (one scan every 50 s, edge geo headers with city coordinates). Then the genuine owner, logged in, scans their ring in Paris.',
  knownGaps: [],
  knownLimits: ['2c'],
  async run(lab) {
    lab.at('2026-06-01T09:00:00Z');
    const p = await lab.issue({ activate: true });
    const art = await lab.artifact(p);
    const owner = (await lab.customer('Owner', PLACES.paris)).device;
    const first = await lab.scan(owner, art);
    const status = await lab.register(owner, first);
    lab.expectTrue('2a', 'owner registers the ring in Paris', 'HTTP 201', `HTTP ${status}`, status === 201);

    lab.at('2026-06-01T10:00:00Z');
    const scans: Scan[] = [];
    for (let i = 0; i < 24; i++) {
      const city = CLONE_CITIES[i % CLONE_CITIES.length];
      scans.push(await lab.scan(lab.device(`clone-${i}-${city.country}`, city), art));
      lab.advance(50_000);
    }
    const decoded = scans.filter((s) => s.photo.ok);
    lab.expectTrue('2b', 'every phone decoded the copied artifact', '24 of 24', `${decoded.length} of 24`, decoded.length === 24);
    const [head, ...rest] = decoded;
    await lab.expectState('2c', 'first copy scanned (Paris): nothing unusual yet', head, 'AUTHENTIC_REGISTERED', { limit: true, note: 'One scan of a copy in the owner’s own city is indistinguishable from the genuine product.' });
    lab.expectAll('2d', 'next 23 scans (7 more countries, minutes apart), strangers', rest, 'SUSPICIOUS_ACTIVITY');
    const susp = rest.find((s) => s.state === 'SUSPICIOUS_ACTIVITY');
    lab.expectTrue(
      '2e',
      'SUSPICIOUS shows signature + genome (to compare with the object), no product data',
      'verification + genome, no product/warranty/ownership',
      susp ? Object.keys(susp.body).filter((k) => !['state', 'scanId', 'verifiedAt', 'title', 'message'].includes(k)).join(', ') : 'n/a',
      !!susp && 'genome' in susp.body && 'verification' in susp.body && !('product' in susp.body) && !('ownership' in susp.body),
    );

    lab.advance(5 * MINUTE);
    const own = await lab.scan(owner, art);
    await lab.expectState('2f', 'genuine owner (logged in) scans in Paris during the attack', own, 'AUTHENTIC_OWNERSHIP_VERIFIED');
    lab.expectTrue('2g', 'owner sees the unusual-activity notice', "notice: 'UNUSUAL_ACTIVITY'", `notice: ${own.body.notice ?? 'none'} · ${own.body.title}`, own.body.notice === 'UNUSUAL_ACTIVITY');
    const ev = await lab.authEvent(own.scanId);
    lab.expectTrue('2h', 'owner exception recorded internally', 'RISK_THRESHOLD_OWNER', (ev?.reasons ?? []).join(', '), (ev?.reasons ?? []).includes('RISK_THRESHOLD_OWNER'));
    await lab.expectAnomalies('2i', 'anomalies recorded for the product', p, ['IMPOSSIBLE_TRAVEL', 'GEO_DISPERSION', 'SCAN_VELOCITY', 'DEVICE_DIVERSITY']);
    lab.redactionCheck('2z');
  },
};

// ── 3. Altered product id ──────────────────────────────────────────────────

const alteredId: Scenario = {
  id: 3,
  key: 'altered-id',
  title: 'Altered product ID',
  setup:
    'A forger photographs a genuine low-priced ring, edits the identity in the 79 bytes the scanner read to that of a pricier registered product (recomputing the public CRC-16), and submits it; then flips each of the 32 identity bits, and each of the 104 bits of the whole signed payload, one at a time; then prints the relabelled bytes as a brand-new, visually valid artifact (render module, with the target product’s genome glyphs) and has a victim photograph it.',
  knownGaps: [],
  knownLimits: [],
  async run(lab) {
    lab.at('2026-06-01T09:00:00Z');
    const p = await lab.issue({ activate: true });
    const target = await lab.issue({ activate: true, variant: 'PAVÉ' });
    const art = await lab.artifact(p);
    const forger = lab.device('forger-phone', PLACES.paris, { preset: 'clean' });
    const s0 = await lab.scan(forger, art);
    await lab.expectState('3a', 'control: the genuine artifact', s0, 'AUTHENTIC_FIRST_REGISTRATION');
    const read = bytesOf(s0);

    const relabelled = reframe(read, { payload: (b) => writeU32BE(b, 2, target.packedIdentity) });
    await lab.expectState('3b', `identity rewritten ${p.productId} → ${target.productId}, CRC recomputed`, await lab.submitBytes(forger, relabelled, genomeOf(s0)), 'INVALID_SIGNATURE', { reason: 'BAD_SIGNATURE' });

    // Every single-bit flip of the 32-bit identity: in-range identities fail the signature, out-of-range ones strict parsing.
    const flips: Submission[] = [];
    let valid = 0;
    let wrong = 0;
    for (let bit = 0; bit < 32; bit++) {
      const data = reframe(read, { payload: (b) => void (b[2 + (bit >> 3)] ^= 0x80 >> (bit & 7)) });
      const packed = readPacked(data); // framed data starts with the payload
      const expectValid = isValidIdentity(packed);
      if (expectValid) valid++;
      const sub = await lab.submitBytes(forger, data);
      flips.push(sub);
      if (sub.state !== (expectValid ? 'INVALID_SIGNATURE' : 'MALFORMED_CODE') || sub.violations.length) wrong++;
    }
    lab.expectTrue(
      '3c',
      '32 single-bit flips of the identity (valid CRC)',
      `INVALID_SIGNATURE ×${valid} (in-range ids), MALFORMED_CODE ×${32 - valid} (out-of-range ids)`,
      tally(flips.map((s) => s.state ?? `HTTP ${s.status}`)),
      wrong === 0,
    );

    // Every single-bit flip of the whole signed payload: versions, key id, identity, issue, issued day, nonce.
    const sweep: Submission[] = [];
    const expected: string[] = [];
    let off = 0;
    for (let bit = 0; bit < PAYLOAD_V1_LENGTH * 8; bit++) {
      const data = reframe(read, { payload: (b) => void (b[bit >> 3] ^= 0x80 >> (bit & 7)) });
      const parsed = tryDecodePayload(data.subarray(0, PAYLOAD_V1_LENGTH));
      const want = parsed && parsed.genomeVersion === 1 ? 'INVALID_SIGNATURE' : 'MALFORMED_CODE';
      expected.push(want);
      const sub = await lab.submitBytes(forger, data);
      sweep.push(sub);
      if (sub.state !== want || sub.violations.length) off++;
    }
    lab.expectTrue(
      '3d',
      'every single-bit flip of the 13-byte signed payload (104 bits: versions, key id, identity, issue, day, nonce)',
      `${tally(expected)} (MALFORMED_CODE where strict parsing or the version check refuses the edit)`,
      tally(sweep.map((s) => s.state ?? `HTTP ${s.status}`)),
      off === 0,
    );

    const forged = await lab.forgeArtifact('relabelled', relabelled, target.genome.glyphs);
    const victim = lab.device('victim-phone', PLACES.paris);
    const s1 = await lab.scan(victim, forged);
    const same = !!s1.photo.decoded && fromBase64Url(s1.photo.decoded.code).every((b, i) => b === relabelled[i]);
    lab.expectTrue('3e', 'new artifact printed from the edited bytes: the decoder reads it', 'decoded, bytes = edited bytes', s1.photo.ok ? `decoded in ${s1.photo.frames} frame(s), bytes ${same ? 'identical' : 'DIFFERENT'}` : `not decoded (${s1.photo.reason})`, s1.photo.ok && same);
    await lab.expectState('3f', 'the server rejects the reprinted relabelled code', s1, 'INVALID_SIGNATURE', { reason: 'BAD_SIGNATURE' });

    const t = await lab.scan(lab.device('target-owner-phone', PLACES.paris), await lab.artifact(target));
    await lab.expectState('3g', 'the impersonated product is unaffected', t, 'AUTHENTIC_FIRST_REGISTRATION');
    const rows = await lab.anomalies();
    lab.expectTrue('3h', 'invalid signatures create scan events, not anomalies', 'no anomaly', rows.length ? rows.map((a) => a.type).join(', ') : 'none', rows.length === 0, 'Rejected forgeries are visible in VERIFICATION EVENTS (state INVALID_SIGNATURE), not in ANOMALIES.');
    lab.redactionCheck('3z');
  },
};

// ── 4. Altered genome ──────────────────────────────────────────────────────

const alteredGenome: Scenario = {
  id: 4,
  key: 'altered-genome',
  title: 'Altered genome',
  setup:
    'Starting from a genuine scan, the forger changes the signed genome-version nibble (all 15 other values); reprints the genuine 79 bytes with the 8 glyphs of another registered product; reprints them with a single glyph replaced; and sands the whole genome orbit off a genuine label.',
  knownGaps: ['4a'],
  knownLimits: ['4d', '4e'],
  async run(lab) {
    lab.at('2026-06-01T09:00:00Z');
    const p = await lab.issue({ activate: true });
    const other = await lab.issue({ activate: true });
    const art = await lab.artifact(p);
    const forger = lab.device('forger-phone', PLACES.paris, { preset: 'clean' });
    const s0 = await lab.scan(forger, art);
    const read = bytesOf(s0);

    const versions: Submission[] = [];
    for (let v = 0; v < 16; v++) {
      if (v === 1) continue;
      versions.push(await lab.submitBytes(forger, reframe(read, { payload: (b) => void (b[0] = (b[0] & 0xf0) | v) }), genomeOf(s0)));
    }
    lab.expectAll('4a', 'signed genome-version nibble changed (0, 2…15), CRC recomputed', versions, 'INVALID_SIGNATURE', {
      gap: {
        contract: 'MALFORMED_CODE',
        note: 'Contract §2.4 step 2 rejects unsupported versions (and payload parsing rejects 0) before the signature check, so the public result is MALFORMED_CODE (“UNREADABLE CODE — scan it again”) instead of INVALID_SIGNATURE. Never authentic; only the wording differs.',
      },
    });

    const swapped = await lab.forgeArtifact('glyphs-of-other', read, other.genome.glyphs);
    const diff = glyphDiff(p.genome.glyphs, other.genome.glyphs);
    const s1 = await lab.scan(lab.device('victim-a', PLACES.paris, { preset: 'typicalPhone' }), swapped);
    const g1 = s1.photo.decoded?.genome?.glyphs ?? [];
    lab.expectTrue('4b', `printed glyphs replaced by ${other.productId}'s (${diff} of 8 differ): decoder reads them`, 'decoded, reads the printed glyphs', s1.photo.ok ? `decoded · read ${JSON.stringify(g1)} · printed ${JSON.stringify(other.genome.glyphs)}` : `not decoded (${s1.photo.reason})`, s1.photo.ok && glyphDiff(g1.map((g) => g ?? -1), other.genome.glyphs) <= 1);
    await lab.expectState('4c', 'server cross-checks the glyphs against the signed identity', s1, 'SUSPICIOUS_ACTIVITY', { reason: 'GENOME_MISMATCH' });

    const one = [...p.genome.glyphs];
    one[3] = (one[3] + 5) % 16;
    const s2 = await lab.scan(lab.device('victim-b', PLACES.paris, { preset: 'clean' }), await lab.forgeArtifact('one-glyph', read, one));
    const e2 = await lab.authEvent(s2.scanId);
    await lab.expectState('4d', 'a single glyph replaced', s2, AUTH, { limit: true, note: `One differing glyph is tolerated as a misread (genome check ${e2?.genome_check ?? 'n/a'}); it takes ≥ 2 of ≥ 6 confident glyphs to flag.` });

    const sanded = withGray(art, 'genome-sanded', blankAnnulus(art.gray, 5.6, 9.6));
    const s3 = await lab.scan(lab.device('victim-c', PLACES.paris, { preset: 'typicalPhone' }), sanded);
    const e3 = await lab.authEvent(s3.scanId);
    await lab.expectState('4e', 'genome orbit sanded off a label (data intact)', s3, AUTH, { limit: true, note: `With fewer than 6 confident glyphs the cross-check is ${e3?.genome_check ?? 'n/a'} and cannot flag; the genome is secondary (not machine-critical).` });

    await lab.expectAnomalies('4f', 'GENOME_MISMATCH recorded for the product', p, ['GENOME_MISMATCH']);
    const later = await lab.scan(lab.device('owner-phone', PLACES.paris, { preset: 'clean' }), art);
    await lab.expectState('4g', 'the genuine artifact still verifies afterwards', later, 'AUTHENTIC_FIRST_REGISTRATION');
    lab.redactionCheck('4z');
  },
};

// ── 5. Altered signature ───────────────────────────────────────────────────

const alteredSignature: Scenario = {
  id: 5,
  key: 'altered-signature',
  title: 'Altered signature',
  setup:
    'From a genuine scan, the forger changes one signature byte; then every one of the 512 signature bits, one at a time; then transplants the signature of another genuine product; then prints a code with one flipped signature bit and has it photographed.',
  knownGaps: [],
  knownLimits: [],
  async run(lab) {
    lab.at('2026-06-01T09:00:00Z');
    const p = await lab.issue({ activate: true });
    const other = await lab.issue({ activate: true });
    const art = await lab.artifact(p);
    const forger = lab.device('forger-phone', PLACES.paris, { preset: 'clean' });
    const s0 = await lab.scan(forger, art);
    const read = bytesOf(s0);

    await lab.expectState('5a', 'one signature byte changed (+1)', await lab.submitBytes(forger, reframe(read, { signature: (s) => void (s[17] = (s[17] + 1) & 0xff) }), genomeOf(s0)), 'INVALID_SIGNATURE', { reason: 'BAD_SIGNATURE' });

    const flips: Submission[] = [];
    for (let bit = 0; bit < SIGNATURE_LENGTH * 8; bit++) {
      flips.push(await lab.submitBytes(forger, reframe(read, { signature: (s) => void (s[bit >> 3] ^= 0x80 >> (bit & 7)) })));
    }
    lab.expectAll('5b', 'each of the 512 signature bits flipped (valid CRC)', flips, 'INVALID_SIGNATURE');

    const otherSig = unframeCodeData(fromBase64Url(other.code.data)).signature;
    await lab.expectState('5c', `signature transplanted from ${other.productId} (another genuine code)`, await lab.submitBytes(forger, reframe(read, { signature: (s) => s.set(otherSig) })), 'INVALID_SIGNATURE', { reason: 'BAD_SIGNATURE' });

    const printed = reframe(read, { signature: (s) => void (s[40] ^= 0x01) });
    const s1 = await lab.scan(lab.device('victim-phone', PLACES.paris), await lab.forgeArtifact('sig-bit', printed, p.genome.glyphs));
    lab.expectTrue('5d', 'printed code with one flipped signature bit: decoder reads it', 'decoded', s1.photo.ok ? `decoded in ${s1.photo.frames} frame(s)` : `not decoded (${s1.photo.reason})`, s1.photo.ok);
    await lab.expectState('5e', 'the server rejects it', s1, 'INVALID_SIGNATURE', { reason: 'BAD_SIGNATURE' });

    const s2 = await lab.scan(lab.device('owner-phone', PLACES.paris), art);
    await lab.expectState('5f', 'the genuine artifact is unaffected', s2, 'AUTHENTIC_FIRST_REGISTRATION');
    lab.redactionCheck('5z');
  },
};

// ── 6. Corrupted code ──────────────────────────────────────────────────────

const corrupted: Scenario = {
  id: 6,
  key: 'corrupted',
  title: 'Corrupted code',
  setup:
    'A label is scuffed far beyond Reed-Solomon capacity (900 ink/abrasion spots over a 240° sector of data orbits 1–12) and photographed; a control label is scuffed lightly (150 spots over 40°). Then hand-made malformed submissions: bad CRC, wrong lengths, a partial byte, reserved / unknown version fields with a valid CRC, an empty code, non-base64url characters and a 600-character code (all processed, recorded and answered MALFORMED_CODE, contract §2.4 step 1); and requests outside the API schema (a code over 1024 characters, a non-string code: refused with 400 and not recorded).',
  knownGaps: [],
  knownLimits: [],
  async run(lab) {
    lab.at('2026-06-01T09:00:00Z');
    const p = await lab.issue({ activate: true });
    const art = await lab.artifact(p);
    const phone = lab.device('phone', PLACES.paris, { preset: 'typicalPhone' });

    const before = await lab.scanEventCount();
    const heavy = await lab.scan(phone, withGray(art, 'scuffed-heavy', scuff(art.gray, 'orbes-sim/scuff-heavy', { r0: 11, r1: 23, a0: 60, a1: 300 }, 900)));
    const after = await lab.scanEventCount();
    lab.expectTrue('6a', 'damage beyond ECC capacity: decoder fails on every frame of the burst', 'ECC / CRC / FORMAT failure', heavy.photo.ok ? 'DECODED' : `${heavy.photo.reason} after ${heavy.photo.frames} frames`, !heavy.photo.ok && ['ECC', 'CRC', 'FORMAT'].includes(heavy.photo.reason ?? ''));
    lab.expectTrue('6b', 'no verification request is sent for an unreadable code', '0 scan events', `${after - before} scan events`, after === before);

    const light = await lab.scan(phone, withGray(art, 'scuffed-light', scuff(art.gray, 'orbes-sim/scuff-light', { r0: 11, r1: 23, a0: 100, a1: 140 }, 150)));
    await lab.expectState('6c', `control: light damage within capacity (${light.photo.decoded?.quality.rsErrors ?? '?'} RS byte errors corrected)`, light, 'AUTHENTIC_FIRST_REGISTRATION');

    const read = fromBase64Url(p.code.data);
    const crcBad = read.slice();
    crcBad[78] ^= 0x01;
    const b64 = (b: Uint8Array | number[]) => Buffer.from(b).toString('base64url');
    // Well-formed requests (1–200 base64url characters) that do not decode: processed, recorded, MALFORMED_CODE.
    const cases: [string, string, string, string][] = [
      ['6d', 'CRC-16 byte flipped', b64(crcBad), 'MALFORMED:CRC'],
      ['6e', 'truncated to 78 bytes', b64(read.subarray(0, 78)), 'MALFORMED:LENGTH'],
      ['6f', '80 bytes (one appended)', b64([...read, 0]), 'MALFORMED:LENGTH'],
      ['6g', '105 base64url characters (not a whole number of bytes)', p.code.data.slice(0, 105), 'MALFORMED:ENCODING'],
      ['6h', 'key id 0 (reserved), CRC recomputed', b64(reframe(read, { payload: (b) => void (b[1] = 0) })), 'MALFORMED:RESERVED'],
      ['6i', 'code version nibble 2, CRC recomputed', b64(reframe(read, { payload: (b) => void (b[0] = (2 << 4) | (b[0] & 0x0f)) })), 'MALFORMED:VERSION'],
    ];
    for (const [id, title, code, reason] of cases) {
      await lab.expectState(id, title, await lab.submit(phone, { code }), 'MALFORMED_CODE', { reason });
    }
    // Any string up to 1 KiB reaches the service (schemas.ts verifyBody): an empty code, characters outside
    // base64url or more than 200 characters are contract §2.4 step 1 failures, recorded as MALFORMED_CODE scans.
    const m0 = await lab.scanEventCount();
    const undecodable = [
      await lab.submit(phone, { code: '' }),
      await lab.submit(phone, { code: `${p.code.data.slice(0, 100)}!!!!!!` }),
      await lab.submit(phone, { code: 'A'.repeat(600) }),
    ];
    const m1 = await lab.scanEventCount();
    lab.expectTrue(
      '6j',
      'undecodable strings inside the request schema (empty, “!” characters, 600 characters)',
      'MALFORMED_CODE ×3, each recorded as a scan',
      `${tally(undecodable.map((r) => r.state ?? `HTTP ${r.status}`))}; ${m1 - m0} scan events`,
      undecodable.every((r) => r.state === 'MALFORMED_CODE' && r.violations.length === 0) && m1 - m0 === 3,
      'Since the verify route accepts any string up to 1024 characters (schemas.ts verifyBody), these are recorded MALFORMED_CODE scans, not 400s. docs/API.md (verify request rules) still documents 400 VALIDATION_FAILED for them.',
    );
    // Requests outside the API schema (a code over 1024 characters, a non-string code) are refused unread.
    const n0 = await lab.scanEventCount();
    const refused = [await lab.submit(phone, { code: 'A'.repeat(2000) }), await lab.submit(phone, { code: 42 })];
    const n1 = await lab.scanEventCount();
    const shapeOk = refused.every((r) => r.status === 400 && r.body.error?.code === 'VALIDATION_FAILED' && Object.keys(r.body).join() === 'error');
    lab.expectTrue(
      '6k',
      'outside the request schema (2000 characters, a number instead of a string)',
      'HTTP 400 VALIDATION_FAILED ×2, not recorded',
      `${tally(refused.map((r) => `HTTP ${r.status} ${r.body.error?.code ?? ''}`.trim()))}; ${n1 - n0} scan events`,
      shapeOk && n1 === n0,
    );
    await lab.expectAnomalies('6l', 'corrupted codes create no anomaly', null, []);
    lab.redactionCheck('6z');
  },
};

// ── 7. Revoked product / code ──────────────────────────────────────────────

const revoked: Scenario = {
  id: 7,
  key: 'revoked',
  title: 'Revoked product, revoked code, re-issue',
  setup:
    'Admin API: product A is revoked (counterfeit investigation); product B’s code is revoked (print run stolen) and a replacement code issued; product C’s damaged code is re-issued without revocation (old one SUPERSEDED). Old and new artifacts are photographed.',
  knownGaps: [],
  knownLimits: [],
  async run(lab) {
    lab.at('2026-06-01T09:00:00Z');
    const a = await lab.issue({ activate: true });
    const b = await lab.issue({ activate: true });
    const c = await lab.issue({ activate: true });
    const artA = await lab.artifact(a);
    const artB = await lab.artifact(b);
    const artC = await lab.artifact(c);
    const phone = lab.device('phone', PLACES.paris);

    lab.at('2026-06-01T10:00:00Z');
    await lab.transition(a, 'REVOKED', 'counterfeit investigation');
    const sA = await lab.scan(phone, artA);
    await lab.expectState('7a', 'revoked product', sA, 'REVOKED', { reason: 'PRODUCT_REVOKED' });
    lab.expectTrue('7b', 'REVOKED shows signature + genome, no product data', 'no product/warranty/ownership', Object.keys(sA.body).join(', '), !('product' in sA.body) && !('warranty' in sA.body) && 'genome' in sA.body);

    await lab.revokeCode(b.code.id, 'print run stolen from the workshop');
    await lab.expectState('7c', 'revoked code (old artifact)', await lab.scan(phone, artB), 'REVOKED', { reason: 'CODE_REVOKED' });
    const b2 = await lab.reissue(b, 'replacement label after theft');
    const sB2 = await lab.scan(lab.device('buyer-b', PLACES.paris), await lab.artifact(b2));
    await lab.expectState('7d', `replacement code (issue ${b2.code.issue}) after revocation`, sB2, 'AUTHENTIC_FIRST_REGISTRATION');
    await lab.expectState('7e', 'the old artifact stays revoked', await lab.scan(phone, artB), 'REVOKED', { reason: 'CODE_REVOKED' });

    const c2 = await lab.reissue(c, 'damaged label');
    await lab.expectState('7f', 'superseded code after re-issue (old artifact)', await lab.scan(phone, artC), 'REVOKED', { reason: 'CODE_SUPERSEDED' });
    await lab.expectState('7g', `re-issued code (issue ${c2.code.issue})`, await lab.scan(lab.device('buyer-c', PLACES.paris), await lab.artifact(c2)), 'AUTHENTIC_FIRST_REGISTRATION');

    for (const [id, x] of [['7h', a], ['7i', b], ['7j', c]] as const) {
      await lab.expectAnomalies(id, `POST_REVOCATION_SCAN recorded for ${x.productId}`, x, ['POST_REVOCATION_SCAN']);
    }
    lab.redactionCheck('7z');
  },
};

// ── 8. Duplicated code ─────────────────────────────────────────────────────

const duplicated: Scenario = {
  id: 8,
  key: 'duplicated',
  title: 'Duplicated code (two physical copies)',
  setup:
    'A counterfeiter photographs a genuine label in the boutique, decodes it and prints a perfect copy (render module, ivory theme; the genome is public, derived from the identity). The genuine piece is scanned in Paris and the copy in Tokyo 20 s apart (city coordinates); then both holders keep scanning; then the copies are scanned ≥ 12 h apart.',
  knownGaps: [],
  knownLimits: ['8a', '8f', '8h'],
  async run(lab) {
    lab.at('2026-06-01T09:00:00Z');
    const p = await lab.issue({ activate: true, claim: true });
    const genuine = await lab.artifact(p);
    const spy = lab.photograph(lab.device('counterfeiter-phone', PLACES.paris, { preset: 'typicalPhone' }), genuine);
    if (!spy.ok || !spy.decoded) throw new Error('the counterfeiter could not read the genuine label');
    const copy = await lab.forgeArtifact('copy', fromBase64Url(spy.decoded.code), computeGenome(p.packedIdentity).glyphs, 'ivory');

    const paris = (await lab.customer('Paris buyer', PLACES.paris)).device;
    const tokyo = (await lab.customer('Tokyo buyer', PLACES.tokyo)).device;
    lab.at('2026-06-01T10:00:00Z');
    const s1 = await lab.scan(paris, genuine);
    await lab.expectState('8a', 'genuine piece scanned in Paris first', s1, 'AUTHENTIC_FIRST_REGISTRATION', { limit: true, note: 'Whichever copy is scanned first looks genuine.' });
    lab.at('2026-06-01T10:00:20Z');
    const s2 = await lab.scan(tokyo, copy);
    await lab.expectState('8b', 'copy scanned in Tokyo 20 s later', s2, 'SUSPICIOUS_ACTIVITY', { reason: 'RISK_THRESHOLD' });
    const ev2 = await lab.authEvent(s2.scanId);
    lab.expectTrue('8c', 'cause: impossible travel', 'ANOMALY:IMPOSSIBLE_TRAVEL', (ev2?.reasons ?? []).join(', '), (ev2?.reasons ?? []).includes('ANOMALY:IMPOSSIBLE_TRAVEL'));
    lab.at('2026-06-01T10:01:00Z');
    await lab.expectState('8d', 'genuine holder in Paris rescans a minute later', await lab.scan(paris, genuine), 'SUSPICIOUS_ACTIVITY');
    const travel = (await lab.anomaliesOf(p)).find((a) => a.type === 'IMPOSSIBLE_TRAVEL');
    lab.expectTrue(
      '8e',
      'IMPOSSIBLE_TRAVEL anomaly recorded (HIGH)',
      'HIGH, Paris ↔ Tokyo ≈ 9 700 km in minutes, coordinates',
      travel ? `${travel.severity}, ${travel.details.fromCountry}→${travel.details.toCountry} ${travel.details.distanceKm} km in ${travel.details.minutes} min, ${travel.details.basis}, ×${travel.occurrences}` : 'none',
      !!travel && travel.severity === 'HIGH' && Number(travel.details.distanceKm) > 9000 && travel.details.basis === 'coordinates',
    );

    // The copy's holder cannot register without the claim code from the genuine packaging.
    lab.at('2026-06-01T22:30:00Z');
    const s3 = await lab.scan(tokyo, copy);
    const tokyoReg = s3.body.registration ? await lab.register(tokyo, s3) : 0;
    await lab.expectState('8f', 'copy rescanned in Tokyo 12.5 h later (plausible flight)', s3, 'AUTHENTIC_FIRST_REGISTRATION', { limit: true, note: 'Paris → Tokyo in 12.5 h is a possible journey (776 km/h), and the 10:01 finding has decayed to 60 × (1 − 12.5 h / 30 d) ≈ 59 < 60.' });
    lab.expectTrue('8g', 'copy holder tries to register without the claim code', 'rejected (claim code required)', `HTTP ${tokyoReg || 'n/a'}`, tokyoReg !== 201 && tokyoReg !== 0);
    lab.at('2026-06-02T11:00:00Z');
    const s4 = await lab.scan(paris, genuine);
    await lab.expectState('8h', 'genuine piece rescanned in Paris 12.5 h after that', s4, 'AUTHENTIC_FIRST_REGISTRATION', { limit: true, note: 'Copies scanned in alternation more than 10.8 h apart (9 705 km at 900 km/h) never look like impossible travel.' });
    const reg = await lab.register(paris, s4, p.claimCode);
    lab.expectTrue('8i', 'genuine buyer registers with the claim code', 'HTTP 201', `HTTP ${reg}`, reg === 201);
    lab.at('2026-06-02T23:30:00Z');
    await lab.expectState('8j', 'from then on the copy shows as registered to someone else', await lab.scan(tokyo, copy), 'AUTHENTIC_REGISTERED', { note: 'The registration conflict is the signal for the copy’s holder: “registered”, not to them.' });
    lab.redactionCheck('8z');
  },
};

// ── 9. High-risk scan patterns ─────────────────────────────────────────────

async function burst(lab: Lab, artifact: Awaited<ReturnType<Lab['artifact']>>, n: number, devices: number): Promise<Scan[]> {
  const out: Scan[] = [];
  const phones = Array.from({ length: devices }, (_, i) => lab.device(`burst-${i}`, PLACES.paris, { preset: 'clean' }));
  for (let i = 0; i < n; i++) {
    out.push(await lab.scan(phones[i % devices], artifact));
    lab.advance(30_000);
  }
  return out;
}

const highRisk: Scenario = {
  id: 9,
  key: 'high-risk',
  title: 'High-risk scan patterns',
  setup:
    'Canonical journey: France 10:00 → Japan 10:02 → USA 10:03 (the edge reports the country only). Velocity burst on another ring: 30 scans in 15 minutes by 15 phones in one city (Paris, from 10:30), with the default thresholds and again in a second world whose operator lowered ANOMALY_SUSPICIOUS_THRESHOLD to 50.',
  knownGaps: ['9f'],
  knownLimits: [],
  async run(lab) {
    lab.at('2026-06-01T09:00:00Z');
    const r = await lab.issue({ activate: true });
    const p = await lab.issue({ activate: true });
    const artR = await lab.artifact(r);
    const art = await lab.artifact(p);

    const fr = lab.device('phone-FR', PLACES.paris, { geo: 'country' });
    const jp = lab.device('phone-JP', PLACES.tokyo, { geo: 'country' });
    const us = lab.device('phone-US', PLACES.newYork, { geo: 'country' });
    lab.at('2026-06-01T10:00:00Z');
    await lab.expectState('9a', 'France 10:00', await lab.scan(fr, artR), 'AUTHENTIC_FIRST_REGISTRATION');
    lab.at('2026-06-01T10:02:00Z');
    await lab.expectState('9b', 'Japan 10:02', await lab.scan(jp, artR), 'SUSPICIOUS_ACTIVITY', { reason: 'ANOMALY:IMPOSSIBLE_TRAVEL' });
    lab.at('2026-06-01T10:03:00Z');
    await lab.expectState('9c', 'USA 10:03', await lab.scan(us, artR), 'SUSPICIOUS_ACTIVITY', { reason: 'ANOMALY:IMPOSSIBLE_TRAVEL' });
    const travel = (await lab.anomaliesOf(r)).find((a) => a.type === 'IMPOSSIBLE_TRAVEL');
    lab.expectTrue(
      '9d',
      'IMPOSSIBLE_TRAVEL from country centroids (lower-bound distance)',
      'HIGH, basis country, 2 occurrences',
      travel ? `${travel.severity}, basis ${travel.details.basis}, last ${travel.details.fromCountry}→${travel.details.toCountry} ≥ ${travel.details.distanceKm} km in ${travel.details.minutes} min, ×${travel.occurrences}` : 'none',
      !!travel && travel.severity === 'HIGH' && travel.details.basis === 'country' && travel.occurrences === 2,
    );

    lab.at('2026-06-01T10:30:00Z');
    const scans = await burst(lab, art, 30, 15);
    lab.expectAll('9e', 'velocity burst, scans 1–20 (thresholds not yet crossed)', scans.slice(0, 20), 'AUTHENTIC_FIRST_REGISTRATION');
    const w = DEFAULT_ANOMALY_CONFIG;
    const combined = Math.round(100 * (1 - (1 - 0.35) * (1 - 0.3)));
    lab.expectAll('9f', `velocity burst, scans 21–30 (> ${w.velocityMaxScans} scans / ${w.velocityWindowMin} min, > ${w.deviceMax} devices), default thresholds`, scans.slice(20), 'SUSPICIOUS_ACTIVITY', {
      gap: {
        contract: 'AUTHENTIC_FIRST_REGISTRATION',
        note: `SCAN_VELOCITY (35) and DEVICE_DIVERSITY (30) combine to ${combined} < suspiciousThreshold ${w.suspiciousThreshold}: with the contract defaults a burst confined to one place is recorded (MEDIUM anomalies) but never shown as SUSPICIOUS; it needs a geographic signal or a lower threshold.`,
      },
    });
    const last = await lab.authEvent(scans[29].scanId);
    lab.expectTrue('9g', 'internal risk score of the last burst scan', `${combined} (0.35 ⊕ 0.30)`, String(last?.risk_score), last?.risk_score === combined);
    await lab.expectAnomalies('9h', 'burst anomalies recorded for review', p, ['SCAN_VELOCITY', 'DEVICE_DIVERSITY']);

    const strict = await lab.spawn({ scenario: `${lab.scenario}/strict`, label: 'threshold 50', anomaly: { suspiciousThreshold: 50 } });
    strict.at('2026-06-01T09:00:00Z');
    const q = await strict.issue({ activate: true });
    const artQ = await strict.artifact(q);
    strict.at('2026-06-01T10:30:00Z');
    const strictScans = await burst(strict, artQ, 30, 15);
    strict.expectAll('9i', 'same burst, operator threshold 50: scans 21–30', strictScans.slice(20), 'SUSPICIOUS_ACTIVITY');
    lab.redactionCheck('9z');
  },
};

// ── 10. Keys and forgeries ─────────────────────────────────────────────────

/**
 * Random 77 bytes until they parse as a payload, framed with a valid CRC (POC
 * method). The format is public, so the forger aims at what the server
 * accepts: CODE-01 / GENOME-01 in byte 0 and the live key id in byte 1.
 */
function randomWellFormed(rng: Prng, keyId: number): { data: Uint8Array; draws: number } {
  for (let draws = 1; draws < 1_000_000; draws++) {
    const body = Uint8Array.from({ length: PAYLOAD_V1_LENGTH + SIGNATURE_LENGTH }, () => rng.int(0, 255));
    body[0] = (1 << 4) | 1;
    body[1] = keyId;
    const payload = body.subarray(0, PAYLOAD_V1_LENGTH);
    if (tryDecodePayload(payload)) return { data: frameCodeData(payload, body.subarray(PAYLOAD_V1_LENGTH)), draws };
  }
  throw new Error('no well-formed random frame');
}

const keys: Scenario = {
  id: 10,
  key: 'keys',
  title: 'Keys, key compromise and forged codes',
  setup:
    'Products are issued under key 1 at 09:00 and 10:00. Forgeries: an unknown key id; a code signed by the forger’s own (unregistered) key; codes signed with the REAL key outside issuance (simulated theft) for an unregistered identity and for an existing product with a new nonce; 100 + 100 seeded random codes. At 11:00 the compromise is discovered: the admin rotates to key 2 and revokes key 1 with compromise time 09:30.',
  knownGaps: ['10l'],
  knownLimits: [],
  async run(lab) {
    lab.at('2026-06-01T09:00:00Z');
    const old = await lab.issue({ activate: true });
    lab.at('2026-06-01T10:00:00Z');
    const mid = await lab.issue({ activate: true });
    const artOld = await lab.artifact(old);
    const artMid = await lab.artifact(mid);
    const forger = lab.device('forger-phone', PLACES.paris, { preset: 'clean' });
    const victim = lab.device('victim-phone', PLACES.paris);
    const base = unframeCodeData(fromBase64Url(old.code.data)).payload;
    const rng = new Prng(hashSeed('orbes-counterfeit-sim/keys'));

    await lab.expectState('10a', 'unknown key id 200 (CRC recomputed)', await lab.submitBytes(forger, reframe(fromBase64Url(old.code.data), { payload: (b) => void (b[1] = 200) })), 'INVALID_SIGNATURE', { reason: 'UNKNOWN_KEY' });

    // The forger's own Ed25519 key (never registered with ORBES), seeded.
    const forgerSeed = Uint8Array.from({ length: 32 }, () => rng.int(0, 255));
    const ownKeyPayload = encodePayload({ ...base, nonce: Uint8Array.of(1, 2, 3, 4) });
    const ownKeyCode = frameCodeData(ownKeyPayload, signEd25519(forgerSeed, signingMessage(ownKeyPayload)));
    const sOwn = await lab.scan(victim, await lab.forgeArtifact('forger-key', ownKeyCode, old.genome.glyphs));
    await lab.expectState('10b', `printed code for ${old.productId} signed by the forger’s own key (claims key 1)`, sOwn, 'INVALID_SIGNATURE', { reason: 'BAD_SIGNATURE' });

    const ghost = { year: 2026, categoryIndex: base.identity.categoryIndex, serial: 777_777 };
    const ghostPayload = encodePayload({ ...base, identity: ghost, issue: 1, issuedDay: issuedDayFromDate(lab.now()), nonce: Uint8Array.of(9, 9, 9, 9) });
    const ghostCode = frameCodeData(ghostPayload, await lab.signWithKey(1, signingMessage(ghostPayload)));
    const sGhost = await lab.scan(victim, await lab.forgeArtifact('ghost', ghostCode, computeGenome(packIdentity(ghost)).glyphs));
    await lab.expectState('10c', 'valid signature by the real key, unregistered identity (key theft)', sGhost, 'UNKNOWN', { reason: 'PRODUCT_NOT_REGISTERED' });
    const crit = (await lab.anomaliesOf(null)).find((a) => a.type === 'VALID_SIGNATURE_UNREGISTERED');
    lab.expectTrue('10d', 'CRITICAL anomaly: valid signature, unregistered (compromise alarm)', 'VALID_SIGNATURE_UNREGISTERED, CRITICAL', crit ? `${crit.type}, ${crit.severity}, ×${crit.occurrences}` : 'none', crit?.severity === 'CRITICAL');

    const twinPayload = encodePayload({ ...base, nonce: Uint8Array.of(0xde, 0xad, 0xbe, 0xef) });
    const twinCode = frameCodeData(twinPayload, await lab.signWithKey(1, signingMessage(twinPayload)));
    const sTwin = await lab.scan(victim, await lab.forgeArtifact('twin', twinCode, old.genome.glyphs));
    await lab.expectState('10e', `existing identity ${old.productId}, new nonce, real key (key theft)`, sTwin, 'SUSPICIOUS_ACTIVITY', { reason: 'CODE_MISMATCH' });
    await lab.expectAnomalies('10f', 'CRITICAL CODE_MISMATCH recorded for the product', old, ['CODE_MISMATCH']);

    const raw: Submission[] = [];
    for (let i = 0; i < 100; i++) raw.push(await lab.submitBytes(forger, Uint8Array.from({ length: 79 }, () => rng.int(0, 255))));
    lab.expectAll('10g', '100 seeded random 79-byte codes', raw, 'NOT_AUTHENTIC');
    const formed: Submission[] = [];
    let draws = 0;
    for (let i = 0; i < 100; i++) {
      const f = randomWellFormed(rng, 1);
      draws += f.draws;
      formed.push(await lab.submitBytes(forger, f.data));
    }
    lab.expectAll('10h', `100 seeded random codes with valid CRC and a parseable CODE-01 / GENOME-01 payload naming key 1 (${draws} random draws)`, formed, 'INVALID_SIGNATURE', { note: 'Every one is never AUTHENTIC*; all fail Ed25519.' });
    const printedRandom: Scan[] = [];
    for (let i = 0; i < 3; i++) {
      const f = randomWellFormed(rng, 1);
      const packed = readPacked(unframeCodeData(f.data).payloadBytes);
      printedRandom.push(await lab.scan(victim, await lab.forgeArtifact(`random-${i}`, f.data, computeGenome(packed).glyphs)));
    }
    lab.expectAll('10i', '3 of them printed and photographed', printedRandom, 'INVALID_SIGNATURE');

    // 11:00 — compromise discovered: rotate, then revoke key 1 with compromise time 09:30.
    lab.at('2026-06-01T11:00:00Z');
    const k2 = await lab.rotateKey('orbes-sim-k2');
    await lab.revokeKey(1, 'HSM export detected', new Date('2026-06-01T09:30:00Z'));
    await lab.expectState('10j', `${old.productId}: code recorded 09:00, before the compromise`, await lab.scan(victim, artOld), 'AUTHENTIC_FIRST_REGISTRATION');
    await lab.expectState('10k', `${mid.productId}: code recorded 10:00, after the compromise`, await lab.scan(victim, artMid), 'INVALID_SIGNATURE', { reason: 'KEY_REVOKED' });
    const lateGhost = { ...ghost, serial: 777_778 };
    const lgPayload = encodePayload({ ...base, identity: lateGhost, nonce: Uint8Array.of(7, 7, 7, 7) });
    const lgCode = frameCodeData(lgPayload, await lab.signWithKey(1, signingMessage(lgPayload)));
    await lab.expectState('10l', 'new forgery signed by the revoked key 1, unregistered identity', await lab.submitBytes(forger, lgCode), 'INVALID_SIGNATURE', {
      gap: {
        contract: 'UNKNOWN',
        note: 'CRYPTOGRAPHY §5.1 and THREAT-MODEL G say anything else signed by a revoked key is INVALID SIGNATURE, but contract §2.4 runs the registry lookup (step 5, UNKNOWN + CRITICAL anomaly) before the revoked-key rule (step 6). Not authentic either way.',
      },
    });
    const twin2Payload = encodePayload({ ...base, nonce: Uint8Array.of(1, 1, 1, 1) });
    await lab.expectState('10m', 'new forgery signed by the revoked key 1, existing identity', await lab.submitBytes(forger, frameCodeData(twin2Payload, await lab.signWithKey(1, signingMessage(twin2Payload)))), 'NOT_AUTHENTIC', { reason: 'CODE_MISMATCH' });
    const mid2 = await lab.reissue(mid, 'key 1 compromised');
    await lab.expectState('10n', `${mid.productId} re-issued under key ${mid2.code.keyId}`, await lab.scan(victim, await lab.artifact(mid2)), 'AUTHENTIC_FIRST_REGISTRATION');
    lab.expectTrue('10o', 'the re-issued code is signed by the new key', `key ${k2}`, `key ${mid2.code.keyId}`, mid2.code.keyId === k2);
    const fresh = await lab.issue();
    await lab.expectState('10p', 'product issued after rotation', await lab.scan(victim, await lab.artifact(fresh)), 'AUTHENTIC');
    lab.redactionCheck('10z');
  },
};

// ── Registry ───────────────────────────────────────────────────────────────

export const SCENARIOS: readonly Scenario[] = [authentic, cloned, alteredId, alteredGenome, alteredSignature, corrupted, revoked, duplicated, highRisk, keys];

export function scenario(id: number): Scenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`no scenario ${id}`);
  return s;
}

/** Run one scenario in its own world and collect its checks, anomalies and capture statistics. */
export async function runScenario(s: Scenario, opts: { dbFactory?: DbFactory } = {}): Promise<ScenarioResult> {
  const t0 = performance.now();
  const lab = await Lab.open({ scenario: `s${s.id}`, ...(opts.dbFactory ? { dbFactory: opts.dbFactory } : {}) });
  try {
    try {
      await s.run(lab);
    } catch (e) {
      lab.record({ id: `${s.id}-error`, title: 'scenario ran to completion', expected: 'no exception', observed: (e as Error)?.stack?.split('\n').slice(0, 3).join(' ') ?? String(e), status: 'FAIL' });
    }
    const anomalies: ScenarioAnomaly[] = [];
    for (const w of [lab, ...lab.spawned()]) anomalies.push(...(await w.anomalies()).map((a) => ({ ...a, world: w.label })));
    const forged = lab.responses.filter((r) => r.forged);
    const genomeChecks: Record<string, number> = {};
    for (const g of lab.genuineScans) {
      const c = (await g.lab.authEvent(g.scanId))?.genome_check ?? 'none';
      genomeChecks[c] = (genomeChecks[c] ?? 0) + 1;
    }
    return {
      id: s.id,
      key: s.key,
      title: s.title,
      setup: s.setup,
      checks: lab.checks,
      anomalies,
      responses: lab.responses.length,
      forged: {
        submissions: forged.length,
        authentic: forged.filter((r) => (AUTHENTIC_STATES as readonly string[]).includes(r.state)).length,
        states: tally(forged.map((r) => r.state)),
      },
      genomeChecks,
      states: [...new Set(lab.responses.map((r) => r.state))].sort(),
      captures: lab.stats,
      durationMs: performance.now() - t0,
    };
  } finally {
    await lab.close();
  }
}

/** Checks that are neither PASS nor an expected GAP / LIMIT of their scenario. */
export function unexpected(s: Scenario, r: ScenarioResult): Check[] {
  return r.checks.filter((c) => {
    if (c.status === 'FAIL') return true;
    if (c.status === 'GAP') return !s.knownGaps.includes(c.id);
    if (c.status === 'LIMIT') return !s.knownLimits.includes(c.id);
    return false;
  });
}
