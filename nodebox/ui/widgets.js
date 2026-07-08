// nodebox/ui/widgets.js
// Parameter widgets. The star is DraggableNumber — scrub any numeric label
// horizontally to change it, double-click to type (NodeBox's DraggableNumber
// / Live's number-widget, the single most-loved interaction in both).

import { useRef, useState } from "react";
import { html } from "./html.js";
import { toCSS } from "../core/graphics.js";

/**
 * @param {{value: number, onChange: (v: number, scrub: boolean) => void,
 *   step?: number, int?: boolean}} props
 */
export function DraggableNumber({ value, onChange, step, int = false }) {
  const [editing, setEditing] = useState(null); // string while typing
  const drag = useRef(null);

  const effectiveStep = step !== undefined ? step : int ? 1 : 1;

  if (editing !== null) {
    return html`<input
      class="w-16 bg-neutral-900 border border-neutral-600 px-1 py-0 text-xs text-neutral-100 focus:outline-none focus:border-neutral-400"
      autoFocus
      value=${editing}
      onChange=${(e) => setEditing(e.target.value)}
      onBlur=${() => commit()}
      onKeyDown=${(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(null);
      }}
    />`;
  }

  function commit() {
    const v = parseFloat(editing);
    if (!Number.isNaN(v)) onChange(int ? Math.round(v) : v, false);
    setEditing(null);
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startValue: value, moved: false };
  }

  function onPointerMove(e) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) < 3 && !drag.current.moved) return; // click threshold
    drag.current.moved = true;
    const scale = e.shiftKey ? 10 : e.altKey ? 0.01 : 0.1;
    let v = drag.current.startValue + dx * effectiveStep * scale * 10;
    if (int) v = Math.round(v);
    onChange(v, true);
  }

  function onPointerUp(e) {
    if (drag.current && !drag.current.moved) setEditing(String(fmt(value)));
    drag.current = null;
  }

  return html`<span
    class="inline-block min-w-14 cursor-ew-resize select-none border border-transparent px-1 text-xs tabular-nums text-neutral-100 hover:border-neutral-600 hover:bg-neutral-800"
    title="drag to change · click to type · shift=coarse alt=fine"
    onPointerDown=${onPointerDown}
    onPointerMove=${onPointerMove}
    onPointerUp=${onPointerUp}
    >${fmt(value)}</span
  >`;
}

function fmt(v) {
  if (typeof v !== "number" || Number.isNaN(v)) return 0;
  return Math.abs(v) >= 1000 ? Math.round(v) : Math.round(v * 100) / 100;
}

/** Two DraggableNumbers for a point value. */
export function PointWidget({ value, onChange }) {
  const p = value || { x: 0, y: 0 };
  return html`<span class="flex items-center gap-1">
    <${DraggableNumber} value=${p.x} onChange=${(x, s) => onChange({ ...p, x }, s)} />
    <${DraggableNumber} value=${p.y} onChange=${(y, s) => onChange({ ...p, y }, s)} />
  </span>`;
}

/** Color swatch + native picker + alpha scrub. */
export function ColorWidget({ value, onChange }) {
  const c = value || { r: 0, g: 0, b: 0, a: 1 };
  const hex =
    "#" +
    [c.r, c.g, c.b]
      .map((v) =>
        Math.round(Math.max(0, Math.min(1, v)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  return html`<span class="flex items-center gap-2">
    <span class="relative inline-block h-5 w-8 border border-neutral-600" style=${{
      background: toCSS(c),
    }}>
      <input
        type="color"
        class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        value=${hex}
        onChange=${(e) => {
          const n = parseInt(e.target.value.slice(1), 16);
          onChange({ r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: c.a });
        }}
      />
    </span>
    <span class="text-[10px] text-neutral-500">a</span>
    <${DraggableNumber} value=${c.a} step=${0.01} onChange=${(a, s) =>
      onChange({ ...c, a: Math.max(0, Math.min(1, a)) }, s)} />
  </span>`;
}
