// nodebox/ui/app.js
// Top-level layout: viewer | (params / network editor), header with
// breadcrumb (Java's AddressBar), transport controls (AnimationBar) and
// document actions. Keyboard: ⌫ delete · ⌘Z/⌘⇧Z undo/redo · ⌘G group ·
// U up one network.

import { useEffect, useSyncExternalStore } from "react";
import { html } from "./html.js";
import { Viewer } from "./viewer.js";
import { NetworkEditor } from "./network-editor.js";
import { ParamsPanel } from "./params.js";
import { InsertDialog, FunctionsDialog } from "./dialogs.js";
import { DraggableNumber } from "./widgets.js";
import { createDemoDocument } from "./demo-doc.js";
import { toSVG } from "../core/graphics.js";
import * as M from "../core/model.js";
const { saveDocument } = M;

export function App({ store }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const { playing, frame, dialog, saveState, activePath } = state;

  // Animation loop.
  useEffect(() => {
    if (!playing) return;
    let raf = requestAnimationFrame(function loop() {
      store.tick();
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Keyboard shortcuts.
  useEffect(() => {
    function onKeyDown(e) {
      const t = e.target;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") store.closeDialog();
      else if ((e.key === "Delete" || e.key === "Backspace") && !mod) store.removeSelection();
      else if (mod && e.key.toLowerCase() === "z") (e.shiftKey ? store.redo() : store.undo());
      else if (mod && e.key.toLowerCase() === "g") store.groupSelection();
      else if (e.key === "u") {
        const s = store.getState();
        if (s.activePath !== "/") store.setActivePath(M.parentPath(s.activePath));
      } else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const crumbs = ["root", ...activePath.split("/").filter(Boolean)];

  return html`<div class="flex h-dvh flex-col bg-neutral-950 font-sans text-neutral-200">
    <header
      class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-800 px-3 py-1.5"
    >
      <a href="./" class="text-sm font-bold tracking-tight text-white hover:text-violet-300"
        >nodebox</a
      >
      <nav class="flex items-center gap-1 text-xs text-neutral-400">
        ${crumbs.map((c, i) => {
          const path = "/" + crumbs.slice(1, i + 1).join("/");
          const last = i === crumbs.length - 1;
          return html`<span key=${path} class="flex items-center gap-1">
            ${i > 0 && html`<span class="text-neutral-700">/</span>`}
            <button
              class=${last ? "text-neutral-100" : "hover:text-white"}
              onClick=${() => store.setActivePath(path)}
            >
              ${c}
            </button>
          </span>`;
        })}
      </nav>

      <div class="mx-auto"></div>

      <div class="flex items-center gap-1 text-xs">
        <${HeaderBtn} title="rewind (frame 1)" onClick=${() => store.rewind()}>⏮<//>
        <${HeaderBtn}
          title=${playing ? "pause" : "play"}
          onClick=${() => store.setPlaying(!playing)}
          >${playing ? "❚❚" : "▶"}<//
        >
        <span class="text-[10px] text-neutral-500">frame</span>
        <${DraggableNumber} int value=${frame} onChange=${(v) => store.setFrame(v)} />
      </div>

      <div class="flex items-center gap-1">
        <${HeaderBtn} title="insert node (double-click canvas)"
          onClick=${() => store.openDialog({ type: "insert", pos: { x: 60, y: 60 } })}
          >+ node<//
        >
        <${HeaderBtn} title="group selection into a subnetwork (⌘G)"
          onClick=${() => store.groupSelection()}
          >group<//
        >
        <${HeaderBtn} title="edit code nodes"
          onClick=${() => store.openDialog({ type: "functions" })}
          >ƒ<//
        >
        <${HeaderBtn} title="undo (⌘Z)" onClick=${() => store.undo()}>↶<//>
        <${HeaderBtn} title="redo (⌘⇧Z)" onClick=${() => store.redo()}>↷<//>
        <${HeaderBtn}
          title="export the current result as SVG"
          onClick=${() =>
            download(
              "nodebox.svg",
              toSVG(state.result, {
                width: state.doc.properties.width,
                height: state.doc.properties.height,
              }),
              "image/svg+xml",
            )}
          >svg<//
        >
        <${HeaderBtn}
          title="download the document as JSON"
          onClick=${() => download("nodebox-document.json", saveDocument(state.doc), "application/json")}
          >json<//
        >
        <${HeaderBtn}
          title="discard everything and restore the demo document"
          onClick=${() => {
            if (confirm("Reset to the demo document? Your changes will be lost.")) {
              store.resetToDemo(createDemoDocument());
            }
          }}
          >reset<//
        >
      </div>

      <span
        class=${"text-[10px] " + (saveState === "saved" ? "text-neutral-600" : "text-amber-400")}
        title="fake backend: saves to localStorage (see core/persistence.js)"
        >${saveState === "saved" ? "● saved" : "○ saving"}</span
      >
    </header>

    <main class="flex min-h-0 flex-1 flex-col md:flex-row">
      <section class="relative min-h-[38dvh] flex-1 md:min-h-0">
        <${Viewer} store=${store} state=${state} />
      </section>
      <section
        class="flex min-h-0 flex-1 flex-col border-t border-neutral-800 md:w-[440px] md:flex-none md:border-l md:border-t-0"
      >
        <div class="h-52 shrink-0 overflow-hidden border-b border-neutral-800 md:h-[45%]">
          <${ParamsPanel} store=${store} state=${state} />
        </div>
        <div class="min-h-0 flex-1">
          <${NetworkEditor} store=${store} state=${state} />
        </div>
      </section>
    </main>

    ${dialog?.type === "insert" && html`<${InsertDialog} store=${store} state=${state} />`}
    ${dialog?.type === "functions" && html`<${FunctionsDialog} store=${store} state=${state} />`}
  </div>`;
}

function HeaderBtn({ onClick, children, title }) {
  return html`<button
    class="border border-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
    title=${title}
    onClick=${onClick}
  >
    ${children}
  </button>`;
}
