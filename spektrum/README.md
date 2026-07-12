# spektrum

Laying tracks while the train is running — an explorable lab (and ICLC
performance-lecture proposal) on the spectrum of live-coding
instruments, from pure functions built from scratch to coding agents
that rebuild the environment mid-performance.

- `index.html` — the essay/explorable: the spectrum, interactive
  pattern-timeline widget, ergonomics findings.
- `lab.html` — the working environment. Three stations over one
  substrate (one clock, one Web Audio engine, one virtual filesystem):
  - **I · primitives** — a Tidal-style pattern language rebuilt small
    (`js/pattern.js`, unit-tested), mini-notation, live GLSL.
  - **II · nodes** — a visual patcher (sequencers, synths, filters,
    LFOs, typed cables) that serializes to `scene/graph.json`.
  - **III · agent** — a miniature Claude Code over the same files:
    list/read/write/run tools, streaming agent loop, offline replay.
- `talk.md` / `talk.html` — the ICLC submission.
- `worker/` — Cloudflare Worker proxy for the Anthropic API (the key
  lives in a Worker secret, never in the browser). See its README.
- `test/pattern.test.mjs` — run with `node test/pattern.test.mjs`.
  The `test/browser-*.test.mjs` suites drive the lab in headless
  Chromium (need `playwright-core` + a Chromium binary; see headers).

No build step; everything is plain ES modules. All drums are
synthesized at load time — the project ships zero sample files.

## Sound in three keys

Open `lab.html`, press **▶ play** (or space), then put the cursor on a
block and hit **ctrl+enter**. **esc** is the panic key. **⌘k** opens
the command palette (stations, scenes, snapshots). **?** shows the
one-page manual (the same one the agent reads).

## Ergonomics

The editor is a plain textarea with a syntax layer behind it — native
caret, native undo — plus live-coding keys: **⌘↑/↓** nudges the number
under the cursor and re-runs its block (filter sweeps as a keyboard
gesture), **⌘/** mutes a voice, **alt+↑/↓** moves lines, auto-closing
pairs, and the block that ⌘enter would run is always marked. Sequencer
steps in the patcher are paintable cells (alt-click = accent); nodes
duplicate with **⌘d** and nudge with arrows; cables cut on double-click.
The scene auto-snapshots before every agent turn and scene load —
restore from the palette. Tap **t** to set the tempo.
