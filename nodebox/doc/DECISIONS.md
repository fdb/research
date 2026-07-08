# Design decisions for the unified NodeBox

Every choice below names what we took, from which ancestor, and what we
gave up. See `COMPARISON.md` for the underlying analysis of the two
codebases.

## 1. One node model, three kinds of implementations

**Decision: support subnetworks AND function nodes by making everything a
(ports + function) pair.**

The Java version composes with subnetworks; Live composes with JavaScript
source. These turn out to be answers to different questions, so we keep
both, unified under one abstraction. A node type is metadata + typed
ports + an implementation, where the implementation is one of:

1. a **built-in function** (`core/stdlib.js` — the curated classic library),
2. a **code node**: an ES module source string stored in the document
   (`functions` array), compiled at load (Live's model), or
3. a **subnetwork**: a graph with a rendered child and published ports
   (Java's model), created by grouping a selection (⌘G).

Because code nodes declare ports as data and export a plain per-invocation
function, **list-matching applies to them exactly as to built-ins** — a
custom `gear` node maps over a 100-point grid with zero loop code. And
because subnetworks expose published ports, they participate in the
parent's list-matching too (verified in the test suite: a subnetwork fed a
3-element list runs three times). This is the single biggest win of the
unification: Live never finished subnetworks, Java never had in-app code
nodes; each ancestor's composition mechanism plugs the other's hole.

One deliberate difference from Live: we **execute** the code-node module
and read its exported `node` metadata instead of regex-parsing the source
(Live's `lexer.ts` pain point — dynamic ports silently broke). The source
stays a plain string in the document either way.

## 2. Lists, not tables

**Decision: Java's list-matching semantics, ported verbatim.**

Every node result is a flat list. Value-range ports cycle to the longest
input; `range: "list"` ports receive whole lists; an empty value input
means zero invocations; list-range ports count as size 1 (so an empty
list *can* flow into `count`); invocation results concatenate. These
exact rules (from `NodeContext.buildArgumentMaps`) are what make one
`rect` node emit 144 rectangles — the soul of NodeBox.

Live's tables (arrays of row objects + per-row expressions) are the
better data-vis story, but they push the looping *into every node* and
came with `with`-scoped `new Function` expressions. A table is
representable today as a list of plain objects; dedicated data nodes
(import/filter/aggregate) can be added as a library later without
touching the evaluator. Per-parameter expressions are deferred for the
same reason — the design slot for them (a tagged value in `values`) is
noted in the format.

## 3. Immutable document, identity-keyed cache

**Decision: Java's persistence strategy on Live's document shape.**

The document is one plain-JSON value; all edits are pure functions that
rebuild only the spine to the root (structural sharing). That gives us,
exactly as in Java:

- undo/redo as a snapshot stack (`ui/store.js`) — cheap because snapshots
  share structure, unlike Live's full `structuredClone` per change;
- a cross-render cache keyed on **object identity** of the node plus its
  upstream result lists (`RenderCache`'s trick) with zero dirty-flag
  bookkeeping — impurity (frame, mouse) flows only through `context`
  ports and disables caching transitively.

Evaluation is eager and pull-based from the rendered child, like both
ancestors. Cycles are detected, errors carry the node path.

## 4. Document format: JSON, sparse, versioned

Live's `project.json` direction, carrying Java's semantics: nodes store
only values that differ from their type's defaults; networks nest
children/connections/`renderedChild`/`publishedPorts` (Java's
`childReference`, as a name triple); code nodes are `{name, source}`
pairs. `formatVersion` + incremental migrations from day one — the one
mechanism both ancestors proved over years (21 XML upgrades / 4 JSON
upgrades). Values are write-through on published ports, so a network's
"parameters" are just its children's values, and documents stay diffable.

## 5. Graphics: plain data + separate renderers

**Decision: geometry is deeply-plain JSON; rendering is a function of it.**

`core/graphics.js` models a `Path` as a command list (`M/L/C/Z` — g.js's
shape, 1:1 with Canvas2D and SVG `d` attributes) plus `fill`, `stroke`,
`strokeWidth`, and `Group` as a shape list. No classes and no methods, so
any value the evaluator produces is serializable and structurally
shareable. Point-level filters (wiggle, snap, resample) work on command
points, preserving Java's point-stream superpower without its
`Contour`/typed-`Point` machinery.

The **viewer draws to Canvas2D** (immediate mode — list-matching graphs
routinely emit thousands of shapes, where Live's retained React-SVG tree
struggles), and **export is SVG** (`toSVG`), keeping Live's fidelity
where it matters. Gradients, text-as-outlines, images and boolean path
ops are deferred; the data model has room for them (new command/shape
types).

## 6. Core/UI split, no build step

- `core/` — graphics, model, evaluator, stdlib, persistence. Zero DOM
  dependencies (the test suite runs it under plain Node), which is Live's
  best structural idea (`g` ← `runtime` ← `web`) with the runtime usable
  headless — for future server-side rendering or a player embed.
- `ui/` — React 19 + Tailwind, loaded via **ES import maps + CDN**
  (esm.sh) with **htm** as JSX-without-a-build. Tailwind runs as the v4
  browser build. This honors the repo's no-build rule; a production
  version would pin the same code through a bundler without changing a
  line of source.
- **JSDoc types** throughout the core instead of TypeScript — checkable
  with `tsc --checkJs` in CI later, invisible at runtime, no transpile.
- The network editor is one Canvas2D component (Live's proven approach),
  with both ancestors' interaction vocabulary: drag-to-connect on port
  strips, detach-and-replug on connected inputs, double-click to render
  (networks: to enter), double-click canvas for the fuzzy insert dialog
  (Java's `NodeSelectionDialog`), draggable number scrubbing everywhere,
  breadcrumb navigation, grid snap.

## 7. Animation and determinism

The frame clock lives in a context data map injected per render
(`{frame, mouse}`) and reaches nodes only through `context`-typed ports
(`core.frame`) — Java's design, actually wired up (Live detected
`$FRAME` but never supplied it). Randomness is deterministic: every
stochastic node has an explicit `seed` port (mulberry32). Same document +
same frame ⇒ same picture, which is also what makes the cache sound.
Java's removed `state`/feedback ports stay removed.

## 8. Persistence: faked, with the real contract documented

Per the brief, no backend. `core/persistence.js` mimics the API a real
server would expose (list/load/save/delete + debounced autosave) against
`localStorage`, and documents what the real one needs — modeled directly
on Live's Express server (JWT auth, whole-document JSON saves, publish →
static JSON so playback/embedding needs no API). Two lessons from Live
worth honoring later: keep published documents on static hosting, and
replace the whole-document-save + single-tab-lock with versioned or
per-operation saves (the model's edit functions are already discrete
operations).

## 9. Explicitly deferred (documented, not designed away)

- **Sandboxing code nodes.** Like Live, module code runs with page
  privileges. A real deployment must evaluate documents in a sandboxed
  iframe/worker realm; the core/UI split keeps the evaluator movable.
- Per-parameter **expressions**; **handles** (direct manipulation in the
  viewer); **text/typography** nodes; **data tables + import** (CSV/JSON);
  path **boolean ops** (`compound`); **SVG import**; PNG/movie export;
  OSC/audio devices; collaboration/multiplayer.
- Node **renaming**, comments/stickies, copy/paste.

Each has a place to land: expressions in the `values` tagged union,
handles as node-type metadata (Java's `handle` attribute), data nodes as
a stdlib module, exports next to `toSVG`.
