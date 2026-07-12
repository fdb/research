/*
 * nodes.js — station II: the visual patcher.
 *
 * A small node-based language over the same engine. Sequencer nodes
 * query mini patterns on the shared clock and trigger voice nodes;
 * audio nodes are compiled 1:1 onto Web Audio; mod cables drive
 * AudioParams at audio rate. Param edits apply live without a rebuild —
 * only re-wiring recompiles, and the transport never stops.
 *
 * The graph serializes to scene/graph.json in the shared VFS, so the
 * agent (station III) can read and rewrite the patch as a file.
 */

import * as engine from "./engine.js";
import * as vfs from "./vfs.js";
import { mini, seq, silence, noteToMidi } from "./pattern.js";

const GRAPH_FILE = "scene/graph.json";

// ------------------------------------------------------------ node types

const T = {
  seq: {
    title: "seq",
    inputs: [],
    outputs: [{ id: "out", kind: "event" }],
    params: [
      { id: "steps", kind: "text", value: "x...x...x...x..." },
      { id: "cycles", kind: "num", value: 1, min: 0.25, max: 8, step: 0.25 },
    ],
  },
  notes: {
    title: "notes",
    inputs: [],
    outputs: [{ id: "out", kind: "event" }],
    params: [
      { id: "notes", kind: "text", value: "c2 c2 eb2 g2" },
      { id: "cycles", kind: "num", value: 1, min: 0.25, max: 8, step: 0.25 },
    ],
  },
  sampler: {
    title: "sampler",
    inputs: [{ id: "trig", kind: "event" }],
    outputs: [{ id: "out", kind: "audio" }],
    params: [
      { id: "sound", kind: "select", value: "bd", options: ["bd", "sn", "hh", "oh", "cp", "rim", "lt", "mt", "ht", "cr", "click"] },
      { id: "gain", kind: "num", value: 0.8, min: 0, max: 1.5, step: 0.01 },
      { id: "tune", kind: "num", value: 0, min: -24, max: 24, step: 1 },
    ],
  },
  synth: {
    title: "synth",
    inputs: [{ id: "note", kind: "event" }],
    outputs: [{ id: "out", kind: "audio" }],
    params: [
      { id: "wave", kind: "select", value: "saw", options: ["sine", "tri", "saw", "square", "sub", "bass", "fm", "pluck"] },
      { id: "gain", kind: "num", value: 0.5, min: 0, max: 1.5, step: 0.01 },
      { id: "attack", kind: "num", value: 0.005, min: 0, max: 1, step: 0.005 },
      { id: "release", kind: "num", value: 0.1, min: 0.01, max: 2, step: 0.01 },
      { id: "legato", kind: "num", value: 0.8, min: 0.1, max: 2, step: 0.05 },
    ],
  },
  filter: {
    title: "filter",
    inputs: [{ id: "in", kind: "audio" }, { id: "mod", kind: "mod" }],
    outputs: [{ id: "out", kind: "audio" }],
    params: [
      { id: "type", kind: "select", value: "lowpass", options: ["lowpass", "highpass", "bandpass"] },
      { id: "cutoff", kind: "num", value: 800, min: 30, max: 12000, step: 1, curve: "log" },
      { id: "res", kind: "num", value: 4, min: 0.1, max: 25, step: 0.1 },
      { id: "amount", kind: "num", value: 2000, min: 0, max: 8000, step: 10 },
    ],
  },
  gain: {
    title: "gain",
    inputs: [{ id: "in", kind: "audio" }, { id: "mod", kind: "mod" }],
    outputs: [{ id: "out", kind: "audio" }],
    params: [{ id: "level", kind: "num", value: 0.8, min: 0, max: 1.5, step: 0.01 }],
  },
  pan: {
    title: "pan",
    inputs: [{ id: "in", kind: "audio" }, { id: "mod", kind: "mod" }],
    outputs: [{ id: "out", kind: "audio" }],
    params: [{ id: "pos", kind: "num", value: 0, min: -1, max: 1, step: 0.01 }],
  },
  delay: {
    title: "delay",
    inputs: [{ id: "in", kind: "audio" }],
    outputs: [{ id: "out", kind: "audio" }],
    params: [
      { id: "time", kind: "num", value: 0.375, min: 0.01, max: 1.5, step: 0.005 },
      { id: "feedback", kind: "num", value: 0.35, min: 0, max: 0.95, step: 0.01 },
      { id: "mix", kind: "num", value: 0.3, min: 0, max: 1, step: 0.01 },
    ],
  },
  reverb: {
    title: "reverb",
    inputs: [{ id: "in", kind: "audio" }],
    outputs: [{ id: "out", kind: "audio" }],
    params: [{ id: "mix", kind: "num", value: 0.25, min: 0, max: 1, step: 0.01 }],
  },
  lfo: {
    title: "lfo",
    inputs: [],
    outputs: [{ id: "out", kind: "mod" }],
    params: [
      { id: "shape", kind: "select", value: "sine", options: ["sine", "triangle", "sawtooth", "square"] },
      { id: "rate", kind: "num", value: 1, min: 0.0625, max: 32, step: 0.0625 },
      { id: "sync", kind: "select", value: "cycle", options: ["cycle", "hz"] },
    ],
  },
  value: {
    title: "value",
    inputs: [],
    outputs: [{ id: "out", kind: "mod" }],
    params: [{ id: "value", kind: "num", value: 0.5, min: -1, max: 1, step: 0.01 }],
  },
  out: {
    title: "out",
    inputs: [{ id: "in", kind: "audio" }],
    outputs: [],
    params: [{ id: "level", kind: "num", value: 0.9, min: 0, max: 1.2, step: 0.01 }],
  },
};

export const NODE_TYPES = Object.keys(T);

// ------------------------------------------------------------ station

export function mountNodes(root, runtime) {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "nodes";
  wrap.innerHTML = `
    <div class="nodes-bar">
      <button class="btn" data-act="add">+ node</button>
      <button class="btn" data-act="power">run</button>
      <span class="nodes-hint">double-click canvas: add · drag ports: connect · click cable + del: cut · drag numbers</span>
    </div>
    <div class="nodes-canvas">
      <svg class="nodes-wires"></svg>
      <div class="nodes-world"></div>
    </div>`;
  root.appendChild(wrap);

  const canvas = wrap.querySelector(".nodes-canvas");
  const world = wrap.querySelector(".nodes-world");
  const svg = wrap.querySelector(".nodes-wires");
  const powerBtn = wrap.querySelector('[data-act="power"]');

  let graph = { nodes: [], edges: [] };
  let view = { x: 20, y: 12 };
  let selection = null; // {kind:'node'|'edge', ...}
  let running = false;
  let rt = null;          // compiled runtime objects: id -> {...}
  let nextId = 1;
  let squelch = false;    // suppress vfs echo

  // ---------------------------------------------------------- persistence

  function serialize() {
    return JSON.stringify(graph, null, 2);
  }

  const saveSoon = debounce(() => {
    squelch = true;
    vfs.write(GRAPH_FILE, serialize());
    squelch = false;
  }, 400);

  function load(g, { autostart = false } = {}) {
    graph = normalize(g);
    nextId = 1 + graph.nodes.reduce((m, n) => Math.max(m, parseInt(String(n.id).replace(/\D/g, "")) || 0), 0);
    selection = null;
    renderAll();
    if (running || autostart) start();
  }

  function normalize(g) {
    const nodes = (g?.nodes || []).filter((n) => T[n.type]).map((n) => ({
      id: String(n.id),
      type: n.type,
      x: Number(n.x) || 0,
      y: Number(n.y) || 0,
      params: { ...defaults(n.type), ...(n.params || {}) },
    }));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = (g?.edges || []).filter(
      (e) => Array.isArray(e.from) && Array.isArray(e.to) && ids.has(String(e.from[0])) && ids.has(String(e.to[0]))
    ).map((e) => ({ from: [String(e.from[0]), e.from[1]], to: [String(e.to[0]), e.to[1]] }));
    return { nodes, edges };
  }

  function defaults(type) {
    const out = {};
    for (const p of T[type].params) out[p.id] = p.value;
    return out;
  }

  vfs.onChange((path) => {
    if (squelch) return;
    if (path === GRAPH_FILE || path === null) {
      const text = vfs.read(GRAPH_FILE);
      if (!text) return;
      try {
        const g = JSON.parse(text);
        if (JSON.stringify(normalize(g)) !== JSON.stringify(graph)) load(g);
      } catch { /* mid-edit json, ignore */ }
    }
  });

  // the agent's run_file("scene/graph.json") lands here
  runtime.registerGraphApplier((g) => {
    load(g, { autostart: true });
  });

  // ------------------------------------------------------------ rendering

  function renderAll() {
    world.style.transform = `translate(${view.x}px, ${view.y}px)`;
    world.innerHTML = "";
    for (const n of graph.nodes) world.appendChild(renderNode(n));
    drawWires();
  }

  function renderNode(n) {
    const def = T[n.type];
    const el = document.createElement("div");
    el.className = "node";
    el.dataset.id = n.id;
    el.style.left = n.x + "px";
    el.style.top = n.y + "px";
    if (selection?.kind === "node" && selection.id === n.id) el.classList.add("selected");

    const head = document.createElement("div");
    head.className = "node-head";
    head.textContent = def.title;
    el.appendChild(head);
    head.addEventListener("pointerdown", (e) => beginNodeDrag(e, n, el));

    const body = document.createElement("div");
    body.className = "node-body";
    el.appendChild(body);

    // ports
    const mkPort = (p, dir) => {
      const row = document.createElement("div");
      row.className = "port-row " + dir;
      const dot = document.createElement("span");
      dot.className = `port ${p.kind}`;
      dot.dataset.node = n.id;
      dot.dataset.port = p.id;
      dot.dataset.dir = dir;
      dot.dataset.kind = p.kind;
      const label = document.createElement("span");
      label.className = "port-label";
      label.textContent = p.id;
      if (dir === "in") { row.appendChild(dot); row.appendChild(label); }
      else { row.appendChild(label); row.appendChild(dot); }
      dot.addEventListener("pointerdown", (e) => beginWireDrag(e, n.id, p, dir));
      body.appendChild(row);
    };
    def.inputs.forEach((p) => mkPort(p, "in"));
    def.outputs.forEach((p) => mkPort(p, "out"));

    // params
    for (const p of def.params) {
      const row = document.createElement("div");
      row.className = "param-row";
      const label = document.createElement("span");
      label.className = "param-label";
      label.textContent = p.id;
      row.appendChild(label);
      row.appendChild(renderParam(n, p));
      body.appendChild(row);
    }
    return el;
  }

  function renderParam(n, p) {
    if (p.kind === "select") {
      const sel = document.createElement("select");
      sel.className = "param-select";
      for (const o of p.options) {
        const opt = document.createElement("option");
        opt.value = o;
        opt.textContent = o;
        if (n.params[p.id] === o) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.onchange = () => setParam(n, p.id, sel.value);
      return sel;
    }
    if (p.kind === "text") {
      const inp = document.createElement("input");
      inp.className = "param-text";
      inp.type = "text";
      inp.value = n.params[p.id];
      inp.onchange = () => setParam(n, p.id, inp.value);
      inp.addEventListener("keydown", (e) => e.stopPropagation());
      return inp;
    }
    // draggable number
    const span = document.createElement("span");
    span.className = "param-num";
    const fmt = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 1000) / 1000);
    span.textContent = fmt(n.params[p.id]);
    span.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      span.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startV = Number(n.params[p.id]);
      const range = p.max - p.min;
      const move = (ev) => {
        const dy = startY - ev.clientY;
        let v;
        if (p.curve === "log") {
          const ratio = Math.pow(p.max / p.min, dy / 200);
          v = startV * ratio;
        } else {
          v = startV + (dy / 200) * range * (ev.shiftKey ? 0.1 : 1);
        }
        v = Math.max(p.min, Math.min(p.max, Math.round(v / p.step) * p.step));
        span.textContent = fmt(v);
        setParam(n, p.id, v, { save: false });
      };
      const up = () => {
        span.removeEventListener("pointermove", move);
        span.removeEventListener("pointerup", up);
        saveSoon();
      };
      span.addEventListener("pointermove", move);
      span.addEventListener("pointerup", up);
    });
    return span;
  }

  function setParam(n, key, value, { save = true } = {}) {
    n.params[key] = value;
    applyParamLive(n, key, value);
    if (save) saveSoon();
  }

  // ------------------------------------------------------------- wires

  function portEl(nodeId, portId, dir) {
    return world.querySelector(`.port[data-node="${nodeId}"][data-port="${portId}"][data-dir="${dir}"]`);
  }

  function portPos(nodeId, portId, dir) {
    const el = portEl(nodeId, portId, dir);
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    return { x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top };
  }

  function drawWires(temp = null) {
    svg.innerHTML = "";
    graph.edges.forEach((e, i) => {
      const a = portPos(e.from[0], e.from[1], "out");
      const b = portPos(e.to[0], e.to[1], "in");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const kind = edgeKind(e);
      path.setAttribute("d", wirePath(a, b));
      path.setAttribute("class", `wire ${kind}` +
        (selection?.kind === "edge" && selection.index === i ? " selected" : ""));
      path.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
        select({ kind: "edge", index: i });
      });
      svg.appendChild(path);
    });
    if (temp) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", wirePath(temp.a, temp.b));
      path.setAttribute("class", `wire temp ${temp.kind}`);
      svg.appendChild(path);
    }
  }

  function edgeKind(e) {
    const def = T[nodeById(e.from[0])?.type];
    return def?.outputs.find((o) => o.id === e.from[1])?.kind || "audio";
  }

  const wirePath = (a, b) => {
    const dx = Math.max(30, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  };

  const nodeById = (id) => graph.nodes.find((n) => n.id === id);

  // -------------------------------------------------------- interactions

  function beginNodeDrag(e, n, el) {
    e.preventDefault();
    select({ kind: "node", id: n.id });
    const startX = e.clientX, startY = e.clientY;
    const ox = n.x, oy = n.y;
    const move = (ev) => {
      n.x = ox + ev.clientX - startX;
      n.y = oy + ev.clientY - startY;
      el.style.left = n.x + "px";
      el.style.top = n.y + "px";
      drawWires();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      saveSoon();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function beginWireDrag(e, nodeId, port, dir) {
    e.preventDefault();
    e.stopPropagation();
    const fixed = portPos(nodeId, port.id, dir);
    const move = (ev) => {
      const c = canvas.getBoundingClientRect();
      const cur = { x: ev.clientX - c.left, y: ev.clientY - c.top };
      const [a, b] = dir === "out" ? [fixed, cur] : [cur, fixed];
      drawWires({ a, b, kind: port.kind });
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      if (target?.classList.contains("port")) {
        const tDir = target.dataset.dir, tKind = target.dataset.kind;
        if (tDir !== dir && tKind === port.kind && target.dataset.node !== nodeId) {
          const from = dir === "out" ? [nodeId, port.id] : [target.dataset.node, target.dataset.port];
          const to = dir === "out" ? [target.dataset.node, target.dataset.port] : [nodeId, port.id];
          const dup = graph.edges.some((ed) => ed.from + "" === from + "" && ed.to + "" === to + "");
          if (!dup) {
            graph.edges.push({ from, to });
            saveSoon();
            recompile();
          }
        }
      }
      drawWires();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // pan on background drag
  canvas.addEventListener("pointerdown", (e) => {
    if (e.target !== canvas && e.target !== world && e.target !== svg) return;
    select(null);
    const startX = e.clientX, startY = e.clientY;
    const ox = view.x, oy = view.y;
    const move = (ev) => {
      view.x = ox + ev.clientX - startX;
      view.y = oy + ev.clientY - startY;
      world.style.transform = `translate(${view.x}px, ${view.y}px)`;
      drawWires();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  canvas.addEventListener("dblclick", (e) => {
    if (e.target !== canvas && e.target !== world && e.target !== svg) return;
    openPalette(e.clientX, e.clientY);
  });
  wrap.querySelector('[data-act="add"]').onclick = (e) => openPalette(e.clientX, e.clientY + 20);

  function openPalette(cx, cy) {
    closePalette();
    const menu = document.createElement("div");
    menu.className = "palette";
    for (const type of NODE_TYPES) {
      const b = document.createElement("button");
      b.textContent = type;
      b.onclick = () => {
        const c = canvas.getBoundingClientRect();
        addNode(type, cx - c.left - view.x, cy - c.top - view.y);
        closePalette();
      };
      menu.appendChild(b);
    }
    menu.style.left = cx + "px";
    menu.style.top = cy + "px";
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("pointerdown", paletteDismiss), 0);
  }
  function paletteDismiss(e) {
    if (!e.target.closest(".palette")) closePalette();
  }
  function closePalette() {
    document.querySelector(".palette")?.remove();
    document.removeEventListener("pointerdown", paletteDismiss);
  }

  function addNode(type, x, y) {
    const n = { id: "n" + nextId++, type, x: Math.round(x), y: Math.round(y), params: defaults(type) };
    graph.nodes.push(n);
    world.appendChild(renderNode(n));
    saveSoon();
    recompile();
  }

  function select(sel) {
    selection = sel;
    world.querySelectorAll(".node").forEach((el) =>
      el.classList.toggle("selected", sel?.kind === "node" && el.dataset.id === sel.id));
    drawWires();
  }

  function deleteSelection() {
    if (!selection) return;
    if (selection.kind === "edge") {
      graph.edges.splice(selection.index, 1);
    } else {
      graph.nodes = graph.nodes.filter((n) => n.id !== selection.id);
      graph.edges = graph.edges.filter((e) => e.from[0] !== selection.id && e.to[0] !== selection.id);
    }
    selection = null;
    renderAll();
    saveSoon();
    recompile();
  }

  // station-scoped keys (only when this station is visible)
  root.addEventListener("keydown", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      e.preventDefault();
      deleteSelection();
    }
  });
  root.tabIndex = -1;

  // --------------------------------------------------------- compilation

  function teardown() {
    if (!rt) return;
    for (const r of Object.values(rt)) {
      try { r.dispose?.(); } catch { /* ignore */ }
    }
    rt = null;
  }

  function recompile() {
    if (running) compile();
  }

  function compile() {
    const ctx = engine.audioCtx();
    teardown();
    rt = {};
    for (const n of graph.nodes) rt[n.id] = buildNode(ctx, n);
    // audio + mod edges
    for (const e of graph.edges) {
      const from = rt[e.from[0]], to = rt[e.to[0]];
      if (!from || !to) continue;
      const kind = edgeKind(e);
      if (kind === "audio" && from.output && to.input) {
        from.output.connect(to.input);
      } else if (kind === "mod" && from.output && to.modTargets?.[e.to[1]]) {
        from.output.connect(to.modTargets[e.to[1]]);
      } else if (kind === "event") {
        (from.eventTargets ||= []).push(e.to[0]);
      }
    }
  }

  function buildNode(ctx, n) {
    const p = n.params;
    const disposer = (nodes) => () => nodes.forEach((x) => { try { x.stop?.(); } catch { } try { x.disconnect(); } catch { } });
    switch (n.type) {
      case "sampler":
      case "synth": {
        const g = ctx.createGain();
        g.gain.value = 1;
        return { node: n, input: null, output: g, voiceIn: g, dispose: disposer([g]) };
      }
      case "filter": {
        const f = ctx.createBiquadFilter();
        f.type = p.type;
        f.frequency.value = p.cutoff;
        f.Q.value = p.res;
        const depth = ctx.createGain();
        depth.gain.value = p.amount;
        depth.connect(f.frequency);
        return { node: n, input: f, output: f, modTargets: { mod: depth }, apply: { cutoff: (v) => f.frequency.setTargetAtTime(v, ctx.currentTime, 0.02), res: (v) => (f.Q.value = v), type: (v) => (f.type = v), amount: (v) => (depth.gain.value = v) }, dispose: disposer([f, depth]) };
      }
      case "gain": {
        const g = ctx.createGain();
        g.gain.value = p.level;
        const depth = ctx.createGain();
        depth.gain.value = 0.5;
        depth.connect(g.gain);
        return { node: n, input: g, output: g, modTargets: { mod: depth }, apply: { level: (v) => g.gain.setTargetAtTime(v, ctx.currentTime, 0.02) }, dispose: disposer([g, depth]) };
      }
      case "pan": {
        const sp = ctx.createStereoPanner();
        sp.pan.value = p.pos;
        const depth = ctx.createGain();
        depth.connect(sp.pan);
        return { node: n, input: sp, output: sp, modTargets: { mod: depth }, apply: { pos: (v) => (sp.pan.value = v) }, dispose: disposer([sp, depth]) };
      }
      case "delay": {
        const inp = ctx.createGain();
        const outp = ctx.createGain();
        const d = ctx.createDelay(2);
        d.delayTime.value = p.time;
        const fb = ctx.createGain();
        fb.gain.value = p.feedback;
        const wet = ctx.createGain();
        wet.gain.value = p.mix;
        inp.connect(outp);           // dry
        inp.connect(d);
        d.connect(fb);
        fb.connect(d);
        d.connect(wet);
        wet.connect(outp);
        return { node: n, input: inp, output: outp, apply: { time: (v) => d.delayTime.setTargetAtTime(v, ctx.currentTime, 0.05), feedback: (v) => (fb.gain.value = v), mix: (v) => (wet.gain.value = v) }, dispose: disposer([inp, outp, d, fb, wet]) };
      }
      case "reverb": {
        const inp = ctx.createGain();
        const outp = ctx.createGain();
        const wet = ctx.createGain();
        wet.gain.value = p.mix;
        inp.connect(outp);
        inp.connect(wet);
        wet.connect(engine.sends().room);
        return { node: n, input: inp, output: outp, apply: { mix: (v) => (wet.gain.value = v) }, dispose: disposer([inp, outp, wet]) };
      }
      case "lfo": {
        const osc = ctx.createOscillator();
        osc.type = p.shape;
        const hz = p.sync === "cycle" ? p.rate * (engine.getBpm() / 240) : p.rate;
        osc.frequency.value = hz;
        osc.start();
        return { node: n, output: osc, apply: { rate: (v) => (osc.frequency.value = p.sync === "cycle" ? v * (engine.getBpm() / 240) : v), shape: (v) => (osc.type = v) }, dispose: disposer([osc]) };
      }
      case "value": {
        const cs = ctx.createConstantSource();
        cs.offset.value = p.value;
        cs.start();
        return { node: n, output: cs, apply: { value: (v) => cs.offset.setTargetAtTime(v, ctx.currentTime, 0.02) }, dispose: disposer([cs]) };
      }
      case "out": {
        const g = ctx.createGain();
        g.gain.value = p.level;
        g.connect(engine.masterInput());
        return { node: n, input: g, apply: { level: (v) => g.gain.setTargetAtTime(v, ctx.currentTime, 0.02) }, dispose: disposer([g]) };
      }
      case "seq":
      case "notes":
        return { node: n, eventTargets: [] };
      default:
        return { node: n };
    }
  }

  function applyParamLive(n, key, value) {
    const r = rt?.[n.id];
    if (r?.apply?.[key]) {
      try { r.apply[key](Number.isNaN(+value) ? value : +value); } catch { /* rebuild will fix */ }
    }
    // seq/notes/sampler/synth params are read at trigger time — nothing to do
  }

  // ------------------------------------------------------------ sequencing

  function stepsPattern(steps, cycles) {
    const chars = String(steps).replace(/\s+/g, "").split("");
    if (!chars.length) return silence;
    const items = chars.map((c) =>
      c === "x" ? 1 : c === "X" ? 1.2 : null
    );
    return seq(...items.map((v) => v)).slow(cycles || 1);
  }

  function notesPattern(src, cycles) {
    try {
      return mini(String(src)).slow(cycles || 1);
    } catch {
      return silence;
    }
  }

  engine.onClock((b, e, timeAt) => {
    if (!running || !rt) return;
    for (const r of Object.values(rt)) {
      const n = r.node;
      if (n.type !== "seq" && n.type !== "notes") continue;
      if (!r.eventTargets?.length) continue;
      const pat = n.type === "seq"
        ? stepsPattern(n.params.steps, n.params.cycles)
        : notesPattern(n.params.notes, n.params.cycles);
      let haps;
      try { haps = pat.query(b, e); } catch { continue; }
      for (const h of haps) {
        if (h.b < b - 1e-9 || h.v == null) continue;
        const when = timeAt(h.b);
        const dur = (h.e - h.b) / (engine.getBpm() / 240);
        for (const targetId of r.eventTargets) {
          const tr = rt[targetId];
          if (!tr?.voiceIn) continue;
          const tn = tr.node, tp = tn.params;
          if (tn.type === "sampler") {
            engine.play({ s: tp.sound, gain: tp.gain * (typeof h.v === "number" ? h.v : 1), n: tp.tune }, when, dur, tr.voiceIn);
          } else if (tn.type === "synth") {
            const midi = typeof h.v === "number" ? (h.v < 12 ? 36 + h.v : h.v) : noteToMidi(h.v);
            if (Number.isNaN(midi)) continue;
            engine.play({ s: tp.wave, note: midi, gain: tp.gain, attack: tp.attack, release: tp.release, legato: tp.legato }, when, dur, tr.voiceIn);
          }
        }
      }
    }
  });

  // ------------------------------------------------------------ transport

  function start() {
    engine.audioCtx();
    compile();
    running = true;
    powerBtn.textContent = "stop";
    powerBtn.classList.add("active");
  }

  function stop() {
    running = false;
    teardown();
    powerBtn.textContent = "run";
    powerBtn.classList.remove("active");
  }

  powerBtn.onclick = () => (running ? stop() : start());

  // redraw wires when the pane resizes/becomes visible
  new ResizeObserver(() => drawWires()).observe(canvas);

  // initial load
  const initial = vfs.read(GRAPH_FILE);
  if (initial) {
    try { load(JSON.parse(initial)); } catch { /* leave empty */ }
  }

  return {
    start,
    stop,
    get running() { return running; },
    load: (g) => load(g, { autostart: true }),
    redraw: drawWires,
  };
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
