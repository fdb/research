/*
 * runtime.js — turns project files into running sound & visuals.
 *
 * One evaluator shared by all three stations. The text station calls
 * runCode() directly; the agent calls applyFile(); the node station
 * registers its own applier for scene/graph.json. Errors never stop
 * the transport — the previous state keeps playing.
 */

import * as P from "./pattern.js";
import * as engine from "./engine.js";

export function makeRuntime({ getShader }) {
  let lastError = null;
  let graphApplier = null; // set by the nodes station
  const listeners = new Set();

  const report = (err) => {
    lastError = err ? String(err.message || err) : null;
    for (const fn of listeners) fn(lastError);
    return lastError;
  };

  // ---- the DSL scope -------------------------------------------------
  const scope = {
    // pattern constructors & combinators
    pure: P.pure, seq: P.seq, cat: P.cat, slowcat: P.slowcat, fastcat: P.fastcat,
    stack: P.stack, timecat: P.timecat, silence: P.silence, mini: P.mini,
    m: P.mini, reify: P.reify, signal: P.signal,
    sine: P.sine, cosine: P.cosine, saw: P.saw, isaw: P.isaw, tri: P.tri,
    square: P.square, rand: P.rand, irand: P.irand, perlin: P.perlin,
    choose: P.choose, run: (n) => P.seq(...Array.from({ length: n }, (_, i) => i)),
    // controls
    ...P.controls, lpf: P.controls.cutoff, sound: P.controls.s,
    // engine
    bpm: (n) => (n === undefined ? engine.getBpm() : engine.setBpm(n)),
    hush: () => engine.hush(),
    // visuals
    visual: (src) => {
      const err = getShader()?.set(String(src));
      if (err) throw new Error("shader: " + err.split("\n")[0]);
    },
  };

  // slots d1..d9 — call with a pattern, or with nothing to silence
  for (let i = 1; i <= 9; i++) {
    scope["d" + i] = (pat) => {
      engine.audioCtx();
      engine.setSlot("d" + i, pat == null ? null : coercePattern(pat));
    };
  }
  // generic named slot
  scope.p = (name, pat) => {
    engine.audioCtx();
    engine.setSlot("p:" + name, pat == null ? null : coercePattern(pat));
  };

  function coercePattern(x) {
    const pat = P.reify(x);
    if (!(pat instanceof P.Pattern)) throw new Error("not a pattern");
    return pat;
  }

  const names = Object.keys(scope);
  const values = names.map((k) => scope[k]);

  // ---- evaluation ----------------------------------------------------

  function runCode(code) {
    engine.audioCtx();
    try {
      let fn;
      let isExpr = true;
      try {
        fn = new Function(...names, `"use strict"; return (\n${code}\n);`);
      } catch {
        isExpr = false;
        fn = new Function(...names, `"use strict";\n${code}`);
      }
      const result = fn(...values);
      // ergonomic default: a bare pattern goes to d1
      if (isExpr && result instanceof P.Pattern) {
        engine.setSlot("d1", result);
      }
      report(null);
      return { ok: true };
    } catch (err) {
      console.warn("eval error:", err);
      return { ok: false, error: report(err) };
    }
  }

  function runShader(src) {
    const err = getShader()?.set(src);
    if (err) return { ok: false, error: report(new Error("shader: " + err.split("\n")[0])) };
    report(null);
    return { ok: true };
  }

  function registerGraphApplier(fn) {
    graphApplier = fn;
  }

  function applyFile(path, content) {
    if (path.endsWith(".glsl")) return runShader(content);
    if (path.endsWith("graph.json")) {
      if (!graphApplier) return { ok: false, error: "node station not loaded" };
      try {
        graphApplier(JSON.parse(content));
        report(null);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: report(err) };
      }
    }
    if (path.endsWith(".js")) return runCode(content);
    return { ok: false, error: `don't know how to run ${path}` };
  }

  function status() {
    const slotNames = [...engine.slots.keys()].sort();
    return {
      audio: engine.isRunning() ? "running" : "stopped (press play / any eval)",
      bpm: Math.round(engine.getBpm()),
      cycle: Math.floor(engine.nowCycle()),
      activeSlots: slotNames,
      lastError,
      sounds: engine.isRunning() ? engine.soundNames() : [],
    };
  }

  return {
    runCode,
    runShader,
    applyFile,
    status,
    registerGraphApplier,
    onError: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    get lastError() { return lastError; },
  };
}
