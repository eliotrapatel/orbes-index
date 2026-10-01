/**
 * A minimal MaxMind DB (MMDB v2) writer for tests: builds a tiny synthetic
 * GeoIP database in memory so no real (licensed, ~130 MB) file is needed.
 *
 * Format: https://maxmind.github.io/MaxMind-DB/ — an IPv6 binary search tree
 * (24-bit records; IPv4 networks live under ::/96), a 16-byte zero separator,
 * the data section, then the metadata marker and metadata map.
 *
 * Only what the fixtures need is implemented (maps, arrays, UTF-8 strings,
 * doubles, unsigned integers, booleans; no pointers or deduplication).
 */
import { isIP } from 'node:net';

export type MmdbValue = string | number | boolean | Uint | MmdbValue[] | { [key: string]: MmdbValue };

/** An unsigned integer of the given MMDB type (plain JS numbers are written as doubles). */
export class Uint {
  constructor(
    readonly bits: 16 | 32 | 64,
    readonly value: bigint,
  ) {}
}
export const u16 = (n: number) => new Uint(16, BigInt(n));
export const u32 = (n: number) => new Uint(32, BigInt(n));
export const u64 = (n: number | bigint) => new Uint(64, BigInt(n));

const T = { utf8: 2, double: 3, uint16: 5, uint32: 6, map: 7, uint64: 9, array: 11, boolean: 14 } as const;

function control(type: number, size: number): number[] {
  const out: number[] = [];
  let low: number;
  const extra: number[] = [];
  if (size < 29) low = size;
  else if (size < 29 + 256) {
    low = 29;
    extra.push(size - 29);
  } else if (size < 285 + 65_536) {
    low = 30;
    const v = size - 285;
    extra.push(v >> 8, v & 0xff);
  } else {
    low = 31;
    const v = size - 65_821;
    extra.push((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  }
  if (type <= 7) out.push((type << 5) | low);
  else out.push(low, type - 7);
  out.push(...extra);
  return out;
}

function uintBytes(v: bigint): number[] {
  const out: number[] = [];
  let x = v;
  while (x > 0n) {
    out.unshift(Number(x & 0xffn));
    x >>= 8n;
  }
  return out;
}

export function encodeValue(v: MmdbValue): Buffer {
  if (typeof v === 'string') {
    const b = Buffer.from(v, 'utf8');
    return Buffer.concat([Buffer.from(control(T.utf8, b.length)), b]);
  }
  if (typeof v === 'number') {
    const b = Buffer.alloc(8);
    b.writeDoubleBE(v);
    return Buffer.concat([Buffer.from(control(T.double, 8)), b]);
  }
  if (typeof v === 'boolean') return Buffer.from(control(T.boolean, v ? 1 : 0));
  if (v instanceof Uint) {
    const bytes = uintBytes(v.value);
    const type = v.bits === 16 ? T.uint16 : v.bits === 32 ? T.uint32 : T.uint64;
    return Buffer.from([...control(type, bytes.length), ...bytes]);
  }
  if (Array.isArray(v)) return Buffer.concat([Buffer.from(control(T.array, v.length)), ...v.map(encodeValue)]);
  const entries = Object.entries(v);
  return Buffer.concat([Buffer.from(control(T.map, entries.length)), ...entries.flatMap(([k, x]) => [encodeValue(k), encodeValue(x)])]);
}

interface TrieNode {
  left: Child;
  right: Child;
  id: number;
}
type Child = TrieNode | { data: number } | null;

function networkBits(cidr: string): number[] {
  const [addr, lenText] = cidr.split('/');
  const len = Number(lenText);
  const family = isIP(addr);
  let bytes: number[];
  if (family === 4) {
    bytes = [...new Array<number>(12).fill(0), ...addr.split('.').map(Number)];
  } else if (family === 6) {
    bytes = ipv6Bytes(addr);
  } else throw new Error(`bad network ${cidr}`);
  const total = family === 4 ? 96 + len : len;
  const bits: number[] = [];
  for (let i = 0; i < total; i++) bits.push((bytes[i >> 3] >> (7 - (i & 7))) & 1);
  return bits;
}

function ipv6Bytes(addr: string): number[] {
  const [l, r] = addr.split('::');
  const left = l ? l.split(':') : [];
  const right = r !== undefined && r !== '' ? r.split(':') : [];
  const groups = addr.includes('::') ? [...left, ...new Array<string>(8 - left.length - right.length).fill('0'), ...right] : left;
  return groups.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
}

export interface MmdbFixture {
  /** CIDR (IPv4 or IPv6) → record. */
  networks: Record<string, MmdbValue>;
  databaseType?: string;
  buildEpochSeconds?: number;
}

/** Serialise a complete .mmdb image. */
export function buildMmdb(fixture: MmdbFixture): Buffer {
  // Data section: one encoded record per network.
  const chunks: Buffer[] = [];
  const offsets = new Map<string, number>();
  let offset = 0;
  for (const [cidr, record] of Object.entries(fixture.networks)) {
    const b = encodeValue(record);
    offsets.set(cidr, offset);
    chunks.push(b);
    offset += b.length;
  }
  const data = Buffer.concat(chunks);

  // Search tree (IPv6, IPv4 under ::/96).
  const root: TrieNode = { left: null, right: null, id: -1 };
  for (const cidr of Object.keys(fixture.networks)) {
    const bits = networkBits(cidr);
    let node = root;
    for (let i = 0; i < bits.length; i++) {
      const side = bits[i] ? 'right' : 'left';
      if (i === bits.length - 1) {
        node[side] = { data: offsets.get(cidr)! };
        break;
      }
      let next = node[side];
      if (next === null || 'data' in next) {
        // Split a shorter network that covers this one: both halves keep its record.
        const inherited = next;
        next = { left: inherited, right: inherited, id: -1 };
        node[side] = next;
      }
      node = next;
    }
  }
  const nodes: TrieNode[] = [];
  const queue: TrieNode[] = [root];
  while (queue.length > 0) {
    const n = queue.shift()!;
    n.id = nodes.length;
    nodes.push(n);
    for (const c of [n.left, n.right]) if (c && !('data' in c)) queue.push(c);
  }
  const nodeCount = nodes.length;
  const record = (c: Child): number => (c === null ? nodeCount : 'data' in c ? nodeCount + 16 + c.data : c.id);
  const tree = Buffer.alloc(nodeCount * 6);
  for (const n of nodes) {
    tree.writeUIntBE(record(n.left), n.id * 6, 3);
    tree.writeUIntBE(record(n.right), n.id * 6 + 3, 3);
  }

  const metadata = encodeValue({
    binary_format_major_version: u16(2),
    binary_format_minor_version: u16(0),
    build_epoch: u64(fixture.buildEpochSeconds ?? 1_790_000_000),
    database_type: fixture.databaseType ?? 'ORBES-Test-City',
    description: { en: 'ORBES synthetic GeoIP test fixture' },
    ip_version: u16(6),
    languages: ['en'],
    node_count: u32(nodeCount),
    record_size: u16(24),
  });
  const marker = Buffer.concat([Buffer.from([0xab, 0xcd, 0xef]), Buffer.from('MaxMind.com', 'ascii')]);
  return Buffer.concat([tree, Buffer.alloc(16), data, marker, metadata]);
}

const city = (iso: string, name: string, lat: number, lon: number): MmdbValue => ({
  city: { names: { en: name } },
  country: { iso_code: iso, names: { en: iso }, is_in_european_union: iso === 'FR' },
  location: { latitude: lat, longitude: lon },
});

/**
 * The standard fixture: a few public networks with known answers, plus
 * records the resolver must ignore (private range, bogus values).
 */
export const FIXTURE: MmdbFixture = {
  networks: {
    '81.2.69.0/24': city('GB', 'London', 51.5142, -0.0931), // → GB 51.5 / -0.1
    '90.0.0.0/8': city('FR', 'Paris', 48.8566, 2.3522), // → FR 48.9 / 2.4
    '1.0.16.0/20': city('JP', 'Tokyo', 35.6895, 139.6917), // → JP 35.7 / 139.7
    '8.8.8.0/24': { country: { iso_code: 'US' } }, // country only
    '2a01:cb00::/32': city('FR', 'Paris', 48.8566, 2.3522), // IPv6
    '5.5.5.0/24': { country: { iso_code: 'ZZ' }, location: { latitude: 200, longitude: 0 } }, // nonsense: dropped
    '10.0.0.0/8': city('FR', 'Private', 48.8566, 2.3522), // private: must never be looked up
  },
};

/** Same networks, different answers (to prove a reload happened). */
export const FIXTURE_V2: MmdbFixture = {
  networks: {
    ...FIXTURE.networks,
    '81.2.69.0/24': city('DE', 'Berlin', 52.52, 13.405), // GB → DE
  },
  buildEpochSeconds: 1_792_000_000,
};
