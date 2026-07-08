# nodebox — one NodeBox, on the web

Research + working prototype for a unified, web-based NodeBox that merges
the classic Java desktop app ([nodebox/nodebox](https://github.com/nodebox/nodebox))
and the private web version "NodeBox Live".

- **`index.html`** — the explanation page.
- **`app.html`** — the live demo editor (React + Tailwind via CDN import
  maps, no build step).
- **`core/`** — the engine, plain JSDoc-typed ES modules with no DOM
  dependencies: `graphics.js`, `model.js`, `eval.js`, `stdlib.js`,
  `persistence.js` (fake backend).
- **`ui/`** — the editor: network editor (Canvas2D), parameter panel,
  viewer, node-insert dialog, code-node editor.
- **`doc/COMPARISON.md`** — deep comparison of the two ancestor codebases.
- **`doc/DECISIONS.md`** — every design tradeoff taken for the unified
  version, and what's deferred.

## The pitch

Java NodeBox's semantics (immutable documents, list-matching evaluation,
subnetworks with published ports, deterministic seeds) on NodeBox Live's
substance (JSON documents, node types as editable JavaScript source, a
headless core under a thin UI). Both composition mechanisms are supported:
a node type is *typed ports + an implementation* — built-in function,
ES-module code node stored in the document, or a subnetwork. All three
participate identically in list-matching.

## Running

It's static. Serve the repo root (`python3 -m http.server`) and open
`/nodebox/`. The core test suite runs headless:

```sh
node nodebox/test/core.test.mjs
```

Persistence is intentionally faked (localStorage behind an async API
mirroring NodeBox Live's server) — see `core/persistence.js` for what the
real backend would need.
