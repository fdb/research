// nodebox-cartan-library/app.js
// The gallery + live viewer. Loads the pre-generated catalog, renders the
// poster grid from static SVG thumbnails, and — when a node is opened —
// evaluates its original demo live in the browser through the same engine
// that pre-rendered everything offline.

import { createRegistry, registerType } from "./engine/model.js";
import { createRenderer } from "./engine/eval.js";
import * as g from "./engine/graphics.js";
import { n3Types, cartanFnType, setFileLoader } from "./engine/n3lib.js";

const CATEGORY_ORDER = [
  "geometry", "alteration", "point", "text", "color",
  "math", "list", "data", "animation", "other",
];

const catalog = await (await fetch("./data/catalog.json")).json();
const registry = createRegistry(n3Types());
for (const spec of catalog.fnTypes) registerType(registry, cartanFnType(spec));

// Synchronous file access for import_svg / import_csv: prefetch the
// experiment's assets once, before anything renders.
const SHIPPED_ASSETS = new Set([
  "hersheyFont.svg",
  "relief_font.svg",
  "sole.svg",
  "cannon.svg",
  "test.csv",
]);
const assetNames = [...new Set(catalog.nodes.flatMap((n) => n.files || []))]
  .map((n) => n.split("/").pop())
  .filter((n) => SHIPPED_ASSETS.has(n));
const assets = new Map();
await Promise.all(
  assetNames.map(async (name) => {
    const res = await fetch(`./assets/${encodeURIComponent(name)}`);
    if (res.ok) assets.set(name, await res.text());
  }),
);
setFileLoader((name) => assets.get(name.split("/").pop()));

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

const galleryEl = document.getElementById("gallery");
const filterEl = document.getElementById("filter");
const okCount = catalog.nodes.filter((n) => n.status === "ok").length;
document.getElementById("stats").textContent =
  `${catalog.nodes.length} nodes · ${okCount} evaluate live in this page · ` +
  `${catalog.nodes.filter((n) => n.status === "unsupported").length} need a desktop ` +
  `(files, fonts, app introspection) · thumbnails pre-rendered by the same engine, headless.`;

let activeCategory = "all";

function renderFilter() {
  filterEl.innerHTML = "";
  const cats = ["all", ...CATEGORY_ORDER.filter((c) => catalog.nodes.some((n) => n.category === c))];
  for (const cat of cats) {
    const b = document.createElement("button");
    b.textContent = cat;
    b.setAttribute("aria-pressed", String(cat === activeCategory));
    b.onclick = () => {
      activeCategory = cat;
      renderFilter();
      renderGallery();
    };
    filterEl.append(b);
  }
}

function renderGallery() {
  galleryEl.innerHTML = "";
  for (const cat of CATEGORY_ORDER) {
    if (activeCategory !== "all" && cat !== activeCategory) continue;
    const nodes = catalog.nodes.filter((n) => n.category === cat);
    if (!nodes.length) continue;
    const section = document.createElement("section");
    section.className = "category";
    const h = document.createElement("h2");
    h.innerHTML = `${cat} <span class="count">${nodes.length}</span>`;
    const grid = document.createElement("div");
    grid.className = "grid";
    for (const node of nodes) grid.append(card(node));
    section.append(h, grid);
    galleryEl.append(section);
  }
}

function card(node) {
  const el = document.createElement("button");
  el.className = "card";
  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (node.thumb) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = `./thumbs/${node.name}.svg`;
    img.alt = node.name;
    thumb.append(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "placeholder";
    ph.textContent =
      node.status === "ok" && node.values ? node.values.slice(0, 4).join("  ") : "no preview";
    thumb.append(ph);
  }
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = node.name;
  const desc = document.createElement("div");
  desc.className = "desc";
  desc.textContent = node.description;
  el.append(thumb, name, desc);
  if (node.status !== "ok") {
    const badge = document.createElement("span");
    badge.className = `badge badge-${node.status}`;
    badge.textContent = node.status;
    el.append(badge);
  }
  el.onclick = () => openDetail(node);
  return el;
}

renderFilter();
renderGallery();

// ---------------------------------------------------------------------------
// Detail view with live rendering
// ---------------------------------------------------------------------------

const dialog = document.getElementById("detail");
const canvas = document.getElementById("detail-canvas");
const ctx = canvas.getContext("2d");
const frameSlider = document.getElementById("frame");
const frameNum = document.getElementById("frame-num");
const playBtn = document.getElementById("play");
const statusEl = document.getElementById("detail-status");

let current = null; // {network, renderer, lastValue}
let playing = false;
let rafId = 0;

document.getElementById("detail-close").onclick = () => dialog.close();
dialog.addEventListener("close", () => {
  playing = false;
  cancelAnimationFrame(rafId);
  current = null;
});
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});

async function openDetail(meta) {
  document.getElementById("detail-name").textContent = meta.name;
  document.getElementById("detail-desc").textContent = meta.description;
  document.getElementById("detail-comment").textContent = meta.error
    ? `⚠ ${meta.error}`
    : "";
  renderPortsTable(meta.ports);
  statusEl.textContent = "loading…";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  frameSlider.value = 1;
  frameNum.textContent = "1";
  playing = false;
  playBtn.textContent = "▶";
  dialog.showModal();

  try {
    const file = await (await fetch(`./data/nodes/${meta.name}.json`)).json();
    const network = file.demo || (file.node && wrapInNetwork(file.node));
    if (!network) {
      statusEl.textContent =
        "This node's definition is too large to ship to the browser — the thumbnail above was rendered offline by the same engine.";
      return;
    }
    current = {
      doc: {
        type: "nodebox",
        formatVersion: 1,
        name: meta.name,
        properties: { width: catalog.canvas.width, height: catalog.canvas.height },
        functions: [],
        root: network,
      },
      renderer: createRenderer(registry),
      usesDemo: !!file.demo,
    };
    renderFrame(1);
  } catch (e) {
    statusEl.textContent = `✗ ${e.message || e}`;
  }
}

function wrapInNetwork(node) {
  return {
    name: "root",
    type: "core.network",
    children: [node],
    connections: [],
    renderedChild: node.name,
    publishedPorts: [],
  };
}

function renderFrame(frame) {
  if (!current) return;
  const t0 = performance.now();
  const result = current.renderer.render(current.doc, "/", {
    frame,
    mouse: { x: 0, y: 0 },
    canvas: catalog.canvas,
  });
  const dt = performance.now() - t0;
  draw(result.value);
  current.lastValue = result.value;
  if (result.error) {
    statusEl.textContent = `✗ ${result.error.path}: ${result.error.message}`;
  } else {
    const drawables = result.value.filter(
      (v) => v != null && (g.isShape(v) || g.isPoint(v) || g.isColor(v)),
    );
    const b = g.bounds({ type: "group", shapes: drawables.filter((v) => g.isShape(v) || g.isPoint(v)) });
    const degraded = drawables.length > 0 && !(b.width > 0 || b.height > 0);
    statusEl.textContent =
      `${current.usesDemo ? "original demo" : "node with default values"} · ` +
      `${result.value.length} value${result.value.length === 1 ? "" : "s"} · ${dt.toFixed(0)} ms` +
      (drawables.length === 0 && result.value.length
        ? ` · output: ${result.value.slice(0, 8).map(shortValue).join("  ")}`
        : "") +
      (degraded
        ? " · empty geometry — this node needs glyph outlines, which the web port approximates (see fidelity notes)"
        : "");
  }
  updateDownload();
}

function shortValue(v) {
  if (v == null) return "null";
  if (typeof v === "number") return String(Math.round(v * 1000) / 1000);
  if (typeof v === "string") return JSON.stringify(v.length > 24 ? v.slice(0, 24) + "…" : v);
  if (g.isPoint(v)) return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)})`;
  if (g.isColor(v)) return g.toCSS(v);
  if (typeof v === "object") return JSON.stringify(v).slice(0, 40);
  return String(v);
}

function draw(values) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, w, h);
  const drawables = values.filter(
    (v) => v != null && (g.isShape(v) || g.isPoint(v) || g.isColor(v)),
  );
  if (!drawables.length) return;
  const b = g.bounds({ type: "group", shapes: drawables.filter((v) => g.isShape(v) || g.isPoint(v)) });
  const bw = Math.max(b.width, 1);
  const bh = Math.max(b.height, 1);
  const scale = Math.min((w * 0.88) / bw, (h * 0.88) / bh, 4);
  ctx.setTransform(
    scale, 0, 0, scale,
    w / 2 - (b.x + b.width / 2) * scale,
    h / 2 - (b.y + b.height / 2) * scale,
  );
  for (const v of drawables) g.drawValue(ctx, v);
}

function updateDownload() {
  const link = document.getElementById("download-svg");
  if (!current || !current.lastValue) return;
  const svg = g.toSVG(current.lastValue, catalog.canvas);
  link.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  link.download = `${current.doc.name}.svg`;
}

frameSlider.oninput = () => {
  frameNum.textContent = frameSlider.value;
  renderFrame(Number(frameSlider.value));
};

playBtn.onclick = () => {
  playing = !playing;
  playBtn.textContent = playing ? "⏸" : "▶";
  if (playing) tick();
  else cancelAnimationFrame(rafId);
};

function tick() {
  if (!playing || !current) return;
  let f = Number(frameSlider.value) + 1;
  if (f > Number(frameSlider.max)) f = 1;
  frameSlider.value = f;
  frameNum.textContent = String(f);
  renderFrame(f);
  rafId = requestAnimationFrame(tick);
}

function renderPortsTable(ports) {
  const table = document.getElementById("detail-ports");
  table.innerHTML = "";
  if (!ports || !ports.length) {
    table.innerHTML = "<tr><td class='muted'>no input ports</td></tr>";
    return;
  }
  const head = document.createElement("tr");
  head.innerHTML = "<th>port</th><th>type</th><th>notes</th>";
  table.append(head);
  for (const p of ports) {
    const tr = document.createElement("tr");
    const notes = [];
    if (p.menu) notes.push(p.menu.map((m) => m.key).join(" | "));
    if (p.description) notes.push(p.description);
    tr.innerHTML =
      `<td><code>${p.label || p.name}</code></td>` +
      `<td class="muted">${p.type || ""}${p.range === "list" ? " list" : ""}</td>` +
      `<td class="muted">${notes.join(" · ")}</td>`;
    table.append(tr);
  }
}
