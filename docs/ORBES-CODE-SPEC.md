# ORBES CODE™ — Specification, version CODE-01

Status: v1.0 (normative for CODE-01). Implementation: `genome/src/core/code/` (encoder), `genome/src/core/decoder/` (reference decoder).
Related: [ORBES-GENOME-SPEC](ORBES-GENOME-SPEC.md) (glyph vocabulary), [CRYPTOGRAPHY](CRYPTOGRAPHY.md) (payload and signature), [BRAND-DESIGN-SYSTEM](BRAND-DESIGN-SYSTEM.md) (presentation).

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119. This specification is self-contained. With it, the cryptography spec and the published test vectors (`docs/vectors/code01-sample.json`), a third party can implement a compatible encoder or decoder.

---

## 1. Purpose and principles

The ORBES CODE is a proprietary two-dimensional, machine-readable visual code. It carries a product identity signed by ORBES. It is designed so that:

1. **It looks like ORBES and works as data.** The code is an orbital diagram: a central seal, a ring of genome glyphs, concentric data orbits drawn as arcs, and four moons. It deliberately avoids the square-module grid of QR / Data Matrix.
2. **Established mechanisms do the hard work.** Reed-Solomon over GF(256) provides error correction, BCH(15,5) protects the format word, CRC-16 detects miscorrection, and Ed25519 provides authenticity. The geometry is proprietary. The mathematics is not.
3. **Visibility is not security.** Anyone can read and re-draw a code. What makes a code authentic is the signature it carries, which only ORBES can produce.

## 2. Coordinate system and units

- Distances are in abstract units **u**. 1 u is the nominal data-cell pitch.
- Origin at the centre of the seal. **x** to the right, **y downward** (SVG convention).
- Angles θ in radians, measured **clockwise from north** (straight up). A point at radius r and angle θ is `(r·sin θ, −r·cos θ)`.
- The printed artifact is a square of **50 u × 50 u**: content half-width 23 u plus a 2 u quiet zone on every side, with the centre at (0, 0).

## 3. Anatomy

```
              moon (POLARIS, NW)                      moon (NE)
                 ◉                                        ●
                        ╭ ─ ─ ─ ─ horizon (decor) ─ ─ ─ ─╮
                    ╭──  data orbits 13 rings r=10.5…22.5 ──╮
                   │      ╭ genome orbit r=7.5 (8 glyphs) ╮   │
                   │      │        ╭ seal ╮               │   │
                   │      │        │  ◉   │               │   │
                   │      │        ╰──────╯               │   │
                   │      ╰───────────────────────────────╯   │
                    ╰──────────────────────────────────────╯
                 ●                                        ●
              moon (SW)                                moon (SE)
```

| Element | Geometry | Layer | Machine role | Critical? |
|---|---|---|---|---|
| Seal core | disc r = 2.0 | `seal` | finder (rotation-invariant run pattern), centre | **Yes** |
| Seal gap | annulus 2.0–3.0, no ink | `seal` | finder pattern | **Yes** |
| Seal orbit | annulus 3.0–4.0, ink | `seal` | finder, ellipse fit (affine) | **Yes** |
| Seal quiet ring | annulus 4.0 ≤ r < 5.75, no ink | — | isolates the finder | **Yes** |
| Genome glyphs | 8 glyphs, radius 1.75, centres on r = 7.5 at θ = i·45° | `genome` | human identity; optional machine cross-check | No (secondary) |
| Format cells | 2 × 15 cells on ring 0 | `format` | version + mask (BCH) | **Yes** |
| Data cells | 1314 cells on 13 rings | `data` | RS codeword (payload, signature, CRC, parity) | **Yes** |
| Moons | 4 discs r = 1.75 at radius 27.5, θ = 315°, 45°, 135°, 225° | `moon` | homography anchors | **Yes** |
| Polaris halo | annulus centred on the NW moon, r = 2.6, width 0.4 | `polaris` | orientation hint only | No |
| Horizon and guides | hairline rings r = 24.0 (0.08 u), 9.5 and 23.5 (0.06 u), reduced tone | `decor` | none, never sampled | No |
| Quiet zones | seal quiet ring (4.0–5.75), outer quiet band (from the data edge at r 22.86 to the moons and polaris halo), 2 u outer margin | — | isolation | **Yes** (ink-free, except the decorative hairlines permitted in the outer quiet band by §4.7) |

Elements marked **Yes** MUST be reproduced exactly within the tolerances of §9. The others MAY be omitted, for example `decor` on engraved metal, without affecting decodability.

## 4. Geometry (normative constants)

### 4.1 Seal
- Core disc: radius 2.0.
- Orbit ring: inner radius 3.0, outer radius 4.0.
- Along any line through the centre, the ink pattern is dark : light : dark : light : dark in widths **1 : 1 : 4 : 1 : 1** (u). This holds in every direction, so it is rotation invariant.

### 4.2 Genome orbit
Glyph *i* (i = 0…7) is centred at radius 7.5, angle i·45°. Glyph 0 is at north and the order is clockwise. Each glyph is drawn from the GENOME vocabulary (see [ORBES-GENOME-SPEC](ORBES-GENOME-SPEC.md)) with all ink inside radius 1.75 of its centre.

The genome orbit therefore spans r 5.75–9.25, and a glyph whose ink reaches its 1.75 limit towards the seal touches **exactly** r = 5.75, the outer edge of the seal quiet ring. This is by design: the quiet ring is the half-open annulus 4.0 ≤ r < 5.75, so the seal keeps its full 1.75 u of clearance (§4.6) and no glyph ink ever enters it. Renditions MUST NOT let print gain push genome ink inside r = 5.75 by more than the §9 ink-spread tolerance.

### 4.3 Data orbits
Ring *k* (k = 0…12) has centre radius `r_k = 10.5 + k` and `n_k = 4 · round(2π·r_k / 4)` cells, a multiple of 4. Cell *c* of ring *k* spans the angles `[c·2π/n_k, (c+1)·2π/n_k)`. Its sampling point is at radius `r_k` and angle `(c + ½)·2π/n_k`.

| k | r_k | n_k | offset |
|---:|---:|---:|---:|
| 0 | 10.5 | 64 | 0 |
| 1 | 11.5 | 72 | 64 |
| 2 | 12.5 | 80 | 136 |
| 3 | 13.5 | 84 | 216 |
| 4 | 14.5 | 92 | 300 |
| 5 | 15.5 | 96 | 392 |
| 6 | 16.5 | 104 | 488 |
| 7 | 17.5 | 108 | 592 |
| 8 | 18.5 | 116 | 700 |
| 9 | 19.5 | 124 | 816 |
| 10 | 20.5 | 128 | 940 |
| 11 | 21.5 | 136 | 1068 |
| 12 | 22.5 | 140 | 1204 |
| | | **1344** | |

Cells are numbered globally (**flat index**) ring-major: `flat = offset_k + c`.

### 4.4 Format cells
There are two copies of the 15-bit format word, both on ring 0:

- copy A at cells 0…14
- copy B at cells 24…38

Bit *b* of the word, most significant first, goes in cell `start + b`. The placement is asymmetric, so a 180° misorientation reads garbage rather than a valid word.

### 4.5 Moons
Four discs of radius 1.75 at radius 27.5:

| Index | Angle | Name | Position (u) |
|---:|---:|---|---|
| 0 | 315° | **Polaris** (NW) | (−19.445, −19.445) |
| 1 | 45° | NE | (19.445, −19.445) |
| 2 | 135° | SE | (19.445, 19.445) |
| 3 | 225° | SW | (−19.445, 19.445) |

The polaris carries a concentric halo annulus (radius 2.6, width 0.4). A decoder MAY use it to rank orientation hypotheses but MUST NOT require it.

### 4.6 Clearances
These are the minimum light (no-ink) clearances that every rendition MUST preserve:

| Clearance | Region |
|---|---|
| ≥ 1.75 u | Seal orbit to the innermost genome ink (4.0 → 5.75; genome ink may touch 5.75, §4.2) |
| ≥ 0.6 u | Decorative hairlines to any machine-critical ink |
| ≥ 1.0 u | Moons to any other ink, the polaris halo excepted |
| 2.0 u | Outer quiet zone beyond the 46 u content square |

### 4.7 Quiet regions and decorative hairlines
- The **seal quiet ring** (4.0 ≤ r < 5.75) and the **2 u outer margin** MUST be entirely free of ink.
- The **outer quiet band**, between the outer edge of data ring 12 (r = 22.86) and the moons and polaris halo (from r = 24.70 on the NW diagonal, 25.75 on the others), MUST be free of ink **except** for the two decorative hairlines of the `decor` layer, which are permitted there only at exactly these radii and tones:

  | Hairline | Centre radius | Width | Tone (share of ink) | Clearance to machine-critical ink |
  |---|---|---|---|---|
  | Outer guide | 23.5 | 0.06 u | 0.25 | 0.61 u to data ring 12 |
  | Horizon | 24.0 | 0.08 u | 0.35 | 0.66 u to the polaris halo |

  Every decorative hairline MUST keep **≥ 0.6 u** clearance from any machine-critical ink (§4.6); no other mark of any kind (text, rules, texture, ornament) is permitted in the band.
- The third hairline, the inner guide at r = 9.5 (0.06 u, tone 0.25), lies in the light gap between the genome orbit and data ring 0, 0.61 u from data ring 0. It is closer to the genome glyphs (0.22 u), which are not machine-critical.
- Decorative hairlines are optional (§3) and painted first (§8.2). The reference decoder never samples them: its quiet-zone probes sit at r = 4.85 and r = 24.6, clear of every hairline.
---

## 5. Data content

The code carries exactly **79 bytes of framed data**:

```
framed = payload (13 bytes) ‖ Ed25519 signature (64 bytes) ‖ CRC-16 (2 bytes, big-endian)
```

The payload layout, the canonical encoding, the signing message (`"ORBES-CODE/v1" ‖ 0x00 ‖ payload`) and the verification rules are specified in [CRYPTOGRAPHY](CRYPTOGRAPHY.md) §3–4.

- **CRC-16:** CRC-16/CCITT-FALSE (polynomial 0x1021, initial value 0xFFFF, no reflection, final XOR 0) computed over `payload ‖ signature`. Check value for ASCII `123456789` is `0x29B1`.

## 6. Error correction

### 6.1 Reed-Solomon
- **Code:** RS(164, 79) over GF(2⁸), with primitive polynomial **x⁸+x⁴+x³+x²+1 (0x11D)** and generator element α = 2. This is a code shortened from RS(255, 170).
- **Generator polynomial:** `g(x) = ∏_{i=0}^{84} (x − αⁱ)`. The first consecutive root is α⁰, the same convention as QR Code.
- **Systematic codeword:** `codeword = framed (79 bytes) ‖ parity (85 bytes)`. Byte j is the coefficient of x^(163−j).
- **Capacity:** any combination of *e* byte errors and *f* byte erasures with **2e + f ≤ 85**. That is up to 42 unknown byte errors (25.6 % of the codeword), or 85 erasures (51.8 %).

### 6.2 Why Reed-Solomon (decision record)
- **Considered:** BCH binary codes, LDPC, convolutional/turbo codes, fountain codes and Reed-Solomon.
- **Damage profile:** damage to a printed artifact is spatially clustered (scratches, glare, fingers, wear). Placing each byte on 8 consecutive cells of one orbit turns such damage into a few byte errors, which RS corrects optimally (it is an MDS code).
- **Erasures:** RS natively supports *erasures*, so a decoder that knows a region is unreadable (glare saturation, occlusion, low confidence) recovers twice as many bytes there.
- **Track record:** it is the error-correction code of QR Code, Data Matrix, Aztec and MaxiCode, with decades of deployment and well-understood miscorrection behaviour. It is cheap to decode in JavaScript (≈ 1 ms for 42 errors).
- **Miscorrection:** with 85 parity bytes and errors-only decoding, the probability that an uncorrectable word decodes to a *wrong* codeword is below 10⁻⁶⁰. Erasures spend parity, so this margin shrinks as more bytes are erased: a decoder SHOULD bound its erasures (the reference decoder stops at 70, §11). The CRC-16 and the signature catch a miscorrection anyway; the signature turns one into INVALID SIGNATURE, which is why it must stay rare.
- **What we did not do:** no new error-correction algorithm was invented.

### 6.3 Format word
- **Content:** 5 information bits, `v = (codeVersion − 1) << 2 | mask`. That gives codeVersion 1…8 and mask 0…3.
- **Code:** BCH(15,5) with generator polynomial **0x537**: `word = (v << 10) | ((v << 10) mod g(x))`. The result is then XORed with **0x5412**, the same construction as QR Code format information, so the all-zero word never appears. Minimum distance 7: corrects any 3 bit errors per copy.
- **Decoding:** pick the codeword nearest to the read bits across both copies.

## 7. Bit placement and masking

1. **Bit order:** bit *j* (0 ≤ j < 1312) of the codeword is `(codeword[j >> 3] >> (7 − (j & 7))) & 1`, most significant bit first.
2. **Data cells:** these are all flat cells except the 30 format cells, kept in ascending flat order. That gives 1314 positions, `D[0…1313]`. Bit *j* is written to cell `D[j]`. The 2 remaining positions `D[1312]`, `D[1313]` are padding with value 0.
3. **Masking:** each data cell `D[p]` (padding included) is XORed with `M_m[p]`, where `M_m` is mask sequence *m*:
   ```
   seeds = [0x9E3779B9, 0x7F4A7C15, 0x94D049BB, 0xBF58476D]
   s = seeds[m]                      (uint32)
   for p in 0..1313:
       s ^= s << 13;  s ^= s >> 17;  s ^= s << 5     (uint32 xorshift32; >> is logical)
       M_m[p] = s >> 31
   ```
   The mask is a whitening pattern for print quality and thresholding. It has no security role.
4. **Format cells:** the 15-bit format word is written into both copies. Format cells are **not** masked.
5. **Final state:** the resulting 1344 values are the printed state. 1 means ink, 0 means no ink, in the artifact's polarity. In an inverted rendition (light ink on a dark substrate), "ink" is the light colour.

### 7.1 Mask selection (informative)
Encoders SHOULD evaluate all four masks and keep the one with the lowest penalty. The penalty is the sum of three terms:

| Term | Rule | Cost |
|---|---|---|
| Runs | On each ring, cyclic runs of identical cells longer than 9 | `(length − 9)²` |
| Balance | 8 angular sectors × 3 radial bands (rings 0–5, 6–9, 10–12); a sector whose ink ratio deviates from 0.5 by more than 0.15 | `40 × excess` |
| Patches | A cyclic paper run of ≥ 7 cells overlapping in angle a paper run of ≥ 7 cells on the next ring outward | `2 × overlap arc length (u)` |

Ties go to the lowest mask id.

Decoders MUST accept all four masks, whatever penalty the encoder used.

## 8. Rendering

### 8.1 Cell arcs
On each ring, every maximal cyclic run of consecutive ink cells is drawn as **one arc**:

- centre radius `r_k`, radial thickness **0.72 u**;
- the angular extent equals exactly the run's cell boundaries;
- **round caps placed inside** that extent, so the visual extent equals the cell interval;
- a run covering the whole ring is drawn as a full annulus;
- runs never mix format and data cells, so a run is split where a format cell meets a data cell.

An isolated ink cell therefore appears as a pill about 1 u long and 0.72 u thick. This gives the code its orbital texture of fragments.

### 8.2 Paint order
`decor` is painted first, with reduced tone pre-mixed into an opaque colour. Then seal, moons, polaris halo, format arcs, data arcs and genome glyphs. Decor can therefore never lighten machine-critical ink.

### 8.3 Colour and polarity
- **Ink and substrate:** any ink/substrate pair is allowed provided the luminance contrast is at least 30 % (see §10).
- **Inverted renditions** (light ink on dark leather, engraved metal) are valid. Decoders MUST try both polarities.
- **Reference styles:** classic `#0A0A0A` on `#FFFFFF`; inverted `#FFFFFF` on `#0A0A0A`; ivory `#111111` on `#F6F2EA`.

### 8.4 Output formats
The reference implementation produces SVG (vector, viewBox −25 −25 50 50), PDF (vector paths, no raster) and PNG (rasterised from the SVG). All three come from one primitive list, so they are geometrically identical.

### 8.5 Physical size
The physical size is the side of the 50 u square:

| Side | u |
|---|---|
| 20 mm | 0.40 mm |
| 15 mm | 0.30 mm |
| 10 mm | 0.20 mm |

The recommended minimum size depends on the reading device (§10).

## 9. Manufacturing tolerances (normative for machine-critical elements)

| Parameter | Tolerance |
|---|---|
| Position of any feature | ± 0.10 u |
| Arc thickness | 0.72 u ± 0.12 u |
| Seal and moon radii | ± 0.10 u |
| Ink spread / gain | ≤ 0.12 u (beyond this, adjacent rings start to merge) |
| Quiet zones | Seal quiet ring and 2 u outer margin: MUST be free of ink. Outer quiet band: MUST be free of ink except the decorative hairlines of §4.7, at their specified radii and tones. Texture contrast ≤ 15 % in all of them |

## 10. Measurable targets

These are the targets of the reference decoder. Measured values are published in `docs/reports/scan-matrix.md` and `docs/reports/print-size-matrix.md`.

| Property | Target |
|---|---|
| In-plane rotation | Any angle (0–360°) |
| Perspective | Out-of-plane tilt ≤ 40° on both axes (≥ 95 % success at 45°) |
| Resolution | ≥ 3.5 px per u for reliable decoding (≈ 175 px across the code) |
| Damage | Occlusion or glare up to 15 % of the data area; a 2 u-wide scratch across the code |
| Contrast | ≥ 30 % luminance difference (e.g. ink 110 / paper 220); both polarities |
| Blur and noise | Defocus σ ≤ 0.5 u; sensor noise σ ≤ 12/255; JPEG quality ≥ 60 |
| Substrates | Paper, ivory, textured paper, leather grain, brushed metal; moderate cylindrical curvature |
| Latency | Whole 1280 × 720 frame on a laptop, production decoder worker (Chromium): frames with a code median < 100 ms; code-free frames median < 200 ms and p95 < 400 ms. Recognition (camera start → decoded code) < 1 s on a modern phone |
| False positives | 0 on noise and clutter images |

**Latency target, qualified (2026-10-01).** Earlier versions of this table promised "< 100 ms per 1280 × 720 frame" without distinguishing frames. Frames with a code meet it (median 46–53 ms; p95 94–102 ms). Code-free frames — most frames before the code is in view — cannot stop at the first pass: a seal that is damaged, under glare or crossed by a scratch is only found by the later passes (finer binarisation window, column scans, the seal-less moon fallback, `decode.ts` steps 2 and 8), and stopping early on code-free frames would give up exactly those scans. They measure median 155–185 ms and p95 306–370 ms ([performance report](reports/performance.md) §2). That cost delays the next decode attempt, never the camera preview: the scanner keeps at most one frame in flight and sends only the square under the reticle (≤ 960 px, about a third of a 1280 × 720 frame on a phone viewport). `npm run bench` checks these budgets on the Chromium worker run (`genome/scripts/decoder-budget.ts`) and exits 1 when one is exceeded.

## 11. Reference decoding procedure (informative)

A conforming decoder can work in any way it likes. The reference decoder (`genome/src/core/decoder/`) proceeds as follows.

1. **Binarise:** luma image, then adaptive local-mean threshold through an integral image, trying both polarities.
2. **Find the seal:** scan rows and columns for the 1:1:4:1:1 run pattern, cross-check vertically and diagonally, and cluster the hits. Then cast rays to the seal orbit edges and fit ellipses (direct least squares). This gives the centre, the scale and an affine estimate.
3. **Find the moons:** search the annular band at r ≈ 24–31 u (affine-predicted) for compact dark blobs of the expected area, and choose four roughly 90° apart. Three are enough when one is occluded.
4. **Homography:** a normalised DLT maps code-plane coordinates to the image, using the seal centre and the moon centroids. Orientation is ambiguous to within 90° rotations, so each hypothesis is tried, ranked by the polaris hint.
5. **Refine:** sub-pixel adjustment of the anchor points to maximise cell bimodality. This absorbs centroid bias, lens distortion and mild curvature.
6. **Sample:** read all 1344 cells with a small footprint and region-adaptive thresholds. A confidence is kept per cell, and low-confidence or glare-saturated bytes become erasure candidates.
7. **Format and ECC:** decode the format word (BCH), unmask, then run Reed-Solomon. Errors-only comes first, then progressively more erasures on the least confident bytes (10, 20, … **at most 70**). If the format word is unreadable, all four masks are tried (0, 30 and 60 erasures).
8. **Validate:** check the CRC-16, then the strict payload structure.
9. **Genome cross-check (optional):** classify the 8 glyphs against vocabulary templates and report them with confidences.

The decoder never verifies signatures. Verification is the server's responsibility (see [CRYPTOGRAPHY](CRYPTOGRAPHY.md) §5).

**Miscorrection safety (normative for the reference scanner).** A miscorrected word that passes CRC-16 reaches the server as a well-formed code with a wrong signature, so a genuine artifact would be shown INVALID SIGNATURE. Two measures keep this vanishingly rare:

- *Erasure cap.* With *f* erasures only 85 − *f* parity bytes still check the word. Measured on 100 000 random words: at 80 erasures (5 checking bytes) Reed-Solomon returned a wrong codeword 18 times, leaving CRC-16 as the only backstop (≈ 3·10⁻⁹ per attempt, and a camera makes several attempts per second); at 70 (15 checking bytes), 0 times. The reference decoder never erases more than **70** bytes (`MAX_RS_ERASURES`, `genome/src/core/decoder/decode.ts`). The scan matrix shows no robustness loss ([scan-matrix](reports/scan-matrix.md)).
- *Second-frame confirmation.* When a read used heavy correction, **2·errors + erasures > 50**, the verify web app does not submit it until a second, independent camera frame decodes to identical data (`ReadConfirmer`, `genome/src/web/verify/capture.ts`); a photo upload is confirmed by a second resampling of the photo. A clean read pays nothing.

**Failure detail (informative).** A failed decode also reports what it saw, for scan guidance only: for NO_MOONS, the most code-like seal found (`seal.confidence`, the share of probed data orbits showing arc texture around it, and `seal.unitPx`); for FORMAT, ECC, CRC and PAYLOAD, the scale of the located code (`moduleSizePx`). The verify app turns these into distance-aware hints (place the whole code inside the orbit · hold steady · hold about 20 cm away · zoom in).

## 12. Versioning

| Item | Rule |
|---|---|
| Version 1 | **CODE-01** (`codeVersion = 1`) is the first version. |
| Where the version is carried | Both in the (unsigned) format word and in the signed payload. A decoder MUST reject a mismatch between the two. |
| Invariant across versions | The seal, the moons and the format cells (ring 0, cells 0–14 and 24–38). Every future version MUST keep them, so any decoder can find a code and read its version before interpreting the rest. |
| What a new version may change | Ring layout, data capacity, ECC parameters and payload. |
| Historical codes | They remain verifiable forever. Verifiers keep every published profile, and keys are looked up by the key id carried in the code. |
| Envelope invariant across versions | Every version's protected data is `payload ‖ signature (64 bytes) ‖ CRC-16/CCITT` over everything before it, with the code version in the high nibble of payload byte 0. A reader can therefore tell an intact code of an unknown version from a damaged one without knowing its layout. |
| Profile registry (reference implementation) | `CODE_PROFILES` (`genome/src/core/code-profiles.ts`) maps each supported version to its profile: geometry, data length, strict unframing and signing domain. The decoder reads the format word with the invariant format cells and decodes the data with the profile the word names, which also rejects a payload whose own version differs (the mismatch rule above); payload decoding dispatches on the high nibble of byte 0 (`unframeAnyCodeData`). The decoder's sampling tables are those of the CODE-01 geometry: a profile with another ring layout also needs them generalised. |
| Unsupported versions | A decoder that reads, with certainty, a format word naming a version it has no profile for reports it ("unsupported code version N") instead of brute-forcing its own versions' masks. The server answers an intact frame of a version 2–8 without a profile with **UNKNOWN** (reason `UNSUPPORTED_CODE_VERSION`) and a server warning, never `MALFORMED_CODE`: the reader is outdated, the code is not damaged. Nothing in such a frame is checked, so it can never reach an authentic state (THREAT-MODEL S). Versions 0 and 9–15, or a broken envelope, remain `MALFORMED_CODE`. |

## 13. Test vectors

`docs/vectors/code01-sample.json` is generated by `genome/scripts/spec-vectors.ts`. It contains:

- a public **sample** Ed25519 key (derived from a public string, so it is never a production key);
- the sample identity `O26-J-00184` (packed `0x341000B8`) and its genome `G1-E1DC-BE52`;
- the payload, signing message, signature, CRC, framed data, the 164-byte codeword, the chosen mask, the format word and the 1344 printed cells, ring by ring.

| Field | Value |
|---|---|
| payload | `1101341000b80102e94f524253` |
| signing message | `4f524245532d434f44452f7631001101341000b80102e94f524253` |
| public key | `d145b2794521745d32c404d83eb924e8245906254b8106ae4adf08d1eaeb01e5` |
| signature | `2a8b923c0f6578bba9f4ed8fbb031d80db06f6f5f3463e806c4247c4b9f5c90cc33f0dfd6a54c5991c232b0b4ef88761669e337f5ebfa1074a2e484fca05f70e` |
| CRC-16 | `e538` |
| mask / format word | `0` / `0x5412` (`101010000010010`) |

A conforming encoder MUST produce exactly the codeword and cells in the vector file for this input with mask 0. A conforming decoder MUST recover the framed data from a rendering of those cells.
