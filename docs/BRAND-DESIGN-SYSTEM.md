# ORBES — Authentication Design System

Status: v1.0, describes the implementation as built · Scope: the ORBES SEAL, the ORBES GENOME and the ORBES CODE as marks; the verification app (`/verify`); the GENOME console (`/admin`); print artifacts.
Related: [ORBES-CODE-SPEC](ORBES-CODE-SPEC.md) (normative geometry) · [ORBES-GENOME-SPEC](ORBES-GENOME-SPEC.md) (glyph vocabulary) · [scan matrix](reports/scan-matrix.md) · [print-size matrix](reports/print-size-matrix.md) · [ARCHITECTURE](ARCHITECTURE.md).

Every value in this document is read from the code. Where a rule is a brand recommendation rather than something the software enforces, it says so. Sources of truth:

| Layer | File |
|---|---|
| House style of theorbes.com (the reference) | `index.html` (root; never modified) |
| Web tokens and primitives | `genome/src/web/shared/brand.css`, `corners.ts`, `dom.ts`, `monogram.ts`, `fonts/gravesend-sans-500.woff2` (display face) |
| Brand monogram | `docs/assets/brand/orbes-monogram.svg` (the brand's master), `genome/src/core/render/monogram.ts` (its outlines, verbatim), `genome/scripts/favicons.ts` (tab icons) |
| Verification app | `genome/src/web/verify/**` (copy in `copy.ts`) |
| Console | `genome/src/web/admin/**` |
| Public result copy | `genome/src/server/services/copy.ts` |
| Code geometry and colourways | `genome/src/core/code/profile.ts`, `primitives.ts`, `encoder.ts` (`ORBES_CODE_STYLES`) |
| Genome glyphs and layouts | `genome/src/core/genome/vocabulary.ts`, `render.ts` |
| Print artifacts | `genome/src/server/render/` (`artifact.ts`, `scene.ts`, `print-sheet.ts`, `label-font.ts`, `certificate.ts`); `genome/src/core/render/sheet-layout.ts` (the print sheet's grid, page sizes, footer and cell size, shared with the console's layout preview) |

---

## Contents

1. [Brand principles](#1-brand-principles)
2. [The three marks](#2-the-three-marks)
3. [Interface foundations](#3-interface-foundations)
4. [Voice and copy](#4-voice-and-copy)
5. [The verification experience](#5-the-verification-experience)
6. [The GENOME console](#6-the-genome-console)
7. [Artifact specimens](#7-artifact-specimens)
8. [Deviations to resolve](#8-deviations-to-resolve)
9. [Reproducing the screenshots](#9-reproducing-the-screenshots)

---

## 1. Brand principles

### 1.1 Six qualities

Everything the customer sees, printed or on screen, should feel like the following. Each quality is carried by something concrete in the implementation, not by decoration.

| Quality | How it is built |
|---|---|
| **ARCHITECTURE** | The code is a constructed orbital system: a seal, an inner orbit of eight glyphs, thirteen concentric data orbits and four moons, all derived from one unit `u`. Screens are framed by four hairline corner brackets, as on theorbes.com. The console sits on a fixed grid (248 px sidebar, 56 px gutters, 1 px rules). |
| **PRECISION** | Geometry is defined to a tolerance (±0.10 u position, ±0.12 u arc thickness) and rendered deterministically (three decimals, filled outlines, no strokes). Type uses tabular numerals for every identifier, date and count. Rules are exactly 1 px. |
| **MATERIALITY** | One ink on one paper. Ivory `#F6F2EA` stands for card stock: the GENOME is shown as a specimen on an ivory plate. The verify screens carry the theorbes.com film grain. The code is specified for paper, card, leather and metal, with a physical A4 test kit. |
| **LUXURY** | Restraint: white space, wide-tracked uppercase micro-type, slow motion (0.7–1.4 s on one curve), one primary action per screen, few words. |
| **TECHNOLOGY** | Ed25519 signatures, Reed-Solomon RS(164,79), a decoder in a Web Worker. It is present and exact, and kept one tab deep: the PRODUCT tab lists `SIGNATURE · VALID · ORBES KEY 01` in plain words, nothing more. |
| **MYSTERY** | The code reads as an orbital diagram, not as data. The GENOME is unique to each piece and never explained on the surface. The polaris moon wears a halo. The meta line says PARIS. |

> **The technology disappears behind the ORBES experience.** The scanner shows a camera, an orbit and one status line. No decode statistics, no percentages, no risk scores (the public API never returns them), no cryptographic vocabulary on the result headline.

### 1.2 What it must never look like

| Never like | Avoided by |
|---|---|
| **A QR code** | No square modules and no three square finder patterns: the finder is the round SEAL, the anchors are four round moons. No "scan me" frame or arrow. Never placed beside a QR code. |
| **A barcode** | No bars, no rows of digits. The only human-readable text near a code is the optional print label (product id + ORBES), below the quiet zone. |
| **Crypto branding** | No gradients, no neon, no hexagons or chains, no "blockchain", "token" or "wallet" language. Hex values (fingerprints, hashes) appear only as small metadata or in the console. |
| **Cybersecurity software** | No shields, padlocks, green ticks, red crosses or warning triangles. States are marked by orbit figures (§3.5). The public app uses no colour at all; oxblood exists only inside the console. |
| **A government ID** | No guilloche, microprint fills, holograms, crests or "OFFICIAL" stamps. |
| **A banknote** | No rosettes, fine-line security patterns or serial-number typography. |
| **A cheap anti-counterfeit sticker** | No holographic foil, no "100 % GENUINE" seal, no VOID-pattern labels, no stars or rosettes. |

The chromatic (nacre) gradients and games of theorbes.com (`index.html`, `body.chromatic`) belong to the website's playful layer. They are never used on an authentication surface.

---

## 2. The three marks

### 2.1 Roles

| Mark | Role | Varies | Machine role | Where it lives |
|---|---|---|---|---|
| **ORBES SEAL** | Universal. Says "this is ORBES". | Never: identical on every product. | Finder pattern (rotation-invariant 1 : 1 : 4 : 1 : 1 run), centre and affine fit. Machine-critical. | Centre of every ORBES CODE; centre of the GENOME orbit layout; echoed by the result marks. |
| **ORBES GENOME** | Per product. Says "this is *this* piece". | Always: eight glyphs from GENOME-01, a public bijection of the product identity. Two products never share one. | Optional cross-check only; never machine-critical. | Inner orbit of the code; verification result; product page; certificates. |
| **ORBES CODE** | The carrier. Holds the identity, signed by ORBES. | Per code issue (data orbits). | Everything: finder, anchors, format, Reed-Solomon codeword. | Printed, foiled or engraved artifact. |

The three are never conflated. The GENOME is a public identity, not a secret; the CODE's signature, not its appearance, is what authenticates (ORBES-CODE-SPEC §1).

### 2.2 ORBES SEAL — construction

Unit `u` = nominal data-cell pitch (`CODE01` in `profile.ts`).

| Ring | Radius (u) | Ink |
|---|---|---|
| Core | 0 – 2.0 | solid |
| Gap | 2.0 – 3.0 | none |
| Orbit | 3.0 – 4.0 | solid |
| Quiet ring | 4.0 – 5.75 | none (isolates the finder) |

Along any line through the centre the pattern reads dark : light : dark : light : dark in widths **1 : 1 : 4 : 1 : 1**, in every direction. The SEAL is therefore 8 u across, with a 1.75 u quiet ring around it.

- **In the code:** always at the exact centre, at this size.
- **In the GENOME orbit layout:** the same core and orbit, centred (`render.ts`, `orbitLayout`).
- **On screen:** the AUTHENTIC result mark is a hairline echo of it, not the seal itself (§3.5). The tab icons drew a seal until 2026-10-02; they now draw the monogram (§3.9, [§8](#8-deviations-to-resolve) item 7).

### 2.3 ORBES GENOME — construction

Eight glyphs, each a 4-bit value from the frozen 16-glyph GENOME-01 vocabulary. Every glyph lives inside a circle of radius **R**.

| Property | Value |
|---|---|
| Stroke of every orbit | 0.26 R (18 % above the 0.22 R floor, for print and engraving spread) |
| Outer orbit centreline | 0.87 R (outer edge exactly on R) |
| Minimum stroke, dot or crescent | 0.22 R |
| Orientation | Absolute, relative to code north, never radial |
| Families | 4 symmetric forms (FULL ORBIT, RING POINT, SMALL ORBIT, POINT) + HALF ARC ×4, ARC PAIR ×4, QUARTER ORB ×4 |
| Colour | One ink. Never tinted per product: a GENOME differs by form, never by colour (ORBES-GENOME-SPEC §5.3). |

Two layouts, both drawn by the core renderer `renderGenomeSvg`:

| Layout | Geometry | Used in |
|---|---|---|
| **Row** | Glyph pitch 3.4 R; separator points r 0.13 R between glyphs; margin 0.7 R | Certificate card (§7); console genome list |
| **Orbit** | Glyph 0 at north, then clockwise every 45° on radius 7.5 u; glyph R = 1.75 u; separator points r 0.22 u at the half-steps; SEAL at the centre; margin 1.25 u | Verification result (the GENOME specimen); console product page and generator; the inner orbit of every code |

**On the verification page, the orbit** (since 2026-10-02). The GENOME is the one mark that belongs to a single piece; the result page draws it as it sits on the piece, around the SEAL, in the same order and orientation, so the customer compares screen and object at a glance instead of unrolling the orbit in their head. It is the same figure as the console's (`genomeBlock` calls `genomeRow(m, { layout: 'orbit' })`, `genome/src/web/verify/genome-view.ts`; the fingerprint cross-check and the spoken label are unchanged). No north marker is drawn: glyph 0 is at the top, where it sits when the code's polaris is at the top left. A polaris marker would come only as an option of `renderGenomeSvg`, after brand validation, and would not change the console figure.

Specimen of the vocabulary: [`assets/genome-01-vocabulary.svg`](assets/genome-01-vocabulary.svg) (§7).

### 2.4 ORBES CODE — construction

A 50 u × 50 u square (content half-width 23 u + a 2 u quiet zone). Full normative definition in [ORBES-CODE-SPEC](ORBES-CODE-SPEC.md) §3–§9.

| Element | Geometry | Layer |
|---|---|---|
| SEAL | §2.2 | `seal` |
| GENOME orbit | 8 glyphs, R 1.75 u, on r 7.5 u | `genome` |
| Data orbits | 13 rings, centre radii 10.5–22.5 u, pitch 1 u; inked runs drawn as **round-capped arcs 0.72 u thick**; 1 344 cells | `format`, `data` |
| Moons | 4 discs r 1.75 u on r 27.5 u at 315°, 45°, 135°, 225° | `moon` |
| Polaris halo | ring r 2.6 u, 0.4 u wide, around the NW moon | `polaris` |
| Horizon | ring r 24.0 u, 0.08 u, tone 0.35 | `decor` |
| Guides | rings r 9.5 u and 23.5 u, 0.06 u, tone 0.25 | `decor` |

Brand-relevant properties of the renderer:

- **Fragments, not modules.** An isolated cell is a pill about 1 u long and 0.72 u thick; consecutive cells merge into one arc. This is the code's orbital texture.
- **Whitening is aesthetic.** Of four masks, the encoder keeps the one with the lowest visual penalty: no ring run longer than 9 cells, every sector near 50 % ink, no stacked empty patches. No part of the artifact looks heavier than another.
- **Decor never lightens ink.** Decorative hairlines are painted first, with their tone pre-mixed into an opaque colour, so print workflows never see transparency.
- **One geometry, every format.** SVG, PDF and PNG are drawn from one primitive list, as filled outlines (no strokes). Layers are grouped as `<g data-layer="…">` so designers can isolate machine-critical ink.

### 2.5 Clear space

| Mark | Rule | Status |
|---|---|---|
| ORBES CODE | The **2 u quiet zone** is part of the 50 u artifact and MUST stay free of ink, with texture contrast ≤ 15 % (ORBES-CODE-SPEC §9). At 30 mm it is 1.2 mm. Never trim an artifact inside its square. | Normative |
| ORBES CODE | Beyond the artifact edge, keep a further 2 u (another 4 % of the side) free of graphics, text, seams and edges. The only element allowed next to it is the print label, which the renderer places in its own 7.5 u band below the quiet zone (`LABEL_LAYOUT`). | Recommendation |
| ORBES SEAL (standalone) | Clear space equal to its quiet ring: 1.75 u around a seal of radius 4 u, i.e. 0.44 × the seal's outer radius on every side. | Recommendation, derived from the code |
| ORBES GENOME (standalone) | At least the renderer's own margin: 0.7 R (row), 1.25 u (orbit). On screen the specimen sits on an ivory plate with 34 / 22 / 28 px padding. | Implemented |

### 2.6 Minimum sizes

The physical size of a code is the side of its 50 u square, quiet zone included. The evidence is simulated; neither report has yet been confirmed on real phones with the physical test kit ([`assets/test-sheets/`](assets/test-sheets/)). This system therefore takes the most conservative figure.

| Mark | Minimum | Evidence |
|---|---|---|
| **ORBES CODE, every substrate** | **30 mm** | [print-size matrix](reports/print-size-matrix.md), *Recommendation*: simulated minimum 25 mm at 1× across Android, iPhone and iPhone Pro (iPhone Pro main camera cannot focus closer than ≈ 20 cm); 30 mm adds one size step for print gain, wear and engraving tolerance. Also the console default (`ARTIFACT_DEFAULTS.widthMm = 30`). |
| ORBES CODE, light on dark (white on black, foil on dark leather) | 25 mm, only after a passed physical test-sheet run | print-size matrix: simulated minimum 20 mm, recommended 25 mm for white on black. |
| Absolute floor, whatever a test shows | 17.5 mm | [scan matrix](reports/scan-matrix.md): ≥ 95 % from 3.50 px/u under the low-light preset at ≈ 10 px/mm, "do not print below 17.5 mm … prefer 25 mm or more". |
| GENOME glyph, printed standalone | 2.1 mm glyph diameter | Its size inside a 30 mm code (3.5 u × 0.6 mm). No standalone print study exists. |
| GENOME glyph, on screen | 12 px glyph diameter | [Symbol study](reports/genome-symbol-study.md): 100 % template classification from 12 px (99.09 % at 8 px). The verify specimen draws the orbit as a centred square of `min(64vw, 260px)` (`.genome-svg--orbit`): a glyph is 3.5 u of 21 u, so ≈ 43 px from a 407 px screen, ≈ 42 px on a 390 px one and ≈ 34 px on a 320 px one (it was ≈ 21 px in the row layout). |
| ORBES SEAL, printed standalone | 4.8 mm diameter | Its size inside a 30 mm code (8 u). |

The renderer accepts 10–500 mm (`ARTIFACT_LIMITS`). That is a technical bound for memory and resolution, not a brand permission: the console warns under 30 mm and refuses under 15 mm unless the operator checks *Test print* (`artifactSizeAdvice`, `genome/src/web/admin/model/generator.ts`).

### 2.7 Colourways

Three presentations exist, defined once in `ORBES_CODE_STYLES` and shared by the encoder, the console preview and the print artifacts.

| Colourway (`ORBES_CODE_STYLES`) | Console theme / label | Ink | Paper | Horizon (tone 0.35) | Guides (tone 0.25) | Use |
|---|---|---|---|---|---|---|
| `classic` | `classic` · "CLASSIC — BLACK ON WHITE" | `#0A0A0A` | `#FFFFFF` | `#A9A9A9` | `#C2C2C2` | The reference rendition: paper, card, certificates |
| `inverted` | `inverted` · "INVERTED — WHITE ON BLACK" | `#FFFFFF` | `#0A0A0A` | `#606060` | `#474747` | Black card, dark leather, white or light foil |
| `ivory` | `ivory` · "IVORY — INK ON IVORY" | `#111111` | `#F6F2EA` | `#A6A39E` | `#BDBAB4` | Ivory stock, hang tags, leather swing tags |

Decor tones are the opaque pre-mixes the renderer writes (values from the sample SVGs). There are no other colourways: no brand colour, no per-collection or per-product tint, no metallic gradient. Physical substrates other than these three are reproduced by matching the *relationship* (dark on light, or light on dark), not by inventing a new palette.

### 2.8 Substrates and finishes

| Substrate | Process | Polarity | Decor hairlines | Minimum | Evidence and status |
|---|---|---|---|---|---|
| White paper, card, certificates | Offset or digital print | dark on light (`classic`) | on | 30 mm | Test sheet p. 2; scan matrix *paper* 100 % |
| Ivory card | Print | dark on light (`ivory`) | on | 30 mm | Test sheet p. 4 |
| Textured, cotton or laid paper | Print | dark on light | on | 30 mm | Test sheet p. 6; quiet zone texture must stay ≤ 15 % |
| Matte grey or recycled stock | Print | dark on light | on | 30 mm | Test sheet p. 5 (92 % grey) |
| Black card | White print or foil | light on dark (`inverted`) | on | 30 mm (25 mm after a physical run) | Test sheet p. 3; scan matrix *inverted* 100 % |
| Dark leather | Printed or **foiled** (light ink) | light on dark | on | 30 mm | Test sheet p. 7 (pebble grain, panel bent at R 150 mm); scan matrix *inverted, dark leather* 100 %. Prefer matte foil: specular foil adds glare. |
| Light leather | Printed or foiled (dark ink) | dark on light | on | 30 mm | Same rules as paper; not separately simulated |
| Leather, **blind emboss or deboss** | Relief without ink or foil | — | — | — | **Not a CODE rendition.** Relief alone gives no reliable luminance contrast, and the spec requires ≥ 30 % (ORBES-CODE-SPEC §10). Use blind relief for the SEAL or the GENOME as decoration only; for the CODE, fill the impression with foil or pigment. |
| Silver, steel, brass | **Laser engraving** (mark darker than the metal) | dark on light | **off** (spec §3 allows it; test sheet p. 8 omits it) | 30 mm | Test sheet p. 8. Weakest condition measured: the scan-matrix *metal* preset reads 55 %. Requires a passed physical run before production. Prefer a brushed or matte field around the code to mirror polish. |

Tolerances that every process must hold (ORBES-CODE-SPEC §9), converted to millimetres:

| Code size | 1 u | Quiet zone (2 u) | Arc (0.72 u) | Gap between rings (0.28 u) | Max ink spread (0.12 u) | Position (±0.10 u) |
|---|---|---|---|---|---|---|
| 30 mm | 0.60 mm | 1.20 mm | 0.43 mm | 0.17 mm | 0.072 mm | ±0.060 mm |
| 25 mm | 0.50 mm | 1.00 mm | 0.36 mm | 0.14 mm | 0.060 mm | ±0.050 mm |
| 20 mm | 0.40 mm | 0.80 mm | 0.29 mm | 0.11 mm | 0.048 mm | ±0.040 mm |
| 17.5 mm | 0.35 mm | 0.70 mm | 0.25 mm | 0.10 mm | 0.042 mm | ±0.035 mm |

Beyond 0.12 u of spread, adjacent rings start to merge. Foil, deboss fill and engraving burr are the usual offenders; test them at the intended size.

**Black ink at the print shop.** The PDF artifacts are RGB by default. A print shop that converts them to CMYK may build the black from four inks (rich black), and four plates out of register blur thin rings at small sizes. For such shops, download the PDF with **K-only black** (console option, API `kOnly=true`, `classic` and `inverted` only): ink is K 100 %, white is no ink, the decor tones are K tints. Limitations: no ICC profile or output intent (ask the shop not to convert), K 100 % alone is a dense dark grey rather than a deep black on uncoated stock, and the decor tints print as halftone screens (decorative, never read by the decoder) ([API §15.2](API.md#152-get-apiadmincodescodeidartifactformat)).

### 2.9 Polarity rules

1. **One artifact, one polarity.** Every machine-critical element is drawn in the same ink. In an inverted rendition the light colour *is* the ink (ORBES-CODE-SPEC §7).
2. **Both polarities read.** The camera scanner tries normal and inverted polarity on every frame (`tryInverted: true`); the photo path also accepts mirror images.
3. **Contrast.** At least 30 % luminance difference between ink and substrate (spec §10, e.g. ink 110 on paper 220 out of 255). The reference pairs are far above it: classic ≈ 96 %, ivory ≈ 88 % (luma).
4. **Never mirrored.** The camera does not read a mirrored code (`tryMirrored: false`). Stamping dies and foil blocks are cut mirrored so that the *impression* reads correctly.

### 2.10 Don'ts

| Don't | Why |
|---|---|
| Stretch, squash or skew any mark | The code is circular geometry measured in `u`; the seal's 1:1:4:1:1 run is the finder. |
| Recolour per product, collection or season | The GENOME differs by form, never by colour. Three colourways, no others. |
| Add gradients, sheen, metallic fills, shadows, glows, bevels or emboss filters on screen | One ink, one paper (`brand.css`: "No gradients, no shadows"). |
| Crop, cover or move the moons | They are the homography anchors: machine-critical. |
| Crop, cover or restyle the seal | It is the finder. |
| Place the code on busy texture, print or a seam | The quiet zone allows ≤ 15 % texture contrast. |
| Put a QR code (or any other code) next to it | The ORBES CODE is the only carrier; a QR beside it reads as a sticker. |
| Rotate individual glyphs | Orientation *is* the value: HALF ARC N and HALF ARC E are different nibbles. A rotated glyph changes the printed GENOME; when at least 6 glyphs are read with confidence and 2 or more disagree with the signed identity, the verification answers UNUSUAL ACTIVITY (`GENOME_MISMATCH`). |
| Redraw, retouch or re-typeset glyphs or codes | GENOME-01 is frozen. Always export from the console (SVG or PDF, vector), never trace a screenshot. |
| Add text inside the artifact square | Only the print label, below the quiet zone. |
| Mirror the artifact | See §2.9. |
| Print the claim code on the product | The console says it: "Place it inside the packaging, never on the product." It goes on the certificate card, under the scratch-off panel (§7). |
| Print below the minimum sizes of §2.6 | Real phones lose resolution to processing the simulator does not model. |

---

## 3. Interface foundations

The three web apps (`/verify`, `/admin`, `/legal`) import `shared/brand.css`, which mirrors the house style of theorbes.com: white and black, Helvetica Neue, uppercase micro-type with wide tracking, 1 px rules, hairline corner brackets, film grain and slow `cubic-bezier(0.22, 1, 0.36, 1)` motion. One addition: the brand's display face, Gravesend Sans, sets the wordmark, titles and labels (§3.1). All CSS is in external files (CSP `style-src 'self'`); scripts only toggle classes or set custom properties through the CSSOM.

### 3.1 Typography

**Two faces**, both tokens of `brand.css`:

| Token | Stack | Sets |
|---|---|---|
| `--font-display` | `"Gravesend Sans", var(--font)` | The brand's voice: the wordmark, titles and tracked-capital labels (navigation, tabs, eyebrows, section, row and column labels, field labels, buttons and text links, status lines such as SCANNING…) |
| `--font` | `"Helvetica Neue", HelveticaNeue, Helvetica, Arial, sans-serif`, the exact stack of `index.html` | Everything read: sentences, values, identifiers, codes, dates, counts, the customer reference, inputs. The page default (`body`). |

The display face is opted into role by role: `brand.css` sets the shared `.wordmark`, `.btn`, `.textlink` and `.field__label`, and each app lists its own titles and labels in one rule at the end of its stylesheet. No stylesheet names a font except through these tokens and the console's `--mono` (checked by `genome/test/web/verify.brand.test.ts`).

**Gravesend Sans Medium** (Rian Hughes / Device, 2019; the one cut the brand supplied, licence in [NOTICE.md](../NOTICE.md)) ships as `genome/src/web/shared/fonts/gravesend-sans-500.woff2`: 12.6 KB (12 624 bytes), subset with fontTools to Basic Latin (U+0020–007E), the accented capitals of Latin-1 (U+00C0–00DD: À Â Æ Ç É È Ê Ë Î Ï Ô Ù Û Ü…, with × at U+00D7), Œ œ Ÿ, the French quotation marks « » and the brand's punctuation `© · × – — ‘ ’ “ ” • … ← → −`, kerning kept, its other OpenType features dropped, its copyright and designer names kept. The `@font-face` of `brand.css` declares weight 500, `font-display: swap` (the fallback paints at once, never invisible text) and a `unicode-range` equal to the subset, so any other character falls back to `--font`; the test checks that range against the file's own character map and weight class. The build emits the file to `/assets/` with a content hash, cached as immutable like the bundles, from the page origin that the CSP already allows (`default-src 'self'`). Every shell preloads it, `/verify`, `/admin` and the legal pages' (`<link rel="preload" as="font" type="font/woff2" crossorigin>`), and `genome/scripts/build-web.ts` rewrites that preload to the very file the stylesheet loads, so a visitor downloads it once for every app (`test/web/verify.build.test.ts`; the E2E suites count the requests). To rebuild the subset from the supplied OTF:

```sh
pyftsubset GravesendSans-Medium.otf --flavor=woff2 --desubroutinize --layout-features=kern --name-IDs='*' \
  --unicodes="U+0020-007E,U+00A9,U+00AB,U+00B7,U+00BB,U+00C0-00DD,U+0152-0153,U+0178,U+2013-2014,U+2018-2019,U+201C-201D,U+2022,U+2026,U+2190,U+2192,U+2212" \
  --output-file=genome/src/web/shared/fonts/gravesend-sans-500.woff2
```

**Figures read in `--font`.** Gravesend's figure one is drawn as its capital I, its zero is an oval beside a round O, and it has no tabular figures. Every line that can carry an identifier, a code, a count or a date is therefore set in `--font`, even beside display labels: the console crumb, panel notes, dialog eyebrows (a product id, a key id, an anomaly's product) and dialog titles, the phrase a confirmation asks to type (`REVOKE O26-J-00184`, a `--font` span inside its display label), the window of Analytics (LAST `90` DAYS, the same span), numbered enrolment steps, a page titled with a product id (`pageHeader({ identifier: true })`, `.page-head__title--id`), the scanner's zoom control (1×, 2×). A field label carries no figure: a range or an example goes in its hint (*Months to add*, hint *From 1 to 120.*). A fixed label whose figures cannot be misread keeps the display face (VERIFICATIONS · 24 H, PAYLOAD SHA-256). The E2E suites check that no visible display text of the verify result, the console dashboard, the Analytics view, a product page or a product dialog (the warranty form, the typed revocation) holds a one or a zero.

**French in the display face.** The display roles are set in capitals (`text-transform: uppercase`), so a French title needs Gravesend's accented capitals: the subset carries those of Latin-1 with Œ and Ÿ, taken from the supplied OTF (fontTools lists every one of them in its character map), and the French quotation marks. The legal pages (J-06), the one French screen of this system, therefore set their French titles, section headings and text links in the display face like the English ones (CONFIDENTIALITÉ, FRANÇAIS on either page), as the owner's choice for titles, labels and the wordmark (D-04) says; no rule sends a language back to `--font` (`genome/test/web/legal.brand.test.ts`), and the E2E suite checks that every letter of the French display text is drawn by Gravesend itself. Their figures stay in `--font` (above), as everywhere. The narrow no-break space of French punctuation is not in the face: being blank, it falls back unseen. Until 2026-10-03 the subset held Basic Latin only and the French titles read in `--font`.

**Rendering.** Display text renders in Gravesend Sans on every platform, Android and Windows included. Reading text renders in Helvetica Neue on Apple devices (Helvetica Neue Light for weight 300); elsewhere it falls back to Helvetica or Arial, and on most Android devices to the platform sans-serif (Roboto), where weight 300 renders as 400. The screenshots in this document were taken on 2026-10-03 in Chrome for Testing on macOS, so reading text is Helvetica Neue. One predates the display face: the locked scanner (`verify-03-locked.png`), kept from an earlier capture in Chromium on Linux because Chrome for Testing on macOS paints the frozen camera frame black; on Linux the reading stack resolves to Liberation Sans, metric-compatible with Helvetica and Arial.

**Floors.** Nothing that is acted on, and no fact the visitor has to read, is set under 10 px (`--fs-micro`) in the verification app: buttons, text links, scanner controls, sign-in options, tabs, field labels, the GENOME fingerprint line and the ownership lines. 8 px (`--fs-nano`) and the 7–9 px component sizes are left to decoration and to labels nobody taps (landing foot, GENOME label, section and row labels). Every tap zone is at least 44 × 44 px (§3.8).

**Case and tracking.** Titles, labels, buttons, tabs and metadata are uppercase with wide tracking. Explanatory sentences are sentence case, never tracked beyond 0.06 em. Tracked type carries trailing letter-spacing after its last glyph, so centred tracked text is compensated with an equal `text-indent` (`.indent-micro`, `.indent-label`, and per-component indents), as theorbes.com does.

**Weights.** Gravesend has one weight, Medium (500), and the display face renders every display role in it, whatever weight the role asks for: the result title and the console page title ask for 300, which only their fallback honours. In `--font`: 400 everywhere; 300 for display numerals (KPI values, the product id of the console sheet, the generator identity, a page titled with a product id); 700 only in the console, all in `--font`: alert and critical status labels, the lifecycle move in the history timeline, the Anomalies count (`.side__badge`), the Analytics readout's day count (`.trend__tip-total`), and the done or failed steps of the anomaly decision dialog's report (`.steps__item`: the state of a done step, the label and state of a failed one). No display role asks for a bold the browser would have to fake from the single cut (checked).

**Numerals.** `font-variant-numeric: tabular-nums` for identifiers, dates and values. Counts use a thin space (U+2009) as thousands separator: `12 480`.

**Tokens** (`brand.css`):

| Token | Value | Token | Value |
|---|---|---|---|
| `--fs-nano` | 8px | `--track-micro` | 0.22em |
| `--fs-micro` | 10px | `--track-label` | 0.28em |
| `--fs-label` | 11px | `--track-display` | 0.32em |
| `--fs-line` | 12px | `--track-wordmark` | 0.62em |
| `--fs-body` | 13px | | |
| `--fs-lead` | 15px | | |
| `--fs-title` | 24px | | |
| `--fs-wordmark` | 30px | | |

Component sizes between those steps are tokens too, so no stylesheet sets a literal pixel font size, `brand.css` itself included, nor a literal size or tracking a token already names (checked by `genome/test/web/*.brand.test.ts`, `brand.css` with the stylesheets of the verification app, the console and the legal pages; the fluid landing wordmark `clamp(…)` is the only expression):

| Token | Value | Used for |
|---|---|---|
| `--fs-hint` | 7px | landing meta (theorbes.com's micro meta) |
| `--fs-overline` | 8.5px | section labels |
| `--fs-caption` | 9px | AUTHENTICATION, row labels, the dots between tabs |
| `--fs-mono-sm` / `--fs-mono` / `--fs-mono-lg` | 10.5 / 11.5 / 12.5px | monospace identifiers (optically one step below the sans they sit beside) |
| `--fs-sub` | 14px | console plain values, toast close |
| `--fs-input` | 16px | a field a phone focuses (iOS Safari zooms into one under 16 px): the verification app's fields, the sale shell's fields and the console's sign-in at phone width |
| `--fs-heading` / `--fs-heading-lg` | 17 / 18px | GENOME id, dialog title / caution and void result titles, TOTP code |
| `--fs-code` | 19px | transfer code |
| `--fs-display-sm` / `--fs-display` | 22 / 26px | console product id / generator identity |
| `--fs-figure` | 46px | KPI value |

*Face* is `--font-display` (display) or `--font` (reading). *Weight* is the weight a role asks for; display roles render in Gravesend's single Medium (500), and only their fallback honours 300.

**Verification app — type in use**

| Role | Face | Size | Weight | Tracking | Notes |
|---|---|---|---|---|---|
| Wordmark, landing | display | clamp(26px, 7.6vw, 34px) | 400 | 0.62em | indent 0.62em |
| Wordmark, small (result) | display | 12px | 400 | 0.55em | 11px in the scanner header |
| AUTHENTICATION | display | 9px | 400 | 0.40em | `--ink-soft` |
| Result title | display | 24px | 300 | 0.30em | line-height 1.3; **18px** / 1.55 for caution and void states |
| Result sub-title | display | 10px | 400 | 0.30em | `--ink-soft`, e.g. FIRST REGISTRATION |
| Message title (problems) | display | 15px | 400 | 0.30em | line-height 1.7 |
| Prose | reading | 13px | 400 | 0.02em | line-height 1.75, `--ink-soft`, balanced wrapping, ≤ 31–32 ch |
| Owner notice | reading | 12px | 400 | 0.02em | between two `--hairline-strong` rules |
| GENOME label | display | 8px | 400 | 0.36em | `--ink-soft` |
| GENOME id | reading | 17px | 400 | 0.22em | tabular |
| GENOME fingerprint line | reading | 10px | 400 | 0.22em | `--ink-soft`, e.g. G1-E1DC-BE52 · GENOME-01 |
| Product lines | reading | 11px | 400 | 0.30em | line-height 2.55 |
| Tabs | display | 10px | 400 | 0.16em | selected `--ink`, others `--ink-soft`; 0.12em under 350 px, so the four tabs keep the width they had at 9px |
| Row label / value | display / reading | 9px / 11px | 400 | 0.28em / 0.14em | value right-aligned, tabular |
| Section label | display | 8.5px | 400 | 0.34em | e.g. VERIFICATION |
| Status line (scanner, verifying) | display | 10px | 400 | 0.34em | |
| Scan hint | reading | 11px | 400 | 0.06em | sentence case, `rgba(255,255,255,0.74)` |
| Button | display | 10px | 400 | 0.28em | |
| Text link, scanner controls, sign-in options, field labels | display (zoom control: reading) | 10px | 400 | 0.22em | the gap between letters stays about what it was (2.2 px; 2.4 px at 8px and 0.30em, 2.2 px at 8.5px and 0.26em); text links at 80 % ink at rest |
| Ownership lines | reading | 10px | 400 | 0.22em | `--ink-soft`: REGISTRATION OPEN UNTIL, RECEIVING OPEN UNTIL, the transfer code's label and validity, SIGNED IN AS |
| Field input | reading | 16px | 400 | 0.04em | 16px so iOS does not zoom; code input 18px / 0.28em |
| Transfer code | reading | 19px | 400 | 0.26em | tabular, on ivory |
| Footnote | reading | 10px | 400 | 0.02em | line-height 1.75 |
| Result meta (VERIFIED · REF) | reading | 10px | 400 | 0.22em | `--ink-soft`, tabular: the reference customers quote |
| Landing meta | display | 7px | 400 | 0.32em | opacity 0.4, as theorbes.com's 6.5px meta at 0.28 |
| Legal links (landing foot, under a result) | display | 10px | 400 | 0.22em | the text link as it is; HELP widened to 44 px; a 9 px `--ink-soft` dot between the four pages |

**Legal pages — type in use** (J-06, `/legal`; French titles and links in the display face too, above)

| Role | Face | Size | Weight | Tracking | Notes |
|---|---|---|---|---|---|
| Wordmark | display | 12px | 400 | 0.55em | `.wordmark--small`, not a link |
| Navigation, language, index, foot links | display | 10px | 400 | 0.22em | text links; the current page and language at full ink, underlined |
| Page title | display | 18px | 400 | 0.28em | centred, balanced |
| Version line | reading | 10px | 400 | 0.22em | `--ink-soft`, e.g. VERSION OF 3 OCTOBER 2026 |
| Section heading | display | 11px | 400 | 0.28em | its figures (ARTICLE 8) in `--font`, `.legal__figure` |
| Text, lists | reading | 14px | 400 | 0.01em | line-height 1.75, `--ink-soft`; a clause's lead set apart in `--ink`, never bold; links in a sentence underlined in `--ink` |
| Contact of ORBES Client Services | reading | 14px | 400 | 0.02em | its email and phone as links, 44 px zones; hours 10px |

**Console — type in use**

| Role | Face | Size | Weight | Tracking |
|---|---|---|---|---|
| Sidebar wordmark | display | 15px | 400 | 0.62em (the shared `.wordmark`, `--track-wordmark`) |
| Page title | display (reading when it is a product id) | 30px | 300 | 0.20em |
| Product id (fact sheet) / generator identity | reading | 22px / 26px | 300 | 0.22em / 0.20em |
| KPI value | reading | 46px | 300 | 0.04em, tabular |
| Dialog title | reading | 17px | 400 | 0.18em |
| Claim code | reading | 30px | 400 | 0.24em |
| Panel title | display | 11px | 400 | 0.30em |
| Navigation link | display | 10px | 400 | 0.24em |
| Generator modes (SINGLE PIECE · BATCH), Analytics windows (LAST 30 DAYS · LAST 90 DAYS) | display (the window's figures: reading) | 10px | 400 | 0.24em; the current one in ink, underlined; a 3 px `--metal` disc between |
| Analytics axis labels, cursor readout | reading | 10px (count 12px bold) | 400 | 0.06–0.12em, tabular, `--ink-soft` (count in ink) |
| Status mark text | reading | 10px | 400 (700 for alert, critical) | 0.20em (0.18em bold) |
| Anomalies count (sidebar badge) | reading | 8px | 700 | 0.06em, tabular, white on ink (§3.5) |
| Decision report steps (anomaly dialog) | reading | 10px | 400 (700: a done step's state, a failed step's label and state, oxblood when failed) | 0.06em; the state in capitals at 0.20em |
| Body, table cells, definition values | reading | 12–13px | 400 | 0.03–0.06em |
| Eyebrows, column heads, field labels, buttons, crumb | display (crumb: reading) | 8px | 400 | 0.30–0.36em |
| Identifiers and hashes | monospace | 11.5px monospace | 400 | 0.02em |

Monospace (`ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`) is reserved for identifiers and hashes, and appears only in the console.

### 3.2 Colour

| Token | Value | Role | Contrast on white / ivory |
|---|---|---|---|
| `--white` / `--paper` | `#FFFFFF` | Page | — |
| `--ivory` | `#F6F2EA` | Specimen plates and figures, console sidebar, panels that hold a secret or a fresh result (claim code, transfer code, enrolment, a staff account's temporary password, generator identity) | — |
| `--ink` | `#0A0A0A` | Text, rules that structure, buttons | 19.8 : 1 / 17.7 : 1 |
| `--ink-soft` | `#5C5C5C` | Secondary text | 6.7 : 1 / 6.0 : 1 (AA) |
| `--metal` | `#9A9A9A` | Decorative only: separators, muted bar fills and status marks; never text (zero rows, placeholders and navigation titles use `--ink-soft`) | 2.8 : 1 / 2.5 : 1 (not for text that must be read) |
| `--hairline` | `rgba(10,10,10,0.12)` | Default 1 px rule (≈ `#E2E2E2` on white) | — |
| `--hairline-strong` | `rgba(10,10,10,0.32)` | Section rules, field underlines, local brackets on ivory | — |
| `--critical` (console only) | `#8A1C1C` oxblood | The few facts that require immediate action | 9.3 : 1 |
| `--veil` (console only) | `rgba(246,242,234,0.86)` | Dialog backdrop | — |
| Scanner ground | `--ink` `#0A0A0A` | Camera view background | — |
| Scanner veil | `rgba(10,10,10,0.5)` → `0.78` when locked | Flat veil outside the orbit | — |

**The vault** (the LIVE RELEASE's look, §5, THE LIVE RELEASE): ivory on the ink ground, under an overhead light. Its tokens (`brand.css`) are turned into the house's under `.vault` (`--ink` becomes `--vault-ink`, `--ink-soft` `--vault-soft`, `--paper` the ground, `--ivory` the plate…), so every primitive (buttons, text links, fields, brackets, rows) takes the vault's look without a rule of its own:

| Token | Value | Role | Contrast on the ground / the plate |
|---|---|---|---|
| `--vault-ground` | `#0A0A0A` | The vault's page | — |
| `--vault-ink` | `#F6F2EA` | Text, rules that structure, the filled primary action (ink text on it) | 17.7 : 1 / — |
| `--vault-soft` | `#A7A29A` | Secondary text | 7.8 : 1 / 7.3 : 1 (AA) |
| `--vault-faint` | `#6F6A63` | Decoration only (3.7 : 1): never text | — |
| `--vault-plate` | `#141312` | The plates that hold the piece, the seal and the door | — |
| `--vault-hairline` / `--vault-hairline-strong` | `rgba(246,242,234,0.14)` / `0.34` | Rules, seams, field underlines | — |
| `--vault-light` | a radial highlight at the top (`radial-gradient(120% 55% at 50% 0%, …0.1 → 0)`) | The overhead light of the page | — |
| `--vault-glow` | `drop-shadow(0 0 22px rgba(246,242,234,0.28))` | The faint ivory glow of the seal and the piece | — |

The text's contrast on every vault screen is computed from `brand.css` and measured on the pages (`test/web/verify.live.test.ts`, `test/support/vault-checks.ts`): at least 4.5 : 1. CONFIRMED leaves the vault for the house's ivory (choice 22), and the banner stays in the house's ink.

theorbes.com itself uses pure `#FFFFFF` and `#000000`; the authentication apps soften the ink to `#0A0A0A` (see §8, item 2). The public verification app uses no colour: every state, including the gravest, is told in ink. `theme-color` is `#ffffff` for `/verify` and `#f6f2ea` for `/admin`. `::selection` inverts to white on ink.

### 3.3 Grid and spacing

There is no spacing scale token: spacing is set per component in pixels, on generous, recurring values.

**Verification app (mobile first).**

| Element | Value |
|---|---|
| Landing | content centred; padding 88 px top and bottom (+ safe areas), 32 px sides; monogram → wordmark 24 px · wordmark → AUTHENTICATION 18 px |
| Resting orbit | `min(76vw, 40vh, 320px)`, drawn 15 % beyond the emblem box |
| Live reticle | aperture `min(66vw, 40vh, 340px)`; reticle drawn at 1.3× |
| Result column | max 560 px, centred; padding 60 / 32 / 64 px (+ safe areas); 22 px sides under 350 px |
| Result rhythm | wordmark → mark 52 px · mark → title 26 px · title → message 22 px · GENOME plate 52 px above · product lines 46 px · tabs 50 px · foot 60 px |
| Rows | 14 / 13 px vertical padding, 1 px `--hairline` between rows |
| Primary button | 52 px high, at least 248 px wide, 28 px side padding (full width under 350 px) |

**Console (desktop).**

| Element | Value |
|---|---|
| Sidebar | 248 px, ivory, 1 px hairline on its right |
| Top bar | 52 px, sticky |
| Gutter | 56 px (32 px under 1 180 px) |
| Content | max 1 480 px |
| Page head | 30 px below its text, closed by a **1 px ink rule**, 36 px to content |
| Panels | 48 px apart; 11 px title over a `--hairline-strong` rule |
| Grids | dashboard 7 : 5, split 5 : 7, result 1 : 1, generator 8 : 4, product hero 5 : 7 (64 px gap); 40–56 px column gaps |
| Table rows | 44 px |
| Breakpoints | 1 180 px (single column), 860 px (sidebar on top) |

### 3.4 Hairlines and corner brackets

- **Rules** are 1 px, solid: `--hairline` between rows, `--hairline-strong` under section heads and fields, `--ink` only to close a console page head. The short centred rule (`.rule--short`) is 28 px, the length of theorbes.com's reveal rules.
- **Viewport brackets** (`viewportCorners()`): four 14 × 14 px corners of 1 px lines, 26 px from the top and bottom and 30 px from the sides (plus safe-area insets), exactly as `index.html`. They fade in over 0.7 s after 0.6 s, follow `currentColor` (ink on paper, white over the camera) and are `aria-hidden`.
- **Local brackets** (`bracket(node)`): four 10 px corners framing one block; 12 px on console figures. On the ivory GENOME plate they are inset 10 px and drawn in `--hairline-strong`. They frame specimens and secrets: the GENOME, the code preview, the generator identity, the claim code, the console sign-in card.
- **Hairlines in the code** are the decor rings of §2.4: the visual cousins of the interface rules, never sampled by the decoder.

### 3.5 Iconography

There are no icons in the pictographic sense. Every mark is built from the orbit. The brand's emblem, the monogram, is not an icon: it has its own rules (§3.9).

| Mark | Construction | Meaning |
|---|---|---|
| **Authentic** | 44 px; ring r 18 (viewBox ±24, 1 px non-scaling stroke) + core disc r 6.5 | The full seal, echoed: AUTHENTIC (all four variants) |
| **Caution** | Same ring + one moon r 2.6 on the orbit at north | UNUSUAL ACTIVITY DETECTED, UNREADABLE CODE |
| **Void** | The empty ring | REVOKED, UNKNOWN ORBES CODE, INVALID SIGNATURE, and every problem screen |
| **Orbit reticle** | Ring r 100 (1 px), a 28° arc travelling the ring (1.6 px, round caps), four moons r 2.6 at (±88, ±88), the polaris (NW) with a halo r 6.5 | Resting on the landing (ring 16 %, moons 26 %, arc 50 % opacity, one turn per 48 s); live in the scanner (one turn per 3.6 s), where it searches, tightens around the centre on a seal seen and locks on the code (P-D10, §3.6); and **VERIFYING…, READING PHOTO…** (P-D10): the same reticle at the scanner's size (aperture `min(66vw, 40vh, 340px)`, reticle at 1.3×), centred, its ring at 2 px and 30 % opacity, its moons ×1.35 (the weight the lock leaves them), the 28° arc at 2.4 px making one turn per 2.4 s, the status 20 px under the moons. It replaces the former loader (a ring r 44 at 22 %, a core and one moon orbiting) |
| **Console status marks** | 7 px square before an uppercase value: **solid** (filled: in force), **outline** (hollow: pending), **muted** (`--metal`: historical), **alert** (rotated 45° to a diamond, bold label: needs attention), **critical** (oxblood diamond, bold oxblood label: act now) | Every lifecycle, code, key, warranty, ownership, severity and verification value (`model/tone.ts`) |
| **Console loading** | 22 px hairline ring with a 5 px moon, one turn per 1.6 s | LOADING |
| **Empty state** | 9 px `--metal` circle | "Nothing to show." |
| **History timeline** | 7 px circles on a 1 px line; the latest filled | Status history |
| **Scans timeline** | The same line, oldest first; every circle hollow but the scan that raised the finding, filled | An anomaly's scans in its window (console, `.timeline--scans`) |
| **Console count** | An inverted count, white figures in Helvetica Neue bold (`--fs-nano`, tabular) on an ink ground, beside the link's word; `99+` beyond 99, absent at 0. The tab title repeats it as `(3) Dashboard — ORBES Genome Console` | OPEN HIGH and CRITICAL findings on ANOMALIES (`.side__badge`) |
| **Separators** | `·` in `--metal` | Between tabs and options |
| **Favicons** | Both the monogram (§3.9) in ink `#0A0A0A`, its ink box 26 of 32 units wide and centred, written by `genome/scripts/favicons.ts`. `/verify`: on a white disc (r 15), legible on a dark tab bar. `/admin`: on an ivory square with four corner moons (r 2), so the console's tab is told apart from the public app's | Browser tabs |

### 3.6 Motion

One curve, three durations (`brand.css`):

| Token | Value |
|---|---|
| `--ease` | `cubic-bezier(0.22, 1, 0.36, 1)` (the curve of theorbes.com) |
| `--t-fast` | 0.35s (console hovers, inputs, checkboxes) |
| `--t-med` | 0.7s (buttons, links, tabs, panels, corners) |
| `--t-slow` | 1.4s (rises, veil, moons, bars) |

| Movement | Implementation |
|---|---|
| Screen enters | `view-in`: fade and rise 10 px, 1.1 s, `--ease` |
| Screen leaves | opacity to 0 in 0.28 s (`LEAVE_MS = 280`) |
| Landing | orbit fades in over 2.4 s after 0.4 s; the monogram and the wordmark rise together over 1.8 s after 0.15 s; actions over 1.6 s after 0.6 s; meta fades over 1 s after 1.2 s |
| Scanner | view fades in 0.6 s; video fades in 1.2 s; the arc turns linearly every 3.6 s |
| Code found | the video freezes; the veil deepens 50 % → 78 % (1.4 s); the ring goes to full opacity and 2 px; the moons scale to 1.35 (1.4 s); a 12 ms vibration; ORBES CODE FOUND holds 420 ms (`LOCK_PAUSE_MS`) |
| Seal seen (P-D10) | a decoder reply carried a confident seal (`onSeal`, at most 4 per second, from a confidence of 0.5): `.is-sealed`, the ring scaled about the orbit's centre (the replies give no position for the seal) from 0.95 (confidence 0.5) to 0.88 (certain), over 0.45 s; its stroke breathes 1 → 1.8 px and its opacity 0.7 → 1 over 0.8 s, alternate; the sweep hides. Held 900 ms after the last seal (`SEAL_HOLD_MS`), then back to the search. **Locked** (Code found, above, the existing `.is-locked`) replaces it |
| Verifying | the reticle's arc turns once per 2.4 s (P-D10: VERIFYING… draws the scanner's ring, §3.5); no transition is played between the screens; the screen stays at least 650 ms (`MIN_VERIFYING_MS`) so a fast answer never flickers |
| Result | blocks rise 8 px over 1.4 s, staggered 0.05 / 0.30 / 0.45 / 0.60 / 0.75 s; the GENOME plate **opens from its centre** (P-D10, `genome-open`: `clip-path: circle(0% → 75% at 50% 50%)` with its opacity, over 1.4 s, keeping its section's delay; not while the screen leaves) |
| The ceremony (P-D01) | after a first registration, VIEW AS OWNER: the eight glyphs of the GENOME appear one by one, each from 0.9 s + i × 0.16 s, over 0.7 s, opacity and scale 0.55 → 1 (`ceremony-glyph`, each `data-layer=genome` group, its `--i` set through the CSSOM); the model's name rises at 2.3 s, its collection at 2.5 s, SHARE THE GENOME at 2.8 s (`brand-rise`, 1.2 s); a vibration of `[18, 90, 18]` ms as the names rise, where the device has one |
| Tabs | colour 0.7 s; the 1 px underline draws with `scaleX` over 0.7 s; panels fade 0.7 s |
| Text links | the 1 px underline draws from the left over 0.7 s |
| Buttons | fill with ink over 0.7 s (verify) or 0.35 s (console) |
| Console | views fade 0.7 s; bars grow over 1.4 s; the active nav rule draws to 40 px over 0.7 s; toasts rise 0.7 s, confirmations leave after 4.2 s |
| The vault: the lock | In the last minute before T0 (`LOCK_MS`), each data orbit of the seal turns back one step a second from its scrambled angle (alternate orbits in opposite directions), settling with a slight click (0.5 s, a small overshoot); aligned at T0, the lock pulses once (0.36 s) |
| The vault: the door | Two leaves, each a hairline panel, meet under the lock; at T0 they part (1.2 s, `--ease`) for every phone at the same server second, the lock fading (0.6 s), the inside fading in (0.9 s, after 0.35 s) |
| The vault: the light sweep | A band of ivory light crosses the piece once, masked to its shape (`mask-image`), 1.7 s after the door's 0.7 s |
| The vault: the hold | The outer ring counts the turn down; held, the inner ring fills in 1.5 s (`HOLD_MS`); let go, it empties |
| The vault: the reveal | The plate rises from 92 % (0.9 s); the seal's GENOME glyphs appear one by one with P-D01's ceremony motion (0.7 s each, 0.16 s apart, after 0.35 s); the seal glows and settles to `--vault-glow` (2.6 s) |
| The vault: out into the light | CONFIRMED turns the page to ivory, the ground and the text following in 0.9 s |
| The vault: LIVE | A 6 px dot breathes (2.4 s) beside LIVE NOW and on the boutique board |

Nothing bounces, springs or loops for attention; the only perpetual motions are the reticle arc (on the scanner and on VERIFYING…), the breathing of the seal seen while a seal is seen (P-D10), the grain and, while a LIVE RELEASE is live, the breathing dot beside LIVE.

**Reduced motion.** Under `prefers-reduced-motion: reduce`, `brand.css` collapses every animation and transition to 0.001 ms (one iteration, no delay) and stops the grain; the verify app also stops the reticle arc and shows result blocks at once. Under reduced motion the seal-seen ring neither tightens nor breathes (it only steadies to full opacity, and the arc hides), the GENOME plate does not open (it is simply there), and the ceremony (P-D01) shows its glyphs, names and link at once, without motion (`.is-ceremony` is never set; the vibration comes as the result appears). In script, the leave fade, the 420 ms lock pause and the 650 ms minimum verifying time are skipped. The vault cross-fades only: the lock's orbits stay still, the door's leaves fade rather than part, the light sweep and the reveal are not played, the dot does not breathe.

### 3.7 Texture

The verification app carries theorbes.com's film grain: a fixed SVG `feTurbulence` fractal noise (base frequency 0.78, 4 octaves) at opacity 0.022, jumping position every 0.9 s (`9s steps(1)`). It is hidden on the camera screen and absent from the console. It is the only texture; there are no patterns in either app, and no images but one kind: the **photographs of the pieces** (F-04), a model's reference photograph and the photograph of one piece taken at issuance, uploaded in the console. They are evidence, not decoration: the verification app shows them only at the head of an authentic result (§5), each in a square frame on ivory, contained and never cropped, captioned and with an alternative text; the console shows them where they are set (the Catalogue, the generator's result, the product page). No photograph serves as a background, a texture or an illustration.

### 3.8 Controls

- **The hairline button** (`.btn`): 1 px `currentColor` border, no radius, transparent; fills with ink on hover (where hover exists) or press. One per screen, for the primary action. Disabled at 35 % opacity.
- **The text link** (`.textlink`): 10 px tracked caps (`--fs-micro`, `--track-micro`) at 80 % opacity (11 : 1 on white), rising to 100 % with an underline drawn on hover or focus. For the secondary action.
- **Fields**: a label in 10 px tracked caps, a single 1 px underline (`--hairline-strong`, ink on focus), no box; the field is 44 px high.
- **Floors** (verification app, the screens a customer touches on a phone): **10 px** for any text that is acted on and any fact to read, the 8 px step being left to decoration (§3.1); a tap zone of **at least 44 × 44 px** for every button, text link, scanner control (LIGHT, the zoom, UPLOAD A PHOTO, CLOSE), sign-in option and tab. The zone is transparent padding, and an equal negative margin gives the room back, so the zone itself adds no space: a control grows only by the taller line of its 10 px type (3 to 4 px: a text link from about 33 to 36 px, the tab row from 41 to 45 px), and its hairline (the text link's underline, the tab's underline, the pressed rule of a scanner control or a sign-in option) keeps its distance from the word. The two words narrower than 44 px, the zoom (1×, 2×) and the CARE tab, gain width the same way. The keyboard focus ring does not show the zone: a control with a transparent zone draws its ring with `::before`, 4 px (a tab, 2 px) outside the box it had before the zone grew, so a tab's ring stays clear of the dots beside it. On the signed-in OWNERSHIP line, MY PIECES and SIGN OUT keep their one line at any width, and so do CHANGE PASSWORD and SIGN OUT on the account line of MY PIECES: the two links wrap under the email instead. The hairline button (52 px) and the fields (44 px) already kept the floor. Checked statically by `genome/test/web/verify.brand.test.ts` (no selector that shows a pointer, nor any class the views put on a button or a link, under 10 px of type or a 44 px minimum height; the focus rings; no fact line in the 8 px class), and in Chromium at 390 × 844 px by `genome/test/web/verify.e2e.test.ts` (landing; result, again at 320 px, with a tab's focus ring measured against the dots; OWNERSHIP sign-in and account creation; the signed-in claim form and transfer code, again at 360, 375 and 320 px; the contact of ORBES Client Services under the help line and in the WARRANTY tab, again at 360, 375 and 320 px; WHERE DID YOU SEE OR BUY THIS PIECE? and its answers, again at 360, 375 and 320 px, then its form; FORGOTTEN PASSWORD? and its contact, again at 360, 375 and 320 px, the recovery form, then MY PIECES and SIGN OUT, again at 360, 375 and 320 px; MY PIECES: the landing's link, the sign-in, the list with its tabs, again at 360, 375 and 320 px, REPORT LOST / STOLEN and its confirmation, PIECE FOUND, the contact under a theft, CHANGE PASSWORD and SIGN OUT, again at 360, 375 and 320 px, and the change form; a problem screen) `genome/test/e2e/fallbacks.test.ts` (the scanner) and `genome/test/web/legal.e2e.test.ts` (the legal pages, at 390, 375, 360 and 320 px, a link inside a sentence aside; the verify suite measures the legal links of the landing and of a result, the four pages on one line down to 320 px): every visible button, link and tab measures at least 44 × 44 px in type of at least 10 px, keeps its label on one line (counted from its line boxes), no two tap zones overlap, nothing scrolls sideways (`genome/test/support/tap-zones.ts`). The console, a desktop instrument used with a pointer, keeps its 8 px tracked caps and 38 px buttons.
- **Focus**: a 1 px `currentColor` outline 4 px outside the element, keyboard only (`:focus-visible`); headings that receive focus programmatically on screen changes show none.
- **Console buttons** (`.cbtn`): 38 px, 8 px tracked caps, square; *primary* is the hairline button (outlined in ink, filled only on hover or keyboard focus), *secondary* outlined, *ghost* an underlined word, *danger* outlined in oxblood.
- **Type**: buttons, text links and field labels speak in the display face; what is typed into a field reads in `--font` (§3.1).

### 3.9 The monogram

The brand's emblem: an O, wider than tall, that holds the R, the B, the E and the S of ORBES, in high-contrast capitals with hairline serifs. The brand supplied it as vector outlines on 2026-10-02: [`assets/brand/orbes-monogram.svg`](assets/brand/orbes-monogram.svg), kept as delivered, five filled paths on a 500 × 500 artboard, one colour, no text.

<p align="center"><img src="assets/brand/orbes-monogram.svg" width="180" alt="The ORBES monogram: an oval O holding the capitals R, B, E and S"></p>

**The word is typed, the monogram is the emblem.** That is the brand's decision. The word ORBES stays text: in Gravesend Sans on screen (`.wordmark`, one spec, §3.1), so it reads, scales and is named like any word; in the stroked lettering of `label-font.ts` on print. The monogram sits beside it, never in its place. It is drawn from the master's paths only, never retraced, retouched, recoloured, outlined from a font or set as a glyph.

| Where | Size | Drawn by |
|---|---|---|
| Tab icons, `/verify` (and the legal pages, the same icon) and `/admin` | 26 of 32 units (§3.5) | `genome/scripts/favicons.ts`, which writes every `favicon.svg` |
| `/verify` landing | `clamp(64px, 19.5vw, 84px)` wide (76 px on a 390 px phone), never more than 0.3 of the emblem (`--orbit`), so on a short screen, a phone held sideways, the heading stays inside the resting orbit (47 px at 844 × 390); centred over the wordmark, 24 px above it | `landingView`, `.landing__monogram` |
| Console sign-in | 72 px wide, centred over the wordmark, 26 px above it | `loginView`, `.login__monogram` |
| Console sidebar | 44 px wide, over the wordmark and left-aligned with it, 18 px above it | `.side__monogram` |
| Certificate card | 14.4 × 11 mm, flat K 100 fill, against the right margin, from the cap line of ORBES down to the identity's baseline (§7) | `layoutCertificateCard` |
| Ownership certificate PDF (F-06) | 14.4 × 11 mm, flat ink #0A0A0A, against the right margin, from the cap line of ORBES to the baseline of OWNERSHIP CERTIFICATE (§5) | `layoutOwnershipCertificate` |

It is not on the legal pages (J-06), whose tab icon is `/verify`'s and whose head carries the small word alone, nor on the result page or the scanner, where the small word stays alone (nor on the console's sale mode, a scanner too, §6 item 13), nor on MY PIECES or the ownership certificate's page at `/verify/c` (the small word alone there too; the certificate's PDF carries it, above), nor on the print label under a code, the vocabulary specimen or theorbes.com ([§8](#8-deviations-to-resolve), item 1).

- **One source.** `genome/src/core/render/monogram.ts` carries the five outlines verbatim (`test/web/monogram.test.ts` compares them with the master file). The web apps draw them as inline SVG filled with `currentColor` (`genome/src/web/shared/monogram.ts`); the card's PDF draws them as absolute path data (`monogramPathData`), checked to cover the master's pixels; the tab icons place them with one transform.
- **Placed by its ink, not its artboard.** The ink box is the outer edge of the O, 414.42 × 316.54 units: the height is 0.764 of the width. The artboard's empty margins are dropped, so the clear space is set where the emblem is placed: at least a quarter of its height on every side (the card's 3 mm to the next mark is 0.27 of its 11 mm). The tab icon is the one exception here too: its ink box is 26 of the icon's 32 units wide, 19.9 high, so it keeps 6 units above and below but only 3 at the sides (0.15 of its height), the size it needs to read as a shape at 16 px; the icon's own edge is its clear space.
- **One colour.** The ink of its context: `currentColor` on screen, `--ink` on white and on the console's ivory; K 100 on the card. Never tinted, never a gradient (§2.10).
- **Accessibility.** Standing alone, `monogramSvg()` is an image named ORBES (`role="img"`, `aria-label="ORBES"`). Beside the typed word, which is how every screen uses it, it is decorative (`aria-hidden`): the word already says ORBES, and screen readers would otherwise say it twice. The landing heading still reads ORBES AUTHENTICATION from its words.
- **Minimum size: its hairlines.** The finest strokes, the E's arms and serifs, are 2.21 units: 0.53 % of the width. On screen it is never under 44 px wide (the sidebar), where they are a quarter of a CSS pixel and the O, the stems and the bowls carry the form; the tab icon, 16 to 32 px, is the one exception, read as a shape. On the card they print at 0.077 mm, under the 0.1 mm floor of the lettering (0.22 pt): offset on coated card usually holds positive hairlines of that weight, a digital press may lose or thicken them, so the brand's print proof of the card decides (§8, item 20). Never print it narrower than 14 mm without a physical proof. The ownership certificate's A4 (F-06) carries it at the same 14.4 mm, so the same 0.077 mm, and is the one print the brand does not control: owners and insurers print it on whatever office printer they have (a laser's 600 dpi dot is 0.042 mm), or keep it as a PDF, where it is vector and scales. The print proof does not cover it and cannot: no single printer stands for all of them. There the hairlines may thicken or drop out while the O, the stems and the bowls keep the form, which is accepted because nothing on that page rests on the emblem: the record is checked through its live link. It is never drawn smaller there than on the card.


### 3.10 The share image (P-D01)

SHARE THE GENOME, under the ceremony of a first registration (§4.4, §5), shares one image, drawn on the customer's device by `genome/src/web/verify/share-image.ts` (a canvas; `SHARE_IMAGE`):

| Element | Value |
|---|---|
| Format | 1080 × 1350 px (4 : 5), PNG |
| Ground | ivory `#F6F2EA` (the ivory colourway's paper, as the GENOME plates) |
| Ink | `#111111` (the ivory colourway's ink); `--ink-soft` `#5c5c5c` for the GENOME label and the collection |
| ORBES | the wordmark, display face, 40 px, at y = 170 |
| GENOME | its label, display face, 20 px, `--ink-soft`, at y = 232 |
| The orbit | the eight glyphs around the SEAL (`genomeLayout`, each primitive a `Path2D`), a 700 px square centred at y = 640 |
| The model | its name in the display face, 54 px, at y = 1120 (figures in the reading face, as everywhere: §3.1) |
| The collection | display face, 24 px, `--ink-soft`, at y = 1188, when the model has one |

It never shows the product id, the fingerprint or the account: only what the ceremony shows of the piece, its GENOME and the names of its model and collection. ORBES sends it nowhere: the PNG is prepared when the result is built (Safari forgets the tap while a `toBlob` is awaited), then handed to the share sheet (`navigator.share({ files })`, title `ORBES GENOME`) when `navigator.canShare` accepts it, or saved as `ORBES-GENOME.png`. The display face is loaded before it is drawn (a canvas never waits for a web font).

---

## 4. Voice and copy

### 4.1 Principles

- **Brief, calm, factual.** Uppercase tracked titles, one sentence-case explanation, at most two actions. No exclamation marks, no blame, no urgency.
- **Say only what was proven.** A positive result states that the identity was *issued and signed by ORBES* and what the registry says. Nothing claims that the physical object is genuine, because a printed code can be copied (`copy.ts`, both client and server).
- **Identity when proven, code when not.** Authentic and unusual-activity messages speak of "this ORBES identity"; unknown, invalid and unreadable ones speak of "this code".
- **Never reveal the reasoning.** No internal statuses, scores, thresholds or anomaly names reach the public. A stolen piece and an impossible-travel pattern both read UNUSUAL ACTIVITY DETECTED; a product flagged as counterfeit reads REVOKED. One accepted disclosure: the section **DO YOU HOLD THE CERTIFICATE CARD?** appears on an UNUSUAL ACTIVITY result only when the history alone made the scan unusual and the piece is unregistered, open for registration and shipped with a claim code (§4.4). Anyone scanning a copy can therefore tell that case from the others (a piece reported stolen, a registered piece): the price of not letting a burst of scans lock the buyer out. The same fact was already in the response (`registration`, API §9.2); it names no status, score or rule (THREAT-MODEL E).
- **Always a next step, always a human.** ORBES Client Services is named in every non-authentic outcome.
- **The customer's object is a "piece"**, never a "product" — in the served state messages too (`copy.ts`, checked by `genome/test/verification/redaction.test.ts`). "ORBES Client Services", "ORBES account", "ORBES boutique or authorised retailer" (or "ORBES or an authorised retailer", which also covers a piece ORBES ships itself, §4.4) are written in full.
- **One source per sentence.** The state titles and messages, the owner's unusual-activity variant included, are written once, in `server/services/copy.ts`; the verify app displays the response's `title` and `message` and does not keep its own copy of them.

### 4.2 Public verification states

Titles and messages exactly as served (`server/services/copy.ts`; the client mirrors the titles in `FALLBACK_TITLES`). The title is split at the dash: the main word is set at 24 px (18 px for caution and void), the remainder as a sub-title.

| State | Title | Message | Mark |
|---|---|---|---|
| `AUTHENTIC` | AUTHENTIC | This ORBES identity was issued and signed by ORBES and is registered to an active piece. | Authentic |
| `AUTHENTIC_FIRST_REGISTRATION` | AUTHENTIC — FIRST REGISTRATION | This ORBES identity was issued and signed by ORBES and has not yet been registered. You may register it to your ORBES account. | Authentic |
| `AUTHENTIC_REGISTERED` | AUTHENTIC — REGISTERED | This ORBES identity was issued and signed by ORBES and is registered to its owner. | Authentic |
| `AUTHENTIC_OWNERSHIP_VERIFIED` | AUTHENTIC — OWNERSHIP VERIFIED | This ORBES identity was issued and signed by ORBES and is registered to your account. | Authentic |
| …same, owner, unusual activity elsewhere | AUTHENTIC — OWNERSHIP VERIFIED | This ORBES identity is registered to your account. Unusual activity has been recorded for it; ORBES Client Services can assist you. | Authentic |
| `SUSPICIOUS_ACTIVITY` | UNUSUAL ACTIVITY DETECTED | The activity recorded for this ORBES identity requires review. Please contact ORBES Client Services before relying on it. | Caution |
| `MALFORMED_CODE` | UNREADABLE CODE | This code could not be read. Please scan it again in even light, holding the camera steady. | Caution |
| `REVOKED` | REVOKED | This ORBES identity is no longer valid. Please contact ORBES Client Services. | Void |
| `UNKNOWN` | UNKNOWN ORBES CODE | This code is not registered with ORBES. Please contact ORBES Client Services. | Void |
| `INVALID_SIGNATURE` | INVALID SIGNATURE | The signature of this code could not be verified against a valid ORBES key. | Void |

Lines that accompany the states (`verify/copy.ts`, `view-model.ts`, `views/result.ts`):

| Where | Copy |
|---|---|
| Under every positive result (footnote) | This verification confirms an identity issued and signed by ORBES and its registry record. A printed code alone cannot prove that an object is genuine; ORBES Client Services can inspect a piece on request. |
| Owner notice (unusual activity elsewhere) | Served by the server as the owner variant's message (`UNUSUAL_ACTIVITY_OWNER_COPY` in `copy.ts`, the single source, shown in the table above); the app adds no sentence of its own. |
| Under the message of AUTHENTIC — REGISTERED (J-02) | The second-hand guidance, then I HAVE A TRANSFER CODE (§4.3). |
| Non-authentic results, below the title | ORBES Client Services can help with any question about this piece. Please quote the reference below. |
| Under that line, when ORBES Client Services is configured (`CLIENT_SERVICES_*`, API §8.4); also under the note of a warranty that NO LONGER VALID | **CONTACT ORBES CLIENT SERVICES**, a text link (§3.8: a secondary action, the hairline button stays the foot's SCAN AGAIN or SCAN ANOTHER), on one line down to a 320 px phone: an email with the subject `ORBES — REF 5A864AF8 — INVALID SIGNATURE` and, under two empty lines left for the customer, `REFERENCE`, `RESULT`, `WARRANTY` (warranty tab only) and `VERIFIED`. Then the phone, a text link set in the reading face (it is made of figures), and the hours in micro type, `--ink-soft`. Nothing appears while neither an email nor a phone is configured. Never "Contact support" (§4.5). |
| Under the contact, on every result that was not authentic (after DO YOU HOLD THE CERTIFICATE CARD? when the result offers it), except a staff scan from a browser signed in to the console, which takes no report | A hairline, then **WHERE DID YOU SEE OR BUY THIS PIECE?** (a status line: 11 px, label tracking, display face) and *Optional. Your answer stays with this reference, for ORBES Client Services.* Then BOUTIQUE · ONLINE · PRIVATE SALE · OTHER, two by two, pressed like the sign-in switch; once one is chosen, PLACE (OPTIONAL) (*The name of the boutique, the website or the city.*), NOTE (OPTIONAL) (*Please leave out your name and contact details.*) and **SEND ANSWER**, a text link (§3.8: the hairline button stays SCAN AGAIN). Sent: THANK YOU and *Your answer is kept with reference 5A864AF8.* A refusal reads as the server wrote it. The question asks where, never whether the piece is fake (§4.5): the answer opens a case for ORBES Client Services (API §8.5, §16.8). |
| Hardware-assured piece scanned without hardware | This piece is designed to be confirmed with an additional secure hardware check, which this scan could not include. |
| Foot | SCAN ANOTHER (authentic) · SCAN AGAIN (otherwise) · `VERIFIED 1 OCT 2026 · 14:32` · `REF 5A864AF8` |

### 4.3 Status lines, guidance and problems

| Kind | Copy |
|---|---|
| Status lines | PREPARING CAMERA… · SCANNING… · READING PHOTO… · VERIFYING… · ORBES CODE FOUND |
| Scan guide | Align the ORBES CODE within the orbit |
| Hints (after 6 s without a read) | Place the whole code inside the orbit · Hold steady — in even light · Hold about 20 cm away · Zoom in |
| Actions | SCAN ORBES CODE · UPLOAD A PHOTO · SCAN AGAIN · TRY AGAIN · RETURN · CLOSE · LIGHT · 2× / 1× |
| The landing's foot (P-D07) | SOUND ON · SOUND OFF: a text link in the display face (`.textlink`), its accessible name SOUND and its state in `aria-pressed` (ON or OFF beside the word is for the eye), above PRIVACY · TERMS · LEGAL · HELP. On by default; kept on this device. |
| Second-hand guidance (J-02), the notice under the message of AUTHENTIC — REGISTERED | Buying this piece? Ask the seller for a transfer code from their ORBES account: only its registered owner can create one. · Then **I HAVE A TRANSFER CODE**, a text link that opens the OWNERSHIP tab on RECEIVING THIS PIECE (§4.4). |

**The second-hand guidance** (`RESALE_GUIDANCE` and `RESALE_ACTION` in `verify/copy.ts`). Once a piece is registered, a perfect copy of its code reads AUTHENTIC — REGISTERED like the original (§4.6, [counterfeit simulation](reports/counterfeit-simulation.md)), and the second-hand market is where copies are sold. What shows that a seller holds the registration is a transfer code: only the registered owner can create one, and the transfer completes in the buyer's own ORBES account. The sentence says so as a request to the buyer, never as a suspicion of the seller (§4.5: no FAKE, no WARNING). It sits between the notice's two hairlines (`result__notice`, the place of the owner's unusual-activity notice), on AUTHENTIC — REGISTERED only: never on OWNERSHIP VERIFIED (the viewer's own piece), never on FIRST REGISTRATION (no owner yet, so no transfer code can exist; the buyer registers with the claim code), and never over a notice of unusual activity, which comes first. Its link appears only where the OWNERSHIP tab shows RECEIVING THIS PIECE; keyboard focus moves to that heading, without a ring (§3.8). The same sentence, word for word, is on the certificate card's verso and in the FAQ ([packaging kit](launch/PACKAGING-KIT.md) §3, whose test compares it with `RESALE_GUIDANCE`): changing it means changing it everywhere. It is shown before the legal review that the kit's sign-off (§6) lists, by the owner's decision; that review may still reword it.

Hints never say "move closer": phones that cannot focus close (iPhone Pro, about 20 cm) only blur when moved in. The hint follows what the last few frames showed: nothing code-like, or a look-alike seal with no data orbits around it → *Place the whole code inside the orbit*; a code found but blurred or moving → *Hold steady — in even light*; a code too small to read → *Zoom in* when the camera has a zoom that is not applied, otherwise *Hold about 20 cm away* (also when the code is too large for the orbit). The scanner opens at about 2× zoom when the camera offers it; the 1× / 2× control resets it ([print-size matrix](reports/print-size-matrix.md), *Recommendation*).

| Problem | Title | Message |
|---|---|---|
| Camera declined | CAMERA ACCESS DECLINED | To scan, allow camera access for this page in your browser settings. You may also upload a photo of the ORBES CODE. |
| No camera | NO CAMERA AVAILABLE | No camera could be found on this device. Upload a photo of the ORBES CODE instead. |
| Camera busy | CAMERA UNAVAILABLE | The camera is in use by another application. Close it, then try again — or upload a photo of the ORBES CODE. |
| Insecure page | SECURE CONNECTION REQUIRED | The camera can only be used over a secure connection. Open this page from its https:// address, or upload a photo of the ORBES CODE. |
| Unsupported browser | CAMERA NOT SUPPORTED | This browser cannot use the camera here. Upload a photo of the ORBES CODE, or open this page in Safari or Chrome. |
| Camera failed | CAMERA UNAVAILABLE | The camera could not be started. Please try again, or upload a photo of the ORBES CODE. |
| 40 s without a read | NO ORBES CODE FOUND | Hold the camera 10 to 20 cm from the code, in soft even light, with the whole code inside the orbit. |
| Photo without a code | NO ORBES CODE FOUND | No ORBES CODE could be read in this photo. Choose a sharp, well-lit photo in which the whole code is visible. |
| Not an image | PHOTO NOT READABLE | This file could not be opened as a photo. Choose a JPEG, PNG or HEIC image. |
| Decoder failed | SCANNER UNAVAILABLE | The scanner could not be started in this browser. Please reload the page and try again. |
| Offline | CONNECTION INTERRUPTED | The ORBES verification service could not be reached. Check your connection, then try again. |
| Rate-limited | A MOMENT, PLEASE | Many verifications were requested from this connection. Please wait a minute, then try again. |
| Server error | VERIFICATION UNAVAILABLE | The verification could not be completed just now. Please try again in a moment. |

### 4.4 Ownership and warranty

| Situation | Status line | Sentence |
|---|---|---|
| First registration open | REGISTRATION OPEN · REGISTRATION OPEN UNTIL 13:14 | Register this piece in your name to keep its warranty, service history and ownership together. |
| Window closed | REGISTRATION OPEN (see §8, item 19) | The registration window of this scan has closed. Scan the code again to register this piece. |
| Owned by the viewer | REGISTERED TO YOU | This piece is registered to your ORBES account. |
| Owned by someone else | REGISTERED TO ITS OWNER | This piece is registered to an ORBES account. (A transfer pending: *This piece is registered to an ORBES account. A transfer of its ownership is in progress.*) Then the section label RECEIVING THIS PIECE. Signed out: *If its owner has given you a transfer code, enter it to register this piece in your name.*, the sign-in (*Sign in or create an ORBES account to receive it.*) and *If this piece is already registered to you, sign in and scan it again to see it as its owner.* |
| Owned by someone else, reached from the second-hand guidance (J-02, §4.3) | RECEIVING THIS PIECE (a section label, focused) | I HAVE A TRANSFER CODE, the text link under the result's notice, selects this tab and centres RECEIVING THIS PIECE on the screen, the tab and REGISTERED TO ITS OWNER still in sight above it, then what the rows above say: signed out, the sign-in; signed in, TRANSFER CODE and RECEIVE THIS PIECE within the scan's window (F-03), else VERIFY AGAIN or SCAN AGAIN. Once the piece is received, the link opens the tab alone. |
| Receiving a piece (F-03: signed in when the piece was scanned, its transfer pending; the result opens on OWNERSHIP) | RECEIVING THIS PIECE · RECEIVING OPEN UNTIL 13:14 | If its owner has given you a transfer code, enter it to register this piece in your name. · TRANSFER CODE (*Created by its owner in their ORBES account.*), RECEIVE THIS PIECE. The code is accepted for the piece scanned only: another piece's reads as the server writes it, *This transfer code is not for this piece. Check the code with the owner of this piece.* Done: REGISTERED TO YOU, *The ownership of O26-J-00184 has been transferred to your ORBES account.*, VIEW AS OWNER. |
| Signed in after the scan, transfer pending (or signed in on the result as another account than the scan's, whose window the server would refuse) | RECEIVING THIS PIECE | To receive this piece, verify it again now that you are signed in. · VERIFY AGAIN (the hairline button: the same code, verified again with the session; the result then opens on OWNERSHIP). |
| Receiving window closed (15 minutes after the scan, counted on the phone's own clock from the result, so a phone set to the wrong time still has its 15 minutes) | RECEIVING THIS PIECE | The window to receive this piece from this scan has closed. Scan the code again to receive it. · SCAN AGAIN. Nothing is sent. |
| Owned by someone else, its transfer pending, scanned in a browser signed in to the console (a staff scan, S-07, which earns no window) | STAFF SCAN · RECEIVING THIS PIECE | This browser is signed in to the ORBES console, so this scan was recorded as a staff test and receiving this piece is not offered. To receive a piece of your own, scan it in a browser that is not signed in to the console. Never VERIFY AGAIN, which would only repeat the staff scan. |
| Unusual activity from the scan history alone, a transfer pending, signed in when the piece was scanned (F-03, the registration's exception) | DO YOU HOLD A TRANSFER CODE? · REGISTERED TO ITS OWNER · RECEIVING THIS PIECE | If the owner of this piece has given you a transfer code, you may receive it in your ORBES account with that code. · While its activity is reviewed, this piece can be received only with the transfer code its owner gave you. · Then TRANSFER CODE and RECEIVE THIS PIECE, as above, under the help line; the window closed, the sentence points to the foot's SCAN AGAIN (no second button). |
| Signed in, no transfer pending | RECEIVING THIS PIECE | No transfer of this piece is pending. Once its owner has created a transfer code, scan this piece again to receive it. · *If this piece is registered to you, verify it again to see it as its owner.* · VERIFY AGAIN (a text link: an owner who signed in after the scan reaches the owner view). |
| Not delivered yet (a piece ORBES has not sold: in stock, or in a pre-sale service; S-07) | NOT YET DELIVERED | This piece has not yet been delivered by ORBES or an authorised retailer. Registration opens once it has been. |
| Open for registration, scanned in a browser signed in to the console (a staff scan, S-07, API §9.7) | STAFF SCAN | This browser is signed in to the ORBES console, so this scan was recorded as a staff test and registration is not offered. To register a piece of your own, scan it in a browser that is not signed in to the console. |
| Transfer offered | TRANSFER CODE · VALID UNTIL … | Give this code only to the new owner. The transfer completes when they enter it in their ORBES account. |
| Unusual activity, registration offered to the card holder | DO YOU HOLD THE CERTIFICATE CARD? · REGISTRATION OPEN | If this piece was delivered to you with its ORBES certificate card, you may register it in your name with the claim code printed under the scratch-off panel. · While its activity is reviewed, this piece can be registered only with the claim code of its certificate card. |
| Claim code field hint | — | Printed on the ORBES certificate card delivered with your piece. |
| Forgotten password (C-04): FORGOTTEN PASSWORD?, a text link under the sign-in form | FORGOTTEN PASSWORD (a section label, under the status of the piece) | ORBES Client Services can help you set a new password. After checking your identity, they give you a one-time recovery code, valid for 30 minutes. · Then the contact of ORBES Client Services when configured (an email titled `ORBES — FORGOTTEN PASSWORD` that quotes the REF on screen, the phone, the hours), and I HAVE A RECOVERY CODE over BACK TO SIGN IN, two text links. |
| Recovery code | SET A NEW PASSWORD | Enter the email of your ORBES account, the recovery code given by ORBES Client Services and a new password. · EMAIL, RECOVERY CODE (*Given by ORBES Client Services. It works once.*), NEW PASSWORD, SET NEW PASSWORD. A refusal reads as the server wrote it, one sentence for every case. |
| Password recovered | — (the sign-in form returns, the email filled in) | Your password has been changed: sign in with it. For your security, every session of your account has ended, its pending transfers were cancelled, its certificate links were withdrawn and new transfers are paused until 5 October 2026, 11:00. |
| Signed in (the OWNERSHIP tab) | SIGNED IN AS {email} · MY PIECES · SIGN OUT | Two text links, one line each, which wrap under the email when the line is short. MY PIECES opens the owner's pieces (§5), where CHANGE PASSWORD now is (F-01). |
| Signed in (MY PIECES, at the foot) | SIGNED IN AS {email} · CHANGE PASSWORD · SIGN OUT | The same line, under the pieces; CHANGE PASSWORD opens its form beneath it. |
| Change of password (MY PIECES) | CHANGE PASSWORD | Enter your current password, then a new one. Your other sessions will end; you stay signed in here. · CURRENT PASSWORD, NEW PASSWORD, CANCEL. Done: *Your password has been changed. Your other sessions have ended.* A wrong current password is said on its field, *The current password is not correct.*, and never signs the customer out. |
| Transfer after a recovery | — (the server's sentence) | After the recovery of its password, transfers from this account are paused until 5 October 2026, 09:00 UTC. ORBES Client Services can assist you. |
| MY PIECES, signed out | MY PIECES (the page's title) | Sign in to see the pieces registered to your ORBES account. A piece lost or stolen can be reported here, without scanning it. · Then SIGN IN · CREATE ACCOUNT and FORGOTTEN PASSWORD?, as in the OWNERSHIP tab. |
| MY PIECES, a piece (OWNERSHIP) | REGISTERED TO YOU · TRANSFER PENDING · IN SERVICE | Rows SINCE, ACQUIRED (FIRST REGISTRATION, TRANSFER, RESALE, ORBES CLIENT SERVICES), OWNERSHIP (VERIFIED, NOT YET VERIFIED), TRANSFER (PENDING UNTIL 8 OCT 2026). *A transfer of this piece is pending until 8 October 2026. You may cancel it at any time before it is accepted.* (CANCEL TRANSFER) · *ORBES Client Services may ask for a proof of purchase to verify your ownership.* (not yet verified) |
| MY PIECES, not reported | — | If this piece is lost or stolen, report it here: every scan of its code will then show UNUSUAL ACTIVITY to whoever checks it, and it can no longer be transferred. · REPORT LOST / STOLEN, a text link. |
| MY PIECES, a piece the owner cannot report (revoked, retired or flagged by ORBES: `incidentReportable` false; the page names no status) | REGISTERED TO YOU | A loss or a theft of this piece cannot be reported here: tell ORBES Client Services. · Then their contact, when configured (an email titled `ORBES — O26-J-00184 — REGISTERED TO YOU` that names the piece, the phone, the hours). No REPORT LOST / STOLEN and no OWNERSHIP CERTIFICATE: the server would refuse both (a report answers *This piece cannot be reported here. ORBES Client Services can assist you.*, never the lifecycle's wording). |
| Report, confirmed | REPORT LOST / STOLEN (a section label) | LOST · STOLEN, pressed like the sign-in switch; LOST: *Once you find it, you withdraw the report yourself, here: PIECE FOUND.* STOLEN: *Once it is recovered, ORBES Client Services check the piece and withdraw the report.* Then *Every scan of its code will show UNUSUAL ACTIVITY to whoever checks it, and any pending transfer of this piece is cancelled.*, CONFIRM REPORT (the hairline button) and CANCEL. Without a choice: *Choose LOST or STOLEN.* Done: *This piece is now reported stolen. Every scan of its code shows UNUSUAL ACTIVITY.* |
| Reported lost by the owner | REPORTED LOST | Every scan of its code shows UNUSUAL ACTIVITY until you tell ORBES that it has been found. · PIECE FOUND, a text link, then *Confirm with the password of your ORBES account that this piece is back with you. Its scans will read as before, and it can be transferred again.*, PASSWORD, CONFIRM (the hairline button) and CANCEL. Without it: *Enter the password of your ORBES account.*; a wrong one is said on its field, *The current password is not correct.*, which is cleared, and never signs the customer out. Done: *This piece is no longer reported lost.*, and the piece as the server now holds it (IN SERVICE for a loss declared during a service). |
| Reported stolen, or lost by ORBES Client Services | REPORTED STOLEN · REPORTED LOST | Every scan of its code shows UNUSUAL ACTIVITY. Once the piece is recovered, ORBES Client Services check it and withdraw the report. (A loss: *ORBES Client Services recorded this piece as lost: …*) · Then their contact, when configured: an email titled `ORBES — O26-J-00184 — REPORTED STOLEN` that names the piece, the phone, the hours. Nothing to press. |
| SERVICE tab | SERVICE HISTORY (a section label) | One row per service: POLISH · 1 OCT 2026 – 3 OCT 2026 · PARIS ATELIER; IN PROGRESS SINCE …; CANCELLED · …. None: *No service has been recorded for this piece.* |
| MY PIECES, the ownership certificate (F-06; a piece not reported lost or stolen, nor revoked or retired) | OWNERSHIP CERTIFICATE (a section label) | Share a link to a certificate of this piece with a buyer or an insurer: its GENOME, your ownership and its date, the warranty, and that no loss or theft is reported. It never shows your name or your email, and it stops being valid if the piece changes hands or is reported lost or stolen. · CREATE CERTIFICATE, a text link, then 7 DAYS · 30 DAYS · 90 DAYS (pressed like the sign-in switch, 30 DAYS chosen), *Anyone who has the link sees the certificate, read live, until it expires or you withdraw it. You can have up to ten at a time for this piece.*, CREATE LINK (the hairline button) and CANCEL. Done: CERTIFICATE LINK on ivory, like a transfer code, the address, VALID UNTIL 1 JAN 2027, *This link is shown once: copy it now. ORBES cannot show it again.*, COPY LINK (*The link has been copied.*) and OPEN LINK. Each open link: CREATED 3 OCT 2026 · VALID UNTIL 1 JAN 2027 (or · NO LONGER VALID after a report), WITHDRAW (*The link has been withdrawn: it no longer leads to the certificate.*). Links that cannot be read: *Your certificate links could not be shown just now.* and TRY AGAIN, which stay after a new link is created (the list, read again then, is never stood for by the new link alone). |
| The certificate's page (F-06, `/verify/c#…`, anyone with the link) | OWNERSHIP CERTIFICATE · VALID · NO LONGER VALID · NOT FOUND | VALID: *What the ORBES registry records about this piece, read just now. It attests this record, not the object it is shown with: to check an object, scan its ORBES CODE.* NO LONGER VALID: *This certificate has expired, or the record of its piece has changed since it was issued. Ask the owner of the piece for a new certificate.* NOT FOUND: *This link does not lead to a certificate: it may be incomplete, or withdrawn by its owner. Ask the owner of the piece for a new link.* Rows: OWNERSHIP (VERIFIED, REGISTERED · NOT YET VERIFIED), SINCE, WARRANTY, FROM, UNTIL, LOSS OR THEFT (NONE REPORTED); CHECKED, ISSUED, VALID UNTIL. *A certificate names no owner. It stops being valid once the piece changes hands or a loss or theft is reported, and when it expires.* Never AUTHENTIC (§4.6). |
| The ceremony of a first registration (P-D01): after REGISTER THIS PIECE (with or without the claim code, the registration with the certificate card from an UNUSUAL ACTIVITY result included), VIEW AS OWNER opens it; never after a piece received with a transfer code | — (the result as its owner, REGISTERED TO YOU) | The GENOME plate first, above the photographs; its eight glyphs appear one by one (§3.6), then the model's name and its collection in capitals, in the display face (figures in the reading face): MONOLITHE, then ORBIT in `--ink-soft` (`.ceremony__name`, `.ceremony__collection`; their accessible name *Your piece*). Then **SHARE THE GENOME**, a text link (the hairline button stays the foot's SCAN ANOTHER), shown once its image is ready (§3.10: its share title `ORBES GENOME`, its file `ORBES-GENOME.png`). Only on an authentic result of a piece that is the reader's (OWNERSHIP VERIFIED), with its GENOME and its model. Neither a rank nor a vintage (the plan's choice 6). |
| MY PIECES, the CARE tab (P-M02, `ORBES_CARE`) | CARING FOR THIS PIECE · ORBES CARE (section labels) | The model's care, as a result's CARE tab reads it (else the general care text). Then *ORBES Care looks after your pieces, year after year:* and its three lines, *An annual care service by the ORBES atelier: inspection, cleaning and polishing.* · *Priority repair with ORBES Client Services.* · *An extended warranty.* Then **SUBSCRIBE**, a text link in the display face, opened in a new tab (accessible name *Subscribe to ORBES Care, in a new tab*), once ORBES publishes the subscription's page; until then *Subscriptions open soon.*, with nothing to press. |
| A model discontinued (P-R06, `DISCONTINUED`) | DISCONTINUED · 2027 | The last of the product lines of an authentic result and of the ownership certificate's page; on a lookbook sheet, the line under its name (`RING · DISCONTINUED · 2027`, after THE PRIVATE SALON when the club opened it). The year is a figure in the reading face (`withNumerals`, `.lines__line`). The result's PRODUCT tab has a DISCONTINUED row (the year); the certificate's PDF a DISCONTINUED row under CREATED. The piece verifies as before: nothing else changes. |
| THE PRIVATE SALON (P-X08, `LOOKBOOK.reserved`, `LOOKBOOK.salon`), signed in with a piece | THE PRIVATE SALON · PRICE · OFFERED FROM · REQUESTED | In THE COLLECTION: THE PRIVATE SALON and *Pieces offered to the owners of an ORBES piece, by tier, on request.* over the reserved models the reader's tier reaches, each card with its price in the reading face. On such a sheet, the section THE PRIVATE SALON: PRICE (when one is shown) and OFFERED FROM (TITANE, PLATINE, PALLADIUM) rows, *Offered to the owners of an ORBES piece, on request. ORBES Client Services contacts you to conclude the sale: nothing is paid here.*, the field A NOTE FOR ORBES CLIENT SERVICES (*Optional: a size, a finish, the best time to call.*) and **REQUEST THIS PIECE**, the sheet's one hairline button. Done: REQUESTED, *ORBES Client Services will contact you.*, then their contact when configured (an email titled `ORBES — ECLIPSE — REQUEST`). A refusal reads *The request could not be sent.* and the server's sentence (*You have already requested this piece: ORBES Client Services will contact you.*). |

Warranty statuses read NOT YET STARTED, ACTIVE, EXPIRED or NO LONGER VALID, each with one sentence ("This piece is covered by the ORBES warranty until 25 September 2028."). Dates inside sentences are written in full; dates in rows are `25 SEP 2028`.

### 4.5 Lexicon

| Use | Never use |
|---|---|
| AUTHENTIC (of the signed identity), issued and signed by ORBES, registered, ORBES identity | REAL, GENUINE as a verdict, 100 % GENUINE, AUTHENTICITY GUARANTEED, CERTIFIED ORIGINAL |
| UNUSUAL ACTIVITY, requires review, no longer valid, not registered | FAKE, COUNTERFEIT, FRAUD, STOLEN, ALERT, DANGER, WARNING (to the public) |
| ORBES CODE, ORBES GENOME, ORBES SEAL, orbit, piece | QR, barcode, tag ID, NFT, token, blockchain, ledger, crypto, Web3 |
| signature, ORBES key (one tab deep) | IMPOSSIBLE TO COUNTERFEIT, UNHACKABLE, UNCLONABLE, TAMPER-PROOF, MILITARY-GRADE, BANK-GRADE, QUANTUM-SAFE, AI-POWERED |
| ORBES Client Services can assist you | Contact support, Error, Oops, Something went wrong |
| DRAW, ENTER THE DRAW, a place held (the releases, P-R03); EARLY ACCESS, RESERVE A PLACE, PLACE RESERVED (P-X02) | lottery |

"AUTHENTIC" is the one strong word the system allows, and it is always qualified on the same screen: the message names what was signed, and the footnote names what a printed code cannot prove.

**DRAW, never lottery.** A release (P-R03) is entered for free and ranked by tier, then seniority, then the order of a seed published after the draw: its words are DRAW, ENTER THE DRAW, a place held, the waiting list. A place drawn obliges no one, and the page says so; the word lottery, which promises chance and a prize, is never used (`genome/test/web/verify.releases.test.ts` holds the copy to this table).

**EARLY ACCESS, never a privilege sold.** Before a release opens to everyone (48 hours by default, set per release), PLATINE and PALLADIUM owners reserve a place directly (P-X02): its words are EARLY ACCESS (the state of a release then), EVERY PIECE RESERVED (after the state, once every piece is held by a direct reservation), *PLATINE AND PALLADIUM: FROM … · EVERYONE: FROM …* (the line under a release's state, in the reading face, `.release__access`, 9 px), the rows EARLY ACCESS and RESERVED DIRECTLY (`2 OF 50 PIECES`), RESERVE A PLACE (the page's one hairline button while it is offered) and PLACE RESERVED (an entry's label). A reservation obliges no one either, and ORBES Client Services concludes the sale. The draw's rule then reads *as many as there are pieces left after the direct reservations of PLATINE and PALLADIUM owners*.

**The tiers' words** (P-X04). TITANE, PLATINE and PALLADIUM are names, in the display face, never translated; their benefits are the server's words, set from the console's Club (§6), shown as reading text. The words by default (`services/club.ts` `CLUB_TIER_DEFAULT_BENEFITS`) are approved copy:

- TITANE: *The owners’ circle: its notes, its invitations and its polls.* · *Priority in the draw of each release, before the accounts that hold no piece.*
- PLATINE: *Priority care for your pieces with ORBES Client Services.* · *Early access to each release: a place reserved directly before it opens to everyone, 48 hours ahead unless its page says otherwise.*
- PALLADIUM: *Special commissions, made for you by the ORBES atelier.* · *A yearly visit to the ORBES atelier.*

A change made in the console is held to this table as any copy is: no word of the "Never use" column, no exclamation mark.

**THE PRIVATE SALON, never a shop** (P-X08). The section of the lookbook's reserved models reads THE PRIVATE SALON (it replaced RESERVED FOR OWNERS); its words are a price shown, OFFERED FROM a tier, REQUEST THIS PIECE and REQUESTED. A request obliges no one and nothing is paid on /verify: the page says *ORBES Client Services contacts you to conclude the sale: nothing is paid here.*. A price is the console's words (« € 4 800 », « Price on request »), held to this table like any copy.

**ORBES Care, a presentation** (P-M02). The CARE tab presents ORBES Care and its three lines; SUBSCRIBE appears only once the subscription's page exists (a third-party page, Whop), and until then *Subscriptions open soon.* promises no date.

**DISCONTINUED, a fact** (P-R06). *DISCONTINUED · 2027* says that the model is no longer made, with its year; it never qualifies the piece, which verifies as before, and an ADMIN may reinstate the model, when the line goes.

**LOST and STOLEN in MY PIECES.** The owner's own page (§5, F-01) names the owner's own declaration in their words: REPORT LOST / STOLEN, REPORTED STOLEN, PIECE FOUND. That page is signed in and shows only the account's pieces. To the public, a piece reported lost or stolen still reads UNUSUAL ACTIVITY DETECTED, and the page says so: *every scan of its code shows UNUSUAL ACTIVITY*. The ownership certificate a reader opens from its link (F-06) says *LOSS OR THEFT · NONE REPORTED* when it holds, and only NO LONGER VALID once it does not: never which declaration ended it.

**No AUTHENTIC on a certificate.** An ownership certificate (§5, F-06) attests what the registry records about a piece, never the object it is shown with: its page and its PDF never use the word, and say so in their first sentence.

**In French.** The [packaging kit](launch/PACKAGING-KIT.md), §4, translates this table for every French text: packaging, certificate card, announcement, FAQ, replies from ORBES Client Services. `genome/test/docs/packaging-kit.test.ts` reads both tables, this one and the kit's, and refuses their terms anywhere else in the kit. The staff's [sales playbook](launch/SALES-PLAYBOOK.md) (J-09) is held to them too (`genome/test/docs/sales-playbook.test.ts`): its phrases to say to a client without exception, its instructions except inside a code span that is, case for case, a whole label or status of the software (a string literal of its code, such as `Products` or `STOLEN`, never a part of one nor a lowercase key such as 'token'), one of its constants or a file of the repository: internal words, never read to a client (§4.1). Every other code span of the playbook must quote the software too, so a label that drifts from the screen fails the test. The [legal drafts](legal/README.md) (J-04: the terms of use and the legal notice, in French and English) are customer copy, held to both tables without exception (`genome/test/docs/terms-facts.test.ts`), and so are the legal pages that publish them with the privacy policy and the FAQ (J-06, `genome/test/web/legal.content.test.ts`); their result clauses say what §4.6 says: AUTHENTIC qualifies the signed identity, a copy can verify like the original, and a registration is not a title of ownership.

### 4.6 Talking about limitations honestly

The system is honest about three limits, and the copy must stay so:

1. **A copy verifies like the original.** A perfect copy of a genuine code verifies exactly like it as long as its scans are plausible for one object ([counterfeit simulation](reports/counterfeit-simulation.md), "A single quiet copy"). Hence the footnote under every positive result, and the console's generator note: *"A printed code proves that ORBES issued the data. It does not, by itself, prove that an object is genuine."*
2. **Secure hardware does not exist yet.** Policies naming NFC, a secure element or a tamper-evident seal are labelled *"Hardware not yet available — verifies as CODE ONLY"* in the console; a scan of such a piece says it *could not include* the hardware check. The ASSURANCE row reads PRINTED CODE, PRINTED CODE ONLY or PRINTED CODE AND SECURE HARDWARE.
3. **Unusual activity is a request for review, not a verdict.** The copy asks the customer to contact ORBES Client Services *before relying on it*; it never accuses.

When writing new copy: state the fact that was checked, say plainly what it does not cover, and offer a human. Never promise certainty that cryptography cannot give about a physical object.

---

## 5. The verification experience

```
LANDING ──SCAN ORBES CODE──▶ SCANNER ──code read──▶ ORBES CODE FOUND ──420 ms──▶ VERIFYING… ──▶ RESULT ──▶ tabs
   │                            │ searching ─seal seen─▶ the ring tightens ─code read─▶ locked (P-D10)
   │                            │ 6 s without a read: a hint · 40 s: NO ORBES CODE FOUND
   ├──UPLOAD A PHOTO──▶ READING PHOTO… ──▶ VERIFYING… ──▶ RESULT
   ├──MY PIECES──▶ /verify/pieces: sign-in (signed out), then the pieces ──▶ OWNERSHIP · WARRANTY · SERVICE · CARE
   ├──THE COLLECTION──▶ /verify/lookbook: the models (and THE PRIVATE SALON for an owner, P-X08) ──SEE THE MODEL──▶ /verify/lookbook/<slug>: a model's sheet (P-R02)
   └──THE RELEASES──▶ /verify/releases ──SEE THE RELEASE──▶ /verify/releases/<id>: a release, its entry, its draw (P-R03)
RESULT ──SEE THE MODEL──▶ the sheet of its model, THE COLLECTION under it
RESULT ──REGISTER THIS PIECE, then VIEW AS OWNER──▶ VERIFYING… ──▶ RESULT with the ceremony (P-D01) ──SHARE THE GENOME──▶ the share sheet, or ORBES-GENOME.png
an AUTHENTIC result ──▶ the sound signature, unless SOUND OFF (P-D07)
a shared link ──▶ /verify/c#…: the OWNERSHIP CERTIFICATE of a piece (F-06), no sign-in
any step ──problem──▶ MESSAGE: void mark · title · one sentence · primary button · secondary link
```

Every screen after the landing shares one history entry, so the back button (or CLOSE) always returns to the landing screen and releases the camera. MY PIECES takes that entry too, with its own address, `/verify/pieces`: a link, a bookmark or a reload opens it directly, and opened directly it puts the landing under itself, so back still returns to the landing rather than out of the app (any other path under `/verify` shows the landing). So does THE COLLECTION, `/verify/lookbook`; a model's sheet, `/verify/lookbook/<slug>`, is the one entry above it, so back from a sheet returns to THE COLLECTION, then to the landing (opened directly, a sheet puts both under itself). THE RELEASES, `/verify/releases`, and a release's page, `/verify/releases/<id>`, are built alike (P-R03). The camera is also released when the page is hidden and resumed on return. Each new screen moves focus to its heading (to the scan button on the landing) so screen readers announce it; status lines are `aria-live`.

<table>
<tr>
<td width="33%"><img src="assets/ui/verify-01-landing.png" width="250" alt="Verify landing: the monogram over the ORBES wordmark inside a faint orbit, SCAN ORBES CODE button, UPLOAD A PHOTO and MY PIECES links, then PRIVACY · TERMS · LEGAL · HELP and IP GEOLOCATION BY DB-IP at the foot"></td>
<td width="33%"><img src="assets/ui/verify-02-scanning.png" width="250" alt="Scanner: camera view of a code on a desk, white orbit reticle with four moons, SCANNING…"></td>
<td width="33%"><img src="assets/ui/verify-03-locked.png" width="250" alt="Scanner locked on the code: frozen frame, darker veil, closed orbit, VERIFYING…"></td>
</tr>
<tr>
<td valign="top"><b>1 · Landing.</b> The monogram over the wordmark sits inside the resting orbit as the core sits inside the seal (§3.9). One hairline button, four discreet links (UPLOAD A PHOTO, then MY PIECES once the session is known, then THE COLLECTION, P-R02, and THE RELEASES, P-R03). At the foot, in the page's flow (a short phone scrolls down to it), **SOUND ON / OFF** (P-D07: a text link in the display face, accessible name SOUND, `aria-pressed`), then the legal pages, PRIVACY · TERMS · LEGAL · HELP, and IP GEOLOCATION BY DB-IP (J-06), then © ORBES and PARIS (GENOME CODE joins them from 560 px). The screenshot predates P-D07 and does not show SOUND ON / OFF yet, until the screenshots are made again (§9).</td>
<td valign="top"><b>2 · Scanning.</b> Full-bleed camera, a flat 50 % veil outside the orbit, the live reticle with its travelling arc and four moons (polaris top left). One status line, one guide sentence, LIGHT and the zoom control only when the camera offers them (the camera opens at about 2× zoom; the control returns to 1×). Once a seal is seen (P-D10), the ring tightens around the centre and its focus breathes while the sweep gives way; without a seal for 900 ms, it searches again.</td>
<td valign="top"><b>3 · Code found.</b> The frame freezes, the veil deepens to 78 %, the orbit closes (2 px, moons ×1.35) and the phone ticks. ORBES CODE FOUND for 420 ms, then VERIFYING… while the server answers.</td>
</tr>
</table>

The scanner decodes only the square under the reticle (×1.45 margin), at most every 120 ms. A read that needed heavy error correction is only submitted once a second frame reads the same code, so the lock may take one frame longer on a worn code. On the camera screen the brackets and type turn white and the grain is removed.

<table>
<tr>
<td width="40%"><img src="assets/ui/verify-04-result-first-registration.png" width="300" alt="Result for O26-J-00184: AUTHENTIC — FIRST REGISTRATION, GENOME specimen on ivory with the eight glyphs in their orbit around the seal, product lines, tabs with OWNERSHIP selected, footnote"></td>
<td valign="top">
<b>4 · Result, O26-J-00184 — AUTHENTIC · FIRST REGISTRATION.</b> From top to bottom:
<ol>
<li>small wordmark;</li>
<li>the state mark (here the authentic seal echo);</li>
<li>the title, split at the dash into a 24 px main word and a tracked sub-title;</li>
<li>one sentence from the server;</li>
<li>when ORBES has them (F-04), the <b>photographs</b>: an ivory plate framed by the same brackets, the photograph of this piece (taken at issuance) then its model's reference photograph, side by side in square frames, contained, never cropped, captioned THIS PIECE and THE MODEL (10 px, display face, <code>--ink-soft</code>), each with its alternative text, then one sentence: <i>Photographed by ORBES. Compare them with the piece in your hands.</i> (<i>it</i> for one). A photograph that does not load takes its frame with it. Never on a result that is not authentic: the server sends no photograph there (API §9.2);</li>
<li>the <b>GENOME specimen</b>: an ivory plate framed by hairline brackets, with the product id, the eight glyphs in their orbit around the SEAL as on the piece (glyph 0 at north, then clockwise), drawn by the core renderer (the same function as print), and the fingerprint <code>G1-E1DC-BE52 · GENOME-01</code>;</li>
<li>the product lines MODEL / TYPE / CATEGORY / MATERIAL / CREATED YYYY, then <b>DISCONTINUED · YYYY</b>, the last line, once an ADMIN discontinued its model (P-R06; the year in the reading face), and under them, when the model is shown in THE COLLECTION (P-R02), <b>SEE THE MODEL</b>, a text link to its sheet;</li>
<li>the tabs PRODUCT · WARRANTY · CARE · OWNERSHIP, opening on OWNERSHIP because registration is open, or because the signed-in reader can receive the piece, its transfer pending (F-03; PRODUCT otherwise);</li>
<li>SCAN ANOTHER, the honest footnote, the VERIFIED · REF line, then the legal pages and DB-IP's attribution (J-06), which open in a new tab so the result stays.</li>
</ol>
The client recomputes the genome from the glyphs it received and draws the orbit only if it matches the server's fingerprint. Product lines, tabs and photographs appear only for the four AUTHENTIC states; the GENOME appears whenever the server sends it (authentic, unusual activity, revoked). The photographs are the one comparison a client makes with the object itself: a code copied from one piece onto another shows the first piece. They say nothing more than that (§4.6): a photograph of the right piece does not make the object in hand genuine.
</td>
</tr>
</table>

<table>
<tr>
<td width="50%"><img src="assets/ui/verify-05-tab-product.png" width="330" alt="PRODUCT tab: product rows and VERIFICATION rows"></td>
<td width="50%"><img src="assets/ui/verify-06-tab-warranty.png" width="330" alt="WARRANTY tab: status ACTIVE, from and until dates, one sentence"><br><br><img src="assets/ui/verify-07-tab-care.png" width="330" alt="CARE tab: care instructions in prose"></td>
</tr>
<tr>
<td valign="top"><b>PRODUCT.</b> Facts as label/value rows (a DISCONTINUED row with the year once its model is discontinued, P-R06), then VERIFICATION: signature, code version and issue, genome version, issue date, assurance. This is where the technology lives, in plain words.</td>
<td valign="top"><b>WARRANTY</b> and <b>CARE.</b> Status rows with one explanatory sentence; care as prose from the model (a default text otherwise).</td>
</tr>
<tr>
<td colspan="2"><img src="assets/ui/verify-08-tab-ownership.png" width="330" alt="OWNERSHIP tab: REGISTRATION OPEN, sign-in form"><br><b>OWNERSHIP.</b> Registration with the claim code from the certificate card, sign-in or account creation, transfer codes, and RECEIVING THIS PIECE for the piece scanned only (F-03, §4.4); under sign-in, FORGOTTEN PASSWORD? (ORBES Client Services, then the recovery code), and, signed in, MY PIECES beside SIGN OUT (§4.4). Fields are single hairlines; errors are one sentence preceded by an em dash; secrets are never stored beyond the form.</td>
</tr>
</table>

Tabs follow the ARIA tablist pattern (arrow keys, Home, End, roving tab index); panels are built on first selection. MY PIECES uses the same tablist, one per piece.

<table>
<tr>
<td width="33%"><img src="assets/ui/verify-09-verifying.png" width="250" alt="VERIFYING… with a moon orbiting a faint ring"></td>
<td width="33%"><img src="assets/ui/verify-10-unusual-activity.png" width="250" alt="UNUSUAL ACTIVITY DETECTED for O26-J-00193, caution mark, GENOME specimen in its orbit, help text, WHERE DID YOU SEE OR BUY THIS PIECE?, SCAN AGAIN"></td>
<td width="33%"><img src="assets/ui/verify-11-invalid-signature.png" width="250" alt="INVALID SIGNATURE, empty orbit mark, help text, WHERE DID YOU SEE OR BUY THIS PIECE?, SCAN AGAIN"></td>
</tr>
<tr>
<td valign="top"><b>Verifying (photo path).</b> READING PHOTO… then VERIFYING…, under the scanner's ring taken up (P-D10): faint (30 %), its arc travelling once per 2.4 s and its four moons, at the scanner's size and in its centre (the screenshot predates it and still shows the former loader, a moon orbiting a 22 % ring, until the screenshots are made again, §9).</td>
<td valign="top"><b>Unusual activity</b> (O26-J-00193, reported stolen, scanned by a stranger). Caution mark, 18 px title on two lines, the GENOME, a request to contact Client Services with the reference, then (when Client Services is configured) CONTACT ORBES CLIENT SERVICES, the phone and the hours. No tabs, no product facts. A stolen piece offers no registration: WHERE DID YOU SEE OR BUY THIS PIECE? follows, then SCAN AGAIN.</td>
<td valign="top"><b>Invalid signature</b> (a demo code with one signature bit flipped). Void mark, nothing about the product, the same calm help sentence and, when Client Services is configured, its contact, a text link on one line down to a 320 px phone, then WHERE DID YOU SEE OR BUY THIS PIECE? (§4.2), above SCAN AGAIN, the screen's one hairline button.</td>
</tr>
</table>

<table>
<tr>
<td width="33%"><img src="assets/ui/verify-10b-unusual-activity-card.png" width="250" alt="UNUSUAL ACTIVITY DETECTED for O26-L-00014, the GENOME, the help line, then DO YOU HOLD THE CERTIFICATE CARD? with REGISTRATION OPEN, the sign-in form, and SCAN AGAIN"></td>
<td valign="top" colspan="2"><b>Unusual activity, registration still offered</b> (O26-L-00014, sold and unregistered, its code scanned from 22 places within a minute, as copies would be). The server still offers registration when the history alone made the scan unusual, the piece has no owner and its certificate card carries a claim code: a hairline and <b>DO YOU HOLD THE CERTIFICATE CARD?</b> follow the help line (11 px, label tracking, display face), with one sentence and the OWNERSHIP panel: sign-in, then the claim code, required. Still no tabs and no product facts. If the scan's 15-minute window closes first, the section says to scan the code again and points to the page's one SCAN AGAIN; if too many claim codes have been tried for the piece, it says that registration is held for up to an hour and that ORBES Client Services can assist (THREAT-MODEL E). The section tells a visitor that the piece is unregistered and open for registration, an accepted disclosure (§4.1).</td>
</tr>
</table>

### THE CEREMONY AND THE SOUND (P-D01, P-D07)

**The ceremony of a first registration** (P-D01, `views/result.ts`). Once a piece is registered (REGISTER THIS PIECE, with or without the claim code, the certificate card's registration from an UNUSUAL ACTIVITY result included), VIEW AS OWNER verifies the code again and opens the result as its owner with the ceremony: the GENOME plate comes first, above the photographs; its eight glyphs appear one by one around the SEAL (§3.6), then, under a hairline inside the plate, the model's name (`--fs-heading`, display face, tracked 0.3 em, figures in the reading face) and its collection (10 px, `--ink-soft`); then **SHARE THE GENOME**, a text link, once its image is ready (§3.10); the phone vibrates `[18, 90, 18]` as the names rise. It appears only on an authentic result of the reader's own piece, with its GENOME and its model, and never after a piece received with a transfer code. With reduced motion, everything is simply there. Neither an edition rank nor a vintage is revealed (the plan's choice 6: the name and the collection). `genome/test/web/verify.e2e.test.ts` writes `out/verify-ceremony.png` and `out/verify-share-genome.png` for the design review.

**The sound signature** (P-D07, `verify/sound.ts`). As an AUTHENTIC result appears (the four `AUTHENTIC_*` states), one soft chord: a D major ninth in an open voicing (D4 A4 C♯5 E5), four sine voices struck 40 ms apart, each rising in 12 ms and fading to silence at about 0.9 s, composed in code (Web Audio, no sound file). Never on another result, nor in the background. On by default; SOUND OFF at the foot of the landing silences it on this device (§4.3). On an iPhone it follows the silent switch (`navigator.audioSession` set to `ambient`); elsewhere the page's own setting is the switch, since the web cannot read the phone's.

### MY PIECES (F-01)

`/verify/pieces`, the owner's écrin (`views/pieces.ts`, its view-model `pieces-model.ts`): the column of a result (560 px at most, 32 px margins, 22 px under 350 px), the small wordmark, the title MY PIECES in the display face at 24 px, tracked like a result's, and one sentence, *The pieces registered to your ORBES account.* Then each piece, newest acquisition first, separated by a hairline:

1. its **plate**, the GENOME specimen of a result (ivory, hairline brackets, 34 / 22 / 28 px), with the product id as the piece's heading, the eight glyphs in their orbit around the SEAL, and the fingerprint;
2. when ORBES holds them (F-04), the **photographs** of an authentic result (§5, the result screen): the piece's own, then its model's, on their own ivory plate 40 px under the GENOME's, each with its caption and its alternative text, then *Photographed by ORBES. Compare … with the piece in your hands.* Under the plate rather than above it, unlike the result: the GENOME plate carries the piece's heading, so the photographs belong to their piece for a screen reader too, and each plate is named after its piece (*Photographs of O26-J-00184*);
3. the product lines MODEL / TYPE / CATEGORY / MATERIAL / CREATED YYYY;
4. the tabs **OWNERSHIP · WARRANTY · SERVICE · CARE** (P-M02 added CARE; the four labels hold on one line like a result's), opening on OWNERSHIP: its status line (REGISTERED TO YOU, TRANSFER PENDING, IN SERVICE, REPORTED LOST, REPORTED STOLEN), rows, then REPORT LOST / STOLEN or PIECE FOUND, each confirmed in place under a section label (the confirmation's button is the hairline button, CANCEL a text link; PIECE FOUND asks for the account's PASSWORD first), or, for a theft or a loss ORBES Client Services recorded, and for a piece the owner cannot report (revoked, retired or flagged by ORBES: the list's `incidentReportable`), their contact; after each change the piece is read again from the server, so its status line is the server's (IN SERVICE again for a loss declared during a service); WARRANTY, the rows and sentence of a result; SERVICE, the service history, read when the tab is first opened; **CARE** (P-M02, §4.4): CARING FOR THIS PIECE, the model's care (else the general care text), then ORBES CARE, its sentence and its three lines as the tier's benefits are listed (the hairline list), then SUBSCRIBE (a text link, new tab, `rel="noopener noreferrer"`: the page keeps one hairline button) or *Subscriptions open soon.*

At the foot, the account line, SIGNED IN AS {email} · CHANGE PASSWORD · SIGN OUT, then SCAN ORBES CODE, the page's hairline button, then the legal pages as under a result (PRIVACY · TERMS · LEGAL · HELP and IP GEOLOCATION BY DB-IP, in a new tab, J-06): the page collects account data, signed out too. Under CREATE ACCOUNT, here as in the OWNERSHIP tab, the sentence *Creating an ORBES account means accepting the ORBES terms of use.*, then TERMS OF USE · PRIVACY POLICY, each in a new tab. Signed out, the OWNERSHIP tab's sign-in stands alone in place of the pieces (with FORGOTTEN PASSWORD?), so the owner of a piece that is gone reaches it without scanning the piece; that is why the landing offers MY PIECES signed out too. No piece: *No piece is registered to your ORBES account yet. Scan a piece, then register it from the OWNERSHIP tab of its result.* Keyboard focus goes to the title once the pieces are shown after a sign-in, to the section label of a confirmation, and to the status line once a report is made or withdrawn. The words LOST and STOLEN appear on this page only (§4.5).

<table>
<tr>
<td width="33%"><img src="assets/ui/verify-12-my-pieces.png" width="250" alt="MY PIECES: the small wordmark, the title and its sentence, then the first piece, O26-J-00199, its GENOME in its orbit on an ivory plate, and its product lines"></td>
<td valign="top" colspan="2"><b>MY PIECES</b> of the demo owner Camille Martin, signed in, its first screen: her newest acquisition, O26-J-00199, on its plate, then its product lines. Its tabs, her other pieces and the account line follow below.</td>
</tr>
</table>

Under the pieces, signed in, **YOUR RELEASES** (P-R03) lists the account's entries in the releases, when it has any: each release's title, a text link to its page, then its state and the entry's status on one line (ENTRIES OPEN · ENTERED, DRAWN · PLACE HELD, …), one sentence for what it means now (*Your place is held until 16 OCT 2026 · 10:05 UTC — ORBES Client Services will contact you.*), the entry's id as the draw publishes it (YOUR ENTRY, in lower case: the id is read and compared, never shouted), and for a place held the contact of ORBES Client Services. No email is sent: this is where an entrant learns the outcome. A place reserved directly during an early access (P-X02) reads PLACE RESERVED and *You reserved a place directly. It is held until … — ORBES Client Services will contact you.* THE RELEASES follows THE COLLECTION at the foot.

At the **head** of MY PIECES, signed in, **YOUR TIER** (P-X04, `tier-model.ts`, from `GET /api/v1/club/status`; `.pieces__tier`): the section label YOUR TIER, or THE CLUB for an account without a tier; then **the badge**, an ivory plate framed by hairline brackets (`.pieces__badge`), the tier's name in the display face (`.pieces__badge-name`, TITANE) over its pieces in the reading face (`.pieces__badge-pieces`, *3 pieces held*); the benefits of the tier and of those below it, a list in reading text; then **NEXT: PALLADIUM**, a section label, *2 more pieces registered to your account open PALLADIUM, from 5 pieces held. It adds:* and what it adds. At PALLADIUM: *PALLADIUM is the highest tier of the club.* Without a tier: *A piece registered to your ORBES account opens TITANE, the first tier of the club:* and its benefits. When the page lists more pieces than the tier counts, the note *A piece revoked or retired by ORBES counts for no tier.* (`.pieces__tier-note`). Under the pieces, signed in, for an account without a tier, **EARLY ACCESS** (P-X02, `.pieces__early`) recalls the privilege (*PLATINE and PALLADIUM owners reserve a place in each release directly, before it opens to everyone…*); from TITANE up, YOUR TIER already says it, among the account's own benefits (PLATINE, PALLADIUM) or under NEXT: PLATINE (TITANE), and the page does not say it twice. At the foot, for an owner of a piece, **THE CIRCLE** (P-X01), a text link to `/verify/circle`.

In the OWNERSHIP tab of a piece not reported lost or stolen, nor revoked or retired (the list's `certificateAllowed`, which names no status: the server would refuse the link), under REPORT LOST / STOLEN, the section **OWNERSHIP CERTIFICATE** (F-06, §4.4): CREATE CERTIFICATE opens the choice of the link's validity and CREATE LINK; the link then shows once on ivory, like a transfer code (`.certificate-link`, the address wrapping anywhere), with COPY LINK and OPEN LINK; under it, each open link on its line between hairlines, WITHDRAW at its end (4 px above and below, so its 44 px zone stays inside the line). Keyboard focus goes to the chosen validity when the choice opens, to COPY LINK once the link is made, and to the section's label after a withdrawal.

### LEGAL PAGES (J-06)

`/legal`, the third app (`genome/src/web/legal/`): the privacy policy (`/legal/privacy`), the terms of use (`/legal/terms`), the legal notice (`/legal/notice`) and the FAQ (`/legal/faq`), in French and English, and their index (`/legal`). One reading column, 640 px at most, 32 px margins (22 px under 350 px): the small wordmark, the four pages (PRIVACY · TERMS · LEGAL · HELP; CONFIDENTIALITÉ · CONDITIONS · MENTIONS LÉGALES · AIDE), spaced without dots because the French row wraps on a phone, the current one at full ink and underlined; ENGLISH · FRANÇAIS, each in its own language, for the same page and section in the other (the section the address names when it is followed: an anchor inside the page, `#cookies`, moves it); the title, the version line (VERSION OF 3 OCTOBER 2026, `LEGAL_VERSION`), then the sections between hairlines, each heading an anchor (`/legal/faq#transfer`). At the foot, VERIFY A PIECE, IP GEOLOCATION BY DB-IP and © ORBES · GENOME CODE · PARIS. Titles, headings and links are in the display face in both languages (§3.1). The language is `?lang=`, else the browser's, and is the page's `<html lang>`; every link between the pages keeps it, and French punctuation takes a narrow no-break space (« … », : ; ? !).

The text is a small Markdown the page builds with `textContent` only (a paragraph, a list, a clause's lead set apart, a link to a legal page, an anchor or an https address, anything else read as words). Where a page names ORBES Client Services' contact (the publisher, the privacy policy's controller), it shows the one the server publishes, its email and phone as links; nothing configured, nothing shows. Every text link keeps the floors of §3.8; a link inside a sentence is an underlined word, exempt as WCAG 2.5.8 allows. In print (`@media print`) the page is the text alone: no navigation, language or grain, black on white, the address of a link outside the site written after it. The pages hold no field to complete in sight: until ORBES gives its legal identity, they read "ORBES". Their words are held to the lexicon (§4.5, in English and in French) by `genome/test/web/legal.content.test.ts`, which also holds the terms and the notice to their drafts (`docs/legal`), and the privacy policy and the FAQ to the code.

<table>
<tr>
<td width="33%"><img src="assets/ui/legal-01-faq.png" width="250" alt="The FAQ in English on a phone: the small wordmark, PRIVACY TERMS LEGAL HELP with HELP underlined, ENGLISH · FRANÇAIS, FREQUENTLY ASKED QUESTIONS, VERSION OF 3 OCTOBER 2026, the lead, then WHAT DOES A RESULT PROVE?"></td>
<td valign="top" colspan="2"><b>The FAQ</b> (<code>/legal/faq</code>, in English, the browser's language), its first screen on a phone: the four pages, HELP current; ENGLISH · FRANÇAIS; the title on two lines and the version line; the lead, then the first section between hairlines, its heading in the display face over reading text in Helvetica Neue.</td>
</tr>
</table>

### OWNERSHIP CERTIFICATE (F-06)

`/verify/c#…`, the page a buyer or an insurer opens from the link an owner shared (`views/certificate.ts`, its view-model `certificate-model.ts`): no sign-in, the column of a result and of MY PIECES, the small wordmark, the title OWNERSHIP CERTIFICATE set like MY PIECES (display face, 24 px, tracked), its state under it in the display face, 11 px, `--ink-soft` (VALID, NO LONGER VALID, NOT FOUND), and one sentence. When it holds:

1. the piece in **the écrin of MY PIECES** (`.piece__plate`: the GENOME plate of a result, ivory, hairline brackets, the product id as heading, the glyphs in their orbit, the fingerprint), restyled by no rule of its own;
2. the product lines (the last, *DISCONTINUED · 2027*, once its model is discontinued, P-R06);
3. THE RECORD and THIS CERTIFICATE, section labels over label/value rows (§4.4);
4. *A certificate names no owner…*, in `--ink-soft`;
5. DOWNLOAD PDF, the page's hairline button, then SCAN ORBES CODE, a text link, and VERIFY ONLY AT THEORBES.COM/VERIFY, 10 px in the display face.

No longer valid or not found: the sentence alone, then SCAN ORBES CODE as the hairline button. The token stays in the address's fragment and is sent in the body of a request only. The PDF (`render/certificate.ts`) is one A4 page in the lettering of the certificate card: ORBES and the monogram, OWNERSHIP CERTIFICATE, the GENOME in its orbit on an ivory plate (#F6F2EA, ink #111111, as on screen), THE PIECE (with a DISCONTINUED row, the year, under CREATED once its model is discontinued, P-R06) and THE RECORD in two columns, THIS CERTIFICATE (VALID ON 3 OCTOBER 2026 · 12:34 UTC, ISSUED, VALID UNTIL), what it attests and what it does not, CHECK IT LIVE with its address and its code in groups of four (also a link; typed as printed, capitals and hyphens included, it opens the certificate, API §8.7), and VERIFY ONLY AT THEORBES.COM/VERIFY. Never AUTHENTIC, never a name. The label lettering gains `:` and `#` for it.

<table>
<tr>
<td width="33%"><img src="assets/ui/verify-13-ownership-certificate.png" width="250" alt="OWNERSHIP CERTIFICATE, VALID, its sentence, O26-J-00199 on its ivory plate, the product lines, THE RECORD and THIS CERTIFICATE rows, A certificate names no owner, DOWNLOAD PDF, SCAN ORBES CODE, VERIFY ONLY AT THEORBES.COM/VERIFY"></td>
<td valign="top" colspan="2"><b>A certificate of the demo owner's piece</b> (O26-J-00199, 90 days), opened by a visitor from its link without an account (full page): VALID, the écrin of MY PIECES, the product lines, THE RECORD (OWNERSHIP VERIFIED, the warranty, LOSS OR THEFT NONE REPORTED) and THIS CERTIFICATE (CHECKED, ISSUED, VALID UNTIL), the sentence that it names no owner, then DOWNLOAD PDF, SCAN ORBES CODE and VERIFY ONLY AT THEORBES.COM/VERIFY.</td>
</tr>
</table>

### THE COLLECTION (P-R02)

`/verify/lookbook`, the lookbook of the models (`views/lookbook.ts`, its view-model `lookbook-model.ts`): the column of a result and of MY PIECES (560 px at most, 32 px margins, 22 px under 350 px), the small wordmark, the title THE COLLECTION in the display face at 24 px, tracked like MY PIECES, and one sentence, *The models of ORBES, as the maison presents them.* Then the models the console made PUBLIC, grouped by collection (its name over its models, 11 px, tracked, the display face, its figures in the reading face; the models without one last, under no heading), two to a row (one under 360 px, a lone card centred at a column's width), each on **an ivory plate** framed by hairline brackets like the GENOME's: its photograph, contained in its square and never cropped (lazily loaded: a grid may hold many), its name and type in the display face, and **SEE THE MODEL**, the card's one text link (the card itself is no control: §3.8, the pointer is the controls'). Signed in with a piece, an owner also sees, after a hairline, **THE PRIVATE SALON** (P-X08; it replaced RESERVED FOR OWNERS) and its sentence, *Pieces offered to the owners of an ORBES piece, by tier, on request.*, over the reserved models the owner's tier reaches, each card with its price in the reading face (`.lookbook-card__price`, 10 px, under the type); anyone else sees nothing of it, and is told nothing. At the foot, SCAN ORBES CODE, the page's hairline button, then the legal pages.

`/verify/lookbook/<slug>`, **a model's sheet**: the collection (9 px, tracked, `--ink-soft`), the model's name as the title (24 px, display face, figures in the reading face), its type under it (and · THE PRIVATE SALON on a sheet the club opened, then · DISCONTINUED · 2027 once its model is discontinued, P-R06); its photographs on an ivory plate framed by brackets, the cover (the reference photograph) across the plate, then the gallery two by two, each contained, with its alternative text (the operator's, else *The MONOLITHE RING model, photographed by ORBES*); **THE STORY**, plain paragraphs in `.prose` (no Markdown: the words as typed, `shared/lookbook.ts`, the console's preview drawing them the same way); **SPECIFICATIONS**, label/value rows (a label never holds a figure: it is set in the display face); **CARE**, the model's care or the general care text; on a sheet of the salon, **THE PRIVATE SALON** (P-X08, §4.4): PRICE and OFFERED FROM rows, its sentence, the field A NOTE FOR ORBES CLIENT SERVICES and **REQUEST THIS PIECE**, the sheet's one hairline button, then, once requested, REQUESTED, *ORBES Client Services will contact you.* and their contact. At the foot, THE COLLECTION, back to the grid, then the legal pages. An address that leads nowhere (a model not shown, or reserved for owners and read signed out, or above the reader's tier) says *This model is not in the ORBES collection.* Every photograph at `/api/v1/media/…` is public, a reserved model's too: RESERVED means unlisted, not confidential.

### THE RELEASES (P-R03)

`/verify/releases`, the releases ORBES announces (`views/releases.ts`, its view-model `releases-model.ts`): the column of THE COLLECTION, the small wordmark, the title THE RELEASES in the display face at 24 px, and one sentence, *Pieces released in a limited number, by draw or LIVE RELEASE, with your ORBES account: ORBES Client Services concludes each sale.* Then each release, the latest opening first, on **an ivory plate** framed by hairline brackets, one to a row: its model's photograph, contained in its square; its state (ENTRIES OPEN SOON, ENTRIES OPEN, ENTRIES CLOSED, DRAWN, CANCELLED, 9 px, tracked, `--ink-soft`); its title; its model and type; its pieces and the time that matters now, in UTC (`3 PIECES · ENTRIES CLOSE 14 OCT 2026 · 10:00 UTC`, the figures in the reading face); and **SEE THE RELEASE**, the plate's one text link. At the foot, SCAN ORBES CODE, THE COLLECTION, then the legal pages.

`/verify/releases/<id>`, **a release's page**: the model's collection, the title, the state; the model's photograph on an ivory plate; the description, plain paragraphs. **THE RELEASE**: the model (SEE THE MODEL beside it when its sheet is public), the pieces, ENTRIES OPEN and ENTRIES CLOSE each said twice, in UTC as the rule counts them, then on the phone's own clock with its offset (*12 OCT 2026 · 13:00 on this phone (UTC+03:00)*), and PLACE HELD, its hours. **YOUR ENTRY**: signed out, the OWNERSHIP panel's sign-in and CREATE ACCOUNT under *Any account may enter, one entry per person*; signed in, one sentence for the entry's state, ENTER THE DRAW (the page's hairline button while it is offered; the foot's SCAN ORBES CODE is then a text link, as on a certificate) or WITHDRAW (a text link), the entry's id, and for a place held *Your place is held until … — ORBES Client Services will contact you.* with their contact. **THE DRAW**: its rule, word for word as the server applies it; *A place drawn obliges you to nothing: ORBES Client Services concludes each sale with you, and sends no email.*; the commitment's sentence; SEED FINGERPRINT, the SHA-256 in groups of four, in the reading face; once drawn, SEED, then the check made on the phone (*Checked on this phone: the SHA-256 of the seed is the fingerprint published with the release.*), then **THE ENTRIES** by rank, one per line between hairlines (`4 · PLATINE · 1 YEAR`, then the entry's id in lower case), the reader's own marked YOURS, a hundred at a time (SHOW MORE). An address that leads nowhere says *This release is not known to ORBES.* The words are DRAW and a place held, never lottery (§4.5).

**The early access** (P-X02). During it, a release's state reads **EARLY ACCESS**, followed by **EVERY PIECE RESERVED** once every piece is held by a direct reservation; under the state of a release that offers one, *PLATINE AND PALLADIUM: FROM 10 OCT 2026 · 10:00 UTC · EVERYONE: FROM 12 OCT 2026 · 10:00 UTC* (`.release__access`: 9 px, tracked, in the reading face, `--ink-soft`, on the list's plates and on the page). THE RELEASE gains the rows **EARLY ACCESS** (its opening, in UTC then on this phone) and **RESERVED DIRECTLY** (`2 OF 50 PIECES`), and a paragraph: *Before entries open to everyone, PLATINE and PALLADIUM owners reserve a place directly, first come, first served, within the pieces of the release: their tier is the one their account holds when they reserve. The pieces left then go to the draw.* In YOUR ENTRY, a PLATINE or PALLADIUM account reads *As a PLATINE owner, you may reserve a place now, until entries open to everyone on …* and **RESERVE A PLACE**, the page's single hairline button while it is offered (`.btn`; the foot's SCAN ORBES CODE is then a text link); its reservation then reads **PLACE RESERVED**. Before the early access it reads when it may reserve; any other account reads *PLATINE and PALLADIUM owners are reserving their places now. Entries open to everyone on …*, and no button. A full release says *Every piece of this release has been reserved…*: the draw then ranks a waiting list.

### THE CIRCLE (P-X01)

`/verify/circle`, what ORBES publishes for the owners of a piece (`views/circle.ts`, its view-model `circle-model.ts`), reached from MY PIECES: the column of THE RELEASES, the small wordmark, the title THE CIRCLE in the display face at 24 px, and one sentence, *For the owners of an ORBES piece: the news of the maison, its invitations and its questions.* Above the feed, **EARLY ACCESS** recalls the privilege of PLATINE and PALLADIUM owners in the releases (P-X02, `.circle__early`: *PLATINE and PALLADIUM owners reserve a place in each release directly, before it opens to everyone…*). Then **the feed**, the latest first, each post on **an ivory plate** framed by hairline brackets, one to a row: its first photograph, contained; its kind (NOTE, INVITATION, POLL; with · PLATINE AND PALLADIUM or · PALLADIUM for a post kept for the higher tiers), 9 px, tracked, `--ink-soft`; its title; its publication day; an invitation's event in UTC (`12 OCT 2026 · 19:00 UTC · PARIS`); what the reader did (*YOU ANSWERED YES*, *YOU VOTED*); and its one text link, **READ THE NOTE**, **SEE THE INVITATION** or **SEE THE POLL**. **SHOW MORE** reads the next page (20 posts a page). At the foot, SCAN ORBES CODE, the page's hairline button, THE RELEASES · THE COLLECTION · MY PIECES, then the legal pages. Signed out, the OWNERSHIP panel's sign-in under *The circle is reserved for the owners of an ORBES piece. Sign in with your ORBES account.*; signed in without a piece, *The circle is reserved for the owners of an ORBES piece. It opens once a piece is registered to your ORBES account.*, and nothing else.

`/verify/circle/<id>`, **a post**: its kind and tiers over its title, its day under it; its photographs on an ivory plate framed by brackets (`.circle-post__plate`), the first across the plate, the others two by two, the last one alone on its row centred at a column's width, each contained, with its alternative text (the operator's, else *<title>, photographed by ORBES*), the first loaded at once, the others lazily; its text, plain paragraphs (`shared/lookbook.ts`). **THE INVITATION**: the rows WHEN (in UTC, then on this phone's clock), WHERE and PLACES (`12 LEFT OF 40`, or `NONE LEFT OF 40`); then **YOUR ANSWER**, its sentence (*Will you come? Answer YES or NO: you may change your answer until the event begins.*) and **YES · NO**, pressed options of the sign-in (`.auth__option`), each widened to a 44 px zone as LOST is in MY PIECES; *The event has begun: answers are closed.* once it has. **THE POLL**: *One vote per account, and it is final. The results show once you have voted.*, its options one under the other, each an `.auth__option` 20 px from the next so their 44 px zones stay apart, then **VOTE**, the page's hairline button while it is offered (a vote is final; the foot's SCAN ORBES CODE is then a text link); once voted, *Your vote is counted. The results so far:* and one line per option, its votes in the reading face, the reader's own marked **YOUR VOTE**. **TO SEE**: **SEE THE RELEASE**, **SEE THE MODEL**, and **OPEN THE LINK**, with its host beside it in the reading face (`youtube.com`), opened in a new tab (`rel="noopener noreferrer"`). At the foot, THE CIRCLE, back to the feed. An address that leads nowhere, a post kept for a higher tier included, says *This post is not in the circle.* No word of §4.5, no exclamation mark (`genome/test/web/verify.circle.test.ts`).

### THE LIVE RELEASE (plan of 2026-10-04): the vault

A LIVE RELEASE (`/verify/releases/<id>`, `views/live.ts`, its logic `live-model.ts`) is lived in **the vault** (choice 10, the mockups' B VAULT: B1 to B6, one per screen, and B7, the flow played through): ivory on ink under an overhead light (§3.2), every screen of it but CONFIRMED (ivory, choice 22) and the banner (the house's ink strip). The column of a result (440 px at most, 32 px margins); Gravesend for titles and labels, wide tracked; Helvetica Neue for reading and **every digit**, thin and tabular for the countdowns and the place. One primary action per screen, filled ivory with ink text (PAY, the selected size); the others are ivory text links; 44 px taps. Its words are the plan's: LIVE RELEASE, OPENS IN, THE ROOM IS OPEN, LIVE NOW, I'LL BE THERE, READY CHECK, ENTER THE ROOM, PRESS AND HOLD THE SEAL, PAY · € 5 050, RELEASE MY PLACE, A PIECE HAS RETURNED; never an edition number (the mockups' `07 / 25` is not built), never a word of §4.5.

**The seal** of the vault is a **specimen of the ORBES CODE** (`live-seal.ts`), drawn in ivory by the core renderer from a fixed payload that is no piece's code (its bytes are not a valid code); the screens call it THE SEAL, the lock of the door and the object one holds. The legal texts say *the ORBES CODE of the room* (§2.1: the code is never "the seal" there).

The moments, in order:

1. **Announced** (B1): the piece by stage, the photograph, else the uploaded silhouette, else the seal, on a plate; its name, or TO BE REVEALED; the price (`€ 4 800`, the figures in the reading face); from the photograph's stage, when the model is PUBLIC in THE COLLECTION, **SEE THE MODEL** under the price, a text link in the vault's ivory to its sheet; OPENS IN as days, or hours, minutes and seconds; the times in Paris, and again on this phone when its zone differs; the rule (*FOR OWNERS FROM PLATINE*), the quantity line and the limit per collector; **THE REVEALS**, the stages still to come and their times, never what they show; ADD TO CALENDAR; how the places are drawn; **I'LL BE THERE** with a size, and *428 COLLECTORS WILL BE THERE*. In THE RELEASES the LIVE cards come first, on the vault's plate.
2. **The room** (B2): the model, its price and the quantity line (SEE THE MODEL under them, as announced, until T0: the opening is the piece's alone); a closed **vault door**, two leaves with hairline seams, the seal at their junction as its lock (CSS, no image); the countdown on ORBES time (a three-sample clock sync); *214 IN THE ROOM*; **READY CHECK** (signed in · access · size · connection · clock, `SYNCED TO ORBES`); the size picker (the I'LL BE THERE size preselected; a quantity when the release allows more than one), ENTER THE ROOM, then the size changeable until T0 and LEAVE THE ROOM; the latest host message under the header. In **the last minute** the lock's orbits turn back into alignment, one step a second; each of the last ten seconds ticks softly (`sound.ts` TICK: E6, 80 ms, softer than one voice of the chord), within SOUND ON / OFF.
3. **T0**: the lock clicks into alignment and **the door opens** at the same server second on every phone; the piece appears under the **light sweep**; DRAWING THE PLACES.
4. **The line** (B3): YOUR PLACE in large thin digits; who is ahead in your size; the pieces left overall and in your size; *N HELD PIECES MAY RETURN*; a meter of the pieces, one cell each (a bar above 50).
5. **Your turn** (B4): PRESS AND HOLD THE SEAL: the outer ring counts the turn (30 s by default), the inner fills in 1.5 s; Space or Enter hold it from a keyboard; the phone vibrates where it can (not on iPhone); A PIECE HAS RETURNED when the turn came from a returned piece.
6. **Secured** (B5): the reveal (the glyphs with P-D01's motion, the glow, the chord, a vibration), then the model, the size and the price; the add-ons, each with its price; **PAY · total**; the time to confirm (5:00 by default); RELEASE MY PLACE, asking for a second tap.
7. **Confirmed** (B6), *out into the light*: the page turns ivory: *Your piece is reserved in size 52.*, the add-ons, the reference (`LR-…`), ORBES Client Services' contact, and MY PIECES, where the entry stays.
8. **Edge pages**, each a quiet vault page with one action: not signed in (SIGN IN TO ENTER, with the sign-in), not eligible (the rule and why), turn passed, hold ended, place released, left the line, removed, sold out in your size (stay for a returned piece, or leave), the release ended before your turn, the release over. A pause and a host message show under the header; during a pause the seal is disabled and the turn's ring stops.

**The banner** (`views/live-banner.ts`) is the house's one-line ink strip, on the landing and MY PIECES: *LIVE RELEASE · <name once revealed> · OPENS IN hh:mm:ss*, then THE ROOM IS OPEN, then LIVE NOW; hidden at the end. **The boutique board** (`/verify/releases/<id>/board#<secret>`, `views/board.ts`) is the vault in landscape, full screen: the countdown, the door (its lock turning in the last minute, opening at T0 on the piece), the pieces left overall with a meter, LIVE, FULL SCREEN; never a person, a room count, a size or a host message; THIS BOARD IS NOT AVAILABLE without its secret.

**Accessibility.** AA contrast on every screen (computed and measured, §3.2); the place (its figure read as *Your place 4*), the turn, the reveal and a reset seal announced through `aria-live`; the keyboard hold; the keyboard's focus ringed in ivory outside every control, a filled one included (the size chosen before ENTER keeps its inner outline as the choice, its focus ringed apart); reduced motion as §3.6 says. `test/web/verify.live.e2e.test.ts` and `verify.live-announce.e2e.test.ts` (Chromium, a phone) check every screen for contrast, one primary action, no figure in the display face and the floors of §3.8, and the focus ring of each filled control reached from the keyboard (3 : 1 at least on the ground around it).

**The screens** (`scripts/capture-ui.ts --only live`, the phone of verify at 390 px, the board at 1 280 × 720, the console at 1 440 × 900; MONOLITHE's photograph and the silhouette are studio drawings the script makes, standing in for ORBES's own; a piece without a photograph shows the seal):

<table>
<tr>
<td width="25%"><img src="assets/ui/live-01-banner.png" width="190" alt="The landing of /verify under the banner, an ink strip: LIVE RELEASE · MONOLITHE · OPENS IN 02:14:09"></td>
<td width="25%"><img src="assets/ui/live-02-releases.png" width="190" alt="THE RELEASES: its sentence, the tabs LIVE and PAST with LIVE selected, then the LIVE RELEASE cards on the vault's plates: the room open, a release announced with its photograph, price, quantity line, rule and I'LL BE THERE count, and one at its silhouette's stage, TO BE REVEALED, with THE REVEALS still to come"></td>
<td width="25%"><img src="assets/ui/live-03-announced-silhouette.png" width="190" alt="B1, announced at the silhouette's stage: the backlit silhouette on its plate, TO BE REVEALED, € 5 050, OPENS IN as days, hours and minutes, the time in Paris, FOR OWNERS, 18 PIECES · ONE PER COLLECTOR, THE REVEALS with the name's and the photograph's times, I'LL BE THERE"></td>
<td width="25%"><img src="assets/ui/live-04-announced.png" width="190" alt="B1, announced, the name and the photograph revealed: MONOLITHE photographed on its plate, RING · ORBITAL, € 5 050, OPENS IN as hours, minutes and seconds, FOR OWNERS FROM PLATINE, 25 PIECES · ONE PER COLLECTOR, 5 COLLECTORS WILL BE THERE, size 52 chosen, I'LL BE THERE filled ivory, ADD TO CALENDAR"></td>
</tr>
<tr>
<td width="25%"><img src="assets/ui/live-05-room.png" width="190" alt="B2, the room: the host message, THE ROOM IS OPEN, MONOLITHE, € 5 050 · 25 PIECES, the closed vault door with the seal as its lock, the countdown 02:07, 6 IN THE ROOM, READY CHECK all ready, YOUR SIZE with 52 outlined, ENTER THE ROOM filled ivory"></td>
<td width="25%"><img src="assets/ui/live-06-last-minute.png" width="190" alt="The last minute, entered: the lock's orbits half way back into alignment, 00:31 until the opening on the minute, 7 IN THE ROOM, READY CHECK, size 52 chosen in ivory, YOU'RE READY, LEAVE THE ROOM"></td>
<td colspan="2"><img src="assets/ui/live-07-board.png" width="390" alt="The boutique board, landscape, in the last minute: the closed door and its seal on the left; THE ROOM IS OPEN, MONOLITHE, 25 PIECES, UNTIL THE OPENING 00 : 00 : 29, 25 OF 25 LEFT with its meter, the opening in Paris; LIVE and FULL SCREEN"></td>
</tr>
<tr>
<td width="25%"><img src="assets/ui/live-08-door-opening.png" width="190" alt="T0, its motion held at 0.48 s: LIVE NOW, the door's leaves sliding out, the lock gone, the photographed piece coming into the light, DRAWING THE PLACES"></td>
<td width="25%"><img src="assets/ui/live-09-line.png" width="190" alt="B3, the line: YOUR PLACE 6 in thin digits, YOU ARE NEXT IN SIZE 52, the meter of 25 pieces, 19 OF 25 LEFT · 0 IN SIZE 52, 4 HELD PIECES MAY RETURN"></td>
<td width="25%"><img src="assets/ui/live-10-turn.png" width="190" alt="B4, the turn at half its time, the seal held: HOLD, PRESS AND HOLD THE SEAL, the turn's ring half run out, the hold's ring half filled, 00:15 TO SECURE YOUR PIECE, MONOLITHE · SIZE 52 · € 5 050"></td>
<td width="25%"><img src="assets/ui/live-11-secured.png" width="190" alt="B5, secured: YOUR PIECE, the seal, SECURED AT, MONOLITHE, ORBITAL · SIZE 52, the add-ons ENGRAVING and ORBES CARE chosen, GIFT BOX, PAY · € 5 320 filled ivory, 04:56 TO CONFIRM, RELEASE MY PLACE"></td>
</tr>
<tr>
<td width="25%"><img src="assets/ui/live-12-confirmed.png" width="190" alt="B6, CONFIRMED in the ivory of the house: LIVE RELEASE · MONOLITHE, Your piece is reserved in size 52, the receipt with the engraving, ORBES Care, the total € 5 320 and the reference LR-…, MY PIECES"></td>
<td width="25%"><img src="assets/ui/live-13-edge-sign-in.png" width="190" alt="Not signed in: SIGN IN TO ENTER, The room is open to owners. Sign in, or create an account., the sign-in"></td>
<td width="25%"><img src="assets/ui/live-14-edge-not-eligible.png" width="190" alt="Not eligible: FOR OWNERS, the rule and why"></td>
<td width="25%"><img src="assets/ui/live-15-edge-turn-passed.png" width="190" alt="YOUR TURN HAS PASSED, The piece went to the next collector in line., THE RELEASES"></td>
</tr>
<tr>
<td width="25%"><img src="assets/ui/live-16-edge-hold-ended.png" width="190" alt="YOUR HOLD HAS ENDED, The piece has returned to the line for the next collector., THE RELEASES"></td>
<td width="25%"><img src="assets/ui/live-17-edge-released.png" width="190" alt="YOUR PLACE IS RELEASED, THE RELEASES"></td>
<td width="25%"><img src="assets/ui/live-18-edge-left.png" width="190" alt="YOU LEFT THE LINE, THE RELEASES"></td>
<td width="25%"><img src="assets/ui/live-19-edge-removed.png" width="190" alt="YOUR ENTRY IS REMOVED, ORBES Client Services can assist you, THE RELEASES"></td>
</tr>
<tr>
<td width="25%"><img src="assets/ui/live-20-edge-sold-out.png" width="190" alt="SOLD OUT IN SIZE 52, YOUR PLACE 7, You keep your place should ORBES add one, or you may leave, LEAVE THE LINE"></td>
<td width="25%"><img src="assets/ui/live-21-edge-ended.png" width="190" alt="THE RELEASE HAS CLOSED, Its time has run out before your turn came., then the question after: ONE QUESTION, WHAT WOULD YOU HAVE WANTED?, its three answers, until when it may be changed, THE RELEASES"></td>
<td width="25%"><img src="assets/ui/live-22-edge-over.png" width="190" alt="A release over, in its final state for a collector who never entered it (decision 30): LIVE RELEASE, MONOLITHE photographed on its plate, RING · ORBITAL, THIS RELEASE IS OVER, its date and 1 PIECE, THE RELEASES; no end figure"></td>
<td width="25%"><img src="assets/ui/live-23-console-board.png" width="190" alt="The console's live board while the line runs: LIVE, the eight counters (5 in the room, 1 in line, 3 turns, 1 secured, 2 confirmed, 19 pieces left), the host message, the sizes with their forecast and ADD PIECES, the controls PAUSE, EXTEND, MESSAGE and END NOW"></td>
</tr>
<tr>
<td width="25%"><img src="assets/ui/live-24-console-settings.png" width="190" alt="The console's page of a release announced tomorrow, whole: its board scheduled, the release planner, the audience forecast and the release comparison with how each is read, the best time to open, the publication, then its settings, each with EDIT: the release, sizes and the quantity line 25 PIECES · NEVER MORE, access, the surprise, the question after, the times of each stage, turns and holds with PALLADIUM's 10 minutes to pay, the add-ons, the after-room, the silhouette and the boutique board's link"></td>
<td colspan="3"></td>
</tr>
</table>

### LIVE RELEASE+ (plan of 2026-10-04): PAST, the after-room, the question after, the orders

No new direction: each screen follows the vault (a LIVE RELEASE's pages, above) or the house's ivory (THE RELEASES, MY PIECES), the display face for titles and labels, the reading face for every date, figure and sentence (§3.1).

- **THE RELEASES, LIVE and PAST.** Two tabs head the page (`views/tabs.ts`: keyboard and screen-reader tabs, 44 px tap zones), LIVE first; the tab shown is kept in the history entry, so going back from a release opened from PAST returns to PAST. PAST loads when first shown, twelve cards at a time with **SHOW MORE** (the focus moving to the first new card), each on an ivory plate: the photograph, the kind (LIVE RELEASE or DRAW), the name, the opening date on the phone's calendar and the quantity line as announced. Signed in, *You have taken part in N releases.* heads the tab and **YOU SECURED A PIECE** or **YOU TOOK PART** marks each card concerned. **No end figure** anywhere: no pieces sold, no entries counted, no reason of the end.
- **A past release's page** (decision 30) is a vault screen of its own: the piece, its name and line, SEE THE MODEL, **THIS RELEASE IS OVER**, the date and the quantity line, the account's part, the description, and one action, THE RELEASES. A drawn draw's page says THIS RELEASE IS OVER too, and keeps its ranked list and its seed.
- **The after-room** (A3). When its door opens, the guest's page turns to a second door in the same vault: **THE AFTER-ROOM · A SECOND DOOR**, the door with the seal as its lock, OPEN UNTIL and the one action **ENTER THE AFTER-ROOM**, announced through `aria-live`; its own pages carry THE AFTER-ROOM above the usual screens, its price and quantity line under the model's name (as the room says them; a late entry's page in the room does too), *You keep your place from the line*, and its CONFIRMED reads THE AFTER-ROOM · the model. MY PIECES lists its entry as THE AFTER-ROOM.
- **The surprise** (A4) is one vault label, **A SURPRISE IN EVERY BOX**, on the announced page and in the room; never what it is.
- **The rules of access in words** (A5, N5): *FOR COLLECTORS WHO HAVE TAKEN PART IN 3 RELEASES*, *FOR SELECTED COLLECTORS* (a segment's name never), joined by *or* when any one is enough; a refusal adds *You have taken part in 2 releases.*, or reads only *This release is for selected collectors.*
- **The question after** (G4), one shared block (`views/question.ts`): the label **ONE QUESTION**, the question in the display face, its answers pressed like the sign-in's switch (`aria-pressed`, a group named by the question), the choice changeable while it is open; in the vault on a release's final page, in ivory in MY PIECES under **AFTER THE RELEASES**.
- **YOUR ORDERS** in MY PIECES (choice 6, M6), under the pieces: each order a card headed by its model, where it was sold (LIVE RELEASE, DRAW or THE PRIVATE SALON and the release), one sentence for its step, then the **step track** RESERVED · PAID · SHIPPED · DELIVERED, each step reached dated on the phone's calendar, the current one `aria-current`, the steps to come hollow and undated (CANCELLED or RETURNED close the track with their date); rows SIZE, PRICE, each add-on and TOTAL, or TO BE CONFIRMED; once shipped, CARRIER, TRACKING NUMBER and **TRACK THE SHIPMENT**, a text link that opens the carrier's page apart; the reference ORDER OR-…. **DOCUMENTS** are text links, so the page keeps its one hairline button: INVOICE and CREDIT NOTE with their numbers in the reading face (PDFs), CARE GUIDE (opening under the links), OWNERSHIP CERTIFICATE once the piece is registered to the account.
- **Printed documents**, black on white in the house's print style (§7): the atelier's work sheet with the ORBES CODE at 30 mm, the packing slip without a price, the invoice and credit note (one A4 page, stroked lettering, the monogram, no VAT line), and the ownership certificate of an order, the F-06 document read at its download, naming the order and carrying no link: never the claim card.

**The screens** (`scripts/capture-ui.ts --only plus`, in the order of the flow: the phone of verify at 390 px, the console at 1 440 × 900, the printed documents at A4; §9):

<table>
<tr>
<td width="25%"><img src="assets/ui/plus-01-releases-live.png" width="190" alt="THE RELEASES on LIVE, signed in: its sentence, the tabs LIVE and PAST with LIVE selected, then the vault's plates: the room open for the selected collectors (MONOLITHE, its hour in Paris, € 5 050 · 12 PIECES · ONE PER COLLECTOR, FOR SELECTED COLLECTORS) and LIVE V announced for 19:00 Paris, its rules in balanced lines"></td>
<td width="25%"><img src="assets/ui/plus-02-releases-past.png" width="190" alt="THE RELEASES on PAST: You have taken part in 4 releases., then each release ended, newest first, on its ivory plate with its photograph, kind, name, date and quantity line, marked YOU SECURED A PIECE or YOU TOOK PART; the draw last, its place confirmed: YOU SECURED A PIECE; no end figure"></td>
<td width="25%"><img src="assets/ui/plus-03-past-release.png" width="190" alt="A past release opened from PAST (decision 30): LIVE RELEASE, MONOLITHE photographed, RING · ORBITAL, THIS RELEASE IS OVER, 29 SEP 2026 · 4 PIECES, YOU SECURED A PIECE, THE RELEASES"></td>
<td width="25%"><img src="assets/ui/plus-04-announced-rules.png" width="190" alt="A release announced: MONOLITHE photographed, € 5 050, OPENS IN as days, hours and minutes, FOR COLLECTORS WHO HAVE TAKEN PART IN 3 RELEASES OR SELECTED COLLECTORS, 25 PIECES · ONE PER COLLECTOR, A SURPRISE IN EVERY BOX between two hairlines, size 52 chosen, I'LL BE THERE filled ivory"></td>
</tr>
<tr>
<td width="25%"><img src="assets/ui/plus-05-not-eligible-count.png" width="190" alt="The same release for a collector it does not admit: the rule in words, then This release is for collectors who have taken part in 3 releases or selected collectors. You have taken part in 1 release., and no size to choose"></td>
<td width="25%"><img src="assets/ui/plus-06-not-eligible-selected.png" width="190" alt="A room open to a segment, for anyone outside it: MONOLITHE, FOR SELECTED COLLECTORS, This release is for selected collectors., THE RELEASES; the segment's name never said"></td>
<td width="25%"><img src="assets/ui/plus-07-after-room-door.png" width="190" alt="The second door, a minute after the sell-out: THE AFTER-ROOM, A SECOND DOOR, the vault door and its seal, the sentence for those still in the line, OPEN UNTIL with its time, ENTER THE AFTER-ROOM filled ivory"></td>
<td width="25%"><img src="assets/ui/plus-08-after-room-join.png" width="190" alt="The after-room's page: THE AFTER-ROOM, ORBITE, € 1 900 · 4 PIECES, A SURPRISE IN EVERY BOX, the seal on its plate, 4 OF 4 LEFT, You keep your place from the line, sizes 52 (chosen) and 54, ENTER THE LINE"></td>
</tr>
<tr>
<td width="25%"><img src="assets/ui/plus-09-after-room-turn.png" width="190" alt="The after-room's turn, first of its guests as she was next in the line: HOLD, PRESS AND HOLD THE SEAL, the turn's ring half run out, the hold's ring filling, 00:15 TO SECURE YOUR PIECE, ORBITE · SIZE 52 · € 1 900, Let go too early and the seal resets."></td>
<td width="25%"><img src="assets/ui/plus-10-after-room-confirmed.png" width="190" alt="CONFIRMED in ivory, THE AFTER-ROOM · ORBITE, the receipt: reserved at, size 52, GIFT BOX € 90, TOTAL € 1 990, the reference LR-…, MY PIECES"></td>
<td width="25%"><img src="assets/ui/plus-11-question-after.png" width="190" alt="The final page of a release the collector took part in without a piece: THIS RELEASE IS OVER, YOU TOOK PART, then ONE QUESTION, WHAT WOULD YOU HAVE WANTED?, ANOTHER SIZE, ANOTHER FINISH, ANOTHER PRICE BAND, until when the answer may change"></td>
<td width="25%"><img src="assets/ui/plus-12-your-orders.png" width="190" alt="MY PIECES, YOUR ORDERS, one at each step: the after-room's ORBITE RESERVED, size, price, GIFT BOX, total, CARE GUIDE; the private salon's ORBITE SHIPPED, its steps dated, CHRONOPOST and its tracking number, TRACK THE SHIPMENT, its invoice; LIVE I's MONOLITHE DELIVERED with ENGRAVING, COLISSIMO, its invoice and OWNERSHIP CERTIFICATE; the draw's MONOLITHE PAID, ORBES preparing it"></td>
</tr>
<tr>
<td width="25%"><img src="assets/ui/plus-13-order-documents.png" width="190" alt="An order's DOCUMENTS in MY PIECES, set on the left edge under their title: INVOICE INV-2026-000001 (its number in the reading face), CARE GUIDE, OWNERSHIP CERTIFICATE once the piece is registered, the model's care guide opened under the links, then the reference ORDER OR-…"></td>
<td width="25%"><img src="assets/ui/plus-14-after-the-releases.png" width="190" alt="MY PIECES, AFTER THE RELEASES: You said you would be there. One question about each release, for a week after it., the release and its date, WHAT WOULD YOU HAVE WANTED? and its three answers"></td>
<td width="25%"><img src="assets/ui/plus-15-console-orders.png" width="190" alt="The console's Orders: the filters, 10 orders · 2 late and the delays, then the board by step: RESERVED with two cards marked LATE · NOT PAID, PAID (the draw's piece being made, one in stock), SHIPPED by Chronopost, DELIVERED by Colissimo, CANCELLED, RETURNED; each card its reference, channel, release in balanced lines, model and size, collector, add-ons, surprise, what it holds and its time in the step"></td>
<td width="25%"><img src="assets/ui/plus-16-console-order.png" width="190" alt="An order delivered: its four steps dated over a week, then ORDER (release, collector, model, size, price, add-ons, engraving, surprise), BUYER, PIECE registered by its buyer, SHIPMENT with its declared value, DOCUMENTS with the invoice and its PDF, and its HISTORY by step and by whom; PACKING SLIP and OPEN A RETURN"></td>
</tr>
<tr>
<td width="25%"><img src="assets/ui/plus-17-console-atelier.png" width="190" alt="The Atelier: the pieces to make by release, private salon and draw, model and size, on the same columns from one group to the next: each reserved reference, step, order, where it goes, add-ons, engraving and surprise, since when; then the stock per size at FRANCE and LOGISTICS WAREHOUSE, on hand, reserved, available, being made, the minimum, a suggestion TO MAKE 2 with MAKE over TRANSFER, CORRECT and MINIMUM"></td>
<td width="25%"><img src="assets/ui/plus-18-console-invoices.png" width="190" alt="Invoices: the month's totals invoiced, credited and net, then October 2026's five invoices and its credit note, each with its order, buyer, total, the invoice it cancels or that cancels it, and its PDF"></td>
<td width="25%"><img src="assets/ui/plus-19-console-segments.png" width="190" alt="Segments: each saved group of collectors with its rules in words, how many collectors it holds now, what uses it and when it changed; NEW SEGMENT"></td>
<td width="25%"><img src="assets/ui/plus-20-console-segment.png" width="190" alt="A segment's page: its name, every rule (ALL), the tier now PLATINE or PALLADIUM, active in the last 30 days, the live count 5 COLLECTORS, SAVE and MEMBERS (CSV), and the three releases whose access rule it is"></td>
</tr>
<tr>
<td width="25%"><img src="assets/ui/plus-21-console-settings.png" width="190" alt="Settings: the late orders' delays (2, 3, 10 and 30 days), the locations FRANCE WAREHOUSE (default) and LOGISTICS WAREHOUSE, the carriers Chronopost, Colissimo, DHL Express and UPS with their tracking links"></td>
<td width="25%"><img src="assets/ui/plus-22-console-client.png" width="190" alt="The client sheet of helene.morel@example.com: account and tier, pieces, her four orders with their steps, the releases taken part in and pieces secured, the answer to the question after, I'LL BE THERE and DID NOT COME, the segments, the notes of ORBES Client Services, transfers and verifications"></td>
<td width="25%"><img src="assets/ui/plus-23-console-catalogue-export.png" width="190" alt="The Catalogue's SHOPIFY PRODUCT EXPORT: what the file holds, the store's currency, 1 model priced in EUR and the 10 left out, each a draft product; CANCEL and DOWNLOAD"></td>
<td width="25%"><img src="assets/ui/plus-24-console-release-settings.png" width="190" alt="The parts of LIVE VI, a draft, each with EDIT: the release, its sizes at LOGISTICS WAREHOUSE, ACCESS (2 releases or the segment, any one rule is enough: OR), the SURPRISE kept internal, the QUESTION AFTER rewritten, the times, turns and holds, the add-ons, the AFTER-ROOM (ORBITE, € 1 900, 52 × 4 · 54 × 4, GIFT BOX, 10 min after the sell-out, open 15 min), the silhouette and the boutique board"></td>
</tr>
<tr>
<td width="25%"><img src="assets/ui/plus-25-console-best-time.png" width="190" alt="BEST TIME TO OPEN on LIVE VI's page: the suggested hour in Paris time and its share of the activity, its T0 at 19:00, the 24 hours as hairline columns (in ink the suggestion, outlined its T0, dotted the hours past releases opened at), the hours by tier with past releases' presence, the countries with their busiest hour named in full, how it is read"></td>
<td width="25%"><img src="assets/ui/plus-26-console-feasibility.png" width="190" alt="PUBLISH THE RELEASE on LIVE VI: its announcement and opening, then STOCK, the feasibility check: 19 pieces on sale would be made to order once sold (LOGISTICS WAREHOUSE), a warning for each size the stock leaves short (52, 54 and the after-room's two), size 50 covered and unsaid, It does not block publishing.; Post it in the circle, CANCEL, PUBLISH"></td>
<td width="25%"><img src="assets/ui/plus-27-work-sheet.png" width="190" alt="A work sheet as printed: ORBES, WORK SHEET, the piece's ORBES code at 30 mm and its reference O26-J-…, then model, size, SKU, add-ons, the engraving A. & L., the surprise, the order it is for, where it goes, since when; the printing's line"></td>
<td width="25%"><img src="assets/ui/plus-28-packing-slip.png" width="190" alt="A packing slip as printed: ORBES, PACKING SLIP, the order, reservation and date, FOR the buyer's name and address, IN THIS BOX the piece, its reference, size, add-ons, the engraving H. M. and the surprise; no price"></td>
</tr>
<tr>
<td width="25%"><img src="assets/ui/plus-29-invoice.png" width="190" alt="The invoice INV-2026-000001, one A4 page in stroked lettering: ORBES INVOICE and the monogram, number, date, order and currency, ISSUED BY CONGLOMERAT LLC, BILLED TO the buyer, MONOLITHE · SIZE 52 and ENGRAVING with their amounts, TOTAL EUR 5 200.00; no VAT line"></td>
<td width="25%"><img src="assets/ui/plus-30-certificate.png" width="190" alt="The ownership certificate of an order: OWNERSHIP CERTIFICATE, the piece's GENOME on its ivory plate, THE PIECE and THE RECORD, VALID ON its date and the ORDER it was bought with, its three sentences, no link and never the claim card"></td>
<td colspan="2"></td>
</tr>
</table>

---

## 6. The GENOME console

The console is an internal instrument in the house style, not a SaaS dashboard: white and ivory paper, black ink, tracked uppercase, 1 px hairlines and an architectural grid; no cards, shadows, gradients or charts beyond hairline bars and the hairline curves of Analytics (principle 12).

**Principles, as implemented**

1. **Monochrome by default; oxblood means act now.** `#8A1C1C` appears only for CRITICAL anomalies, INVALID SIGNATURE verification events, a stored code that no longer verifies, a broken audit chain, a missing signing key, errors and destructive actions. Everything else is told by five status marks (§3.5).
2. **Monospace only for identifiers and hashes**, with the full value as a tooltip.
3. **One time zone.** Every date is UTC and says so (`01 OCT 2026 · 10:57 UTC`); the top bar carries an INTERNAL tag and a clock updated every 30 s.
4. **Irreversible means typed.** Destructive actions open a dialog marked by a 3 px oxblood top rule, with a danger confirm; the irreversible ones also require a typed phrase (e.g. `REVOKE KEY 3`) before the confirm button activates. A dialog whose boxes add such an action takes the rule, the danger confirm and the phrase while they ask for it: the anomaly decision marks itself when it revokes the code (`REVOKE ISSUE 1`) or flags the piece COUNTERFEIT, as the product page does for the same actions. Issuance says *"Signing is irreversible: the identity and serial are consumed."*
5. **Secrets are shown once.** The claim code appears once on an ivory, bracketed panel with COPY, DOWNLOAD CERTIFICATE CARD (the card of §7, checked against the hash by the server) and *"I have recorded it — hide"*, which removes all three; only its scrypt hash is stored. A re-issued code is kept in memory only and forgotten at sign-out. A customer's recovery code (Owners, ADMIN, after an identity check) takes the same panel, with COPY and *"Given to the client — hide"*; the account's row then reads *Recovery code open until …* (and *Recovery attempts throttled until …* once 5 wrong guesses have spent the code), and after the recovery *Transfers paused until …*. A batch's claim codes are in its results table, under the same ivory panel with the card format, DOWNLOAD CERTIFICATE CARDS, DOWNLOAD RESULTS (CSV) and *"I have recorded them — hide"*; until one is saved or the codes hidden, leaving the page asks first (*Leave this page?*, STAY / LEAVE). The temporary password of a new staff account (Team page) takes the same panel, with COPY and *"I have handed it over — hide"*.
6. **Roles shape the interface.** Controls a role cannot use are not shown (RETAIL sells, AUDITOR reads, OPERATOR mutates, ADMIN for keys, revocation, reinstatement, categories (created, deactivated, activated), the Team page, the points of sale and a customer's recovery code). The Team page offers nothing on one's own row but the reset of one's own second factor. A staff account signed in with its temporary password sees one screen, NEW PASSWORD, until it has chosen its own; its hint and the Team page's panel say to type the temporary password exactly as shown, capitals and dashes included. CHANGE PASSWORD sits at the foot of the sidebar under SECURITY and SIGN OUT, for every role, except on NEW PASSWORD, which is the change itself; the sidebar's rhythm (5 px link padding, 10 px above a group and 4 px under it) keeps the ADMIN's, the longest (eighteen links once Cases, Analytics, Points of sale and Sale mode joined it), within a 1 440 × 900 screen, SIGN OUT and CHANGE PASSWORD in view without scrolling it (checked by `genome/test/web/admin.e2e.test.ts`).
7. **Everything is recorded, and the console says so.** "Every download is recorded in the audit log"; "Internal use only · All actions are recorded" on the sign-in screen.
8. **The console may see what the public never does**: risk scores, genome checks, payload hashes, anomaly rules. None of it ever reaches `/verify`.
9. **Customers are heard where staff look.** A customer's answer to WHERE DID YOU SEE OR BUY THIS PIECE? opens a case in **Cases** (Activity, after Anomalies): where they saw or bought the piece, their note, the scan's REF, result and anomaly, the piece, OPEN first. Every case links to its scan, its anomaly and its piece; Verification events and Anomalies carry a REPORT / REPORTS column that links back, with where the customer saw the piece and their note (in Anomalies, the latest case's); a finding's detail lists its *Cases* and marks each reported scan of its timeline (*Customer report:* where, and the case's status), each linked to the queue. An OPERATOR closes a case with a note (who and when stay on it); the customer's words never enter the audit log.
10. **Print files are vector by default.** Width 30 mm, 600 dpi, decor on, label off; the cell pitch is shown as the width changes (`CELL PITCH 0.60 MM`).
11. **A catalogue change reaches every result, and says so first.** A model's name, care instructions and collection, and a collection's name, are read live by the result of every piece issued with them: the Edit and Rename dialogs of the Catalogue open with *"Touches N issued pieces"* (a model's collection only on the pieces without their own), and the model's shows its care block **as the client reads it**: the CARE tab over its hairline, the words in `.prose`, or the general care text of /verify when there are none (one text, `shared/care.ts`). A model's category and SKU prefix are not fields. Deactivating or activating a category changes no result: its dialog says so first, with the count of its issued pieces (*"Its N issued pieces keep verifying as before: no public result changes."*). An inactive model or category reads INACTIVE (grey mark) and the generator stops offering it.
12. **Trends are hairlines too.** Analytics (`#/analytics`, A-09) reads the daily scan statistics of the last 30 or 90 complete days on one page: four figures; every scan per day as one 1.5 px ink curve on 1 px hairlines, its ceiling (1, 2 or 5 × 10ⁿ) and half labelled, five days below, and a cursor (pointer, or the arrow keys once the curve has focus) whose readout gives the day's count first, then each state seen that day, and opens 16 px beside the cursor on the side where the plot has room, over the cursor inside the plot when neither side has (a phone, a day near the middle), clear of the day's point, so the page never scrolls sideways (every day of 90 checked at 390 px in Chromium by `genome/test/web/admin.e2e.test.ts`); one small curve per verification state, each scaled to its busiest day, in ink, oxblood for INVALID SIGNATURE only, `--metal` for MALFORMED CODE, a lone baseline for a state without scans; the countries with the most scans and those of the counterfeit signals as the dashboard's hairline bars (oxblood where a signature did not verify), then the signals country by country and the days with scans as tables. No map, no fill, no legend box: a single curve is named by its panel title. Every label is HTML in Helvetica Neue beside an SVG that stretches without stretching its strokes (`vector-effect: non-scaling-stroke`); the SVG has no style attribute (CSP), and what moves is placed by CSS custom properties set through the CSSOM (`--x`, `--y`), as the bars' `--f`.
13. **The sale mode is a phone at the counter** (A-08, `#/sale`). It has its own frame, the sale shell: the typed word ORBES and GENOME CONSOLE on an ivory bar at the top, with CONSOLE beside them for the roles that read the registry (no monogram: like the verification app's scanner, a scanning screen keeps the small word alone, §3.9), the view, and the account at the foot (email, role, SECURITY, CHANGE PASSWORD, SIGN OUT); full width with a 16 px gutter on a phone, a 560 px column between hairlines on a desk. A seller (RETAIL) only ever sees this frame: the sale mode, its own password and second factor. The screen reads top to bottom: POINT OF SALE (remembered on the phone), SCAN THE PIECE (the camera under a white orbit, the outside veiled in 50 % ink as on `/verify`), then the piece: a status mark (READY TO SELL; ALREADY SOLD when its warranty has started or a client account holds it; WARRANTY VOID; NOT FOR SALE; or the verification state in its tone), the product id in Helvetica Neue, the model and the material on two tracked lines, one sentence that states only what the lookup proved (§4.1: *Signed by ORBES and in its registry; its warranty has not started.*), and ACTIVATE WARRANTY, the one hairline button. Done, WARRANTY ACTIVE gives the dates and the point of sale, and an ivory bracketed panel, TELL THE CLIENT, with the sentence the seller says: *Register your piece with its card at theorbes.com/verify.*, and the seller's own note beneath it: *Hand over the certificate card: with the claim code under its scratch-off panel, they register the piece in their name.* (the claim code proves the card is in hand, not who owns the piece: §4.1, §4.6) Every control there is at least 44 px high (48 px buttons and fields), and read at a phone's distance: buttons and field labels at the 10 px floor (`--fs-micro`, §3.1, §3.8) instead of the console's 8 px, and every field (the point of sale, the new password, the second-factor code) at 16 px (`--fs-input`), so iOS Safari does not zoom into it when it is focused; the console's sign-in sets its fields at 16 px too below 600 px, the width at which a seller opens it (checked at 390 px in `test/web/admin.e2e.test.ts`).
14. **A photograph reaches every authentic result, and says so first** (F-04). A model's reference photograph is set from its row in the Catalogue (**Photo**), the photograph of a piece at issuance on the generator's result (*Add a photo of this piece*) and later on its product page, which shows both, the piece's and its model's, as square thumbnails on ivory, contained. The dialog opens with what the photograph reaches (*Shown at once on the N issued pieces of this model above the GENOME…*), shows the photograph as it will be sent with its size (*To be sent: 2 000 × 1 333 PX · 312 KB*: the console re-encodes it through a canvas to 2 000 px at most, as a JPEG, which drops its EXIF and its location), and removes the one in place through a box that marks the dialog destructive. OPERATOR, like every catalogue change; every change audited.
15. **A model's sheet is previewed as the client reads it** (P-R02). Lookbook, on a model's row of the Catalogue (and for every role that reads it), opens the model's page (`#/catalogue/:modelId`, under the Catalogue in the sidebar, no link of its own): PUBLICATION (its place, Hidden, Public or Reserved, with its status mark; its address, `/verify/lookbook/<slug>`, proposed from its name and fixed once first published, which the dialog says before; the day it was first published), STORY and SPECIFICATIONS, each **as the client reads it** under AS THE CLIENT READS IT (the sheet's section label, then the paragraphs in `.prose`, or the rows), their dialogs drawing the same preview at every keystroke, since a hidden model's sheet is not public, and refusing a label with a figure before anything is sent, as the server would; then GALLERY: the cover apart (the reference photograph, set with Photo on the row), then up to eight photographs, each added through the photograph dialog of principle 14, moved EARLIER or LATER, given its ALT TEXT, or REMOVED through a dialog that marks itself destructive. The Catalogue's LOOKBOOK column gives each model's place. OPERATOR edits, an AUDITOR reads; every change audited (a story as its length and hash).
16. **A draw is run in the open** (P-R03). **Club**, the one link of the Clients group added by the « Potentiel » plan (`#/club`, its tabs `?tab=`, Drops first), lists the releases with their state, window of entries (UTC), pieces, entries and places held or sold; **New release** (OPERATOR) creates a draft whose seed is drawn and committed at once, the dialog says so. A release's page (`#/club/drops/:dropId`) leads with one line of what its state asks of the staff now, then its facts, the fingerprint of its seed (mono, as every hash) and its address on /verify once published, then, once drawn, its seed. Edit (a draft), Description (once published), Publish and Cancel are an OPERATOR's; **Run the draw** is ADMIN's, behind a dialog marked destructive that says how many entries take part and what the draw does, and asks for the phrase `DRAW` and the first eight characters of the id (`CANCEL …` for a cancellation, principle 4). Its entries follow, by rank once drawn, with the email masked for an AUDITOR, the tier and seniority of the draw, the status and until when a place is held: Confirm on a place held, Lapse only once its time has passed, Offer next while places are left. Every action is audited. The early access (P-X02): the dialog's *Early access (hours)* (48 by default, 0 for none), the page's *Early access 48 hours · from 10 OCT 2026 · 10:00 UTC* (or *None*) and *Reserved directly 3 of 50*, and each direct reservation marked RESERVED DIRECTLY in place of its rank.
17. **The circle and the tiers are the Club's other tabs** (P-X01, P-X04). **Circle** lists the posts with their kind, the tiers that read them, their state and what they gathered; **New note**, **New invitation** and **New poll** (OPERATOR, capability `manageCircle`) open the dialog of their kind. A post's page (`#/club/circle/:postId`) shows its fields and its address on /verify once published, its text as a member reads it, its photographs (up to four, through the photograph dialog: Earlier, Later, Alt text, Remove), the answers to an invitation (YES and NO, the places left, each account with its email masked for an AUDITOR) and the results of a poll, as hairline bars; Edit, Publish and Withdraw are an OPERATOR's. **Tiers** shows one panel per tier: *Reached* (1, 3 or 5 pieces, a constant of the code), its *Benefits* as MY PIECES lists them, and its *Words*, *Default* or *Edited* with the time; **Edit benefits** and **Restore default** are an OPERATOR's (capability `manageClubTiers`). The owner's sheet reads the account's *Tier*. Analytics ends with the panel **The Circle**: the members of the club by tier now, as hairline bars, and the visits of the circle per day over the window, as a table; counts only, never an account.
18. **A discontinued model says so, with its year** (P-R06). On a model's row of the Catalogue, the STATUS mark reads ACTIVE (solid), INACTIVE or **DISCONTINUED** (muted), the year in the mark's title (*Discontinued in 2027*). An ADMIN's row offers **Discontinue**, which opens a dialog marked destructive (the danger dialog) that says what its pieces keep (*Its 184 issued pieces keep verifying as before.*), what /verify says of them (*… say DISCONTINUED · 2027.*), that no new piece can be issued with it and the generator stops offering it, and that an ADMIN can reinstate it, then asks for the phrase `DISCONTINUE <SKU prefix>`; a discontinued model offers **Reinstate** instead, a plain dialog with the phrase `REINSTATE <SKU prefix>` (capability `discontinueModel`, ADMIN; principle 4). The Edit dialog of a discontinued model has no Status field: *Discontinued: it stays inactive until an ADMIN reinstates it.*
19. **The private salon is set on the model's page, its requests read on the Club** (P-X08). The Lookbook page of a model (principle 15) gains a **Private salon** section: *Price* (*None shown*, or the words the salon shows) and *Shown from* (TITANE, PLATINE or PALLADIUM), with one sentence on what THE PRIVATE SALON is; **Edit** (OPERATOR) opens a dialog of the price (at most 60 characters: *As the salon shows it: € 4 800, or Price on request. Empty: no price shown.*) and the tier. The Club's fourth tab, **Requests** (`#/club?tab=requests`), lists what owners requested, OPEN first: *Requested*, *Client* (the email, masked for an AUDITOR, a link to the owner's sheet), *Model* (its type and price, the client's note under it in `--ink-soft`), *Status* (OPEN as an alert mark, CLOSED muted, with who closed it, when and the note); the filter *Status* (All, Open, Closed); **Close** (OPERATOR, capability `closeShopRequest`) opens a dialog that shows the client's note and asks for the note of what was done, required. The owner's lock dialog names the requests it closes.
20. **A LIVE RELEASE is run from its live board** (plan of 2026-10-04). The Drops tab lists the **Live releases** above the draws, with **New live release** (OPERATOR); a release's page (`#/club/live/:dropId`, no link of its own in the sidebar) holds its **live board**, on its own stream (polled every 5 s while it is lost): eight counters, the table per size with ADD PIECES and, beside it, the reminder of what the quantity line promised (choice 36), the host message, then **Pause** / **Resume**, **Extend**, **Message** (OPERATOR) and **End now** (ADMIN, a typed phrase, `END <8 characters>`); the entries (LET IN, FREE, REMOVE, the last ADMIN's); since LIVE RELEASE+, a link to the release's **orders** on the Orders board (principle 21), which retired the LIVE plan's Client Services list; the publication and the settings, each part in its own dialog, everything editable until the announcement. The intelligence's panels follow the release's stage, each ending with **How it is read**, the rule and its figures in the server's words; the live alerts read **LINE STALLED**, **MISSED TURNS** and **SIZE SOLD OUT**, never "alert" (§4.5). Labels never hold a figure (*Opening*, not *T0*).
21. **Every order is followed by its step, and a late one stands out** (LIVE RELEASE+, choices 6, 7, 19). **Orders** (Clients, `#/orders`) is a board of six columns, RESERVED, PAID, SHIPPED, DELIVERED, CANCELLED and RETURNED, each with its count and how many of its orders are late; a card gives the channel (LIVE, DRAW, THE PRIVATE SALON), the release, the collector (masked for an AUDITOR), the model and size, the add-ons, the surprise, whether an engraving is entered, what it holds and how long it has stood in its step; a late card (the delays of **Settings**, ADMIN) takes the alert mark (the tilted square, its words in bold): LATE · NOT PAID, LATE · NOT SHIPPED, LATE · NOT DELIVERED or LATE · NOT REGISTERED, with the rule it passed in its title. An order's page leads with its step strip and what its step waits for, then its terms, **The buyer** (masked `J*** D***` for an AUDITOR), the piece, the shipment, its **Documents** and its history; **Mark paid**, **Ship**, **Mark delivered**, **Cancel** and **Open a return** are an OPERATOR's, a cancellation needing its note; a return to the archive retires the piece, so it is offered to an ADMIN only, behind the typed phrase `ARCHIVE` (principle 4). A new claim code after a return is shown once, as at issuance (principle 5).
22. **The atelier makes what the orders and the stock need** (LIVE RELEASE+, choices 8, 14, 15). **Atelier** (Registry, `#/atelier`) shows the stock per SKU and location in hairline rows (on hand, reserved, available, being made, the minimum and what it suggests), then the pieces to make by release, private salon and stock, each TO MAKE, IN PROGRESS or DONE; **Start** and **Done** are an OPERATOR's, **Done** asking for the material, the batch and the production date before it issues the reserved identity, and showing its claim code once. **Print work sheets** opens one A4 page per piece in the house's print style (§7): the reference and its ORBES CODE drawn at 30 mm, black on white, with the model, size, SKU, add-ons, engraving, surprise, who it is for and where it goes; the packing slip of an order (**Packing slip**) prints the piece, its size, its add-ons and the surprise, in English, never a price nor a declared value.
23. **Invoices are documents, never payments** (LIVE RELEASE+, choice 22). **Invoices** (Clients, `#/invoices`) lists a month's invoices and credit notes as CONGLOMERAT LLC issued them, their numbers in mono (principle 2), the month's totals per currency (invoiced, credited, net), each document's **PDF** and **Download the month (CSV)** for the accountant; nothing on the page issues or changes a document. The PDF is one A4 page, black on white, in the certificate's stroked lettering with the monogram, and has no VAT line.
24. **Segments are rules, read in words** (LIVE RELEASE+, choices 26, 27). **Segments** (Clients, `#/segments`) lists the saved groups with their members now and what uses them; the builder writes each rule in words beside its live count (*Collectors now*), the groups ALL or ANY, a rule negated as *Does not match*; an AUDITOR reads, the members' CSV masked. A release's **Access** part and a post's audience choose a segment by its name, which the public never reads (*Said FOR SELECTED COLLECTORS*). The client sheet of an owner (`#/owners/:id`) gathers its orders and their steps, the releases it took part in and the pieces it secured, its answers, its interest and its segments, never the buyer's details nor an engraving's words. The Catalogue's **Price · Shopify** column and its **Shopify export** belong here too: files, never a call to Shopify.

![Console dashboard: ivory sidebar, KPI figures, hairline bars by status and by severity, signing key](assets/ui/admin-01-dashboard.png)

*Dashboard, 1 440 × 900.* Four figures in 46 px light numerals separated by hairlines; products by lifecycle status and open anomalies by severity as 3 px ink bars on a 1 px track (zero rows recede to `--ink-soft`); the signing key in force; recent verification events below the fold.

![Console product page for O26-J-00184: GENOME on its orbit around the seal on an ivory plate, fact sheet with status marks](assets/ui/admin-02-product.png)

*Product page, O26-J-00184.* The GENOME on its orbit around the SEAL, on an ivory plate framed by brackets, with fingerprint and glyph ids; the fact sheet (spec §22) with a status mark per line. The SIGNATURE line is a live re-verification of the stored code, not a stored flag.

![Generator result: issued identity O26-J-00200, hidden claim code, GENOME and signed code facts, code preview and print options](assets/ui/admin-03-generator-result.png)

*Generator result (full page).* The issued identity, the claim code panel after *hide*, the GENOME and the signed-code facts, and the print panel: the code preview rendered in the browser from the signed data with the same encoder as print, width, theme (CLASSIC — BLACK ON WHITE, INVERTED — WHITE ON BLACK, IVORY — INK ON IVORY), resolution, label, decor, *Test print* and K-only black (PDF) options, the size advice under 30 mm, SVG / PNG / PDF.

![Cases: two OPEN cases, PRIVATE SALE in Barcelona and ONLINE on a marketplace listing, each with the customer's note, its scan and result, its anomaly, its piece, a status mark and CLOSE](assets/ui/admin-04-cases.png)

*Cases, 1 440 × 900* (principle 9). The demo customers' two answers to WHERE DID YOU SEE OR BUY THIS PIECE?, OPEN first: where, with the customer's note under it in `--ink-soft`; the scan's REF over its result, the anomaly over its severity and status, the piece, the status mark and CLOSE.

![Analytics over the last 30 days: four figures, scans by day as one hairline curve, one small curve per verification state, the countries and the counterfeit signals as hairline bars, then two tables](assets/ui/admin-05-analytics.png)

*Analytics, LAST 30 DAYS (full page)* (principle 12). The demo dataset's daily statistics: SCANS, AUTHENTIC, COUNTERFEIT SIGNALS and COUNTRIES; SCANS BY DAY, its ceiling and five days labelled; BY RESULT, a lone baseline for a state without scans, the INVALID SIGNATURE mark in oxblood; COUNTRIES and COUNTERFEIT SIGNALS BY COUNTRY as hairline bars; SIGNALS BY COUNTRY AND RESULT and DAYS WITH SCANS as tables.

![Owner sheet of camille.martin@example.com: RECOVERY CODE, LOCK ACCOUNT and EXPORT DATA, the account rows, then her pieces with their status marks](assets/ui/admin-06-owner.png)

*Owner sheet, Camille Martin (A-06), as an ADMIN reads it.* The email as title; RECOVERY CODE, LOCK ACCOUNT (oxblood, destructive) and EXPORT DATA; ACCOUNT (status, email, name, country, since, account id); PIECES, owned now and ever, each with its model, material, status mark and how and when it was acquired. Her transfers in progress and her 20 latest scans follow below the fold.

![Team: three console users, an OPERATOR on its temporary password, a RETAIL seller and the signed-in ADMIN, with ROLE, SESSIONS and DISABLE](assets/ui/admin-07-team.png)

*Team, 1 440 × 900* (ADMIN, principle 6). NEW STAFF ACCOUNT; each console user with its role, second factor and state (TEMPORARY PASSWORD until its first sign-in), then ROLE, SESSIONS and DISABLE (oxblood); one's own row, marked *You*, without them. The two staff accounts are made by the capture script through the auth service (§9): the demo dataset has none.

<table>
<tr>
<td width="33%"><img src="assets/ui/admin-08-sale.png" width="250" alt="Sale mode on a phone: ORBES GENOME CONSOLE on an ivory bar, SALE MODE, POINT OF SALE ORBES PARIS — SAINT-HONORÉ, READY TO SELL for O26-J-00187 with its model and material lines, STATUS ISSUED, WARRANTY NOT STARTED, CLIENT ACCOUNT not registered yet, ACTIVATE WARRANTY, SCAN ANOTHER, and the seller's account at the foot"></td>
<td valign="top" colspan="2"><b>Sale mode, on the seller's phone</b> (principle 13; 390 × 844 at 2×, full page). A RETAIL seller signed in, in the sale shell; ORBES PARIS — SAINT-HONORÉ chosen; the in-stock O26-J-00187 read from a photo through the sale mode's photo input: READY TO SELL, the product id, the model and the material on two tracked lines, STATUS, WARRANTY and CLIENT ACCOUNT, the one sentence, ACTIVATE WARRANTY, SCAN ANOTHER and how long the scan stays valid; the seller's email, RETAIL, SECURITY, CHANGE PASSWORD and SIGN OUT at the foot. The warranty is not started.</td>
</tr>
</table>

---

## 7. Artifact specimens

All specimens are generated, never drawn by hand: the code samples by `genome/scripts/render-samples.ts` (a fully valid CODE-01 for the sample identity `O26-J-00184`, genome `G1-E1DC-BE52`, signed with the public sample key of [`vectors/code01-sample.json`](vectors/code01-sample.json)); the vocabulary by `genome/scripts/genome-symbol-study.ts`; the test kit by `genome/scripts/test-sheets.ts`.

<table>
<tr>
<td align="center"><img src="assets/orbes-code-sample.svg" width="220" alt="ORBES CODE-01 sample, classic: black on white"><br><code>orbes-code-sample.svg</code><br>classic · #0A0A0A on #FFFFFF</td>
<td align="center"><img src="assets/orbes-code-sample-inverted.svg" width="220" alt="ORBES CODE-01 sample, inverted: white on black"><br><code>orbes-code-sample-inverted.svg</code><br>inverted · #FFFFFF on #0A0A0A</td>
<td align="center"><img src="assets/orbes-code-sample-ivory.svg" width="220" alt="ORBES CODE-01 sample, ivory: soft black on ivory"><br><code>orbes-code-sample-ivory.svg</code><br>ivory · #111111 on #F6F2EA</td>
</tr>
</table>

<p align="center"><img src="assets/genome-01-vocabulary.svg" width="420" alt="GENOME-01 glyph vocabulary: sixteen orbital glyphs with names and 4-bit values"><br><code>genome-01-vocabulary.svg</code> — the sixteen GENOME-01 glyphs with their names and values.</p>

**Certificate card** (the card delivered with a piece; it carries the claim code), generated by `genome/scripts/certificate-specimen.ts` with the renderer the console uses (`genome/src/server/render/certificate.ts`, [API §15.7](API.md#157-post-apiadmincertificates-extension-of-the-contract)). Specimen piece `O26-J-00184` with an invented claim code.

<table>
<tr>
<td align="center"><img src="assets/certificate-card-specimen.svg" width="340" alt="ORBES certificate card specimen as delivered: ORBES and CERTIFICATE with the PROOF mention, the monogram at the top right, identity, GENOME row, model, material, three steps, claim code under a grey scratch-off panel"><br><code>certificate-card-specimen.svg</code><br>as delivered · claim code under the panel</td>
<td align="center"><img src="assets/certificate-card-specimen-revealed.svg" width="340" alt="The same certificate card with the scratch-off panel removed, showing the claim code 7KQ2-M4TD-9XWH"><br><code>certificate-card-specimen-revealed.svg</code><br>panel scratched off</td>
</tr>
</table>

The production file of the same card is [`assets/certificate-card-specimen.pdf`](assets/certificate-card-specimen.pdf): it carries the spot plate and the overprint that the SVG previews can only suggest.

**Status: PROOF.** The layout awaits the brand's validation (§8, item 20). Until then every card reads *PROOF · LAYOUT NOT VALIDATED*, and sheet captions, document titles and file names say PROOF: no card is final. On the brand's sign-off, `CERTIFICATE_LAYOUT_STATUS` becomes `VALIDATED` and the specimens are regenerated.

| Element | Rule |
|---|---|
| Format | 85 × 55 mm white card, no bleed; nothing within 4.5 mm of the trim. Print runs: A4 sheets of ten (2 × 5, abutting, 11 mm top and bottom margins), cut on shared edges, cut marks outside the grid only, a caption and a 10 mm scale bar. |
| Lettering | The print label's stroked geometric capitals (`label-font.ts`), no font, K 100 %, strokes never under 0.1 mm. ORBES at 2.2 mm cap height and 0.9 tracking, CERTIFICATE under it at 1.2 mm with the PROOF mention after it on the same line; the identity at 3.0 mm; values at 1.3 mm, shrunk to 1.0 mm then cut with "..." when too long; labels and steps at 1.0–1.2 mm. Free text loses its accents (the lettering has none). |
| Monogram | The brand's monogram (§3.9) as a flat K 100 fill of its five master outlines: 14.4 × 11 mm against the right margin, from the cap line of ORBES (6.4 mm) down to the identity's baseline (17.4 mm), at least 3 mm from the next mark. Its finest hairlines print at 0.077 mm, under the lettering's floor: the print proof decides (§3.9). |
| GENOME | The row presentation of the identity's eight glyphs at 2.6 mm (above the 2.1 mm floor of §2.6), its first glyph aligned with the text, the fingerprint beside it. |
| Claim code | `XXXX-XXXX-XXXX` at 1.75 mm cap height (down to 1.4 mm for the widest codes), centred in the panel. In the file only as paths, never as text. |
| Scratch-off panel | 32 × 6.8 mm, 1 mm corner radius, spot colour **ORBES SCRATCH-OFF** (its own plate; viewers show it as K 35 %), set to overprint so the code beneath stays whole on the black plate. |
| Copy | CERTIFICATE · MODEL · MATERIAL · GENOME · *1 OPEN THEORBES.COM/VERIFY · 2 SCAN THE ORBES CODE · 3 REGISTER WITH THE CLAIM CODE* · CLAIM CODE · *VERIFY ONLY AT THEORBES.COM/VERIFY*. |
| Never | The ORBES CODE (a photograph of the card must not verify), a QR code, the claim code on the piece itself (§2.10). |

The card's words are those of the [packaging kit](launch/PACKAGING-KIT.md), §2, which also proposes the fixed verso (how to use the claim code, the second-hand sentence). The kit's test checks its three steps against `CERTIFICATE_COPY`, so card and packaging say the same thing.

Physical test kit: [`assets/test-sheets/orbes-code-test-sheets.pdf`](assets/test-sheets/orbes-code-test-sheets.pdf), with one SVG per page. Seven renditions (black on white, white on black, ivory, matte grey 92 %, textured paper, black leather, metallic), each at 10–50 mm on cut-out tags with crop marks, a results table and a 10 mm scale bar. Every tag is labelled `SAMPLE - NOT VALID` and verifies as INVALID SIGNATURE in production, which still proves the scanner read it.

---

## 8. Deviations to resolve

Places where the implementation departs from this system or from itself. None affects decoding or security.

1. **One word, one emblem.** **Resolved for the screens (`/verify` and the console, 2026-10-02):** the brand supplied its master vector artwork, which is a monogram (§3.9), and decided: the word ORBES is typed, the monogram is the emblem beside it. The screens now have one rendering of the word, the shared `.wordmark` in Gravesend Sans (§3.1, item 18; the console sidebar uses the same spec at 15 px since 2026-10-01), and one emblem, drawn from the master's paths on the tab icons, the `/verify` landing and the console's sign-in and sidebar. The certificate card carries the same emblem, as a flat fill, beside its lettered ORBES (§7). This is the brand's decision in place of the first recommendation, one vector *wordmark* replacing the typed spans and the print label's lettering: the file supplied is a monogram, not a wordmark, so the five `.wordmark` spans stay text, and the planned test that no ORBES is typed any more became a test that the monogram is where the brand put it (`test/web/verify.brand.test.ts`, `test/web/admin.brand.test.ts`, `test/web/monogram.test.ts`, `test/render/certificate.test.ts`). **Still open, said rather than changed by this system:** the print label under a code keeps its stroked geometric lettering at 0.9 cap-height tracking (`genome/src/server/render/print-sheet.ts`, `LABEL_LAYOUT`, `brandText`), so the print samples and the test kit are unchanged; the vocabulary specimen keeps its title typeset in Helvetica at 0.42 em, weight 300 (`genome/scripts/genome-symbol-study.ts`); theorbes.com keeps its raster logo (a geometric sans, base64 PNG in `index.html`, which this system does not modify). Each awaits the brand's choice: the monogram beside the word, Gravesend lettering outlined to paths, or as they are. Was: four renderings of the word (the raster logo, Helvetica Neue tracked at 0.62 em in the apps, Helvetica 300 in the specimen, stroked lettering on the print label) and no master vector artwork.
2. **Ink.** theorbes.com uses `#000000`; the apps use `--ink: #0A0A0A`. ~~The scanner ground is pure `#000` (`genome/src/web/verify/styles.css`, `body[data-screen="scan"]`, `.view--scan`).~~ **Resolved (verify app, 2026-10-01):** the scanner ground and veil use `var(--ink)` (guarded by `genome/test/web/verify.brand.test.ts`). **Resolved (GENOME on ivory, 2026-10-01):** the GENOME on the ivory plates is drawn in the ivory colourway's ink `ORBES_CODE_STYLES.ivory.ink` (`#111111`, now in `genome/src/core/code/styles.ts`) by `genomeFigureMarkup` (`genome/src/web/admin/ui/figures.ts`) and `genomeRowMarkup` (`genome/src/web/verify/genome-view.ts`), exactly as the ivory code prints it (checked by `test/web/admin.brand.test.ts` and `test/web/verify.brand.test.ts`). Was: the same GENOME on screen was drawn in `#0A0A0A` (console) or `currentColor` = `--ink` (verify). theorbes.com's `#000000` stays as it is (`index.html` is not part of this system).
3. **`--metal` used for text that must be read.** **Resolved (console, 2026-10-01):** every readable text of `genome/src/web/admin/styles.css` that was `--metal` (`.side__group-title`, `.login__foot`, `.bar--zero` labels, `.cinput::placeholder`, the sidebar and sign-in place lines, the hidden claim code) is now `--ink-soft` (6.7 : 1 on white, 6.0 : 1 on ivory); no rule sets text colour to `--metal` any more, and the `brand.css` comment states 6.7 : 1 (checked by `test/web/admin.brand.test.ts`). Was: `--metal` used, against its own comment ("never used for text that must be read", 2.8 : 1, 2.5 : 1 on ivory): console navigation group titles `.side__group-title`, the sign-in foot "Internal use only · All actions are recorded" `.login__foot`, zero-value bar labels `.bar--zero`, and input placeholders `.cinput::placeholder` (`genome/src/web/admin/styles.css`). The `--ink-soft` comment also states 6.4 : 1; the measured ratio is 6.7 : 1 (`brand.css`).
4. ~~**The reference customers are asked to quote is 7 px.**~~ **Resolved (verify app, 2026-10-01):** `.result__meta` is now 10 px (`--fs-micro`), `--ink-soft`, tabular, without the 8 px `.nano` class. Was: Non-authentic results say "Please quote the reference below", but `REF …` is set at 7 px, `--ink-soft` (`.result__meta`, `genome/src/web/verify/styles.css`). It should be at least 10 px.
5. ~~**Repeated sentence for owners.**~~ **Resolved (verify app, 2026-10-01):** the client notice is only added when the server message does not already mention the unusual activity, so the sentence appears once. Was: When the owner's piece has unusual activity elsewhere, the server message already says "Unusual activity has been recorded for it; ORBES Client Services can assist you." (`genome/src/server/services/copy.ts`, `UNUSUAL_ACTIVITY_OWNER_COPY`) and the client adds a notice with the same sentence (`genome/src/web/verify/view-model.ts`, line 190). One of the two should go.
6. ~~**A forged genome version invites a rescan.**~~ **Resolved (verification, 2026-10-01):** the signature is verified before the genome-version support check, so an edited genome version answers INVALID SIGNATURE ([counterfeit simulation](reports/counterfeit-simulation.md), 4a now PASS); only a validly signed but unsupported version answers UNKNOWN ORBES CODE. Was: an unsupported genome version answered MALFORMED_CODE, "This code could not be read. Please scan it again…", for a code that was read perfectly.
7. **Favicons do not follow the SEAL proportions.** **Resolved (verify app, 2026-10-01):** `genome/src/web/verify/favicon.svg` is now core r 5.35, gap to 8.025, ring 8.025–10.7 (core 2 : gap 1 : ring 1). **Resolved (console, 2026-10-01):** `genome/src/web/admin/favicon.svg` uses the same seal (core r 5.35, ring 8.025–10.7) with four corner moons on ivory. Was: `genome/src/web/verify/favicon.svg` (core r 4.2, ring 8.3–10.7) and `genome/src/web/admin/favicon.svg` (core r 5, ring 8.5–10.5) differ from each other and from the SEAL (core 2 : gap 1 : ring 1, i.e. core r 5.35 for a ring to 10.7). Derive both from `CODE01.seal`. **Superseded (both apps, 2026-10-02):** the tab icons now draw the brand's monogram, on the same white disc and ivory square (§3.5, §3.9), written by `genome/scripts/favicons.ts`; the SEAL proportions no longer apply to them.
8. **Token drift.** **Resolved (verify app, 2026-10-01):** `--track-display` (landing meta) and `--fs-lead` (problem title) are now used; every size and tracking in `genome/src/web/verify/styles.css` that equals a token uses it (8, 10, 11, 12, 15 px; 0.22, 0.28, 0.32 em). **Resolved (console, 2026-10-01):** every font size and tracking in `genome/src/web/admin/styles.css` that equals a token now uses it (8, 10, 11, 12, 13 px; 0.22, 0.28, 0.32, 0.62 em). **Resolved (both apps, 2026-10-01):** the remaining component sizes (7, 8.5, 9, 10.5, 11.5, 12.5, 14, 17, 18, 19, 22, 26, 46 px) are named tokens in `brand.css` (§3.1), with unchanged values, and no stylesheet sets a literal pixel font size any more (`test/web/verify.brand.test.ts`). **Resolved (`brand.css`, 2026-10-03):** the shared stylesheet itself kept three literals equal to tokens, `.wordmark--small` at 12 px and the code field at 18 px / 0.28 em; they are `--fs-line`, `--fs-heading-lg` and `--track-label`, with unchanged values, and the test now reads `brand.css` and the legal pages' stylesheet too. Was: the off-scale sizes of both apps had no token. Was: `--track-display` and `--fs-lead` are defined and unused; 25 distinct tracking values and 21 pixel font sizes (7, 8.5, 9, 10.5, 11.5, 12.5, 17, 19 px…) are hard-coded in `genome/src/web/verify/styles.css` and `genome/src/web/admin/styles.css`.
9. **Two primary buttons.** **Resolved (console, 2026-10-01):** `.cbtn--primary` is the single hairline button (transparent, 1 px ink border, ink text; fills with ink on hover and `:focus-visible`), and artifact downloads are secondary buttons. Was: `brand.css` defines "the single hairline button" (outlined, fills on hover); the console's `.cbtn--primary` is filled ink and inverts on hover (`genome/src/web/admin/styles.css`). Defensible for a dense tool, but it should be a stated exception.
10. **Status comment.** **Resolved (2026-10-01):** the comment now reads "rotated square (diamond) and a bold label", as `.status--alert` draws it. Was: `genome/src/web/admin/model/tone.ts` describes *alert* as an "inverted label"; the CSS draws a rotated square and a bold label (`.status--alert`).
11. **Date formats.** **Resolved (documented, 2026-10-01):** two formats on purpose. `/verify` writes `1 OCT 2026 · 14:32` in the viewer's local time (`genome/src/web/verify/view-model.ts`): one date in a sentence-like line, read by a customer. The console writes `01 OCT 2026 · 14:32 UTC` (`genome/src/web/admin/format.ts`): UTC so operators, workshops and auditors read the same instant as the audit log, and a zero-padded day so dates stacked in table columns and timelines align character for character in tabular numerals. The reason is stated in `format.ts`. Was: the zero-padded day was not explained.
12. **Identifier case.** **Resolved (2026-10-01):** `.kpi__note` no longer transforms case; the model writes the other notes in capitals and the key id in its true case. Was: the dashboard KPI uppercases the key id (`ORBES-K001-…`) through `.kpi__note { text-transform: uppercase }`, while the definition list beside it shows the true lower-case `orbes-k001-…` (`genome/src/web/admin/styles.css`, `genome/src/web/admin/model/dashboard.ts`).
13. **Colourway names.** **Resolved (2026-10-01):** one name, `classic`, everywhere: `ArtifactTheme` is `classic | inverted | ivory` in the renderer (`genome/src/server/render/scene.ts`), the artifact and print-sheet API (`black` stays accepted as a deprecated alias of `classic`), the console and file names; the console menu reads CLASSIC — BLACK ON WHITE, INVERTED — WHITE ON BLACK, IVORY — INK ON IVORY. Was: `classic` in the core (`ORBES_CODE_STYLES`, ORBES-CODE-SPEC §8.3) is `black` in the artifact API and console (`genome/src/server/render/scene.ts`, `genome/src/web/admin/types.ts`) and "Black on white" in the console's theme menu.
14. **Below-minimum sizes are not flagged.** **Resolved (2026-10-01):** the console warns under 30 mm (§2.6), refuses under 15 mm unless *Test print* is checked (the generator panel and the print-sheet panel alike), and the server floor (`ARTIFACT_LIMITS.minWidthMm`) is 10 mm. Was: the console accepts 5–500 mm (`genome/src/web/admin/ui/artifacts.ts`, `genome/src/server/render/artifact.ts` `ARTIFACT_LIMITS`) and shows only the cell pitch. A quiet warning under 30 mm (§2.6) would prevent unreadable prints.
15. ~~**Specimen palette.**~~ **Resolved (2026-10-01):** `SPECIMEN_PAPER` is ivory `#F6F2EA` and `SPECIMEN_MUTED` is `--ink-soft` `#5C5C5C`; the specimen was regenerated with unchanged geometry. Was: `docs/assets/genome-01-vocabulary.svg` uses paper `#F7F5F0` and grey `#8A8780` (`SPECIMEN_PAPER`, `SPECIMEN_MUTED` in `genome/scripts/genome-symbol-study.ts`), not ivory `#F6F2EA` and `--ink-soft` / `--metal`.
16. ~~**Quiet band wording in the spec.**~~ **Resolved (2026-10-01):** ORBES-CODE-SPEC §3, §4.7 and §9 now keep the seal quiet ring and the 2 u margin ink-free and permit, in the outer quiet band only, the decorative hairlines at r 23.5 and 24.0 at their specified tones with ≥ 0.6 u clearance. Was: ORBES-CODE-SPEC §3 counts the band "between data and moons" as a quiet zone and §9 says quiet zones "MUST be free of ink", yet the decor horizon (r 24.0) and outer guide (r 23.5) are printed in that band by design (`genome/src/core/code/primitives.ts`; the horizon is about 34 % contrast in the classic colourway). The spec should limit "free of ink" to the seal quiet ring and the outer 2 u zone, and allow decor at ≥ 0.6 u clearance.
17. ~~**Customer vocabulary.**~~ **Resolved (server copy, 2026-10-01):** the AUTHENTIC message now reads "registered to an active **piece**" (`genome/src/server/services/copy.ts`). Was: "registered to an active product", while every other customer sentence says "piece".
18. ~~**Platform fonts.**~~ **Resolved (both apps, 2026-10-02):** the brand supplied its display face, Gravesend Sans Medium (Rian Hughes / Device; its web licence is the brand's responsibility, [NOTICE.md](../NOTICE.md)). It ships as a 12.6 KB WOFF2 subset (`genome/src/web/shared/fonts/gravesend-sans-500.woff2`, Basic Latin, the accented capitals of French and the brand's punctuation since 2026-10-03), declared in `brand.css` with `font-display: swap`, preloaded by both shells and served from `/assets/` with a content hash (§3.1). It sets the wordmark, titles and tracked-capital labels through the new token `--font-display`, so they render identically on Apple, Android and Windows devices; reading text stays in the Helvetica Neue stack of `--font`, identical to theorbes.com. This is the brand's decision in place of the first recommendation (a Helvetica Neue or Now cut in weights 300 and 400, first in `--font`): one file was supplied, a display face, so it gets its own token, and figures stay in `--font` because Gravesend's one is its capital I (§3.1). Still open, **outside this software**: the same face on theorbes.com, prepared in [launch/THEORBES-FONT.md](launch/THEORBES-FONT.md) for the owner's agreement (`index.html` is not modified by this system); the owner's confirmation that the licence allows the file in this source repository at its visibility ([NOTICE.md](../NOTICE.md)); and reading text on Android and Windows, which still falls back to the platform sans-serif. Was: no web font was shipped, so Android and Windows visitors saw Roboto or Arial and never the light weight; licensing and bundling a Helvetica Neue cut, or a licensed alternative, was a brand and licensing decision.
19. ~~**"REGISTRATION OPEN" after it has closed.**~~ **Resolved (verify app, 2026-10-01):** the heading reads REGISTRATION CLOSED once the window has expired (`registrationStatus`, `genome/src/web/verify/view-model.ts`). Was: When the registration window of a scan has expired, the OWNERSHIP tab still heads the panel REGISTRATION OPEN above "The registration window of this scan has closed." (`genome/src/web/verify/views/ownership.ts`, `registerBlock`).
20. **Certificate card awaiting validation.** The card that carries the claim code (§7) is produced by the console and the API, but its layout has not been validated by the brand: every card, sheet and file therefore says PROOF (`CERTIFICATE_LAYOUT_STATUS = 'PROOF'`, `genome/src/server/render/certificate.ts`). Still open: the brand reviews the specimen of §7 (format, lettering sizes, copy, scratch-off panel, and the monogram's 0.077 mm hairlines of §3.9 on a physical proof from the chosen press) with the [packaging kit](launch/PACKAGING-KIT.md) (its §6 lists what to sign off), then the constant becomes `VALIDATED` and the specimens are regenerated (`genome/scripts/certificate-specimen.ts`; `genome/test/render/certificate.test.ts` checks they match). The proof is of the card on the chosen press only: the ownership certificate's A4 (F-06), which carries the monogram at the same size, is printed by owners and insurers on office printers no proof can stand for, and is not part of it (§3.9). It carries no PROOF mention either: it attests a record, not a layout the brand prints.

---

## 9. Reproducing the screenshots

```sh
cd genome && npx tsx scripts/capture-ui.ts          # writes docs/assets/ui/*.png
cd genome && npx tsx scripts/capture-ui.ts --raw    # truecolour PNGs instead of quantised ones
cd genome && npx tsx scripts/capture-ui.ts --only live   # the LIVE RELEASE's live-*.png alone
cd genome && npx tsx scripts/capture-ui.ts --only plus   # LIVE RELEASE+'s plus-*.png alone
```

`genome/scripts/capture-ui.ts` builds the web apps with `scripts/build-web.ts` (production mode, into a temporary directory), seeds the demo dataset into an in-memory PGlite database through the real services (`seedDemo`), starts the real server (`createContext` + `buildApp`), and drives Chromium (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, or `ORBES_CHROMIUM`) through playwright-core:

- **Verify**: 390 × 844 CSS px at 2×, iPhone user agent, Europe/Paris. The camera is Chromium's fake capture device playing simulated hand-held video of O26-J-00184's code (`cameraClipFrames` from `genome/test/e2e/support.ts`). The unusual-activity and invalid-signature results go through the real photo-upload path. The certificate-card section (`verify-10b-unusual-activity-card.png`) is captured after the console and the sale mode: a burst of 22 scans of O26-L-00014's code from distinct sources, through the real verification service, then its photo; those scans would otherwise change the console's figures.
- **Console**: 1 440 × 900 CSS px at 1×, signed in as a bootstrap ADMIN; the generator result is a real issuance through the form. Before it, the script creates two staff accounts through the auth service, an OPERATOR from the Team page's path (`createStaff`, on its temporary password) and a RETAIL seller with a known password (`createAdmin`, as `scripts/admin.ts create` does), so the Team page has rows; Cases reads the demo dataset's two customer reports, Analytics its daily statistics (LAST 30 DAYS), the owner sheet is Camille Martin's.
- **Sale mode** (`admin-08-sale.png`): the phone of verify (390 × 844 at 2×), after the console: the RETAIL seller signs in, chooses ORBES PARIS — SAINT-HONORÉ and reads the in-stock O26-J-00187 from a photo (the lookup records a staff scan, which the console captures must not show). The warranty is not started.
- **Then**, on the phone of verify: MY PIECES (`verify-12-my-pieces.png`), the demo owner Camille Martin signed in through the account API; her OWNERSHIP CERTIFICATE (`verify-13-ownership-certificate.png`, full page), a link she creates through the API, opened by a visitor without an account; and the FAQ of the legal pages (`legal-01-faq.png`), in English.
- **The LIVE RELEASE** (`live-*.png`, last, or alone with `--only live`; Quality bar 7 of its plan): the live engine runs on the stage; the releases and the accounts are made as the LIVE suites make them (`genome/test/support/live.ts`) on the demo's MONOLITHE, given a photograph (a studio drawing of the ring, `monolitheSvg`, encoded as a WebP by Chromium and stored through the media service) and, for two releases, a silhouette drawn alike. The release is lived in real time on the phone of verify: the banner of a release opening in 2 h 14 min, THE RELEASES, a release at its silhouette's stage and one with its name and photograph (a size chosen for I'LL BE THERE), the room (T0 on the minute, at least 100 s ahead), the last minute entered (31 s before T0) and the boutique board by its secret link (1 280 × 720) in it, T0 with the door's motion held at 0.48 s (the Web Animations of the door paused, then played on), the line while three collectors secure their piece, the console's live board at that moment (1 440 × 900, its first screen, signed in before T0), the turn (a piece returned) at half its 30 s with the seal held half its 1.5 s, secured with two add-ons, CONFIRMED; then each edge page, set up through the services as `test/web/verify.live.e2e.test.ts` does; then the console's page of a release announced tomorrow, whole, with its settings. Times are the capture's.
- **LIVE RELEASE+** (`plus-*.png`, `plus-01` to `plus-30`, last, or alone with `--only plus`; the screens of its Method), in the order of its flow. One collector, Hélène Morel (PLATINE), lives through the releases of the last days on services of a clock of their own over the stage's database, as `genome/test/web/verify.orders.e2e.test.ts` does, ORBES Client Services and the atelier following her orders on that clock in working hours, the releases opening at 19:00 Paris: a draw (her place confirmed, then paid: PAID, its piece being made), LIVE I (her piece secured, paid, made at the atelier, shipped with Colissimo and registered by her: DELIVERED), a request of the private salon accepted (an ORBITE made and shipped with Chronopost: SHIPPED), LIVE II (in the line at the sell-out), LIVE III (I'LL BE THERE, never came). Then, the live engine running: LIVE IV sells out and its after-room opens a minute later, where she takes her turn and secures an ORBITE (RESERVED); LIVE V is announced for the collectors who have taken part in three releases or are selected, with a surprise in every box; a release for the selected collectors has its room open; LIVE VI is a draft with every part of LIVE RELEASE+, its stock at LOGISTICS WAREHOUSE, which holds some of its sizes. The phone of verify shows THE RELEASES on LIVE and on PAST, a past release, the release announced, the two refusals (the releases counted, FOR SELECTED COLLECTORS), the second door, the after-room's page, its turn (the seal held half way) and its CONFIRMED, the question after, then MY PIECES' YOUR ORDERS at each step, an order's documents and AFTER THE RELEASES (bands of the page); the console (1 440 × 900) its Orders, an order, Atelier, Invoices, Segments, a segment, Settings, the client sheet, the Catalogue's Shopify export, LIVE VI's parts and its best time to open (each alone, on 40 pixels of the page's white) and PUBLISH with the feasibility check's warnings; then the four printed documents: the work sheet and the packing slip as the console prints them (print media, A4 at 2×, on 15 mm of white), the invoice and the ownership certificate of an order as their PDFs read, drawn by the system's reader (Quick Look on macOS, Poppler's `pdftoppm` elsewhere).
- **The locked scanner** (`verify-03-locked.png`) is kept from a run in Chromium on Linux: Chrome for Testing on macOS paints its frozen camera frame black (§3.1). From a Mac, write the set elsewhere (`--out`) and copy every file but that one.

Nothing is mocked. To photograph transient states, the decoder worker script is held until the scanner has been captured searching, and `POST /api/v1/verify` is held while the locked scanner and the VERIFYING… screen are captured. The seal-seen state of the scanner (P-D10) may be captured the same way with the stand-in decoder worker the P-D10 test of `genome/test/web/verify.e2e.test.ts` uses, which answers every frame as a failed read that carries a seal; the set does not hold it yet. Since P-D10, VERIFYING… draws the scanner's ring, and `verify-09-verifying.png` is to be captured again, as is `verify-01-landing.png`, since P-D07 put SOUND ON / OFF at the landing's foot; the ceremony and its share image (P-D01) are written for review by `genome/test/web/verify.e2e.test.ts` to `genome/out/verify-ceremony.png` and `genome/out/verify-share-genome.png`, not into this set. Before capture the film grain of verify and of the legal pages is hidden through the CSSOM (invisible at this scale, it would roughly triple the files), and the generator's claim code is hidden with the console's own control. PNGs are quantised to an exact 256-colour palette (median cut, each entry snapped to the most frequent exact colour of its box, no dithering), so `#FFFFFF`, `#0A0A0A`, `#F6F2EA` and `#5C5C5C` survive bit-exact; the set of 72 (23, the LIVE RELEASE's 24 and LIVE RELEASE+'s 25) weighs about 5.5 MB. Product ids and dates in the captures depend on the run (the generator allocates the next serial; times are the capture time).
