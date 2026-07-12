# Laying Tracks While the Train Is Running

## Live-coding instruments across the tool spectrum, from pure functions to coding agents

**Frederik De Bleser** · frederik@debleser.be

**Submission type:** performance-lecture with live demonstration
**Keywords:** live coding, instrument design, visual programming, functional programming, agentic AI, ergonomics, Web Audio

---

## Abstract

Live-coding instruments have always encoded a position on a deeper question: how much of the instrument should exist before the performance begins? This performance-lecture maps that question onto a spectrum and then plays it, live, end to end.

At one end sits the minimal instrument: a pattern language rebuilt from scratch on a single functional primitive — a pattern is a pure function from a time span to events — with mini-notation, euclidean rhythms and deterministic randomness derived by composition, in a few hundred lines readable in an afternoon. In the middle sits the visual instrument: a node-based patcher in the dataflow tradition, where structure is grabbable and parameters are knobs. At the far end sits the agentic instrument: a coding agent with Claude-Code-style tools — list, read, write, run — that edits and executes the performance's source files at conversational speed, hears its own errors and repairs them while the previous version keeps playing. Laying the tracks while the train is running.

The claim is architectural as much as aesthetic: all three are views over one substrate — one clock, one Web Audio engine, one small virtual filesystem, one manual read by human and machine alike. Because the stations share their state as files, a musical idea can travel the whole spectrum mid-performance: sketched as text, re-voiced as a patch, extended by an agent, then corrected by hand in the same file the agent just wrote.

Between stations, the lecture distills what survived the journey as ergonomic invariants for live-coding tools in the agentic era: never go dark; one gesture to sound; a sacred panic key; visible evaluation; reproducible chance. The environment is open source, browser-native with no build step, and the audience can play it during and after the session.

---

## Extended description

### Motivation

I build tools: node-based visual languages (NodeBox), creative-coding environments, and lately systems where LLM agents write and run code in tight loops. Live coding is the most honest test bench a tool-maker has — every affordance and every failure is public, timed, and audible. This proposal treats the current moment, in which coding agents have become fast enough to participate in performance, not as a rupture but as the newest point on a continuum that live coding has been walking all along: from SuperCollider's just-in-time programming, through TidalCycles' algebra of patterns, through Max/PD's cables, toward instruments that are themselves rebuilt during the piece.

### The spectrum, played

The demonstration runs in *spektrum*, a browser environment built for this talk (plain HTML/JS/GLSL, no build step; synthesis and drums generated from first principles — the project ships no sample files). One musical idea travels through three stations:

**Station I — primitives (≈8 min).** Live coding in a from-scratch functional pattern language. The entire semantics rests on one type, `Pattern = (begin, end) → events`; `fast`, `rev`, `every`, `euclid`, `stack` are ordinary function compositions over it, and "random" operators hash musical time so every take is reproducible. I perform a piece from silence while narrating the primitives, including live-editing the fragment shader that reacts to the music — the shader environment ships a small SDF toolkit (distance-field primitives, smooth blends, soft shadows, ambient occlusion), so writing a lit raymarcher on stage is a two-minute act rather than a stunt, and a `//!nolib` pragma removes the toolkit when building the raytracer *is* the act. The point: minimalism is not asceticism — it is *ownership*. You can hold the whole instrument in your head, and the audience can too.

**Station II — nodes (≈6 min).** The same piece re-voiced in a visual patcher: sequencer nodes querying the same pattern engine, typed cables (audio / event / modulation), LFOs riding filter cutoffs, a macro knob dragged in real time. Parameter changes apply without recompiling; only re-wiring rebuilds the graph, and the transport runs through it. The point: the graph is *data* — it serializes to a JSON file in the project — which quietly sets up station III.

**Station III — the agent (≈8 min).** A miniature Claude Code whose repository is the piece: tools to list, read, write and run the same files stations I and II were editing. I ask for changes in plain language; the agent reads the same one-page manual the audience saw, writes code, runs it, and — reliably, unstaged — sometimes gets it wrong. The environment's contract is that errors replace nothing, so the groove continues while the agent reads the error message back through its tools and repairs its own change. The performance closes with human and agent editing the same file in alternation: the spectrum collapsed into one text buffer.

If the venue network fails, station III degrades honestly: the environment includes a recorded agent session whose tool calls execute for real — the music is live, the words are canned, and the interface says so. (The model API is reached through a ~60-line Cloudflare Worker that holds the key; the browser never sees it.)

### What the spectrum taught us about ergonomics

Building one instrument three times is a controlled experiment in tool ergonomics. The lecture threads five invariants that held at every point of the spectrum, argued from the stage as they are demonstrated:

1. **Never go dark.** A failed eval, a broken shader, a malformed patch, a hallucinated API — nothing replaces the running state until it compiles. This single guarantee is what makes an *unreliable collaborator* (the agent) performable at all: correctness becomes a repair loop rather than a precondition.
2. **One gesture to sound.** Cold-start silence is a tax on courage; every station and every demo scene is audible in one action.
3. **The panic key is sacred.** Esc silences everything, everywhere, always — including mid-agent-turn. Autonomy ends where the panic key begins.
4. **Show what just ran.** Flash the evaluated block; render tool calls as visible chips; keep musical time glanceable. With an agent on stage this is no longer a nicety — it is how the audience (and the performer) audits authorship in real time.
5. **One manual for human and machine.** The agent's system prompt *is* the user documentation. Designing a reference that both parties can act on turns out to be a sharp constraint on language design — sharper than either audience alone.

### Why this matters now

The agentic end of the spectrum reframes liveness rather than threatening it. When the agent types, the performer's attention moves up one level — from editing text to curating intentions and adjudicating results — the same move that took us from soldering to patching to typing. What must be defended in that move is not manual labour but *accountability*: the visible, interruptible, inspectable relationship between gesture and sound that the TOPLAP tradition established. The talk offers the spectrum as a design method — build the minimal instrument first, so that when the agent arrives there is something worth pointing it at — and offers the environment itself as evidence that the two ends strengthen, rather than replace, each other.

### Relation to prior work

The pattern core is a deliberate homage to TidalCycles and Strudel (McLean; Roos & McLean), reimplemented minimally for pedagogy; just-in-time program modification follows Rohrhuber et al.; the visual station draws on the dataflow lineage of Max/PD and on my own NodeBox. Autonomous and collaborative machine performers have ICLC precedent — Cibo's self-directed TidalCycles performance and Autopia's evolutionary co-writing among them; this contribution differs in treating the machine as a *general coding agent over the same files as the human*, and in foregrounding the tool-ergonomics consequences.

---

## Performance plan (25 min)

| min | section |
|----|----------------------------------------------------------------|
| 0–3 | framing: the spectrum, one substrate, the shared manual |
| 3–11 | station I: piece from silence in the primitive language + live GLSL |
| 11–17 | station II: same piece as a patch; parameter riding; graph-as-data |
| 17–24 | station III: agent joins; request → error → self-repair; human and agent in one file |
| 24–25 | invariants recap; audience invited to the URL to play |

## Technical requirements

- Stereo line out (3.5 mm or DI), one projector (HDMI, 16:9), one table.
- Performance runs entirely in a browser on the presenter's laptop.
- Internet access for the agent station is **preferred but not required** — the offline replay fallback keeps the demonstration truthful without a network.
- No sound check surprises: all audio is synthesized; peak-limited master bus.

## Links

- Explorable lab and essay: research.enigmeta.com/spektrum/
- Source (no build step; the pattern core is unit-tested): github.com/fdb/research

## References

- Blackwell, A., & Collins, N. (2005). The programming language as a musical instrument. *Proceedings of PPIG*.
- Collins, N., McLean, A., Rohrhuber, J., & Ward, A. (2003). Live coding in laptop performance. *Organised Sound*, 8(3), 321–330.
- Karplus, K., & Strong, A. (1983). Digital synthesis of plucked-string and drum timbres. *Computer Music Journal*, 7(2), 43–55.
- Magnusson, T. (2014). Herding cats: Observing live coding in the wild. *Computer Music Journal*, 38(1), 8–16.
- McLean, A. (2014). Making programming languages to dance to: Live coding with Tidal. *Proceedings of FARM 2014*.
- Nilson, C. (2007). Live coding practice. *Proceedings of NIME 2007*.
- Roberts, C., & Kuchera-Morin, J. (2012). Gibber: Live coding audio in the browser. *Proceedings of ICMC 2012*.
- Rohrhuber, J., de Campo, A., & Wieser, R. (2005). Algorithms today: Notes on language design for just in time programming. *Proceedings of ICMC 2005*.
- Roos, F., & McLean, A. (2023). Strudel: Live coding patterns on the web. *Proceedings of ICLC 2023*.
- Stewart, J., & Lawson, S. (2019). Cibo: An autonomous TidalCycles performer. *Proceedings of ICLC 2019*.
- Toussaint, G. (2005). The Euclidean algorithm generates traditional musical rhythms. *Proceedings of BRIDGES 2005*.
- Ward, A., Rohrhuber, J., Olofsson, F., McLean, A., Griffiths, D., Collins, N., & Alexander, A. (2004). Live algorithm programming and a temporary organisation for its promotion. *Proceedings of README Software Art Conference*.
- Wilson, E., Lawson, S., McLean, A., & Stewart, J. (2020). Autopia: An AI collaborator for gamified live coding music performances. *Proceedings of AISB 2020*.
