# Conversion pipeline

Offline tools (plain Node ≥ 20, no dependencies). Their **output is
committed** — the site itself has no build step; these scripts are a
data migration, run when the source library changes (it won't — 3.6 is
the final release).

1. **`gen-n3-types.mjs`** → `engine/n3-types.js`
   Extracts port metadata (names, defaults, ranges, menus, descriptions)
   for the NodeBox 3 standard libraries from the official `.ndbx` files
   in `ref/` (from [nodebox/nodebox](https://github.com/nodebox/nodebox),
   GPLv2), resolving prototype inheritance.

2. **`convert.mjs <ndbx> [csv]`** → `data/`, `thumbs/`
   Parses Cartan's `node library 3-6.ndbx` (get
   `Node_Library_3.6.zip` from the NodeBox forum, unzip anywhere) plus
   his `Cartan Node Library.csv` catalog, then:
   - converts each of the 191 canonical nodes and each demo to the
     unified engine's JSON document format (port forwarding, sparse
     names, write-through published values, function-override nodes);
   - registers the JS standard library + script functions and evaluates
     every demo headless;
   - writes `data/nodes/<name>.json` (size-capped), `data/catalog.json`,
     `data/coverage.json` and `thumbs/<name>.svg`.

   Debug helpers: `DEBUG_ENTRY=name1,name2` prints per-child evaluation
   of those networks; `DEBUG_DUMP=name1,name2` writes
   `data/debug-<name>.json` (delete before committing).

`ndbx-parser.mjs` is the shared minimal `.ndbx` XML parser.
