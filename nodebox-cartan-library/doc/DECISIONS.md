# Porting decisions — Cartan Node Library 3.6 → the unified web NodeBox

Every choice below names what the original does, what this port does,
and why. "Java" refers to NodeBox 3's evaluator
(`nodebox.node.NodeContext` and friends); "the engine" refers to the
unified web engine vendored from `/nodebox/core` into `engine/`.

## 1. Convert the document, don't emulate the app

Cartan's library is one 188 MB NodeBox 3 `.ndbx` document: ~630,000 node
instances, of which ~109,000 are the canonical definitions of 191
library nodes (NodeBox copies a subnetwork wholesale each time it is
reused; the rest are the per-node demos). The converter
(`tools/convert.mjs`) parses the XML once and emits one JSON file per
node in the unified engine's document format — canonical definition plus
the original demo, size-capped (700 KB / 400 KB minified) so the repo
stays reasonable: 178 definitions and 145 demos ship; every node beyond
the cap still gets its thumbnail, pre-rendered offline from the
in-memory conversion.

## 2. Rebuild the NodeBox 3 standard library, faithfully

The unified engine's stdlib deliberately deviates from NodeBox 3 in
places (port names, 3-way vs 6-way `switch`, `rect` without roundness…),
but Cartan's file stores port values against the *original* definitions.
So this port carries its own standard library:

- **Port metadata is generated, not transcribed**:
  `tools/gen-n3-types.mjs` reads the official `math/list/string/color/
  data/corevector.ndbx` library files (from nodebox/nodebox) and resolves
  their prototype chains into flat port definitions — names, defaults,
  ranges, menus, min/max — with zero manual error.
- **Implementations are hand-ported 1:1** (`engine/n3lib.js`) from
  `MathFunctions.java`, `ListFunctions.java`, `StringFunctions.java`,
  `DataFunctions.java`, `CoreVectorFunctions.java` and `pyvector.py` —
  134 functions, matched by NodeBox function id (`math/add`,
  `pyvector/compound`, …).

## 3. NodeBox 3 evaluation semantics the engine had to learn

The engine's evaluator was already a port of `NodeContext`, but four
load-bearing behaviors only surfaced while running Cartan's graphs
(each is marked with a comment in `engine/eval.js`):

1. **Port forwarding.** Format 21 connects a network's own port to child
   inputs via `<conn output="portName">`; the `childReference` attribute
   is only the original publish record and may be stale after renames.
   One network port can feed several children.
2. **Published list values unwrap** (`NodeContext.renderChild`): when a
   published value is a List, it becomes the child port's whole values
   list — one invocation per element for value-range ports. Cartan's
   list-processing nodes (`drop_last`, `contours`/`redraw`…) depend on
   this. Published data also bypasses type conversion.
3. **Points wrap into geometry ports**
   (`NodeContext.convertResultsForPort`): a list of Points flowing into a
   value-range geometry port becomes ONE list-value — "work with either
   single IGeometry objects or a list of Points". The reverse also holds
   (`postProcessResult`): a value-range node with geometry output
   returning a list of Points flattens into the stream.
4. **Sparse names**: the format omits a node's `name` attribute when it
   equals the prototype's default (`<node prototype="math.e"/>` is a node
   named `e`).

Two deliberate loosenings relative to the engine's stricter conversions,
both matching Java's behavior in practice: `null` flows through type
conversions (functions decide), and values with no defined conversion
pass raw (NodeBox only converts known type pairs — Cartan wires tables
through geometry ports and it works because `doNothing` doesn't care).
NaN is a legal double and flows (Cartan's complex-number tricks use it).

## 4. `data.lookup` is reflection — emulate the getters

Cartan uses `lookup` ~6,800 times, and not just on table rows: Java's
`ReflectionUtils` finds getters on every value type. `n3lib.js`
implements the vocabulary his nodes actually use: point `x/y/type`;
color `red/green/blue/alpha/hue/saturation/brightness` (+ shorthands);
path/geometry `length`, `points`, `pointCount`, `contours`, `closed`,
`bounds` (+ `bounds.width` nesting), `fillColor/strokeColor/strokeWidth`;
and `class.simpleName` for Java-type dispatch (`Path`, `Geometry`,
`Point`, `Color`, `Long`, `Double`, `String`, `ArrayList`, `HashMap`…).

## 5. Text: native text, approximate metrics

NodeBox converts text to font outlines through AWT. Browsers have no
outline API and headless Node has no fonts at all, so `textpath`
produces a **text shape** — drawn via `fillText`/`<text>`, measured with
an embedded Helvetica advance-width table so bounds (and every layout
node built on them: `align_labels`, `stack_tight`, `bound_box`…) behave
identically in Node and the browser. The cost: nodes that need actual
glyph outlines (`charpath`, `wordpath`, `kern`'s per-glyph work)
evaluate but produce empty geometry — flagged in the UI. A future
version could synthesize outlines from the shipped Hershey stroke font.

## 6. Path booleans, SVG import, seeds — pragmatic equivalents

- `compound` flattens curves and combines polygons with vendored
  polybooljs — the same approximation Java's `Area`-on-flattened-paths
  makes.
- `import_svg` implements a small SVG path-data parser (M/L/H/V/C/S/Q/T/
  A/Z), enough for the shipped assets (`hersheyFont.svg`,
  `relief_font.svg`, `sole.svg`, `cannon.svg`).
- Random nodes are deterministic per seed but use mulberry32, not
  `java.util.Random` — same kind of picture, not the same picture.
- The point stream (`shapePoints`) returns anchor points tagged with
  NodeBox point types, but omits Java's CURVE_DATA control points:
  including them turned degenerate curves (curviness 0) into duplicate
  stream points and broke Cartan's segment arithmetic.
- `divide(0, 0)` resolves to 0 instead of throwing (Java always throws):
  `even_sample`'s T=100 boundary lands on a zero-length segment where 0
  is the mathematically right parameter.

## 7. Python/Clojure helpers: LLM-ported, not transpiled

The library links 19 helper scripts (17 Python, 2 Clojure). Mechanical
transpilers (Transcrypt/Brython) fail exactly where these scripts lean
on NodeBox's Java classes, and drag a runtime along. Instead each script
was translated to JavaScript against the original source
(`engine/n3lib.js`, `CARTAN_FNS`), with the headless evaluation of all
191 demos as the referee:

- **Ported (13)**: contours, make_curve, concat_list, unicode,
  convert_base, dateformat (SimpleDateFormat subset), time (impure —
  gets a context port so results never cache), canvas, poisson
  (Bridson), convex_hull (monotone chain), gilbert2d, treemap
  (squarify), noise (Perlin).
- **Impossible in a browser (6)**: image (pixel sampling), list_dir,
  write_table, font_table, nodelist (app introspection), docsize. Nodes
  using them are flagged `unsupported` rather than silently wrong.

A converter subtlety: nodes may override a standard prototype's
*function* (`make_map` is `corevector.generator` running
`treemap/squarify`) — these synthesize a merged type at load.

## 8. What the site is

A no-build static page: the pre-generated catalog renders the poster
grid from static SVGs; opening a node fetches its JSON, registers the
library in the engine, and evaluates the original demo live (with a
frame slider — animation nodes animate). All data files are committed;
Cloudflare Pages serves everything as-is.

## 9. Known gaps

- ~7 demos evaluate to empty geometry for reasons not yet traced
  (`mesh`, `quadtree`, `pixelate`, `explode`, `good_center`, `sub_path`,
  `contours`) — their cards show "no preview"; definitions still load
  and run.
- Glyph-outline degradation (see §5).
- `balloons`-class demos exceed the ship cap; the gallery shows the
  offline render and says so.
