/*
 * essay.js — the two interactives on the essay page.
 * The pattern widget queries the real pattern engine (js/pattern.js).
 */

import { mini } from "./pattern.js";

// ---------------------------------------------------- spectrum diagram

const DESCS = [
  `<strong>I · pure functions.</strong> A from-scratch pattern language:
   one type (a pure function of time), a mini-notation, and classical FP
   combinators. Total control, total transparency — you can read the
   whole instrument in an afternoon. The cost: everything is your job.`,
  `<strong>II · node graphs.</strong> Dataflow patching à la modular
   synth: sequencers, filters, LFOs, typed cables. Structure becomes
   visible and grabbable; parameters become knobs you can ride. The
   cost: abstraction ceiling — the graph can only say what its nodes
   can say.`,
  `<strong>III · coding agents.</strong> An LLM with file tools performs
   alongside you, editing and running the same project files at
   conversational speed. Intent in, working code out, errors self-healed.
   The cost: you trade certainty for reach — and must design for
   recovery, not for correctness.`,
];

const spectrum = document.getElementById("spectrum");
if (spectrum) {
  const desc = document.getElementById("spectrum-desc");
  const stops = [...spectrum.querySelectorAll(".spectrum-stop")];
  const select = (i) => {
    stops.forEach((s, j) => s.classList.toggle("active", i === j));
    desc.innerHTML = DESCS[i];
  };
  stops.forEach((s) => s.addEventListener("click", () => select(+s.dataset.i)));
  select(0);
}

// ------------------------------------------------------ pattern widget

const widget = document.getElementById("pattern-widget");
if (widget) {
  const input = widget.querySelector("input");
  const err = widget.querySelector(".perr");
  const svg = widget.querySelector("svg");
  const NS = "http://www.w3.org/2000/svg";
  const CYCLES = 2;
  const W = 800, H = 120, PAD = 4;

  function shade(v) {
    // deterministic grayscale per value, primary-ish for the first ones
    const s = String(v);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return `oklch(${45 + (h % 35)}% 0.02 ${h % 360})`;
  }

  function render() {
    err.textContent = "";
    svg.innerHTML = "";
    let haps;
    try {
      haps = mini(input.value).query(0, CYCLES);
    } catch (e) {
      err.textContent = String(e.message || e);
      return;
    }
    // assign overlapping haps to rows
    const rows = [];
    const sorted = [...haps].sort((a, b) => a.b - b.b || a.e - b.e);
    for (const h of sorted) {
      let r = rows.findIndex((endT) => h.b >= endT - 1e-9);
      if (r === -1) { rows.push(0); r = rows.length - 1; }
      rows[r] = h.e;
      h.row = r;
    }
    const nRows = Math.max(rows.length, 1);
    const rowH = (H - PAD * 2 - 14) / nRows;

    // cycle boundary lines + beat ticks
    for (let c = 0; c <= CYCLES * 4; c++) {
      const x = (c / (CYCLES * 4)) * W;
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", x); line.setAttribute("x2", x);
      line.setAttribute("y1", 14); line.setAttribute("y2", H - PAD);
      line.setAttribute("stroke", "currentColor");
      line.setAttribute("stroke-opacity", c % 4 === 0 ? "0.5" : "0.12");
      svg.appendChild(line);
      if (c % 4 === 0 && c < CYCLES * 4) {
        const t = document.createElementNS(NS, "text");
        t.setAttribute("x", x + 4); t.setAttribute("y", 10);
        t.setAttribute("fill", "currentColor");
        t.setAttribute("font-size", "9");
        t.setAttribute("opacity", "0.6");
        t.textContent = `cycle ${c / 4}`;
        svg.appendChild(t);
      }
    }

    for (const h of sorted) {
      const x = (h.b / CYCLES) * W;
      const w = Math.max(1.5, ((h.e - h.b) / CYCLES) * W - 1.5);
      const y = 14 + PAD + h.row * rowH;
      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", x); rect.setAttribute("y", y);
      rect.setAttribute("width", w); rect.setAttribute("height", Math.max(4, rowH - 3));
      rect.setAttribute("fill", shade(h.v));
      svg.appendChild(rect);
      const label = document.createElementNS(NS, "text");
      label.setAttribute("x", x + 3);
      label.setAttribute("y", y + Math.max(4, rowH - 3) / 2 + 3.5);
      label.setAttribute("fill", "oklch(99% 0 0)");
      label.setAttribute("font-size", "10");
      label.setAttribute("font-family", "ui-monospace, monospace");
      label.textContent = String(h.v);
      svg.appendChild(label);
    }
  }

  input.addEventListener("input", render);
  widget.querySelectorAll(".try code").forEach((c) => {
    c.addEventListener("click", () => {
      input.value = c.textContent;
      render();
    });
  });
  render();
}
