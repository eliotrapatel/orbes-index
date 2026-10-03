# theorbes.com: the display face (proposal)

Status: **proposal, not applied.** Nothing here changes theorbes.com until the owner agrees: the site is the root `index.html`, which this system never modifies. Related: [BRAND-DESIGN-SYSTEM §3.1](../BRAND-DESIGN-SYSTEM.md#31-typography) and §8 item 18, [NOTICE.md](../../NOTICE.md).

## 1. Why

Since 2026-10-02 the verification app (`/verify`) and the console set their wordmark, titles and tracked-capital labels in the brand's display face, Gravesend Sans Medium, shipped as a web font; reading text stays in Helvetica Neue. theorbes.com still sets everything in the system stack `"Helvetica Neue", HelveticaNeue, Helvetica, Arial, sans-serif`. A visitor who goes from the site to `/verify` therefore sees the labels change face. The declaration below makes the site's tracked capitals match the app's, with the same file, the same subset and the same fallback.

## 2. Before applying

1. **Licence.** The web licence for Gravesend Sans (Device, <http://devicefonts.co.uk>) must cover `theorbes.com` as well as `verify.theorbes.com`. This is the owner's to confirm; without it, stop here.
2. **Agreement.** The owner approves the change to `index.html` and the list of elements in §3.3.

## 3. The change

### 3.1 The file

Copy the subset the apps ship, unchanged, to a path Vercel publishes (`.vercelignore` excludes `genome/`), with a version in its name so it can be cached for a year:

```sh
mkdir -p fonts
cp genome/src/web/shared/fonts/gravesend-sans-500.woff2 fonts/gravesend-sans-500.v1.woff2
```

A new subset is a new name (`.v2`), never a replaced file.

### 3.2 `vercel.json`: cache the font

Add a `headers` entry beside the existing `redirects`:

```json
"headers": [
  {
    "source": "/fonts/(.*)",
    "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
  }
]
```

**In the same commit, update `genome/test/ops/vps-stack.test.ts`.** Its `vercel.json` test asserts that the file holds the two `/verify` redirects and nothing else (`Object.keys(vercel)` equal to `['redirects']`), so CI fails on the entry above alone. Change that test to accept exactly `['redirects', 'headers']`, with `headers` equal to the one entry above (the `/fonts/(.*)` source and its single `Cache-Control` header), keep its redirect assertions unchanged, and update the comment at the top of the file that says `vercel.json` holds only the redirects.

### 3.3 `index.html`

In `<head>`, before the `<style>` element:

```html
<link rel="preload" href="/fonts/gravesend-sans-500.v1.woff2" as="font" type="font/woff2" crossorigin>
```

At the top of the `<style>` element, the same declaration as `genome/src/web/shared/brand.css`:

```css
@font-face {
  font-family: "Gravesend Sans";
  src: url("/fonts/gravesend-sans-500.v1.woff2") format("woff2");
  font-weight: 500;
  font-style: normal;
  font-display: swap;
  unicode-range: U+0020-007E, U+00A9, U+00AB, U+00B7, U+00BB, U+00C0-00DD, U+0152-0153, U+0178, U+2013-2014, U+2018-2019, U+201C-201D, U+2022, U+2026, U+2190, U+2192, U+2212;
}
```

Then, on the site's tracked-capital text only, the display stack in place of the system stack:

```css
font-family: "Gravesend Sans", "Helvetica Neue", HelveticaNeue, Helvetica, Arial, sans-serif;
```

| Elements (selectors in `index.html`) | Proposed face |
|---|---|
| `.top-text p`, `.bottom-text p`, `.reveal span`, `#text-rewrite`, `.meta span`, `#cryptic-msg` | Gravesend Sans |
| `#chromatic-btn`, `#snake-btn`, `#trade-rules-btn`, `#trade-night-switch`, `#trade-signal-label`, `#trade-close` | Gravesend Sans |
| `#ghost-text` (it reads *PARIS, 2026*) and `#reveal-countdown` (inside `.reveal span`: within 30 days of the reveal date its script writes *REVEAL IN {d}D {hh}H {mm}M*), set back to the system stack by their own rule after the display one, since `.reveal span` would otherwise reach the countdown | unchanged (Helvetica Neue) |
| `#countdown`, `#snake-score`, `#game-hud`, and any other element that shows figures | unchanged (Helvetica Neue) |
| `html, body` and running text | unchanged (Helvetica Neue) |
| The ORBES logo (raster image) | unchanged: whether the site takes the monogram the apps use (BRAND §3.9) is the brand's choice, BRAND §8 item 1 |

Figures stay in Helvetica Neue for the reason the apps keep them there: Gravesend's figure one is drawn as its capital I, and it has no tabular figures (BRAND §3.1). For the countdown, the rule that keeps it in Helvetica Neue:

```css
#ghost-text,
#reveal-countdown {
  font-family: "Helvetica Neue", HelveticaNeue, Helvetica, Arial, sans-serif;
}
```

## 4. Checks after deploying

- The page shows the labels in Gravesend Sans on an Android phone and on Windows, not only on Apple devices.
- The browser's network panel lists **one** request for `gravesend-sans-500.v1.woff2`, answered `200` with `Cache-Control: public, max-age=31536000, immutable` and `Content-Type: font/woff2`. Two requests mean the preload and the CSS name different URLs or the `crossorigin` attribute is missing.
- No text disappears while the page loads (`font-display: swap`).
- Every countdown, score and other figure still reads in Helvetica Neue: *PARIS, 2026* and the reveal countdown included.
- CI is green on the branch, `genome/test/ops/vps-stack.test.ts` included (§3.2).

## 5. Undo

Remove the `<link rel="preload">`, the `@font-face` block and the display stacks from `index.html`, and the `headers` entry from `vercel.json`, and put `genome/test/ops/vps-stack.test.ts` back to accepting only `['redirects']` in the same commit; the `fonts/` file can stay or go. The site is then exactly as before.
