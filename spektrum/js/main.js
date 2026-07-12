/*
 * main.js — boots the lab: one engine, one shader screen, one VFS,
 * three stations. Switching stations never interrupts the sound.
 *
 * Global ergonomics live here: the command palette (mod+k), tap tempo,
 * scene snapshots, the VU meter, toasts, and the sacred panic key.
 */

import * as vfs from "./vfs.js";
import * as engine from "./engine.js";
import { ShaderScreen } from "./shader.js";
import { makeRuntime } from "./runtime.js";
import { mountPrimitives } from "./primitives.js";
import { mountNodes } from "./nodes.js";
import { mountAgent } from "./agent.js";
import { SCENES, DEFAULT_FILES, loadScene } from "./scenes.js";
import { REFERENCE_MD, KEYS_MD } from "./docs.js";

vfs.seedIfEmpty(DEFAULT_FILES);
if (vfs.read("docs/REFERENCE.md") !== REFERENCE_MD) {
  vfs.write("docs/REFERENCE.md", REFERENCE_MD);
}

const $ = (sel) => document.querySelector(sel);

// ---- persisted UI state ----
const UI_KEY = "spektrum.ui.v1";
let ui = {};
try { ui = JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { /* fresh */ }
const saveUi = () => localStorage.setItem(UI_KEY, JSON.stringify(ui));

// ---- toast ----
const toastEl = $("#toast");
let toastTimer = null;
export function toast(msg, ms = 1800) {
  toastEl.textContent = msg;
  toastEl.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("on"), ms);
}

// ---- shader screen ----
const shaderScreen = new ShaderScreen($("#viz-canvas"));
shaderScreen.start();

const runtime = makeRuntime({ getShader: () => shaderScreen });

// ---- stations ----
const stations = {};
const controllers = {};
for (const name of ["primitives", "nodes", "agent"]) {
  stations[name] = $(`#station-${name}`);
}
controllers.primitives = mountPrimitives(stations.primitives, runtime);
controllers.nodes = mountNodes(stations.nodes, runtime, { toast });
controllers.agent = mountAgent(stations.agent, runtime, { toast });

let current = null;
function switchStation(name) {
  if (!stations[name] || current === name) return;
  current = name;
  ui.station = name;
  saveUi();
  for (const [k, el] of Object.entries(stations)) {
    el.classList.toggle("hidden", k !== name);
  }
  document.querySelectorAll("[data-station]").forEach((b) =>
    b.classList.toggle("active", b.dataset.station === name));
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  if (name === "nodes") controllers.nodes.redraw();
  if (name === "primitives") controllers.primitives.focus();
}

window.addEventListener("hashchange", () => {
  const h = location.hash.slice(1);
  if (stations[h]) switchStation(h);
});
document.querySelectorAll("[data-station]").forEach((b) => {
  b.addEventListener("click", () => switchStation(b.dataset.station));
});
switchStation(
  stations[location.hash.slice(1)] ? location.hash.slice(1) :
  stations[ui.station] ? ui.station : "primitives"
);

// ---- transport ----
function playScene() {
  engine.audioCtx(); // user gesture: unlock
  for (const path of ["scene/pattern.js", "scene/visual.glsl"]) {
    const c = vfs.read(path);
    if (c) runtime.applyFile(path, c);
  }
  if (current === "nodes") controllers.nodes.start();
}
$("#play").onclick = playScene;

function hushAll() {
  engine.hush();
  controllers.nodes.stop();
  toast("hushed");
}
$("#hush").onclick = hushAll;

// draggable bpm
const bpmEl = $("#bpm");
bpmEl.textContent = Math.round(engine.getBpm());
bpmEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  bpmEl.setPointerCapture(e.pointerId);
  const startY = e.clientY;
  const startV = engine.getBpm();
  const move = (ev) => {
    const v = Math.round(startV + (startY - ev.clientY) / 2);
    engine.setBpm(v);
    bpmEl.textContent = Math.round(engine.getBpm());
  };
  const up = () => {
    bpmEl.removeEventListener("pointermove", move);
    bpmEl.removeEventListener("pointerup", up);
  };
  bpmEl.addEventListener("pointermove", move);
  bpmEl.addEventListener("pointerup", up);
});

// tap tempo — press t to the beat, anywhere outside an input
let taps = [];
function tapTempo() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  if (taps.length < 2) { toast("tap… (keep tapping t)"); return; }
  const gaps = [];
  for (let i = 1; i < taps.length; i++) gaps.push(taps[i] - taps[i - 1]);
  const recent = gaps.slice(-7);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const bpm = Math.round(60000 / avg);
  engine.setBpm(bpm);
  bpmEl.textContent = Math.round(engine.getBpm());
  toast(`♩ = ${Math.round(engine.getBpm())} (${taps.length} taps)`);
}

// beat dots + VU meter, one rAF loop
const dots = [...document.querySelectorAll(".beat-dot")];
const vu = $("#vu");
const vuCtx = vu.getContext("2d");
let vuPeak = 0;
(function uiLoop() {
  const c = engine.nowCycle();
  const beat = Math.floor((c % 1) * 4);
  dots.forEach((d, i) => d.classList.toggle("on", engine.isRunning() && i === beat));

  // bpm can change from code (bpm(132)), tap, or the agent — keep it live
  const bpmNow = String(Math.round(engine.getBpm()));
  if (bpmEl.textContent !== bpmNow) bpmEl.textContent = bpmNow;

  const { rms, bass, mid, high } = engine.levels();
  vuPeak = Math.max(vuPeak * 0.97, rms);
  const w = vu.width, h = vu.height;
  vuCtx.clearRect(0, 0, w, h);
  const style = getComputedStyle(document.body);
  vuCtx.fillStyle = style.color;
  const bands = [bass, mid, high];
  const bw = 4;
  bands.forEach((v, i) => {
    vuCtx.globalAlpha = 0.9;
    vuCtx.fillRect(i * (bw + 2), h - v * h, bw, v * h);
  });
  vuCtx.globalAlpha = 0.35;
  vuCtx.fillRect(20, h - rms * h, w - 24, rms * h);
  vuCtx.globalAlpha = 1;
  vuCtx.fillRect(20 + (w - 24) * 0, Math.max(0, h - vuPeak * h - 1), w - 24, 1);
  requestAnimationFrame(uiLoop);
})();

// ---- scenes menu ----
const sceneSel = $("#scenes");
for (const s of SCENES) {
  const opt = document.createElement("option");
  opt.value = s.id;
  opt.textContent = s.title;
  sceneSel.appendChild(opt);
}
function runScene(scene) {
  engine.audioCtx();
  vfs.snapshot(`before scene: ${scene.title}`);
  loadScene(scene, { runtime, agentCtl: controllers.agent, switchStation });
  toast(`scene: ${scene.title}`);
}
sceneSel.onchange = () => {
  const scene = SCENES.find((s) => s.id === sceneSel.value);
  if (scene) runScene(scene);
  sceneSel.value = "";
};

// ---- snapshots ----
function saveSnapshot() {
  const snap = vfs.snapshot("manual");
  toast(`snapshot saved (${new Date(snap.t).toLocaleTimeString()})`);
}
function restoreSnapshot(index) {
  const snap = vfs.restoreSnapshot(index);
  if (!snap) return;
  engine.audioCtx();
  for (const path of ["scene/pattern.js", "scene/visual.glsl"]) {
    const c = vfs.read(path);
    if (c) runtime.applyFile(path, c);
  }
  toast(`restored: ${snap.label}`);
}

// ---- viz pane toggle ----
function setViz(hidden) {
  document.body.classList.toggle("viz-hidden", hidden);
  ui.vizHidden = hidden;
  saveUi();
  setTimeout(() => controllers.nodes.redraw(), 50);
}
$("#viz-toggle").onclick = () => setViz(!document.body.classList.contains("viz-hidden"));
if (ui.vizHidden) setViz(true);

// ---- help overlay ----
const help = $("#help");
$("#help-toggle").onclick = () => help.classList.toggle("hidden");
help.addEventListener("click", (e) => {
  if (e.target === help) help.classList.add("hidden");
});
$("#help-body").textContent = KEYS_MD + "\n" + REFERENCE_MD;

// ---- command palette (mod+k) ----
const palette = $("#palette");
const palInput = $("#palette-input");
const palList = $("#palette-list");
let palItems = [];
let palSel = 0;

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function buildPaletteItems() {
  const items = [
    { title: "play — run current scene", hint: "▶", act: playScene, kw: "start run audio" },
    { title: "hush — silence everything", hint: "esc", act: hushAll, kw: "stop panic mute" },
    { title: "station I · primitives", hint: "1", act: () => switchStation("primitives"), kw: "text code editor" },
    { title: "station II · nodes", hint: "2", act: () => switchStation("nodes"), kw: "patch graph visual" },
    { title: "station III · agent", hint: "3", act: () => switchStation("agent"), kw: "ai claude chat llm" },
    { title: "snapshot: save now", hint: "", act: saveSnapshot, kw: "backup save state" },
    { title: "tap tempo", hint: "t", act: () => toast("tap t to the beat"), kw: "bpm speed" },
    { title: "toggle visuals pane", hint: "", act: () => setViz(!document.body.classList.contains("viz-hidden")), kw: "shader viz hide" },
    { title: "help / reference", hint: "?", act: () => help.classList.remove("hidden"), kw: "manual docs keys" },
    {
      title: "reset scene to defaults", hint: "", kw: "clear fresh empty start over",
      act: () => {
        vfs.snapshot("before reset");
        vfs.replaceAll({ ...DEFAULT_FILES });
        toast("scene reset (snapshot saved first)");
      },
    },
  ];
  for (const s of SCENES) {
    items.push({ title: `scene: ${s.title}`, hint: "", act: () => runScene(s), kw: "demo load example" });
  }
  const snaps = vfs.snapshots();
  snaps.slice(-8).reverse().forEach((snap) => {
    const index = snaps.indexOf(snap);
    items.push({
      title: `restore: ${snap.label} — ${ago(snap.t)}`,
      hint: "",
      act: () => restoreSnapshot(index),
      kw: "snapshot undo back revert",
    });
  });
  return items;
}

function fuzzyScore(query, text) {
  // subsequence match with a bonus for consecutive hits and word starts
  let qi = 0, score = 0, streak = 0;
  const q = query.toLowerCase(), t = text.toLowerCase();
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      qi++;
      streak++;
      score += 1 + streak + (i === 0 || /\W/.test(t[i - 1]) ? 3 : 0);
    } else streak = 0;
  }
  return qi === q.length ? score : -1;
}

function renderPalette() {
  const q = palInput.value.trim();
  const scored = palItems
    .map((it) => ({ it, s: q ? fuzzyScore(q, it.title + " " + it.kw) : 0 }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s);
  palList.innerHTML = "";
  palSel = Math.min(palSel, Math.max(0, scored.length - 1));
  scored.slice(0, 12).forEach(({ it }, i) => {
    const li = document.createElement("li");
    li.className = i === palSel ? "sel" : "";
    li.innerHTML = `<span>${it.title}</span>${it.hint ? `<kbd>${it.hint}</kbd>` : ""}`;
    li.onclick = () => { closePalette(); it.act(); };
    li.onpointermove = () => {
      if (palSel !== i) { palSel = i; renderPalette(); }
    };
    palList.appendChild(li);
  });
  palList._scored = scored;
}

function openPalette() {
  palItems = buildPaletteItems();
  palSel = 0;
  palInput.value = "";
  palette.classList.remove("hidden");
  renderPalette();
  palInput.focus();
}
function closePalette() {
  palette.classList.add("hidden");
}
$("#palette-open").onclick = openPalette;
palette.addEventListener("click", (e) => {
  if (e.target === palette) closePalette();
});
palInput.addEventListener("input", () => { palSel = 0; renderPalette(); });
palInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  const scored = palList._scored || [];
  if (e.key === "Escape") { e.preventDefault(); closePalette(); }
  else if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palSel + 1, Math.min(scored.length, 12) - 1); renderPalette(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(palSel - 1, 0); renderPalette(); }
  else if (e.key === "Enter") {
    e.preventDefault();
    const pick = scored[palSel];
    if (pick) { closePalette(); pick.it.act(); }
  }
});

// ---- global keys ----
window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);

  if (mod && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    palette.classList.contains("hidden") ? openPalette() : closePalette();
    return;
  }
  if (e.key === "Escape" || (mod && e.key === ".")) {
    if (!palette.classList.contains("hidden")) { closePalette(); return; }
    e.preventDefault();
    hushAll();
    return;
  }
  if (mod && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    saveSnapshot(); // everything autosaves; make mod+s do something useful
    return;
  }
  if (typing) return;
  if (e.key === "1") switchStation("primitives");
  else if (e.key === "2") switchStation("nodes");
  else if (e.key === "3") switchStation("agent");
  else if (e.key === "t" || e.key === "T") tapTempo();
  else if (e.key === "?") help.classList.toggle("hidden");
  else if (e.key === " " && e.target.tagName !== "BUTTON") { e.preventDefault(); playScene(); }
});

// ---- error surface ----
runtime.onError((err) => {
  const el = $("#global-error");
  el.textContent = err || "";
  el.classList.toggle("hidden", !err);
});
