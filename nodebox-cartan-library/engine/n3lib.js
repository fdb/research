// nodebox-cartan-library/engine/n3lib.js
// JavaScript implementations of the NodeBox 3 standard libraries (math,
// list, string, color, data, corevector) — ported 1:1 from the official
// Java (MathFunctions.java, ListFunctions.java, …) and Jython
// (pyvector.py) sources — plus JS ports of the Python/Clojure helper
// functions John Cartan's Node Library ships (poisson.py, noise.clj,
// treemap.py, …).
//
// Port metadata comes from n3-types.js (generated from the official
// .ndbx library files); this module supplies the function bodies, matched
// by NodeBox function identifier ("math/add", "pyvector/compound", …).

import * as g from "./graphics.js";
import PolyBool from "./polybool.js";
import { N3_TYPE_DEFS } from "./n3-types.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const rad = (deg) => (deg * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
// nodebox.util.Geometry.angle / distance / coordinates (degrees).
const angleTo = (x0, y0, x1, y1) => deg(Math.atan2(y1 - y0, x1 - x0));
const distanceTo = (x0, y0, x1, y1) => Math.hypot(x1 - x0, y1 - y0);
const coords = (x, y, distance, a) => ({
  x: x + Math.cos(rad(a)) * distance,
  y: y + Math.sin(rad(a)) * distance,
});
const notNull = (list) => (list == null ? [] : list.filter((v) => v != null));

/** Every Path inside a shape tree, flattened (groups recursed). */
function allPaths(shape) {
  if (shape == null) return [];
  if (Array.isArray(shape)) return shape.flatMap(allPaths);
  if (g.isPoint(shape)) return [];
  if (shape.type === "group") return shape.shapes.flatMap(allPaths);
  if (shape.type === "path") return [shape];
  return []; // text shapes carry no path data
}

/** Apply fn to every Path in a shape tree, keeping the tree shape. */
function mapPaths(shape, fn) {
  if (shape == null) return null;
  if (Array.isArray(shape)) return shape.map((s) => mapPaths(s, fn));
  if (g.isPoint(shape)) return shape;
  if (shape.type === "group") return g.makeGroup(shape.shapes.map((s) => mapPaths(s, fn)));
  if (shape.type === "text") return shape;
  return fn(shape);
}

/** Like mapPaths but fn may return null (drop) or a group (splice). */
function mapPathsFilter(shape, fn) {
  if (shape == null) return null;
  if (g.isPoint(shape)) return shape;
  if (shape.type === "group") {
    return g.makeGroup(shape.shapes.map((s) => mapPathsFilter(s, fn)).filter((s) => s != null));
  }
  if (shape.type === "text") return shape;
  return fn(shape);
}

/**
 * Split a path's commands into contours: {commands, closed}. Curves are
 * kept as commands (not flattened).
 */
export function pathContours(path) {
  const contours = [];
  let current = null;
  for (const cmd of path.commands) {
    if (cmd.type === "M") {
      if (current && current.commands.length > 1) contours.push(current);
      current = { commands: [cmd], closed: false };
    } else if (cmd.type === "Z") {
      if (current) {
        current.closed = true;
        contours.push(current);
        current = null;
      }
    } else if (current) {
      current.commands.push(cmd);
    }
  }
  if (current && current.commands.length > 1) contours.push(current);
  return contours;
}

function contoursToPath(contours, style) {
  const commands = [];
  for (const c of contours) {
    commands.push(...c.commands);
    if (c.closed) commands.push({ type: "Z" });
  }
  return g.makePath(commands, style);
}

const styleOf = (path) => ({ fill: path.fill, stroke: path.stroke, strokeWidth: path.strokeWidth });

/** Anchor points of a contour (command end points). */
const contourPoints = (c) => c.commands.map((cmd) => ({ x: cmd.x, y: cmd.y }));

/** Polyline points of one contour, curves subdivided. */
function flattenContour(contour, steps = 16) {
  const pts = [];
  let prev = null;
  for (const cmd of contour.commands) {
    if (cmd.type === "M" || cmd.type === "L") {
      pts.push({ x: cmd.x, y: cmd.y });
      prev = cmd;
    } else if (cmd.type === "C") {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        pts.push({
          x:
            mt * mt * mt * prev.x + 3 * mt * mt * t * cmd.x1 + 3 * mt * t * t * cmd.x2 + t * t * t * cmd.x,
          y:
            mt * mt * mt * prev.y + 3 * mt * mt * t * cmd.y1 + 3 * mt * t * t * cmd.y2 + t * t * t * cmd.y,
        });
      }
      prev = cmd;
    }
  }
  return pts;
}

/** Rebuild a path from per-contour point arrays (straight segments). */
function pointsToContour(points, closed) {
  return {
    commands: points.map((p, i) => ({ type: i === 0 ? "M" : "L", x: p.x, y: p.y })),
    closed,
  };
}

// ---------------------------------------------------------------------------
// File access (import_svg, import_csv, import_text). The evaluator is
// synchronous, so files must be provided up-front: Node reads them from
// disk, the browser prefetches the experiment's assets before rendering.
// ---------------------------------------------------------------------------

let fileLoader = null;
/** @param {(name: string) => string} fn Returns file contents as text. */
export function setFileLoader(fn) {
  fileLoader = fn;
}
function loadFile(name) {
  if (!fileLoader) throw new Error("no file loader installed");
  const text = fileLoader(name);
  if (text == null) throw new Error(`file not found: ${name}`);
  return text;
}

// ---------------------------------------------------------------------------
// SVG path import (hersheyFont.svg, relief_font.svg, sole.svg, cannon.svg)
// ---------------------------------------------------------------------------

/** Parse the `d` attributes of all <path> elements in an SVG string. */
export function svgToShape(svgText) {
  const paths = [];
  const re = /<path\b[^>]*?\bd="([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(svgText))) {
    const commands = parseSVGPathData(m[1]);
    if (commands.length) {
      paths.push(
        g.makePath(commands, { fill: null, stroke: g.BLACK, strokeWidth: 1 }),
      );
    }
  }
  if (paths.length === 0) return null;
  if (paths.length === 1) return paths[0];
  return g.makeGroup(paths);
}

/** Minimal SVG path-data parser: M/L/H/V/C/S/Q/T/A/Z, absolute+relative. */
export function parseSVGPathData(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const commands = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCmd = "";
  let lastCtrl = null;
  const num = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    let cmd = tokens[i];
    if (/[a-zA-Z]/.test(cmd)) i++;
    else cmd = lastCmd === "M" ? "L" : lastCmd === "m" ? "l" : lastCmd;
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case "M": {
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        commands.push({ type: "M", x, y });
        cx = sx = x;
        cy = sy = y;
        break;
      }
      case "L": {
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        commands.push({ type: "L", x, y });
        cx = x;
        cy = y;
        break;
      }
      case "H": {
        const x = num() + (rel ? cx : 0);
        commands.push({ type: "L", x, y: cy });
        cx = x;
        break;
      }
      case "V": {
        const y = num() + (rel ? cy : 0);
        commands.push({ type: "L", x: cx, y });
        cy = y;
        break;
      }
      case "C": {
        const x1 = num() + (rel ? cx : 0);
        const y1 = num() + (rel ? cy : 0);
        const x2 = num() + (rel ? cx : 0);
        const y2 = num() + (rel ? cy : 0);
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        commands.push({ type: "C", x1, y1, x2, y2, x, y });
        lastCtrl = { x: x2, y: y2 };
        cx = x;
        cy = y;
        break;
      }
      case "S": {
        const x1 = lastCmd.toUpperCase() === "C" || lastCmd.toUpperCase() === "S" ? 2 * cx - lastCtrl.x : cx;
        const y1 = lastCmd.toUpperCase() === "C" || lastCmd.toUpperCase() === "S" ? 2 * cy - lastCtrl.y : cy;
        const x2 = num() + (rel ? cx : 0);
        const y2 = num() + (rel ? cy : 0);
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        commands.push({ type: "C", x1, y1, x2, y2, x, y });
        lastCtrl = { x: x2, y: y2 };
        cx = x;
        cy = y;
        break;
      }
      case "Q": {
        const qx = num() + (rel ? cx : 0);
        const qy = num() + (rel ? cy : 0);
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        commands.push(quadToCubic(cx, cy, qx, qy, x, y));
        lastCtrl = { x: qx, y: qy };
        cx = x;
        cy = y;
        break;
      }
      case "T": {
        const qx = lastCmd.toUpperCase() === "Q" || lastCmd.toUpperCase() === "T" ? 2 * cx - lastCtrl.x : cx;
        const qy = lastCmd.toUpperCase() === "Q" || lastCmd.toUpperCase() === "T" ? 2 * cy - lastCtrl.y : cy;
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        commands.push(quadToCubic(cx, cy, qx, qy, x, y));
        lastCtrl = { x: qx, y: qy };
        cx = x;
        cy = y;
        break;
      }
      case "A": {
        // Arc → line to end point (rare in the shipped assets).
        num(); num(); num(); num(); num();
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        commands.push({ type: "L", x, y });
        cx = x;
        cy = y;
        break;
      }
      case "Z":
        commands.push({ type: "Z" });
        cx = sx;
        cy = sy;
        break;
      default:
        i = tokens.length; // unknown: stop
    }
    lastCmd = cmd;
  }
  return commands;
}

function quadToCubic(x0, y0, qx, qy, x, y) {
  return {
    type: "C",
    x1: x0 + (2 / 3) * (qx - x0),
    y1: y0 + (2 / 3) * (qy - y0),
    x2: x + (2 / 3) * (qx - x),
    y2: y + (2 / 3) * (qy - y),
    x,
    y,
  };
}

// ---------------------------------------------------------------------------
// Path boolean operations (corevector.compound) via polybooljs.
// Curves are flattened — same approach as Java's Area on a flattened path.
// ---------------------------------------------------------------------------

function shapeToPoly(shape) {
  const regions = [];
  for (const path of allPaths(shape)) {
    for (const contour of pathContours(path)) {
      const pts = flattenContour(contour).map((p) => [p.x, p.y]);
      if (pts.length >= 3) regions.push(pts);
    }
  }
  return { regions, inverted: false };
}

function polyToShape(poly, style) {
  const commands = [];
  for (const region of poly.regions) {
    region.forEach(([x, y], i) => commands.push({ type: i === 0 ? "M" : "L", x, y }));
    commands.push({ type: "Z" });
  }
  return g.makePath(commands, style);
}

export function compoundShapes(shape1, shape2, operation, invertDifference) {
  if (shape1 == null) return null;
  if (shape2 == null) return shape1;
  if (invertDifference) [shape1, shape2] = [shape2, shape1];
  const style = styleOf(allPaths(shape1)[0] || g.makePath([]));
  const p1 = shapeToPoly(shape1);
  const p2 = shapeToPoly(shape2);
  let out;
  if (operation === "subtracted") out = PolyBool.difference(p1, p2);
  else if (operation === "intersected") out = PolyBool.intersect(p1, p2);
  else out = PolyBool.union(p1, p2);
  return polyToShape(out, style);
}

// ---------------------------------------------------------------------------
// Resampling
// ---------------------------------------------------------------------------

function contourLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += distanceTo(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
  return len;
}

function samplePolyline(pts, t) {
  // t in 0..1 along the polyline.
  const total = contourLength(pts);
  let target = t * total;
  for (let i = 1; i < pts.length; i++) {
    const l = distanceTo(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    if (target <= l || i === pts.length - 1) {
      const u = l === 0 ? 0 : Math.min(1, target / l);
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u,
      };
    }
    target -= l;
  }
  return pts[pts.length - 1];
}

/** Java Path.resampleByAmount / resampleByLength, per contour. */
export function resampleShape(shape, method, length, points, perContour) {
  return mapPaths(shape, (path) => {
    const contours = pathContours(path).map((c) => ({
      pts: flattenContour(c),
      closed: c.closed,
    }));
    const newContours = [];
    if (method === "length") {
      for (const c of contours) {
        const total = contourLength(c.pts) || 1;
        const amount = Math.max(2, Math.ceil(total / Math.max(length, 0.001)));
        newContours.push(resampleContour(c, amount));
      }
    } else if (perContour || contours.length <= 1) {
      for (const c of contours) newContours.push(resampleContour(c, points));
    } else {
      // Divide `points` across contours by relative length (Java's rule).
      const lengths = contours.map((c) => contourLength(c.pts));
      const total = lengths.reduce((a, b) => a + b, 0) || 1;
      contours.forEach((c, i) => {
        const amount = Math.max(2, Math.round((lengths[i] / total) * points));
        newContours.push(resampleContour(c, amount));
      });
    }
    return contoursToPath(newContours, styleOf(path));
  });
}

function resampleContour(c, amount) {
  const pts = [];
  const n = Math.max(1, c.closed ? amount : amount - 1);
  for (let i = 0; i < (c.closed ? amount : amount); i++) {
    pts.push(samplePolyline(c.pts, c.closed ? i / amount : i / n));
  }
  return pointsToContour(pts, c.closed);
}

// ---------------------------------------------------------------------------
// The implementations, keyed by NodeBox function id.
// ---------------------------------------------------------------------------

export const IMPLS = {};
const impl = (id, fn) => (IMPLS[id] = fn);

// ---- math (MathFunctions.java) --------------------------------------------

impl("math/number", (v) => v);
impl("math/integer", (v) => Math.round(v));
impl("math/makeBoolean", (v) => v);
impl("math/add", (a, b) => a + b);
impl("math/subtract", (a, b) => a - b);
impl("math/multiply", (a, b) => a * b);
impl("math/divide", (a, b) => {
  if (b === 0) {
    // Deviation from Java (which always throws): 0/0 resolves to 0. The
    // boundary T=100 case of Cartan's even_sample lands on a zero-length
    // segment and computes 0/0 for a point that is exactly the segment
    // start — 0 is the correct parameter there.
    if (a === 0) return 0;
    throw new Error("Divider cannot be zero.");
  }
  return a / b;
});
impl("math/mod", (a, b) => {
  if (b === 0) throw new Error("Divider cannot be zero.");
  return a % b; // Java's % keeps the sign of the dividend
});
impl("math/sqrt", Math.sqrt);
impl("math/pow", Math.pow);
impl("math/log", (n) => {
  if (n === 0) throw new Error("Value cannot be zero.");
  return Math.log(n);
});
impl("math/even", (n) => n % 2 === 0);
impl("math/odd", (n) => n % 2 !== 0);
impl("math/negate", (n) => -n);
impl("math/abs", Math.abs);
impl("math/ceil", Math.ceil);
impl("math/floor", Math.floor);
impl("math/round", Math.round);
impl("math/sin", Math.sin);
impl("math/cos", Math.cos);
impl("math/pi", () => Math.PI);
impl("math/e", () => Math.E);
impl("math/radians", rad);
impl("math/degrees", deg);
impl("math/sum", (numbers) => notNull(numbers).reduce((a, b) => a + b, 0));
impl("math/average", (numbers) => {
  const l = notNull(numbers);
  return l.length === 0 ? 0 : l.reduce((a, b) => a + b, 0) / l.length;
});
impl("math/max", (numbers) => {
  const l = notNull(numbers);
  return l.length === 0 ? 0 : Math.max(...l);
});
impl("math/min", (numbers) => {
  const l = notNull(numbers);
  return l.length === 0 ? 0 : Math.min(...l);
});
impl("math/compare", (v1, v2, comparator) => {
  const c = v1 < v2 ? -1 : v1 > v2 ? 1 : 0;
  switch (comparator) {
    case "<": return c < 0;
    case ">": return c > 0;
    case "<=": return c <= 0;
    case ">=": return c >= 0;
    case "==": return c === 0;
    case "!=": return c !== 0;
    default: throw new Error(`unknown comparison operation ${comparator}`);
  }
});
impl("math/logicOperator", (b1, b2, comparator) => {
  switch (comparator) {
    case "or": return b1 || b2;
    case "and": return b1 && b2;
    case "xor": return Boolean(b1 !== b2);
    default: throw new Error("unknown logical operation");
  }
});
impl("math/makeNumbers", (s, separator) => {
  if (!s || s.length === 0) return [];
  const parts = separator == null || separator === "" ? s.split("") : s.split(separator);
  return parts.map((p) => {
    const v = parseFloat(p);
    if (Number.isNaN(v)) throw new Error(`Could not parse number "${p}"`);
    return v;
  });
});
impl("math/randomNumbers", (amount, start, end, seed) => {
  const rand = g.randomFromSeed(seed);
  return Array.from({ length: Math.max(0, amount) }, () => start + rand() * (end - start));
});
impl("math/sample", (amount, start, end) => {
  if (amount === 0) return [];
  if (amount === 1) return [start + (end - start) / 2];
  const step = (end - start) / (amount - 1);
  return Array.from({ length: amount }, (_, i) => start + step * i);
});
impl("math/range", (start, end, step) => {
  if (step === 0 || start === end || (start < end && step < 0) || (start > end && step > 0)) return [];
  const out = [];
  for (let v = start; step > 0 ? v < end : v > end; v += step) {
    out.push(v);
    if (out.length > 200000) break; // runaway guard
  }
  return out;
});
impl("math/runningTotal", (numbers) => {
  const l = notNull(numbers);
  if (l.length === 0) return [0];
  let total = 0;
  return l.map((d) => {
    const v = total;
    total += d;
    return v;
  });
});
impl("math/angle", (p1, p2) => angleTo(p1.x, p1.y, p2.x, p2.y));
impl("math/distance", (p1, p2) => distanceTo(p1.x, p1.y, p2.x, p2.y));
impl("math/coordinates", (p, a, distance) => coords(p.x, p.y, distance, a));
impl("math/reflect", (p1, p2, a, d) => {
  const dist = d * distanceTo(p1.x, p1.y, p2.x, p2.y);
  const ang = a + angleTo(p1.x, p1.y, p2.x, p2.y);
  return coords(p1.x, p1.y, dist, ang);
});
impl("math/convertRange", (value, srcMin, srcMax, targetMin, targetMax, method) => {
  if (method === "wrap") value = srcMin + (value % (srcMax - srcMin));
  else if (method === "mirror") {
    const rest = value % (srcMax - srcMin);
    value = Math.trunc(value / (srcMax - srcMin)) % 2 === 1 ? srcMax - rest : srcMin + rest;
  } else if (method === "clamp") value = g.clamp(value, srcMin, srcMax);
  const t = srcMax - srcMin === 0 ? srcMin : (value - srcMin) / (srcMax - srcMin);
  return targetMin + t * (targetMax - targetMin);
});
impl("math/wave", (min, max, period, offset, waveType) => {
  const amp = (max - min) / 2;
  const mid = min + amp;
  const t = (((offset / period) % 1) + 1) % 1;
  switch (waveType) {
    case "square": return t < 0.5 ? max : min;
    case "triangle": return min + (t < 0.5 ? 2 * t : 2 - 2 * t) * (max - min);
    case "sawtooth": return min + t * (max - min);
    default: return mid + amp * Math.sin(t * Math.PI * 2);
  }
});

// ---- list (ListFunctions.java) --------------------------------------------

impl("list/count", (l) => notNull(l).length);
impl("list/first", (l) => (l && l.length ? l[0] : null));
impl("list/second", (l) => (l && l.length > 1 ? l[1] : null));
impl("list/rest", (l) => (l == null ? [] : l.slice(1)));
impl("list/last", (l) => (l && l.length ? l[l.length - 1] : null));
impl("list/combine", (...lists) => lists.slice(0, 7).flatMap((l) => (l == null ? [] : l)));
impl("list/slice", (l, startIndex, size, invert) => {
  if (l == null) return [];
  if (!invert) return l.slice(startIndex, startIndex + size);
  return [...l.slice(0, startIndex), ...l.slice(startIndex + size)];
});
impl("list/shift", (l, amount) => {
  if (l == null || l.length === 0) return [];
  let a = amount % l.length;
  if (a < 0) a += l.length;
  return [...l.slice(a), ...l.slice(0, a)];
});
impl("list/doSwitch", (l1, l2, l3, l4, l5, l6, index) => {
  const lists = [l1, l2, l3, l4, l5, l6];
  let i = Math.trunc(index) % 6;
  if (i < 0) i += 6;
  return lists[i] == null ? [] : lists[i];
});
impl("list/repeat", (l, amount, perItem) => {
  if (l == null || amount < 1) return [];
  const out = [];
  if (perItem) for (const v of l) for (let i = 0; i < amount; i++) out.push(v);
  else for (let i = 0; i < amount; i++) out.push(...l);
  return out;
});
impl("list/reverse", (l) => (l == null ? [] : l.slice().reverse()));
impl("list/sort", (l, key) => {
  if (l == null) return [];
  const k = key && key.length ? key : null;
  let effectiveKey = k;
  if (!effectiveKey && l.length && isRow(l[0])) {
    effectiveKey = Object.keys(l[0])[0] || null;
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  if (!effectiveKey) return l.slice().sort(cmp);
  return l.slice().sort((a, b) => cmp(dataLookup(a, effectiveKey), dataLookup(b, effectiveKey)));
});
impl("list/shuffle", (l, seed) => {
  if (l == null) return [];
  const out = l.slice();
  const rand = g.randomFromSeed(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
});
impl("list/pick", (l, amount, seed) => {
  if (l == null || amount <= 0) return [];
  const shuffled = IMPLS["list/shuffle"](l, seed);
  return shuffled.slice(0, Math.min(amount, shuffled.length));
});
impl("list/cull", (l, booleans) => {
  if (l == null) return [];
  const bools = booleans == null ? [] : booleans;
  if (bools.length === 0) return l.slice();
  return l.filter((_, i) => bools[i % bools.length]);
});
impl("list/distinct", (l, key) => {
  if (l == null) return [];
  const k = key && key.trim().length ? key.trim() : null;
  const seen = new Set();
  const out = [];
  for (const v of l) {
    if (v == null) continue;
    const kv = k == null ? v : dataLookup(v, k);
    const hash = kv == null ? null : typeof kv === "object" ? JSON.stringify(kv) : `${typeof kv}:${kv}`;
    if (hash != null && seen.has(hash)) continue;
    seen.add(hash);
    out.push(v);
  }
  return out;
});
impl("list/takeEvery", (l, n) => (l == null ? [] : l.filter((_, i) => i % n === 0)));
impl("list/keys", (l) => {
  if (l == null) return [];
  const keys = [];
  const seen = new Set();
  for (const o of l) {
    if (isRow(o)) {
      for (const k of Object.keys(o)) {
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      }
    }
  }
  return keys;
});
impl("list/zipMap", (keys, values) => {
  if (keys == null || values == null) return {};
  const out = {};
  const n = Math.min(keys.length, values.length);
  for (let i = 0; i < n; i++) out[String(keys[i])] = values[i];
  return out;
});

// ---- string (StringFunctions.java) ----------------------------------------

impl("string/string", (s) => s);
impl("string/makeStrings", (s, separator) => {
  if (s == null) return [];
  if (separator == null || separator === "") return [...String(s)];
  return String(s).split(separator);
});
impl("string/length", (s) => (s == null ? 0 : String(s).length));
impl("string/wordCount", (s) => {
  if (s == null) return 0;
  const m = String(s).match(/\w+/g);
  return m ? m.length : 0;
});
impl("string/concatenate", (...ss) => ss.slice(0, 7).map((s) => (s == null ? "" : s)).join(""));
impl("string/changeCase", (value, caseMethod) => {
  const m = String(caseMethod).toLowerCase();
  const v = String(value);
  if (m === "lowercase") return v.toLowerCase();
  if (m === "uppercase") return v.toUpperCase();
  if (m === "titlecase") return v.replace(/\b\w/g, (c) => c.toUpperCase());
  return v;
});
impl("string/formatNumber", (value, format) => formatJava(format, value));
impl("string/characters", (s) => (s == null ? [] : [...String(s)]));
impl("string/randomCharacter", (characterSet, amount, seed) => {
  const out = [];
  const rand = g.randomFromSeed(seed);
  for (let i = 0; i < amount; i++) {
    out.push(characterSet.charAt(Math.floor(rand() * characterSet.length)));
  }
  return out;
});
impl("string/asBinaryString", (s, digitSep, byteSep) => {
  if (s == null) return s;
  let result = "";
  for (const byte of utf8Bytes(s)) {
    result += byte.toString(2).padStart(8, "0").split("").join(digitSep) + byteSep;
  }
  return result;
});
impl("string/asBinaryList", (s) => {
  if (s == null) return [];
  const out = [];
  for (const byte of utf8Bytes(s)) {
    for (const bit of byte.toString(2).padStart(8, "0")) out.push(bit);
  }
  return out;
});
impl("string/asNumberList", (s, radix, padding) => {
  if (radix < 2 || s == null) return [];
  const out = [];
  for (const byte of utf8Bytes(s)) {
    let v = byte.toString(radix);
    if (padding) {
      const width = radix === 2 ? 8 : radix === 3 ? 6 : radix < 7 ? 4 : radix < 15 ? 3 : 2;
      v = v.padStart(width, "0");
    }
    out.push(v);
  }
  return out;
});
impl("string/characterAt", (s, index) => {
  if (s == null || s === "") return s;
  if (index < 0) index = s.length + index;
  if (index >= s.length || index < 0) return "";
  return s.charAt(index);
});
impl("string/countCharacters", (s) => s);
impl("string/contains", (s, value) => s != null && value != null && s.includes(value));
impl("string/endsWith", (s, value) => s != null && value != null && s.endsWith(value));
impl("string/equal", (s, value, caseSensitive) => {
  if (s == null || value == null) return false;
  return caseSensitive ? s === value : s.toLowerCase() === value.toLowerCase();
});
impl("string/replace", (s, oldVal, newVal) => {
  if (oldVal == null || newVal == null || oldVal === "") return s;
  return String(s).split(oldVal).join(newVal);
});
impl("string/startsWith", (s, value) => s != null && value != null && s.startsWith(value));
impl("string/subString", (s, start, end, endOffset) => {
  if (s == null) return s;
  if (end < start) return "";
  if (start < 0 && end < 0) {
    start = s.length + start;
    end = s.length + end;
  }
  if (endOffset) end++;
  return s.substring(Math.max(0, start), Math.min(s.length, end));
});
impl("string/trim", (s) => (s == null ? s : String(s).trim()));

function utf8Bytes(s) {
  return typeof TextEncoder !== "undefined"
    ? new TextEncoder().encode(String(s))
    : Buffer.from(String(s), "utf8");
}

/** Tiny java.lang.String.format subset: %d %x %o %s %f %e with flags. */
export function formatJava(format, ...args) {
  let i = 0;
  return String(format).replace(
    /%([-+0, #]*)(\d+)?(?:\.(\d+))?([dxXosfeE%])/g,
    (match, flags, width, precision, conv) => {
      if (conv === "%") return "%";
      const arg = args[i++];
      let out;
      switch (conv) {
        case "d": out = String(Math.round(arg)); break;
        case "x": out = (Math.round(arg) >>> 0).toString(16); break;
        case "X": out = (Math.round(arg) >>> 0).toString(16).toUpperCase(); break;
        case "o": out = (Math.round(arg) >>> 0).toString(8); break;
        case "s": out = String(arg); break;
        case "e": case "E": {
          out = Number(arg).toExponential(precision === undefined ? 6 : +precision);
          if (conv === "E") out = out.toUpperCase();
          break;
        }
        default: out = Number(arg).toFixed(precision === undefined ? 6 : +precision);
      }
      let sign = "";
      if (/^-/.test(out)) {
        sign = "-";
        out = out.slice(1);
      } else if (flags.includes("+")) sign = "+";
      if (flags.includes(",")) {
        const [int, frac] = out.split(".");
        out = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? "." + frac : "");
      }
      if (width) {
        const w = +width;
        if (flags.includes("-")) out = (sign + out).padEnd(w, " ");
        else if (flags.includes("0")) out = sign + out.padStart(w - sign.length, "0");
        else out = (sign + out).padStart(w, " ");
        return out;
      }
      return sign + out;
    },
  );
}

// ---- color (ColorFunctions.java / color.ndbx) ------------------------------

impl("color/color", (c) => c);
impl("color/gray", (gray, alpha, range) => {
  const r = range === 0 ? 1 : range;
  return g.grayColor(g.clamp(gray / r, 0, 1), g.clamp(alpha / r, 0, 1));
});
impl("color/rgb", (red, green, blue, alpha, range) => {
  const r = range === 0 ? 1 : range;
  return g.color(
    g.clamp(red / r, 0, 1),
    g.clamp(green / r, 0, 1),
    g.clamp(blue / r, 0, 1),
    g.clamp(alpha / r, 0, 1),
  );
});
impl("color/hsb", (hue, saturation, brightness, alpha, range) => {
  const r = range === 0 ? 1 : range;
  return g.hsbColor(
    g.clamp(hue / r, 0, 1),
    g.clamp(saturation / r, 0, 1),
    g.clamp(brightness / r, 0, 1),
    g.clamp(alpha / r, 0, 1),
  );
});

// ---- data (DataFunctions.java) ---------------------------------------------

const isRow = (o) => o != null && typeof o === "object" && !Array.isArray(o);

/** DataFunctions.lookup with dotted nested keys. */
export function dataLookup(o, key) {
  if (key == null) return null;
  for (const k of String(key).split(".")) {
    o = fastLookup(o, k);
    if (o == null) break;
  }
  return o;
}

function fastLookup(o, key) {
  if (o == null || key == null) return null;
  // Java's o.getClass() — Cartan dispatches on class.simpleName.
  if (key === "class") return { simpleName: javaClassName(o) };
  if (typeof o !== "object") return null;
  if (Array.isArray(o)) return key in o ? o[key] : null;
  if (key in o) return o[key];
  // nodebox.graphics.Point.type: 1 = LINE_TO, 2 = CURVE_TO, 3 = CURVE_DATA.
  if (g.isPoint(o) && key === "type") return o.ptype || 1;
  // Reflection-style lookups Java finds via getters:
  if (g.isColor(o)) {
    // nodebox.graphics.Color: red/green/blue/alpha + hue/saturation/
    // brightness (and their r/g/b/a/h/s/v shorthands).
    switch (key) {
      case "red": return o.r;
      case "green": return o.g;
      case "blue": return o.b;
      case "alpha": return o.a;
      case "hue": case "h": return rgbToHsb(o)[0];
      case "saturation": case "s": return rgbToHsb(o)[1];
      case "brightness": case "v": return rgbToHsb(o)[2];
      default: return null;
    }
  }
  if (g.isShape(o)) {
    // nodebox.graphics.Path/Geometry getters Cartan reaches via lookup.
    if (key === "length") return allPaths(o).reduce((sum, p) => sum + g.pathLength(p), 0);
    if (key === "points") return g.shapePoints(o);
    if (key === "pointCount") return g.shapePoints(o).length;
    if (key === "contours") {
      return allPaths(o).flatMap((p) => pathContours(p).map((c) => contoursToPath([c], styleOf(p))));
    }
    if (key === "closed") {
      const contours = allPaths(o).flatMap(pathContours);
      return contours.length > 0 && contours.every((c) => c.closed);
    }
    if (o.type === "path" || o.type === "text") {
      if (key === "fillColor") return o.fill || null;
      if (key === "strokeColor") return o.stroke || null;
      if (key === "strokeWidth") return o.strokeWidth || 0;
    }
    const b = g.bounds(o);
    if (key === "x") return b.x;
    if (key === "y") return b.y;
    if (key === "width") return b.width;
    if (key === "height") return b.height;
    if (key === "bounds") return b;
  }
  return null;
}

/** Java class names for class.simpleName dispatch. */
function javaClassName(o) {
  if (typeof o === "number") return Number.isInteger(o) ? "Long" : "Double";
  if (typeof o === "string") return "String";
  if (typeof o === "boolean") return "Boolean";
  if (Array.isArray(o)) return "ArrayList";
  if (g.isPoint(o)) return "Point";
  if (g.isColor(o)) return "Color";
  if (g.isShape(o)) {
    if (o.type === "group") return "Geometry";
    if (o.type === "text") return "Text";
    return "Path";
  }
  return "HashMap";
}

/** RGB (0..1) → [h, s, v] all 0..1, like java.awt.Color.RGBtoHSB. */
function rgbToHsb({ r, g: gr, b }) {
  const max = Math.max(r, gr, b);
  const min = Math.min(r, gr, b);
  const v = max;
  const s = max === 0 ? 0 : (max - min) / max;
  let h = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) h = (gr - b) / d + (gr < b ? 6 : 0);
    else if (max === gr) h = (b - r) / d + 2;
    else h = (r - gr) / d + 4;
    h /= 6;
  }
  return [h, s, v];
}

impl("data/lookup", (o, key) => dataLookup(o, key));
impl("data/importText", (fileName) => {
  if (!fileName || !fileName.trim()) return [];
  return loadFile(fileName).split(/\r?\n/);
});
impl("data/importCSV", (fileName, delimiter, quotes, numberSeparator) => {
  if (!fileName || !fileName.trim()) return [];
  const SEP = { period: ".", comma: ",", semicolon: ";", colon: ":", tab: "\t", space: " ", double: '"', single: "'" };
  return parseCSV(loadFile(fileName), SEP[delimiter] || ",", SEP[quotes] || '"', numberSeparator === "comma");
});
impl("data/filterData", (rows, key, op, value) => {
  if (value == null) return rows == null ? [] : rows;
  const src = rows == null ? [] : rows;
  const f = parseFloat(value);
  if (!Number.isNaN(f) && String(value).trim() !== "") {
    return src.filter((o) => {
      let v = fastLookup(o, key);
      if (v == null) return false;
      if (typeof v === "string") {
        v = parseFloat(v);
        if (Number.isNaN(v)) v = Number.MAX_VALUE;
      }
      if (typeof v !== "number") return false;
      switch (op) {
        case "=": return v === f;
        case "!=": return v !== f;
        case ">": return v > f;
        case ">=": return v >= f;
        case "<": return v < f;
        case "<=": return v <= f;
        default: return false;
      }
    });
  }
  return src.filter((o) => {
    const v = fastLookup(o, key);
    if (op === "=") return v === value;
    if (op === "!=") return v !== value;
    return false;
  });
});
impl("data/makeTable", (headers, ...lists) => {
  const dirty = String(headers).split(/[,;]/);
  const headerList = [];
  for (let i = 0; i < 6; i++) {
    let key = i < dirty.length ? dirty[i].trim() : "";
    if (!key) key = `list${i + 1}`;
    headerList.push(key);
  }
  const ls = lists.slice(0, 6).map((l) => (l == null ? [] : l));
  let colCount = 0;
  ls.forEach((l, i) => {
    if (l.length) colCount = i + 1;
  });
  const rowCount = Math.max(0, ...ls.map((l) => l.length));
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const row = {};
    for (let c = 0; c < colCount; c++) {
      if (ls[c].length) row[headerList[c]] = r < ls[c].length ? ls[c][r] : "";
    }
    rows.push(row);
  }
  return rows;
});

/** CSV parser matching DataFunctions.importCSV (headers, numeric columns). */
export function parseCSV(text, sep, quote, commaDecimals) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === quote) {
        if (text[i + 1] === quote) {
          field += quote;
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === quote) inQuotes = true;
    else if (c === sep) pushField();
    else if (c === "\n") {
      pushField();
      pushRow();
    } else if (c !== "\r") field += c;
  }
  if (field.length || row.length) {
    pushField();
    pushRow();
  }
  if (rows.length === 0) return [];
  const headers = rows[0].map((h, i) => {
    h = h.trim();
    return h === "" ? `Column ${i + 1}` : h;
  });
  const seen = {};
  for (let i = 0; i < headers.length; i++) {
    if (seen[headers[i]] != null) {
      seen[headers[i]]++;
      headers[i] = `${headers[i]} ${seen[headers[i]]}`;
    } else seen[headers[i]] = 0;
  }
  const parseNum = (v) => {
    let s = v.trim();
    if (commaDecimals) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    if (s === "" || Number.isNaN(Number(s))) return null;
    return Number(s);
  };
  const numeric = headers.map((_, c) =>
    rows.slice(1).every((r) => r[c] === undefined || parseNum(r[c] || "") !== null),
  );
  return rows.slice(1).map((r) => {
    const o = {};
    r.forEach((v, c) => {
      const h = headers[c] || `Column ${c + 1}`;
      o[h] = numeric[c] ? (parseNum(v || "") ?? v.trim()) : v.trim();
    });
    return o;
  });
}

// ---- corevector (CoreVectorFunctions.java + pyvector.py) -------------------

impl("corevector/generator", () => g.rectPath(50, 50, 100, 100));
impl("corevector/filter", (shape) => (shape == null ? null : g.transformShape(g.rotation(45), shape)));
impl("corevector/doNothing", (o) => o);
impl("corevector/align", (shape, position, halign, valign) => {
  if (shape == null) return null;
  const b = g.bounds(shape);
  let dx = 0;
  let dy = 0;
  if (halign === "left") dx = position.x - b.x;
  else if (halign === "right") dx = position.x - b.x - b.width;
  else if (halign === "center") dx = position.x - b.x - b.width / 2;
  if (valign === "top") dy = position.y - b.y;
  else if (valign === "bottom") dy = position.y - b.y - b.height;
  else if (valign === "middle") dy = position.y - b.y - b.height / 2;
  return g.transformShape(g.translation(dx, dy), shape);
});
impl("corevector/arc", (position, width, height, startAngle, degrees, arcType) =>
  g.arcPath(position.x, position.y, width, height, startAngle, degrees, arcType),
);
impl("corevector/centroid", (shape) => (shape == null ? g.point(0, 0) : g.centroid(shape)));
impl("corevector/colorize", (shape, fill, stroke, strokeWidth) => {
  if (shape == null) return null;
  const colorizeOne = (s) => ({
    ...s,
    fill,
    stroke: strokeWidth > 0 ? stroke : null,
    strokeWidth: strokeWidth > 0 ? strokeWidth : 0,
  });
  const walk = (s) => {
    if (Array.isArray(s)) return s.map(walk);
    if (g.isPoint(s)) return s;
    if (s.type === "group") return g.makeGroup(s.shapes.map(walk));
    return colorizeOne(s);
  };
  return walk(shape);
});
impl("pyvector/compound", compoundShapes);
impl("corevector/connect", (points, closed) => {
  if (points == null || points.length === 0) return null;
  // pyvector's connect accepts points OR shapes (per-shape connect).
  const first = points.find((p) => p != null);
  if (first == null) return null;
  const connectPoints = (pts) => {
    if (pts.length < 2) return null;
    const commands = pts.map((p, i) => ({ type: i === 0 ? "M" : "L", x: p.x, y: p.y }));
    if (closed) commands.push({ type: "Z" });
    return g.makePath(commands, { fill: null, stroke: g.BLACK, strokeWidth: 1 });
  };
  if (g.isPoint(first)) return connectPoints(notNull(points));
  const shapes = notNull(points).map((s) => connectPoints(g.shapePoints(s))).filter(Boolean);
  return shapes.length === 1 ? shapes[0] : g.makeGroup(shapes);
});
impl("corevector/copy", (shape, copies, order, translate, rotate, scale) => {
  if (shape == null) return [];
  const out = [];
  let tx = 0;
  let ty = 0;
  let r = 0;
  let sx = 1;
  let sy = 1;
  for (let i = 0; i < copies; i++) {
    let t = g.IDENTITY;
    for (const op of String(order)) {
      // Transform.translate/rotate/scale post-multiply in Java.
      if (op === "t") t = g.compose(t, g.translation(tx, ty));
      else if (op === "r") t = g.compose(t, g.rotation(r));
      else if (op === "s") t = g.compose(t, g.scaling(sx, sy));
    }
    out.push(g.transformShape(t, shape));
    tx += translate.x;
    ty += translate.y;
    r += rotate;
    sx += scale.x / 100 - 1;
    sy += scale.y / 100 - 1;
  }
  return out;
});
impl("pyvector/delete", (shape, bounding, scope, operation) => {
  if (shape == null || bounding == null) return null;
  const deleteSelected = operation === "selected";
  if (scope === "points") {
    return mapPaths(shape, (path) => {
      const contours = pathContours(path)
        .map((c) => {
          const kept = c.commands.filter(
            (cmd) => g.containsPoint(bounding, { x: cmd.x, y: cmd.y }) !== deleteSelected,
          );
          if (kept.length === 0) return null;
          const cmds = kept.map((cmd, i) =>
            i === 0 ? { ...cmd, type: "M" } : cmd.type === "M" ? { ...cmd, type: "L" } : cmd,
          );
          return { commands: cmds, closed: c.closed };
        })
        .filter(Boolean);
      return contoursToPath(contours, styleOf(path));
    });
  }
  // paths scope: a path is selected if ANY of its points is inside.
  return mapPathsFilter(shape, (path) => {
    const selected = g.shapePoints(path).some((p) => g.containsPoint(bounding, p));
    return selected !== deleteSelected ? path : null;
  });
});
impl("pyvector/distribute", (shapes, horizontal, vertical) => {
  if (shapes == null) return [];
  let out = notNull(shapes);
  if (out.length < 3 || (horizontal === "none" && vertical === "none")) return out;
  const measures = {
    left: (s) => g.bounds(s).x,
    right: (s) => { const b = g.bounds(s); return b.x + b.width; },
    center: (s) => { const b = g.bounds(s); return b.x + b.width / 2; },
    top: (s) => g.bounds(s).y,
    bottom: (s) => { const b = g.bounds(s); return b.y + b.height; },
    middle: (s) => { const b = g.bounds(s); return b.y + b.height / 2; },
  };
  const run = (list, axis, mainFn) => {
    const horizontalAxis = axis === "x";
    const ext1 = horizontalAxis ? measures.left : measures.top;
    const ext2 = horizontalAxis ? measures.right : measures.bottom;
    const sorted = list.slice().sort((a, b) => mainFn(a) - mainFn(b));
    const extremum1 = list.slice().sort((a, b) => ext1(a) - ext1(b))[0];
    const extremum2 = list.slice().sort((a, b) => ext2(a) - ext2(b))[list.length - 1];
    const outer1 = mainFn(extremum1);
    const outer2 = mainFn(extremum2);
    const skip = (outer2 - outer1) / (list.length - 1);
    const index = new Map(sorted.map((s, i) => [s, i]));
    const iE1 = index.get(extremum1);
    const iE2 = index.get(extremum2);
    return list.map((s) => {
      if (s === extremum1 || s === extremum2) return s;
      let i = index.get(s);
      if (i < iE1) i += 1;
      if (i > iE2) i -= 1;
      const d = outer1 + i * skip - mainFn(s);
      return g.transformShape(horizontalAxis ? g.translation(d, 0) : g.translation(0, d), s);
    });
  };
  if (horizontal !== "none") out = run(out, "x", measures[horizontal]);
  if (vertical !== "none") out = run(out, "y", measures[vertical]);
  return out;
});
impl("corevector/ellipse", (position, width, height) =>
  g.ellipsePath(position.x, position.y, width, height),
);
impl("corevector/fit", (shape, position, width, height, keepProportions) => {
  if (shape == null) return null;
  const b = g.bounds(shape);
  const bw = b.width > 1e-12 ? b.width : 0;
  const bh = b.height > 1e-12 ? b.height : 0;
  let sx;
  let sy;
  if (keepProportions) {
    sx = bw > 0 ? width / bw : Number.MAX_VALUE;
    sy = bh > 0 ? height / bh : Number.MAX_VALUE;
    sx = sy = Math.min(sx, sy);
  } else {
    sx = bw > 0 ? width / bw : 1;
    sy = bh > 0 ? height / bh : 1;
  }
  const t = g.compose(
    g.translation(position.x, position.y),
    g.compose(g.scaling(sx, sy), g.translation(-bw / 2 - b.x, -bh / 2 - b.y)),
  );
  return g.transformShape(t, shape);
});
impl("corevector/fitTo", (shape, bounding, keepProportions) => {
  if (shape == null) return null;
  if (bounding == null) return shape;
  const b = g.bounds(bounding);
  return IMPLS["corevector/fit"](
    shape,
    { x: b.x + b.width / 2, y: b.y + b.height / 2 },
    b.width,
    b.height,
    keepProportions,
  );
});
impl("corevector/freehand", (pathString) => {
  if (!pathString) return g.makePath([], { fill: null, stroke: g.BLACK, strokeWidth: 1 });
  const commands = [];
  for (const contourString of String(pathString).split("M")) {
    const numbers = contourString
      .trim()
      .split(/[\s,]+/)
      .map(parseFloat)
      .filter((v) => !Number.isNaN(v));
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      commands.push({ type: i === 0 ? "M" : "L", x: numbers[i], y: numbers[i + 1] });
    }
  }
  return g.makePath(commands, { fill: null, stroke: g.BLACK, strokeWidth: 1 });
});
impl("corevector/grid", (columns, rows, width, height, position) => {
  let columnSize;
  let left;
  let rowSize;
  let top;
  if (columns > 1) {
    columnSize = width / (columns - 1);
    left = position.x - width / 2;
  } else {
    columnSize = left = position.x;
  }
  if (rows > 1) {
    rowSize = height / (rows - 1);
    top = position.y - height / 2;
  } else {
    rowSize = top = position.y;
  }
  const points = [];
  for (let ri = 0; ri < rows; ri++) {
    for (let ci = 0; ci < columns; ci++) {
      points.push({ x: left + ci * columnSize, y: top + ri * rowSize });
    }
  }
  return points;
});
impl("corevector/group", (shapes) => g.makeGroup(notNull(shapes)));
impl("pyvector/import_svg", (fileName, centered, position) => {
  if (!fileName) return null;
  let shape = svgToShape(loadFile(fileName));
  if (shape == null) return null;
  let t = g.translation(position.x, position.y);
  if (centered) {
    const b = g.bounds(shape);
    t = g.compose(t, g.translation(-b.x - b.width / 2, -b.y - b.height / 2));
  }
  return g.transformShape(t, shape);
});
impl("corevector/line", (p1, p2, points) => {
  const line = g.linePath(p1.x, p1.y, p2.x, p2.y);
  return points > 2 ? resampleShape(line, "amount", 0, points, false) : line;
});
impl("corevector/lineAngle", (position, angle, distance, points) => {
  const p2 = coords(position.x, position.y, distance, angle);
  const line = g.linePath(position.x, position.y, p2.x, p2.y);
  return points > 2 ? resampleShape(line, "amount", 0, points, false) : line;
});
impl("corevector/link", (shape1, shape2, orientation) => {
  if (shape1 == null || shape2 == null) return null;
  const a = g.bounds(shape1);
  const b = g.bounds(shape2);
  const c = [];
  if (orientation === "horizontal") {
    const hw = (b.x - (a.x + a.width)) / 2;
    c.push({ type: "M", x: a.x + a.width, y: a.y });
    c.push({ type: "C", x1: a.x + a.width + hw, y1: a.y, x2: b.x - hw, y2: b.y, x: b.x, y: b.y });
    c.push({ type: "L", x: b.x, y: b.y + b.height });
    c.push({
      type: "C",
      x1: b.x - hw,
      y1: b.y + b.height,
      x2: a.x + a.width + hw,
      y2: a.y + a.height,
      x: a.x + a.width,
      y: a.y + a.height,
    });
  } else {
    const hh = (b.y - (a.y + a.height)) / 2;
    c.push({ type: "M", x: a.x, y: a.y + a.height });
    c.push({ type: "C", x1: a.x, y1: a.y + a.height + hh, x2: b.x, y2: b.y - hh, x: b.x, y: b.y });
    c.push({ type: "L", x: b.x + b.width, y: b.y });
    c.push({
      type: "C",
      x1: b.x + b.width,
      y1: b.y - hh,
      x2: a.x + a.width,
      y2: a.y + a.height + hh,
      x: a.x + a.width,
      y: a.y + a.height,
    });
  }
  return g.makePath(c);
});
impl("corevector/makePoint", (x, y) => ({ x, y }));
impl("corevector/point", (value) => value);
impl("corevector/pointOnPath", (shape, t) => {
  if (shape == null) return null;
  const path = allPaths(shape)[0];
  if (!path) return null;
  const wrapped = Math.abs(t % 100) / 100;
  const p = g.pointAt(path, wrapped);
  return { x: p.x, y: p.y };
});
impl("pyvector/polygon", (position, radius, sides, align) => {
  const { x, y } = position;
  sides = Math.max(sides, 3);
  const a = 360 / sides;
  let da = 0;
  if (align) {
    const p0 = coords(x, y, radius, 0);
    const p1 = coords(x, y, radius, a);
    da = -angleTo(p1.x, p1.y, p0.x, p0.y);
  }
  const commands = [];
  for (let i = 0; i < sides; i++) {
    const p = coords(x, y, radius, a * i + da);
    commands.push({ type: i === 0 ? "M" : "L", x: p.x, y: p.y });
  }
  commands.push({ type: "Z" });
  return g.makePath(commands);
});
impl("pyvector/quad_curve", (pt1, pt2, t, distance) => {
  t /= 100;
  const cx = pt1.x + t * (pt2.x - pt1.x);
  const cy = pt1.y + t * (pt2.y - pt1.y);
  const a = angleTo(pt1.x, pt1.y, pt2.x, pt2.y) + 90;
  const q = coords(cx, cy, distance, a);
  const commands = [
    { type: "M", x: pt1.x, y: pt1.y },
    quadToCubic(pt1.x, pt1.y, q.x, q.y, pt2.x, pt2.y),
  ];
  return g.makePath(commands, { fill: null, stroke: g.BLACK, strokeWidth: 1 });
});
impl("corevector/rect", (position, width, height, roundness) => {
  if (!roundness || (roundness.x === 0 && roundness.y === 0)) {
    return g.rectPath(position.x, position.y, width, height);
  }
  return g.roundedRectPath(position.x, position.y, width, height, roundness.x, roundness.y);
});
impl("pyvector/reflect", (shape, position, angle, keepOriginal) => {
  if (shape == null) return null;
  const reflectPoint = (px, py) => {
    const d = distanceTo(px, py, position.x, position.y);
    const a = angleTo(px, py, position.x, position.y);
    const p = coords(position.x, position.y, d * Math.cos(rad(a - angle)), 180 + angle);
    const d2 = distanceTo(px, py, p.x, p.y);
    const a2 = angleTo(px, py, p.x, p.y);
    return coords(px, py, d2 * 2, a2);
  };
  const mirrored = mapPaths(shape, (path) => ({
    ...path,
    commands: path.commands.map((cmd) => {
      if (cmd.type === "Z") return cmd;
      const out = { ...cmd, ...reflectPoint(cmd.x, cmd.y) };
      if (cmd.type === "C") {
        const c1 = reflectPoint(cmd.x1, cmd.y1);
        const c2 = reflectPoint(cmd.x2, cmd.y2);
        out.x1 = c1.x;
        out.y1 = c1.y;
        out.x2 = c2.x;
        out.y2 = c2.y;
      }
      return out;
    }),
  }));
  return keepOriginal ? g.makeGroup([shape, mirrored]) : mirrored;
});
impl("pyvector/resample", (shape, method, length, points, perContour) => {
  if (shape == null) return null;
  return resampleShape(shape, method, length, points, perContour);
});
impl("pyvector/rotate", (shape, angle, origin) => {
  if (shape == null) return null;
  const t = g.compose(
    g.translation(origin.x, origin.y),
    g.compose(g.rotation(angle), g.translation(-origin.x, -origin.y)),
  );
  return g.transformShape(t, shape);
});
impl("pyvector/round_segments", (shape, d) => {
  if (shape == null) return null;
  return mapPaths(shape, (path) => {
    const contours = pathContours(path).map((c) => {
      const pts = contourPoints(c);
      const triples = [];
      for (let i = 0; i < pts.length; i++) {
        const prev = pts[(i - 1 + pts.length) % pts.length];
        const next = pts[(i + 1) % pts.length];
        const a = angleTo(prev.x, prev.y, next.x, next.y);
        triples.push(coords(pts[i].x, pts[i].y, -d, a), pts[i], coords(pts[i].x, pts[i].y, d, a));
      }
      // triples = [in, pt, out] per point → curveto chain (pyvector).
      const segs = [];
      for (let i = 0; i < triples.length; i += 3) {
        segs.push({ in: triples[i], pt: triples[i + 1], out: triples[i + 2] });
      }
      const commands = [];
      const count = c.closed ? segs.length + 1 : segs.length;
      for (let i = 0; i < count; i++) {
        const seg = segs[i % segs.length];
        if (i === 0) commands.push({ type: "M", x: seg.pt.x, y: seg.pt.y });
        else {
          const prev = segs[(i - 1) % segs.length];
          commands.push({
            type: "C",
            x1: prev.out.x,
            y1: prev.out.y,
            x2: seg.in.x,
            y2: seg.in.y,
            x: seg.pt.x,
            y: seg.pt.y,
          });
        }
      }
      return { commands, closed: c.closed };
    });
    return contoursToPath(contours, styleOf(path));
  });
});
impl("pyvector/scale", (shape, scale, origin) => {
  if (shape == null) return null;
  const t = g.compose(
    g.translation(origin.x, origin.y),
    g.compose(g.scaling(scale.x / 100, scale.y / 100), g.translation(-origin.x, -origin.y)),
  );
  return g.transformShape(t, shape);
});
impl("pyvector/scatter", (shape, amount, seed) => {
  if (shape == null) return [];
  const rand = g.randomFromSeed(seed);
  const b = g.bounds(shape);
  const points = [];
  for (let i = 0; i < amount; i++) {
    let tries = 100;
    while (tries > 0) {
      const p = { x: b.x + rand() * b.width, y: b.y + rand() * b.height };
      if (g.containsPoint(shape, p)) {
        points.push(p);
        break;
      }
      tries--;
    }
  }
  return points;
});
impl("pyvector/shape_on_path", (shapes, path, amount, alignment, spacing, margin, baselineOffset) => {
  if (shapes == null || shapes.length === 0 || path == null) return [];
  const p = allPaths(path)[0];
  if (!p) return [];
  let list = notNull(shapes);
  if (alignment === "trailing") list = list.slice().reverse();
  const totalLength = g.pathLength(p);
  const length = totalLength - margin;
  const m = margin / totalLength;
  let c = 0;
  const out = [];
  for (let i = 0; i < amount; i++) {
    for (const shape of list) {
      let pos;
      if (alignment === "distributed") {
        const per = length / (amount * list.length - 1 || 1);
        pos = (c * per) / length;
        pos = m + pos * (1 - 2 * m);
      } else {
        pos = ((c * spacing) % length) / length;
        pos = m + pos * (1 - m);
        if (alignment === "trailing") pos = 1 - pos;
      }
      const p1 = g.pointAt(p, pos);
      const a = p1.angle;
      let anchor = { x: p1.x, y: p1.y };
      if (baselineOffset) anchor = coords(anchor.x, anchor.y, baselineOffset, a - 90);
      const t = g.compose(g.translation(anchor.x, anchor.y), g.rotation(a));
      out.push(g.transformShape(t, shape));
      c++;
    }
  }
  return out;
});
impl("corevector/skew", (shape, skew, origin) => {
  if (shape == null) return null;
  const t = g.compose(
    g.translation(origin.x, origin.y),
    g.compose(g.skewing(skew.x, skew.y), g.translation(-origin.x, -origin.y)),
  );
  return g.transformShape(t, shape);
});
impl("corevector/snap", (shape, distance, strength, position) => {
  if (shape == null) return null;
  const k = strength / 100;
  const snapV = (v, offset) => v * (1 - k) + k * Math.round((v + offset) / distance) * distance - k * offset;
  const snapPt = (x, y) => ({
    x: snapV(x + position.x, 0) - position.x,
    y: snapV(y + position.y, 0) - position.y,
  });
  return mapPaths(shape, (path) => ({
    ...path,
    commands: path.commands.map((cmd) => {
      if (cmd.type === "Z") return cmd;
      const out = { ...cmd, ...snapPt(cmd.x, cmd.y) };
      if (cmd.type === "C") {
        const c1 = snapPt(cmd.x1, cmd.y1);
        const c2 = snapPt(cmd.x2, cmd.y2);
        out.x1 = c1.x;
        out.y1 = c1.y;
        out.x2 = c2.x;
        out.y2 = c2.y;
      }
      return out;
    }),
  }));
});
impl("pyvector/sort", (shapes, orderBy, position) => {
  if (shapes == null) return [];
  const list = notNull(shapes);
  const centerOf = (s) => (g.isPoint(s) ? s : g.centroid(s));
  const methods = {
    x: (s) => (g.isPoint(s) ? s.x : g.bounds(s).x),
    y: (s) => (g.isPoint(s) ? s.y : g.bounds(s).y),
    angle: (s) => {
      const c = centerOf(s);
      return angleTo(c.x, c.y, position.x, position.y);
    },
    distance: (s) => {
      const c = centerOf(s);
      return distanceTo(c.x, c.y, position.x, position.y);
    },
  };
  const fn = methods[orderBy];
  if (!fn) return list;
  return list.slice().sort((a, b) => fn(a) - fn(b));
});
impl("pyvector/stack", (shapes, direction, margin) => {
  if (shapes == null) return [];
  const list = notNull(shapes);
  if (list.length <= 1) return list;
  const first = g.bounds(list[0]);
  const out = [];
  if (direction === "e") {
    let tx = first.x;
    for (const shape of list) {
      const b = g.bounds(shape);
      out.push(g.transformShape(g.translation(tx - b.x, 0), shape));
      tx += b.width + margin;
    }
  } else if (direction === "w") {
    let tx = first.x + first.width;
    for (const shape of list) {
      const b = g.bounds(shape);
      out.push(g.transformShape(g.translation(tx - (b.x + b.width), 0), shape));
      tx -= b.width + margin;
    }
  } else if (direction === "n") {
    let ty = first.y + first.height;
    for (const shape of list) {
      const b = g.bounds(shape);
      out.push(g.transformShape(g.translation(0, ty - (b.y + b.height)), shape));
      ty -= b.height + margin;
    }
  } else if (direction === "s") {
    let ty = first.y;
    for (const shape of list) {
      const b = g.bounds(shape);
      out.push(g.transformShape(g.translation(0, ty - b.y), shape));
      ty += b.height + margin;
    }
  } else {
    throw new Error(`Invalid direction "${direction}".`);
  }
  return out;
});
impl("pyvector/star", (position, points, outer, inner) => {
  const commands = [{ type: "M", x: position.x, y: position.y + outer / 2 }];
  for (let i = 1; i < points * 2; i++) {
    const a = (i * Math.PI) / points;
    const r = i % 2 ? inner / 2 : outer / 2;
    commands.push({ type: "L", x: position.x + r * Math.sin(a), y: position.y + r * Math.cos(a) });
  }
  commands.push({ type: "Z" });
  return g.makePath(commands);
});
impl("pyvector/text_on_path", (text, path, fontName, fontSize, alignment, margin, baselineOffset) => {
  if (path == null || text == null) return null;
  const p = allPaths(path)[0];
  if (!p) return null;
  const totalLength = g.pathLength(p);
  if (totalLength <= 0) return null;
  const chars = [...String(text)];
  const stringWidth = g.textWidth(text, fontSize) || 1;
  const dw = stringWidth / totalLength;
  let t = 0;
  if (alignment === "trailing") {
    let tt = 0;
    let first = true;
    for (const ch of chars) {
      const cw = g.textWidth(ch, fontSize);
      if (first) {
        tt = (99.9 - margin) / 100;
        first = false;
      } else tt -= (cw / stringWidth) * dw;
      tt = ((tt % 1) + 1) % 1;
    }
    margin = tt * 100;
  }
  const shapes = [];
  let first = true;
  for (const ch of chars) {
    const cw = g.textWidth(ch, fontSize);
    if (first) {
      t = margin / 100;
      first = false;
    } else t += (cw / stringWidth) * dw;
    t = ((t % 1) + 1) % 1;
    const pt1 = g.pointAt(p, t);
    const a = pt1.angle + 180;
    const transform = g.compose(
      g.compose(g.translation(pt1.x, pt1.y), g.rotation(a - 180)),
      g.translation(-cw, -baselineOffset),
    );
    shapes.push(
      g.makeText(ch, 0, 0, { fontName, fontSize, align: "LEFT", transform }),
    );
  }
  return g.makeGroup(shapes);
});
impl("corevector/textpath", (text, fontName, fontSize, align, position, width) => {
  const w = g.textWidth(text, fontSize);
  let x = position.x;
  if (align === "CENTER") x = width ? position.x - width / 2 + (width - w) / 2 : position.x - w / 2;
  else if (align === "RIGHT") x = width ? position.x - width + (width - w) : position.x - w;
  return g.makeText(text, x, position.y, { fontName, fontSize, align: "LEFT", width: 0 });
});
impl("pyvector/translate", (shape, translate) => {
  if (shape == null) return null;
  return g.transformShape(g.translation(translate.x, translate.y), shape);
});
impl("corevector/ungroup", (shape) => {
  if (shape == null) return [];
  if (shape.type === "group") {
    // NodeBox flattens one level of geometry into its paths.
    const out = [];
    const walk = (s) => {
      if (s.type === "group") s.shapes.forEach(walk);
      else out.push(s);
    };
    walk(shape);
    return out;
  }
  return [shape];
});
impl("pyvector/wiggle", (shape, scope, offset, seed) => {
  if (shape == null) return [];
  const rand = g.randomFromSeed(seed);
  const delta = () => ({
    x: (rand() - 0.5) * offset.x * 2,
    y: (rand() - 0.5) * offset.y * 2,
  });
  if (g.isPoint(shape)) {
    const d = delta();
    return [{ x: shape.x + d.x, y: shape.y + d.y }];
  }
  let out;
  if (scope === "points") {
    out = mapPaths(shape, (path) => ({
      ...path,
      commands: path.commands.map((cmd) => {
        if (cmd.type === "Z") return cmd;
        const d = delta();
        const o = { ...cmd, x: cmd.x + d.x, y: cmd.y + d.y };
        if (cmd.type === "C") {
          o.x1 += d.x;
          o.y1 += d.y;
          o.x2 += d.x;
          o.y2 += d.y;
        }
        return o;
      }),
    }));
  } else if (scope === "contours") {
    out = mapPaths(shape, (path) => {
      const contours = pathContours(path).map((c) => {
        const d = delta();
        return {
          commands: c.commands.map((cmd) => {
            const o = { ...cmd, x: cmd.x + d.x, y: cmd.y + d.y };
            if (cmd.type === "C") {
              o.x1 += d.x;
              o.y1 += d.y;
              o.x2 += d.x;
              o.y2 += d.y;
            }
            return o;
          }),
          closed: c.closed,
        };
      });
      return contoursToPath(contours, styleOf(path));
    });
  } else {
    // paths scope: translate each path as a whole.
    out = mapPaths(shape, (path) => {
      const d = delta();
      return g.transformShape(g.translation(d.x, d.y), path);
    });
  }
  return [out];
});

// ---------------------------------------------------------------------------
// Cartan's helper functions (Python / Clojure → JavaScript ports).
// Each entry mirrors one function the .ndbx links via <link href="python:…">.
// ---------------------------------------------------------------------------

export const CARTAN_FNS = {};
const cfn = (id, fn, opts = {}) => (CARTAN_FNS[id] = { fn, ...opts });

// contours.py
cfn("contours/contours", (path) => {
  if (path == null) return [];
  const out = [];
  for (const p of allPaths(path)) {
    for (const c of pathContours(p)) out.push(contoursToPath([c], styleOf(p)));
  }
  return out;
}, { outputRange: "list" });
cfn("contours/join_contours", (contours) => {
  const paths = notNull(contours).flatMap(allPaths);
  if (paths.length === 0) return null;
  const commands = paths.flatMap((p) => p.commands);
  return g.makePath(commands, styleOf(paths[0]));
});

// make_curve.py
cfn("make_curve/makecurve", (pt1, c1, c2, pt2) =>
  g.makePath(
    [
      { type: "M", x: pt1.x, y: pt1.y },
      { type: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: pt2.x, y: pt2.y },
    ],
    { fill: null, stroke: g.BLACK, strokeWidth: 1 },
  ),
);

// concat_list.py / unicode.py
const joinList = (strings, delimiter) => notNull(strings).join(delimiter == null ? "" : delimiter);
cfn("concat_list/concat", joinList);
cfn("unicode/concat", joinList);
cfn("unicode/convert", (hexcode) => String.fromCodePoint(parseInt(hexcode, 16)));

// convert_base.py (numpy base_repr)
cfn("convert_base/base_repr", (number, base, padding) => {
  const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (base > 36) throw new Error("Bases greater than 36 not handled in base_repr.");
  if (base < 2) throw new Error("Bases less than 2 not handled in base_repr.");
  let num = Math.abs(Math.trunc(number));
  const res = [];
  while (num) {
    res.push(digits[num % base]);
    num = Math.floor(num / base);
  }
  if (padding) res.push("0".repeat(padding));
  if (number < 0) res.push("-");
  return res.length ? res.reverse().join("") : "0";
});

// dateformat.clj — SimpleDateFormat subset ("u" means unix seconds).
cfn("dateformat/convert-date", (d, inputFormat, outputFormat) => {
  const date = inputFormat === "u" ? new Date(Number(d) * 1000) : parseDateFormat(String(d), inputFormat);
  if (outputFormat === "u") return Math.round(date.getTime() / 1000);
  return formatDate(date, outputFormat);
});

function parseDateFormat(s, fmt) {
  // Build a regex from the SimpleDateFormat pattern; capture y/M/d/H/m/s.
  const order = [];
  const rx = fmt.replace(/y+|M+|d+|H+|h+|m+|s+|EEE+|./g, (tok) => {
    if (/^y+$/.test(tok)) {
      order.push("y");
      return "(\\d{1,4})";
    }
    if (/^M+$/.test(tok)) {
      order.push(tok.length >= 3 ? "Mname" : "M");
      return tok.length >= 3 ? "([A-Za-z]+)" : "(\\d{1,2})";
    }
    if (/^d+$/.test(tok)) {
      order.push("d");
      return "(\\d{1,2})";
    }
    if (/^[Hh]+$/.test(tok)) {
      order.push("H");
      return "(\\d{1,2})";
    }
    if (/^m+$/.test(tok)) {
      order.push("m");
      return "(\\d{1,2})";
    }
    if (/^s+$/.test(tok)) {
      order.push("s");
      return "(\\d{1,2})";
    }
    if (/^E+$/.test(tok)) return "[A-Za-z]+";
    return tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  // SimpleDateFormat is lenient: trailing text after the pattern is ignored.
  const m = new RegExp(`^${rx}`).exec(s.trim());
  if (!m) throw new Error(`Cannot parse date "${s}" with format "${fmt}"`);
  const parts = { y: 1970, M: 1, d: 1, H: 0, m: 0, s: 0 };
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  order.forEach((k, i) => {
    const v = m[i + 1];
    if (k === "Mname") parts.M = MONTHS.indexOf(v.slice(0, 3).toLowerCase()) + 1 || 1;
    else parts[k] = parseInt(v, 10);
  });
  return new Date(parts.y, parts.M - 1, parts.d, parts.H, parts.m, parts.s);
}

function formatDate(date, fmt) {
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const pad = (v, n) => String(v).padStart(n, "0");
  return fmt.replace(/y+|M+|d+|E+|H+|h+|m+|s+|a/g, (tok) => {
    switch (tok[0]) {
      case "y": return tok.length === 2 ? pad(date.getFullYear() % 100, 2) : pad(date.getFullYear(), tok.length);
      case "M":
        if (tok.length >= 4) return MONTHS[date.getMonth()];
        if (tok.length === 3) return MONTHS[date.getMonth()].slice(0, 3);
        return pad(date.getMonth() + 1, tok.length);
      case "d": return pad(date.getDate(), tok.length);
      case "E": return tok.length >= 4 ? DAYS[date.getDay()] : DAYS[date.getDay()].slice(0, 3);
      case "H": return pad(date.getHours(), tok.length);
      case "h": return pad(date.getHours() % 12 || 12, tok.length);
      case "m": return pad(date.getMinutes(), tok.length);
      case "s": return pad(date.getSeconds(), tok.length);
      case "a": return date.getHours() < 12 ? "AM" : "PM";
      default: return tok;
    }
  });
}

// time.py — impure; these get a context port so results never cache.
const startTime = typeof performance !== "undefined" ? performance.now() : 0;
cfn("time/localtime", (_ctx) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const yday = Math.floor((now - start) / 86400000);
  const wday = (now.getDay() + 6) % 7; // Python: Monday = 0
  return [
    now.getFullYear(), now.getMonth() + 1, now.getDate(),
    now.getHours(), now.getMinutes(), now.getSeconds(),
    wday, yday, 0,
  ].map(String);
}, { impure: true, outputRange: "list" });
cfn("time/clock", (_ctx, _x) => [(typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000 - startTime / 1000], {
  impure: true,
  outputRange: "list",
});
cfn("time/fracsecond", (_ctx) => {
  const t = Date.now() / 1000;
  return t - Math.floor(t);
}, { impure: true });

// canvas.py — needs the document's canvas size from the render context.
cfn("canvas/canvas", (ctx) => {
  const w = (ctx && ctx.canvas && ctx.canvas.width) || 600;
  const h = (ctx && ctx.canvas && ctx.canvas.height) || 600;
  const p = g.rectPath(0, 0, w, h);
  return { ...p, fill: g.WHITE, stroke: g.BLACK, strokeWidth: 0 };
}, { context: true });

// poisson.py — Bridson poisson-disc sampling (deterministic port).
cfn("poisson/poisson", (pointSize, width, height, seed) => {
  const rand = g.randomFromSeed(seed);
  const k = 30;
  const r = Math.max(pointSize, 0.5);
  const a = r / Math.SQRT2;
  const nx = Math.floor(width / a) + 1;
  const ny = Math.floor(height / a) + 1;
  const cells = new Array(nx * ny).fill(-1);
  const cellOf = (p) => Math.floor(p[0] / a) + nx * Math.floor(p[1] / a);
  const samples = [];
  const active = [];
  const valid = (p) => {
    const cx = Math.floor(p[0] / a);
    const cy = Math.floor(p[1] / a);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= nx || y < 0 || y >= ny) continue;
        const idx = cells[x + nx * y];
        if (idx >= 0) {
          const q = samples[idx];
          if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < r * r) return false;
        }
      }
    }
    return true;
  };
  const first = [rand() * width, rand() * height];
  samples.push(first);
  cells[cellOf(first)] = 0;
  active.push(0);
  while (active.length) {
    const idx = active[Math.floor(rand() * active.length)];
    const ref = samples[idx];
    let found = false;
    for (let i = 0; i < k; i++) {
      const rho = r + rand() * r;
      const theta = rand() * Math.PI * 2;
      const p = [ref[0] + rho * Math.cos(theta), ref[1] + rho * Math.sin(theta)];
      if (p[0] < 0 || p[0] >= width || p[1] < 0 || p[1] >= height) continue;
      if (valid(p)) {
        samples.push(p);
        cells[cellOf(p)] = samples.length - 1;
        active.push(samples.length - 1);
        found = true;
        break;
      }
    }
    if (!found) active.splice(active.indexOf(idx), 1);
  }
  return samples.map((p) => ({ x: p[0] - width / 2, y: p[1] - height / 2 }));
}, { outputRange: "list" });

// convex_hull.py — Andrew's monotone chain.
cfn("convex_hull/convex_hull", (myPoints) => {
  const pts = notNull(myPoints).flatMap((p) => (g.isPoint(p) ? [p] : g.shapePoints(p)));
  const unique = [...new Map(pts.map((p) => [`${p.x},${p.y}`, p])).values()].sort(
    (p, q) => p.x - q.x || p.y - q.y,
  );
  if (unique.length <= 1) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of unique.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map((p) => ({ x: p.x, y: p.y }));
}, { outputRange: "list" });

// gilbert2d.py — generalized Hilbert curve (BSD-2, Jakub Červený).
cfn("gilbert2d/gilbert2d", (width, height) => {
  const sgn = (x) => (x < 0 ? -1 : x > 0 ? 1 : 0);
  const out = [];
  function generate2d(x, y, ax, ay, bx, by) {
    const w = Math.abs(ax + ay);
    const h = Math.abs(bx + by);
    const dax = sgn(ax);
    const day = sgn(ay);
    const dbx = sgn(bx);
    const dby = sgn(by);
    if (h === 1) {
      for (let i = 0; i < w; i++) {
        out.push({ x, y });
        x += dax;
        y += day;
      }
      return;
    }
    if (w === 1) {
      for (let i = 0; i < h; i++) {
        out.push({ x, y });
        x += dbx;
        y += dby;
      }
      return;
    }
    let ax2 = Math.trunc(ax / 2);
    let ay2 = Math.trunc(ay / 2);
    let bx2 = Math.trunc(bx / 2);
    let by2 = Math.trunc(by / 2);
    const w2 = Math.abs(ax2 + ay2);
    const h2 = Math.abs(bx2 + by2);
    if (2 * w > 3 * h) {
      if (w2 % 2 && w > 2) {
        ax2 += dax;
        ay2 += day;
      }
      generate2d(x, y, ax2, ay2, bx, by);
      generate2d(x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by);
    } else {
      if (h2 % 2 && h > 2) {
        bx2 += dbx;
        by2 += dby;
      }
      generate2d(x, y, bx2, by2, ax2, ay2);
      generate2d(x + bx2, y + by2, ax, ay, bx - bx2, by - by2);
      generate2d(
        x + (ax - dax) + (bx2 - dbx),
        y + (ay - day) + (by2 - dby),
        -bx2,
        -by2,
        -(ax - ax2),
        -(ay - ay2),
      );
    }
  }
  if (width >= height) generate2d(0, 0, width, 0, 0, height);
  else generate2d(0, 0, 0, height, width, 0);
  return out;
}, { outputRange: "list" });

// treemap.py — squarified treemaps (Bruls/Huizing/van Wijk via laserson).
cfn("treemap/squarify", (sizes, x, y, dx, dy) => {
  const src = notNull(sizes).map(Number);
  const totalSize = src.reduce((a, b) => a + b, 0) || 1;
  const normalized = src.map((s) => (s * dx * dy) / totalSize);
  const layoutRow = (ss, x0, y0, _dx0, dy0) => {
    const covered = ss.reduce((a, b) => a + b, 0);
    const width = covered / dy0;
    let yy = y0;
    return ss.map((size) => {
      const r = { x: x0, y: yy, dx: width, dy: size / width };
      yy += size / width;
      return r;
    });
  };
  const layoutCol = (ss, x0, y0, dx0, _dy0) => {
    const covered = ss.reduce((a, b) => a + b, 0);
    const height = covered / dx0;
    let xx = x0;
    return ss.map((size) => {
      const r = { x: xx, y: y0, dx: size / height, dy: height };
      xx += size / height;
      return r;
    });
  };
  const layout = (ss, x0, y0, dx0, dy0) =>
    dx0 >= dy0 ? layoutRow(ss, x0, y0, dx0, dy0) : layoutCol(ss, x0, y0, dx0, dy0);
  const leftover = (ss, x0, y0, dx0, dy0) => {
    const covered = ss.reduce((a, b) => a + b, 0);
    if (dx0 >= dy0) {
      const width = covered / dy0;
      return [x0 + width, y0, dx0 - width, dy0];
    }
    const height = covered / dx0;
    return [x0, y0 + height, dx0, dy0 - height];
  };
  const worst = (ss, x0, y0, dx0, dy0) =>
    Math.max(...layout(ss, x0, y0, dx0, dy0).map((r) => Math.max(r.dx / r.dy, r.dy / r.dx)));
  function squarify(ss, x0, y0, dx0, dy0) {
    if (ss.length === 0) return [];
    if (ss.length === 1) return layout(ss, x0, y0, dx0, dy0);
    let i = 1;
    while (i < ss.length && worst(ss.slice(0, i), x0, y0, dx0, dy0) >= worst(ss.slice(0, i + 1), x0, y0, dx0, dy0)) {
      i++;
    }
    const current = ss.slice(0, i);
    const remaining = ss.slice(i);
    const [lx, ly, ldx, ldy] = leftover(current, x0, y0, dx0, dy0);
    return [...layout(current, x0, y0, dx0, dy0), ...squarify(remaining, lx, ly, ldx, ldy)];
  }
  return squarify(normalized, x, y, dx, dy);
}, { outputRange: "list" });

// noise.clj — Ken Perlin's improved noise (the Clojure port's table).
// prettier-ignore
const PERLIN_P = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
const P = [...PERLIN_P, ...PERLIN_P];
cfn("noise/noise", (x, y, z) => {
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (t, a, b) => a + t * (b - a);
  const grad = (hash, xx, yy, zz) => {
    const h = hash & 15;
    const u = h < 8 ? xx : yy;
    const v = h < 4 ? yy : h === 12 || h === 14 ? xx : zz;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  const xx = x - Math.floor(x);
  const yy = y - Math.floor(y);
  const zz = z - Math.floor(z);
  const u = fade(xx);
  const v = fade(yy);
  const w = fade(zz);
  const A = P[X] + Y;
  const AA = P[A] + Z;
  const AB = P[A + 1] + Z;
  const B = P[X + 1] + Y;
  const BA = P[B] + Z;
  const BB = P[B + 1] + Z;
  return lerp(
    w,
    lerp(
      v,
      lerp(u, grad(P[AA], xx, yy, zz), grad(P[BA], xx - 1, yy, zz)),
      lerp(u, grad(P[AB], xx, yy - 1, zz), grad(P[BB], xx - 1, yy - 1, zz)),
    ),
    lerp(
      v,
      lerp(u, grad(P[AA + 1], xx, yy, zz - 1), grad(P[BA + 1], xx - 1, yy, zz - 1)),
      lerp(u, grad(P[AB + 1], xx, yy - 1, zz - 1), grad(P[BB + 1], xx - 1, yy - 1, zz - 1)),
    ),
  );
});

// Unsupported on the web (need the local filesystem, installed fonts or
// NodeBox application introspection). Nodes using these are flagged.
const unsupported = (what) => () => {
  throw new Error(`${what} is not supported in the web port`);
};
for (const id of ["image/image", "image/image_path", "image/bounds", "image/luma", "image/docsize"]) {
  cfn(id, unsupported("image sampling"));
}
for (const id of ["list_dir/listdir", "list_dir/listsub"]) cfn(id, unsupported("directory listing"));
cfn("write_table/writetemp", unsupported("writing files"));
cfn("font_table/font_table", unsupported("font introspection"));
for (const id of ["nodelist/getNodeColor", "nodelist/getPortInfo", "nodelist/getNodeNames", "nodelist/getNodeIcons"]) {
  cfn(id, unsupported("NodeBox application introspection"));
}
cfn("docsize/docsize", unsupported("document introspection"));

// ---------------------------------------------------------------------------
// Registry assembly
// ---------------------------------------------------------------------------

/** The full NodeBox 3 standard library as unified-engine NodeTypes. */
export function n3Types() {
  const coreTypes = [
    {
      id: "core.frame",
      name: "frame",
      category: "core",
      description: "The current animation frame.",
      outputType: "float",
      outputRange: "value",
      ports: [{ name: "context", type: "context" }],
      fn: (ctx) => ctx.frame,
    },
    {
      id: "core.mouse_position",
      name: "mouse_position",
      category: "core",
      description: "The mouse position over the viewer.",
      outputType: "point",
      outputRange: "value",
      ports: [{ name: "context", type: "context" }],
      fn: (ctx) => ctx.mouse,
    },
  ];
  return coreTypes.concat(N3_TYPE_DEFS.map((def) => {
    const fn = IMPLS[def.fn];
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      description: def.description,
      outputType: def.outputType === "shape" && def.category !== "corevector" ? "list" : def.outputType,
      outputRange: def.outputRange,
      ports: def.ports.map(({ n3Type, ...p }) => ({ ...p })),
      fn: fn || unsupported(`node function ${def.fn}`),
    };
  }));
}

/**
 * Build a NodeType for one of Cartan's script-function nodes ("canvas",
 * "scatter_even", …) from its ndbx port declaration. `spec` comes from
 * the converter: {function, name, outputType, outputRange, ports}.
 */
export function cartanFnType(spec) {
  const entry = CARTAN_FNS[spec.function];
  const needsContext = entry && (entry.impure || entry.context);
  // A spec may be based on a standard prototype whose function it
  // overrides (make_map = corevector.generator + treemap/squarify) —
  // the base contributes its ports and output metadata.
  const base = spec.base ? N3_TYPE_DEFS.find((t) => t.id === spec.base) : null;
  const ports = [...(needsContext ? [{ name: "context", type: "context" }] : [])];
  for (const p of (base && base.ports) || []) ports.push({ ...p });
  for (const p of spec.ports || []) {
    const existing = ports.find((q) => q.name === p.name);
    if (existing) Object.assign(existing, p);
    else ports.push(p);
  }
  return {
    id: spec.id,
    name: spec.name,
    category: "cartan-fn",
    description: spec.description || `Cartan script function ${spec.function}`,
    outputType: spec.outputType || (base && base.outputType) || "list",
    outputRange:
      spec.outputRange || (entry && entry.outputRange) || (base && base.outputRange) || "value",
    ports,
    // Wrapped so declared arity never exceeds the port count (some of
    // Cartan's function nodes declare fewer ports than the script takes),
    // and so list-range outputs are always actual arrays.
    fn: entry
      ? (...args) => {
          const raw = entry.fn(...args);
          const range = spec.outputRange || entry.outputRange || "value";
          if (range === "list" && !Array.isArray(raw)) return raw == null ? [] : [raw];
          return raw;
        }
      : unsupported(`script function ${spec.function}`),
  };
}
