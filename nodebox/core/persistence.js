// nodebox/core/persistence.js
// Fake backend. The demo intentionally has NO real persistence — this
// module mimics the API a real backend would expose (modeled on NodeBox
// Live's Express server) against localStorage, so the UI code is written
// exactly as it would be against the network.
//
// What a real backend needs (NodeBox Live's server is the reference —
// ~970 lines of Express carrying auth, storage, publishing):
//
//   POST /api/auth/signup|login            → JWT; bcrypt password hashes
//   GET  /api/projects/:user               → project list (title, thumbnail)
//   GET  /api/projects/:user/:id/:version  → { status, project } (the JSON doc)
//   POST /api/projects/:user/:id           → save whole document (debounced)
//   POST /api/projects/:user/:id/publish   → copy dev version → published,
//                                            mirrored to static hosting so
//                                            playback needs no API at all
//   GET  /api/assets/... , POST presigned uploads (S3) for images/data
//
// Design notes for the future implementation:
// - Documents are single JSON files; whole-document saves are simple but
//   need a conflict guard (Live used a BroadcastChannel single-tab lock;
//   a rewrite should use version numbers / optimistic concurrency, and
//   could sync per-edit operations instead — the model.js edit functions
//   are already discrete operations).
// - Published documents should be plain static JSON so the player/embed
//   never needs the API (proven to work well in Live).

const KEY = "nodebox-demo-projects";
const LATENCY = 120; // pretend we crossed a network

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

function delay(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY));
}

/**
 * @returns {Promise<{id: string, name: string, updatedAt: string}[]>}
 */
export async function listProjects() {
  const store = readStore();
  return delay(
    Object.entries(store).map(([id, entry]) => ({
      id,
      name: entry.doc.name,
      updatedAt: entry.updatedAt,
    })),
  );
}

/**
 * @param {string} id
 * @returns {Promise<import('./model.js').NodeBoxDocument|null>}
 */
export async function loadProject(id) {
  const entry = readStore()[id];
  return delay(entry ? entry.doc : null);
}

/**
 * @param {string} id
 * @param {import('./model.js').NodeBoxDocument} doc
 * @returns {Promise<{status: 'ok'}>}
 */
export async function saveProject(id, doc) {
  const store = readStore();
  store[id] = { doc, updatedAt: new Date().toISOString() };
  writeStore(store);
  return delay({ status: "ok" });
}

/** @returns {Promise<{status: 'ok'}>} */
export async function deleteProject(id) {
  const store = readStore();
  delete store[id];
  writeStore(store);
  return delay({ status: "ok" });
}

/**
 * Debounced auto-save, like Live's saveProjectDebounced (1s).
 * @returns {(id: string, doc: Object, onSaved?: () => void) => void}
 */
export function createAutoSaver(wait = 1000) {
  let timer = null;
  return (id, doc, onSaved) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await saveProject(id, doc);
      if (onSaved) onSaved();
    }, wait);
  };
}
