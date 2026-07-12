// pen.js — expand glyph skeletons into filled outlines.
//
// A skeleton stroke is a dense polyline (or closed ring). The pen walks it,
// computing a thickness at every point from the tangent direction (this is
// what gives the type its contrast/stress, like a broad nib), and offsets
// both sides to produce closed contours. Overlapping strokes rely on
// nonzero winding — no boolean operations needed anywhere.
//
// Stroke options:
//   closed:  true → ring (produces outer + inner contour)
//   cap0/cap1: 'flat' | 'round' | 'serif'   (open strokes)
//   mult:    thickness multiplier
//   fixed:   fixed thickness (units), bypasses the contrast model
//   taper0/taper1: taper this end (uses P.taper)
//   blob:    contour is used as-is (already an outline, e.g. the dot on i)

import { TAU, lerp, clamp, simplify, signedArea } from "./util.js";

function thicknessAt(dx, dy, P, stroke) {
  if (stroke.fixed) return stroke.fixed;
  const theta = Math.atan2(dy, dx);
  // Vertical stroke (theta = ±90°) → full weight; horizontal → thin.
  const s = Math.abs(Math.sin(theta - P.penAngle));
  let w = P.W * lerp(P.contrast, 1, s);
  if (stroke.mult) w *= stroke.mult;
  return Math.max(w, P.W * 0.14, 8);
}

// Per-point normals with miter joints (clamped).
function computeOffsets(pts, closed) {
  const n = pts.length;
  const normals = new Array(n);
  const seg = (i, j) => {
    const dx = pts[j].x - pts[i].x;
    const dy = pts[j].y - pts[i].y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  };
  for (let i = 0; i < n; i++) {
    let d0, d1;
    if (closed) {
      d0 = seg((i - 1 + n) % n, i);
      d1 = seg(i, (i + 1) % n);
    } else {
      d0 = i > 0 ? seg(i - 1, i) : seg(0, 1);
      d1 = i < n - 1 ? seg(i, i + 1) : seg(n - 2, n - 1);
    }
    // Average tangent, then rotate 90° for the normal; miter-scale.
    let tx = d0.x + d1.x;
    let ty = d0.y + d1.y;
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-6) {
      // 180° reversal; fall back to first segment normal.
      tx = d0.x;
      ty = d0.y;
    } else {
      tx /= tl;
      ty /= tl;
    }
    const cosHalf = clamp(tx * d0.x + ty * d0.y, 0.33, 1); // miter clamp 3x
    normals[i] = {
      nx: -ty / cosHalf,
      ny: tx / cosHalf,
      tx,
      ty,
    };
  }
  return normals;
}

function taperFactor(i, n, stroke, P) {
  if (!P.taper || (!stroke.taper0 && !stroke.taper1)) return 1;
  const span = Math.max(4, n * 0.35);
  let f = 1;
  if (stroke.taper0) {
    const t = clamp(i / span, 0, 1);
    f = Math.min(f, lerp(1 - P.taper * 0.72, 1, t * t * (3 - 2 * t)));
  }
  if (stroke.taper1) {
    const t = clamp((n - 1 - i) / span, 0, 1);
    f = Math.min(f, lerp(1 - P.taper * 0.72, 1, t * t * (3 - 2 * t)));
  }
  return f;
}

function roundCap(p, dirx, diry, halfw, into) {
  // Semicircle from +normal side around the tip to -normal side.
  const a0 = Math.atan2(dirx, -diry); // angle of +normal
  const STEPS = 7;
  for (let s = 1; s < STEPS; s++) {
    const a = a0 - (Math.PI * s) / STEPS; // sweep towards -normal via tip
    into.push({ x: p.x + Math.cos(a) * halfw, y: p.y + Math.sin(a) * halfw });
  }
}

// Expand one stroke → { contours: [...], serifEnds: [...] }
function expandStroke(stroke, P) {
  const pts = stroke.pts;
  if (stroke.blob) {
    const c = pts.slice();
    if (signedArea(c) < 0) c.reverse();
    return { contours: [c], serifEnds: [] };
  }
  const n = pts.length;
  if (n < 2) return { contours: [], serifEnds: [] };
  const normals = computeOffsets(pts, stroke.closed);

  const halfs = new Array(n);
  for (let i = 0; i < n; i++) {
    const nm = normals[i];
    halfs[i] =
      (thicknessAt(nm.tx, nm.ty, P, stroke) / 2) * taperFactor(i, n, stroke, P);
  }

  if (stroke.closed) {
    const outer = [];
    const inner = [];
    for (let i = 0; i < n; i++) {
      const nm = normals[i];
      const h = halfs[i];
      outer.push({ x: pts[i].x + nm.nx * h, y: pts[i].y + nm.ny * h });
      inner.push({ x: pts[i].x - nm.nx * h, y: pts[i].y - nm.ny * h });
    }
    // Ring orientation: outer must wind opposite to inner for nonzero fill.
    if (signedArea(outer) < signedArea(inner)) {
      // outer offset went inward — swap
      return finalizeClosed(inner, outer);
    }
    return finalizeClosed(outer, inner);
  }

  // Open stroke: left side, end cap, right side reversed, start cap.
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const nm = normals[i];
    const h = halfs[i];
    left.push({ x: pts[i].x + nm.nx * h, y: pts[i].y + nm.ny * h });
    right.push({ x: pts[i].x - nm.nx * h, y: pts[i].y - nm.ny * h });
  }
  const contour = left.slice();
  const serifEnds = [];

  const endCap = resolveCap(stroke.cap1, P);
  if (endCap === "round") {
    const nmE = normals[n - 1];
    roundCap(pts[n - 1], nmE.tx, nmE.ty, halfs[n - 1], contour);
  } else if (endCap === "serif") {
    serifEnds.push({ p: pts[n - 1], tx: normals[n - 1].tx, ty: normals[n - 1].ty });
  }
  for (let i = n - 1; i >= 0; i--) contour.push(right[i]);
  const startCap = resolveCap(stroke.cap0, P);
  if (startCap === "round") {
    const nm0 = normals[0];
    roundCap(pts[0], -nm0.tx, -nm0.ty, halfs[0], contour);
  } else if (startCap === "serif") {
    serifEnds.push({ p: pts[0], tx: -normals[0].tx, ty: -normals[0].ty });
  }
  const c = simplify(contour, 0.9);
  if (signedArea(c) < 0) c.reverse();
  return { contours: [c], serifEnds };
}

function resolveCap(cap, P) {
  if (cap === "serif" && P.serifLen <= 0) return "flat";
  return cap || "flat";
}

function finalizeClosed(outer, inner) {
  let o = simplify(outer, 0.9);
  let i = simplify(inner, 0.9);
  if (signedArea(o) < 0) o.reverse();
  if (signedArea(i) > 0) i.reverse();
  return { contours: [o, i], serifEnds: [] };
}

// Build a horizontal serif slab at a stem end. `dir` = outgoing direction
// of the stroke at that end (pointing away from the glyph body).
function serifSlab(end, P) {
  const { p, tx, ty } = end;
  if (Math.abs(ty) < 0.4) return null; // only for (near-)vertical stem ends
  const half = P.W / 2 + P.serifLen;
  // Slab sits inside the glyph: below a top end, above a bottom end.
  const yOff = ty < 0 ? P.serifTh / 2 : -P.serifTh / 2;
  return {
    pts: [
      { x: p.x - half, y: p.y + yOff },
      { x: p.x + half, y: p.y + yOff },
    ],
    fixed: P.serifTh,
    cap0: "flat",
    cap1: "flat",
  };
}

// Public: expand all strokes of a glyph into contours.
export function expandGlyph(strokes, P) {
  const contours = [];
  const extra = [];
  for (const s of strokes) {
    const { contours: cs, serifEnds } = expandStroke(s, P);
    contours.push(...cs);
    for (const end of serifEnds) {
      const slab = serifSlab(end, P);
      if (slab) extra.push(slab);
      else {
        // Not slab-able (diagonal end) → re-expand this end as flat.
        // Cheap: add a tiny flat patch — nothing needed, flat is default
        // because the serif cap emitted no cap geometry.
      }
    }
  }
  for (const s of extra) {
    const { contours: cs } = expandStroke(s, P);
    contours.push(...cs);
  }
  return contours;
}
