// nodebox/ui/store.js
// One tiny external store for the whole editor (subscribe/getState/actions),
// consumed from React via useSyncExternalStore. The document itself is the
// immutable value from core/model.js, so undo/redo is a snapshot stack with
// structural sharing (both ancestors did the same), and drag gestures
// coalesce into one undo entry by key + time window (NodeBox Live's trick).

import * as M from "../core/model.js";
import { createRenderer } from "../core/eval.js";
import { BUILTIN_TYPES } from "../core/stdlib.js";
import { createAutoSaver, loadProject, saveProject } from "../core/persistence.js";

const UNDO_COALESCE_MS = 500;
const PROJECT_ID = "demo";

export function createStore(initialDoc) {
  const registry = M.createRegistry(BUILTIN_TYPES);
  const renderer = createRenderer(registry);
  const autoSave = createAutoSaver(1000);

  let state = {
    doc: initialDoc,
    registry,
    activePath: "/", // the network being edited
    selection: [], // node names within the active network
    frame: 1,
    playing: false,
    result: [], // last evaluation result (list)
    error: null, // {path, message} | null
    functionErrors: {}, // code-node name -> compile error
    saveState: "saved", // 'saved' | 'saving'
    dialog: null, // null | {type:'insert', x, y} | {type:'functions', name?}
  };

  const listeners = new Set();
  let undoStack = [];
  let redoStack = [];
  let lastUndo = { key: null, time: 0 };

  function emit() {
    for (const l of listeners) l();
  }

  function set(partial) {
    state = { ...state, ...partial };
    emit();
  }

  function evaluate() {
    const { value, error } = renderer.render(state.doc, state.activePath, {
      frame: state.frame,
    });
    set({ result: value, error });
  }

  /**
   * Apply a pure document transform. `undoKey` groups rapid edits (drags,
   * scrubs) into a single undo entry.
   */
  function apply(fn, undoKey = null) {
    const doc = fn(state.doc);
    if (doc === state.doc) return;
    const now = Date.now();
    const coalesce =
      undoKey && lastUndo.key === undoKey && now - lastUndo.time < UNDO_COALESCE_MS;
    if (!coalesce) undoStack.push(state.doc);
    lastUndo = { key: undoKey, time: now };
    redoStack = [];
    state = { ...state, doc, saveState: "saving" };
    evaluate();
    autoSave(PROJECT_ID, doc, () => set({ saveState: "saved" }));
  }

  async function recompileFunctions() {
    // Rebuild local.* types from the document's code nodes.
    for (const id of [...registry.keys()]) if (id.startsWith("local.")) registry.delete(id);
    const functionErrors = await M.compileDocumentFunctions(registry, state.doc);
    renderer.clearCache();
    set({ functionErrors });
    evaluate();
  }

  const store = {
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState: () => state,
    registry,

    // --- navigation & selection -------------------------------------------
    setActivePath(path) {
      set({ activePath: path, selection: [] });
      evaluate();
    },
    setSelection(selection) {
      set({ selection });
    },

    // --- document edits ----------------------------------------------------
    apply,
    addNode(typeId, position) {
      const network = M.getNode(state.doc, state.activePath);
      const base = typeId.startsWith("local.")
        ? typeId.slice(6)
        : typeId === M.NETWORK_TYPE
          ? "network"
          : typeId.split(".")[1];
      const name = M.uniqueName(network, base);
      apply((doc) => M.addNode(doc, state.activePath, M.createNode(typeId, name, position)));
      set({ selection: [name] });
      return name;
    },
    removeSelection() {
      if (state.selection.length === 0) return;
      apply((doc) => M.removeNodes(doc, state.activePath, state.selection));
      set({ selection: [] });
    },
    moveSelection(dx, dy, positions) {
      // positions: Map name -> original position at drag start
      apply(
        (doc) =>
          state.selection.reduce((d, name) => {
            const p = positions.get(name);
            return p
              ? M.moveNode(d, M.joinPath(state.activePath, name), {
                  x: Math.round((p.x + dx) / 10) * 10,
                  y: Math.round((p.y + dy) / 10) * 10,
                })
              : d;
          }, doc),
        `move:${state.selection.join(",")}`,
      );
    },
    connect(outputName, inputName, port) {
      apply((doc) => M.connect(doc, state.activePath, outputName, inputName, port));
    },
    disconnect(inputName, port) {
      apply((doc) => M.disconnect(doc, state.activePath, inputName, port));
    },
    setPortValue(nodeName, portName, value, scrub = false) {
      apply(
        (doc) =>
          M.setPortValue(
            doc,
            registry,
            M.joinPath(state.activePath, nodeName),
            portName,
            value,
          ),
        scrub ? `value:${nodeName}.${portName}` : null,
      );
    },
    setRenderedChild(name) {
      apply((doc) => M.setRenderedChild(doc, state.activePath, name));
    },
    publishPort(childName, portName) {
      const network = M.getNode(state.doc, state.activePath);
      const taken = new Set((network.publishedPorts || []).map((p) => p.name));
      let name = portName;
      for (let i = 2; taken.has(name); i++) name = `${portName}${i}`;
      apply((doc) => M.publishPort(doc, state.activePath, childName, portName, name));
    },
    unpublishPort(publishedName) {
      apply((doc) => M.unpublishPort(doc, state.activePath, publishedName));
    },
    groupSelection() {
      if (state.selection.length === 0) return;
      let networkName = null;
      apply((doc) => {
        const r = M.groupIntoNetwork(doc, state.activePath, state.selection, registry);
        networkName = r.networkName;
        return r.doc;
      });
      if (networkName) set({ selection: [networkName] });
    },
    async setFunctionSource(name, source) {
      apply((doc) => M.setFunctionSource(doc, name, source));
      await recompileFunctions();
    },
    recompileFunctions,

    // --- undo/redo -----------------------------------------------------
    undo() {
      if (undoStack.length === 0) return;
      redoStack.push(state.doc);
      const doc = undoStack.pop();
      lastUndo = { key: null, time: 0 };
      state = { ...state, doc, selection: [] };
      if (!M.getNode(doc, state.activePath)) state.activePath = "/";
      evaluate();
    },
    redo() {
      if (redoStack.length === 0) return;
      undoStack.push(state.doc);
      const doc = redoStack.pop();
      state = { ...state, doc, selection: [] };
      if (!M.getNode(doc, state.activePath)) state.activePath = "/";
      evaluate();
    },

    // --- animation -------------------------------------------------------
    setFrame(frame) {
      state = { ...state, frame: Math.max(0, Math.round(frame)) };
      evaluate();
    },
    setPlaying(playing) {
      set({ playing });
    },
    tick() {
      state = { ...state, frame: state.frame + 1 };
      evaluate();
    },
    rewind() {
      store.setFrame(1);
    },

    // --- dialogs ---------------------------------------------------------
    openDialog(dialog) {
      set({ dialog });
    },
    closeDialog() {
      set({ dialog: null });
    },

    // --- persistence (fake backend) ---------------------------------------
    async loadSaved() {
      const saved = await loadProject(PROJECT_ID);
      if (saved) {
        try {
          state = { ...state, doc: M.loadDocument(saved), activePath: "/", selection: [] };
        } catch {
          return; // corrupt/newer save: keep the demo doc
        }
        await recompileFunctions();
      }
    },
    async resetToDemo(demoDoc) {
      undoStack = [];
      redoStack = [];
      state = { ...state, doc: demoDoc, activePath: "/", selection: [], frame: 1 };
      await saveProject(PROJECT_ID, demoDoc);
      await recompileFunctions();
    },

    evaluate,
  };
  return store;
}
