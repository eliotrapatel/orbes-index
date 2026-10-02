# ORBES GENOME™ — Specification, version GENOME-01

Status: v1.0 (normative). Implementation: `genome/src/core/genome/`. Evidence: [genome symbol study](reports/genome-symbol-study.md).

## 1. What the Genome is

The **ORBES GENOME** is the unique visual identity of one individual ORBES product. It is a sequence of **eight orbital glyphs** drawn from a finite vocabulary of **sixteen** glyphs. It is derived deterministically from the product's canonical identity.

| Concept | Role |
|---|---|
| **ORBES SEAL** | Identical on every product. Says "this is ORBES". |
| **ORBES GENOME** | Different for every product. Says "this is *this* product". |
| **ORBES CODE** | Machine-readable, signed carrier of the identity and genome version. |

The Genome is a **public identity**. It is not a secret and not a security mechanism. Its integrity comes from the Ed25519 signature over the identity it is derived from (see [CRYPTOGRAPHY](CRYPTOGRAPHY.md)). No cryptographic secret is ever derived from the Genome, and the Genome is never derived from a secret.

## 2. Requirements

| Requirement | How GENOME-01 meets it |
|---|---|
| Deterministic: same identity + same version gives the same Genome | Pure function of `(packedIdentity, version)` |
| Two products never share a Genome | The derivation is a **bijection** on 32-bit identities, so uniqueness is a mathematical guarantee, not a database check |
| Not "simply a serial number" | Neighbouring serials produce unrelated-looking Genomes (on average ≈ 7.5 of 8 glyphs differ between consecutive serials, 7.50 measured over the 20 000 consecutive serials of `test/genome/genome.test.ts`, which is the 8 × 15/16 = 7.5 expected for unrelated values; the test asserts > 7.3) |
| Recognisable at small size | The vocabulary was selected by measurement: ≥ 99 % correct template classification at 8 px glyph diameter, 100 % from 12 px |
| Distinctly ORBES | Orbital forms only: orbits, arcs, points and orb segments, drawn with one stroke weight |
| Versioned | `genomeVersion` (1…15) is part of the signed payload |

## 3. Derivation

### 3.1 Input
The 32-bit **packed identity** (see [CRYPTOGRAPHY §2](CRYPTOGRAPHY.md#2-canonical-product-identity)): `year−2000 (7 bits) | category index (5) | serial (20)`.

### 3.2 GENOME-01 permutation
GENOME-01 uses a balanced **8-round Feistel network** on 32 bits. Its round function is SHA-256 with domain separation:

```
F(i, R) = first two bytes (big-endian u16) of SHA-256( UTF-8("ORBES/GENOME-01/F") ‖ byte(i) ‖ be16(R) )

permute(x):                               unpermute(y):
  L = x >>> 16 ; R = x & 0xFFFF             L = y >>> 16 ; R = y & 0xFFFF
  for i = 0..7:                             for i = 7..0:
    (L, R) = (R, L ⊕ F(i, R))                 (L, R) = (R ⊕ F(i, L), L)
  return (L << 16 | R) >>> 0                return (L << 16 | R) >>> 0
```

A Feistel network is a permutation for *any* round function, so:

- **uniqueness:** `permute(a) = permute(b)` implies `a = b`;
- **invertibility:** `unpermute(permute(x)) = x`.

The permutation is public and keyless. Its only purpose is visual diffusion.

### 3.3 From value to glyphs
`value = permute(packedIdentity)`. The genome is the 8 nibbles of `value`, **most significant first**:

```
glyphs[i] = (value >>> (28 − 4i)) & 0xF        i = 0..7
```

- **Fingerprint:** `G1-XXXX-XXXX`, the uppercase hex of `value`.
- **Genome ID:** the canonical product identity string (`O26-J-00184`).

### 3.4 Worked example (normative test vector)

| Item | Value |
|---|---|
| Product ID | `O26-J-00184` (J = index 1) |
| Packed identity | `0x341000B8` |
| GENOME-01 value | `0xE1DCBE52` |
| Glyphs | `[14, 1, 13, 12, 11, 14, 5, 2]` |
| Ids | QUARTER_ORB_SW · RING_POINT · QUARTER_ORB_SE · QUARTER_ORB_NE · ARC_PAIR_NWSE · QUARTER_ORB_SW · HALF_ARC_E · SMALL_ORBIT |
| Fingerprint | `G1-E1DC-BE52` |

## 4. GENOME-01 vocabulary (frozen)

Each glyph is defined inside a circle of radius **R**. Proportions below are in units of R. Angles are absolute, measured clockwise from **code north**, never radial. The stroke weight is **0.26 R**, and every stroke and dot is at least 0.22 R.

| Index | Bits | Id | Hint | Geometry (units of R) |
|---:|---|---|:---:|---|
| 0 | 0000 | `FULL_ORBIT` | ○ | Ring at radius 0.87, width 0.26 |
| 1 | 0001 | `RING_POINT` | ◉ | Ring 0.87 / 0.26, plus a central disc of radius 0.42 |
| 2 | 0010 | `SMALL_ORBIT` | ◦ | Ring at radius 0.50, width 0.26 |
| 3 | 0011 | `POINT` | • | Central disc of radius 0.37 |
| 4 | 0100 | `HALF_ARC_N` | ◠ | Arc 0.87 / 0.26 from −90° to +90° around N, round caps |
| 5 | 0101 | `HALF_ARC_E` | ) | Same arc, centred on E |
| 6 | 0110 | `HALF_ARC_S` | ◡ | Same arc, centred on S |
| 7 | 0111 | `HALF_ARC_W` | ( | Same arc, centred on W |
| 8 | 1000 | `ARC_PAIR_NS` | ↕ | Two arcs 0.87 / 0.26, each ±45° around N and S |
| 9 | 1001 | `ARC_PAIR_NESW` | ⤢ | Same pair, around NE and SW |
| 10 | 1010 | `ARC_PAIR_EW` | ↔ | Same pair, around E and W |
| 11 | 1011 | `ARC_PAIR_NWSE` | ⤡ | Same pair, around NW and SE |
| 12 | 1100 | `QUARTER_ORB_NE` | ◝ | Filled quarter disc of radius 1 in the NE quadrant (butt sector) |
| 13 | 1101 | `QUARTER_ORB_SE` | ◞ | Quarter disc, SE quadrant |
| 14 | 1110 | `QUARTER_ORB_SW` | ◟ | Quarter disc, SW quadrant |
| 15 | 1111 | `QUARTER_ORB_NW` | ◜ | Quarter disc, NW quadrant |

Specimen: [`assets/genome-01-vocabulary.svg`](assets/genome-01-vocabulary.svg).

**Families.** There are four symmetric forms plus three oriented families of four:

- the **half arc** (a half orbit);
- the **arc pair** (two opposing orbit fragments);
- the **quarter orb** (an orb in one quadrant, like a phase of the moon).

Indices follow the family order, and within each oriented family they run clockwise from north.

**Freeze rule.** The index, geometry and order of every GENOME-01 glyph are permanent, because a glyph's index is the 4-bit value it represents in every product ever issued. Any change requires GENOME-02.

### 4.1 Why these glyphs (summary of the symbol study)

**Method.** 43 candidates from 14 orbital families were rasterised at 8–24 px glyph diameters under:

- ±5° rotation;
- ±0.5 px offset;
- Gaussian blur of σ 0.6–1.0 px.

Pairwise dissimilarity is `1 − NCC`, taken at the worst case over all of these conditions. Every systematic 16-glyph structure was scored (3,066 sets), and the set that maximises the minimum pairwise dissimilarity at 10–12 px won.

**Results.**
- The winning set has a worst-pair dissimilarity of **0.282**.
- Monte-Carlo template classification accuracy:

  | Glyph diameter | Accuracy |
  |---|---|
  | 8 px | 99.09 % |
  | 10 px | 99.97 % |
  | ≥ 12 px | 100 % |

**Rejected forms.** Half-filled orbits (◐), crescents (eclipses), half orbs and the solid orb (●) were measured and **rejected**. They blur into neighbouring glyphs at small sizes; for example, a crescent and a half arc on the same side score 0.03–0.04. The study keeps the evidence.

## 5. Rendering

### 5.1 In the ORBES CODE
In the code, glyph *i* is drawn with R = 1.75 u, centred at radius 7.5 u and angle i·45°, starting at north and going clockwise (see [ORBES-CODE-SPEC §4.2](ORBES-CODE-SPEC.md#42-genome-orbit)).

### 5.2 Standalone

| Layout | Use | Description |
|---|---|---|
| **Row** | Certificate card, packaging, console genome list | The 8 glyphs in reading order, separated by small centred points: `◟ · ◉ · ◞ · ◝ · ⤡ · ◟ · ) · ◦`. |
| **Orbit** | Verification page, console product page and generator, hero presentation, engraving | The 8 glyphs on a circle around a small ORBES SEAL, mirroring the code: glyph 0 at north, then clockwise, each glyph in its absolute orientation. |

The verification page draws the **orbit** (since 2026-10-02), so a customer can compare the screen with the piece in hand at a glance: same glyphs, same order, same orientation, same SEAL at the centre. On screen the figure is a centred square of `min(64vw, 260px)`; a glyph is 3.5 u of the figure's 21 u, so it is drawn at about 43 px (42 px on a 390 px phone, 34 px on a 320 px one), well above the 12 px from which the symbol study classifies every glyph (§4.1). The figure carries no north marker: glyph 0 is at the top, where it sits on the piece when the code's polaris moon (the haloed one) is at the top left. A polaris marker would only come as an option of `renderGenomeSvg`, once the brand validates it, without changing the console figure.

The plain-text hint (`◟◉◞◝⤡◟)◦`) may be used in logs and plain-text channels. It is an approximation only.

### 5.3 Colour
Black on white, ink on ivory, or white on black. A Genome is never tinted per product. It differs by form, never by colour.

## 6. Machine reading and cross-check

The decoder MAY classify the eight glyphs it sees (template matching after rectification) and send them with the decoded data. The server recomputes the Genome from the **signed** identity. Then:

- When at least 6 glyphs were read with confidence ≥ 0.5 and at least 2 of them disagree, the artifact's printed Genome does not match its signed data. The verification reports **UNUSUAL ACTIVITY** (`GENOME_MISMATCH`), and the inconsistency is recorded as an anomaly.
- Otherwise the Genome check is `MATCH`, `INCONCLUSIVE` or `NOT_PROVIDED`. Authenticity never *depends* on reading the Genome; it rests on the signature.

The identity can also be recovered *from* a fully read Genome with `identityFromGenomeGlyphs`, which uses the inverse permutation. This allows offline cross-checks.

## 7. Versioning
- `genomeVersion` occupies the low nibble of payload byte 0 (1…15). It is signed.
- A future GENOME-02 may change the vocabulary, the number of glyphs or the permutation. Products issued under GENOME-01 keep their Genome forever. The verifier selects the generator by the signed version, and `computeGenome` throws for unsupported versions.
- The genome version is independent of the code version: CODE-01 can carry GENOME-02 if its glyph count fits the genome orbit.

## 8. Database representation
The `genomes` table stores, per product and genome version:

- `genome_id` (the product ID);
- `value` (u32);
- `glyphs` (smallint[8]);
- `pattern` (glyph ids joined by `·`);
- `fingerprint`.

Uniqueness constraints on `(genome_version, value)` and `fingerprint` restate the bijection as a database invariant. See [DATABASE](DATABASE.md).
