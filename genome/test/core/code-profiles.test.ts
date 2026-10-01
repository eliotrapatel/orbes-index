/**
 * Code-version registry (ORBES-CODE-SPEC §12, master specification §26):
 * the decoder picks the profile named by the format word, payload decoding
 * dispatches on the high nibble of byte 0, and a well-formed code of a
 * version this build does not know is told apart from a damaged one.
 *
 * A synthetic version-2 profile (same CODE-01 geometry, its own payload
 * rules and signing domain) stands in for a future CODE-02.
 */
import { describe, expect, it } from 'vitest';
import { concatBytes, readU16BE, utf8, writeU16BE } from '../../src/core/bytes.js';
import {
  CODE01_PROFILE,
  CODE_PROFILES,
  codeVersionOf,
  unframeAnyCodeData,
  type CodeProfileEntry,
  type CodeProfileRegistry,
} from '../../src/core/code-profiles.js';
import { encodeOrbesCode, renderOrbesCodeSvg } from '../../src/core/code/encoder.js';
import { CODE01, CODE01_SIZE, parseFormatInfoValue } from '../../src/core/code/profile.js';
import { decodeOrbesCode } from '../../src/core/decoder/index.js';
import { bchFormatDecode } from '../../src/core/ecc/index.js';
import { crc16 } from '../../src/core/ecc/crc16.js';
import { PayloadError, SIGNING_DOMAIN_V1, signingMessage, unframeCodeData } from '../../src/core/payload.js';
import { makeCode } from '../decoder/fixtures.js';
import { svgToGray } from '../support/raster.js';

/** A frame with a CRC-16 trailer over everything before it. */
function withCrc(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 2);
  out.set(body, 0);
  writeU16BE(out, body.length, crc16(body));
  return out;
}

/** A 79-byte v1 frame with byte 0 rewritten and the CRC recomputed. */
function reversioned(data: Uint8Array, byte0: number): Uint8Array {
  const body = data.slice(0, 77);
  body[0] = byte0;
  return withCrc(body);
}

function payloadErrorOf(fn: () => unknown): PayloadError {
  try {
    fn();
  } catch (e) {
    if (e instanceof PayloadError) return e;
    throw e;
  }
  throw new Error('expected a PayloadError');
}

interface SyntheticV2Payload {
  codeVersion: 2;
  tag: number;
  body: Uint8Array;
}

const V2_DOMAIN = 'ORBES-CODE/v2-synthetic-test';

/** Test-only profile: CODE-01 geometry and framing, payload byte 0 = 0x2N, a 1-byte tag, any 11 bytes. */
const SYNTHETIC_V2: CodeProfileEntry<SyntheticV2Payload> = {
  version: 2,
  id: 'CODE-02-SYNTHETIC',
  layout: CODE01,
  dataLength: CODE01.ecc.dataBytes,
  signingDomain: V2_DOMAIN,
  unframe(data) {
    if (data.length !== 79) throw new PayloadError('LENGTH', 'v2 data must be 79 bytes');
    if (crc16(data.subarray(0, 77)) !== readU16BE(data, 77)) throw new PayloadError('CRC', 'v2 CRC mismatch');
    if (data[0] >>> 4 !== 2) throw new PayloadError('VERSION', 'not v2');
    const payloadBytes = data.slice(0, 13);
    return { payloadBytes, signature: data.slice(13, 77), payload: { codeVersion: 2, tag: payloadBytes[1], body: payloadBytes.slice(2) } };
  },
  signingMessage: (payloadBytes) => concatBytes(utf8(V2_DOMAIN), Uint8Array.of(0), payloadBytes),
};

const WITH_V2: CodeProfileRegistry<unknown> = new Map<number, CodeProfileEntry<unknown>>([
  [1, CODE01_PROFILE],
  [2, SYNTHETIC_V2],
]);

function v2Data(): Uint8Array {
  const body = new Uint8Array(77);
  body[0] = (2 << 4) | 1;
  body[1] = 0x5a;
  for (let i = 2; i < 77; i++) body[i] = (i * 37 + 11) & 0xff;
  return withCrc(body);
}

function raster(model: ReturnType<typeof encodeOrbesCode>) {
  return svgToGray(renderOrbesCodeSvg(model), { widthPx: Math.round(CODE01_SIZE * 8) });
}

describe('CODE_PROFILES registry', () => {
  it('holds exactly CODE-01 under version 1, with its geometry, framing and signing domain', () => {
    expect([...CODE_PROFILES.keys()]).toEqual([1]);
    const p = CODE_PROFILES.get(1)!;
    expect(p).toBe(CODE01_PROFILE);
    expect(p).toMatchObject({ version: 1, id: 'CODE-01', dataLength: 79, signingDomain: SIGNING_DOMAIN_V1 });
    expect(p.layout).toBe(CODE01);
    const { payloadBytes } = makeCode(1);
    expect(p.signingMessage(payloadBytes)).toEqual(signingMessage(payloadBytes));
  });

  it('reads the code version from the high nibble of byte 0', () => {
    expect(codeVersionOf(Uint8Array.of(0x11))).toBe(1);
    expect(codeVersionOf(Uint8Array.of(0x2f, 0))).toBe(2);
    expect(payloadErrorOf(() => codeVersionOf(new Uint8Array(0))).code).toBe('LENGTH');
  });
});

describe('unframeAnyCodeData: dispatch on the code version', () => {
  const { data } = makeCode(7);

  it('unframes a CODE-01 frame exactly like unframeCodeData', () => {
    const r = unframeAnyCodeData(data, CODE_PROFILES);
    const v1 = unframeCodeData(data);
    expect(r.codeVersion).toBe(1);
    expect(r.profile).toBe(CODE01_PROFILE);
    expect(r.payloadBytes).toEqual(v1.payloadBytes);
    expect(r.signature).toEqual(v1.signature);
    expect(r.payload).toEqual(v1.payload);
    // v1 rules still apply in full: a damaged v1 frame keeps its precise error.
    const bad = data.slice();
    bad[78] ^= 1;
    expect(payloadErrorOf(() => unframeAnyCodeData(bad, CODE_PROFILES)).code).toBe('CRC');
    expect(payloadErrorOf(() => unframeAnyCodeData(data.subarray(0, 78), CODE_PROFILES)).code).toBe('LENGTH');
    expect(payloadErrorOf(() => unframeAnyCodeData(reversioned(data, 0x10), CODE_PROFILES)).code).toBe('RESERVED');
  });

  it('reports a well-formed frame of an unknown version 2..8 as UNSUPPORTED_VERSION (not damage)', () => {
    for (const v of [2, 3, 8]) {
      const e = payloadErrorOf(() => unframeAnyCodeData(reversioned(data, (v << 4) | 1), CODE_PROFILES));
      expect(e.code, `v${v}`).toBe('UNSUPPORTED_VERSION');
      expect(e.codeVersion).toBe(v);
    }
    // A future version may be longer: only the envelope (≥ 1 payload byte ‖ 64-byte signature ‖ CRC-16) is checked.
    const longer = new Uint8Array(120);
    longer[0] = 0x31;
    const e = payloadErrorOf(() => unframeAnyCodeData(withCrc(longer), CODE_PROFILES));
    expect([e.code, e.codeVersion]).toEqual(['UNSUPPORTED_VERSION', 3]);
  });

  it('keeps VERSION (damage) for versions outside the format word range and broken envelopes', () => {
    for (const byte0 of [0x01, 0x91, 0xf1]) {
      expect(payloadErrorOf(() => unframeAnyCodeData(reversioned(data, byte0), CODE_PROFILES)).code, byte0.toString(16)).toBe('VERSION');
    }
    const noCrc = data.slice();
    noCrc[0] = 0x21; // CRC not recomputed
    expect(payloadErrorOf(() => unframeAnyCodeData(noCrc, CODE_PROFILES)).code).toBe('VERSION');
    expect(payloadErrorOf(() => unframeAnyCodeData(withCrc(Uint8Array.of(0x21, 1, 2, 3)), CODE_PROFILES)).code).toBe('VERSION');
    expect(payloadErrorOf(() => unframeAnyCodeData(new Uint8Array(0), CODE_PROFILES)).code).toBe('LENGTH');
  });

  it('dispatches to a registered synthetic version-2 profile', () => {
    const r = unframeAnyCodeData(v2Data(), WITH_V2);
    expect(r.codeVersion).toBe(2);
    expect(r.profile).toBe(SYNTHETIC_V2);
    expect(r.payload).toMatchObject({ codeVersion: 2, tag: 0x5a });
    expect(r.profile.signingMessage(r.payloadBytes).subarray(0, V2_DOMAIN.length)).toEqual(utf8(V2_DOMAIN));
    // …and still to CODE-01 for a v1 frame.
    expect(unframeAnyCodeData(data, WITH_V2).codeVersion).toBe(1);
  });
});

describe('encoder and decoder: the format word selects the profile', () => {
  it('encodes the version into the format word, refusing a version the registry lacks', () => {
    const model = encodeOrbesCode({ data: v2Data(), genomeGlyphs: makeCode(3).genomeGlyphs, codeVersion: 2 }, { codeProfiles: WITH_V2 });
    expect(model.codeVersion).toBe(2);
    const decoded = bchFormatDecode(model.formatWord);
    expect(decoded.distance).toBe(0);
    expect(parseFormatInfoValue(decoded.value)).toEqual({ codeVersion: 2, mask: model.mask });
    expect(() => encodeOrbesCode({ data: v2Data(), genomeGlyphs: makeCode(3).genomeGlyphs, codeVersion: 2 })).toThrow(/unsupported code version 2/);
    expect(encodeOrbesCode({ data: makeCode(3).data, genomeGlyphs: makeCode(3).genomeGlyphs }).codeVersion).toBe(1);
  });

  it('decodes a synthetic version-2 code through its own profile, and only when it is registered', () => {
    const glyphs = makeCode(4).genomeGlyphs;
    const img = raster(encodeOrbesCode({ data: v2Data(), genomeGlyphs: glyphs, codeVersion: 2 }, { codeProfiles: WITH_V2 }));
    const ok = decodeOrbesCode(img, { codeProfiles: WITH_V2 });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.codeVersion).toBe(2);
    expect(ok.data).toEqual(v2Data());

    const old = decodeOrbesCode(img);
    expect(old.ok).toBe(false);
    if (old.ok) return;
    expect(old.reason).toBe('FORMAT');
    expect(old.detail).toMatch(/unsupported code version 2/);
  });

  it('still decodes CODE-01 with the extended registry', () => {
    const code = makeCode(5);
    const r = decodeOrbesCode(raster(code.model), { codeProfiles: WITH_V2 });
    expect(r.ok && r.codeVersion).toBe(1);
    expect(r.ok && r.data).toEqual(code.data);
  });
});
