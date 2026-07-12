// genome.js — a typeface as a bundle of genes.
//
// Every gene is stored normalized 0..1. `resolve()` maps a genome to the
// concrete design parameters used by the glyph skeletons and the pen.

import { lerp, clamp, rng } from "./util.js";

export const GENES = [
  { key: "weight",      label: "Weight",       tip: "stem thickness" },
  { key: "contrast",    label: "Contrast",     tip: "thick vs thin strokes" },
  { key: "width",       label: "Width",        tip: "condensed ↔ extended" },
  { key: "xheight",     label: "x-height",     tip: "lowercase body size" },
  { key: "capheight",   label: "Cap height",   tip: "uppercase size" },
  { key: "ascender",    label: "Ascender",     tip: "b d f h k l reach" },
  { key: "descender",   label: "Descender",    tip: "g j p q y depth" },
  { key: "roundness",   label: "Roundness",    tip: "round ↔ square bowls" },
  { key: "aperture",    label: "Aperture",     tip: "open ↔ closed terminals" },
  { key: "slant",       label: "Slant",        tip: "upright ↔ italic" },
  { key: "penangle",    label: "Pen angle",    tip: "stress axis rotation" },
  { key: "taper",       label: "Taper",        tip: "stroke ends thin out" },
  { key: "serif",       label: "Serifs",       tip: "none ↔ long serifs" },
  { key: "serifweight", label: "Serif weight", tip: "hairline ↔ slab" },
];

export function randomGenome(rand = Math.random) {
  const g = {};
  for (const gene of GENES) g[gene.key] = rand();
  // Bias: full-range serifs everywhere looks chaotic; make sans more likely.
  if (rand() < 0.45) g.serif = g.serif * 0.2;
  // Extreme slants are rare in the wild.
  g.slant = g.slant < 0.7 ? lerp(0.28, 0.45, g.slant) : g.slant;
  return g;
}

export function cloneGenome(g) {
  return { ...g };
}

// Gaussian-ish mutation of every gene; `amount` 0..1 is the temperature.
export function mutate(g, rand = Math.random, amount = 0.5) {
  const out = {};
  const sigma = lerp(0.02, 0.22, amount);
  for (const gene of GENES) {
    // Sum of 3 uniforms ≈ gaussian, cheap and good enough.
    const n = (rand() + rand() + rand()) / 1.5 - 1; // ≈ [-1, 1]
    out[gene.key] = clamp(g[gene.key] + n * sigma, 0, 1);
  }
  return out;
}

// Uniform crossover with a little blending.
export function crossover(a, b, rand = Math.random) {
  const out = {};
  for (const gene of GENES) {
    const t = rand();
    if (t < 0.4) out[gene.key] = a[gene.key];
    else if (t < 0.8) out[gene.key] = b[gene.key];
    else out[gene.key] = lerp(a[gene.key], b[gene.key], rand());
  }
  return out;
}

// --- Serialization (URL-safe) ----------------------------------------------

export function encodeGenome(g) {
  let s = "";
  for (const gene of GENES) {
    const v = Math.round(clamp(g[gene.key], 0, 1) * 255);
    s += v.toString(16).padStart(2, "0");
  }
  return s;
}

export function decodeGenome(s) {
  if (!/^[0-9a-f]+$/i.test(s) || s.length < GENES.length * 2) return null;
  const g = {};
  GENES.forEach((gene, i) => {
    g[gene.key] = parseInt(s.slice(i * 2, i * 2 + 2), 16) / 255;
  });
  return g;
}

// Deterministic 32-bit hash of a genome — used to seed the name generator,
// so a genome always carries the same name.
export function genomeSeed(g) {
  const s = encodeGenome(g);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- Resolve genes → concrete design parameters (units: 1000/em) -----------

export function resolve(g) {
  const C = lerp(640, 730, g.capheight); // cap height
  const X = C * lerp(0.6, 0.78, g.xheight); // x-height
  const A = C + lerp(10, 90, g.ascender); // ascender
  const D = -lerp(150, 265, g.descender); // descender (negative)
  const W = lerp(28, 175, g.weight); // main stem weight
  const contrast = lerp(1.0, 0.3, g.contrast); // thin = W * contrast
  const T = W * contrast; // thin stroke
  const serifLen = g.serif < 0.18 ? 0 : lerp(10, 78, (g.serif - 0.18) / 0.82);
  return {
    genome: g,
    upm: 1000,
    C,
    X,
    A,
    D,
    o: 11, // overshoot of round shapes
    W,
    T,
    contrast,
    width: lerp(0.74, 1.32, g.width),
    k: lerp(1.7, 3.8, g.roundness), // superellipse exponent
    aperture: g.aperture, // 0 closed .. 1 open
    slant: lerp(-4, 15, g.slant), // degrees
    penAngle: (lerp(0, 32, g.penangle) * Math.PI) / 180,
    taper: g.taper,
    serifLen,
    serifTh: lerp(Math.max(14, T * 0.5), Math.max(26, W * 0.92), g.serifweight),
    dotR: Math.max(W * 0.62, 24),
  };
}
