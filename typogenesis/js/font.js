// font.js — assemble a full font (outlines + metrics) from a genome.

import { resolve } from "./genome.js";
import { GLYPHS, CHARSET } from "./glyphs.js";
import { expandGlyph } from "./pen.js";

export { CHARSET };

// Build every glyph for a genome. Returns:
// { P, glyphs: Map(char → {advance, contours, bbox}), metrics }
export function buildFont(genome) {
  const P = resolve(genome);
  const wf = P.width;
  const m = P.W / 2;
  const slantTan = Math.tan((P.slant * Math.PI) / 180);
  const sb = Math.max(16, 26 * wf + P.W * 0.08);

  const glyphs = new Map();

  for (const ch of CHARSET) {
    const fn = GLYPHS[ch];
    if (!fn) continue;
    const g = fn(P, m, wf);
    let contours = expandGlyph(g.strokes, P);
    const lsb = sb * (g.sb0 ?? 1);
    const rsb = sb * (g.sb1 ?? 1);
    // Shift by lsb, apply slant shear, round to integers.
    contours = contours.map((c) =>
      c.map((p) => ({
        x: Math.round(p.x + lsb + p.y * slantTan),
        y: Math.round(p.y),
      }))
    );
    // Drop consecutive duplicates created by rounding.
    contours = contours
      .map((c) =>
        c.filter(
          (p, i) =>
            i === 0 ||
            p.x !== c[i - 1].x ||
            p.y !== c[i - 1].y
        )
      )
      .filter((c) => c.length >= 3);
    const bbox = computeBBox(contours);
    glyphs.set(ch, {
      advance: Math.round(lsb + g.w + rsb),
      contours,
      bbox,
    });
  }

  // Space
  glyphs.set(" ", {
    advance: Math.round(250 * wf),
    contours: [],
    bbox: null,
  });

  return {
    P,
    glyphs,
    metrics: {
      upm: 1000,
      ascender: Math.round(P.A + 20),
      descender: Math.round(P.D - 20),
      capHeight: Math.round(P.C),
      xHeight: Math.round(P.X),
      lineGap: 90,
    },
  };
}

function computeBBox(contours) {
  if (!contours.length) return null;
  let xMin = Infinity,
    yMin = Infinity,
    xMax = -Infinity,
    yMax = -Infinity;
  for (const c of contours)
    for (const p of c) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
  return { xMin, yMin, xMax, yMax };
}

// Total advance width of a string (font units).
export function measure(font, text) {
  let w = 0;
  for (const ch of text) {
    const g = font.glyphs.get(ch);
    w += g ? g.advance : 250;
  }
  return w;
}
