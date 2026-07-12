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

No build step; everything is plain ES modules. All drums are
synthesized at load time — the project ships zero sample files.

## Sound in three keys

Open `lab.html`, press **▶ play**, then in the editor put the cursor on
a block and hit **ctrl+enter**. **esc** is the panic key. **?** shows
the one-page manual (the same one the agent reads).
