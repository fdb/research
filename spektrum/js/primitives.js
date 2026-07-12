/*
 * primitives.js — station I: text, pure functions, mini-notation.
 *
 * A single editor over the shared VFS files (scene/pattern.js and
 * scene/visual.glsl). Ctrl+Enter runs the block under the cursor.
 * The agent station edits the same files; changes made elsewhere
 * appear here live.
 */

import { Editor } from "./editor.js";
import * as vfs from "./vfs.js";

const FILES = ["scene/pattern.js", "scene/visual.glsl"];

export function mountPrimitives(root, runtime) {
  root.innerHTML = "";
  const pane = document.createElement("div");
  pane.className = "prim";
  root.appendChild(pane);

  const tabs = document.createElement("div");
  tabs.className = "tabs";
  pane.appendChild(tabs);

  const edHost = document.createElement("div");
  edHost.className = "prim-editor";
  pane.appendChild(edHost);

  const status = document.createElement("div");
  status.className = "statusline";
  status.textContent = "ctrl+enter — run block · ctrl+shift+enter — run all · esc — hush";
  pane.appendChild(status);

  let current = FILES[0];

  const editor = new Editor(edHost, {
    onRun(code, { all }) {
      let res;
      if (current.endsWith(".glsl")) {
        // shaders only make sense whole
        res = runtime.runShader(editor.value);
      } else {
        res = runtime.runCode(code);
      }
      setStatus(res.ok ? okMessage(all) : res.error, !res.ok);
      return res;
    },
    onSave(text) {
      squelch = true;
      vfs.write(current, text);
      squelch = false;
    },
  });

  let squelch = false;

  function okMessage(all) {
    const s = runtime.status();
    const slots = s.activeSlots.length ? `playing: ${s.activeSlots.join(" ")}` : "silence";
    return `${all ? "buffer" : "block"} ok · ${slots} · ${s.bpm} bpm`;
  }

  function setStatus(msg, isError = false) {
    status.textContent = msg;
    status.classList.toggle("error", isError);
  }

  function renderTabs() {
    tabs.innerHTML = "";
    for (const f of FILES) {
      const b = document.createElement("button");
      b.textContent = f.split("/").pop();
      b.className = f === current ? "tab active" : "tab";
      b.onclick = () => openFile(f);
      tabs.appendChild(b);
    }
  }

  function openFile(f) {
    current = f;
    editor.value = vfs.read(f) ?? "";
    renderTabs();
    editor.focus();
  }

  // reflect changes coming from other stations (agent, scenes)
  const unsub = vfs.onChange((path) => {
    if (squelch) return;
    if (path === null || path === current) {
      const text = vfs.read(current) ?? "";
      if (text !== editor.value) editor.value = text;
    }
  });

  runtime.onError((err) => {
    if (err) setStatus(err, true);
  });

  openFile(current);

  return {
    runAll: () => editor.run(true),
    destroy: () => unsub(),
    focus: () => editor.focus(),
  };
}
