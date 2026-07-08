// nodebox/core/stdlib.js
// The built-in node library — a curated port of the classic NodeBox
// libraries (corevector, math, list, string, color, core). Every node is
// (metadata + typed ports + a plain pure function); the evaluator's
// list-matching does the looping, so none of these functions ever see a
// list unless a port declares range 'list'.

import * as g from "./graphics.js";

// Port shorthands.
const F = (name, value = 0, extra = {}) => ({ name, type: "float", value, ...extra });
const I = (name, value = 0, extra = {}) => ({ name, type: "int", value, ...extra });
const S = (name, value = "", extra = {}) => ({ name, type: "string", value, ...extra });
const B = (name, value = false, extra = {}) => ({ name, type: "boolean", value, ...extra });
const P = (name, value = { x: 0, y: 0 }, extra = {}) => ({ name, type: "point", value, ...extra });
const C = (name, value = { r: 0, g: 0, b: 0, a: 1 }, extra = {}) => ({
  name,
  type: "color",
  value,
  ...extra,
});
const SHAPE = (name = "shape", extra = {}) => ({ name, type: "shape", value: null, ...extra });
const LIST = (name = "list", extra = {}) => ({
  name,
  type: "list",
  range: "list",
  value: null,
  ...extra,
});
const SEED = (name = "seed") => I(name, 0, { widget: "seed" });
const MENU = (name, value, items) => ({
  name,
  type: "string",
  value,
  widget: "menu",
  menu: items.map((k) => ({ key: k, label: k.replace(/_/g, " ") })),
});
const CONTEXT = { name: "context", type: "context" };

const def = (id, description, outputType, ports, fn, extra = {}) => ({
  id,
  name: id.split(".")[1],
  category: id.split(".")[0],
  description,
  outputType,
  outputRange: "value",
  ports,
  fn,
  ...extra,
});
const defList = (id, description, outputType, ports, fn, extra = {}) =>
  def(id, description, outputType, ports, fn, { outputRange: "list", ...extra });

const notNull = (list) => (list || []).filter((v) => v != null);

// ---------------------------------------------------------------------------
// core — external state flows in exclusively through 'context' ports,
// which also mark a node (and everything downstream) as uncacheable.
// ---------------------------------------------------------------------------

export const coreNodes = [
  def("core.frame", "The current animation frame.", "float", [CONTEXT], (ctx) => ctx.frame),
  def(
    "core.mouse_position",
    "The mouse position over the viewer.",
    "point",
    [CONTEXT],
    (ctx) => ctx.mouse,
  ),
];

// ---------------------------------------------------------------------------
// corevector — geometry
// ---------------------------------------------------------------------------

export const vectorNodes = [
  def(
    "corevector.rect",
    "Create a rectangle.",
    "shape",
    [P("position"), F("width", 100, { min: 0 }), F("height", 100, { min: 0 })],
    (position, width, height) => g.rectPath(position.x, position.y, width, height),
  ),
  def(
    "corevector.ellipse",
    "Create an ellipse.",
    "shape",
    [P("position"), F("width", 100, { min: 0 }), F("height", 100, { min: 0 })],
    (position, width, height) => g.ellipsePath(position.x, position.y, width, height),
  ),
  def(
    "corevector.line",
    "Create a line between two points.",
    "shape",
    [P("point1"), P("point2", { x: 100, y: 100 })],
    (p1, p2) => g.linePath(p1.x, p1.y, p2.x, p2.y),
  ),
  def(
    "corevector.line_angle",
    "Create a line from a point, angle and distance.",
    "shape",
    [P("position"), F("angle"), F("distance", 100)],
    (position, angle, distance) => {
      const r = (angle * Math.PI) / 180;
      return g.linePath(
        position.x,
        position.y,
        position.x + Math.cos(r) * distance,
        position.y + Math.sin(r) * distance,
      );
    },
  ),
  def(
    "corevector.polygon",
    "Create a regular polygon.",
    "shape",
    [P("position"), F("radius", 100), I("sides", 3, { min: 3 }), B("align")],
    (position, radius, sides, align) => g.polygonPath(position.x, position.y, radius, sides, align),
  ),
  def(
    "corevector.star",
    "Create a star shape.",
    "shape",
    [P("position"), I("points", 20, { min: 1 }), F("outer", 200), F("inner", 100)],
    (position, points, outer, inner) => g.starPath(position.x, position.y, points, outer, inner),
  ),
  def(
    "corevector.arc",
    "Create an arc, pie or chord.",
    "shape",
    [
      P("position"),
      F("width", 100),
      F("height", 100),
      F("start_angle"),
      F("degrees", 45),
      MENU("type", "pie", ["pie", "chord", "open"]),
    ],
    (position, width, height, startAngle, degrees, type) =>
      g.arcPath(position.x, position.y, width, height, startAngle, degrees, type),
  ),
  defList(
    "corevector.grid",
    "Create a grid of points.",
    "point",
    [
      I("columns", 10, { min: 1 }),
      I("rows", 10, { min: 1 }),
      F("width", 300),
      F("height", 300),
      P("position"),
    ],
    (columns, rows, width, height, position) => {
      const points = [];
      const dx = columns > 1 ? width / (columns - 1) : 0;
      const dy = rows > 1 ? height / (rows - 1) : 0;
      const x0 = position.x - (columns > 1 ? width / 2 : 0);
      const y0 = position.y - (rows > 1 ? height / 2 : 0);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
          points.push({ x: x0 + x * dx, y: y0 + y * dy });
        }
      }
      return points;
    },
  ),
  def(
    "corevector.colorize",
    "Change a shape's fill and stroke.",
    "shape",
    [SHAPE(), C("fill"), C("stroke"), F("stroke_width", 0, { min: 0 })],
    (shape, fill, stroke, strokeWidth) =>
      mapPaths(shape, (p) => ({ ...p, fill, stroke: strokeWidth > 0 ? stroke : null, strokeWidth })),
  ),
  def(
    "corevector.translate",
    "Move a shape.",
    "shape",
    [SHAPE(), P("translate")],
    (shape, translate) => g.transformShape(g.translation(translate.x, translate.y), shape),
  ),
  def(
    "corevector.rotate",
    "Rotate a shape around the origin.",
    "shape",
    [SHAPE(), F("angle")],
    (shape, angle) => g.transformShape(g.rotation(angle), shape),
  ),
  def(
    "corevector.scale",
    "Scale a shape (percent) from the origin.",
    "shape",
    [SHAPE(), P("scale", { x: 100, y: 100 })],
    (shape, scale) => g.transformShape(g.scaling(scale.x / 100, scale.y / 100), shape),
  ),
  def(
    "corevector.skew",
    "Skew a shape (degrees) from the origin.",
    "shape",
    [SHAPE(), P("skew")],
    (shape, skew) => g.transformShape(g.skewing(skew.x, skew.y), shape),
  ),
  defList(
    "corevector.copy",
    "Make copies of a shape, accumulating a transform per copy.",
    "shape",
    [
      SHAPE(),
      I("copies", 1, { min: 1 }),
      P("translate"),
      F("rotate"),
      P("scale", { x: 100, y: 100 }),
    ],
    (shape, copies, translate, rotate, scale) => {
      // Each copy transforms the previous one: scale, then rotate, then
      // translate (Java CoreVectorFunctions.copy).
      const delta = g.compose(
        g.translation(translate.x, translate.y),
        g.compose(g.rotation(rotate), g.scaling(scale.x / 100, scale.y / 100)),
      );
      const out = [];
      let s = shape;
      for (let i = 0; i < copies; i++) {
        out.push(s);
        s = g.transformShape(delta, s);
      }
      return out;
    },
  ),
  def(
    "corevector.align",
    "Align a shape relative to a point.",
    "shape",
    [
      SHAPE(),
      P("position"),
      MENU("halign", "center", ["none", "left", "center", "right"]),
      MENU("valign", "middle", ["none", "top", "middle", "bottom"]),
    ],
    (shape, position, halign, valign) => {
      const b = g.bounds(shape);
      let dx = 0;
      let dy = 0;
      if (halign === "left") dx = position.x - b.x;
      else if (halign === "center") dx = position.x - b.x - b.width / 2;
      else if (halign === "right") dx = position.x - b.x - b.width;
      if (valign === "top") dy = position.y - b.y;
      else if (valign === "middle") dy = position.y - b.y - b.height / 2;
      else if (valign === "bottom") dy = position.y - b.y - b.height;
      return g.transformShape(g.translation(dx, dy), shape);
    },
  ),
  def(
    "corevector.fit",
    "Scale and center a shape within given bounds.",
    "shape",
    [SHAPE(), P("position"), F("width", 300, { min: 0 }), F("height", 300, { min: 0 }), B("keep_proportions", true)],
    (shape, position, width, height, keepProportions) => {
      const b = g.bounds(shape);
      let sx = b.width > 0 ? width / b.width : 1;
      let sy = b.height > 0 ? height / b.height : 1;
      if (keepProportions) sx = sy = Math.min(sx, sy);
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const t = g.compose(
        g.translation(position.x, position.y),
        g.compose(g.scaling(sx, sy), g.translation(-cx, -cy)),
      );
      return g.transformShape(t, shape);
    },
  ),
  def(
    "corevector.reflect",
    "Mirror a shape across a line.",
    "shape",
    [SHAPE(), P("position"), F("angle", 90), B("keep_original", true)],
    (shape, position, angle, keepOriginal) => {
      const t = [
        g.translation(position.x, position.y),
        g.rotation(angle),
        g.scaling(1, -1),
        g.rotation(-angle),
        g.translation(-position.x, -position.y),
      ].reduce(g.compose);
      const mirrored = g.transformShape(t, shape);
      return keepOriginal ? g.makeGroup([shape, mirrored]) : mirrored;
    },
  ),
  defList(
    "corevector.scatter",
    "Generate random points inside a shape.",
    "point",
    [SHAPE(), I("amount", 20, { min: 0 }), SEED()],
    (shape, amount, seed) => {
      if (!shape) return [];
      const rand = g.randomFromSeed(seed);
      const b = g.bounds(shape);
      const points = [];
      let tries = 0;
      while (points.length < amount && tries < amount * 100) {
        const p = { x: b.x + rand() * b.width, y: b.y + rand() * b.height };
        if (g.isPoint(shape) || g.containsPoint(shape, p)) points.push(p);
        tries++;
      }
      return points;
    },
  ),
  def(
    "corevector.wiggle",
    "Randomly offset a shape's points or paths.",
    "shape",
    [SHAPE(), MENU("scope", "points", ["points", "paths"]), P("offset", { x: 10, y: 10 }), SEED()],
    (shape, scope, offset, seed) => {
      const rand = g.randomFromSeed(seed);
      const delta = () => ({
        x: (rand() - 0.5) * 2 * offset.x,
        y: (rand() - 0.5) * 2 * offset.y,
      });
      const wigglePath = (path) => {
        if (scope === "paths") {
          const d = delta();
          return g.transformShape(g.translation(d.x, d.y), path);
        }
        const commands = path.commands.map((cmd) => {
          if (cmd.type === "Z") return cmd;
          const d = delta();
          const out = { ...cmd, x: cmd.x + d.x, y: cmd.y + d.y };
          if (cmd.type === "C") {
            out.x2 += d.x;
            out.y2 += d.y;
          }
          return out;
        });
        return { ...path, commands };
      };
      const walk = (s) => {
        if (g.isPoint(s)) {
          const d = delta();
          return { x: s.x + d.x, y: s.y + d.y };
        }
        if (s.type === "group") return g.makeGroup(s.shapes.map(walk));
        return wigglePath(s);
      };
      return shape ? walk(shape) : null;
    },
  ),
  def(
    "corevector.resample",
    "Rebuild a shape from evenly spaced points along it.",
    "shape",
    [SHAPE(), I("points", 20, { min: 2 }), B("closed", true)],
    (shape, points, closed) => {
      const resamplePath = (path) => {
        const pts = g.makePoints(path, closed ? points + 1 : points);
        if (closed && pts.length > 1) pts.pop(); // last == first
        const commands = pts.map((p, i) => ({ type: i === 0 ? "M" : "L", x: p.x, y: p.y }));
        if (closed) commands.push({ type: "Z" });
        return { ...path, commands };
      };
      const walk = (s) =>
        s.type === "group" ? g.makeGroup(s.shapes.map(walk)) : resamplePath(s);
      return shape ? walk(shape) : null;
    },
  ),
  def(
    "corevector.snap",
    "Snap a shape's points to a grid.",
    "shape",
    [SHAPE(), F("distance", 10, { min: 1 }), F("strength", 100, { min: 0, max: 100 }), P("position")],
    (shape, distance, strength, position) => {
      const k = strength / 100;
      const snapV = (v, origin) =>
        v + (Math.round((v - origin) / distance) * distance + origin - v) * k;
      const snapPath = (path) => ({
        ...path,
        commands: path.commands.map((cmd) => {
          if (cmd.type === "Z") return cmd;
          const out = { ...cmd, x: snapV(cmd.x, position.x), y: snapV(cmd.y, position.y) };
          if (cmd.type === "C") {
            out.x1 = snapV(cmd.x1, position.x);
            out.y1 = snapV(cmd.y1, position.y);
            out.x2 = snapV(cmd.x2, position.x);
            out.y2 = snapV(cmd.y2, position.y);
          }
          return out;
        }),
      });
      const walk = (s) => {
        if (g.isPoint(s)) return { x: snapV(s.x, position.x), y: snapV(s.y, position.y) };
        if (s.type === "group") return g.makeGroup(s.shapes.map(walk));
        return snapPath(s);
      };
      return shape ? walk(shape) : null;
    },
  ),
  def(
    "corevector.connect",
    "Connect a list of points into a path.",
    "shape",
    [{ ...P("points"), range: "list" }, B("closed", true)],
    (points, closed) => {
      const pts = notNull(points);
      if (pts.length < 2) return null;
      const commands = pts.map((p, i) => ({ type: i === 0 ? "M" : "L", x: p.x, y: p.y }));
      if (closed) commands.push({ type: "Z" });
      return g.makePath(commands, { fill: null, stroke: g.BLACK, strokeWidth: 1 });
    },
  ),
  def(
    "corevector.point_on_path",
    "A point at a position along a path (t in %).",
    "point",
    [SHAPE(), F("t", 0)],
    (shape, t) => {
      if (!shape) return null;
      const path = firstPath(shape);
      if (!path) return null;
      const wrapped = (((t / 100) % 1) + 1) % 1;
      const p = g.pointAt(path, wrapped);
      return { x: p.x, y: p.y };
    },
  ),
  def("corevector.centroid", "The center point of a shape.", "point", [SHAPE()], (shape) =>
    shape ? g.centroid(shape) : null,
  ),
  def(
    "corevector.group",
    "Group a list of shapes into one shape.",
    "shape",
    [{ name: "shapes", type: "shape", range: "list", value: null }],
    (shapes) => g.makeGroup(notNull(shapes)),
  ),
  defList(
    "corevector.ungroup",
    "Split a group into its child shapes.",
    "shape",
    [SHAPE()],
    (shape) => (shape && shape.type === "group" ? shape.shapes : shape ? [shape] : []),
  ),
  def("corevector.null", "Pass the input through unchanged.", "shape", [SHAPE()], (shape) => shape),
  def(
    "corevector.make_point",
    "Create a point from x and y.",
    "point",
    [F("x"), F("y")],
    (x, y) => ({ x, y }),
  ),
];

/** Apply fn to every Path in a shape tree (points pass through). */
function mapPaths(shape, fn) {
  if (shape == null) return null;
  if (g.isPoint(shape)) return shape;
  if (shape.type === "group") return g.makeGroup(shape.shapes.map((s) => mapPaths(s, fn)));
  return fn(shape);
}

function firstPath(shape) {
  if (shape == null || g.isPoint(shape)) return null;
  if (shape.type === "path") return shape;
  for (const s of shape.shapes) {
    const p = firstPath(s);
    if (p) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// math
// ---------------------------------------------------------------------------

const wrapAngle = (v) => (v * Math.PI) / 180;

export const mathNodes = [
  def("math.number", "A constant number.", "float", [F("value")], (value) => value),
  def("math.add", "v1 + v2", "float", [F("v1"), F("v2")], (a, b) => a + b),
  def("math.subtract", "v1 − v2", "float", [F("v1"), F("v2")], (a, b) => a - b),
  def("math.multiply", "v1 × v2", "float", [F("v1"), F("v2", 1)], (a, b) => a * b),
  def("math.divide", "v1 ÷ v2", "float", [F("v1"), F("v2", 1)], (a, b) => (b === 0 ? 0 : a / b)),
  def("math.mod", "v1 mod v2", "float", [F("v1"), F("v2", 1)], (a, b) => (b === 0 ? 0 : ((a % b) + b) % b)),
  def("math.abs", "Absolute value.", "float", [F("value")], Math.abs),
  def("math.negate", "Flip the sign.", "float", [F("value")], (v) => -v),
  def("math.round", "Round to the nearest integer.", "int", [F("value")], Math.round),
  def("math.floor", "Round down.", "int", [F("value")], Math.floor),
  def("math.ceil", "Round up.", "int", [F("value")], Math.ceil),
  def("math.sqrt", "Square root.", "float", [F("value", 0, { min: 0 })], Math.sqrt),
  def("math.pow", "value raised to exponent.", "float", [F("value"), F("exponent", 2)], Math.pow),
  def("math.sin", "Sine of an angle in degrees.", "float", [F("angle")], (a) => Math.sin(wrapAngle(a))),
  def("math.cos", "Cosine of an angle in degrees.", "float", [F("angle")], (a) => Math.cos(wrapAngle(a))),
  def("math.min", "The smaller of two values.", "float", [F("v1"), F("v2")], Math.min),
  def("math.max", "The larger of two values.", "float", [F("v1"), F("v2")], Math.max),
  def(
    "math.distance",
    "Distance between two points.",
    "float",
    [P("point1"), P("point2")],
    (p1, p2) => Math.hypot(p2.x - p1.x, p2.y - p1.y),
  ),
  def(
    "math.angle",
    "Angle between two points, in degrees.",
    "float",
    [P("point1"), P("point2")],
    (p1, p2) => (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI,
  ),
  def(
    "math.coordinates",
    "A point from a start point, angle and distance.",
    "point",
    [P("position"), F("angle"), F("distance", 100)],
    (position, angle, distance) => ({
      x: position.x + Math.cos(wrapAngle(angle)) * distance,
      y: position.y + Math.sin(wrapAngle(angle)) * distance,
    }),
  ),
  def(
    "math.convert_range",
    "Map a value from one range to another.",
    "float",
    [
      F("value"),
      F("source_start"),
      F("source_end", 100),
      F("target_start"),
      F("target_end", 1),
      MENU("overflow", "clamp", ["ignore", "clamp"]),
    ],
    (value, s0, s1, t0, t1, overflow) => {
      let t = s1 === s0 ? 0 : (value - s0) / (s1 - s0);
      if (overflow === "clamp") t = g.clamp(t, 0, 1);
      return t0 + t * (t1 - t0);
    },
  ),
  def(
    "math.wave",
    "An oscillating value — drive the offset with a frame node.",
    "float",
    [
      F("min"),
      F("max", 100),
      F("period", 120, { min: 0.001 }),
      F("offset"),
      MENU("type", "sine", ["sine", "square", "triangle", "sawtooth"]),
    ],
    (min, max, period, offset, type) => {
      const t = (((offset / period) % 1) + 1) % 1;
      let v;
      switch (type) {
        case "square":
          v = t < 0.5 ? 0 : 1;
          break;
        case "triangle":
          v = t < 0.5 ? t * 2 : 2 - t * 2;
          break;
        case "sawtooth":
          v = t;
          break;
        default:
          v = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
      }
      return min + v * (max - min);
    },
  ),
  defList(
    "math.random_numbers",
    "A list of random numbers.",
    "float",
    [I("amount", 10, { min: 0 }), F("start"), F("end", 100), SEED()],
    (amount, start, end, seed) => {
      const rand = g.randomFromSeed(seed);
      return Array.from({ length: amount }, () => start + rand() * (end - start));
    },
  ),
  defList(
    "math.range",
    "Numbers from start to end (exclusive) by step.",
    "float",
    [F("start"), F("end", 10), F("step", 1)],
    (start, end, step) => {
      if (step === 0 || (end - start) / step < 0) return [];
      const out = [];
      for (let v = start; step > 0 ? v < end : v > end; v += step) {
        out.push(v);
        if (out.length > 100000) break; // runaway guard
      }
      return out;
    },
  ),
  defList(
    "math.sample",
    "Evenly spaced numbers between start and end (inclusive).",
    "float",
    [I("amount", 10, { min: 0 }), F("start"), F("end", 100)],
    (amount, start, end) => {
      if (amount === 0) return [];
      if (amount === 1) return [start + (end - start) / 2];
      const step = (end - start) / (amount - 1);
      return Array.from({ length: amount }, (_, i) => start + i * step);
    },
  ),
  defList(
    "math.make_numbers",
    "Parse numbers out of a string.",
    "float",
    [S("string", "1 2 3 4 5"), S("separator", " ")],
    (s, separator) =>
      s
        .split(separator || " ")
        .map(parseFloat)
        .filter((v) => !Number.isNaN(v)),
  ),
  def(
    "math.sum",
    "Sum of a list of numbers.",
    "float",
    [{ ...F("numbers"), range: "list" }],
    (numbers) => notNull(numbers).reduce((a, b) => a + b, 0),
  ),
  def(
    "math.average",
    "Average of a list of numbers.",
    "float",
    [{ ...F("numbers"), range: "list" }],
    (numbers) => {
      const list = notNull(numbers);
      return list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) / list.length;
    },
  ),
];

// ---------------------------------------------------------------------------
// list — every data port here is list-range: these nodes reshape lists
// instead of being mapped over them.
// ---------------------------------------------------------------------------

export const listNodes = [
  def("list.count", "The number of items in a list.", "int", [LIST()], (list) => notNull(list).length),
  def("list.first", "The first item.", "list", [LIST()], (list) => notNull(list)[0]),
  def("list.last", "The last item.", "list", [LIST()], (list) => notNull(list).slice(-1)[0]),
  defList("list.rest", "All but the first item.", "list", [LIST()], (list) => notNull(list).slice(1)),
  defList(
    "list.combine",
    "Concatenate up to three lists.",
    "list",
    [LIST("list1"), LIST("list2"), LIST("list3")],
    (l1, l2, l3) => [...notNull(l1), ...notNull(l2), ...notNull(l3)],
  ),
  defList("list.reverse", "Reverse a list.", "list", [LIST()], (list) => notNull(list).slice().reverse()),
  defList(
    "list.repeat",
    "Repeat a list a number of times.",
    "list",
    [LIST(), I("amount", 2, { min: 0 }), B("per_item")],
    (list, amount, perItem) => {
      const src = notNull(list);
      const out = [];
      if (perItem) for (const v of src) for (let i = 0; i < amount; i++) out.push(v);
      else for (let i = 0; i < amount; i++) out.push(...src);
      return out;
    },
  ),
  defList(
    "list.shift",
    "Rotate a list by an amount.",
    "list",
    [LIST(), I("amount", 1)],
    (list, amount) => {
      const src = notNull(list);
      if (src.length === 0) return [];
      const n = ((amount % src.length) + src.length) % src.length;
      return [...src.slice(n), ...src.slice(0, n)];
    },
  ),
  defList(
    "list.shuffle",
    "Randomize the order of a list.",
    "list",
    [LIST(), SEED()],
    (list, seed) => {
      const out = notNull(list).slice();
      const rand = g.randomFromSeed(seed);
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  ),
  defList(
    "list.slice",
    "Take a part of a list.",
    "list",
    [LIST(), I("start", 0, { min: 0 }), I("size", 1000, { min: 0 }), B("invert")],
    (list, start, size, invert) => {
      const src = notNull(list);
      if (!invert) return src.slice(start, start + size);
      return [...src.slice(0, start), ...src.slice(start + size)];
    },
  ),
  defList(
    "list.sort",
    "Sort a list (numbers numerically, everything else as text).",
    "list",
    [LIST()],
    (list) => {
      const src = notNull(list);
      const numeric = src.every((v) => typeof v === "number");
      return src.slice().sort(numeric ? (a, b) => a - b : (a, b) => String(a).localeCompare(String(b)));
    },
  ),
  defList(
    "list.switch",
    "Output one of the connected input lists.",
    "list",
    [LIST("input1"), LIST("input2"), LIST("input3"), I("index", 0, { min: 0 })],
    (l1, l2, l3, index) => {
      const inputs = [l1, l2, l3].map(notNull).filter((l) => l.length > 0);
      if (inputs.length === 0) return [];
      return inputs[index % inputs.length];
    },
  ),
  defList(
    "list.take_every",
    "Every nth item of a list.",
    "list",
    [LIST(), I("n", 2, { min: 1 }), I("offset", 0, { min: 0 })],
    (list, n, offset) => notNull(list).filter((_, i) => (i - offset) % n === 0 && i >= offset),
  ),
  defList("list.distinct", "Remove duplicate items.", "list", [LIST()], (list) => {
    const seen = new Set();
    return notNull(list).filter((v) => {
      const k = typeof v === "object" ? JSON.stringify(v) : v;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }),
  defList(
    "list.cull",
    "Keep items where the matching boolean is true.",
    "list",
    [LIST(), LIST("booleans")],
    (list, booleans) => {
      const src = notNull(list);
      const bools = notNull(booleans);
      if (bools.length === 0) return src;
      return src.filter((_, i) => bools[i % bools.length]);
    },
  ),
  defList(
    "list.pick",
    "Pick random items from a list.",
    "list",
    [LIST(), I("amount", 3, { min: 0 }), SEED()],
    (list, amount, seed) => {
      const src = notNull(list);
      if (src.length === 0) return [];
      const rand = g.randomFromSeed(seed);
      return Array.from({ length: amount }, () => src[Math.floor(rand() * src.length)]);
    },
  ),
];

// ---------------------------------------------------------------------------
// string
// ---------------------------------------------------------------------------

export const stringNodes = [
  def("string.string", "A constant string.", "string", [S("value", "hello")], (value) => value),
  def(
    "string.concatenate",
    "Join up to four strings.",
    "string",
    [S("s1"), S("s2"), S("s3"), S("s4")],
    (s1, s2, s3, s4) => `${s1}${s2}${s3}${s4}`,
  ),
  def("string.length", "The length of a string.", "int", [S("value")], (value) => value.length),
  defList("string.characters", "Split a string into characters.", "string", [S("value")], (value) =>
    value.split(""),
  ),
];

// ---------------------------------------------------------------------------
// color
// ---------------------------------------------------------------------------

export const colorNodes = [
  def("color.color", "A constant color.", "color", [C("color")], (color) => color),
  def(
    "color.rgb_color",
    "A color from red/green/blue channels (0–1).",
    "color",
    [
      F("red", 0, { min: 0, max: 1 }),
      F("green", 0, { min: 0, max: 1 }),
      F("blue", 0, { min: 0, max: 1 }),
      F("alpha", 1, { min: 0, max: 1 }),
    ],
    (r, gr, b, a) => g.color(r, gr, b, a),
  ),
  def(
    "color.hsb_color",
    "A color from hue/saturation/brightness (0–1).",
    "color",
    [
      F("hue", 0, { min: 0, max: 1 }),
      F("saturation", 0.5, { min: 0, max: 1 }),
      F("brightness", 1, { min: 0, max: 1 }),
      F("alpha", 1, { min: 0, max: 1 }),
    ],
    (h, s, b, a) => g.hsbColor(h, s, b, a),
  ),
  def(
    "color.gray_color",
    "A grayscale color (0–1).",
    "color",
    [F("gray", 0, { min: 0, max: 1 }), F("alpha", 1, { min: 0, max: 1 })],
    (v, a) => g.grayColor(v, a),
  ),
];

/** All built-in node types, ready for createRegistry. */
export const BUILTIN_TYPES = [
  ...coreNodes,
  ...vectorNodes,
  ...mathNodes,
  ...listNodes,
  ...stringNodes,
  ...colorNodes,
];
