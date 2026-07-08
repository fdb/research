// nodebox/core/graphics.js
// The graphics library: pure-data geometry primitives plus renderers.
//
// Design (see doc/DECISIONS.md):
// - Geometry is plain, deeply-frozen JSON data — no classes, no methods.
//   This mirrors NodeBox Java's "immutable by convention" Grob model and
//   NodeBox Live's g package, but makes the data directly serializable.
// - A Path is a flat list of commands (moveTo/lineTo/curveTo/close), like
//   g.js, rather than Java's Contour-of-typed-Points. Both are point
//   streams; commands map 1:1 onto Canvas2D and SVG path data.
// - Rendering is separate from the data: drawShape(ctx, shape) for
//   Canvas2D and toSVG(shape) for export. Nothing in here touches the DOM
//   except through the ctx you hand it.

/**
 * @typedef {Object} Point
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {Object} Color RGBA, all channels 0..1.
 * @property {number} r
 * @property {number} g
 * @property {number} b
 * @property {number} a
 */

/**
 * @typedef {Object} PathCommand
 * @property {'M'|'L'|'C'|'Z'} type
 * @property {number} [x] End point (M/L/C).
 * @property {number} [y]
 * @property {number} [x1] First control point (C).
 * @property {number} [y1]
 * @property {number} [x2] Second control point (C).
 * @property {number} [y2]
 */

/**
 * @typedef {Object} Path
 * @property {'path'} type
 * @property {PathCommand[]} commands
 * @property {Color|null} fill
 * @property {Color|null} stroke
 * @property {number} strokeWidth
 */

/**
 * @typedef {Object} Group
 * @property {'group'} type
 * @property {Shape[]} shapes
 */

/** @typedef {Path|Group} Shape */

/**
 * @typedef {Object} Rect
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/** @returns {Point} */
export function point(x, y) {
  return { x, y };
}

export const ZERO_POINT = Object.freeze(point(0, 0));

/**
 * @param {number} r @param {number} g @param {number} b @param {number} [a]
 * @returns {Color}
 */
export function color(r, g, b, a = 1) {
  return { r, g, b, a };
}

/** @returns {Color} */
export function grayColor(v, a = 1) {
  return color(v, v, v, a);
}

export const BLACK = Object.freeze(color(0, 0, 0));
export const WHITE = Object.freeze(color(1, 1, 1));
export const TRANSPARENT = Object.freeze(color(0, 0, 0, 0));

/**
 * HSB → RGB color. All inputs 0..1.
 * @returns {Color}
 */
export function hsbColor(h, s, b, a = 1) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = b * (1 - s);
  const q = b * (1 - f * s);
  const t = b * (1 - (1 - f) * s);
  const [r, g, bl] = [
    [b, t, p],
    [q, b, p],
    [p, b, t],
    [p, q, b],
    [t, p, b],
    [b, p, q],
  ][i % 6];
  return color(r, g, bl, a);
}

/**
 * Parse "#rgb", "#rrggbb" or "#rrggbbaa" into a Color.
 * @param {string} s
 * @returns {Color}
 */
export function parseColor(s) {
  let hex = String(s).trim().replace(/^#/, "");
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const n = parseInt(hex.padEnd(8, "f"), 16);
  return color(
    ((n >>> 24) & 255) / 255,
    ((n >>> 16) & 255) / 255,
    ((n >>> 8) & 255) / 255,
    (n & 255) / 255,
  );
}

/**
 * @param {Color|null} c
 * @returns {string} CSS color string.
 */
export function toCSS(c) {
  if (!c) return "transparent";
  const f = (v) => Math.round(clamp(v, 0, 1) * 255);
  return `rgba(${f(c.r)},${f(c.g)},${f(c.b)},${clamp(c.a, 0, 1)})`;
}

/** @returns {Rect} */
export function rect(x, y, width, height) {
  return { x, y, width, height };
}

/**
 * Make a Path from commands. Fill defaults to black, like NodeBox.
 * @param {PathCommand[]} commands
 * @param {{fill?: Color|null, stroke?: Color|null, strokeWidth?: number}} [style]
 * @returns {Path}
 */
export function makePath(commands, style = {}) {
  return {
    type: "path",
    commands,
    fill: style.fill === undefined ? BLACK : style.fill,
    stroke: style.stroke === undefined ? null : style.stroke,
    strokeWidth: style.strokeWidth === undefined ? 1 : style.strokeWidth,
  };
}

/**
 * @param {Shape[]} shapes
 * @returns {Group}
 */
export function makeGroup(shapes) {
  return { type: "group", shapes };
}

export const EMPTY_GROUP = Object.freeze(makeGroup(Object.freeze([])));

// ---------------------------------------------------------------------------
// Shape generators (center-based, like NodeBox Java's Path.rect/ellipse)
// ---------------------------------------------------------------------------

const KAPPA = 0.5522847498307936; // (4/3)(sqrt(2)-1): circle-from-Béziers

/**
 * Rectangle centered on (cx, cy).
 * @returns {Path}
 */
export function rectPath(cx, cy, width, height) {
  const w = width / 2;
  const h = height / 2;
  return makePath([
    { type: "M", x: cx - w, y: cy - h },
    { type: "L", x: cx + w, y: cy - h },
    { type: "L", x: cx + w, y: cy + h },
    { type: "L", x: cx - w, y: cy + h },
    { type: "Z" },
  ]);
}

/**
 * Ellipse centered on (cx, cy), built from four Bézier arcs.
 * @returns {Path}
 */
export function ellipsePath(cx, cy, width, height) {
  const rx = width / 2;
  const ry = height / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return makePath([
    { type: "M", x: cx + rx, y: cy },
    { type: "C", x1: cx + rx, y1: cy + ky, x2: cx + kx, y2: cy + ry, x: cx, y: cy + ry },
    { type: "C", x1: cx - kx, y1: cy + ry, x2: cx - rx, y2: cy + ky, x: cx - rx, y: cy },
    { type: "C", x1: cx - rx, y1: cy - ky, x2: cx - kx, y2: cy - ry, x: cx, y: cy - ry },
    { type: "C", x1: cx + kx, y1: cy - ry, x2: cx + rx, y2: cy - ky, x: cx + rx, y: cy },
    { type: "Z" },
  ]);
}

/**
 * Line from (x1,y1) to (x2,y2). Stroked by default — a filled line is
 * invisible.
 * @returns {Path}
 */
export function linePath(x1, y1, x2, y2) {
  return makePath(
    [
      { type: "M", x: x1, y: y1 },
      { type: "L", x: x2, y: y2 },
    ],
    { fill: null, stroke: BLACK, strokeWidth: 1 },
  );
}

/**
 * Regular polygon centered on (cx, cy).
 * @param {boolean} [align] Rotate so the first point is at the top.
 * @returns {Path}
 */
export function polygonPath(cx, cy, radius, sides, align = false) {
  const commands = [];
  const a0 = align ? -Math.PI / 2 : 0;
  for (let i = 0; i < sides; i++) {
    const a = a0 + (i * Math.PI * 2) / sides;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    commands.push({ type: i === 0 ? "M" : "L", x, y });
  }
  commands.push({ type: "Z" });
  return makePath(commands);
}

/**
 * Star centered on (cx, cy) with `points` spikes.
 * @returns {Path}
 */
export function starPath(cx, cy, points, outer, inner) {
  const commands = [{ type: "M", x: cx, y: cy - outer / 2 }];
  for (let i = 1; i < points * 2; i++) {
    const a = (i * Math.PI) / points - Math.PI / 2;
    const r = (i % 2 === 0 ? outer : inner) / 2;
    commands.push({ type: "L", x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  commands.push({ type: "Z" });
  return makePath(commands);
}

/**
 * Elliptical arc / pie / chord centered on (cx, cy). Angles in degrees.
 * @param {'pie'|'chord'|'open'} [arcType]
 * @returns {Path}
 */
export function arcPath(cx, cy, width, height, startAngle, degrees, arcType = "pie") {
  const rx = width / 2;
  const ry = height / 2;
  const steps = Math.max(2, Math.ceil(Math.abs(degrees) / 45));
  const a0 = (startAngle * Math.PI) / 180;
  const da = ((degrees / steps) * Math.PI) / 180;
  const commands = [];
  const pt = (a) => ({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  if (arcType === "pie") commands.push({ type: "M", x: cx, y: cy }, { type: "L", ...pt(a0) });
  else commands.push({ type: "M", ...pt(a0) });
  for (let i = 0; i < steps; i++) {
    const a1 = a0 + i * da;
    const a2 = a1 + da;
    // Bézier approximation of an elliptical arc segment.
    const t = (4 / 3) * Math.tan((a2 - a1) / 4);
    const p1 = pt(a1);
    const p2 = pt(a2);
    commands.push({
      type: "C",
      x1: p1.x - t * rx * Math.sin(a1),
      y1: p1.y + t * ry * Math.cos(a1),
      x2: p2.x + t * rx * Math.sin(a2),
      y2: p2.y - t * ry * Math.cos(a2),
      x: p2.x,
      y: p2.y,
    });
  }
  if (arcType !== "open") commands.push({ type: "Z" });
  return makePath(commands);
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Transform 2D affine matrix, Canvas2D layout:
 *   [a c tx]
 *   [b d ty]
 * @property {number} a @property {number} b @property {number} c
 * @property {number} d @property {number} tx @property {number} ty
 */

/** @type {Transform} */
export const IDENTITY = Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

/** Multiply two transforms: t1 ∘ t2 (t2 applies first, then t1). @returns {Transform} */
export function compose(t1, t2) {
  return {
    a: t2.a * t1.a + t2.b * t1.c,
    b: t2.a * t1.b + t2.b * t1.d,
    c: t2.c * t1.a + t2.d * t1.c,
    d: t2.c * t1.b + t2.d * t1.d,
    tx: t2.tx * t1.a + t2.ty * t1.c + t1.tx,
    ty: t2.tx * t1.b + t2.ty * t1.d + t1.ty,
  };
}

/** @returns {Transform} */
export function translation(tx, ty) {
  return { a: 1, b: 0, c: 0, d: 1, tx, ty };
}

/** @param {number} degrees @returns {Transform} */
export function rotation(degrees) {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 };
}

/** @returns {Transform} */
export function scaling(sx, sy = sx) {
  return { a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 };
}

/** @param {number} kx degrees @param {number} ky degrees @returns {Transform} */
export function skewing(kx, ky) {
  return {
    a: 1,
    b: Math.tan((ky * Math.PI) / 180),
    c: Math.tan((kx * Math.PI) / 180),
    d: 1,
    tx: 0,
    ty: 0,
  };
}

/** @param {Transform} t @param {Point} p @returns {Point} */
export function transformPoint(t, p) {
  return { x: t.a * p.x + t.c * p.y + t.tx, y: t.b * p.x + t.d * p.y + t.ty };
}

/**
 * Apply a transform to a shape (or point), returning a new shape.
 * @param {Transform} t
 * @param {Shape|Point} shape
 * @returns {Shape|Point}
 */
export function transformShape(t, shape) {
  if (isPoint(shape)) return transformPoint(t, shape);
  if (shape.type === "group") {
    return makeGroup(shape.shapes.map((s) => transformShape(t, s)));
  }
  const commands = shape.commands.map((cmd) => {
    if (cmd.type === "Z") return cmd;
    const out = { ...cmd, ...transformPoint(t, cmd) };
    if (cmd.type === "C") {
      const c1 = transformPoint(t, { x: cmd.x1, y: cmd.y1 });
      const c2 = transformPoint(t, { x: cmd.x2, y: cmd.y2 });
      out.x1 = c1.x;
      out.y1 = c1.y;
      out.x2 = c2.x;
      out.y2 = c2.y;
    }
    return out;
  });
  return { ...shape, commands };
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/** @param {*} v @returns {v is Point} */
export function isPoint(v) {
  return (
    v != null &&
    typeof v === "object" &&
    typeof v.x === "number" &&
    typeof v.y === "number" &&
    v.type === undefined
  );
}

/** @param {*} v @returns {v is Shape} */
export function isShape(v) {
  return v != null && typeof v === "object" && (v.type === "path" || v.type === "group");
}

/** @param {*} v @returns {v is Color} */
export function isColor(v) {
  return (
    v != null &&
    typeof v === "object" &&
    typeof v.r === "number" &&
    typeof v.g === "number" &&
    typeof v.b === "number" &&
    typeof v.a === "number"
  );
}

/**
 * Bounding box of a shape or point (control points included for curves —
 * same approximation NodeBox Java uses for speed).
 * @param {Shape|Point|null} shape
 * @returns {Rect}
 */
export function bounds(shape) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const walk = (s) => {
    if (s == null) return;
    if (isPoint(s)) add(s.x, s.y);
    else if (s.type === "group") s.shapes.forEach(walk);
    else if (s.type === "path") {
      for (const cmd of s.commands) {
        if (cmd.type === "Z") continue;
        add(cmd.x, cmd.y);
        if (cmd.type === "C") {
          add(cmd.x1, cmd.y1);
          add(cmd.x2, cmd.y2);
        }
      }
    }
  };
  walk(shape);
  if (minX === Infinity) return rect(0, 0, 0, 0);
  return rect(minX, minY, maxX - minX, maxY - minY);
}

/** Center of a shape's bounding box. @returns {Point} */
export function centroid(shape) {
  const b = bounds(shape);
  return point(b.x + b.width / 2, b.y + b.height / 2);
}

// ---------------------------------------------------------------------------
// Path sampling (resample / point-on-path / scatter need these)
// ---------------------------------------------------------------------------

/**
 * Flatten a path into polyline segments: arrays of points, one per
 * subpath. Curves are subdivided adaptively (fixed 16 steps — plenty for
 * sampling purposes).
 * @param {Path} path
 * @returns {Point[][]}
 */
export function flattenPath(path) {
  const subpaths = [];
  let current = [];
  let start = null;
  let prev = null;
  for (const cmd of path.commands) {
    if (cmd.type === "M") {
      if (current.length > 1) subpaths.push(current);
      current = [{ x: cmd.x, y: cmd.y }];
      start = { x: cmd.x, y: cmd.y };
      prev = start;
    } else if (cmd.type === "L") {
      current.push({ x: cmd.x, y: cmd.y });
      prev = { x: cmd.x, y: cmd.y };
    } else if (cmd.type === "C") {
      const STEPS = 16;
      for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS;
        current.push(bezierPoint(prev, cmd, t));
      }
      prev = { x: cmd.x, y: cmd.y };
    } else if (cmd.type === "Z" && start && prev) {
      if (prev.x !== start.x || prev.y !== start.y) current.push({ ...start });
    }
  }
  if (current.length > 1) subpaths.push(current);
  return subpaths;
}

function bezierPoint(p0, cmd, t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * cmd.x1 + c * cmd.x2 + d * cmd.x,
    y: a * p0.y + b * cmd.y1 + c * cmd.y2 + d * cmd.y,
  };
}

/** Total length of a path (flattened). @returns {number} */
export function pathLength(path) {
  let len = 0;
  for (const sub of flattenPath(path)) {
    for (let i = 1; i < sub.length; i++) len += dist(sub[i - 1], sub[i]);
  }
  return len;
}

function dist(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Point at parameter t (0..1) along a path's flattened length.
 * @param {Path} path @param {number} t
 * @returns {Point & {angle: number}} Point plus tangent angle in degrees.
 */
export function pointAt(path, t) {
  const subs = flattenPath(path);
  const segments = [];
  let total = 0;
  for (const sub of subs) {
    for (let i = 1; i < sub.length; i++) {
      const l = dist(sub[i - 1], sub[i]);
      segments.push({ p1: sub[i - 1], p2: sub[i], length: l });
      total += l;
    }
  }
  if (segments.length === 0) return { x: 0, y: 0, angle: 0 };
  let target = clamp(t, 0, 1) * total;
  for (const seg of segments) {
    if (target <= seg.length || seg === segments[segments.length - 1]) {
      const u = seg.length === 0 ? 0 : clamp(target / seg.length, 0, 1);
      return {
        x: seg.p1.x + (seg.p2.x - seg.p1.x) * u,
        y: seg.p1.y + (seg.p2.y - seg.p1.y) * u,
        angle: (Math.atan2(seg.p2.y - seg.p1.y, seg.p2.x - seg.p1.x) * 180) / Math.PI,
      };
    }
    target -= seg.length;
  }
  const last = segments[segments.length - 1];
  return { x: last.p2.x, y: last.p2.y, angle: 0 };
}

/**
 * Resample a path into `amount` evenly spaced points.
 * @returns {Point[]}
 */
export function makePoints(path, amount) {
  const pts = [];
  if (amount <= 0) return pts;
  for (let i = 0; i < amount; i++) {
    const { x, y } = pointAt(path, amount === 1 ? 0 : i / (amount - 1));
    pts.push({ x, y });
  }
  return pts;
}

/**
 * All anchor points of a shape (recursively; control points excluded).
 * @param {Shape|Point} shape
 * @returns {Point[]}
 */
export function shapePoints(shape) {
  if (isPoint(shape)) return [shape];
  if (shape.type === "group") return shape.shapes.flatMap(shapePoints);
  return shape.commands.filter((c) => c.type !== "Z").map((c) => ({ x: c.x, y: c.y }));
}

/**
 * Point-in-shape test (even-odd on the flattened outline).
 * @param {Shape} shape @param {Point} p
 * @returns {boolean}
 */
export function containsPoint(shape, p) {
  if (shape.type === "group") return shape.shapes.some((s) => containsPoint(s, p));
  let inside = false;
  for (const sub of flattenPath(shape)) {
    for (let i = 0, j = sub.length - 1; i < sub.length; j = i++) {
      const a = sub[i];
      const b = sub[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Rendering: Canvas2D
// ---------------------------------------------------------------------------

/**
 * Draw any value the evaluator can produce. Shapes render as geometry;
 * bare points render as small circles (like NodeBox's PointVisualizer);
 * colors render as swatches.
 * @param {CanvasRenderingContext2D} ctx
 * @param {*} value
 */
export function drawValue(ctx, value, index = 0) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => drawValue(ctx, v, i));
  } else if (isShape(value)) {
    drawShape(ctx, value);
  } else if (isPoint(value)) {
    ctx.beginPath();
    ctx.arc(value.x, value.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#4a90d9";
    ctx.fill();
  } else if (isColor(value)) {
    ctx.fillStyle = toCSS(value);
    ctx.fillRect(index * 34 - 100, -100, 30, 30);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Shape} shape
 */
export function drawShape(ctx, shape) {
  if (isPoint(shape)) {
    // Groups may hold bare points (e.g. group after grid).
    ctx.beginPath();
    ctx.arc(shape.x, shape.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#4a90d9";
    ctx.fill();
    return;
  }
  if (shape.type === "group") {
    for (const s of shape.shapes) drawShape(ctx, s);
    return;
  }
  ctx.beginPath();
  tracePath(ctx, shape);
  if (shape.fill) {
    ctx.fillStyle = toCSS(shape.fill);
    ctx.fill();
  }
  if (shape.stroke && shape.strokeWidth > 0) {
    ctx.strokeStyle = toCSS(shape.stroke);
    ctx.lineWidth = shape.strokeWidth;
    ctx.stroke();
  }
}

function tracePath(ctx, path) {
  for (const cmd of path.commands) {
    switch (cmd.type) {
      case "M":
        ctx.moveTo(cmd.x, cmd.y);
        break;
      case "L":
        ctx.lineTo(cmd.x, cmd.y);
        break;
      case "C":
        ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
        break;
      case "Z":
        ctx.closePath();
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering: SVG export
// ---------------------------------------------------------------------------

/**
 * SVG path data ("d" attribute) for a Path.
 * @param {Path} path
 * @returns {string}
 */
export function toPathData(path) {
  const f = (n) => +n.toFixed(3);
  return path.commands
    .map((cmd) => {
      switch (cmd.type) {
        case "M":
          return `M${f(cmd.x)},${f(cmd.y)}`;
        case "L":
          return `L${f(cmd.x)},${f(cmd.y)}`;
        case "C":
          return `C${f(cmd.x1)},${f(cmd.y1)} ${f(cmd.x2)},${f(cmd.y2)} ${f(cmd.x)},${f(cmd.y)}`;
        case "Z":
          return "Z";
      }
    })
    .join(" ");
}

/**
 * Render a value (shape / point / list) to a complete standalone SVG
 * document string.
 * @param {*} value
 * @param {{width?: number, height?: number}} [options] Canvas size;
 *   the viewBox is centered on the origin like the NodeBox canvas.
 * @returns {string}
 */
export function toSVG(value, options = {}) {
  const width = options.width || 1000;
  const height = options.height || 1000;
  const body = svgFragment(value);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="${-width / 2} ${-height / 2} ${width} ${height}">\n${body}\n</svg>`
  );
}

function svgFragment(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(svgFragment).filter(Boolean).join("\n");
  if (isPoint(value)) return `<circle cx="${value.x}" cy="${value.y}" r="2.5" fill="#4a90d9"/>`;
  if (!isShape(value)) return "";
  if (value.type === "group") return svgFragment(value.shapes);
  const fill = value.fill ? toCSS(value.fill) : "none";
  const stroke = value.stroke
    ? ` stroke="${toCSS(value.stroke)}" stroke-width="${value.strokeWidth}"`
    : "";
  return `<path d="${toPathData(value)}" fill="${fill}"${stroke}/>`;
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** @returns {number} */
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/**
 * Deterministic seeded RNG (mulberry32). Every stochastic node takes an
 * explicit seed port, exactly like NodeBox Java's MathUtils.randomFromSeed.
 * @param {number} seed
 * @returns {() => number} Function yielding floats in [0, 1).
 */
export function randomFromSeed(seed) {
  let s = (Math.imul(seed | 0, 0x9e3779b9) ^ 0x85ebca6b) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
