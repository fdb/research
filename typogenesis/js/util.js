// util.js — geometry + misc helpers. No dependencies.

export const TAU = Math.PI * 2;

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Deterministic RNG (mulberry32). Returns a function () => [0,1).
export function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

// --- Point sampling -------------------------------------------------------

// Sample a quadratic bézier a→b with control c into n points (incl. ends).
export function sampleQuad(a, c, b, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    });
  }
  return pts;
}

// Sample a cubic bézier into n points (incl. ends).
export function sampleCubic(a, c1, c2, b, n = 28) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({
      x:
        u * u * u * a.x +
        3 * u * u * t * c1.x +
        3 * u * t * t * c2.x +
        t * t * t * b.x,
      y:
        u * u * u * a.y +
        3 * u * u * t * c1.y +
        3 * u * t * t * c2.y +
        t * t * t * b.y,
    });
  }
  return pts;
}

// Superellipse arc: |x/rx|^k + |y/ry|^k = 1, sampled from angle t0 to t1
// (radians, parametric angle). k=2 → ellipse; higher k → squarer.
// cx,cy center. Returns points incl. both ends.
export function sampleSuperArc(cx, cy, rx, ry, k, t0, t1, n = 24) {
  const pts = [];
  const e = 2 / k;
  for (let i = 0; i <= n; i++) {
    const t = lerp(t0, t1, i / n);
    const ct = Math.cos(t);
    const st = Math.sin(t);
    pts.push({
      x: cx + rx * Math.sign(ct) * Math.pow(Math.abs(ct), e),
      y: cy + ry * Math.sign(st) * Math.pow(Math.abs(st), e),
    });
  }
  return pts;
}

// Join several point arrays into one polyline, dropping duplicated joints.
export function joinPts(...segs) {
  const out = [];
  for (const seg of segs) {
    for (const p of seg) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6)
        continue;
      out.push(p);
    }
  }
  return out;
}

// Ramer–Douglas–Peucker polyline simplification.
export function simplify(pts, tol = 1.2) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = pts[i0];
    const b = pts[i1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let dmax = -1;
    let imax = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i];
      // Perpendicular distance to segment a-b.
      const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (d > dmax) {
        dmax = d;
        imax = i;
      }
    }
    if (dmax > tol * tol) {
      keep[imax] = 1;
      stack.push([i0, imax], [imax, i1]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

// Signed area of a closed polygon (positive = counter-clockwise in y-up).
export function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}
