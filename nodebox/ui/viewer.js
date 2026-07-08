// nodebox/ui/viewer.js
// The viewer: a Canvas2D surface drawing the rendered node's result via
// core/graphics.js. Canvas (not retained SVG like NodeBox Live) because
// list-matching graphs routinely emit thousands of shapes; SVG remains the
// export format. Origin is the canvas center, like both ancestors.
// Drag = pan, wheel = zoom, double-click = reset.

import { useEffect, useRef, useState } from "react";
import { html } from "./html.js";
import { drawValue } from "../core/graphics.js";

export function Viewer({ store, state }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const vpRef = useRef({ x: 0, y: 0, zoom: 1 });
  const dragRef = useRef(null);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const [, forceDraw] = useState(0);

  const { result, error, doc } = state;

  useEffect(() => {
    const el = wrapRef.current;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d");
    const vp = vpRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = doc.properties?.background || "#ffffff";
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.translate(size.w / 2 + vp.x, size.h / 2 + vp.y);
    ctx.scale(vp.zoom, vp.zoom);

    // Origin cross.
    ctx.strokeStyle = "rgba(128,128,128,0.25)";
    ctx.lineWidth = 1 / vp.zoom;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(10, 0);
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 10);
    ctx.stroke();

    try {
      drawValue(ctx, result);
    } catch {
      // Values that cannot be drawn are shown in the footer instead.
    }
  }, [result, size, doc]);

  function onPointerDown(e) {
    if (e.button !== 0) return;
    e.target.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, vp: { ...vpRef.current } };
  }

  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    vpRef.current.x = d.vp.x + (e.clientX - d.x);
    vpRef.current.y = d.vp.y + (e.clientY - d.y);
    forceDraw((n) => n + 1);
  }

  useEffect(() => {
    const el = canvasRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      const vp = vpRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      vp.zoom = Math.min(20, Math.max(0.05, vp.zoom * factor));
      forceDraw((n) => n + 1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const values = summarize(result);

  return html`<div ref=${wrapRef} class="relative h-full w-full overflow-hidden bg-white">
    <canvas
      ref=${canvasRef}
      class="block cursor-grab touch-none active:cursor-grabbing"
      style=${{ width: size.w + "px", height: size.h + "px" }}
      onPointerDown=${onPointerDown}
      onPointerMove=${onPointerMove}
      onPointerUp=${() => (dragRef.current = null)}
      onDoubleClick=${() => {
        vpRef.current = { x: 0, y: 0, zoom: 1 };
        forceDraw((n) => n + 1);
      }}
    />
    <div
      class="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-between px-2 py-1 text-[10px] text-neutral-500"
    >
      <span>${values}</span>
      <span>${Math.round(vpRef.current.zoom * 100)}%</span>
    </div>
    ${error &&
    html`<div
      class="absolute left-2 top-2 max-w-[80%] border border-red-500 bg-red-950/90 px-2 py-1 text-[11px] text-red-200"
    >
      <span class="font-semibold">${error.path}</span> — ${error.message}
    </div>`}
  </div>`;
}

function summarize(result) {
  if (!result || result.length === 0) return "no result";
  const first = result[0];
  let kind = typeof first;
  if (first && typeof first === "object") {
    kind = first.type === "path" || first.type === "group" ? "shape" : "r" in first ? "color" : "point";
  }
  if (kind === "number" || kind === "string" || kind === "boolean") {
    const preview = result
      .slice(0, 8)
      .map((v) => (typeof v === "number" ? Math.round(v * 100) / 100 : JSON.stringify(v)))
      .join(", ");
    return `${result.length} × ${kind}: ${preview}${result.length > 8 ? ", …" : ""}`;
  }
  return `${result.length} × ${kind}`;
}
