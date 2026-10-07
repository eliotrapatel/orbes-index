# Textures for the ORBES monogram (owner: "a refined texture on the orbes monogram to show it's a certificate of
# authenticity, nothing too bold"). Everything is clipped to the monogram's own outline and printed in the one light grey
# ink: BASE is a screened tint of it, LINE the solid ink. The overall tone stays about the flat grey's (#C4C4C2).
import math

def _poly(pts):
    return 'M' + 'L'.join(f'{x:.3f} {y:.3f}' for x, y in pts)

def guilloche_path(x0, x1, y0, y1, cx, LINE, sw, pitch=0.30, A=0.42, lam=2.2):
    """Two families of fine sine waves, half a wave apart, crossing into the lattice of a banknote's ground.
    The waves are anchored on the card (cx, and y0 snapped to the pitch), so two areas drawn apart share one lattice."""
    ys = math.floor((y0 - A) / pitch) * pitch
    n = int((y1 + A - ys) / pitch) + 2
    xs = [x0 + j * 0.04 for j in range(int((x1 - x0) / 0.04) + 2)]
    d = []
    for ph in (0.0, math.pi):
        for i in range(n):
            yb = ys + i * pitch
            d.append(_poly([(x, yb + A * math.sin(2 * math.pi * (x - cx) / lam + ph)) for x in xs]))
    return f'<path d="{" ".join(d)}" fill="none" stroke="{LINE}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'

def guilloche_text(text_svg, x0, x1, y0, y1, cx, BASE, LINE, sw, STOCK, halo):
    """A word layered on the monogram, filled with the same guilloche, cut out of the monogram by a halo of bare stock."""
    knock = text_svg.replace(f'fill="', f'stroke="{STOCK}" stroke-width="{2 * halo:.3f}" stroke-linejoin="round" fill="', 1)
    knock = knock.replace('fill="#0A0A0A"', f'fill="{STOCK}"')
    clip = text_svg
    return '\n'.join([knock,
        f'<defs><clipPath id="yclip" clipPathUnits="userSpaceOnUse">{clip}</clipPath></defs>',
        '<g clip-path="url(#yclip)">',
        f'<rect x="{x0:.3f}" y="{y0:.3f}" width="{x1 - x0:.3f}" height="{y1 - y0:.3f}" fill="{BASE}"/>',
        guilloche_path(x0, x1, y0, y1, cx, LINE, sw), '</g>'])

def textured(kind, mono_d, mx, my, ms, cx, cy, w, h, BASE, LINE, sw_line=None):
    x0, x1, y0, y1 = cx - w / 2 - 0.6, cx + w / 2 + 0.6, cy - h / 2 - 0.6, cy + h / 2 + 0.6
    out = [f'<defs><clipPath id="mclip" clipPathUnits="userSpaceOnUse"><path transform="translate({mx:.4f} {my:.4f}) scale({ms:.6f})" d="{mono_d}"/></clipPath></defs>',
           '<g clip-path="url(#mclip)">',
           f'<rect x="{x0:.3f}" y="{y0:.3f}" width="{x1 - x0:.3f}" height="{y1 - y0:.3f}" fill="{BASE}"/>']
    if kind == 'guilloche':
        # two families of fine sine waves, half a wave apart, crossing into the lattice of a banknote's ground
        out.append(guilloche_path(x0, x1, y0, y1, cx, LINE, sw_line or 0.05))
    elif kind == 'microtext':
        # rows of microtext (cap height 0.23 mm: a fine grain to the eye, legible under a loupe), every other row shifted
        fs, pitch = 0.36, 0.43
        phrase = 'ORBES · CERTIFICATE OF AUTHENTICITY · '
        row = phrase * 3
        n = int((y1 - y0) / pitch) + 2
        for i in range(n):
            yb = y0 + (i + 1) * pitch
            out.append(f'<text x="{x0 - (i % 2) * 2.1 - 0.4:.3f}" y="{yb:.3f}" font-family="Gravesend" font-size="{fs}" letter-spacing="{0.08 * fs:.4f}" fill="{LINE}" style="font-kerning:none">{row}</text>')
    elif kind == 'engraved':
        # fine horizontal lines, as a line-engraved (intaglio) monogram
        pitch, sw = 0.20, 0.07
        d = ' '.join(f'M{x0:.3f} {y0 + i * pitch:.3f}H{x1:.3f}' for i in range(int((y1 - y0) / pitch) + 2))
        out.append(f'<path d="{d}" fill="none" stroke="{LINE}" stroke-width="{sw}"/>')
    elif kind == 'rings':
        # fine concentric ellipses on the O's centre, the rings of the ORBES CODE
        pitch, sw = 0.22, 0.07
        k = h / w
        rmax = math.hypot(w, h) / 2 + 0.8
        d = []
        r = pitch / 2
        while r < rmax:
            ry = r * k
            d.append(f'M{cx - r:.3f} {cy:.3f}A{r:.3f} {ry:.3f} 0 1 0 {cx + r:.3f} {cy:.3f}A{r:.3f} {ry:.3f} 0 1 0 {cx - r:.3f} {cy:.3f}Z')
            r += pitch
        out.append(f'<path d="{" ".join(d)}" fill="none" stroke="{LINE}" stroke-width="{sw}"/>')
    out.append('</g>')
    return '\n'.join(out)
