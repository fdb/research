// Project state: the document being edited, selection, undo, persistence,
// and re-evaluation of tex/mesh stacks into GL resources.

import { evalTexture, evalMesh } from './engine.js';
import { makeOp } from './ops.js';

const SAVE_KEY = 'baukasten.project';

export const state = {
  project: null,
  page: 'tex',
  sel: { tex: null, mesh: null, scene: null, post: null }, // selected stack id per page
  selOp: null, // index of selected op within current stack, or null
  selPattern: null, // music page: selected pattern name
  renderer: null, // set by main.js
  audio: null, // set by main.js
  dirty: new Set(), // pages needing re-eval
  onChange: [], // UI subscribers
};

let uid = 0;
export function newId(prefix) {
  uid += 1;
  return `${prefix}${Date.now().toString(36)}${uid}`;
}

export function subscribe(fn) {
  state.onChange.push(fn);
}

export function emit(kind = 'project') {
  for (const fn of state.onChange) fn(kind);
}

// --- undo --------------------------------------------------------------------

const undoStack = [];
let undoScheduled = false;

export function pushUndo() {
  // coalesce bursts (slider drags) into a single undo entry: snapshot the
  // pre-burst state once, then ignore pushes until the burst goes quiet
  if (undoScheduled) {
    clearTimeout(undoScheduled);
    undoScheduled = setTimeout(() => { undoScheduled = false; }, 350);
    return;
  }
  undoScheduled = setTimeout(() => { undoScheduled = false; }, 350);
  undoStack.push(JSON.stringify(state.project));
  if (undoStack.length > 60) undoStack.shift();
}

export function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  state.project = JSON.parse(snap);
  clampSelection();
  invalidate('tex');
  invalidate('mesh');
  emit();
}

// --- persistence ---------------------------------------------------------------

let saveTimer = null;

export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state.project));
    } catch { /* storage full or unavailable — keep working */ }
  }, 500);
}

export function loadSaved() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSaved() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch { /* ignore */ }
}

// --- project access ------------------------------------------------------------

export function stacksOf(page) {
  const p = state.project;
  return { tex: p.textures, mesh: p.meshes, scene: p.scenes, post: p.post }[page];
}

export function resolveRef(page, id) {
  return stacksOf(page)?.find((s) => s.id === id) || null;
}

export function currentStack(page = state.page) {
  const list = stacksOf(page);
  if (!list) return null;
  return list.find((s) => s.id === state.sel[page]) || list[0] || null;
}

export function clampSelection() {
  for (const page of ['tex', 'mesh', 'scene', 'post']) {
    const list = stacksOf(page);
    if (!list.find((s) => s.id === state.sel[page])) {
      state.sel[page] = list[0]?.id ?? null;
    }
  }
  const stack = currentStack();
  if (stack && state.selOp !== null && state.selOp >= stack.ops.length) {
    state.selOp = stack.ops.length ? stack.ops.length - 1 : null;
  }
  const pats = Object.keys(state.project.music.patterns);
  if (!pats.includes(state.selPattern)) state.selPattern = pats[0] || null;
}

// --- mutations -------------------------------------------------------------------

export function mutate(fn, opts = {}) {
  pushUndo();
  fn(state.project);
  if (opts.invalidate) invalidate(opts.invalidate);
  scheduleSave();
  emit(opts.kind || 'project');
}

export function addStack(page, name) {
  const list = stacksOf(page);
  const id = newId(page);
  mutate(() => {
    list.push({ id, name: name || `${page} ${list.length + 1}`, ops: [] });
  });
  state.sel[page] = id;
  state.selOp = null;
  emit('sel');
  return id;
}

export function removeStack(page, id) {
  const list = stacksOf(page);
  if (list.length <= 1) return;
  mutate(() => {
    const i = list.findIndex((s) => s.id === id);
    if (i >= 0) list.splice(i, 1);
  }, { invalidate: page });
  clampSelection();
  emit('sel');
}

export function addOp(page, type, index = null) {
  const stack = currentStack(page);
  if (!stack) return;
  mutate(() => {
    const op = makeOp(page, type);
    const at = index === null ? stack.ops.length : index;
    stack.ops.splice(at, 0, op);
    state.selOp = at;
  }, { invalidate: page });
}

export function removeOp(page, index) {
  const stack = currentStack(page);
  mutate(() => {
    stack.ops.splice(index, 1);
    if (state.selOp !== null) {
      if (state.selOp === index) state.selOp = null;
      else if (state.selOp > index) state.selOp -= 1;
    }
  }, { invalidate: page });
}

export function moveOp(page, index, dir) {
  const stack = currentStack(page);
  const j = index + dir;
  if (j < 0 || j >= stack.ops.length) return;
  mutate(() => {
    const [op] = stack.ops.splice(index, 1);
    stack.ops.splice(j, 0, op);
    if (state.selOp === index) state.selOp = j;
  }, { invalidate: page });
}

// Drag-and-drop reorder: `to` is the insertion index in the array *after*
// the op at `from` has been removed.
export function moveOpTo(page, from, to) {
  const stack = currentStack(page);
  if (!stack || from === to || from < 0 || from >= stack.ops.length) return;
  mutate(() => {
    const [op] = stack.ops.splice(from, 1);
    stack.ops.splice(to, 0, op);
    if (state.selOp !== null) {
      if (state.selOp === from) state.selOp = to;
      else {
        let sel = state.selOp;
        if (sel > from) sel -= 1;
        if (sel >= to) sel += 1;
        state.selOp = sel;
      }
    }
  }, { invalidate: page });
}

export function setParam(page, opIndex, key, value) {
  const stack = currentStack(page);
  mutate(() => {
    stack.ops[opIndex].params[key] = value;
  }, { invalidate: page === 'tex' || page === 'mesh' ? page : null, kind: 'param' });
}

export function toggleOp(page, index) {
  const stack = currentStack(page);
  mutate(() => {
    stack.ops[index].enabled = stack.ops[index].enabled === false;
  }, { invalidate: page });
}

// --- evaluation ------------------------------------------------------------------
// tex/mesh stacks are evaluated in WASM and cached as GL resources keyed by
// stack id. Any change re-evaluates the whole page (stacks can reference each
// other; at these sizes brute force is instant and always correct).

let evalTimer = null;

export function invalidate(page) {
  if (!page) return;
  state.dirty.add(page);
  clearTimeout(evalTimer);
  evalTimer = setTimeout(runEval, 30);
}

export function runEval() {
  const r = state.renderer;
  if (!r || !state.project) return;
  if (state.dirty.has('tex')) {
    for (const stack of state.project.textures) {
      try {
        r.uploadTexture(stack.id, evalTexture(stack, resolveRef, state.project.texSize || 256));
      } catch (e) {
        console.warn('tex eval failed', stack.id, e);
      }
    }
  }
  if (state.dirty.has('mesh')) {
    for (const stack of state.project.meshes) {
      try {
        r.uploadMesh(stack.id, evalMesh(stack, resolveRef));
      } catch (e) {
        console.warn('mesh eval failed', stack.id, e);
      }
    }
  }
  state.dirty.clear();
  emit('eval');
}

// Evaluate a *truncated* stack (up to and including op i) for werkkzeug-style
// "view at this op" previews. Uploads under a reserved id and returns it.
export function evalPartial(page, stack, opIndex) {
  const r = state.renderer;
  const partial = { id: stack.id, ops: stack.ops.slice(0, opIndex + 1) };
  const id = '__partial__';
  try {
    if (page === 'tex') r.uploadTexture(id, evalTexture(partial, resolveRef, state.project.texSize || 256));
    else if (page === 'mesh') r.uploadMesh(id, evalMesh(partial, resolveRef));
  } catch (e) {
    console.warn('partial eval failed', e);
  }
  return id;
}

export function setProject(project) {
  state.project = project;
  state.sel = { tex: null, mesh: null, scene: null, post: null };
  state.selOp = null;
  state.selPattern = null;
  clampSelection();
  invalidate('tex');
  invalidate('mesh');
  if (state.audio) state.audio.setProject(project);
  emit();
}
