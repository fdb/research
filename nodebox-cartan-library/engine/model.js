// nodebox-cartan-library/engine/model.js
// Vendored from /nodebox/core/model.js (the unified-NodeBox engine).
// Cartan-port extension: a publishedPorts entry may carry a `def` object
// (label, description, widget, menu, min, max, range) that overrides the
// child port's definition — NodeBox 3 lets a network's published port
// customize its widget, and Cartan's nodes rely on it for their menus.
// The document model: node types, node instances, networks, documents.
//
// Design (see doc/DECISIONS.md):
// - The document is an immutable plain-JSON value (like NodeBox Live's
//   project.json). All edits are pure functions `(doc, ...) => doc` that
//   rebuild only the spine from the edited node up to the root — Java
//   NodeBox's structural sharing, which makes undo a snapshot stack and
//   lets the evaluator cache on object identity.
// - A node *type* is (metadata + typed ports + a plain function) — the
//   Java model. Types come from three sources, all producing the same
//   shape: the built-in library (stdlib.js), document-local code nodes
//   (an ES module source string, NodeBox Live's model, compiled with
//   compileFunction), and networks (subnetworks with published ports).
// - Node *instances* store only values that differ from the type's port
//   defaults, like both ancestors.

/**
 * @typedef {'float'|'int'|'string'|'boolean'|'point'|'color'|'shape'|'list'|'context'} PortType
 *
 * @typedef {Object} PortDef
 * @property {string} name
 * @property {PortType} type
 * @property {*} [value] Default value.
 * @property {'value'|'list'} [range] 'value' ports participate in
 *   list-matching; 'list' ports receive the entire upstream list. Default
 *   'value'.
 * @property {number} [min]
 * @property {number} [max]
 * @property {string} [widget] Overrides the default widget for the type
 *   (e.g. 'seed', 'menu', 'angle', 'text').
 * @property {{key: string, label: string}[]} [menu]
 * @property {string} [label]
 *
 * @typedef {Object} NodeType
 * @property {string} id Namespaced id, e.g. 'corevector.rect' or 'local.my_node'.
 * @property {string} name
 * @property {string} category
 * @property {string} [description]
 * @property {PortType} outputType
 * @property {'value'|'list'} outputRange
 * @property {PortDef[]} ports
 * @property {Function} fn Pure function called with one argument per port,
 *   in port order (validated at registration, unlike Java's
 *   fail-at-invocation reflection).
 *
 * @typedef {Object} NodeInstance
 * @property {string} name Unique within its network.
 * @property {string} type NodeType id, or 'core.network' for subnetworks.
 * @property {{x: number, y: number}} position Network editor position.
 * @property {Object<string, *>} values Port values overriding the type defaults.
 * @property {NodeInstance[]} [children] Networks only.
 * @property {ConnectionJSON[]} [connections] Networks only.
 * @property {string|null} [renderedChild] Networks only.
 * @property {PublishedPort[]} [publishedPorts] Networks only.
 *
 * @typedef {Object} ConnectionJSON
 * @property {string} output Name of the upstream node (single output per node).
 * @property {string} input Name of the downstream node.
 * @property {string} port Input port name on the downstream node.
 *
 * @typedef {Object} PublishedPort An input port the network exposes from a
 *   child — Java NodeBox's childReference.
 * @property {string} name Name on the network.
 * @property {string} child Child node name.
 * @property {string} port Port name on the child.
 *
 * @typedef {Object} NodeBoxDocument
 * @property {'nodebox'} type
 * @property {number} formatVersion
 * @property {string} name
 * @property {{width: number, height: number, background: string}} properties
 * @property {{name: string, source: string}[]} functions Document-local
 *   code node types (ES module source, see compileFunction).
 * @property {NodeInstance} root A network instance.
 */

export const NETWORK_TYPE = "core.network";
export const FORMAT_VERSION = 1;

// ---------------------------------------------------------------------------
// Port helpers
// ---------------------------------------------------------------------------

/** Default values per port type. @type {Object<string, *>} */
export const PORT_DEFAULTS = {
  float: 0,
  int: 0,
  string: "",
  boolean: false,
  point: { x: 0, y: 0 },
  color: { r: 0, g: 0, b: 0, a: 1 },
  shape: null,
  list: null,
  context: null,
};

/** Connection type compatibility, following Java's Node.isCompatible. */
export function isTypeCompatible(outputType, inputType) {
  if (outputType === inputType) return true;
  if (inputType === "string") return true;
  if (inputType === "list") return true;
  const numeric = ["int", "float", "boolean"];
  if (numeric.includes(outputType) && numeric.includes(inputType)) return true;
  if (numeric.includes(outputType) && (inputType === "point" || inputType === "color")) return true;
  if ((outputType === "shape" || outputType === "list") && inputType === "point") return true;
  if (outputType === "point" && inputType === "shape") return true;
  if (outputType === "list" && inputType === "shape") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Registry: node type lookup
// ---------------------------------------------------------------------------

/**
 * A registry maps type ids to NodeTypes. Built from the stdlib plus the
 * document's compiled code nodes (see compileDocumentFunctions).
 * @typedef {Map<string, NodeType>} Registry
 */

/**
 * @param {NodeType[]} types
 * @returns {Registry}
 */
export function createRegistry(types) {
  const registry = new Map();
  for (const type of types) registerType(registry, type);
  return registry;
}

/** @param {Registry} registry @param {NodeType} type */
export function registerType(registry, type) {
  if (typeof type.fn !== "function" && type.id !== NETWORK_TYPE) {
    throw new Error(`Node type ${type.id}: fn is not a function`);
  }
  // Arguments are bound by port order (context ports receive the render
  // context). Validate arity at registration, not at invocation like Java.
  if (type.fn && type.fn.length > (type.ports || []).length) {
    throw new Error(
      `Node type ${type.id}: function expects ${type.fn.length} arguments but has only ${(type.ports || []).length} ports`,
    );
  }
  registry.set(type.id, {
    outputRange: "value",
    category: "custom",
    ports: [],
    ...type,
  });
}

/**
 * Resolve the effective port definitions of a node instance. For regular
 * nodes this is the type's ports; for networks it is the published ports,
 * resolved against the children's types (defaults come from the child's
 * current value — Java's write-through model).
 * @param {Registry} registry
 * @param {NodeInstance} node
 * @returns {PortDef[]}
 */
export function nodePorts(registry, node) {
  if (node.type === NETWORK_TYPE) {
    // One published name may forward to several children (NodeBox 3's
    // port forwarding) — expose it once, resolved through the first.
    const seen = new Set();
    return (node.publishedPorts || []).flatMap((pub) => {
      if (seen.has(pub.name)) return [];
      const child = (node.children || []).find((c) => c.name === pub.child);
      if (!child) return [];
      const childPort = nodePorts(registry, child).find((p) => p.name === pub.port);
      if (!childPort) return [];
      seen.add(pub.name);
      return [{ ...childPort, name: pub.name, label: pub.name, ...(pub.def || {}) }];
    });
  }
  const type = registry.get(node.type);
  return type ? type.ports : [];
}

/**
 * Current value of a port on an instance (override, else default).
 * For networks, reads through to the referenced child.
 */
export function portValue(registry, node, portName) {
  if (node.type === NETWORK_TYPE) {
    const pub = (node.publishedPorts || []).find((p) => p.name === portName);
    if (!pub) return undefined;
    const child = (node.children || []).find((c) => c.name === pub.child);
    return child ? portValue(registry, child, pub.port) : undefined;
  }
  if (node.values && portName in node.values) return node.values[portName];
  const port = nodePorts(registry, node).find((p) => p.name === portName);
  if (!port) return undefined;
  return port.value !== undefined ? port.value : PORT_DEFAULTS[port.type];
}

/** Output type of an instance ('list' outputType for networks, like Java). */
export function nodeOutputType(registry, node) {
  if (node.type === NETWORK_TYPE) return "list";
  const type = registry.get(node.type);
  return type ? type.outputType : "list";
}

// ---------------------------------------------------------------------------
// Code nodes: document-local node types as ES module source
// ---------------------------------------------------------------------------
//
// NodeBox Live stores a node type as one JavaScript source string and
// scrapes ports out of it with regexes. We keep the source-string idea but
// *execute* the module and read its exported metadata, which is always
// truthful:
//
//   import { starPath } from "nodebox:graphics";
//   export const node = {
//     name: "burst",
//     description: "A star with randomized spikes.",
//     category: "custom",
//     outputType: "shape",
//     ports: [
//       { name: "position", type: "point" },
//       { name: "points", type: "int", value: 12, min: 3 },
//     ],
//   };
//   export default function burst(position, points) { ... }
//
// The "nodebox:graphics" specifier is rewritten to the absolute URL of
// core/graphics.js so code nodes can use the graphics library. Like Live
// there is NO sandboxing — code nodes run with page privileges. A real
// deployment should evaluate documents in a sandboxed iframe or worker
// (documented in DECISIONS.md).

const GRAPHICS_URL = new URL("./graphics.js", import.meta.url).href;

/**
 * Compile a code-node module source into a NodeType.
 * @param {string} name Registered as `local.<name>`.
 * @param {string} source
 * @returns {Promise<NodeType>}
 */
export async function compileFunction(name, source) {
  const fixed = source.replace(/(from\s+["'])nodebox:graphics(["'])/g, `$1${GRAPHICS_URL}$2`);
  const url = URL.createObjectURL(new Blob([fixed], { type: "text/javascript" }));
  try {
    const module = await import(url);
    if (typeof module.default !== "function") {
      throw new Error("code node must have a default export function");
    }
    const meta = module.node || {};
    return {
      id: `local.${name}`,
      name: meta.name || name,
      category: meta.category || "custom",
      description: meta.description || "",
      outputType: meta.outputType || "shape",
      outputRange: meta.outputRange || "value",
      ports: meta.ports || [],
      fn: module.default,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Compile all of a document's code nodes into the registry. Returns a map
 * of name → error message for modules that failed (they are skipped).
 * @param {Registry} registry
 * @param {NodeBoxDocument} doc
 * @returns {Promise<Object<string, string>>}
 */
export async function compileDocumentFunctions(registry, doc) {
  const errors = {};
  for (const fn of doc.functions || []) {
    try {
      registerType(registry, await compileFunction(fn.name, fn.source));
    } catch (e) {
      errors[fn.name] = String(e.message || e);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Paths ('/mesh/line1') and lookup
// ---------------------------------------------------------------------------

/** @param {string} parentPath @param {string} name */
export function joinPath(parentPath, name) {
  return parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
}

/** @returns {string} Parent of '/a/b' is '/a'; parent of '/a' is '/'. */
export function parentPath(path) {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

/** @returns {NodeInstance|null} */
export function getNode(doc, path) {
  if (path === "/") return doc.root;
  let node = doc.root;
  for (const part of path.split("/").filter(Boolean)) {
    if (!node.children) return null;
    node = node.children.find((c) => c.name === part);
    if (!node) return null;
  }
  return node;
}

/**
 * Rebuild the document with the node at `path` replaced by `fn(node)` —
 * the structural-sharing workhorse. Only the edited node and its
 * ancestors get new identities.
 * @param {NodeBoxDocument} doc
 * @param {string} path
 * @param {(node: NodeInstance) => NodeInstance} fn
 * @returns {NodeBoxDocument}
 */
export function updateNode(doc, path, fn) {
  const rebuild = (node, parts) => {
    if (parts.length === 0) return fn(node);
    const [head, ...rest] = parts;
    return {
      ...node,
      children: node.children.map((c) => (c.name === head ? rebuild(c, rest) : c)),
    };
  };
  return { ...doc, root: rebuild(doc.root, path.split("/").filter(Boolean)) };
}

// ---------------------------------------------------------------------------
// Document edits (all pure)
// ---------------------------------------------------------------------------

/** @returns {NodeBoxDocument} */
export function createDocument(name = "Untitled") {
  return {
    type: "nodebox",
    formatVersion: FORMAT_VERSION,
    name,
    properties: { width: 600, height: 600, background: "#ffffff" },
    functions: [],
    root: createNetwork("root"),
  };
}

/** @returns {NodeInstance} */
export function createNetwork(name, position = { x: 0, y: 0 }) {
  return {
    name,
    type: NETWORK_TYPE,
    position,
    values: {},
    children: [],
    connections: [],
    renderedChild: null,
    publishedPorts: [],
  };
}

/** @returns {NodeInstance} */
export function createNode(typeId, name, position = { x: 0, y: 0 }) {
  if (typeId === NETWORK_TYPE) return createNetwork(name, position);
  return { name, type: typeId, position, values: {} };
}

/** First free name like 'rect1', 'rect2', ... within a network. */
export function uniqueName(network, base) {
  const clean = base.replace(/\d+$/, "");
  for (let i = 1; ; i++) {
    const name = `${clean}${i}`;
    if (!(network.children || []).some((c) => c.name === name)) return name;
  }
}

/**
 * Add a node to the network at parentPath. If it is the only node, it
 * becomes the rendered child.
 */
export function addNode(doc, parent, node) {
  return updateNode(doc, parent, (network) => ({
    ...network,
    children: [...network.children, node],
    renderedChild: network.children.length === 0 ? node.name : network.renderedChild,
  }));
}

/** Remove nodes and any connections / published ports touching them. */
export function removeNodes(doc, parent, names) {
  const gone = new Set(names);
  return updateNode(doc, parent, (network) => ({
    ...network,
    children: network.children.filter((c) => !gone.has(c.name)),
    connections: network.connections.filter((c) => !gone.has(c.output) && !gone.has(c.input)),
    publishedPorts: (network.publishedPorts || []).filter((p) => !gone.has(p.child)),
    renderedChild: gone.has(network.renderedChild) ? null : network.renderedChild,
  }));
}

export function moveNode(doc, path, position) {
  return updateNode(doc, path, (node) => ({ ...node, position }));
}

/**
 * Connect output of `outputName` to `port` on `inputName`. An occupied
 * input port is replaced (both ancestors do this).
 */
export function connect(doc, parent, outputName, inputName, port) {
  return updateNode(doc, parent, (network) => ({
    ...network,
    connections: [
      ...network.connections.filter((c) => !(c.input === inputName && c.port === port)),
      { output: outputName, input: inputName, port },
    ],
  }));
}

export function disconnect(doc, parent, inputName, port) {
  return updateNode(doc, parent, (network) => ({
    ...network,
    connections: network.connections.filter((c) => !(c.input === inputName && c.port === port)),
  }));
}

/**
 * Set a port value on the node at `path`. Published network ports write
 * through to the referenced child, like Java. Numeric values are clamped
 * to the port's min/max.
 */
export function setPortValue(doc, registry, path, portName, value) {
  const node = getNode(doc, path);
  if (!node) return doc;
  if (node.type === NETWORK_TYPE) {
    const pub = (node.publishedPorts || []).find((p) => p.name === portName);
    if (!pub) return doc;
    return setPortValue(doc, registry, joinPath(path, pub.child), pub.port, value);
  }
  const port = nodePorts(registry, node).find((p) => p.name === portName);
  if (port && (port.type === "float" || port.type === "int")) {
    if (port.min !== undefined) value = Math.max(port.min, value);
    if (port.max !== undefined) value = Math.min(port.max, value);
    if (port.type === "int") value = Math.round(value);
  }
  return updateNode(doc, path, (n) => ({ ...n, values: { ...n.values, [portName]: value } }));
}

/** Reset a port to its type default. */
export function revertPortValue(doc, path, portName) {
  return updateNode(doc, path, (n) => {
    const values = { ...n.values };
    delete values[portName];
    return { ...n, values };
  });
}

export function setRenderedChild(doc, parent, name) {
  return updateNode(doc, parent, (network) => ({ ...network, renderedChild: name }));
}

/**
 * Publish a child's input port on the enclosing network. Connected child
 * ports are disconnected first (Java's rule).
 */
export function publishPort(doc, networkPath, childName, portName, publishedName) {
  return updateNode(doc, networkPath, (network) => ({
    ...network,
    connections: network.connections.filter(
      (c) => !(c.input === childName && c.port === portName),
    ),
    publishedPorts: [
      ...(network.publishedPorts || []),
      { name: publishedName, child: childName, port: portName },
    ],
  }));
}

export function unpublishPort(doc, networkPath, publishedName) {
  return updateNode(doc, networkPath, (network) => ({
    ...network,
    publishedPorts: (network.publishedPorts || []).filter((p) => p.name !== publishedName),
  }));
}

/**
 * Collapse a selection of sibling nodes into a new subnetwork, rewiring
 * outer connections: inbound connections become published ports, and if
 * exactly one selected node feeds unselected nodes, those connections are
 * re-pointed at the new network. (Java: NodeLibraryController.groupIntoNetwork.)
 * @returns {{doc: NodeBoxDocument, networkName: string}}
 */
export function groupIntoNetwork(doc, parent, names, registry) {
  const network = getNode(doc, parent);
  const selected = new Set(names);
  const inside = network.children.filter((c) => selected.has(c.name));
  if (inside.length === 0) return { doc, networkName: null };
  const center = {
    x: Math.round(inside.reduce((s, c) => s + c.position.x, 0) / inside.length),
    y: Math.round(inside.reduce((s, c) => s + c.position.y, 0) / inside.length),
  };
  const name = uniqueName(network, "network");
  const inner = [];
  const outer = [];
  for (const c of network.connections) {
    const outIn = selected.has(c.output);
    const inIn = selected.has(c.input);
    if (outIn && inIn) inner.push(c);
    else outer.push(c);
  }
  // The rendered child of the group: a selected node that feeds an
  // unselected node, else the network's rendered child if selected, else
  // the last selected node.
  const feedsOutside = outer.filter((c) => selected.has(c.output));
  const rendered =
    feedsOutside[0]?.output ||
    (selected.has(network.renderedChild) ? network.renderedChild : inside[inside.length - 1].name);

  const sub = {
    ...createNetwork(name, center),
    children: inside,
    connections: inner,
    renderedChild: rendered,
    publishedPorts: [],
  };
  const rewired = [];
  for (const c of outer) {
    if (selected.has(c.input)) {
      // Inbound: publish the port on the subnetwork and reconnect.
      const pubName = `${c.input}_${c.port}`;
      sub.publishedPorts.push({ name: pubName, child: c.input, port: c.port });
      rewired.push({ output: c.output, input: name, port: pubName });
    } else if (selected.has(c.output)) {
      // Outbound: the subnetwork's output replaces the node's.
      rewired.push({ output: name, input: c.input, port: c.port });
    } else {
      rewired.push(c);
    }
  }
  const newDoc = updateNode(doc, parent, (n) => ({
    ...n,
    children: [...n.children.filter((c) => !selected.has(c.name)), sub],
    connections: rewired,
    renderedChild: selected.has(n.renderedChild) ? name : n.renderedChild,
    publishedPorts: (n.publishedPorts || []).filter((p) => !selected.has(p.child)),
  }));
  return { doc: newDoc, networkName: name };
}

/** Add or replace a document code node. */
export function setFunctionSource(doc, name, source) {
  const functions = doc.functions.some((f) => f.name === name)
    ? doc.functions.map((f) => (f.name === name ? { ...f, source } : f))
    : [...doc.functions, { name, source }];
  return { ...doc, functions };
}

export function removeFunction(doc, name) {
  return { ...doc, functions: doc.functions.filter((f) => f.name !== name) };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------
//
// The document IS plain JSON, so serialization is trivial. loadDocument
// is the place for formatVersion migrations, following both ancestors'
// incremental-upgrade pattern (.ndbx upgrade1to2..., Live's upgrades.ts).

/** @returns {string} */
export function saveDocument(doc) {
  return JSON.stringify(doc, null, 2);
}

/**
 * @param {string|Object} json
 * @returns {NodeBoxDocument}
 */
export function loadDocument(json) {
  let doc = typeof json === "string" ? JSON.parse(json) : json;
  if (doc.type !== "nodebox") throw new Error("not a nodebox document");
  // Future: while (doc.formatVersion < FORMAT_VERSION) doc = UPGRADES[doc.formatVersion](doc);
  if (doc.formatVersion > FORMAT_VERSION) {
    throw new Error(`document format ${doc.formatVersion} is newer than this app`);
  }
  return doc;
}
