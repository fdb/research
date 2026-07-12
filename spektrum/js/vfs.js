/*
 * vfs.js — a tiny virtual filesystem in localStorage.
 *
 * The conceptual center of the lab: all three stations are views over
 * the same project files. The text station edits scene/pattern.js, the
 * node station serializes to scene/graph.json, the agent gets tools
 * that list/read/write these same files. "One substrate, three skins."
 */

const KEY = "spektrum.vfs.v1";

let files = null; // path -> string
const subs = new Set(); // (path|null) => void

function load() {
  if (files) return;
  try {
    files = JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    files = null;
  }
  if (!files || typeof files !== "object") files = {};
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(files));
  } catch (e) {
    console.warn("vfs: persist failed", e);
  }
}

function notify(path) {
  for (const fn of subs) {
    try { fn(path); } catch (e) { console.warn(e); }
  }
}

export function list() {
  load();
  return Object.keys(files).sort();
}

export function exists(path) {
  load();
  return Object.prototype.hasOwnProperty.call(files, path);
}

export function read(path) {
  load();
  return exists(path) ? files[path] : null;
}

export function write(path, content) {
  load();
  if (typeof content !== "string") content = String(content);
  files[path] = content;
  persist();
  notify(path);
}

export function remove(path) {
  load();
  if (!exists(path)) return false;
  delete files[path];
  persist();
  notify(path);
  return true;
}

export function onChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// Replace the whole filesystem (scene loading). Notifies with null.
export function replaceAll(newFiles) {
  load();
  files = { ...newFiles };
  persist();
  notify(null);
}

// ---- snapshots: cheap safety for risky moments (agent turns, scene
// loads, "let me try something"). A ring buffer in localStorage.

const SNAP_KEY = "spektrum.snapshots.v1";
const SNAP_MAX = 24;

function loadSnaps() {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY)) || []; }
  catch { return []; }
}

export function snapshots() {
  return loadSnaps();
}

export function snapshot(label = "snapshot") {
  load();
  const snaps = loadSnaps();
  const last = snaps[snaps.length - 1];
  const filesJson = JSON.stringify(files);
  if (last && JSON.stringify(last.files) === filesJson) return last; // no-op if unchanged
  const snap = { t: Date.now(), label: String(label).slice(0, 60), files: JSON.parse(filesJson) };
  snaps.push(snap);
  while (snaps.length > SNAP_MAX) snaps.shift();
  try { localStorage.setItem(SNAP_KEY, JSON.stringify(snaps)); }
  catch (e) { console.warn("vfs: snapshot failed", e); }
  return snap;
}

export function restoreSnapshot(index) {
  const snaps = loadSnaps();
  const snap = snaps[index];
  if (!snap) return null;
  replaceAll(snap.files);
  return snap;
}

export function seedIfEmpty(defaults) {
  load();
  if (Object.keys(files).length === 0) {
    files = { ...defaults };
    persist();
    notify(null);
    return true;
  }
  return false;
}
