# ORBES — Authentication Design System

Status: v1.0, describes the implementation as built · Scope: the ORBES SEAL, the ORBES GENOME and the ORBES CODE as marks; the verification app (`/verify`); the GENOME console (`/admin`); print artifacts.
Related: [ORBES-CODE-SPEC](ORBES-CODE-SPEC.md) (normative geometry) · [ORBES-GENOME-SPEC](ORBES-GENOME-SPEC.md) (glyph vocabulary) · [scan matrix](reports/scan-matrix.md) · [print-size matrix](reports/print-size-matrix.md) · [ARCHITECTURE](ARCHITECTURE.md).

Every value in this document is read from the code. Where a rule is a brand recommendation rather than something the software enforces, it says so. Sources of truth:

| Layer | File |
|---|---|
| House style of theorbes.com (the reference) | `index.html` (root; never modified) |
| Web tokens and primitives | `genome/src/web/shared/brand.css`, `corners.ts`, `dom.ts` |
| Verification app | `genome/src/web/verify/**` (copy in `copy.ts`) |
| Console | `genome/src/web/admin/**` |
| Public result copy | `genome/src/server/services/copy.ts` |
| Code geometry and colourways | `genome/src/core/code/profile.ts`, `primitives.ts`, `encoder.ts` (`ORBES_CODE_STYLES`) |
| Genome glyphs and layouts | `genome/src/core/genome/vocabulary.ts`, `render.ts` |
| Print artifacts | `genome/src/server/render/` (`artifact.ts`, `scene.ts`, `print-sheet.ts`, `label-font.ts`) |

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
| **ORBES SEAL** | Universal. Says "this is ORBES". | Never: identical on every product. | Finder pattern (rotation-invariant 1 : 1 : 4 : 1 : 1 run), centre and affine fit. Machine-critical. | Centre of every ORBES CODE; centre of the GENOME orbit layout; echoed by the favicons and the result marks. |
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
- **On screen:** the favicons draw a seal-like figure (see [§8](#8-deviations-to-resolve), item 7), and the AUTHENTIC result mark is a hairline echo of it, not the seal itself (§3.5).

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
| **Row** | Glyph pitch 3.4 R; separator points r 0.13 R between glyphs; margin 0.7 R | Verification result (the GENOME specimen) |
| **Orbit** | Glyph 0 at north, then clockwise every 45° on radius 7.5 u; glyph R = 1.75 u; separator points r 0.22 u at the half-steps; SEAL at the centre; margin 1.25 u | Console product page and generator; the inner orbit of every code |

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
| GENOME glyph, on screen | 12 px glyph diameter | [Symbol study](reports/genome-symbol-study.md): 100 % template classification from 12 px (99.09 % at 8 px). The verify specimen renders glyphs at ≈ 21 px on a 390 px screen. |
| ORBES SEAL, printed standalone | 4.8 mm diameter | Its size inside a 30 mm code (8 u). |

The renderer accepts 5–500 mm (`ARTIFACT_LIMITS`). That is a technical bound for memory and resolution, not a brand permission.

### 2.7 Colourways

Three presentations exist, defined once in `ORBES_CODE_STYLES` and shared by the encoder, the console preview and the print artifacts.

| Colourway (`ORBES_CODE_STYLES`) | Console theme / label | Ink | Paper | Horizon (tone 0.35) | Guides (tone 0.25) | Use |
|---|---|---|---|---|---|---|
| `classic` | `black` · "Black on white" | `#0A0A0A` | `#FFFFFF` | `#A9A9A9` | `#C2C2C2` | The reference rendition: paper, card, certificates |
| `inverted` | `inverted` · "White on black" | `#FFFFFF` | `#0A0A0A` | `#606060` | `#474747` | Black card, dark leather, white or light foil |
| `ivory` | `ivory` · "Ink on ivory" | `#111111` | `#F6F2EA` | `#A6A39E` | `#BDBAB4` | Ivory stock, hang tags, leather swing tags |

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
| Print the claim code on the product | The console says it: "Place it inside the packaging, never on the product." |
| Print below the minimum sizes of §2.6 | Real phones lose resolution to processing the simulator does not model. |

---

## 3. Interface foundations

Both web apps import `shared/brand.css`, which mirrors the house style of theorbes.com: white and black, Helvetica Neue, uppercase micro-type with wide tracking, 1 px rules, hairline corner brackets, film grain and slow `cubic-bezier(0.22, 1, 0.36, 1)` motion. All CSS is in external files (CSP `style-src 'self'`); scripts only toggle classes or set custom properties through the CSSOM.

### 3.1 Typography

**Stack.** `"Helvetica Neue", HelveticaNeue, Helvetica, Arial, sans-serif` (`--font`), the exact stack of `index.html`. No web font is shipped. On Apple devices the design renders in Helvetica Neue (and Helvetica Neue Light for weight 300). Elsewhere it falls back to Helvetica or Arial, and on most Android devices to the platform sans-serif (Roboto); weight 300 then renders as 400. The screenshots in this document were taken in Chromium on Linux, where the stack resolves to Liberation Sans, metric-compatible with Helvetica and Arial, at weight 400 throughout.

**Case and tracking.** Titles, labels, buttons, tabs and metadata are uppercase with wide tracking. Explanatory sentences are sentence case, never tracked beyond 0.06 em. Tracked type carries trailing letter-spacing after its last glyph, so centred tracked text is compensated with an equal `text-indent` (`.indent-micro`, `.indent-label`, and per-component indents), as theorbes.com does.

**Weights.** 400 everywhere; 300 for display numerals and titles (result title, console page title, KPI values, product id in the console sheet, generator identity); 700 only in the console, for alert and critical status labels and the lifecycle move in the history timeline.

**Numerals.** `font-variant-numeric: tabular-nums` for identifiers, dates and values. Counts use a thin space (U+2009) as thousands separator: `12 480`.

**Tokens** (`brand.css`):

| Token | Value | Token | Value |
|---|---|---|---|
| `--fs-nano` | 8px | `--track-micro` | 0.22em |
| `--fs-micro` | 10px | `--track-label` | 0.28em |
| `--fs-label` | 11px | `--track-display` | 0.32em *(defined, unused)* |
| `--fs-line` | 12px | `--track-wordmark` | 0.62em |
| `--fs-body` | 13px | | |
| `--fs-lead` | 15px *(defined, unused)* | | |
| `--fs-title` | 24px | | |
| `--fs-wordmark` | 30px | | |

**Verification app — type in use**

| Role | Size | Weight | Tracking | Notes |
|---|---|---|---|---|
| Wordmark, landing | clamp(26px, 7.6vw, 34px) | 400 | 0.62em | indent 0.62em |
| Wordmark, small (result) | 12px | 400 | 0.55em | 11px in the scanner header |
| AUTHENTICATION | 9px | 400 | 0.40em | `--ink-soft` |
| Result title | 24px | 300 | 0.30em | line-height 1.3; **18px** / 1.55 for caution and void states |
| Result sub-title | 10px | 400 | 0.30em | `--ink-soft`, e.g. FIRST REGISTRATION |
| Message title (problems) | 15px | 400 | 0.30em | line-height 1.7 |
| Prose | 13px | 400 | 0.02em | line-height 1.75, `--ink-soft`, balanced wrapping, ≤ 31–32 ch |
| Owner notice | 12px | 400 | 0.02em | between two `--hairline-strong` rules |
| GENOME label | 8px | 400 | 0.36em | `--ink-soft` |
| GENOME id | 17px | 400 | 0.22em | tabular |
| Product lines | 11px | 400 | 0.30em | line-height 2.55 |
| Tabs | 9px | 400 | 0.22em | selected `--ink`, others `--ink-soft` |
| Row label / value | 9px / 11px | 400 | 0.28em / 0.14em | value right-aligned, tabular |
| Section label | 8.5px | 400 | 0.34em | e.g. VERIFICATION |
| Status line (scanner, verifying) | 10px | 400 | 0.34em | |
| Scan hint | 11px | 400 | 0.06em | sentence case, `rgba(255,255,255,0.74)` |
| Button | 10px | 400 | 0.28em | |
| Text link, scanner controls, field labels | 8px | 400 | 0.30em | |
| Field input | 16px | 400 | 0.04em | 16px so iOS does not zoom; code input 18px / 0.28em |
| Transfer code | 19px | 400 | 0.26em | tabular, on ivory |
| Footnote | 10px | 400 | 0.02em | line-height 1.75 |
| Result meta (VERIFIED · REF) | 7px | 400 | 0.30em | see §8, item 4 |
| Landing meta | 7px | 400 | 0.32em | opacity 0.4, as theorbes.com's 6.5px meta at 0.28 |

**Console — type in use**

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Sidebar wordmark | 15px | 400 | 0.62em |
| Page title | 30px | 300 | 0.20em |
| Product id (fact sheet) / generator identity | 22px / 26px | 300 | 0.22em / 0.20em |
| KPI value | 46px | 300 | 0.04em, tabular |
| Dialog title | 17px | 400 | 0.18em |
| Claim code | 30px | 400 | 0.24em |
| Panel title | 11px | 400 | 0.30em |
| Navigation link | 10px | 400 | 0.24em |
| Status mark text | 10px | 400 (700 for alert, critical) | 0.20em (0.18em bold) |
| Body, table cells, definition values | 12–13px | 400 | 0.03–0.06em |
| Eyebrows, column heads, field labels, buttons, crumb | 8px | 400 | 0.30–0.36em |
| Identifiers and hashes | 11.5px monospace | 400 | 0.02em |

Monospace (`ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`) is reserved for identifiers and hashes, and appears only in the console.

### 3.2 Colour

| Token | Value | Role | Contrast on white / ivory |
|---|---|---|---|
| `--white` / `--paper` | `#FFFFFF` | Page | — |
| `--ivory` | `#F6F2EA` | Specimen plates and figures, console sidebar, panels that hold a secret or a fresh result (claim code, transfer code, enrolment, generator identity) | — |
| `--ink` | `#0A0A0A` | Text, rules that structure, buttons | 19.8 : 1 / 17.7 : 1 |
| `--ink-soft` | `#5C5C5C` | Secondary text | 6.7 : 1 / 6.0 : 1 (AA) |
| `--metal` | `#9A9A9A` | Decorative only: separators, zero rows, placeholders | 2.8 : 1 / 2.5 : 1 (not for text that must be read) |
| `--hairline` | `rgba(10,10,10,0.12)` | Default 1 px rule (≈ `#E2E2E2` on white) | — |
| `--hairline-strong` | `rgba(10,10,10,0.32)` | Section rules, field underlines, local brackets on ivory | — |
| `--critical` (console only) | `#8A1C1C` oxblood | The few facts that require immediate action | 9.3 : 1 |
| `--veil` (console only) | `rgba(246,242,234,0.86)` | Dialog backdrop | — |
| Scanner ground | `#000000` | Camera view background | — |
| Scanner veil | `rgba(10,10,10,0.5)` → `0.78` when locked | Flat veil outside the orbit | — |

theorbes.com itself uses pure `#FFFFFF` and `#000000`; the authentication apps soften the ink to `#0A0A0A` (see §8, item 2). The public verification app uses no colour: every state, including the gravest, is told in ink. `theme-color` is `#ffffff` for `/verify` and `#f6f2ea` for `/admin`. `::selection` inverts to white on ink.

### 3.3 Grid and spacing

There is no spacing scale token: spacing is set per component in pixels, on generous, recurring values.

**Verification app (mobile first).**

| Element | Value |
|---|---|
| Landing | content centred; padding 88 px top and bottom (+ safe areas), 32 px sides |
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

There are no icons in the pictographic sense. Every mark is built from the orbit.

| Mark | Construction | Meaning |
|---|---|---|
| **Authentic** | 44 px; ring r 18 (viewBox ±24, 1 px non-scaling stroke) + core disc r 6.5 | The full seal, echoed: AUTHENTIC (all four variants) |
| **Caution** | Same ring + one moon r 2.6 on the orbit at north | UNUSUAL ACTIVITY DETECTED, UNREADABLE CODE |
| **Void** | The empty ring | REVOKED, UNKNOWN ORBES CODE, INVALID SIGNATURE, and every problem screen |
| **Orbit reticle** | Ring r 100 (1 px), a 28° arc travelling the ring (1.6 px, round caps), four moons r 2.6 at (±88, ±88), the polaris (NW) with a halo r 6.5 | Resting on the landing (ring 16 %, moons 26 %, arc 50 % opacity, one turn per 48 s); live in the scanner (one turn per 3.6 s) |
| **Loader** | Ring r 44 at 22 % opacity, core r 3, one moon r 3 orbiting | VERIFYING…, READING PHOTO… |
| **Console status marks** | 7 px square before an uppercase value: **solid** (filled: in force), **outline** (hollow: pending), **muted** (`--metal`: historical), **alert** (rotated 45° to a diamond, bold label: needs attention), **critical** (oxblood diamond, bold oxblood label: act now) | Every lifecycle, code, key, warranty, ownership, severity and verification value (`model/tone.ts`) |
| **Console loading** | 22 px hairline ring with a 5 px moon, one turn per 1.6 s | LOADING |
| **Empty state** | 9 px `--metal` circle | "Nothing to show." |
| **History timeline** | 7 px circles on a 1 px line; the latest filled | Status history |
| **Separators** | `·` in `--metal` | Between tabs and options |
| **Favicons** | `/verify`: ring and core on a white disc. `/admin`: ring and core with four moons on an ivory square | Browser tabs |

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
| Landing | orbit fades in over 2.4 s after 0.4 s; wordmark rises over 1.8 s after 0.15 s; actions over 1.6 s after 0.6 s; meta fades over 1 s after 1.2 s |
| Scanner | view fades in 0.6 s; video fades in 1.2 s; the arc turns linearly every 3.6 s |
| Code found | the video freezes; the veil deepens 50 % → 78 % (1.4 s); the ring goes to full opacity and 2 px; the moons scale to 1.35 (1.4 s); a 12 ms vibration; ORBES CODE FOUND holds 420 ms (`LOCK_PAUSE_MS`) |
| Verifying | the moon orbits once per 2.4 s on `cubic-bezier(0.45, 0.05, 0.55, 0.95)`; the screen stays at least 650 ms (`MIN_VERIFYING_MS`) so a fast answer never flickers |
| Result | blocks rise 8 px over 1.4 s, staggered 0.05 / 0.30 / 0.45 / 0.60 / 0.75 s |
| Tabs | colour 0.7 s; the 1 px underline draws with `scaleX` over 0.7 s; panels fade 0.7 s |
| Text links | the 1 px underline draws from the left over 0.7 s |
| Buttons | fill with ink over 0.7 s (verify) or 0.35 s (console) |
| Console | views fade 0.7 s; bars grow over 1.4 s; the active nav rule draws to 40 px over 0.7 s; toasts rise 0.7 s, confirmations leave after 4.2 s |

Nothing bounces, springs or loops for attention; the only perpetual motions are the reticle arc, the loader moon and the grain.

**Reduced motion.** Under `prefers-reduced-motion: reduce`, `brand.css` collapses every animation and transition to 0.001 ms (one iteration, no delay) and stops the grain; the verify app also stops the reticle arc and the loader moon and shows result blocks at once. In script, the leave fade, the 420 ms lock pause and the 650 ms minimum verifying time are skipped.

### 3.7 Texture

The verification app carries theorbes.com's film grain: a fixed SVG `feTurbulence` fractal noise (base frequency 0.78, 4 octaves) at opacity 0.022, jumping position every 0.9 s (`9s steps(1)`). It is hidden on the camera screen and absent from the console. It is the only texture; there are no images, photographs or patterns in either app.

### 3.8 Controls

- **The hairline button** (`.btn`): 1 px `currentColor` border, no radius, transparent; fills with ink on hover (where hover exists) or press. One per screen, for the primary action. Disabled at 35 % opacity.
- **The text link** (`.textlink`): 8 px tracked caps at 62 % opacity, rising to 100 % with an underline drawn on hover or focus. For the secondary action.
- **Fields**: a label in 8 px tracked caps, a single 1 px underline (`--hairline-strong`, ink on focus), no box.
- **Focus**: a 1 px `currentColor` outline 4 px outside the element, keyboard only (`:focus-visible`); headings that receive focus programmatically on screen changes show none.
- **Console buttons** (`.cbtn`): 38 px, 8 px tracked caps, square; *primary* is filled ink, *secondary* outlined, *ghost* an underlined word, *danger* outlined in oxblood. See §8, item 9.

---

## 4. Voice and copy

### 4.1 Principles

- **Brief, calm, factual.** Uppercase tracked titles, one sentence-case explanation, at most two actions. No exclamation marks, no blame, no urgency.
- **Say only what was proven.** A positive result states that the identity was *issued and signed by ORBES* and what the registry says. Nothing claims that the physical object is genuine, because a printed code can be copied (`copy.ts`, both client and server).
- **Identity when proven, code when not.** Authentic and unusual-activity messages speak of "this ORBES identity"; unknown, invalid and unreadable ones speak of "this code".
- **Never reveal the reasoning.** No internal statuses, scores, thresholds or anomaly names reach the public. A stolen piece and an impossible-travel pattern both read UNUSUAL ACTIVITY DETECTED; a product flagged as counterfeit reads REVOKED.
- **Always a next step, always a human.** ORBES Client Services is named in every non-authentic outcome.
- **The customer's object is a "piece".** "ORBES Client Services", "ORBES account", "ORBES boutique or authorised retailer" are written in full.

### 4.2 Public verification states

Titles and messages exactly as served (`server/services/copy.ts`; the client mirrors the titles in `FALLBACK_TITLES`). The title is split at the dash: the main word is set at 24 px (18 px for caution and void), the remainder as a sub-title.

| State | Title | Message | Mark |
|---|---|---|---|
| `AUTHENTIC` | AUTHENTIC | This ORBES identity was issued and signed by ORBES and is registered to an active product. | Authentic |
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
| Owner notice (unusual activity elsewhere) | Unusual activity has been recorded for this identity. ORBES Client Services can assist you. |
| Non-authentic results, below the title | ORBES Client Services can help with any question about this piece. Please quote the reference below. |
| Hardware-assured piece scanned without hardware | This piece is designed to be confirmed with an additional secure hardware check, which this scan could not include. |
| Foot | SCAN ANOTHER (authentic) · SCAN AGAIN (otherwise) · `VERIFIED 1 OCT 2026 · 14:32` · `REF 5A864AF8` |

### 4.3 Status lines, guidance and problems

| Kind | Copy |
|---|---|
| Status lines | PREPARING CAMERA… · SCANNING… · READING PHOTO… · VERIFYING… · ORBES CODE FOUND |
| Scan guide | Align the ORBES CODE within the orbit |
| Hints (after 6 s without a read) | Place the whole code inside the orbit · Hold steady — in even light · Move a little closer |
| Actions | SCAN ORBES CODE · UPLOAD A PHOTO · SCAN AGAIN · TRY AGAIN · RETURN · CLOSE · LIGHT · 2× / 1× |

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
| Owned by someone else | REGISTERED TO ITS OWNER | This piece is registered to an ORBES account. · If its owner has given you a transfer code, enter it to register this piece in your name. |
| Not delivered yet | NOT YET REGISTERED | Registration opens once this piece has been delivered by an ORBES boutique or an authorised retailer. |
| Transfer offered | TRANSFER CODE · VALID UNTIL … | Give this code only to the new owner. The transfer completes when they enter it in their ORBES account. |
| Claim code field hint | — | Printed on the ORBES certificate card delivered with your piece. |

Warranty statuses read NOT YET STARTED, ACTIVE, EXPIRED or NO LONGER VALID, each with one sentence ("This piece is covered by the ORBES warranty until 25 September 2028."). Dates inside sentences are written in full; dates in rows are `25 SEP 2028`.

### 4.5 Lexicon

| Use | Never use |
|---|---|
| AUTHENTIC (of the signed identity), issued and signed by ORBES, registered, ORBES identity | REAL, GENUINE as a verdict, 100 % GENUINE, AUTHENTICITY GUARANTEED, CERTIFIED ORIGINAL |
| UNUSUAL ACTIVITY, requires review, no longer valid, not registered | FAKE, COUNTERFEIT, FRAUD, STOLEN, ALERT, DANGER, WARNING (to the public) |
| ORBES CODE, ORBES GENOME, ORBES SEAL, orbit, piece | QR, barcode, tag ID, NFT, token, blockchain, ledger, crypto, Web3 |
| signature, ORBES key (one tab deep) | IMPOSSIBLE TO COUNTERFEIT, UNHACKABLE, UNCLONABLE, TAMPER-PROOF, MILITARY-GRADE, BANK-GRADE, QUANTUM-SAFE, AI-POWERED |
| ORBES Client Services can assist you | Contact support, Error, Oops, Something went wrong |

"AUTHENTIC" is the one strong word the system allows, and it is always qualified on the same screen: the message names what was signed, and the footnote names what a printed code cannot prove.

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
   │                            │ 6 s without a read: a hint · 40 s: NO ORBES CODE FOUND
   └──UPLOAD A PHOTO──▶ READING PHOTO… ──▶ VERIFYING… ──▶ RESULT
any step ──problem──▶ MESSAGE: void mark · title · one sentence · primary button · secondary link
```

Every screen after the landing shares one history entry, so the back button (or CLOSE) always returns to the landing screen and releases the camera. The camera is also released when the page is hidden and resumed on return. Each new screen moves focus to its heading (to the scan button on the landing) so screen readers announce it; status lines are `aria-live`.

<table>
<tr>
<td width="33%"><img src="assets/ui/verify-01-landing.png" width="250" alt="Verify landing: ORBES wordmark inside a faint orbit, SCAN ORBES CODE button, UPLOAD A PHOTO link"></td>
<td width="33%"><img src="assets/ui/verify-02-scanning.png" width="250" alt="Scanner: camera view of a code on a desk, white orbit reticle with four moons, SCANNING…"></td>
<td width="33%"><img src="assets/ui/verify-03-locked.png" width="250" alt="Scanner locked on the code: frozen frame, darker veil, closed orbit, VERIFYING…"></td>
</tr>
<tr>
<td valign="top"><b>1 · Landing.</b> The wordmark sits inside the resting orbit as the core sits inside the seal. One hairline button, one discreet link, © ORBES and PARIS at the foot (GENOME CODE joins them from 560 px).</td>
<td valign="top"><b>2 · Scanning.</b> Full-bleed camera, a flat 50 % veil outside the orbit, the live reticle with its travelling arc and four moons (polaris top left). One status line, one guide sentence, LIGHT and 2× only when the camera offers them.</td>
<td valign="top"><b>3 · Code found.</b> The frame freezes, the veil deepens to 78 %, the orbit closes (2 px, moons ×1.35) and the phone ticks. ORBES CODE FOUND for 420 ms, then VERIFYING… while the server answers.</td>
</tr>
</table>

The scanner decodes only the square under the reticle (×1.45 margin), at most every 120 ms. On the camera screen the brackets and type turn white and the grain is removed.

<table>
<tr>
<td width="40%"><img src="assets/ui/verify-04-result-first-registration.png" width="300" alt="Result for O26-J-00184: AUTHENTIC — FIRST REGISTRATION, GENOME specimen on ivory, product lines, tabs with OWNERSHIP selected, footnote"></td>
<td valign="top">
<b>4 · Result, O26-J-00184 — AUTHENTIC · FIRST REGISTRATION.</b> From top to bottom:
<ol>
<li>small wordmark;</li>
<li>the state mark (here the authentic seal echo);</li>
<li>the title, split at the dash into a 24 px main word and a tracked sub-title;</li>
<li>one sentence from the server;</li>
<li>the <b>GENOME specimen</b>: an ivory plate framed by hairline brackets, with the product id, the eight glyphs drawn by the core renderer (the same function as print) and the fingerprint <code>G1-E1DC-BE52 · GENOME-01</code>;</li>
<li>the product lines MODEL / TYPE / CATEGORY / MATERIAL / CREATED YYYY;</li>
<li>the tabs PRODUCT · WARRANTY · CARE · OWNERSHIP, opening on OWNERSHIP because registration is open (PRODUCT otherwise);</li>
<li>SCAN ANOTHER, the honest footnote, and the VERIFIED · REF line.</li>
</ol>
The client recomputes the genome from the glyphs it received and draws the row only if it matches the server's fingerprint. Product lines and tabs appear only for the four AUTHENTIC states; the GENOME appears whenever the server sends it (authentic, unusual activity, revoked).
</td>
</tr>
</table>

<table>
<tr>
<td width="50%"><img src="assets/ui/verify-05-tab-product.png" width="330" alt="PRODUCT tab: product rows and VERIFICATION rows"></td>
<td width="50%"><img src="assets/ui/verify-06-tab-warranty.png" width="330" alt="WARRANTY tab: status ACTIVE, from and until dates, one sentence"><br><br><img src="assets/ui/verify-07-tab-care.png" width="330" alt="CARE tab: care instructions in prose"></td>
</tr>
<tr>
<td valign="top"><b>PRODUCT.</b> Facts as label/value rows, then VERIFICATION: signature, code version and issue, genome version, issue date, assurance. This is where the technology lives, in plain words.</td>
<td valign="top"><b>WARRANTY</b> and <b>CARE.</b> Status rows with one explanatory sentence; care as prose from the model (a default text otherwise).</td>
</tr>
<tr>
<td colspan="2"><img src="assets/ui/verify-08-tab-ownership.png" width="330" alt="OWNERSHIP tab: REGISTRATION OPEN, sign-in form"><br><b>OWNERSHIP.</b> Registration with the claim code from the certificate card, sign-in or account creation, transfer codes. Fields are single hairlines; errors are one sentence preceded by an em dash; secrets are never stored beyond the form.</td>
</tr>
</table>

Tabs follow the ARIA tablist pattern (arrow keys, Home, End, roving tab index); panels are built on first selection.

<table>
<tr>
<td width="33%"><img src="assets/ui/verify-09-verifying.png" width="250" alt="VERIFYING… with a moon orbiting a faint ring"></td>
<td width="33%"><img src="assets/ui/verify-10-unusual-activity.png" width="250" alt="UNUSUAL ACTIVITY DETECTED for O26-J-00193, caution mark, GENOME specimen, help text, SCAN AGAIN"></td>
<td width="33%"><img src="assets/ui/verify-11-invalid-signature.png" width="250" alt="INVALID SIGNATURE, empty orbit mark, help text, SCAN AGAIN"></td>
</tr>
<tr>
<td valign="top"><b>Verifying (photo path).</b> READING PHOTO… then VERIFYING…, one moon orbiting a 22 % ring around a core.</td>
<td valign="top"><b>Unusual activity</b> (O26-J-00193, reported stolen, scanned by a stranger). Caution mark, 18 px title on two lines, the GENOME, a request to contact Client Services with the reference. No tabs, no product facts.</td>
<td valign="top"><b>Invalid signature</b> (a demo code with one signature bit flipped). Void mark, nothing about the product, the same calm help sentence; the short page sits at the optical centre.</td>
</tr>
</table>

---

## 6. The GENOME console

The console is an internal instrument in the house style, not a SaaS dashboard: white and ivory paper, black ink, tracked uppercase, 1 px hairlines and an architectural grid; no cards, shadows, gradients or charts beyond hairline bars.

**Principles, as implemented**

1. **Monochrome by default; oxblood means act now.** `#8A1C1C` appears only for CRITICAL anomalies, INVALID SIGNATURE verification events, a stored code that no longer verifies, a broken audit chain, a missing signing key, errors and destructive actions. Everything else is told by five status marks (§3.5).
2. **Monospace only for identifiers and hashes**, with the full value as a tooltip.
3. **One time zone.** Every date is UTC and says so (`01 OCT 2026 · 10:57 UTC`); the top bar carries an INTERNAL tag and a clock updated every 30 s.
4. **Irreversible means typed.** Destructive actions open a dialog marked by a 3 px oxblood top rule; the irreversible ones also require a typed phrase (e.g. `REVOKE KEY 3`) before the confirm button activates. Issuance says *"Signing is irreversible: the identity and serial are consumed."*
5. **Secrets are shown once.** The claim code appears once on an ivory, bracketed panel with COPY and *"I have recorded it — hide"*; only its scrypt hash is stored. A re-issued code is kept in memory only and forgotten at sign-out.
6. **Roles shape the interface.** Controls a role cannot use are not shown (AUDITOR reads, OPERATOR mutates, ADMIN for keys, revocation, reinstatement and categories).
7. **Everything is recorded, and the console says so.** "Every download is recorded in the audit log"; "Internal use only · All actions are recorded" on the sign-in screen.
8. **The console may see what the public never does**: risk scores, genome checks, payload hashes, anomaly rules. None of it ever reaches `/verify`.
9. **Print files are vector by default.** Width 30 mm, 600 dpi, decor on, label off; the cell pitch is shown as the width changes (`CELL PITCH 0.60 MM`).

![Console dashboard: ivory sidebar, KPI figures, hairline bars by status and by severity, signing key](assets/ui/admin-01-dashboard.png)

*Dashboard, 1 440 × 900.* Four figures in 46 px light numerals separated by hairlines; products by lifecycle status and open anomalies by severity as 3 px ink bars on a 1 px track (zero rows recede to `--metal`); the signing key in force; recent verification events below the fold.

![Console product page for O26-J-00184: GENOME on its orbit around the seal on an ivory plate, fact sheet with status marks](assets/ui/admin-02-product.png)

*Product page, O26-J-00184.* The GENOME on its orbit around the SEAL, on an ivory plate framed by brackets, with fingerprint and glyph ids; the fact sheet (spec §22) with a status mark per line. The SIGNATURE line is a live re-verification of the stored code, not a stored flag.

![Generator result: issued identity O26-J-00200, hidden claim code, GENOME and signed code facts, code preview and print options](assets/ui/admin-03-generator-result.png)

*Generator result (full page).* The issued identity, the claim code panel after *hide*, the GENOME and the signed-code facts, and the print panel: the code preview rendered in the browser from the signed data with the same encoder as print, width, theme (Black on white, White on black, Ink on ivory), resolution, label and decor options, SVG / PNG / PDF.

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

Physical test kit: [`assets/test-sheets/orbes-code-test-sheets.pdf`](assets/test-sheets/orbes-code-test-sheets.pdf), with one SVG per page. Seven renditions (black on white, white on black, ivory, matte grey 92 %, textured paper, black leather, metallic), each at 10–50 mm on cut-out tags with crop marks, a results table and a 10 mm scale bar. Every tag is labelled `SAMPLE - NOT VALID` and verifies as INVALID SIGNATURE in production, which still proves the scanner read it.

---

## 8. Deviations to resolve

Places where the implementation departs from this system or from itself. None affects decoding or security.

1. **Three renderings of the wordmark.** theorbes.com shows ORBES as a raster logo (geometric sans, base64 PNG in `index.html`). The apps typeset it in Helvetica Neue at 0.62 em (`.wordmark`, `genome/src/web/shared/brand.css`; 0.55 em small; console sidebar `genome/src/web/admin/styles.css` `.side__wordmark`); the vocabulary specimen at 0.42 em, weight 300 (`genome/scripts/genome-symbol-study.ts`); the print label in stroked geometric lettering at 0.9 cap-height tracking (`genome/src/server/render/print-sheet.ts` `LABEL_LAYOUT`). A single vector wordmark should replace all four.
2. **Ink.** theorbes.com uses `#000000`; the apps use `--ink: #0A0A0A`, while the scanner ground is pure `#000` (`genome/src/web/verify/styles.css`, `body[data-screen="scan"]`, `.view--scan`). The ivory colourway prints `#111111` (`ORBES_CODE_STYLES.ivory`) but the same GENOME on the ivory plates on screen is drawn in `#0A0A0A` (`genome/src/web/admin/ui/figures.ts`, `genome/src/web/verify/genome-view.ts` via `currentColor`).
3. **`--metal` used for text that must be read**, against its own comment ("never used for text that must be read", 2.8 : 1, 2.5 : 1 on ivory): console navigation group titles `.side__group-title`, the sign-in foot "Internal use only · All actions are recorded" `.login__foot`, zero-value bar labels `.bar--zero`, and input placeholders `.cinput::placeholder` (`genome/src/web/admin/styles.css`). The `--ink-soft` comment also states 6.4 : 1; the measured ratio is 6.7 : 1 (`brand.css`).
4. **The reference customers are asked to quote is 7 px.** Non-authentic results say "Please quote the reference below", but `REF …` is set at 7 px, `--ink-soft` (`.result__meta`, `genome/src/web/verify/styles.css`). It should be at least 10 px.
5. **Repeated sentence for owners.** When the owner's piece has unusual activity elsewhere, the server message already says "Unusual activity has been recorded for it; ORBES Client Services can assist you." (`genome/src/server/services/copy.ts`, `UNUSUAL_ACTIVITY_OWNER_COPY`) and the client adds a notice with the same sentence (`genome/src/web/verify/view-model.ts`, line 190). One of the two should go.
6. **A forged genome version invites a rescan.** An unsupported genome version answers MALFORMED_CODE, "This code could not be read. Please scan it again…", for a code that was read perfectly ([counterfeit simulation](reports/counterfeit-simulation.md), gap 4a; `genome/src/server/services/verification.ts`).
7. **Favicons do not follow the SEAL proportions.** `genome/src/web/verify/favicon.svg` (core r 4.2, ring 8.3–10.7) and `genome/src/web/admin/favicon.svg` (core r 5, ring 8.5–10.5) differ from each other and from the SEAL (core 2 : gap 1 : ring 1, i.e. core r 5.35 for a ring to 10.7). Derive both from `CODE01.seal`.
8. **Token drift.** `--track-display` and `--fs-lead` are defined and unused; 25 distinct tracking values and 21 pixel font sizes (7, 8.5, 9, 10.5, 11.5, 12.5, 17, 19 px…) are hard-coded in `genome/src/web/verify/styles.css` and `genome/src/web/admin/styles.css`.
9. **Two primary buttons.** `brand.css` defines "the single hairline button" (outlined, fills on hover); the console's `.cbtn--primary` is filled ink and inverts on hover (`genome/src/web/admin/styles.css`). Defensible for a dense tool, but it should be a stated exception.
10. **Status comment.** `genome/src/web/admin/model/tone.ts` describes *alert* as an "inverted label"; the CSS draws a rotated square and a bold label (`.status--alert`).
11. **Date formats.** `/verify` writes `1 OCT 2026 · 14:32` in local time (`genome/src/web/verify/view-model.ts`); the console writes `01 OCT 2026 · 14:32 UTC` (`genome/src/web/admin/format.ts`). UTC in the console is deliberate; the zero-padded day is not explained.
12. **Identifier case.** The dashboard KPI uppercases the key id (`ORBES-K001-…`) through `.kpi__note { text-transform: uppercase }`, while the definition list beside it shows the true lower-case `orbes-k001-…` (`genome/src/web/admin/styles.css`, `genome/src/web/admin/model/dashboard.ts`).
13. **Colourway names.** `classic` in the core (`ORBES_CODE_STYLES`, ORBES-CODE-SPEC §8.3) is `black` in the artifact API and console (`genome/src/server/render/scene.ts`, `genome/src/web/admin/types.ts`) and "Black on white" in the console's theme menu.
14. **Below-minimum sizes are not flagged.** The console accepts 5–500 mm (`genome/src/web/admin/ui/artifacts.ts`, `genome/src/server/render/artifact.ts` `ARTIFACT_LIMITS`) and shows only the cell pitch. A quiet warning under 30 mm (§2.6) would prevent unreadable prints.
15. **Specimen palette.** `docs/assets/genome-01-vocabulary.svg` uses paper `#F7F5F0` and grey `#8A8780` (`SPECIMEN_PAPER`, `SPECIMEN_MUTED` in `genome/scripts/genome-symbol-study.ts`), not ivory `#F6F2EA` and `--ink-soft` / `--metal`.
16. **Quiet band wording in the spec.** ORBES-CODE-SPEC §3 counts the band "between data and moons" as a quiet zone and §9 says quiet zones "MUST be free of ink", yet the decor horizon (r 24.0) and outer guide (r 23.5) are printed in that band by design (`genome/src/core/code/primitives.ts`; the horizon is about 34 % contrast in the classic colourway). The spec should limit "free of ink" to the seal quiet ring and the outer 2 u zone, and allow decor at ≥ 0.6 u clearance.
17. **Customer vocabulary.** The AUTHENTIC message says "registered to an active **product**" (`genome/src/server/services/copy.ts`); every other customer sentence says "piece".
18. **Platform fonts.** No web font is shipped, so Android and Windows visitors see Roboto or Arial and never the light weight (§3.1). Licensing and bundling a Helvetica Neue cut, or choosing a deliberate fallback, would make the experience consistent.
19. **"REGISTRATION OPEN" after it has closed.** When the registration window of a scan has expired, the OWNERSHIP tab still heads the panel REGISTRATION OPEN above "The registration window of this scan has closed." (`genome/src/web/verify/views/ownership.ts`, `registerBlock`).

---

## 9. Reproducing the screenshots

```sh
cd genome && npx tsx scripts/capture-ui.ts          # writes docs/assets/ui/*.png
cd genome && npx tsx scripts/capture-ui.ts --raw    # truecolour PNGs instead of quantised ones
```

`genome/scripts/capture-ui.ts` builds the web apps with `scripts/build-web.ts` (production mode, into a temporary directory), seeds the demo dataset into an in-memory PGlite database through the real services (`seedDemo`), starts the real server (`createContext` + `buildApp`), and drives Chromium (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, or `ORBES_CHROMIUM`) through playwright-core:

- **Verify**: 390 × 844 CSS px at 2×, iPhone user agent, Europe/Paris. The camera is Chromium's fake capture device playing simulated hand-held video of O26-J-00184's code (`cameraClipFrames` from `genome/test/e2e/support.ts`). The unusual-activity and invalid-signature results go through the real photo-upload path.
- **Console**: 1 440 × 900 CSS px at 1×, signed in as a bootstrap ADMIN; the generator result is a real issuance through the form.

Nothing is mocked. To photograph transient states, the decoder worker script is held until the scanner has been captured searching, and `POST /api/v1/verify` is held while the locked scanner and the VERIFYING… screen are captured. Before capture the verify film grain is hidden through the CSSOM (invisible at this scale, it would roughly triple the files), and the generator's claim code is hidden with the console's own control. PNGs are quantised to an exact 256-colour palette (median cut, each entry snapped to the most frequent exact colour of its box, no dithering), so `#FFFFFF`, `#0A0A0A`, `#F6F2EA` and `#5C5C5C` survive bit-exact; the set weighs about 1.2 MB. Product ids and dates in the captures depend on the run (the generator allocates the next serial; times are the capture time).
