# nodebox-cartan-library — the Cartan Node Library, on the web

A port of [John Cartan](https://www.cartania.com/nodebox.html)'s **Node
Library 3.6** — the largest community node collection for
[NodeBox 3](https://nodebox.net/node/) (191 nodes for geometry, color,
text, math, lists and data) — to the [unified web NodeBox
engine](/nodebox/) from this repository's `nodebox` experiment.

- **`index.html`** — poster-style gallery of all 191 nodes with
  pre-rendered thumbnails; opening a node evaluates its original demo
  **live in the browser** through the same engine.
- **`engine/`** — the evaluator: `model.js` / `eval.js` / `graphics.js`
  vendored from `/nodebox/core` and extended (text shapes, path booleans
  via vendored [polybooljs](https://github.com/velipso/polybooljs), SVG
  import, NodeBox 3 published-port semantics), plus `n3lib.js` — the
  complete NodeBox 3 standard library re-implemented in JavaScript, and
  `n3-types.js` — port metadata generated from the official `.ndbx`
  library files.
- **`tools/`** — the conversion pipeline (see `tools/README.md`): parses
  the original 188 MB `.ndbx` document, emits per-node JSON documents,
  evaluates every demo headless under Node, and pre-renders the SVG
  thumbnails. Everything it emits is committed, so the site itself stays
  a no-build static project.
- **`data/`** — the converted library: `catalog.json` (index + coverage),
  `nodes/<name>.json` (per-node canonical definition + original demo,
  size-capped), `coverage.json` (full report).
- **`thumbs/`** — pre-rendered SVG thumbnails (rendered by the engine
  itself, headless).
- **`doc/DECISIONS.md`** — every porting decision and deviation, and the
  answer to "can the Python nodes be ported to JavaScript automatically?"

## Coverage

186 of 191 nodes evaluate end-to-end (canonical definition + original
demo) in both headless Node and the browser. The five that don't
(`image`, `list_files`, `list_folders`, `font_table`, `node_card`) need a
local filesystem, installed fonts, or NodeBox application introspection —
capabilities a browser deliberately lacks. Text-outline-dependent nodes
run but degrade (text draws as native text, not glyph outlines).

## Running

Static, like everything here: serve the repo root
(`python3 -m http.server`) and open `/nodebox-cartan-library/`.

Reproduce the conversion (needs the original zip, ~188 MB unpacked):

```sh
node tools/gen-n3-types.mjs
node --max-old-space-size=8192 tools/convert.mjs \
  "/path/to/Node Library 3.6/node library 3-6.ndbx" \
  "assets/Cartan Node Library.csv"
node test/engine.test.mjs
```

## Credits & licenses

The Node Library is © John Cartan — "Free for use without restrictions"
(from the library's Credits node). NodeBox is by the Experimental Media
Research Group, Sint Lucas Antwerpen; the standard-library port metadata
in `tools/ref/` and `engine/n3-types.js` derives from the GPLv2
[nodebox/nodebox](https://github.com/nodebox/nodebox) sources, and
several `n3lib.js` functions are ports of its Java/Jython code.
`engine/polybool.js` vendors polybooljs (MIT, © Sean Connelly).
`gilbert2d` is a port of Jakub Červený's generalized Hilbert curve
(BSD-2); `treemap` ports laserson/squarify (Apache-2.0); `poisson` is
Bridson's algorithm after Christian Hill's write-up.
