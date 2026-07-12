// glyphs.js — parametric glyph skeletons.
//
// Every glyph is a function of the resolved params P returning
//   { w, strokes, sb0?, sb1? }
// where `w` is the body width (outline box [0..w]), strokes are skeleton
// polylines for the pen, and sb0/sb1 scale the default sidebearings.
//
// Coordinates: y-up, baseline at 0, units 1000/em. Skeleton centerlines are
// inset by m = W/2 so outlines land exactly on the body box.

import { lerp, sampleQuad, sampleSuperArc, joinPts } from "./util.js";

const D2R = Math.PI / 180;

// -- Stroke constructors -----------------------------------------------------

const L = (x0, y0, x1, y1, o = {}) => ({
  pts: [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ],
  ...o,
});

const P_ = (arr, o = {}) => ({ pts: arr.map(([x, y]) => ({ x, y })), ...o });

function arc(P, cx, cy, rx, ry, a0, a1, o = {}) {
  const n = Math.max(10, Math.round(Math.abs(a1 - a0) / 4));
  return {
    pts: sampleSuperArc(cx, cy, rx, ry, o.k || P.k, a0 * D2R, a1 * D2R, n),
    ...o,
  };
}

function ring(P, cx, cy, rx, ry, o = {}) {
  const pts = sampleSuperArc(cx, cy, rx, ry, o.k || P.k, 0, 2 * Math.PI, 72);
  pts.pop(); // drop duplicated closing point
  return { pts, closed: true, ...o };
}

function dot(P, cx, cy, r) {
  // A filled blob (used for i-dots, punctuation).
  const pts = sampleSuperArc(cx, cy, r, r * 1.04, Math.min(P.k, 2.6), 0, 2 * Math.PI, 26);
  pts.pop();
  return { pts, blob: true };
}

function rot180(strokes, cx, cy) {
  return strokes.map((s) => ({
    ...s,
    pts: s.pts.map((p) => ({ x: 2 * cx - p.x, y: 2 * cy - p.y })).reverse(),
    cap0: s.cap1,
    cap1: s.cap0,
    taper0: s.taper1,
    taper1: s.taper0,
  }));
}

// Superellipse point at angle (degrees) — for connecting geometry.
function sePoint(P, cx, cy, rx, ry, aDeg, k) {
  const e = 2 / (k || P.k);
  const t = aDeg * D2R;
  const ct = Math.cos(t);
  const st = Math.sin(t);
  return {
    x: cx + rx * Math.sign(ct) * Math.pow(Math.abs(ct), e),
    y: cy + ry * Math.sign(st) * Math.pow(Math.abs(st), e),
  };
}

// Ring vertical geometry: given desired top/bottom OUTER edges, return
// centerline cy/ry (outer edge = centerline ± thin/2).
function vspan(P, yTopOuter, yBotOuter) {
  const top = yTopOuter - P.T / 2;
  const bot = yBotOuter + P.T / 2;
  return { cy: (top + bot) / 2, ry: Math.max((top - bot) / 2, P.T * 0.4) };
}

// -- The glyph library -------------------------------------------------------
// Each entry: (P, m, wf) → { w, strokes }
//   m = W/2, wf = width factor

export const GLYPHS = {};

function def(chars, fn) {
  for (const ch of chars.split("")) GLYPHS[ch] = fn;
}

// ===== Uppercase ============================================================

def("A", (P, m, wf) => {
  const w = 0.78 * P.C * wf + 2 * m;
  const apexY = P.C - P.W * 0.4;
  const x0 = m * 1.1;
  const body = P_(
    [
      [x0, 0],
      [w / 2, apexY],
      [w - x0, 0],
    ],
    { cap0: "serif", cap1: "serif" }
  );
  const yb = 0.3 * P.C;
  const t = yb / apexY;
  const xb = lerp(x0, w / 2, t);
  return {
    w,
    strokes: [body, L(xb, yb, w - xb, yb, { fixed: P.T })],
    sb0: 0.5,
    sb1: 0.5,
  };
});

def("B", (P, m, wf) => {
  const w = 0.6 * P.C * wf + 2 * m;
  const yMid = 0.55 * P.C;
  const stem = L(m, P.C, m, 0, { cap0: "serif", cap1: "serif" });
  const { cy: cu, ry: ru } = vspan(P, P.C, yMid);
  const { cy: cl, ry: rl } = vspan(P, yMid + P.T, 0);
  const rxU = (w - 2 * m) * 0.88;
  const rxL = w - 2 * m;
  return {
    w,
    strokes: [
      stem,
      arc(P, m, cu, rxU, ru, 90, -90),
      arc(P, m, cl, rxL, rl, 90, -90),
    ],
  };
});

def("C", (P, m, wf) => {
  const w = 0.72 * P.C * wf + 2 * m;
  const gap = lerp(28, 55, P.aperture);
  const { cy, ry } = vspan(P, P.C + P.o, -P.o);
  return {
    w,
    strokes: [
      arc(P, w / 2, cy, w / 2 - m, ry, gap, 360 - gap, {
        cap0: "round",
        cap1: "round",
        taper0: true,
        taper1: true,
      }),
    ],
    sb0: 0.6,
    sb1: 0.6,
  };
});

def("D", (P, m, wf) => {
  const w = 0.72 * P.C * wf + 2 * m;
  const { cy, ry } = vspan(P, P.C, 0);
  return {
    w,
    strokes: [
      L(m, P.C, m, 0, { cap0: "serif", cap1: "serif" }),
      arc(P, m, cy, w - 2 * m, ry, 90, -90),
    ],
  };
});

def("E", (P, m, wf) => {
  const w = 0.56 * P.C * wf + 2 * m;
  return {
    w,
    strokes: [
      L(m, P.C, m, 0, { cap0: "serif", cap1: "serif" }),
      L(m, P.C - P.T / 2, w - m * 0.4, P.C - P.T / 2),
      L(m, 0.53 * P.C, w - m - 0.06 * P.C, 0.53 * P.C),
      L(m, P.T / 2, w - m * 0.4, P.T / 2),
    ],
  };
});

def("F", (P, m, wf) => {
  const w = 0.54 * P.C * wf + 2 * m;
  return {
    w,
    strokes: [
      L(m, P.C, m, 0, { cap0: "serif", cap1: "serif" }),
      L(m, P.C - P.T / 2, w - m * 0.4, P.C - P.T / 2),
      L(m, 0.52 * P.C, w - m - 0.08 * P.C, 0.52 * P.C),
    ],
  };
});

def("G", (P, m, wf) => {
  const w = 0.76 * P.C * wf + 2 * m;
  const gap = lerp(22, 42, P.aperture);
  const { cy, ry } = vspan(P, P.C + P.o, -P.o);
  const ybar = 0.4 * P.C;
  const barTh = lerp(P.T, P.W, 0.55);
  return {
    w,
    strokes: [
      arc(P, w / 2, cy, w / 2 - m, ry, gap, 360 - gap, {
        cap0: "round",
        cap1: "round",
        taper0: true,
      }),
      L(w * 0.52, ybar, w - m, ybar, { fixed: barTh }),
      L(w - m, ybar, w - m, ybar - 0.16 * P.C - barTh, {}),
    ],
    sb0: 0.6,
  };
});

def("H", (P, m, wf) => {
  const w = 0.68 * P.C * wf + 2 * m;
  return {
    w,
    strokes: [
      L(m, P.C, m, 0, { cap0: "serif", cap1: "serif" }),
      L(w - m, P.C, w - m, 0, { cap0: "serif", cap1: "serif" }),
      L(m, 0.52 * P.C, w - m, 0.52 * P.C),
    ],
  };
});

def("I", (P, m) => ({
  w: 2 * m,
  strokes: [L(m, P.C, m, 0, { cap0: "serif", cap1: "serif" })],
  sb0: 1.4,
  sb1: 1.4,
}));

def("J", (P, m, wf) => {
  const w = 0.5 * P.C * wf + 2 * m;
  const yj = 0.26 * P.C;
  const cx = (m + (w - m)) / 2;
  const ry = yj + P.o - P.T / 2;
  return {
    w,
    strokes: [
      {
        pts: joinPts(
          [
            { x: w - m, y: P.C },
            { x: w - m, y: yj },
          ],
          sampleSuperArc(cx, yj, (w - 2 * m) / 2, ry, P.k, 0, -Math.PI, 24)
        ),
        cap0: "serif",
        cap1: "round",
        taper1: true,
      },
    ],
  };
});

def("K", (P, m, wf) => {
  const w = 0.68 * P.C * wf + 2 * m;
  return {
    w,
    strokes: [
      L(m, P.C, m, 0, { cap0: "serif", cap1: "serif" }),
      L(w - m, P.C, m, 0.42 * P.C, { cap0: "serif" }),
      L(m + 0.1 * P.C, 0.52 * P.C, w - m * 0.8, 0, { cap1: "serif" }),
    ],
  };
});

def("L", (P, m, wf) => {
  const w = 0.54 * P.C * wf + 2 * m;
  return {
    w,
    strokes: [
      L(m, P.C, m, 0, { cap0: "serif", cap1: "serif" }),
      L(m, P.T / 2, w - m * 0.4, P.T / 2),
    ],
  };
});

def("M", (P, m, wf) => {
  const w = 0.9 * P.C * wf + 2 * m;
  const vy = 0.14 * P.C;
  return {
    w,
    strokes: [
      L(m, 0, m, P.C, { cap0: "serif" }),
      L(w - m, 0, w - m, P.C, { cap0: "serif" }),
      P_(
        [
          [m, P.C],
          [w / 2, vy],
          [w - m, P.C],
        ],
        { mult: 0.92 }
      ),
    ],
  };
});

def("N", (P, m, wf) => {
  const w = 0.72 * P.C * wf + 2 * m;
  return {
    w,
    strokes: [
      L(m, 0, m, P.C, { cap0: "serif" }),
      L(w - m, P.C, w - m, 0, { cap0: "serif" }),
      L(m, P.C, w - m, 0),
    ],
  };
});

def("O", (P, m, wf) => {
  const w = 0.8 * P.C * wf + 2 * m;
  const { cy, ry } = vspan(P, P.C + P.o, -P.o);
  return { w, strokes: [ring(P, w / 2, cy, w / 2 - m, ry)], sb0: 0.6, sb1: 0.6 };
});

def("P", (P, m, wf) => {
  const w = 0.6 * P.C * wf + 2 * m;
  const yb = 0.42 * P.C;
  const { cy, ry } = vspan(P, P.C, yb);
  return {
    w,
    strokes: [
      L(m, P.C, m, 0, { cap0: "serif", cap1: "serif" }),
      arc(P, m, cy, w - 2 * m, ry, 90, -90),
    ],
  };
});

def("Q", (P, m, wf) => {
  const w = 0.8 * P.C * wf + 2 * m;
  const { cy, ry } = vspan(P, P.C + P.o, -P.o);
  return {
    w,
    strokes: [
      ring(P, w / 2, cy, w / 2 - m, ry),
      L(w / 2 + 0.04 * P.C, 0.16 * P.C, w / 2 + 0.3 * P.C, -0.12 * P.C, {
        cap1: "round",
      }),
    ],
    sb0: 0.6,
    sb1: 0.6,
  };
});

def("R", (P, m, wf) => {
  const w = 0.62 * P.C * wf + 2 * m;
  const yb = 0.44 * P.C;
  const { cy, ry } = vspan(P, P.C, yb);
  return {
    w,
    strokes: [
      L(m, P.C, m, 0, { cap0: "serif", cap1: "serif" }),
      arc(P, m, cy, (w - 2 * m) * 0.94, ry, 90, -90),
      L(m + 0.16 * P.C, yb, w - m * 0.7, 0, { cap1: "serif" }),
    ],
  };
});

def("S", (P, m, wf) => {
  const w = 0.6 * P.C * wf + 2 * m;
  const cx = w / 2;
  const cyG = P.C / 2;
  const top = P.C + P.o - P.T / 2;
  const cyT = (top + cyG) / 2;
  const ryT = cyT - cyG;
  const a0 = lerp(28, 55, P.aperture);
  const n = 30;
  const topHalf = sampleSuperArc(
    cx,
    cyT,
    w / 2 - m,
    ryT,
    P.k,
    a0 * D2R,
    270 * D2R,
    n
  );
  const botHalf = topHalf
    .map((p) => ({ x: 2 * cx - p.x, y: 2 * cyG - p.y }))
    .reverse();
  return {
    w,
    strokes: [
      {
        pts: joinPts(topHalf, botHalf),
        cap0: "round",
        cap1: "round",
        taper0: true,
        taper1: true,
      },
    ],
    sb0: 0.7,
    sb1: 0.7,
  };
});

def("T", (P, m, wf) => {
  const w = 0.68 * P.C * wf + 2 * m;
  return {
    w,
    strokes: [
      L(m * 0.4, P.C - P.T / 2, w - m * 0.4, P.C - P.T / 2),
      L(w / 2, P.C, w / 2, 0, { cap1: "serif" }),
    ],
    sb0: 0.5,
    sb1: 0.5,
  };
});

def("U", (P, m, wf) => {
  const w = 0.7 * P.C * wf + 2 * m;
  const yu = 0.3 * P.C;
  const ry = yu + P.o - P.T / 2;
  return {
    w,
    strokes: [
      {
        pts: joinPts(
          [
            { x: m, y: P.C },
            { x: m, y: yu },
          ],
          sampleSuperArc(w / 2, yu, w / 2 - m, ry, P.k, Math.PI, 2 * Math.PI, 30),
          [
            { x: w - m, y: yu },
            { x: w - m, y: P.C },
          ]
        ),
        cap0: "serif",
        cap1: "serif",
      },
    ],
  };
});

def("V", (P, m, wf) => {
  const w = 0.76 * P.C * wf + 2 * m;
  return {
    w,
    strokes: [
      P_(
        [
          [m, P.C],
          [w / 2, P.W * 0.52],
          [w - m, P.C],
        ],
        { cap0: "serif", cap1: "serif" }
      ),
    ],
    sb0: 0.5,
    sb1: 0.5,
  };
});

def("W", (P, m, wf) => {
  const w = 1.14 * P.C * wf + 2 * m;
  const vy = P.W * 0.52;
  return {
    w,
    strokes: [
      P_(
        [
          [m, P.C],
          [0.28 * w, vy],
          [w / 2, 0.6 * P.C],
          [0.72 * w, vy],
          [w - m, P.C],
        ],
        { cap0: "serif", cap1: "serif", mult: 0.88 }
      ),
    ],
    sb0: 0.5,
    sb1: 0.5,
  };
});

def("X", (P, m, wf) => {
  const w = 0.72 * P.C * wf + 2 * m;
  return {
    w,
    strokes: [
      L(m, P.C, w - m, 0, { cap0: "serif", cap1: "serif" }),
      L(w - m, P.C, m, 0, { cap0: "serif", cap1: "serif" }),
    ],
    sb0: 0.6,
    sb1: 0.6,
  };
});

def("Y", (P, m, wf) => {
  const w = 0.74 * P.C * wf + 2 * m;
  const yj = 0.44 * P.C;
  return {
    w,
    strokes: [
      L(m, P.C, w / 2, yj, { cap0: "serif" }),
      L(w - m, P.C, w / 2, yj, { cap0: "serif" }),
      L(w / 2, yj, w / 2, 0, { cap1: "serif" }),
    ],
    sb0: 0.5,
    sb1: 0.5,
  };
});

def("Z", (P, m, wf) => {
  const w = 0.64 * P.C * wf + 2 * m;
  return {
    w,
    strokes: [
      L(m * 0.5, P.C - P.T / 2, w - m * 0.6, P.C - P.T / 2),
      L(w - m, P.C - P.T * 0.75, m, P.T * 0.75, { mult: 1.1 }),
      L(m * 0.5, P.T / 2, w - m * 0.5, P.T / 2),
    ],
  };
});

// ===== Lowercase ============================================================

const ow = (P, wf) => P.X * 0.94 * wf + P.W; // round lowercase body width

def("o", (P, m, wf) => {
  const w = ow(P, wf);
  const { cy, ry } = vspan(P, P.X + P.o, -P.o);
  return { w, strokes: [ring(P, w / 2, cy, w / 2 - m, ry)], sb0: 0.6, sb1: 0.6 };
});

def("a", (P, m, wf) => {
  const w = ow(P, wf) * 0.96;
  const { cy, ry } = vspan(P, P.X + P.o, -P.o);
  return {
    w,
    strokes: [
      ring(P, w / 2, cy, w / 2 - m, ry),
      L(w - m, P.X, w - m, 0, { cap1: "serif" }),
    ],
    sb0: 0.6,
  };
});

def("b", (P, m, wf) => {
  const w = ow(P, wf);
  const { cy, ry } = vspan(P, P.X + P.o, -P.o);
  return {
    w,
    strokes: [
      L(m, P.A, m, 0, { cap0: "serif", cap1: "serif" }),
      ring(P, (m + w - m) / 2 + 0, cy, (w - 2 * m) / 2, ry),
    ],
    sb1: 0.6,
  };
});

def("c", (P, m, wf) => {
  const w = ow(P, wf) * 0.94;
  const gap = lerp(30, 60, P.aperture);
  const { cy, ry } = vspan(P, P.X + P.o, -P.o);
  return {
    w,
    strokes: [
      arc(P, w / 2, cy, w / 2 - m, ry, gap, 360 - gap, {
        cap0: "round",
        cap1: "round",
        taper0: true,
        taper1: true,
      }),
    ],
    sb0: 0.6,
    sb1: 0.6,
  };
});

def("d", (P, m, wf) => {
  const w = ow(P, wf);
  const { cy, ry } = vspan(P, P.X + P.o, -P.o);
  return {
    w,
    strokes: [
      L(w - m, P.A, w - m, 0, { cap0: "serif", cap1: "serif" }),
      ring(P, w / 2, cy, (w - 2 * m) / 2, ry),
    ],
    sb0: 0.6,
  };
});

def("e", (P, m, wf) => {
  const w = ow(P, wf);
  const { cy, ry } = vspan(P, P.X + P.o, -P.o);
  const ybar = cy + ry * 0.42;
  // Start the bowl arc where the crossbar meets it.
  const v = Math.min(0.98, (ybar - cy) / ry);
  const a0 = Math.asin(Math.pow(v, P.k / 2)) / D2R;
  const aEnd = 360 - lerp(38, 66, P.aperture);
  return {
    w,
    strokes: [
      arc(P, w / 2, cy, w / 2 - m, ry, a0, aEnd, {
        cap0: "flat",
        cap1: "round",
        taper1: true,
      }),
      L(m * 0.7, ybar, w - m * 0.55, ybar, { fixed: P.T }),
    ],
    sb0: 0.6,
    sb1: 0.6,
  };
});

def("f", (P, m, wf) => {
  const rf = 0.3 * P.X;
  const fx = m + 0.1 * P.X;
  const ext = lerp(0.02, 0.14, P.aperture) * P.X;
  const w = fx + rf + ext + m;
  return {
    w,
    strokes: [
      {
        pts: joinPts(
          [
            { x: fx, y: 0 },
            { x: fx, y: P.A - P.T / 2 - rf },
          ],
          sampleSuperArc(
            fx + rf,
            P.A - P.T / 2 - rf,
            rf,
            rf,
            Math.min(P.k, 2.4),
            Math.PI,
            Math.PI / 2,
            12
          ),
          [{ x: fx + rf + ext, y: P.A - P.T / 2 }]
        ),
        cap0: "serif",
        cap1: "round",
        taper1: true,
      },
      L(fx - 0.22 * P.X, P.X - P.T / 2, fx + 0.34 * P.X, P.X - P.T / 2, {
        fixed: P.T,
      }),
    ],
    sb0: 0.8,
    sb1: 0.4,
  };
});

def("g", (P, m, wf) => {
  const w = ow(P, wf);
  const { cy, ry } = vspan(P, P.X + P.o, -P.o);
  const yh = P.D * 0.42;
  const lg = m * 0.4;
  const hookRy = yh - (P.D + P.T / 2 - P.o);
  return {
    w,
    strokes: [
      ring(P, w / 2, cy, (w - 2 * m) / 2, ry),
      {
        pts: joinPts(
          [
            { x: w - m, y: P.X },
            { x: w - m, y: yh },
          ],
          sampleSuperArc(
            (w - m + lg) / 2,
            yh,
            (w - m - lg) / 2,
            hookRy,
            P.k,
            0,
            -Math.PI,
            24
          )
        ),
        cap0: "flat",
        cap1: "round",
        taper1: true,
      },
    ],
    sb0: 0.6,
    sb1: 0.7,
  };
});

function archStroke(P, xL, xR, yTopOuter, descendTo, opts = {}) {
  // n/h/m arch: starts on the left stem, over the top, down to baseline.
  const cya = P.X * 0.55;
  const ry = yTopOuter - P.T / 2 - cya;
  const cx = (xL + xR) / 2;
  return {
    pts: joinPts(
      sampleSuperArc(cx, cya, (xR - xL) / 2, ry, P.k, Math.PI, 0, 24),
      [
        { x: xR, y: cya },
        { x: xR, y: descendTo },
      ]
    ),
    cap0: "flat",
    cap1: "serif",
    ...opts,
  };
}

def("h", (P, m, wf) => {
  const w = ow(P, wf) * 0.98;
  return {
    w,
    strokes: [
      L(m, P.A, m, 0, { cap0: "serif", cap1: "serif" }),
      archStroke(P, m, w - m, P.X, 0),
    ],
  };
});

def("n", (P, m, wf) => {
  const w = ow(P, wf) * 0.98;
  return {
    w,
    strokes: [
      L(m, P.X, m, 0, { cap0: "serif", cap1: "serif" }),
      archStroke(P, m, w - m, P.X, 0),
    ],
  };
});

def("m", (P, m, wf) => {
  const w = ow(P, wf) * 1.64;
  const mid = w / 2;
  return {
    w,
    strokes: [
      L(m, P.X, m, 0, { cap0: "serif", cap1: "serif" }),
      archStroke(P, m, mid, P.X, 0),
      archStroke(P, mid, w - m, P.X, 0),
    ],
  };
});

def("i", (P, m) => ({
  w: 2 * m,
  strokes: [
    L(m, P.X, m, 0, { cap0: "serif", cap1: "serif" }),
    dot(P, m, Math.min(P.A - P.dotR, P.X + 0.32 * P.X), P.dotR),
  ],
  sb0: 1.2,
  sb1: 1.2,
}));

def("j", (P, m) => {
  const w = 0.42 * P.X + 2 * m;
  const jx = w - m;
  const yh = P.D * 0.38;
  const lg = m * 0.3;
  const hookRy = yh - (P.D + P.T / 2 - P.o);
  return {
    w,
    strokes: [
      {
        pts: joinPts(
          [
            { x: jx, y: P.X },
            { x: jx, y: yh },
          ],
          sampleSuperArc((jx + lg) / 2, yh, (jx - lg) / 2, hookRy, P.k, 0, -Math.PI, 22)
        ),
        cap0: "serif",
        cap1: "round",
        taper1: true,
      },
      dot(P, jx, Math.min(P.A - P.dotR, P.X + 0.32 * P.X), P.dotR),
    ],
    sb0: 0.8,
  };
});

def("k", (P, m, wf) => {
  const w = 0.78 * P.X * wf + 2 * m;
  const junc = [m, 0.55 * P.X];
  const armEnd = [w - m, P.X];
  const legStart = [lerp(junc[0], armEnd[0], 0.32), lerp(junc[1], armEnd[1], 0.32)];
  return {
    w,
    strokes: [
      L(m, P.A, m, 0, { cap0: "serif", cap1: "serif" }),
      L(junc[0], junc[1], armEnd[0], armEnd[1], { cap1: "serif" }),
      L(legStart[0], legStart[1], w - m * 0.7, 0, { cap1: "serif" }),
    ],
  };
});

def("l", (P, m) => ({
  w: 2 * m,
  strokes: [L(m, P.A, m, 0, { cap0: "serif", cap1: "serif" })],
  sb0: 1.2,
  sb1: 1.2,
}));

def("p", (P, m, wf) => {
  const w = ow(P, wf);
  const { cy, ry } = vspan(P, P.X + P.o, -P.o);
  return {
    w,
    strokes: [
      L(m, P.X, m, P.D, { cap0: "serif", cap1: "serif" }),
      ring(P, w / 2, cy, (w - 2 * m) / 2, ry),
    ],
    sb1: 0.6,
  };
});

def("q", (P, m, wf) => {
  const w = ow(P, wf);
  const { cy, ry } = vspan(P, P.X + P.o, -P.o);
  return {
    w,
    strokes: [
      L(w - m, P.X, w - m, P.D, { cap0: "serif", cap1: "serif" }),
      ring(P, w / 2, cy, (w - 2 * m) / 2, ry),
    ],
    sb0: 0.6,
  };
});

def("r", (P, m, wf) => {
  const w = 0.52 * P.X * wf + 2 * m;
  const cya = P.X * 0.58;
  const ry = P.X - P.T / 2 - cya;
  const aEnd = lerp(55, 15, P.aperture);
  return {
    w,
    strokes: [
      L(m, P.X, m, 0, { cap0: "serif", cap1: "serif" }),
      arc(P, m + (w - 2 * m) * 0.5, cya, (w - 2 * m) * 0.5, ry, 180, aEnd, {
        cap0: "flat",
        cap1: "round",
        taper1: true,
      }),
    ],
    sb1: 0.5,
  };
});

def("s", (P, m, wf) => {
  const w = ow(P, wf) * 0.84;
  const cx = w / 2;
  const cyG = P.X / 2;
  const top = P.X + P.o - P.T / 2;
  const cyT = (top + cyG) / 2;
  const ryT = cyT - cyG;
  const a0 = lerp(30, 58, P.aperture);
  const topHalf = sampleSuperArc(cx, cyT, w / 2 - m, ryT, P.k, a0 * D2R, 270 * D2R, 26);
  const botHalf = topHalf
    .map((p) => ({ x: 2 * cx - p.x, y: 2 * cyG - p.y }))
    .reverse();
  return {
    w,
    strokes: [
      {
        pts: joinPts(topHalf, botHalf),
        cap0: "round",
        cap1: "round",
        taper0: true,
        taper1: true,
      },
    ],
    sb0: 0.7,
    sb1: 0.7,
  };
});

def("t", (P, m, wf) => {
  const w = 0.56 * P.X + 2 * m;
  const tx = m + 0.14 * P.X;
  const tTop = lerp(P.X, P.A, 0.42);
  const rh = 0.26 * P.X;
  const phi = lerp(200, 240, P.aperture);
  const hookRy = rh - P.T / 2 + P.o;
  return {
    w,
    strokes: [
      {
        pts: joinPts(
          [
            { x: tx, y: tTop },
            { x: tx, y: rh },
          ],
          sampleSuperArc(tx + rh, rh, rh, hookRy, P.k, Math.PI, (360 - phi + 180) * D2R, 16)
        ),
        cap0: "flat",
        cap1: "round",
        taper1: true,
      },
      L(tx - 0.2 * P.X, P.X - P.T / 2, tx + 0.32 * P.X, P.X - P.T / 2, {
        fixed: P.T,
      }),
    ],
    sb0: 0.6,
    sb1: 0.5,
  };
});

def("u", (P, m, wf) => {
  const w = ow(P, wf) * 0.98;
  const yu = 0.3 * P.X;
  const ry = yu + P.o - P.T / 2;
  return {
    w,
    strokes: [
      {
        pts: joinPts(
          [
            { x: m, y: P.X },
            { x: m, y: yu },
          ],
          sampleSuperArc(w / 2, yu, w / 2 - m, ry, P.k, Math.PI, 2 * Math.PI, 24),
          [
            { x: w - m, y: yu },
            { x: w - m, y: P.X },
          ]
        ),
        cap0: "serif",
        cap1: "flat",
      },
      L(w - m, P.X, w - m, 0, { cap0: "serif" }),
    ],
  };
});

def("v", (P, m, wf) => {
  const w = 0.72 * P.X * wf + 2 * m;
  return {
    w,
    strokes: [
      P_(
        [
          [m, P.X],
          [w / 2, P.W * 0.5],
          [w - m, P.X],
        ],
        { cap0: "serif", cap1: "serif" }
      ),
    ],
    sb0: 0.5,
    sb1: 0.5,
  };
});

def("w", (P, m, wf) => {
  const w = 1.1 * P.X * wf + 2 * m;
  const vy = P.W * 0.5;
  return {
    w,
    strokes: [
      P_(
        [
          [m, P.X],
          [0.28 * w, vy],
          [w / 2, 0.62 * P.X],
          [0.72 * w, vy],
          [w - m, P.X],
        ],
        { cap0: "serif", cap1: "serif", mult: 0.88 }
      ),
    ],
    sb0: 0.5,
    sb1: 0.5,
  };
});

def("x", (P, m, wf) => {
  const w = 0.72 * P.X * wf + 2 * m;
  return {
    w,
    strokes: [
      L(m, P.X, w - m, 0, { cap0: "serif", cap1: "serif" }),
      L(w - m, P.X, m, 0, { cap0: "serif", cap1: "serif" }),
    ],
    sb0: 0.6,
    sb1: 0.6,
  };
});

def("y", (P, m, wf) => {
  const w = 0.74 * P.X * wf + 2 * m;
  const jx = w / 2;
  // Right arm continues straight through the junction into the tail.
  const dirX = jx - (w - m);
  const dirY = -P.X;
  const tYEnd = P.D + P.T / 2 - P.o;
  const tScale = (tYEnd - P.X) / dirY;
  return {
    w,
    strokes: [
      L(m, P.X, jx, 0, { cap0: "serif" }),
      L(w - m, P.X, w - m + dirX * tScale, P.X + dirY * tScale, {
        cap0: "serif",
        cap1: "round",
        taper1: true,
      }),
    ],
    sb0: 0.5,
    sb1: 0.5,
  };
});

def("z", (P, m, wf) => {
  const w = 0.66 * P.X * wf + 2 * m;
  return {
    w,
    strokes: [
      L(m * 0.5, P.X - P.T / 2, w - m * 0.6, P.X - P.T / 2),
      L(w - m, P.X - P.T * 0.75, m, P.T * 0.75, { mult: 1.05 }),
      L(m * 0.5, P.T / 2, w - m * 0.5, P.T / 2),
    ],
  };
});

// ===== Digits (uniform body width) =========================================

const dw = (P, wf) => 0.58 * P.C * wf + 2 * (P.W / 2);

def("0", (P, m, wf) => {
  const w = dw(P, wf);
  const { cy, ry } = vspan(P, P.C + P.o, -P.o);
  return { w, strokes: [ring(P, w / 2, cy, w / 2 - m, ry)], sb0: 0.7, sb1: 0.7 };
});

def("1", (P, m, wf) => {
  const w = dw(P, wf);
  const cx = w * 0.56;
  return {
    w,
    strokes: [
      L(cx, P.C, cx, 0, { cap1: "serif" }),
      L(cx, P.C, cx - 0.3 * w, P.C - 0.24 * P.C, { mult: 0.9 }),
    ],
  };
});

def("2", (P, m, wf) => {
  const w = dw(P, wf);
  const ryT = 0.27 * P.C;
  const cyT = P.C + P.o - P.T / 2 - ryT;
  const arcPts = sampleSuperArc(w / 2, cyT, w / 2 - m, ryT, P.k, 160 * D2R, -28 * D2R, 26);
  return {
    w,
    strokes: [
      {
        pts: joinPts(arcPts, [{ x: m * 1.2, y: P.T * 0.7 }]),
        cap0: "round",
        cap1: "flat",
        taper0: true,
      },
      L(m * 0.5, P.T / 2, w - m * 0.5, P.T / 2),
    ],
  };
});

def("3", (P, m, wf) => {
  const w = dw(P, wf);
  const ym = 0.53 * P.C;
  const topT = P.C + P.o - P.T / 2;
  const cyT = (topT + ym) / 2;
  const ryT = cyT - ym;
  const botB = -P.o + P.T / 2;
  const cyB = (ym + botB) / 2;
  const ryB = ym - cyB;
  return {
    w,
    strokes: [
      arc(P, w / 2, cyT, (w / 2 - m) * 0.92, ryT, 150, -90, {
        cap0: "round",
        cap1: "flat",
        taper0: true,
      }),
      arc(P, w / 2, cyB, w / 2 - m, ryB, 90, -150, {
        cap0: "flat",
        cap1: "round",
        taper1: true,
      }),
    ],
    sb0: 0.7,
  };
});

def("4", (P, m, wf) => {
  const w = dw(P, wf);
  const vx = w * 0.66;
  const ybar = 0.3 * P.C;
  return {
    w,
    strokes: [
      L(vx, P.C, vx, 0, { cap1: "serif" }),
      L(vx, P.C, m * 0.8, ybar + P.T * 0.4, { mult: 0.9 }),
      L(m * 0.4, ybar, w - m * 0.4, ybar, { fixed: P.T }),
    ],
  };
});

def("5", (P, m, wf) => {
  const w = dw(P, wf);
  const yb = 0.58 * P.C;
  const cy5 = (yb - P.o + P.T / 2) / 2;
  const ry5 = yb - cy5;
  return {
    w,
    strokes: [
      L(m * 1.1, P.C - P.T / 2, w - m * 0.7, P.C - P.T / 2, { fixed: P.T }),
      L(m * 1.1, P.C - P.T * 0.6, m * 1.1, yb - P.T * 0.2, { mult: 0.94 }),
      arc(P, w / 2, cy5, w / 2 - m, ry5, 142, -150, {
        cap0: "flat",
        cap1: "round",
        taper1: true,
      }),
    ],
  };
});

function sixStrokes(P, m, w) {
  const ym = 0.62 * P.C;
  const cyR = (ym - P.o + P.T / 2) / 2;
  const ryR = ym - cyR;
  const cx6 = w / 2 + 0.1 * (w / 2);
  const rx6 = w / 2 - m + 0.1 * (w / 2);
  const cy6 = 0.55 * P.C;
  const ry6 = P.C + P.o - P.T / 2 - cy6;
  return [
    ring(P, w / 2, cyR, w / 2 - m, ryR),
    arc(P, cx6, cy6, rx6, ry6, 62, 196, {
      cap0: "round",
      cap1: "flat",
      taper0: true,
    }),
  ];
}

def("6", (P, m, wf) => {
  const w = dw(P, wf);
  return { w, strokes: sixStrokes(P, m, w), sb0: 0.7, sb1: 0.7 };
});

def("9", (P, m, wf) => {
  const w = dw(P, wf);
  return {
    w,
    strokes: rot180(sixStrokes(P, m, w), w / 2, P.C / 2),
    sb0: 0.7,
    sb1: 0.7,
  };
});

def("7", (P, m, wf) => {
  const w = dw(P, wf);
  return {
    w,
    strokes: [
      L(m * 0.5, P.C - P.T / 2, w - m, P.C - P.T / 2, { fixed: P.T }),
      L(w - m, P.C - P.T, w * 0.3, 0, { mult: 0.95 }),
    ],
  };
});

def("8", (P, m, wf) => {
  const w = dw(P, wf);
  const ymTop = 0.46 * P.C;
  const cyT = (P.C + P.o - P.T / 2 + ymTop) / 2;
  const ryT = cyT - ymTop;
  const ymBot = 0.5 * P.C;
  const cyB = (ymBot - P.o + P.T / 2) / 2;
  const ryB = ymBot - cyB;
  return {
    w,
    strokes: [
      ring(P, w / 2, cyT, (w / 2 - m) * 0.82, ryT),
      ring(P, w / 2, cyB, w / 2 - m, ryB),
    ],
    sb0: 0.7,
    sb1: 0.7,
  };
});

// ===== Punctuation ==========================================================

def(".", (P) => {
  const r = P.dotR;
  return { w: 2 * r, strokes: [dot(P, r, r - P.o * 0.5, r)], sb0: 0.8, sb1: 0.8 };
});

def(",", (P) => {
  const r = P.dotR;
  return {
    w: 2 * r,
    strokes: [
      dot(P, r, r - P.o * 0.5, r),
      {
        pts: sampleQuad(
          { x: r + r * 0.3, y: 0 },
          { x: r - r * 0.2, y: -r * 1.2 },
          { x: r - r * 0.9, y: -r * 2.1 },
          10
        ),
        cap0: "flat",
        cap1: "round",
        taper1: true,
        mult: 0.7,
      },
    ],
    sb0: 0.8,
    sb1: 0.8,
  };
});

def(":", (P) => {
  const r = P.dotR;
  return {
    w: 2 * r,
    strokes: [dot(P, r, r - P.o * 0.5, r), dot(P, r, P.X - r + P.o * 0.5, r)],
    sb0: 0.8,
    sb1: 0.8,
  };
});

def(";", (P) => {
  const r = P.dotR;
  return {
    w: 2 * r,
    strokes: [
      dot(P, r, r - P.o * 0.5, r),
      dot(P, r, P.X - r + P.o * 0.5, r),
      {
        pts: sampleQuad(
          { x: r + r * 0.3, y: 0 },
          { x: r - r * 0.2, y: -r * 1.2 },
          { x: r - r * 0.9, y: -r * 2.1 },
          10
        ),
        cap0: "flat",
        cap1: "round",
        taper1: true,
        mult: 0.7,
      },
    ],
    sb0: 0.8,
    sb1: 0.8,
  };
});

def("!", (P, m) => {
  const w = Math.max(2 * m, 2 * P.dotR);
  const cx = w / 2;
  return {
    w,
    strokes: [
      L(cx, P.C, cx, 2.6 * P.dotR, { taper1: true, mult: 1.05 }),
      dot(P, cx, P.dotR - P.o * 0.5, P.dotR),
    ],
    sb0: 0.8,
    sb1: 0.8,
  };
});

def("?", (P, m, wf) => {
  const w = 0.5 * P.C * wf + 2 * m;
  const ryQ = 0.26 * P.C;
  const cyQ = P.C + P.o - P.T / 2 - ryQ;
  const endX = w * 0.54;
  return {
    w,
    strokes: [
      {
        pts: joinPts(
          sampleSuperArc(w / 2, cyQ, w / 2 - m, ryQ, P.k, 168 * D2R, -62 * D2R, 22),
          [
            { x: endX, y: cyQ - ryQ * 0.9 },
            { x: endX, y: 2.6 * P.dotR },
          ]
        ),
        cap0: "round",
        cap1: "flat",
        taper0: true,
      },
      dot(P, endX, P.dotR - P.o * 0.5, P.dotR),
    ],
  };
});

def("-", (P, m, wf) => {
  const w = 0.34 * P.X * wf + 2 * m;
  const th = Math.max(P.T, P.W * 0.6);
  return {
    w,
    strokes: [L(m * 0.3, 0.52 * P.X, w - m * 0.3, 0.52 * P.X, { fixed: th })],
    sb0: 0.7,
    sb1: 0.7,
  };
});

def("–", (P, m, wf) => {
  const w = 0.7 * P.X * wf + 2 * m;
  const th = Math.max(P.T * 0.9, P.W * 0.5);
  return {
    w,
    strokes: [L(m * 0.3, 0.52 * P.X, w - m * 0.3, 0.52 * P.X, { fixed: th })],
    sb0: 0.7,
    sb1: 0.7,
  };
});

function tick(P, x) {
  return {
    pts: [
      { x, y: P.C + 0.04 * P.C },
      { x: x - 0.03 * P.C, y: P.C - 0.18 * P.C },
    ],
    cap0: "flat",
    cap1: "round",
    taper1: true,
    mult: 0.85,
  };
}

def("'", (P, m) => ({ w: 2 * m, strokes: [tick(P, m)], sb0: 0.8, sb1: 0.8 }));
def("’", (P, m) => ({ w: 2 * m, strokes: [tick(P, m)], sb0: 0.8, sb1: 0.8 }));

def('"', (P, m) => {
  const gap = 0.13 * P.C;
  return {
    w: 2 * m + gap,
    strokes: [tick(P, m), tick(P, m + gap)],
    sb0: 0.8,
    sb1: 0.8,
  };
});

def("(", (P, m, wf) => {
  const w = 0.3 * P.C * wf + 2 * m;
  const cy = (P.A + P.D) / 2;
  const ry = (P.A - P.D) / 2 + 0.04 * P.C;
  return {
    w,
    strokes: [
      arc(P, w + m, cy, w - m * 1.6, ry, 108, 252, {
        cap0: "round",
        cap1: "round",
        mult: 0.85,
        k: 2.1,
      }),
    ],
  };
});

def(")", (P, m, wf) => {
  const w = 0.3 * P.C * wf + 2 * m;
  const cy = (P.A + P.D) / 2;
  const ry = (P.A - P.D) / 2 + 0.04 * P.C;
  return {
    w,
    strokes: [
      arc(P, -m, cy, w - m * 1.6, ry, 72, -72, {
        cap0: "round",
        cap1: "round",
        mult: 0.85,
        k: 2.1,
      }),
    ],
  };
});

def("/", (P, m, wf) => {
  const w = 0.44 * P.C * wf + 2 * m;
  return {
    w,
    strokes: [L(w - m, P.C, m, 0, { mult: 0.9 })],
    sb0: 0.6,
    sb1: 0.6,
  };
});

// The characters the foundry produces.
export const CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" +
  ".,:;!?-–'’\"()/";
