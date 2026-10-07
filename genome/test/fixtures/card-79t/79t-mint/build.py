#!/usr/bin/env python3
# Builds card.html for 79g-b-air: 79f (B · SINGLE LINE, 95 x 62 mm) with the rule moved out towards the trim, further from the content, and 25 % thinner. One face.
# All geometry in mm (SVG viewBox = card in mm). Text is placed by its INK edges (side bearings removed).
import re, pathlib, math
import sys as _sys; _sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent)); from tex import textured, guilloche_text
TEXTURE = 'guilloche'   # owner: a refined texture on the monogram, nothing too bold
TEX_BASE, TEX_LINE = '#F1F1EE', '#B4B4B1'   # owner: the whole monogram lighter, it was too visible (79j: #EBEBE8 / #8F8F8C)
TEX_SW = 0.06                                # the guilloche's lines (79j: 0.065)
from fontTools.ttLib import TTFont, TTCollection
from fontTools.pens.boundsPen import BoundsPen

HERE = pathlib.Path(__file__).resolve().parent
A = HERE.parent / 'assets'

def inner(svg):
    svg = re.sub(r'<\?xml[^>]*\?>', '', svg)
    svg = re.sub(r'<!--.*?-->', '', svg, flags=re.S)
    return re.search(r'<svg[^>]*>(.*)</svg>', svg, re.S).group(1).strip()

code_inner = inner((A / 'orbes-code-sample.svg').read_text())
code_flat = re.sub(r'<rect[^>]*fill="#FFFFFF"/>', '', code_inner, count=1)   # stock is the ground; code untouched
genome_inner = inner((A / 'genome-row.svg').read_text())
mono_d = ' '.join(re.findall(r'<path class="st0" d="([^"]+)"', (A / 'orbes-monogram.svg').read_text()))

# ---------- type metrics ----------
class Face:
    def __init__(self, font):
        self.cm, self.hm, self.gs = font.getBestCmap(), font['hmtx'], font.getGlyphSet()
        self.cache = {}
    def adv(self, c): return self.hm[self.cm[ord(c)]][0]
    def ink(self, c):  # (lsb, rsb) in units
        if c not in self.cache:
            g = self.cm[ord(c)]; p = BoundsPen(self.gs); self.gs[g].draw(p)
            b = p.bounds or (0, 0, self.adv(c), 0)
            self.cache[c] = (b[0], self.adv(c) - b[2])
        return self.cache[c]

GF = Face(TTFont(str(A / 'gravesend-sans-500.woff2')))
HN = TTCollection('/System/Library/Fonts/HelveticaNeue.ttc')
HF = {400: Face(HN.fonts[0]), 300: Face(HN.fonts[7])}
G_CAP, H_CAP = 0.640, 0.714

def metrics(face, s, fs, ls):
    """advance width (incl. trailing tracking), ink width, left bearing (mm)"""
    adv = sum(face.adv(c) for c in s) / 1000 * fs + len(s) * ls * fs
    lsb = face.ink(s[0])[0] / 1000 * fs
    rsb = face.ink(s[-1])[1] / 1000 * fs
    ink = adv - ls * fs - lsb - rsb
    return adv, ink, lsb

INK = '#0A0A0A'

def text(face_key, x, base, s, fs, ls, align='start', fill=INK):
    """x is the INK edge (start / end) or the INK centre (middle)."""
    face = GF if face_key == 'g' else HF[face_key]
    adv, ink, lsb = metrics(face, s, fs, ls)
    if align == 'start': x0 = x - lsb
    elif align == 'end': x0 = x - ink - lsb
    else: x0 = x - ink / 2 - lsb
    fam = 'font-family="Gravesend"' if face_key == 'g' else f'font-family="Helvetica Neue" font-weight="{face_key}"'
    return (f'<text x="{x0:.3f}" y="{base:.3f}" {fam} font-size="{fs:.3f}" '
            f'letter-spacing="{ls*fs:.4f}" fill="{fill}">{s}</text>'), ink

def run(x, base, parts, fs, ls, wt=400):
    """Gravesend words + Helvetica Neue digits, digit cap height matched to Gravesend's. x = ink start."""
    out, cx, first = [], x, True
    hfs = fs * G_CAP / H_CAP
    for s, f in parts:
        face = GF if f == 'g' else HF[wt]
        size, track = (fs, ls) if f == 'g' else (hfs, ls * fs / hfs)
        adv, ink, lsb = metrics(face, s, size, track)
        x0 = cx - lsb if first else cx
        fam = 'font-family="Gravesend"' if f == 'g' else f'font-family="Helvetica Neue" font-weight="{wt}"'
        out.append(f'<text x="{x0:.3f}" y="{base:.3f}" {fam} font-size="{size:.3f}" letter-spacing="{track*size:.4f}" fill="{INK}">{s}</text>')
        cx = x0 + adv; first = False
    last_s, last_f = parts[-1]
    face = GF if last_f == 'g' else HF[wt]
    size, track = (fs, ls) if last_f == 'g' else (hfs, ls * fs / hfs)
    ink_end = cx - track * size - face.ink(last_s[-1])[1] / 1000 * size
    return '\n'.join(out), ink_end - x

def run_width(parts, fs, ls, wt=400):
    _, w = run(0, 0, parts, fs, ls, wt); return w


# ---------- grid ----------
W, H = 95.0, 62.0                  # owner: the card bigger, the content unchanged, bigger margins
STOCK = '#FBFBF9'
HAIR = 0.1

# double rule frame (Oxford rule): 0.25 mm outside, 0.1 mm inside, 2 mm apart (centre to centre)
F_OUT_W, F_IN_W = 0.20, 0.09      # owner: the outline 20 % thinner (0.25 -> 0.20), the inline 10 % thinner (0.10 -> 0.09)
FRAME_OUT = 3.75                   # the outer rule's outer edge, mm inside the trim
FO = FRAME_OUT + F_OUT_W / 2       # outer rule centre
FI = FO + 2.0                      # inner rule centre
IN = 8.0                           # the content's outer bound, 8 mm inside the trim (unchanged from 79f)
CLEAR_MID = ((FO + F_OUT_W / 2) + (FI - F_IN_W / 2)) / 2   # middle of the white between the two rules' facing edges

CODE = 32.0                        # ORBES CODE svg box; its visible ring is 30.77 mm
RING = CODE * (25 - 24.04) / 50
QZ = 3.5                           # quiet zone kept on every side (>= 2.5): the ring 11.5 mm inside the trim, as in 79f
RING_L = RING_T = IN + QZ          # ring sits 2.55 mm inside the frame
CODE_X = CODE_Y = RING_L - RING
RING_R = RING_L + CODE - 2 * RING
RING_B = RING_T + CODE - 2 * RING
CC_FS = 3.645                      # Helvetica Neue Light, cap height 2.60 mm
cc_ls = 0.032
_, cc_w, _ = metrics(HF[300], '7MSE-SK34-PWMC', CC_FS, cc_ls)
GUT = (W - IN - RING_R - cc_w) / 2 # the column takes the claim code's measure, equal air to the ring and to the frame
RX0 = RING_R + GUT                 # right column: equal air to the ring and to the frame
RX1 = W - IN - GUT
RW = RX1 - RX0
TOP = RING_T                       # ring top = ORBES cap top
BOT = H - IN - QZ               # last step baseline: as far above the bottom rule as the ring sits below the top rule

o = []

# ---------- frame with two centred breaks (top: CERTIFICATE OF AUTHENTICITY, bottom: the safety line)
LEG, LEG_LS = 1.0, 0.24             # both legends: one size, one tracking (as the CLAIM CODE label)
LEG_GAP = 1.4                       # the rules have faded to nothing this far from the text's ink, the same on all four sides
cert = 'MINT CERTIFICATE'   # owner's choice (79s-a), replacing CERTIFICATE OF AUTHENTICITY
ver = 'VERIFY ONLY AT VERIFY.THEORBES.COM'
_, cert_w, _ = metrics(GF, cert, LEG, LEG_LS)
_, ver_w, _ = metrics(GF, ver, LEG, LEG_LS)
# Chrome sets these two runs a hair short of their font metrics (measured at 24x: 0.028 and 0.043 mm over the run,
# the first letter exactly where computed): use the ink as it renders, so the text sits on the axis and the white is equal.
cert_w -= 0.028 * len(cert) / 27; ver_w -= 0.043
gt, gb = cert_w / 2 + LEG_GAP, ver_w / 2 + LEG_GAP   # half-breaks, top and bottom, both rules cut alike
# Modern frame B: one fine rule instead of the double one, cut cleanly round each legend (the legend centred on the rule).
SW = 0.15 * 0.75                   # owner: the outline 25 % thinner (0.15 -> 0.1125 mm)
def frame1(inset, sw):
    x0, x1, y0, y1 = inset, W - inset, inset, H - inset
    d = (f'M{W / 2 - gt:.3f} {y0:.3f}H{x0:.3f}V{y1:.3f}H{W / 2 - gb:.3f}'
         f'M{W / 2 + gb:.3f} {y1:.3f}H{x1:.3f}V{y0:.3f}H{W / 2 + gt:.3f}')
    return f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="{sw}" stroke-linecap="butt" stroke-linejoin="miter"/>'
RULE_Y = 5.25                      # owner: the outline further from the content, using the bigger margin: 5.25 mm inside the trim (79f: 6.5), so 6.25 mm from the content (79f: 5)
o.append(frame1(RULE_Y, SW))
CLEAR_MID = RULE_Y
cap = LEG * G_CAP
LEG_STYLE = ' style="font-kerning:none"'   # metrics above are unkerned: the ink is exactly where computed
t, _ = text('g', W / 2 - cert_w / 2, CLEAR_MID + cap / 2, cert, LEG, LEG_LS); o.append(t.replace('<text ', '<text' + LEG_STYLE + ' ', 1))
t, _ = text('g', W / 2 - ver_w / 2, H - CLEAR_MID + cap / 2, ver, LEG, LEG_LS); o.append(t.replace('<text ', '<text' + LEG_STYLE + ' ', 1))
print('legends: cert w', round(cert_w, 2), 'ver w', round(ver_w, 2), 'breaks', round(2 * gt, 2), round(2 * gb, 2),
      'cap centre', round(CLEAR_MID, 3), 'white between rules', round(FI - F_IN_W / 2 - FO - F_OUT_W / 2, 3))

# ---------- ORBES CODE, flat K on unembossed stock
CODE_DX = -0.748   # owner: align the ORBES CODE with the steps on the left: the code's black ink on the step numbers' left edge (only the code moves)
o.append(f'<svg x="{CODE_X + CODE_DX:.3f}" y="{CODE_Y:.3f}" width="{CODE}" height="{CODE}" viewBox="-25 -25 50 50">{code_flat}</svg>')

# ---------- the steps: flush left on the ring's left edge, step 3 on the lower claim rule
STP, STP_LS = 1.05, 0.2
hfs = STP * G_CAP / H_CAP
steps = ['SCAN THE ORBES CODE', 'ENTER THE CLAIM CODE', 'THE PIECE IS REGISTERED TO YOU']
NUM_W = max(metrics(HF[400], d, hfs, 0)[1] for d in '123')
IND = NUM_W + 1.35
spitch = 1.68
sb = [BOT - (2 - i) * spitch for i in range(3)]
for i, words in enumerate(steps):
    t, _ = text(400, RING_L + NUM_W / 2, sb[i], str(i + 1), hfs, 0, align='middle'); o.append(t)
    t, _ = text('g', RING_L + IND, sb[i], words, STP, STP_LS); o.append(t)
print('quiet under code', round(sb[0] - STP * G_CAP - RING_B, 2))

# ---------- claim: label, rule, code, rule (lower rule on the last step's baseline), full column measure
PAD = 1.95
r_lo = BOT
CLAIM_UP = 0.0
cc_b = r_lo - CLAIM_UP          # owner: the claim block bottom-aligned with the three steps (the claim code on step 3's baseline; 79l: 1 mm higher)
r_hi = cc_b - CC_FS * H_CAP - PAD
LAB, LAB_LS = 1.0, 0.24
lab_b = r_hi - 1.55
# owner: no rule under the claim code any more; the rule under CLAIM CODE · KEEP IT PRIVATE a little higher
RULE_UP = 0.6
LAB_DOWN = 0.5    # owner: CLAIM CODE · KEEP IT PRIVATE and its line slightly lower (the claim code and the column's rhythm stay put)
o.append(f'<line x1="{RX0:.3f}" x2="{RX1:.3f}" y1="{r_hi - RULE_UP + LAB_DOWN:.3f}" y2="{r_hi - RULE_UP + LAB_DOWN:.3f}" stroke="{INK}" stroke-width="{HAIR}"/>')
t, _ = text(300, (RX0 + RX1) / 2, cc_b, '7MSE-SK34-PWMC', CC_FS, cc_ls, align='middle'); o.append(t)
t, _ = text('g', RX0, lab_b + LAB_DOWN, 'CLAIM CODE · KEEP IT PRIVATE', LAB, LAB_LS); o.append(t)
lab_top = lab_b - LAB * G_CAP
print('gutter', round(GUT, 3), 'column', round(RX0, 2), round(RX1, 2), 'w', round(RW, 2), 'claim ink w', round(cc_w, 2), 'cap', round(CC_FS * H_CAP, 3))

# ---------- the right column: ORBES / ref / genome beside the monogram, then the piece, then the claim; one rhythm
ORB_FS, ORB_LS = 2.0, 0.62
REF = 2.2
DAT, DAT_LS = 1.2, 0.2
pitch = 1.95
gparts = [('GENOME ', 'g'), ('G1-E1DC-BE52', 'h')]
gid_w = run_width(gparts, LAB, LAB_LS)
gscale = gid_w / 25.43
grow_h = 2 * gscale
G_GAP = 1.25
gen_h = grow_h + G_GAP + LAB * G_CAP
orb_cap, ref_cap, mod_h = ORB_FS * G_CAP, REF * H_CAP, DAT * G_CAP + 2 * pitch
a = orb_cap + ref_cap + gen_h
g = (lab_top - TOP - a - mod_h) / 4    # equal air: ORBES | ref | genome | piece | claim label
D = a + 2 * g                           # the upper block: ORBES cap top to the genome's baseline
print('rhythm', round(g, 2), 'upper block', round(D, 2))

orb_b = TOP + orb_cap
t, orb_w = text('g', RX0, orb_b, 'ORBES', ORB_FS, ORB_LS); o.append(t)
ref_b = orb_b + g + ref_cap
t, ref_w = text(300, RX0, ref_b, 'O26-J-00184', REF, 0.05); o.append(t)
gid_b = TOP + D
g_top = gid_b - LAB * G_CAP - G_GAP - grow_h
o.append(f'<g transform="translate({RX0 + 1 * gscale:.3f} {g_top + grow_h / 2:.3f}) scale({gscale:.4f})">{genome_inner}</g>')
t, _ = run(RX0, gid_b, gparts, LAB, LAB_LS); o.append(t)
d1 = gid_b + g + DAT * G_CAP
t, mw = text('g', RX0, d1, 'MONOLITHE · BRACELET', DAT, DAT_LS); o.append(t)
# owner: the size on the same line as the variant
vparts = [('BLUE', 'g'), ('  ·  ', 'g'), ('SIZE ', 'g'), ('17', 'h')]
t, _ = run(RX0, d1 + pitch, vparts, DAT, DAT_LS); o.append(t)
sparts = [('925', 'h'), (' STERLING SILVER', 'g')]
t, sw = run(RX0, d1 + 2 * pitch, sparts, DAT, DAT_LS); o.append(t)
print('ORBES w', round(orb_w, 2), 'ref w', round(ref_w, 2), 'genome w', round(gid_w, 2), 'model w', round(mw, 2), 'size w', round(sw, 2),
      'check label gap', round(lab_top - (d1 + 2 * pitch), 2))

# ---------- THE MONOGRAM, top right of the column: printed flat in one light grey (no emboss, no circle, no lettering)
# right-aligned on the claim code's right ink edge (RX1), centred on the upper block (ORBES cap top .. GENOME baseline)
GREY = '#C4C4C2'                        # Pantone Cool Gray 3 U, or a 28 % K tint
MB = (42.90, 100.15, 457.32, 416.69)   # outer bbox of the monogram in its 0..500 viewBox (the O), measured with getBBox (was 79.73 / 417.11 high)
MONO_W = 13.0                           # owner: back to the smaller monogram (79j: 15.0)
ms = MONO_W / (MB[2] - MB[0]); mono_h = (MB[3] - MB[1]) * ms
MCX = RX1 - MONO_W / 2
# owner: the monogram centred between O26-J-00184 and the GENOME glyphs: its centre on the middle of the reference's
# cap top and the glyph row's foot (it overhangs both equally)
# on the ink as it renders (measured at 6x): O26's top sits 0.143 mm under its nominal cap line, the glyphs' foot 0.164 mm under the row's box
MCY = ((ref_b - ref_cap + 0.143) + (g_top + grow_h + 0.164)) / 2
mx, my = MCX - MONO_W / 2 - MB[0] * ms, MCY - mono_h / 2 - MB[1] * ms
def mono_x_at(y):  # left edge of the monogram's O (an ellipse) at height y
    dy = abs(y - MCY); ry = mono_h / 2; rx = MONO_W / 2
    return MCX - rx * math.sqrt(max(0.0, 1 - (dy / ry) ** 2)) if dy < ry else MCX
print('monogram', round(MONO_W, 2), 'x', round(mono_h, 2), 'top', round(MCY - mono_h / 2, 2), 'bottom', round(MCY + mono_h / 2, 2),
      ' air: ORBES', round(mono_x_at(orb_b - orb_cap / 2) - (RX0 + orb_w), 2),
      ' ref', round(min(mono_x_at(ref_b), mono_x_at(ref_b - ref_cap)) - (RX0 + ref_w), 2),
      ' genome row', round(min(mono_x_at(g_top), mono_x_at(g_top + grow_h)) - (RX0 + gid_w), 2),
      ' genome id', round(mono_x_at(gid_b - LAB * G_CAP) - (RX0 + gid_w), 2),
      ' to frame top', round(MCY - mono_h / 2 - IN, 2), ' to claim label', round(lab_top - (MCY + mono_h / 2), 2))
# owner: layered on the guilloche monogram, a spaced 2026 in Gravesend, filled with the same guilloche;
# a halo of bare stock cuts it out of the monogram so it reads as its own layer. Centred on the monogram.
YEAR, YEAR_FS, YEAR_LS, YEAR_HALO = '2026', 2.4, 0.40, 0.165   # owner: the year smaller (79m: 3.0) and its white outline 25 % thinner (79m: 0.22)
yt, year_w = text('g', MCX, MCY + YEAR_FS * G_CAP / 2, YEAR, YEAR_FS, YEAR_LS, align='middle')
yt = yt.replace('<text ', '<text style="font-kerning:none" ', 1)
year_svg = guilloche_text(yt, MCX - MONO_W / 2, MCX + MONO_W / 2, MCY - 3, MCY + 3, MCX, TEX_BASE, TEX_LINE, TEX_SW, STOCK, YEAR_HALO)
print('year w', round(year_w, 2), 'cap', round(YEAR_FS * G_CAP, 2))
o.insert(0, f"""<rect width="{W}" height="{H}" fill="{STOCK}"/>
<!-- the monogram: the one light grey ink, with a fine security texture inside its outline -->
""" + textured(TEXTURE, mono_d, mx, my, ms, MCX, MCY, MONO_W, mono_h, TEX_BASE, TEX_LINE, TEX_SW)
         + '\n' + year_svg)
import json
(HERE / 'detail.json').write_text(json.dumps({'x': MCX - MONO_W / 2 - 1.2, 'y': MCY - mono_h / 2 - 1.2, 'w': MONO_W + 2.4, 'h': mono_h + 2.4}))

face = f'<svg class="face" viewBox="0 0 {W} {H}" width="{W}mm" height="{H}mm">' + '\n'.join(o) + '</svg>'
html = f"""<!doctype html>
<!--
  ORBES card, 79g-b-air ENGRAVED · MONOGRAM, B · SINGLE LINE, {W:g} x {H:g} mm (77 MQ · ENGRAVED with the ORBES monogram in light grey). ONE SIDE ONLY (the back is blank).
  Stock: 600 g bright-white cotton board (e.g. Gmund Cotton Max White), uncoated.
  Pass 1, static, offset, one flat light grey: the ORBES monogram, {MONO_W:.1f} x {mono_h:.1f} mm, top right of the data column,
  printed flat (no emboss, no foil, no circle or lettering around it). The grey is a second ink, a cool light grey
  (Pantone Cool Gray 3 U, about {GREY}); for a shorter run it can instead be a 28 % K tint on the HP Indigo pass (pass 3).
  It never touches the ORBES CODE, its quiet zone or the claim code.
  Pass 2, static, die-stamped (engraved) in black: one fine rule ({SW:.4g} mm, mitred corners, {RULE_Y} mm inside the trim) with CERTIFICATE OF AUTHENTICITY set into its top rule and
  VERIFY ONLY AT VERIFY.THEORBES.COM into its bottom rule (one size, one tracking, each centred, {LEG_GAP} mm of white
  between the lettering and the rule ends on both sides, both rules cut alike).
  Pass 3, variable data, HP Indigo, 100 % K: the ORBES CODE (flat K on unembossed stock), the claim code,
  the piece's data, the GENOME row and its ID, the steps. Hairlines 0.1 mm. Every mark at least {RULE_Y - SW / 2:.2f} mm inside the trim.
-->
<html><head><meta charset="utf-8"><title>ORBES card 79t-mint</title>
<style>
@font-face {{ font-family: 'Gravesend'; src: url('../assets/gravesend-sans-500.woff2') format('woff2'); font-weight: 500; }}
body {{ margin: 0; padding: 10mm; background: #d9d8d4; }}
.card {{ width: {W:g}mm; height: {H:g}mm; position: relative; overflow: hidden; }}
.face {{ display: block; width: {W:g}mm; height: {H:g}mm; }}
text {{ font-kerning: normal; white-space: pre; }}
</style></head><body>
<div id="front" class="card">{face}</div>
</body></html>"""
(HERE / 'card.html').write_text(html)
print('ok')
