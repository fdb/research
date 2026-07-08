// nodebox/ui/dialogs.js
// InsertDialog — the fuzzy node-search insert dialog (Java's
// NodeSelectionDialog, the primary creation flow). FunctionsDialog — the
// code-node editor (NodeBox Live's CodeMirror pane, as a plain textarea
// to stay dependency-light).

import { useEffect, useMemo, useRef, useState } from "react";
import { html } from "./html.js";
import * as M from "../core/model.js";
import { TYPE_COLORS } from "./network-editor.js";
import { Btn } from "./params.js";

export function InsertDialog({ store, state }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);
  const { registry, dialog } = state;

  const entries = useMemo(() => {
    const all = [
      ...[...registry.values()].map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        description: t.description || "",
        outputType: t.outputType,
      })),
      {
        id: M.NETWORK_TYPE,
        name: "network",
        category: "core",
        description: "An empty subnetwork — group nodes inside, publish ports.",
        outputType: "list",
      },
    ];
    const q = query.toLowerCase().trim();
    const matches = q
      ? all
          .filter(
            (t) =>
              t.name.toLowerCase().includes(q) ||
              t.category.toLowerCase().includes(q) ||
              t.description.toLowerCase().includes(q),
          )
          .sort((a, b) => rank(a, q) - rank(b, q))
      : all;
    return matches.slice(0, 60);
  }, [registry, query]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setIndex(0), [query]);

  function insert(entry) {
    store.addNode(entry.id, dialog.pos || { x: 40, y: 40 });
    store.closeDialog();
  }

  return html`<${Overlay} onClose=${() => store.closeDialog()}>
    <input
      ref=${inputRef}
      class="w-full border-b border-neutral-700 bg-transparent px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none"
      placeholder="Search nodes… (rect, wave, scatter, gear)"
      value=${query}
      onChange=${(e) => setQuery(e.target.value)}
      onKeyDown=${(e) => {
        if (e.key === "ArrowDown") setIndex(Math.min(entries.length - 1, index + 1));
        else if (e.key === "ArrowUp") setIndex(Math.max(0, index - 1));
        else if (e.key === "Enter" && entries[index]) insert(entries[index]);
        else if (e.key === "Escape") store.closeDialog();
        else return;
        e.preventDefault();
      }}
    />
    <div class="max-h-72 overflow-y-auto">
      ${entries.map(
        (t, i) => html`<button
          key=${t.id}
          class=${"flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs " +
          (i === index ? "bg-neutral-800" : "hover:bg-neutral-900")}
          onPointerEnter=${() => setIndex(i)}
          onClick=${() => insert(t)}
        >
          <span
            class="inline-block h-2 w-2 shrink-0"
            style=${{ background: TYPE_COLORS[t.outputType] || "#888" }}
          ></span>
          <span class="text-neutral-100">${t.name}</span>
          <span class="text-[10px] text-neutral-500">${t.category}</span>
          <span class="ml-auto truncate text-[10px] text-neutral-600">${t.description}</span>
        </button>`,
      )}
      ${entries.length === 0 &&
      html`<div class="px-3 py-3 text-xs text-neutral-600">No nodes match “${query}”.</div>`}
    </div>
  <//>`;
}

function rank(t, q) {
  if (t.name.toLowerCase().startsWith(q)) return 0;
  if (t.name.toLowerCase().includes(q)) return 1;
  return 2;
}

const FUNCTION_TEMPLATE = `// New code node. Declare ports as data, export the node function.
// List-matching maps it over lists automatically.
import { makePath } from "nodebox:graphics";

export const node = {
  name: "NAME",
  description: "What it does.",
  category: "custom",
  outputType: "shape",
  ports: [
    { name: "position", type: "point" },
    { name: "size", type: "float", value: 100, min: 0 },
  ],
};

export default function NAME(position, size) {
  const s = size / 2;
  return makePath([
    { type: "M", x: position.x, y: position.y - s },
    { type: "L", x: position.x + s, y: position.y + s },
    { type: "L", x: position.x - s, y: position.y + s },
    { type: "Z" },
  ]);
}
`;

export function FunctionsDialog({ store, state }) {
  const { doc, functionErrors, dialog } = state;
  const [selected, setSelected] = useState(dialog.name || doc.functions[0]?.name || null);
  const current = doc.functions.find((f) => f.name === selected);
  const [source, setSource] = useState(current?.source || "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setSource(current?.source || "");
    setDirty(false);
  }, [selected]);

  async function apply() {
    if (!selected) return;
    await store.setFunctionSource(selected, source);
    setDirty(false);
  }

  function addNew() {
    const name = prompt("Function name (lowercase, no spaces):", "my_node");
    if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) return;
    store.setFunctionSource(name, FUNCTION_TEMPLATE.replace(/NAME/g, name));
    setSelected(name);
  }

  const error = selected && functionErrors[selected];

  return html`<${Overlay} wide onClose=${() => store.closeDialog()}>
    <div class="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
      <span class="text-sm font-semibold text-neutral-100">Code nodes ƒ</span>
      <span class="text-[10px] text-neutral-500"
        >ES modules stored in the document · registered as local.*</span
      >
    </div>
    <div class="flex" style=${{ height: "420px" }}>
      <div class="w-40 shrink-0 overflow-y-auto border-r border-neutral-800">
        ${doc.functions.map(
          (f) => html`<button
            key=${f.name}
            class=${"block w-full px-3 py-1.5 text-left text-xs " +
            (f.name === selected ? "bg-neutral-800 text-white" : "text-neutral-400 hover:bg-neutral-900")}
            onClick=${() => setSelected(f.name)}
          >
            ƒ ${f.name} ${functionErrors[f.name] ? html`<span class="text-red-400">!</span>` : ""}
          </button>`,
        )}
        <button
          class="block w-full px-3 py-1.5 text-left text-xs text-neutral-500 hover:text-neutral-200"
          onClick=${addNew}
        >
          + new function
        </button>
      </div>
      <div class="flex min-w-0 flex-1 flex-col">
        ${current
          ? html`<textarea
                class="min-h-0 flex-1 resize-none bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-neutral-200 focus:outline-none"
                spellCheck=${false}
                value=${source}
                onChange=${(e) => {
                  setSource(e.target.value);
                  setDirty(true);
                }}
                onKeyDown=${(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") apply();
                }}
              ></textarea>
              <div class="flex items-center gap-2 border-t border-neutral-800 px-3 py-2">
                <${Btn} onClick=${apply}>${dirty ? "apply (⌘↩)" : "applied"}<//>
                <${Btn}
                  onClick=${() => {
                    store.apply((d) => M.removeFunction(d, selected));
                    store.recompileFunctions();
                    setSelected(null);
                  }}
                  >delete<//
                >
                ${error && html`<span class="truncate text-[11px] text-red-400">${error}</span>`}
              </div>`
          : html`<div class="p-4 text-xs text-neutral-600">
              No code nodes yet — create one. It becomes insertable from the node dialog under
              “custom”.
            </div>`}
      </div>
    </div>
  <//>`;
}

function Overlay({ children, onClose, wide }) {
  return html`<div
    class="absolute inset-0 z-20 flex items-start justify-center bg-black/60 pt-16"
    onPointerDown=${(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    <div
      class=${"border border-neutral-700 bg-neutral-950 shadow-2xl " +
      (wide ? "w-[720px] max-w-[95vw]" : "w-[480px] max-w-[95vw]")}
    >
      ${children}
    </div>
  </div>`;
}
