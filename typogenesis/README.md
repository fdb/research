# typogenesis

**Breed typefaces in your browser. Download real fonts.**

A generative type foundry as a single no-build web app. Every typeface is a
**genome**: fourteen genes (weight, contrast, width, x-height, cap height,
ascender, descender, roundness, aperture, slant, pen angle, taper, serif
length, serif weight), each a number between 0 and 1.

## How it works

```
genome ──resolve──▶ design params ──skeletons──▶ strokes ──pen──▶ outlines
                                                                   │
                    canvas preview ◀── render ◀────────────────────┤
                    installable .ttf ◀── ttf compiler ◀────────────┘
```

1. **Skeletons** (`js/glyphs.js`) — ~70 glyphs (A–Z, a–z, 0–9, punctuation)
   defined as parametric centerline strokes: lines, polylines, superellipse
   arcs. The roundness gene is the superellipse exponent, so bowls morph
   continuously from diamond through circle to near-square.
2. **The pen** (`js/pen.js`) — walks each stroke and offsets both sides with
   a direction-dependent thickness, like a broad nib: the contrast and pen
   angle genes set how thin cross-strokes get and where the stress axis
   sits. Round caps, taper, and serif slabs are applied at stroke ends.
   Overlaps are resolved by nonzero winding — no boolean geometry anywhere.
3. **Evolution** (`js/genome.js`) — gaussian mutation and uniform crossover.
   The Evolve grid shows a litter of offspring; tapping one makes it the new
   parent. Taste is the fitness function.
4. **The compiler** (`js/ttf.js`) — writes a complete TrueType file from
   scratch: `glyf`, `loca`, `cmap` (format 4), `hmtx`, `hhea`, `head`,
   `maxp`, `name`, `post`, `OS/2`, table directory, checksums,
   `checkSumAdjustment`. No dependencies. The output installs on macOS,
   Windows, Linux, iOS and Android, and validates in fontTools.
5. **The specimen** is honest: the compiled bytes are loaded with the
   FontFace API, so what you read is rendered by the browser's real font
   engine, not by this app's canvas code.
6. **Names** (`js/names.js`) — a tiny generative grammar (a ChoiceWords
   homage) seeded by the genome hash, so a genome always carries the same
   name. The genome also travels in the URL hash — share a link, share the
   font.

## Lineage

Made with, and as an homage to: [opentype.js](https://github.com/opentypejs/opentype.js)
(fonts as bytes), [NodeBox](https://www.nodebox.net) (design as parameters),
[ChoiceWords](https://github.com/fdb/choicewords) (grammar text), and the
long tradition of parametric type from Metafont to variable fonts.

Genuinely no build step: ES modules, canvas 2D, FontFace API. View source.

## Releasing

Bump the `?v=` token in `index.html` (import map + script src, one string,
e.g. `b2` → `b3`) whenever the JS changes. The import map gives every module
a fresh URL, so one HTML load busts all cached modules; the About tab shows
the running build so you can always tell which code a device has. The
repo-root `_headers` file additionally marks `/typogenesis/*` no-cache on
Cloudflare Pages, so browsers revalidate (etag 304) on every load.
