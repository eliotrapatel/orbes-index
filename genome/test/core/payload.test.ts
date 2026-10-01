import { describe, expect, it } from 'vitest';
import { fromHex, toHex } from '../../src/core/bytes.js';
import { CODE01 } from '../../src/core/code/profile.js';
import { crc16 } from '../../src/core/ecc/crc16.js';
import { packIdentity, type ProductIdentity } from '../../src/core/identity.js';
import {
  CODE_DATA_V1_LENGTH,
  ISSUED_DAY_EPOCH_UTC,
  PAYLOAD_V1_LENGTH,
  PayloadError,
  SIGNATURE_LENGTH,
  SIGNING_DOMAIN_V1,
  dateFromIssuedDay,
  decodePayload,
  encodePayload,
  frameCodeData,
  issuedDayFromDate,
  signingMessage,
  unframeCodeData,
  type CodePayloadV1,
  type PayloadErrorCode,
} from '../../src/core/payload.js';

/** mulberry32: small, fast, seedable; every test owns its own stream. */
function prng(seed: number): { int(min: number, max: number): number; bytes(length: number): Uint8Array } {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return {
    int: (min, max) => min + (next() % (max - min + 1)),
    bytes: (length) => Uint8Array.from({ length }, () => next() & 0xff),
  };
}

type Rng = ReturnType<typeof prng>;

function randomPayload(rng: Rng): CodePayloadV1 {
  return {
    codeVersion: 1,
    genomeVersion: rng.int(1, 15),
    keyId: rng.int(1, 255),
    identity: { year: rng.int(2000, 2099), categoryIndex: rng.int(1, 31), serial: rng.int(1, 999_999) },
    issue: rng.int(1, 255),
    issuedDay: rng.int(0, 0xffff),
    nonce: rng.bytes(4),
  };
}

/** Run `fn`, require a PayloadError and return its code. */
function payloadErrorCode(fn: () => unknown): PayloadErrorCode {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PayloadError);
    return (e as PayloadError).code;
  }
  throw new Error('expected a PayloadError, nothing was thrown');
}

// O26-J-00184 with J = category index 1, issued 2026-10-01 (day 1004 = 0x03EC).
const SAMPLE: CodePayloadV1 = {
  codeVersion: 1,
  genomeVersion: 1,
  keyId: 7,
  identity: { year: 2026, categoryIndex: 1, serial: 184 },
  issue: 1,
  issuedDay: 1004,
  nonce: fromHex('deadbeef'),
};
const SAMPLE_HEX = '11' + '07' + '341000b8' + '01' + '03ec' + 'deadbeef';

const withField = (patch: Partial<Record<keyof CodePayloadV1, unknown>>): CodePayloadV1 =>
  ({ ...SAMPLE, ...patch }) as CodePayloadV1;

describe('constants', () => {
  it('match the CODE-01 contract', () => {
    expect(PAYLOAD_V1_LENGTH).toBe(13);
    expect(SIGNATURE_LENGTH).toBe(64);
    expect(CODE_DATA_V1_LENGTH).toBe(PAYLOAD_V1_LENGTH + SIGNATURE_LENGTH + 2);
    expect(CODE_DATA_V1_LENGTH).toBe(CODE01.ecc.dataBytes);
    expect(SIGNING_DOMAIN_V1).toBe('ORBES-CODE/v1');
    expect(ISSUED_DAY_EPOCH_UTC).toBe(1_704_067_200_000);
    expect(new Date(ISSUED_DAY_EPOCH_UTC).toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('encodePayload / decodePayload', () => {
  it('encodes the documented byte layout (golden vector)', () => {
    expect(toHex(encodePayload(SAMPLE))).toBe(SAMPLE_HEX);
    expect(decodePayload(fromHex(SAMPLE_HEX))).toEqual(SAMPLE);
  });

  it('places every field at its documented offset', () => {
    const p = withField({ genomeVersion: 15, keyId: 255, issue: 254, issuedDay: 0xfffe, nonce: fromHex('01020304') });
    const b = encodePayload(p);
    expect(b.length).toBe(PAYLOAD_V1_LENGTH);
    expect(b[0]).toBe(0x1f);
    expect(b[1]).toBe(255);
    expect(toHex(b.subarray(2, 6))).toBe(packIdentity(p.identity).toString(16).padStart(8, '0'));
    expect(b[6]).toBe(254);
    expect(toHex(b.subarray(7, 9))).toBe('fffe');
    expect(toHex(b.subarray(9, 13))).toBe('01020304');
  });

  it('round-trips random valid payloads (seeded)', () => {
    const rng = prng(0xc0de01);
    for (let i = 0; i < 5000; i++) {
      const p = randomPayload(rng);
      const bytes = encodePayload(p);
      expect(bytes.length).toBe(PAYLOAD_V1_LENGTH);
      const decoded = decodePayload(bytes);
      expect(decoded).toEqual(p);
      expect(encodePayload(decoded)).toEqual(bytes);
    }
  });

  it('is canonical: any 13 bytes either fail to decode or re-encode to themselves (seeded)', () => {
    const rng = prng(0xfeed);
    let accepted = 0;
    for (let i = 0; i < 20_000; i++) {
      const bytes = rng.bytes(PAYLOAD_V1_LENGTH);
      bytes[0] = (bytes[0] & 0x0f) | 0x10; // keep the version valid so the deeper checks are exercised
      let decoded: CodePayloadV1;
      try {
        decoded = decodePayload(bytes);
      } catch (e) {
        expect(e).toBeInstanceOf(PayloadError);
        continue;
      }
      accepted++;
      expect(encodePayload(decoded)).toEqual(bytes);
    }
    expect(accepted).toBeGreaterThan(1000);
  });

  it('decodes a nonce that does not alias the input', () => {
    const bytes = fromHex(SAMPLE_HEX);
    const decoded = decodePayload(bytes);
    bytes[9] = 0;
    expect(toHex(decoded.nonce)).toBe('deadbeef');
  });

  describe('decodePayload is strict', () => {
    const patched = (offset: number, value: number): Uint8Array => {
      const b = fromHex(SAMPLE_HEX);
      b[offset] = value;
      return b;
    };
    const withPacked = (packed: number): Uint8Array => {
      const b = fromHex(SAMPLE_HEX);
      new DataView(b.buffer).setUint32(2, packed);
      return b;
    };

    it.each([
      ['empty', new Uint8Array(0), 'LENGTH'],
      ['12 bytes', fromHex(SAMPLE_HEX).subarray(0, 12), 'LENGTH'],
      ['14 bytes', fromHex(SAMPLE_HEX + '00'), 'LENGTH'],
      ['79 bytes (framed data)', new Uint8Array(79), 'LENGTH'],
      ['not a Uint8Array', [...fromHex(SAMPLE_HEX)] as unknown as Uint8Array, 'LENGTH'],
      ['code version 0', patched(0, 0x01), 'VERSION'],
      ['code version 2', patched(0, 0x21), 'VERSION'],
      ['code version 15', patched(0, 0xf1), 'VERSION'],
      ['genome version 0', patched(0, 0x10), 'RESERVED'],
      ['key id 0', patched(1, 0), 'RESERVED'],
      ['issue 0', patched(6, 0), 'RESERVED'],
      ['identity year 2100', withPacked(100 * 2 ** 25 + (1 << 20) + 184), 'RANGE'],
      ['identity category 0', withPacked(26 * 2 ** 25 + 184), 'RANGE'],
      ['identity serial 0', withPacked(26 * 2 ** 25 + (1 << 20)), 'RANGE'],
      ['identity serial 1 000 000', withPacked(26 * 2 ** 25 + (1 << 20) + 1_000_000), 'RANGE'],
    ] as const)('%s → %s', (_label, bytes, code) => {
      expect(payloadErrorCode(() => decodePayload(bytes))).toBe(code);
    });

    it('accepts the extremes of every field', () => {
      const b = encodePayload(
        withField({ genomeVersion: 15, keyId: 255, issue: 255, issuedDay: 0xffff, identity: { year: 2099, categoryIndex: 31, serial: 999_999 } }),
      );
      expect(decodePayload(b).issuedDay).toBe(0xffff);
      expect(decodePayload(encodePayload(withField({ issuedDay: 0 }))).issuedDay).toBe(0);
    });
  });

  describe('encodePayload validates', () => {
    const bad = (identity: ProductIdentity): CodePayloadV1 => withField({ identity });

    it.each([
      ['code version 2', withField({ codeVersion: 2 }), 'VERSION'],
      ['genome version 0', withField({ genomeVersion: 0 }), 'RESERVED'],
      ['genome version 16', withField({ genomeVersion: 16 }), 'RANGE'],
      ['genome version 1.5', withField({ genomeVersion: 1.5 }), 'RANGE'],
      ['key id 0', withField({ keyId: 0 }), 'RESERVED'],
      ['key id 256', withField({ keyId: 256 }), 'RANGE'],
      ['key id -1', withField({ keyId: -1 }), 'RANGE'],
      ['issue 0', withField({ issue: 0 }), 'RESERVED'],
      ['issue 256', withField({ issue: 256 }), 'RANGE'],
      ['issued day -1', withField({ issuedDay: -1 }), 'RANGE'],
      ['issued day 65536', withField({ issuedDay: 65_536 }), 'RANGE'],
      ['issued day NaN', withField({ issuedDay: Number.NaN }), 'RANGE'],
      ['identity year 1999', bad({ year: 1999, categoryIndex: 1, serial: 1 }), 'RANGE'],
      ['identity category 0', bad({ year: 2026, categoryIndex: 0, serial: 1 }), 'RANGE'],
      ['identity serial 1 000 000', bad({ year: 2026, categoryIndex: 1, serial: 1_000_000 }), 'RANGE'],
      ['nonce of 3 bytes', withField({ nonce: new Uint8Array(3) }), 'LENGTH'],
      ['nonce of 5 bytes', withField({ nonce: new Uint8Array(5) }), 'LENGTH'],
      ['nonce as number[]', withField({ nonce: [1, 2, 3, 4] }), 'LENGTH'],
    ] as const)('rejects %s → %s', (_label, p, code) => {
      expect(payloadErrorCode(() => encodePayload(p))).toBe(code);
    });

    it('keeps the IdentityError as the cause of an identity RANGE error', () => {
      try {
        encodePayload(bad({ year: 2026, categoryIndex: 1, serial: 0 }));
        expect.unreachable();
      } catch (e) {
        expect((e as PayloadError).cause).toBeInstanceOf(Error);
        expect(((e as PayloadError).cause as Error).name).toBe('IdentityError');
      }
    });
  });
});

describe('signingMessage', () => {
  it('is utf8(domain) ‖ 0x00 ‖ payload', () => {
    const payload = fromHex(SAMPLE_HEX);
    const msg = signingMessage(payload);
    // 'ORBES-CODE/v1' in ASCII
    expect(toHex(msg)).toBe('4f524245532d434f44452f7631' + '00' + SAMPLE_HEX);
    expect(msg.length).toBe(SIGNING_DOMAIN_V1.length + 1 + PAYLOAD_V1_LENGTH);
  });

  it('only accepts 13-byte payloads', () => {
    expect(payloadErrorCode(() => signingMessage(new Uint8Array(12)))).toBe('LENGTH');
    expect(payloadErrorCode(() => signingMessage(new Uint8Array(14)))).toBe('LENGTH');
  });

  it('does not alias the payload', () => {
    const payload = fromHex(SAMPLE_HEX);
    const msg = signingMessage(payload);
    payload[0] = 0;
    expect(msg[SIGNING_DOMAIN_V1.length + 1]).toBe(0x11);
  });
});

describe('frameCodeData / unframeCodeData', () => {
  const payload = fromHex(SAMPLE_HEX);
  const signature = Uint8Array.from({ length: SIGNATURE_LENGTH }, (_, i) => (i * 37 + 11) & 0xff);

  it('appends a big-endian CRC-16/CCITT-FALSE over payload ‖ signature', () => {
    const data = frameCodeData(payload, signature);
    expect(data.length).toBe(CODE_DATA_V1_LENGTH);
    expect(data.subarray(0, 13)).toEqual(payload);
    expect(data.subarray(13, 77)).toEqual(signature);
    const crc = crc16(data.subarray(0, 77));
    expect(data[77]).toBe(crc >>> 8);
    expect(data[78]).toBe(crc & 0xff);
  });

  it('round-trips and returns independent copies', () => {
    const data = frameCodeData(payload, signature);
    const out = unframeCodeData(data);
    expect(out.payloadBytes).toEqual(payload);
    expect(out.signature).toEqual(signature);
    expect(out.payload).toEqual(SAMPLE);
    data.fill(0);
    expect(out.payloadBytes).toEqual(payload);
    expect(out.signature).toEqual(signature);
  });

  it('round-trips random payloads and signatures (seeded)', () => {
    const rng = prng(0xf4a3e);
    for (let i = 0; i < 1000; i++) {
      const p = randomPayload(rng);
      const sig = rng.bytes(SIGNATURE_LENGTH);
      const out = unframeCodeData(frameCodeData(encodePayload(p), sig));
      expect(out.payload).toEqual(p);
      expect(out.signature).toEqual(sig);
    }
  });

  it('detects every single-bit error with CRC (exhaustive over 79 × 8 bits)', () => {
    const data = frameCodeData(payload, signature);
    for (let bit = 0; bit < CODE_DATA_V1_LENGTH * 8; bit++) {
      const corrupted = data.slice();
      corrupted[bit >>> 3] ^= 0x80 >>> (bit & 7);
      expect(payloadErrorCode(() => unframeCodeData(corrupted))).toBe('CRC');
    }
  });

  it('checks length first, then CRC, then the payload', () => {
    expect(payloadErrorCode(() => unframeCodeData(new Uint8Array(78)))).toBe('LENGTH');
    expect(payloadErrorCode(() => unframeCodeData(new Uint8Array(80)))).toBe('LENGTH');
    const invalidPayload = fromHex(SAMPLE_HEX);
    invalidPayload[0] = 0x21; // code version 2, framed with a correct CRC
    expect(payloadErrorCode(() => unframeCodeData(frameCodeData(invalidPayload, signature)))).toBe('VERSION');
    invalidPayload[0] = 0x11;
    invalidPayload[1] = 0; // key id 0
    expect(payloadErrorCode(() => unframeCodeData(frameCodeData(invalidPayload, signature)))).toBe('RESERVED');
  });

  it('frameCodeData checks lengths', () => {
    expect(payloadErrorCode(() => frameCodeData(new Uint8Array(12), signature))).toBe('LENGTH');
    expect(payloadErrorCode(() => frameCodeData(payload, new Uint8Array(63)))).toBe('LENGTH');
    expect(payloadErrorCode(() => frameCodeData(payload, new Uint8Array(65)))).toBe('LENGTH');
  });
});

describe('issued day', () => {
  it('counts whole UTC days since 2024-01-01', () => {
    expect(issuedDayFromDate(new Date('2024-01-01T00:00:00.000Z'))).toBe(0);
    expect(issuedDayFromDate(new Date('2024-01-01T23:59:59.999Z'))).toBe(0);
    expect(issuedDayFromDate(new Date('2024-01-02T00:00:00.000Z'))).toBe(1);
    expect(issuedDayFromDate(new Date('2024-12-31T12:00:00.000Z'))).toBe(365); // 2024 is a leap year
    expect(issuedDayFromDate(new Date('2026-10-01T09:30:00.000Z'))).toBe(1004);
    // A local-time offset does not change the UTC day.
    expect(issuedDayFromDate(new Date('2026-10-01T01:00:00+02:00'))).toBe(1003);
  });

  it('maps a day back to midnight UTC', () => {
    expect(dateFromIssuedDay(0).toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(dateFromIssuedDay(1004).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(issuedDayFromDate(dateFromIssuedDay(0xffff))).toBe(0xffff);
  });

  it('round-trips random days (seeded)', () => {
    const rng = prng(0xda7e);
    for (let i = 0; i < 2000; i++) {
      const day = rng.int(0, 0xffff);
      const date = dateFromIssuedDay(day);
      expect(issuedDayFromDate(date)).toBe(day);
      expect(issuedDayFromDate(new Date(date.getTime() + 86_399_999))).toBe(day);
    }
  });

  it('rejects dates and days outside the 16-bit range', () => {
    expect(payloadErrorCode(() => issuedDayFromDate(new Date('2023-12-31T23:59:59.999Z')))).toBe('RANGE');
    expect(payloadErrorCode(() => issuedDayFromDate(new Date(ISSUED_DAY_EPOCH_UTC + 65_536 * 86_400_000)))).toBe('RANGE');
    expect(payloadErrorCode(() => issuedDayFromDate(new Date(Number.NaN)))).toBe('RANGE');
    expect(payloadErrorCode(() => dateFromIssuedDay(-1))).toBe('RANGE');
    expect(payloadErrorCode(() => dateFromIssuedDay(65_536))).toBe('RANGE');
    expect(payloadErrorCode(() => dateFromIssuedDay(1.5))).toBe('RANGE');
  });
});
