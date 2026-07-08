# NodeBox (Java) vs. NodeBox Live — codebase comparison

Research notes for the unified web version. Sources: the open-source
[nodebox/nodebox](https://github.com/nodebox/nodebox) desktop app (Java,
format version 22) and the private NodeBox Live monorepo (code dump
`nodeboxlive-20250910.zip`: packages `g`, `runtime`, `web`, `server`).

## At a glance

| | **NodeBox 3 (Java)** | **NodeBox Live (web)** |
|---|---|---|
| Platform | Swing/Java2D desktop app | React 18 + TS + Vite SPA, Express server |
| Document | `.ndbx` XML, formatVersion 22, 21-step upgrade chain | `project.json`, formatVersion 4, incremental upgrades |
| Node types | Ports + `function` ref (`java:`/`python:`/`clojure:` libraries), prototype-based | ES-module **source string** per node type (`FunctionItem`); ports derived by parsing the source |
| Custom nodes | Not really (needs a function library on disk); subnetworks instead | First-class: in-app CodeMirror editor, core library uses the same mechanism |
| Composition | **Subnetworks**: networks are nodes; rendered child; published ports (`childReference`) | Half-finished: grouping UI exists, but inlet evaluation throws `Unimplemented: Inlet value` |
| Multiplicity | **List-matching**: every result is a list; value ports cycle to the longest input; `range="list"` ports get whole lists; results flatten | **Tables**: rows of objects; nodes loop over `tableIn` themselves; per-row `EXPRESSION` values (`with`-scoped `new Function`) |
| Evaluation | Pull-based, eager, immutable node tree → identity-keyed cross-render cache (`RenderCache`), impure nodes excluded via `context` ports | Pull-based, lazy dirty-flags per `RuntimeNode`, `markDirty` propagation, async `onRender` allowed |
| Graphics | `nodebox.graphics`: `Geometry`→`Path`→`Contour`→typed `Point` (LINE/CURVE/DATA), immutable-by-convention, drawn via Java2D | `@ndbx/g`: class-based `Shape` tree modeled on SVG (`Rect`, `Ellipse`, `Path`, `Group`, `Text`, gradients), rendered to **React SVG elements**; plus Vega specs re-parsed into shapes |
| Animation | `frame` in a context data map; `AnimationBar`; movie export (ffmpeg); OSC/audio devices | Vestigial: `$FRAME/$TIME` detected by regex but never injected into scope |
| Randomness | Deterministic: explicit `seed` ports everywhere | Same idea (`Random Numbers` node has seed) |
| Rendering target | Canvas viewer (Java2D), export PNG/SVG/PDF/CSV/MP4 | SVG DOM viewer, export SVG/PNG; published projects playable from static JSON via `<NodeBoxPlayer>` |
| Persistence | Files on disk | Express + file/S3 store: JWT auth, whole-document debounced POST, publish → static JSON on CDN |
| Undo | Snapshot the immutable library | Full `structuredClone` per change, coalesced 500 ms |
| UI | NetworkView (Swing, 48px grid), PortView with draggable numbers, breadcrumb AddressBar, fuzzy `NodeSelectionDialog`, viewer handles | Canvas2D network editor (10px snap), signals + Immer state, properties panel with widgets + expression toggle, outliner, raw-JSON mode |

## What is essentially the same

Both are the same idea with different bodies:

- **Directed acyclic graph, single output per node**, connections stored on
  the network, last-connect-wins on an input port.
- **Pull-based evaluation from a "rendered node"** — the Java
  `renderedChild` and Live's `renderedNode` are the same concept, including
  double-click-to-set-rendered in both UIs.
- **Sparse documents**: both serialize only values that differ from the
  node type's defaults (Java diffs against the prototype chain; Live stores
  a `values` map of non-default parameters).
- **Typed ports with widget metadata** (min/max, menus/choices, draggable
  number scrubbing in both UIs).
- **Determinism as a value**: explicit seeds, pure functions, no hidden
  state. Java removed its `state` ports on purpose; Live's style guide
  mandates "pure data in, pure data out".
- **The node library is data, not engine code**: Java's built-ins are
  `.ndbx` files binding ports to library functions; Live's built-ins are
  ordinary projects owned by user `core`. Both make user-level and
  built-in nodes symmetrical.

## Where they genuinely differ

1. **Subnetworks vs. functions.** Java composes by nesting graphs
   (networks all the way down, published ports, breadcrumb navigation).
   Live composes by writing JavaScript (a node type *is* an ES module
   source string; its ports are declared in code). Java has no in-app way
   to define a leaf node; Live never finished making a graph usable as a
   node.
2. **Lists vs. tables.** Java's list-matching is implicit looping in the
   engine: connect 5 numbers to `width` and one `rect` node makes 5 rects,
   shorter lists cycling. Live's tables put the loop *inside each node*
   (`rect.js` iterates `tableIn` rows itself) and add per-row expressions.
   List-matching composes better for generative geometry; tables are
   friendlier for data-vis columns.
3. **Immutability strategy.** Java: immutable `Node` values with
   structural sharing → the render cache keys on object identity, undo is
   free. Live: Immer + signals in the UI, mutable `RuntimeNode`s with
   dirty flags in the runtime.
4. **Graphics data.** Java: geometry as point streams (great for
   point-level filters like wiggle/resample/sort). Live: retained SVG-like
   shape tree with transforms/gradients (great for export fidelity and
   data-vis, weaker for point-level manipulation).
5. **Scope drift.** Live pivoted toward data visualization (Vega specs,
   data-wrangling nodes, geo). Classic NodeBox is generative vector
   geometry first.

## Known pain points (from the code itself)

- **Java**: stringly-typed ports; positional function binding that fails
  only at invocation; Jython 2.7 lock-in (the Python bridge is
  load-bearing — ~40 corevector nodes live in `pyvector.py`); Swing.
- **Live**: no sandboxing of user code (`with`-scoped `new Function`
  expressions, blob-URL imports with page privileges); port metadata
  scraped from source with regex + JSON5 (executing the module would be
  truthful); subnetwork evaluation unimplemented; animation clock never
  wired up; undo via full deep clones; whole-document saves guarded only
  by a BroadcastChannel single-tab lock.

Both file formats survived years of change through explicit
`formatVersion` + incremental migrations. Keep that.

See `DECISIONS.md` for what the unified version takes from each.
