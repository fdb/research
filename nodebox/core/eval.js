// nodebox/core/eval.js
// The evaluator. A faithful port of Java NodeBox's NodeContext:
//
// - Pull-based and eager: every node's result is a flat ARRAY of values.
// - List-matching: a node is invoked once per element of its longest
//   value-range input, shorter inputs cycling (wrapping); ports with
//   range 'list' receive the entire upstream list once and don't count
//   toward the invocation count; if ANY input list is empty the node
//   doesn't run at all; the results of all invocations are concatenated.
// - Networks evaluate their rendered child; published port values flow
//   down through an argument map, so subnetworks participate in the
//   parent's list-matching like any other node.
// - Purity: any node with a 'context' port (frame, mouse_position) is
//   impure, transitively. Pure results are cached across renders keyed on
//   node object identity + upstream result identities — valid because
//   documents are immutable with structural sharing (model.js).

import {
  NETWORK_TYPE,
  getNode,
  joinPath,
  nodePorts,
  portValue,
  parentPath,
} from "./model.js";
import { clamp, grayColor, isColor, isPoint, isShape, parseColor, shapePoints, toCSS } from "./graphics.js";

/**
 * @typedef {Object} RenderResult
 * @property {*[]} value The rendered node's result list ([] on error).
 * @property {{path: string, message: string}|null} error First evaluation error.
 */

/**
 * Create a renderer with a persistent cross-render cache. Call
 * `renderer.render(doc, path, data)` each time the document, the rendered
 * path, or the context data (frame...) changes.
 *
 * @param {import('./model.js').Registry} registry
 */
export function createRenderer(registry) {
  let prevCache = new Map();
  return {
    /**
     * @param {import('./model.js').NodeBoxDocument} doc
     * @param {string} path Path of the node to render (usually the active
     *   network, whose rendered child is evaluated).
     * @param {{frame?: number, mouse?: {x:number,y:number}}} [data]
     * @returns {RenderResult}
     */
    render(doc, path = "/", data = {}) {
      const ctx = {
        registry,
        doc,
        data: { frame: 1, mouse: { x: 0, y: 0 }, ...data },
        memo: new Map(), // per-render: path -> [{args, out}]
        stack: [], // cycle detection
        prevCache,
        nextCache: new Map(),
      };
      try {
        const node = getNode(doc, path);
        if (!node) return { value: [], error: { path, message: "node not found" } };
        let out;
        if (node.type === NETWORK_TYPE) {
          out = renderNetwork(ctx, path, node, {});
        } else {
          const parent = getNode(doc, parentPath(path));
          out = evalChild(ctx, parentPath(path), parent, node, {});
        }
        prevCache = ctx.nextCache;
        return { value: out.list, error: null };
      } catch (e) {
        if (e instanceof NodeError) {
          return { value: [], error: { path: e.path, message: e.message } };
        }
        throw e;
      }
    },
    clearCache() {
      prevCache = new Map();
    },
  };
}

export class NodeError extends Error {
  constructor(path, message) {
    super(message);
    this.path = path;
  }
}

/** @returns {{list: *[], pure: boolean}} */
function renderNetwork(ctx, path, network, networkArgs) {
  const child = (network.children || []).find((c) => c.name === network.renderedChild);
  if (!child) return { list: [], pure: true };
  return evalChild(ctx, path, network, child, networkArgs);
}

/**
 * Evaluate one child node within its network. `networkArgs` maps the
 * network's published port names to per-invocation values (Java's
 * networkArgumentMap).
 * @returns {{list: *[], pure: boolean}}
 */
function evalChild(ctx, networkPath, network, child, networkArgs) {
  const path = joinPath(networkPath, child.name);
  if (ctx.stack.includes(path)) throw new NodeError(path, "cyclic connection");

  // Per-render memo: a node reached through several connections (or a
  // subnetwork invoked repeatedly with identical published values)
  // evaluates once per distinct argument map.
  let memoEntries = ctx.memo.get(path);
  if (!memoEntries) ctx.memo.set(path, (memoEntries = []));
  for (const entry of memoEntries) {
    if (shallowEqual(entry.args, networkArgs)) return entry.out;
  }

  ctx.stack.push(path);
  try {
    const out = evalChildUncached(ctx, networkPath, network, child, networkArgs, path);
    memoEntries.push({ args: networkArgs, out });
    return out;
  } finally {
    ctx.stack.pop();
  }
}

function evalChildUncached(ctx, networkPath, network, child, networkArgs, path) {
  const { registry } = ctx;
  const ports = nodePorts(registry, child);
  const publishedByRef = new Map();
  for (const pub of network.publishedPorts || []) {
    publishedByRef.set(`${pub.child}.${pub.port}`, pub.name);
  }

  // 1. Gather the argument list for every port.
  const portLists = [];
  let upstreamPure = true;
  const upstreamResults = [];
  let cacheable = Object.keys(networkArgs).length === 0;
  for (const port of ports) {
    if (port.type === "context") {
      portLists.push({ port, list: [ctx.data], context: true });
      continue;
    }
    const pubName = publishedByRef.get(`${child.name}.${port.name}`);
    if (pubName !== undefined && pubName in networkArgs) {
      const v = networkArgs[pubName];
      portLists.push({ port, list: port.range === "list" ? v : [v] });
      continue;
    }
    const conn = (network.connections || []).find(
      (c) => c.input === child.name && c.port === port.name,
    );
    if (conn) {
      const upstream = (network.children || []).find((c) => c.name === conn.output);
      if (!upstream) throw new NodeError(path, `missing upstream node ${conn.output}`);
      // Published values of this network flow along sibling evaluation, so
      // an upstream sibling sees the same networkArgs.
      const up = evalChild(ctx, networkPath, network, upstream, networkArgs);
      upstreamPure = upstreamPure && up.pure;
      upstreamResults.push(up.list);
      portLists.push({ port, list: convertList(up.list, port, path) });
    } else {
      const literal = portValue(registry, child, port.name);
      portLists.push({ port, list: [literal] });
    }
  }

  // 2. Cross-render cache (pure nodes, no published overrides).
  const selfPure = !ports.some((p) => p.type === "context");
  cacheable = cacheable && selfPure && upstreamPure;
  if (cacheable) {
    const entry = ctx.prevCache.get(path);
    if (
      entry &&
      entry.node === child &&
      entry.inputs.length === upstreamResults.length &&
      entry.inputs.every((r, i) => r === upstreamResults[i])
    ) {
      ctx.nextCache.set(path, entry);
      return entry.out;
    }
  }

  // 3. Build one argument map per invocation (the list-matching core).
  const argumentMaps = buildArgumentMaps(portLists);

  // 4. Invoke.
  const results = [];
  let pure = selfPure && upstreamPure;
  for (const argumentMap of argumentMaps) {
    let raw;
    if (child.type === NETWORK_TYPE) {
      const sub = renderNetwork(ctx, path, child, argumentMap.named);
      pure = pure && sub.pure;
      raw = sub.list; // networks output whole lists
      for (const v of raw) results.push(v);
      continue;
    }
    const type = registry.get(child.type);
    if (!type) throw new NodeError(path, `unknown node type “${child.type}”`);
    try {
      raw = type.fn(...argumentMap.args);
    } catch (e) {
      throw new NodeError(path, String((e && e.message) || e));
    }
    if (type.outputRange === "list") {
      if (raw != null) for (const v of raw) results.push(v);
    } else if (raw != null) {
      results.push(raw);
    }
  }

  const out = { list: results, pure };
  if (cacheable) {
    ctx.nextCache.set(path, { node: child, inputs: upstreamResults, out });
  }
  return out;
}

/**
 * Java NodeContext.buildArgumentMaps, verbatim semantics:
 * - value-range ports cycle to the size of the longest value-range list;
 * - list-range and context ports get their whole list each invocation;
 * - any EMPTY input list (value or list range) means zero invocations.
 * @param {{port: import('./model.js').PortDef, list: *[], context?: boolean}[]} portLists
 * @returns {{args: *[], named: Object<string, *>}[]}
 */
function buildArgumentMaps(portLists) {
  let maxSize = 1;
  for (const { port, list, context } of portLists) {
    if (context || port.range === "list") continue; // list ports count as size 1
    if (list.length === 0) return []; // an empty value-range input: no invocations
    maxSize = Math.max(maxSize, list.length);
  }
  const maps = [];
  for (let i = 0; i < maxSize; i++) {
    const args = [];
    const named = {};
    for (const { port, list, context } of portLists) {
      const v = context ? list[0] : port.range === "list" ? list : list[i % list.length];
      args.push(v);
      named[port.name] = v;
    }
    maps.push({ args, named });
  }
  return maps;
}

// ---------------------------------------------------------------------------
// Type conversion (Java's TypeConversions, applied to whole result lists
// before list-matching — note geometry→point EXPLODES a shape into its
// points, changing the list length by design)
// ---------------------------------------------------------------------------

/** @param {*[]} list @param {import('./model.js').PortDef} port */
export function convertList(list, port, path) {
  switch (port.type) {
    case "list":
    case "context":
      return list;
    case "point":
      return list.flatMap((v) => {
        if (isPoint(v)) return [v];
        if (typeof v === "number") return [{ x: v, y: v }];
        if (isShape(v)) return shapePoints(v);
        throw new NodeError(path, `cannot convert ${describe(v)} to point`);
      });
    case "shape":
      return list.map((v) => {
        if (isShape(v) || isPoint(v)) return v;
        throw new NodeError(path, `cannot convert ${describe(v)} to shape`);
      });
    case "float":
    case "int":
      return list.map((v) => {
        let n = v;
        if (typeof v === "boolean") n = v ? 1 : 0;
        else if (typeof v === "string") n = parseFloat(v);
        if (typeof n !== "number" || Number.isNaN(n)) {
          throw new NodeError(path, `cannot convert ${describe(v)} to number`);
        }
        if (port.min !== undefined) n = Math.max(port.min, n);
        if (port.max !== undefined) n = Math.min(port.max, n);
        return port.type === "int" ? Math.round(n) : n;
      });
    case "string":
      return list.map(stringify);
    case "boolean":
      return list.map((v) => (typeof v === "string" ? v.toLowerCase() === "true" : Boolean(v)));
    case "color":
      return list.map((v) => {
        if (isColor(v)) return v;
        if (typeof v === "number") return grayColor(clamp(v, 0, 1));
        if (typeof v === "boolean") return grayColor(v ? 1 : 0);
        if (typeof v === "string") return parseColor(v);
        throw new NodeError(path, `cannot convert ${describe(v)} to color`);
      });
    default:
      return list;
  }
}

function stringify(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  if (isColor(v)) return toCSS(v);
  if (isPoint(v)) return `${round3(v.x)},${round3(v.y)}`;
  if (isShape(v)) return v.type === "group" ? `<group of ${v.shapes.length}>` : "<path>";
  return String(v);
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function describe(v) {
  if (v === null) return "null";
  if (isShape(v)) return "shape";
  if (isPoint(v)) return "point";
  if (isColor(v)) return "color";
  return typeof v;
}

function shallowEqual(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}
