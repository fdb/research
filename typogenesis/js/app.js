// app.js — the foundry UI. State lives here; core modules stay DOM-free.

import {
  GENES,
  randomGenome,
  cloneGenome,
  mutate,
  crossover,
  encodeGenome,
  decodeGenome,
  genomeSeed,
} from "./genome.js";
import { buildFont } from "./font.js";
import { drawFitted } from "./render.js";
import { compileTTF } from "./ttf.js";
import { fontName } from "./names.js";

const $ = (sel) => document.querySelector(sel);

// --- State ------------------------------------------------------------------

let champion = null; // genome
let prevChampion = null;
let litter = []; // genomes shown in the offspring grid
let history = []; // past champions (genomes)
let activeView = "evolve";
let specimenDirty = true;
let loadedFace = null; // current FontFace in document.fonts

const fontCache = new Map(); // encoded genome → built font
function fontFor(genome) {
  const key = encodeGenome(genome);
  let f = fontCache.get(key);
  if (!f) {
    f = buildFont(genome);
    fontCache.set(key, f);
    if (fontCache.size > 60) {
      // drop oldest
      fontCache.delete(fontCache.keys().next().value);
    }
  }
  return f;
}

// --- Boot -------------------------------------------------------------------

function boot() {
  const fromHash = location.hash.match(/g=([0-9a-f]+)/i);
  champion = (fromHash && decodeGenome(fromHash[1])) || randomGenome();
  breed();
  bindUI();
  renderEvolve();
  updateName();
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => renderActive());
  window.addEventListener("resize", () => renderActive());
}

// --- Breeding ---------------------------------------------------------------

function mutationAmount() {
  return Number($("#mutation").value) / 100;
}

function breed() {
  const amt = mutationAmount();
  litter = [];
  for (let i = 0; i < 6; i++) litter.push(mutate(champion, Math.random, amt));
  // One wilder child, one crossover with an ancestor, one stranger.
  litter.push(mutate(champion, Math.random, Math.min(1, amt * 2.2)));
  const other =
    history.length > 0
      ? history[Math.floor(Math.random() * history.length)]
      : randomGenome();
  litter.push(crossover(champion, other, Math.random));
  litter.push(randomGenome());
}

function adopt(genome) {
  if (encodeGenome(genome) === encodeGenome(champion)) return;
  history.push(champion);
  if (history.length > 40) history.shift();
  prevChampion = champion;
  champion = cloneGenome(genome);
  onChampionChanged();
  breed();
  renderEvolve();
}

function onChampionChanged() {
  specimenDirty = true;
  updateName();
  updateHash();
  syncSliders();
}

function updateName() {
  $("#font-name").textContent = fontName(champion);
}

function updateHash() {
  historyReplaceHash("#g=" + encodeGenome(champion));
}

function historyReplaceHash(hash) {
  const url = location.pathname + location.search + hash;
  window.history.replaceState(null, "", url);
}

// --- Evolve view ------------------------------------------------------------

function renderEvolve() {
  const champCanvas = $("#champion");
  drawFitted(champCanvas, fontFor(champion), nameLines(champion), { pad: 14 });

  const grid = $("#offspring");
  while (grid.children.length < litter.length) {
    const c = document.createElement("canvas");
    const idx = grid.children.length;
    c.addEventListener("click", () => adopt(litter[idx]));
    grid.appendChild(c);
  }
  litter.forEach((genome, i) => {
    drawFitted(grid.children[i], fontFor(genome), "Ages", { pad: 8 });
  });

  renderHistory();
}

function nameLines(genome) {
  const name = fontName(genome);
  const words = name.split(" ");
  if (name.length > 14 && words.length > 1) {
    const mid = Math.ceil(words.length / 2);
    return words.slice(0, mid).join(" ") + "\n" + words.slice(mid).join(" ");
  }
  return name;
}

function renderHistory() {
  const wrap = $("#history");
  wrap.innerHTML = "";
  [...history]
    .slice(-14)
    .reverse()
    .forEach((genome) => {
      const c = document.createElement("canvas");
      c.addEventListener("click", () => adopt(genome));
      wrap.appendChild(c);
      drawFitted(c, fontFor(genome), "Ag", { pad: 5 });
    });
  $("#history-wrap").style.display = history.length ? "" : "none";
}

// --- Genes view -------------------------------------------------------------

function buildSliders() {
  const wrap = $("#sliders");
  for (const gene of GENES) {
    const row = document.createElement("div");
    row.className = "tg-gene";
    const label = document.createElement("label");
    label.textContent = gene.label;
    label.title = gene.tip;
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1000";
    input.dataset.gene = gene.key;
    const out = document.createElement("output");
    input.addEventListener("input", () => {
      champion[gene.key] = Number(input.value) / 1000;
      out.textContent = (champion[gene.key] * 100).toFixed(0);
      specimenDirty = true;
      updateName();
      updateHash();
      requestAnimationFrame(renderGenes);
    });
    input.addEventListener("change", () => {
      // A deliberate edit is a new individual: refresh the litter.
      breed();
    });
    row.append(label, input, out);
    wrap.appendChild(row);
  }
}

function syncSliders() {
  for (const input of document.querySelectorAll("#sliders input")) {
    const v = champion[input.dataset.gene];
    input.value = String(Math.round(v * 1000));
    input.nextElementSibling.textContent = (v * 100).toFixed(0);
  }
}

function renderGenes() {
  drawFitted(
    $("#genes-preview"),
    fontFor(champion),
    "Handgloves\n0123456789",
    { pad: 12 }
  );
}

// --- Specimen view ----------------------------------------------------------

async function renderSpecimen() {
  if (!specimenDirty && loadedFace) return;
  specimenDirty = false;
  const name = fontName(champion);
  const font = fontFor(champion);
  const ttf = compileTTF(font, name);
  const familyCSS = "TG-" + genomeSeed(champion).toString(16);
  const face = new FontFace(familyCSS, ttf.buffer);
  await face.load();
  if (loadedFace) document.fonts.delete(loadedFace);
  document.fonts.add(face);
  loadedFace = face;
  $("#specimen").style.fontFamily = `"${familyCSS}"`;
  $("#spec-name").textContent = name;
  $("#ttf-size").textContent = (ttf.length / 1024).toFixed(1) + " KB · " + name;
  // Stash bytes for download.
  currentTTF = { bytes: ttf, name };
}

let currentTTF = null;

function downloadTTF() {
  if (!currentTTF) return;
  const blob = new Blob([currentTTF.bytes], { type: "font/ttf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = currentTTF.name.replace(/\s+/g, "") + ".ttf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// --- Views / navigation -----------------------------------------------------

function showView(name) {
  activeView = name;
  for (const v of document.querySelectorAll(".tg-view"))
    v.hidden = v.id !== "view-" + name;
  for (const b of document.querySelectorAll(".tg-tabs button"))
    b.classList.toggle("active", b.dataset.view === name);
  renderActive();
}

function renderActive() {
  if (activeView === "evolve") renderEvolve();
  else if (activeView === "genes") renderGenes();
  else if (activeView === "specimen") renderSpecimen();
}

// --- Wiring -----------------------------------------------------------------

function bindUI() {
  buildSliders();
  syncSliders();

  for (const b of document.querySelectorAll(".tg-tabs button"))
    b.addEventListener("click", () => showView(b.dataset.view));

  $("#btn-random").addEventListener("click", () => adopt(randomGenome()));

  $("#btn-share").addEventListener("click", async () => {
    const url = location.origin + location.pathname + "#g=" + encodeGenome(champion);
    const title = fontName(champion) + " — typogenesis";
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        flash($("#btn-share"), "✓");
      }
    } catch {
      /* user cancelled */
    }
  });

  $("#btn-download").addEventListener("click", downloadTTF);

  $("#mutation").addEventListener("change", () => {
    breed();
    renderEvolve();
  });
}

function flash(btn, txt) {
  const old = btn.textContent;
  btn.textContent = txt;
  setTimeout(() => (btn.textContent = old), 900);
}

boot();
