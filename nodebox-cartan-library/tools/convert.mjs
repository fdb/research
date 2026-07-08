// Convert John Cartan's Node Library 3.6 (a NodeBox 3 .ndbx document)
// into the unified-engine JSON format, evaluate every node's demo through
// the engine, and pre-render SVG thumbnails.
//
//   node tools/convert.mjs "/path/to/node library 3-6.ndbx" "/path/to/Cartan Node Library.csv"
//
// Outputs (all committed, so the site itself needs no build step):
//   data/catalog.json      — node index: metadata, ports, status, fn types
//   data/nodes/<name>.json — per-node document {node, demo?} (size-capped)
//   thumbs/<name>.svg      — pre-rendered demo output
//   data/coverage.json     — full conversion/evaluation report

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNDBX, parsePortValue } from "./ndbx-parser.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const [, , NDBX_PATH, CSV_PATH] = process.argv;
if (!NDBX_PATH) {
  console.error("usage: node tools/convert.mjs <ndbx> [csv]");
  process.exit(1);
}

const { createRegistry, registerType } = await import(join(root, "engine/model.js"));
const { createRenderer } = await import(join(root, "engine/eval.js"));
const g = await import(join(root, "engine/graphics.js"));
const lib = await import(join(root, "engine/n3lib.js"));

// Size caps: per-node JSON above the cap is not shipped (the thumbnail is
// always pre-rendered from the in-memory conversion regardless).
const NODE_CAP = 700 * 1024;
const DEMO_CAP = 400 * 1024;

// ---------------------------------------------------------------------------
// 1. Parse the ndbx + CSV catalog
// ---------------------------------------------------------------------------

console.log("parsing ndbx…");
const xml = readFileSync(NDBX_PATH, "utf8");
const doc = parseNDBX(xml);
const ndbx = doc.children.find((c) => c.tag === "ndbx");
const rootNode = ndbx.children.find((c) => c.tag === "node" && c.attrs.name === "root");
const props = Object.fromEntries(
  ndbx.children.filter((c) => c.tag === "property").map((c) => [c.attrs.name, c.attrs.value]),
);
const CANVAS = { width: parseFloat(props.canvasWidth) || 600, height: parseFloat(props.canvasHeight) || 600 };

// CSV: name,category,description
const csvMeta = new Map();
if (CSV_PATH) {
  const rows = lib.parseCSV(readFileSync(CSV_PATH, "utf8"), ",", '"', false);
  for (const row of rows) {
    csvMeta.set(String(row.Node).trim(), {
      category: String(row.Type || "other").trim(),
      description: String(row.Description || "").trim(),
    });
  }
}

// ---------------------------------------------------------------------------
// 2. ndbx element tree → unified NodeInstance JSON
// ---------------------------------------------------------------------------

// Synthesized types for Cartan's script-function nodes, keyed by function id.
const fnSpecs = new Map();

function fnTypeId(functionId) {
  return `cartanfn.${functionId.replace("/", ".")}`;
}

function registerFnSpec(el) {
  const functionId = el.attrs.function;
  const id = fnTypeId(functionId);
  const ports = el.children
    .filter((c) => c.tag === "port" && !c.attrs.childReference)
    .map((c) => portDefFromEl(c, false));
  const existing = fnSpecs.get(id);
  if (existing) {
    // Union of ports across instances (first occurrence wins the order).
    for (const p of ports) {
      if (!existing.ports.some((q) => q.name === p.name)) existing.ports.push(p);
    }
    return id;
  }
  fnSpecs.set(id, {
    id,
    name: el.attrs.name,
    function: functionId,
    description: el.attrs.description || el.attrs.comment || "",
    outputType: el.attrs.outputType ? mapType(el.attrs.outputType) : undefined,
    outputRange: el.attrs.outputRange || undefined,
    // Nodes may override a standard prototype's function (make_map =
    // corevector.generator + treemap/squarify); the prototype supplies
    // the base ports.
    base: el.attrs.prototype || undefined,
    ports,
  });
  return id;
}

const TYPE_MAP = { geometry: "shape", data: "list" };
const mapType = (t) => TYPE_MAP[t] || t;

function portDefFromEl(el, includeValue = true) {
  const a = el.attrs;
  const def = { name: a.name, type: mapType(a.type), range: a.range || "value" };
  const menu = el.children
    .filter((c) => c.tag === "menu")
    .map((c) => ({ key: c.attrs.key, label: c.attrs.label }));
  if (a.min !== undefined) def.min = parseFloat(a.min);
  if (a.max !== undefined) def.max = parseFloat(a.max);
  if (a.label) def.label = a.label;
  if (a.description) def.description = a.description;
  if (a.widget && a.widget !== "none") def.widget = a.widget;
  if (menu.length) {
    def.menu = menu;
    def.widget = "menu";
  }
  if (includeValue && a.value !== undefined) def.value = parsePortValue(a.type, a.value);
  return def;
}

/** Convert one <node> element into a NodeInstance. */
function convertNode(el, stats) {
  const a = el.attrs;
  // The format omits `name` when it equals the prototype's default name.
  if (!a.name) {
    a.name = a.prototype
      ? a.prototype.split(".").pop()
      : a.function
        ? a.function.split("/").pop()
        : "node";
  }
  const position = parsePosition(a.position);
  if (a.prototype === "core.network") {
    const node = {
      name: a.name,
      type: "core.network",
      position,
      values: {},
      children: [],
      connections: [],
      renderedChild: a.renderedChild || null,
      publishedPorts: [],
    };
    if (a.comment) node.comment = a.comment;
    const conns = [];
    for (const c of el.children) {
      if (c.tag === "node") node.children.push(convertNode(c, stats));
      else if (c.tag === "conn") {
        const [input, port] = c.attrs.input.split(".");
        conns.push({ output: c.attrs.output, input, port });
      }
    }
    const childNames = new Set(node.children.map((ch) => ch.name));
    // The network's own ports. NodeBox 3 forwards a network port to child
    // inputs via <conn output="portName">; childReference is the original
    // publish record and may be stale after renames.
    const portEls = el.children.filter((c) => c.tag === "port");
    const portNames = new Set(portEls.map((c) => c.attrs.name));
    for (const conn of conns) {
      // A child output named like a network port wins (child names and
      // port names share the conn namespace).
      if (childNames.has(conn.output) || !portNames.has(conn.output)) {
        node.connections.push(conn);
      }
    }
    for (const c of portEls) {
      const pa = c.attrs;
      const def = portDefFromEl(c, false);
      delete def.name;
      const targets = [];
      for (const conn of conns) {
        if (conn.output === pa.name && !childNames.has(conn.output) && childNames.has(conn.input)) {
          targets.push({ child: conn.input, port: conn.port });
        }
      }
      if (targets.length === 0 && pa.childReference) {
        const [childName, childPort] = pa.childReference.split(".");
        if (childNames.has(childName)) targets.push({ child: childName, port: childPort });
      }
      for (const t of targets) {
        node.publishedPorts.push({ name: pa.name, child: t.child, port: t.port, def });
      }
      // Write-through: the network port's stored value becomes the value
      // of every child port it feeds.
      if (pa.value !== undefined) {
        for (const t of targets) {
          const child = node.children.find((ch) => ch.name === t.child);
          if (child) {
            if (!child.values) child.values = {};
            child.values[t.port] = parsePortValue(pa.type, pa.value);
          }
        }
      }
    }
    return node;
  }
  // Script-function node: a function= attribute (possibly overriding a
  // standard prototype's implementation, like make_map / join_contours).
  if (a.function && a.prototype !== "core.network") {
    stats.fns.add(a.function);
    const type = registerFnSpec(el);
    const node = { name: a.name, type, position, values: {} };
    for (const c of el.children) {
      if (c.tag === "port" && c.attrs.value !== undefined) {
        node.values[c.attrs.name] = parsePortValue(c.attrs.type, c.attrs.value);
      }
    }
    if (a.comment) node.comment = a.comment;
    return node;
  }
  // Regular node instance.
  stats.protos.add(a.prototype);
  const node = { name: a.name, type: a.prototype, position, values: {} };
  for (const c of el.children) {
    if (c.tag === "port" && c.attrs.value !== undefined) {
      node.values[c.attrs.name] = parsePortValue(c.attrs.type, c.attrs.value);
      if (c.attrs.type === "string" && /\.(svg|csv|txt|jpg|png)$/i.test(c.attrs.value)) {
        stats.files.add(c.attrs.value);
      }
    }
  }
  if (a.comment) node.comment = a.comment;
  return node;
}

function parsePosition(s) {
  if (!s) return { x: 0, y: 0 };
  const [x, y] = s.split(",").map(parseFloat);
  return { x, y };
}

// ---------------------------------------------------------------------------
// 3. Walk the root: canonical entries + demos
// ---------------------------------------------------------------------------

const CATEGORY_MARKERS = new Set([
  "Alteration", "Animation", "Color", "Credits", "Data", "Demo_Nodes",
  "Geometry", "List", "Math", "Other", "Point", "Text", "LIBRARY",
]);

const entries = new Map(); // name -> {node, demo, stats}
for (const el of rootNode.children.filter((c) => c.tag === "node")) {
  const name = el.attrs.name;
  if (CATEGORY_MARKERS.has(name)) continue;
  const isDemo = name.endsWith("_");
  const key = isDemo ? name.slice(0, -1) : name;
  let entry = entries.get(key);
  if (!entry) {
    entry = { name: key, stats: { protos: new Set(), fns: new Set(), files: new Set() } };
    entries.set(key, entry);
  }
  const converted = convertNode(el, entry.stats);
  if (isDemo) entry.demo = converted;
  else {
    entry.node = converted;
    entry.comment = el.attrs.comment || "";
  }
}
console.log(`converted ${entries.size} library entries, ${fnSpecs.size} script-function types`);

if (process.env.DEBUG_DUMP) {
  for (const name of process.env.DEBUG_DUMP.split(",")) {
    const e = entries.get(name);
    if (e) {
      writeFileSync(join(root, "data", `debug-${name}.json`), JSON.stringify({ node: e.node || null, demo: e.demo || null }));
      console.log(`dumped debug-${name}.json`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Build the registry and evaluate each demo → SVG thumbnails
// ---------------------------------------------------------------------------

const assetDir = join(root, "assets");
const assetFiles = new Set(readdirSync(assetDir));
lib.setFileLoader((name) => {
  const base = name.split("/").pop();
  if (!assetFiles.has(base)) throw new Error(`file not found: ${name}`);
  return readFileSync(join(assetDir, base), "utf8");
});

const registry = createRegistry(lib.n3Types());
for (const spec of fnSpecs.values()) registerType(registry, lib.cartanFnType(spec));

mkdirSync(join(root, "thumbs"), { recursive: true });
mkdirSync(join(root, "data", "nodes"), { recursive: true });

function makeDoc(network) {
  return {
    type: "nodebox",
    formatVersion: 1,
    name: network.name,
    properties: { width: CANVAS.width, height: CANVAS.height, background: "#ffffff" },
    functions: [],
    root: network,
  };
}

function renderEntry(entry) {
  const target = entry.demo || entry.node;
  if (!target || target.type !== "core.network") {
    // Script-function leaf: render by wrapping in a network.
    if (!target) return { ok: false, error: "no definition" };
    const wrapper = {
      name: "root", type: "core.network", position: { x: 0, y: 0 }, values: {},
      children: [target], connections: [], renderedChild: target.name, publishedPorts: [],
    };
    return renderNetwork(wrapper);
  }
  return renderNetwork(target);
}

function renderNetwork(network) {
  const renderer = createRenderer(registry);
  if (
    process.env.DEBUG_ENTRY &&
    process.env.DEBUG_ENTRY.split(",").some((n) => network.name === n || network.name === `${n}_`)
  ) {
    const doc = makeDoc(network);
    for (const child of network.children || []) {
      const r = renderer.render(doc, `/${child.name}`, { frame: 1, mouse: { x: 0, y: 0 }, canvas: CANVAS });
      const kinds = {};
      for (const v of r.value) {
        const k = v == null ? "null" : g.isShape(v) ? v.type : g.isPoint(v) ? "point" : g.isColor(v) ? "color" : typeof v;
        kinds[k] = (kinds[k] || 0) + 1;
      }
      console.log(
        `  DEBUG ${network.name}/${child.name}`.padEnd(40),
        r.error ? `ERR ${r.error.path}: ${r.error.message}`.slice(0, 120) : JSON.stringify(kinds),
      );
    }
  }
  try {
    const result = renderer.render(makeDoc(network), "/", {
      frame: 1,
      mouse: { x: 0, y: 0 },
      canvas: CANVAS,
    });
    if (result.error) return { ok: false, error: `${result.error.path}: ${result.error.message}` };
    return { ok: true, value: result.value };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * Cap the amount of geometry in a thumbnail: some demos emit hundreds of
 * thousands of points or path commands (multi_list…), which would make
 * multi-megabyte SVGs. Points are sampled evenly wherever they occur;
 * whole paths are dropped once the command budget runs out.
 */
function decimate(values) {
  const POINT_BUDGET = 2500;
  const COMMAND_BUDGET = 15000;
  // Pass 1: count.
  let totalPoints = 0;
  const count = (v) => {
    if (v == null) return;
    if (g.isPoint(v)) totalPoints++;
    else if (v.type === "group") v.shapes.forEach(count);
  };
  values.forEach(count);
  const keepEvery = Math.max(1, Math.ceil(totalPoints / POINT_BUDGET));
  // Pass 2: rebuild within budgets.
  let pointIndex = 0;
  let commands = COMMAND_BUDGET;
  const prune = (v) => {
    if (v == null) return null;
    if (g.isPoint(v)) return pointIndex++ % keepEvery === 0 ? v : null;
    if (v.type === "group") {
      const shapes = v.shapes.map(prune).filter((s) => s != null);
      return shapes.length ? { ...v, shapes } : null;
    }
    if (v.type === "text") {
      commands -= 4;
      return commands >= 0 ? v : null;
    }
    if (v.type === "path") {
      commands -= v.commands.length;
      return commands >= 0 ? v : null;
    }
    return v;
  };
  return values.map(prune).filter((v) => v != null);
}

function thumbnailSVG(value) {
  if (Array.isArray(value)) value = decimate(value.filter(isDrawable));
  // Color values render as swatch rows (like NodeBox's color visualizer).
  if (Array.isArray(value)) {
    let swatch = 0;
    value = value.map((v) =>
      g.isColor(v)
        ? { ...g.rectPath(swatch++ * 34, 0, 30, 30), fill: v, stroke: null, strokeWidth: 0 }
        : v,
    );
  }
  // Fit the viewBox to the drawing, padded. No extent at all (e.g. text
  // nodes degrading to empty outline paths) → no thumbnail.
  const b = g.bounds(Array.isArray(value) ? { type: "group", shapes: value.filter(isDrawable) } : value);
  if (!(b.width > 0 || b.height > 0)) return null;
  const pad = Math.max(b.width, b.height) * 0.06 + 4;
  const x = b.x - pad;
  const y = b.y - pad;
  const w = b.width + pad * 2;
  const h = b.height + pad * 2;
  const body = g
    .toSVG(value, { width: 100, height: 100 })
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)}">` +
    `${body}</svg>`
  );
}
const fmt = (n) => +n.toFixed(2);
const isDrawable = (v) => v != null && (g.isShape(v) || g.isPoint(v) || g.isColor(v));

// ---------------------------------------------------------------------------
// 5. Emit everything
// ---------------------------------------------------------------------------

/**
 * Slim a NodeInstance tree for shipping: editor-only fields (position,
 * inner comments) and empty collections are dropped. The engine treats
 * them all as optional.
 */
function stripNode(n) {
  const out = { name: n.name, type: n.type };
  if (n.values && Object.keys(n.values).length) out.values = n.values;
  if (n.children) {
    out.children = n.children.map(stripNode);
    if (n.connections && n.connections.length) out.connections = n.connections;
    if (n.renderedChild) out.renderedChild = n.renderedChild;
    if (n.publishedPorts && n.publishedPorts.length) out.publishedPorts = n.publishedPorts;
  }
  return out;
}

const catalog = [];
const coverage = [];
let okCount = 0;

for (const entry of [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const meta = csvMeta.get(entry.name) || { category: "other", description: "" };
  const result = renderEntry(entry);
  let thumb = false;
  let drawableCount = 0;
  if (result.ok) {
    const drawables = result.value.filter(isDrawable);
    drawableCount = drawables.length;
    okCount++;
    if (drawables.length) {
      const svg = thumbnailSVG(result.value);
      if (svg != null) {
        writeFileSync(join(root, "thumbs", `${entry.name}.svg`), svg);
        thumb = true;
      }
    }
  }

  // Ports of the canonical node (for the catalog / detail view).
  let ports = [];
  if (entry.node && entry.node.type === "core.network") {
    ports = (entry.node.publishedPorts || []).map((p) => ({
      name: p.name,
      ...(p.def || {}),
      child: undefined,
      port: undefined,
    }));
  } else if (entry.node) {
    const spec = fnSpecs.get(entry.node.type);
    if (spec) ports = spec.ports;
  }

  const strippedNode = entry.node ? stripNode(entry.node) : null;
  const strippedDemo = entry.demo ? stripNode(entry.demo) : null;
  const nodeJSON = strippedNode ? JSON.stringify(strippedNode) : "";
  const demoJSON = strippedDemo ? JSON.stringify(strippedDemo) : null;
  const shipNode = strippedNode != null && nodeJSON.length <= NODE_CAP;
  const shipDemo = demoJSON != null && demoJSON.length <= DEMO_CAP;
  const fileBody = {
    name: entry.name,
    category: meta.category,
    description: meta.description,
    comment: entry.comment || "",
    fns: [...entry.stats.fns],
    files: [...entry.stats.files],
    node: shipNode ? strippedNode : null,
    demo: shipDemo ? strippedDemo : null,
  };
  writeFileSync(join(root, "data", "nodes", `${entry.name}.json`), JSON.stringify(fileBody));

  const unsupported = !result.ok && /not supported in the web port/.test(result.error || "");
  catalog.push({
    name: entry.name,
    category: meta.category,
    description: meta.description,
    ports,
    thumb,
    status: result.ok ? "ok" : unsupported ? "unsupported" : "error",
    error: result.ok ? undefined : result.error,
    values: result.ok && drawableCount === 0 ? summarizeValues(result.value) : undefined,
    hasNode: shipNode,
    hasDemo: shipDemo,
    fns: [...entry.stats.fns],
    files: [...entry.stats.files],
  });
  coverage.push({
    name: entry.name,
    status: result.ok ? "ok" : "error",
    error: result.error,
    drawables: drawableCount,
    results: result.ok ? result.value.length : 0,
    nodeBytes: nodeJSON.length,
    demoBytes: demoJSON ? demoJSON.length : 0,
    shipNode,
    shipDemo,
  });
  const flag = result.ok ? (drawableCount ? "✓" : "•") : "✗";
  console.log(
    `${flag} ${entry.name.padEnd(16)} ${result.ok ? `${result.value.length} values` : result.error}`.slice(0, 140),
  );
}

// First N values as text, for nodes whose demo output isn't drawable.
function summarizeValues(values) {
  return values.slice(0, 12).map((v) => {
    if (v == null) return "null";
    if (typeof v === "object") {
      if (g.isPoint(v)) return `(${fmt(v.x)}, ${fmt(v.y)})`;
      if (g.isColor(v)) return g.toCSS(v);
      return JSON.stringify(v).slice(0, 60);
    }
    return typeof v === "number" ? String(fmt(v)) : String(v).slice(0, 60);
  });
}

writeFileSync(
  join(root, "data", "catalog.json"),
  JSON.stringify(
    {
      generated: "Node Library 3.6 by John Cartan — converted for the unified web NodeBox",
      canvas: CANVAS,
      fnTypes: [...fnSpecs.values()],
      nodes: catalog,
    },
    null,
    0,
  ),
);
writeFileSync(join(root, "data", "coverage.json"), JSON.stringify(coverage, null, 1));

const failed = coverage.filter((c) => c.status === "error");
console.log(`\n${okCount}/${coverage.length} nodes evaluate; ${coverage.filter((c) => c.drawables > 0).length} thumbnails`);
console.log(`shipped defs: ${coverage.filter((c) => c.shipNode).length}, demos: ${coverage.filter((c) => c.shipDemo).length}`);
console.log(`total data size: ${(coverage.reduce((s, c) => s + (c.shipNode ? c.nodeBytes : 0) + (c.shipDemo ? c.demoBytes : 0), 0) / 1e6).toFixed(1)} MB`);
if (failed.length) console.log("failing:", failed.map((f) => f.name).join(", "));
