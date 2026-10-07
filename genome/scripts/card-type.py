#!/usr/bin/env python3
"""
Writes src/server/render/card-type.ts: the type of the certificate card 79t
(plan NEXT LOT §3.2) as glyph outlines, so the card's PDF and SVG embed no
font and its claim code is never searchable text.

    python3 scripts/card-type.py            (from genome/; needs fontTools)

Three faces, as 79t's build.py sets them:
  - Gravesend Sans 500, src/web/shared/fonts/gravesend-sans-500.woff2;
  - Helvetica Neue Regular and Light, faces 0 and 7 of the Mac's
    /System/Library/Fonts/HelveticaNeue.ttc.

For each face and each character of CHARSET: its advance, its ink box (the
exact bounds, fontTools' BoundsPen, as build.py measures) and its outline as
absolute path data (M L Q C Z) in font units, y up. Then the kerning pairs
between those characters:
  - Gravesend: its GPOS 'kern' feature (pair adjustment lookups, in lookup
    order; inside a lookup the first subtable that covers the first glyph
    decides, as a shaper applies it);
  - Helvetica Neue: its 'kern' table (format 0). The Light face also has an
    AAT 'kerx' table that fontTools does not read; its 'kern' table is used.

Run once and its output committed, with the source files' SHA-256 in its
header (test/render/card-type.test.ts checks the Gravesend file against the
one the app serves). The output is deterministic for the same sources.
"""
import hashlib
import pathlib
import sys

from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTCollection, TTFont

GENOME = pathlib.Path(__file__).resolve().parent.parent
GRAVESEND = GENOME / 'src/web/shared/fonts/gravesend-sans-500.woff2'
HELVETICA = pathlib.Path('/System/Library/Fonts/HelveticaNeue.ttc')
OUT = GENOME / 'src/server/render/card-type.ts'

# The plan's set (A-Z, 0-9, '-', '·', '.', '/', space; the claim code's Crockford alphabet is inside it), and the
# two other characters toLabelText keeps (':' and '#'), so every character a label text holds has its outline.
CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-·./ :#'


def num(v):
    r = round(float(v), 2)
    if r == int(r):
        return str(int(r))
    return f'{r:.2f}'.rstrip('0').rstrip('.')


class PathPen(BasePen):
    """Absolute M L Q C Z path data; TrueType quadratic runs split into single segments by BasePen."""

    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.out = []

    def _moveTo(self, p):
        self.out.append(f'M{num(p[0])} {num(p[1])}')

    def _lineTo(self, p):
        self.out.append(f'L{num(p[0])} {num(p[1])}')

    def _qCurveToOne(self, p1, p2):
        self.out.append(f'Q{num(p1[0])} {num(p1[1])} {num(p2[0])} {num(p2[1])}')

    def _curveToOne(self, p1, p2, p3):
        self.out.append(f'C{num(p1[0])} {num(p1[1])} {num(p2[0])} {num(p2[1])} {num(p3[0])} {num(p3[1])}')

    def _closePath(self):
        self.out.append('Z')

    def _endPath(self):
        pass


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def gpos_kerning(font, names):
    """{(left, right): value} over `names` from the GPOS 'kern' feature's pair adjustments (XAdvance of the first)."""
    table = font['GPOS'].table
    lookups = sorted({i for fr in table.FeatureList.FeatureRecord if fr.FeatureTag == 'kern' for i in fr.Feature.LookupListIndex})
    pairs = {}
    for li in lookups:
        lookup = table.LookupList.Lookup[li]
        subtables = lookup.SubTable
        if lookup.LookupType == 9:
            subtables = [s.ExtSubTable for s in subtables]
        elif lookup.LookupType != 2:
            continue
        for a in names:
            for b in names:
                for st in subtables:
                    if a not in st.Coverage.glyphs:
                        continue
                    value = None
                    if st.Format == 1:
                        pset = st.PairSet[st.Coverage.glyphs.index(a)]
                        rec = next((r for r in pset.PairValueRecord if r.SecondGlyph == b), None)
                        if rec is None:
                            continue  # a format 1 subtable without the pair lets the next one decide
                        value = rec.Value1
                    else:
                        c1 = st.ClassDef1.classDefs.get(a, 0)
                        c2 = st.ClassDef2.classDefs.get(b, 0)
                        value = st.Class1Record[c1].Class2Record[c2].Value1
                    adv = getattr(value, 'XAdvance', 0) if value is not None else 0
                    if value is not None and (getattr(value, 'XPlacement', 0) or getattr(value, 'YPlacement', 0)):
                        sys.exit(f'GPOS pair {a} {b}: a placement adjustment, which the card does not draw')
                    if adv:
                        pairs[(a, b)] = pairs.get((a, b), 0) + adv
                    break  # the first subtable that covers the first glyph decides, within one lookup
    return pairs


def kern_table(font, names):
    pairs = {}
    for t in font['kern'].kernTables:
        if t.format != 0:
            continue
        for (a, b), v in t.kernTable.items():
            if a in names and b in names and v:
                pairs[(a, b)] = v
    return pairs


def face(font, kerning, title):
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    hmtx = font['hmtx']
    glyph_of = {}
    lines = []
    for ch in CHARSET:
        if ord(ch) not in cmap:
            continue  # a character with no outline is dropped when drawn
        g = cmap[ord(ch)]
        glyph_of[g] = ch
        adv = hmtx[g][0]
        bp = BoundsPen(gs)
        gs[g].draw(bp)
        pen = PathPen(gs)
        gs[g].draw(pen)
        box = 'null' if bp.bounds is None else '[' + ', '.join(num(v) for v in bp.bounds) + ']'
        lines.append(f"    {ts_key(ch)}: {{ a: {num(adv)}, b: {box}, d: '{''.join(pen.out)}' }},")
    pairs = kerning(font, set(glyph_of))
    kern = [f"    {ts_key(glyph_of[a] + glyph_of[b])}: {num(v)}," for (a, b), v in sorted(pairs.items(), key=lambda kv: (glyph_of[kv[0][0]], glyph_of[kv[0][1]]))]
    upm = font['head'].unitsPerEm
    # OS/2's cap height, or the ink top of H for a table too old to hold one (Helvetica Neue Light).
    cap = getattr(font['OS/2'], 'sCapHeight', None)
    if not cap:
        hp = BoundsPen(gs)
        gs[cmap[ord('H')]].draw(hp)
        cap = hp.bounds[3]
    return '\n'.join([
        f'  name: {ts_str(title)},',
        f'  unitsPerEm: {upm},',
        f'  capHeight: {cap},',
        '  glyphs: {',
        *lines,
        '  },',
        '  kern: {',
        *kern,
        '  },',
    ])


def ts_str(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


def ts_key(s):
    return ts_str(s)


def main():
    g = TTFont(str(GRAVESEND))
    hn = TTCollection(str(HELVETICA))
    regular, light = hn.fonts[0], hn.fonts[7]
    for f, want in ((regular, 'Helvetica Neue'), (light, 'Helvetica Neue Light')):
        if f['name'].getDebugName(4) != want:
            sys.exit(f'{HELVETICA}: expected {want}, found {f["name"].getDebugName(4)}')
    body = f"""/**
 * GENERATED by genome/scripts/card-type.py: do not edit; run the script again.
 *
 * The type of the certificate card 79t (plan NEXT LOT §3.2) as glyph outlines:
 * for each face, each character's advance, ink box and outline (absolute path
 * data, M L Q C Z, font units, y up), and the kerning pairs between them.
 * ./card-text.ts sets runs with them, so the card's PDF and SVG carry no font
 * and the claim code is never text.
 *
 * Sources (SHA-256):
 *   gravesend-sans-500.woff2   {sha256(GRAVESEND)}
 *   HelveticaNeue.ttc          {sha256(HELVETICA)} (faces 0, Regular, and 7, Light)
 * Characters: {CHARSET!r}.
 * Kerning: Gravesend's GPOS 'kern' feature; Helvetica Neue's 'kern' table.
 */

export interface CardGlyph {{
  /** Advance width, font units. */
  readonly a: number;
  /** Ink box [xMin, yMin, xMax, yMax], font units, y up; null for a glyph with no ink (the space). */
  readonly b: readonly [number, number, number, number] | null;
  /** Outline, absolute path data in font units, y up (filled non-zero). */
  readonly d: string;
}}

export interface CardFace {{
  readonly name: string;
  readonly unitsPerEm: number;
  /** Cap height, font units (OS/2, or the ink top of H where OS/2 has none). */
  readonly capHeight: number;
  readonly glyphs: Readonly<Record<string, CardGlyph>>;
  /** Kerning of a pair of characters ('AV'), font units, added to the first one's advance. */
  readonly kern: Readonly<Record<string, number>>;
}}

export const CARD_TYPE_SOURCES = Object.freeze({{
  gravesend: {{ file: 'src/web/shared/fonts/gravesend-sans-500.woff2', sha256: '{sha256(GRAVESEND)}' }},
  helveticaNeue: {{ file: '/System/Library/Fonts/HelveticaNeue.ttc', sha256: '{sha256(HELVETICA)}', faces: {{ regular: 0, light: 7 }} }},
}});

/** Gravesend Sans 500: the card's words. */
export const GRAVESEND_SANS: CardFace = {{
{face(g, gpos_kerning, 'Gravesend Sans 500')}
}};

/** Helvetica Neue Regular: the step numbers, the GENOME fingerprint, the digits of the piece's lines. */
export const HELVETICA_NEUE_REGULAR: CardFace = {{
{face(regular, kern_table, 'Helvetica Neue Regular')}
}};

/** Helvetica Neue Light: the serial and the claim code. */
export const HELVETICA_NEUE_LIGHT: CardFace = {{
{face(light, kern_table, 'Helvetica Neue Light')}
}};
"""
    OUT.write_text(body)
    print(f'wrote {OUT.relative_to(GENOME)} ({len(body) / 1024:.1f} KiB)')


if __name__ == '__main__':
    main()
