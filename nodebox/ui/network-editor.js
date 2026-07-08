// nodebox/ui/network-editor.js
// The network editor: one Canvas2D element (NodeBox Live's approach — it
// comfortably draws hundreds of nodes), with the interactions both
// ancestors converged on:
//   drag node = move (grid-snapped) · drag from bottom edge = connect
//   drag a connected input = detach & re-plug · double-click node =
//   render it (networks: enter) · double-click canvas = insert dialog
//   wheel = zoom · drag empty space = pan

import { useEffect, useRef, useState } from "react";
import { html } from "./html.js";
import * as M from "../core/model.js";

export const NODE_W = 110;
export const NODE_H = 28;
const PORT_ZONE = 8; // hit zone height for port strips
const SNAP = 10;

export const TYPE_COLORS = {
  float: "#7dd3fc",
  int: "#7dd3fc",
  string: "#fbbf24",
  boolean: "#f472b6",
  point: "#4ade80",
  color: "#e879f9",
  shape: "#a78bfa",
  list: "#9ca3af",
  context: "#64748b",
};

export function NetworkEditor({ store, state }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const viewports = useRef(new Map()); // activePath -> {x, y, zoom}
  const [drag, setDrag] = useState(null);
  const [hover, setHover] = useState(null);
  const [size, setSize] = useState({ w: 300, h: 300 });

  const { doc, activePath, selection, registry, error } = state;
  const network = M.getNode(doc, activePath) || doc.root;

  function viewport() {
    if (!viewports.current.has(activePath)) {
      viewports.current.set(activePath, { x: 30, y: 16, zoom: 1 });
    }
    return viewports.current.get(activePath);
  }

  const toWorld = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const vp = viewport();
    return {
      x: (e.clientX - rect.left - vp.x) / vp.zoom,
      y: (e.clientY - rect.top - vp.y) / vp.zoom,
    };
  };

  // --- geometry helpers ----------------------------------------------------

  const inputPorts = (node) =>
    M.nodePorts(registry, node).filter((p) => p.type !== "context");

  function inputPortPos(node, ports, i) {
    return {
      x: node.position.x + (NODE_W * (i + 0.5)) / ports.length,
      y: node.position.y,
    };
  }

  function outputPortPos(node) {
    return { x: node.position.x + NODE_W / 2, y: node.position.y + NODE_H };
  }

  function nodeAt(w) {
    const children = network.children || [];
    for (let i = children.length - 1; i >= 0; i--) {
      const n = children[i];
      if (
        w.x >= n.position.x &&
        w.x <= n.position.x + NODE_W &&
        w.y >= n.position.y - PORT_ZONE / 2 &&
        w.y <= n.position.y + NODE_H + PORT_ZONE / 2
      ) {
        return n;
      }
    }
    return null;
  }

  function portHit(node, w) {
    const ports = inputPorts(node);
    if (w.y <= node.position.y + PORT_ZONE && ports.length > 0) {
      const i = Math.min(
        ports.length - 1,
        Math.max(0, Math.floor(((w.x - node.position.x) / NODE_W) * ports.length)),
      );
      return { kind: "input", port: ports[i], index: i };
    }
    if (w.y >= node.position.y + NODE_H - PORT_ZONE) return { kind: "output" };
    return null;
  }

  /** Best compatible input port when dropping a connection onto a node. */
  function dropTargetPort(fromNode, toNode, w) {
    if (!toNode || toNode.name === fromNode) return null;
    const outType = M.nodeOutputType(registry, network.children.find((c) => c.name === fromNode));
    const ports = inputPorts(toNode);
    const compatible = ports.filter((p) => M.isTypeCompatible(outType, p.type));
    if (compatible.length === 0) return null;
    const hit = portHit(toNode, w);
    if (hit && hit.kind === "input" && compatible.includes(hit.port)) return hit.port;
    // Nearest compatible port by x.
    let best = compatible[0];
    let bestDist = Infinity;
    for (const p of compatible) {
      const i = ports.indexOf(p);
      const d = Math.abs(inputPortPos(toNode, ports, i).x - w.x);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  // --- interactions ----------------------------------------------------------

  function onPointerDown(e) {
    if (e.button !== 0) return;
    canvasRef.current.setPointerCapture(e.pointerId);
    const w = toWorld(e);
    const node = nodeAt(w);
    if (node) {
      const hit = portHit(node, w);
      if (hit && hit.kind === "output") {
        setDrag({ mode: "connect", from: node.name, to: w });
        return;
      }
      if (hit && hit.kind === "input") {
        const conn = (network.connections || []).find(
          (c) => c.input === node.name && c.port === hit.port.name,
        );
        if (conn) {
          // Detach and re-drag from the upstream output (Java behavior).
          store.disconnect(node.name, hit.port.name);
          setDrag({ mode: "connect", from: conn.output, to: w });
          return;
        }
      }
      let names = selection.includes(node.name) ? selection : [node.name];
      if (e.shiftKey) {
        names = selection.includes(node.name)
          ? selection.filter((n) => n !== node.name)
          : [...selection, node.name];
      }
      store.setSelection(names);
      const positions = new Map(
        (network.children || [])
          .filter((c) => names.includes(c.name))
          .map((c) => [c.name, c.position]),
      );
      setDrag({ mode: "move", start: w, positions, moved: false });
    } else {
      const vp = viewport();
      setDrag({ mode: "pan", start: { x: e.clientX, y: e.clientY }, vp: { ...vp }, moved: false });
    }
  }

  function onPointerMove(e) {
    const w = toWorld(e);
    if (!drag) {
      const node = nodeAt(w);
      const hit = node && portHit(node, w);
      setHover(
        node && hit && hit.kind === "input"
          ? { node: node.name, port: hit.port, pos: inputPortPos(node, inputPorts(node), hit.index) }
          : null,
      );
      return;
    }
    if (drag.mode === "move") {
      const dx = w.x - drag.start.x;
      const dy = w.y - drag.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 2 || drag.moved) {
        setDrag({ ...drag, moved: true });
        store.moveSelection(dx, dy, drag.positions);
      }
    } else if (drag.mode === "pan") {
      const vp = viewport();
      vp.x = drag.vp.x + (e.clientX - drag.start.x);
      vp.y = drag.vp.y + (e.clientY - drag.start.y);
      setDrag({ ...drag, moved: true });
    } else if (drag.mode === "connect") {
      setDrag({ ...drag, to: w });
    }
  }

  function onPointerUp(e) {
    const w = toWorld(e);
    if (drag?.mode === "connect") {
      const target = nodeAt(w);
      const port = dropTargetPort(drag.from, target, w);
      if (target && port) store.connect(drag.from, target.name, port.name);
    } else if (drag?.mode === "pan" && !drag.moved) {
      store.setSelection([]);
    }
    setDrag(null);
  }

  function onDoubleClick(e) {
    const w = toWorld(e);
    const node = nodeAt(w);
    if (!node) {
      store.openDialog({ type: "insert", pos: { x: Math.round(w.x / SNAP) * SNAP, y: Math.round(w.y / SNAP) * SNAP } });
    } else if (node.type === M.NETWORK_TYPE) {
      store.setActivePath(M.joinPath(activePath, node.name));
    } else {
      store.setRenderedChild(node.name);
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const vp = viewport();
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const zoom = Math.min(3, Math.max(0.2, vp.zoom * factor));
    // Keep the world point under the cursor fixed.
    vp.x = mx - ((mx - vp.x) / vp.zoom) * zoom;
    vp.y = my - ((my - vp.y) / vp.zoom) * zoom;
    vp.zoom = zoom;
    setDrag((d) => (d ? { ...d } : null));
    setHover((h) => (h ? { ...h } : { refresh: Math.random() }));
  }

  // --- size tracking ---------------------------------------------------------

  useEffect(() => {
    const el = wrapRef.current;
    const observer = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- drawing ---------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d");
    const vp = viewport();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.translate(vp.x, vp.y);
    ctx.scale(vp.zoom, vp.zoom);

    // Grid dots.
    if (vp.zoom > 0.4) {
      const step = 20;
      const x0 = Math.floor(-vp.x / vp.zoom / step) * step;
      const y0 = Math.floor(-vp.y / vp.zoom / step) * step;
      const x1 = x0 + size.w / vp.zoom + step;
      const y1 = y0 + size.h / vp.zoom + step;
      ctx.fillStyle = "#232323";
      for (let x = x0; x < x1; x += step) {
        for (let y = y0; y < y1; y += step) ctx.fillRect(x, y, 1.5, 1.5);
      }
    }

    const children = network.children || [];
    const byName = new Map(children.map((c) => [c.name, c]));

    // Connections.
    for (const conn of network.connections || []) {
      const from = byName.get(conn.output);
      const to = byName.get(conn.input);
      if (!from || !to) continue;
      const ports = inputPorts(to);
      const i = ports.findIndex((p) => p.name === conn.port);
      if (i < 0) continue;
      const p1 = outputPortPos(from);
      const p2 = inputPortPos(to, ports, i);
      drawWire(ctx, p1, p2, TYPE_COLORS[M.nodeOutputType(registry, from)] || "#888");
    }

    // Ghost connection while dragging.
    if (drag?.mode === "connect") {
      const from = byName.get(drag.from);
      if (from) {
        const target = nodeAt(drag.to);
        const port = dropTargetPort(drag.from, target, drag.to);
        const end = port
          ? inputPortPos(target, inputPorts(target), inputPorts(target).indexOf(port))
          : drag.to;
        drawWire(ctx, outputPortPos(from), end, "#ffffff88");
        if (port) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(end.x - 5, end.y - 3, 10, 5);
        }
      }
    }

    // Nodes.
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const nodeInst of children) {
      const { x, y } = nodeInst.position;
      const selected = selection.includes(nodeInst.name);
      const rendered = network.renderedChild === nodeInst.name;
      const path = M.joinPath(activePath, nodeInst.name);
      const hasError = error && (error.path === path || error.path.startsWith(path + "/"));
      const isNet = nodeInst.type === M.NETWORK_TYPE;
      const isLocal = nodeInst.type.startsWith("local.");

      ctx.fillStyle = isNet ? "#20242e" : "#262626";
      ctx.fillRect(x, y, NODE_W, NODE_H);
      ctx.strokeStyle = hasError ? "#ef4444" : selected ? "#e5e5e5" : "#3f3f3f";
      ctx.lineWidth = selected || hasError ? 1.5 : 1;
      ctx.strokeRect(x + 0.5, y + 0.5, NODE_W - 1, NODE_H - 1);

      // Input port ticks.
      const ports = inputPorts(nodeInst);
      ports.forEach((p, i) => {
        const pp = inputPortPos(nodeInst, ports, i);
        ctx.fillStyle = TYPE_COLORS[p.type] || "#888";
        ctx.fillRect(pp.x - 4, pp.y, 8, 3);
      });
      // Output tick.
      const op = outputPortPos(nodeInst);
      ctx.fillStyle = TYPE_COLORS[M.nodeOutputType(registry, nodeInst)] || "#888";
      ctx.fillRect(op.x - 6, op.y - 3, 12, 3);

      // Label.
      ctx.fillStyle = rendered ? "#ffffff" : "#b8b8b8";
      const label = `${isLocal ? "ƒ " : ""}${nodeInst.name}${isNet ? " ▸" : ""}`;
      ctx.fillText(truncate(ctx, label, NODE_W - 18), x + 7, y + NODE_H / 2 + 0.5);
      if (rendered) {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(x + NODE_W - 9, y + NODE_H / 2, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Port tooltip.
    if (hover?.port) {
      const text = `${hover.port.name} · ${hover.port.type}${hover.port.range === "list" ? " (list)" : ""}`;
      ctx.font = "10px system-ui, sans-serif";
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = "#000000dd";
      ctx.fillRect(hover.pos.x - w / 2, hover.pos.y - 22, w, 16);
      ctx.fillStyle = "#eee";
      ctx.textAlign = "center";
      ctx.fillText(text, hover.pos.x, hover.pos.y - 14);
      ctx.textAlign = "left";
    }
  }, [doc, network, selection, drag, hover, size, activePath, error]);

  // Non-passive wheel listener (React's onWheel is passive).
  useEffect(() => {
    const el = canvasRef.current;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  return html`<div ref=${wrapRef} class="relative h-full w-full overflow-hidden">
    <canvas
      ref=${canvasRef}
      class="block touch-none"
      style=${{ width: size.w + "px", height: size.h + "px" }}
      onPointerDown=${onPointerDown}
      onPointerMove=${onPointerMove}
      onPointerUp=${onPointerUp}
      onDoubleClick=${onDoubleClick}
    />
  </div>`;
}

function drawWire(ctx, p1, p2, color) {
  const dy = Math.max(25, Math.abs(p2.y - p1.y) / 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.bezierCurveTo(p1.x, p1.y + dy, p2.x, p2.y - dy, p2.x, p2.y);
  ctx.stroke();
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > maxWidth) {
    text = text.slice(0, -1);
  }
  return text + "…";
}
