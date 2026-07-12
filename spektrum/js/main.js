/*
 * main.js — boots the lab: one engine, one shader screen, one VFS,
 * three stations. Switching stations never interrupts the sound.
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
// keep the reference up to date even for returning visitors
if (vfs.read("docs/REFERENCE.md") !== REFERENCE_MD) {
  vfs.write("docs/REFERENCE.md", REFERENCE_MD);
}

const $ = (sel) => document.querySelector(sel);

// ---- shader screen (shared right pane) ----
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
controllers.nodes = mountNodes(stations.nodes, runtime);
controllers.agent = mountAgent(stations.agent, runtime);

let current = null;
function switchStation(name) {
  if (!stations[name]) return;
  current = name;
  for (const [k, el] of Object.entries(stations)) {
    el.classList.toggle("hidden", k !== name);
  }
  document.querySelectorAll("[data-station]").forEach((b) =>
    b.classList.toggle("active", b.dataset.station === name));
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  if (name === "nodes") controllers.nodes.redraw();
}

window.addEventListener("hashchange", () => {
  const h = location.hash.slice(1);
  if (stations[h]) switchStation(h);
});
document.querySelectorAll("[data-station]").forEach((b) => {
  b.addEventListener("click", () => switchStation(b.dataset.station));
});
switchStation(stations[location.hash.slice(1)] ? location.hash.slice(1) : "primitives");

// ---- transport ----
const playBtn = $("#play");
playBtn.onclick = () => {
  engine.audioCtx(); // user gesture: unlock
  for (const path of ["scene/pattern.js", "scene/visual.glsl"]) {
    const c = vfs.read(path);
    if (c) runtime.applyFile(path, c);
  }
  if (current === "nodes") controllers.nodes.start();
};

function hushAll() {
  engine.hush();
  controllers.nodes.stop();
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

// beat dots
const dots = [...document.querySelectorAll(".beat-dot")];
(function beatLoop() {
  const c = engine.nowCycle();
  const beat = Math.floor((c % 1) * 4);
  dots.forEach((d, i) => d.classList.toggle("on", engine.isRunning() && i === beat));
  requestAnimationFrame(beatLoop);
})();

// ---- scenes menu ----
const sceneSel = $("#scenes");
for (const s of SCENES) {
  const opt = document.createElement("option");
  opt.value = s.id;
  opt.textContent = s.title;
  sceneSel.appendChild(opt);
}
sceneSel.onchange = () => {
  const scene = SCENES.find((s) => s.id === sceneSel.value);
  if (!scene) return;
  engine.audioCtx(); // gesture
  loadScene(scene, {
    runtime,
    agentCtl: controllers.agent,
    switchStation,
  });
  sceneSel.value = "";
};

// ---- viz pane toggle ----
$("#viz-toggle").onclick = () => {
  document.body.classList.toggle("viz-hidden");
  setTimeout(() => controllers.nodes.redraw(), 50);
};

// ---- help overlay ----
const help = $("#help");
$("#help-toggle").onclick = () => help.classList.toggle("hidden");
help.addEventListener("click", (e) => {
  if (e.target === help) help.classList.add("hidden");
});
$("#help-body").textContent = KEYS_MD + "\n" + REFERENCE_MD;

// ---- global keys ----
window.addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);
  if (e.key === "Escape" || ((e.ctrlKey || e.metaKey) && e.key === ".")) {
    e.preventDefault();
    hushAll();
    return;
  }
  if (typing) return;
  if (e.key === "1") switchStation("primitives");
  else if (e.key === "2") switchStation("nodes");
  else if (e.key === "3") switchStation("agent");
  else if (e.key === "?") help.classList.toggle("hidden");
});

// ---- error surface (runtime errors show in the header, too) ----
runtime.onError((err) => {
  const el = $("#global-error");
  el.textContent = err || "";
  el.classList.toggle("hidden", !err);
});
