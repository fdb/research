// I Am Sitting in a Model — main thread.
// Owns typography, cadence, sound and interaction; the model lives in a
// worker (worker.js) or, when the model cannot load, in a recorded session
// (data/fallback.json) replayed through the same interface.
import { RoomTone } from "./audio.js";

// The seed is a transposition of Lucier's 1969 text, clause for clause: a
// score that describes exactly what is about to happen to it.
const SEED =
  "I am sitting in a model, different from the room you are in now. " +
  "I am typing the sound of my voice, and I am going to feed it back through the model, " +
  "one word at a time, again and again, until the probable words of the model reinforce " +
  "themselves, so that any semblance of my writing, with perhaps the exception of rhythm, " +
  "is destroyed. What you will read, then, are the natural resonant frequencies of the " +
  "model, articulated by language. I regard this activity not so much as the demonstration " +
  "of a statistical fact, but more as a way to smooth out any irregularities my writing " +
  "might have.";

const qs = new URLSearchParams(location.search);
const KIOSK = qs.get("kiosk") === "1";
const FORCE_FALLBACK = qs.get("fallback") === "1";
const BASE = new URL(".", location.href).href;

const $ = (sel) => document.querySelector(sel);
const el = {
  strata: $("#strata"),
  sentence: $("#sentence"),
  status: $("#status"),
  meter: $("#meter"),
  veil: $("#veil"),
  veilStatus: $("#veil-status"),
  enter: $("#enter"),
  typebox: $("#typebox"),
  typeinput: $("#typeinput"),
  typenote: $("#typenote"),
  brand: $("#brand"),
};

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (KIOSK) document.body.classList.add("kiosk");

// ---------------------------------------------------------------- state --
const audio = new RoomTone();
let driver = null; // WorkerDriver | ReplayDriver
let mode = "boot"; // boot | landing | reading | eroding | paused
let cadence = clampInt(qs.get("speed"), 500, 4000) ?? 1500;
let words = []; // [{text, start, count, el}]
let separators = []; // text nodes between word spans
let tokenToWord = [];
let epoch = 0; // bumped on every new text; stale async work checks it
let awaitingText = false; // a setText is in flight; drop stale survey/step
let ids = [];
let pTok = [];
let pass = 0;
let meanP = 0;
let settled = 0;
let changeCount = 0;
let lastMeans = []; // for kiosk plateau detection
let idleTimer = null;
let holdTimer = null;

function clampInt(v, lo, hi) {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
}

// ------------------------------------------------------------- drivers --
class WorkerDriver {
  constructor() {
    this.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    this.pending = null;
    this.onEvent = null;
    this.worker.onmessage = (e) => this.onEvent?.(e.data);
    this.worker.onerror = (e) => this.onEvent?.({ t: "error", message: e.message ?? "worker error" });
  }
  init() {
    this.worker.postMessage({ t: "init", base: BASE });
  }
  setText(text) {
    this.worker.postMessage({ t: "setText", text });
  }
  survey() {
    this.worker.postMessage({ t: "survey" });
  }
  step() {
    this.worker.postMessage({ t: "step" });
  }
}

class ReplayDriver {
  // Replays a recorded session through the live interface. The recording is
  // honest — it was produced by the same engine — but the room no longer
  // listens; typing is disabled and the status line says "recording".
  constructor(data, wp) {
    this.data = data;
    this.wp = wp;
    this.onEvent = null;
    this.cursor = { survey: 0, step: 0 };
  }
  init() {
    setTimeout(() => this.onEvent?.({ t: "ready", replay: true }), 60);
  }
  setText() {
    // recording ignores new voices; restart it instead
    this.cursor = { survey: 0, step: 0 };
    const inner = this.data.ids0;
    setTimeout(
      () =>
        this.onEvent?.({
          t: "text",
          ids: inner.slice(),
          words: this.wp.words(inner),
          p: inner.map(() => -1),
          pass: 0,
        }),
      30
    );
  }
  survey() {
    const s = this.data.survey;
    const i = this.cursor.survey++;
    const done = this.cursor.survey >= s.length;
    const it = s[Math.min(i, s.length - 1)];
    setTimeout(() => this.onEvent?.({ t: "survey", i: it.i, p: it.p, done }), 10);
  }
  step() {
    const steps = this.data.steps;
    if (this.cursor.step >= steps.length) {
      // loop the recording; the 'text' event restarts the reading phase
      awaitingText = true;
      this.setText();
      return;
    }
    const ev = steps[this.cursor.step++];
    const inner = ev.ids;
    setTimeout(
      () =>
        this.onEvent?.({
          t: "step",
          ev: { ...ev, ids: inner, words: this.wp.words(inner) },
        }),
      10
    );
  }
}

// ----------------------------------------------------------- rendering --
function buildSentence(wordList, pArr) {
  words = wordList.map((w) => ({ ...w }));
  pTok = pArr.slice();
  tokenToWord = [];
  words.forEach((w, wi) => {
    for (let k = 0; k < w.count; k++) tokenToWord[w.start + k] = wi;
  });
  el.sentence.textContent = "";
  el.sentence.classList.toggle("long", words.length > 95);
  separators = [];
  words.forEach((w, wi) => {
    const sep = document.createTextNode(wi > 0 && !attaches(w.text) ? " " : "");
    separators.push(sep);
    el.sentence.append(sep);
    const span = document.createElement("span");
    span.className = "w";
    span.textContent = w.text;
    span.style.color = colorOf(wordP(wi));
    span.style.textShadow = glowOf(wordP(wi));
    el.sentence.append(span);
    w.el = span;
  });
}

// punctuation can erode into words and back; respacing follows each commit
function respace() {
  words.forEach((w, wi) => {
    const want = wi > 0 && !attaches(w.text) ? " " : "";
    if (separators[wi].data !== want) separators[wi].data = want;
  });
}

function attaches(text) {
  return /^[.,;:!?'%)\]}]/.test(text);
}

function joinWords(list) {
  let s = "";
  for (const w of list) s += (s === "" || attaches(w.text) ? "" : " ") + w.text;
  return s;
}

function wordP(wi) {
  const w = words[wi];
  if (!w) return -1;
  let min = 2;
  for (let k = 0; k < w.count; k++) {
    const p = pTok[w.start + k];
    if (p < 0) return -1; // not fully read yet
    if (p < min) min = p;
  }
  return min;
}

function colorOf(p) {
  if (p < 0) return "oklch(38% 0 0)";
  const L = 30 + 65 * Math.pow(p, 0.55);
  return `oklch(${L.toFixed(1)}% 0 0)`;
}

function glowOf(p) {
  if (p < 0.45) return "none";
  const a = (p - 0.45) * 0.75;
  return `0 0 ${(6 + p * 16).toFixed(0)}px oklch(95% 0 0 / ${a.toFixed(2)})`;
}

function repaintAll() {
  words.forEach((w, wi) => {
    const p = wordP(wi);
    w.el.style.color = colorOf(p);
    w.el.style.textShadow = glowOf(p);
  });
}

function pushStratum(text) {
  const line = document.createElement("div");
  line.className = "stratum";
  line.textContent = text;
  el.strata.append(line);
  while (el.strata.children.length > 30) el.strata.firstChild.remove();
  [...el.strata.children].forEach((c, i, all) => {
    const age = all.length - 1 - i;
    c.style.opacity = Math.max(0.04, 0.5 - age * 0.017).toFixed(3);
  });
}

function setStatus(extra = "") {
  const total = words.length;
  const settledWords = words.filter((_, wi) => wordP(wi) >= 0.6).length;
  const exp = Math.round(meanP * 100);
  const soundState = audio.enabled && audio.running ? "sound on · m" : "sound off · m";
  const modeNote =
    driver instanceof ReplayDriver
      ? "recording — the model could not be woken"
      : mode === "reading"
        ? "the model is reading"
        : mode === "paused"
          ? "paused · space"
          : "type to speak into the room";
  el.status.innerHTML = "";
  const bits = [
    `pass ${pass}`,
    `the model expects ${exp}% of this text`,
    `${settledWords}/${total} words settled`,
    soundState,
    modeNote,
    extra,
  ].filter(Boolean);
  bits.forEach((b, i) => {
    if (i) el.status.append(mk("span", "sep", " · "));
    el.status.append(mk("span", "", b));
  });
  el.meter.style.width = `${(meanP * 100).toFixed(1)}%`;
}

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.textContent = text;
  return n;
}

// ------------------------------------------------------------- the run --
let inflight = false;
let stepTimer = null;

function beginReading() {
  mode = "reading";
  setStatus();
  requestSurvey();
}

function requestSurvey() {
  if (mode !== "reading") return;
  inflight = true;
  driver.survey();
}

function scheduleStep(delay = cadence) {
  clearTimeout(stepTimer);
  stepTimer = setTimeout(() => {
    if (mode !== "eroding" || inflight) return;
    inflight = true;
    driver.step();
  }, delay);
}

function handleEvent(m) {
  if (m.t === "phase" || m.t === "progress") {
    const pct = m.total ? ` ${Math.round(((m.loaded ?? 0) / m.total) * 100)}%` : "";
    const label =
      m.phase === "runtime"
        ? "waking the runtime"
        : m.phase === "vocab"
          ? "learning the vocabulary"
          : m.phase === "session"
            ? "opening the room"
            : `fetching 66 million parameters${pct}`;
    if (m.t === "progress") {
      el.veilStatus.textContent = `fetching 66 million parameters ${Math.round((m.loaded / m.total) * 100)}%`;
    } else {
      el.veilStatus.textContent = label;
    }
    return;
  }

  if (m.t === "ready") {
    el.veilStatus.textContent =
      m.replay
        ? "the model could not be woken — a recording will play"
        : "the room is ready";
    el.enter.disabled = false;
    el.enter.textContent = m.replay ? "enter the recording" : "enter the room";
    if (KIOSK) tryEnter();
    return;
  }

  if (m.t === "error") {
    console.warn("model error:", m.message);
    inflight = false;
    if (mode === "boot" || mode === "landing") switchToReplay();
    else {
      mode = "paused";
      setStatus("the model faltered — press space");
    }
    return;
  }

  if (m.t === "text") {
    awaitingText = false;
    epoch += 1;
    inflight = false;
    ids = m.ids.slice();
    pass = m.pass ?? 0;
    changeCount = 0;
    el.strata.textContent = "";
    buildSentence(m.words, m.p);
    audio.syncWords(
      words.map((w) => ids[w.start]),
      words.map((_, wi) => Math.max(0, wordP(wi)))
    );
    beginReading();
    return;
  }

  if (m.t === "survey") {
    inflight = false;
    if (awaitingText) return; // response for a text we've already replaced
    if (m.i !== undefined && m.i !== null && m.p !== undefined) {
      pTok[m.i] = m.p;
      const wi = tokenToWord[m.i];
      if (wi !== undefined) {
        const p = wordP(wi);
        words[wi].el.style.color = colorOf(p);
        words[wi].el.style.textShadow = glowOf(p);
        if (p >= 0) audio.onSurvey(wi, ids[words[wi].start], p);
      }
    }
    meanP = mean(pTok.filter((p) => p >= 0));
    setStatus();
    audio.tick(meanP);
    if (m.done) {
      mode = "eroding";
      setStatus();
      scheduleStep(900);
    } else {
      setTimeout(requestSurvey, reducedMotion ? 20 : 70);
    }
    return;
  }

  if (m.t === "step") {
    if (awaitingText) {
      inflight = false; // stale step for a replaced text
      return;
    }
    renderStep(m.ev);
    return;
  }
}

async function renderStep(ev) {
  const myEpoch = epoch;
  pass = ev.pass ?? pass + 1;
  meanP = ev.meanP ?? meanP;
  settled = ev.settled ?? settled;
  const wi = tokenToWord[ev.pos];
  const w = words[wi];
  const beat = reducedMotion ? 0 : 1;

  // 1 — the mask: the word becomes static
  if (w && beat) {
    w.el.classList.add("masking");
    w.el.textContent = "░".repeat(Math.max(1, w.text.length));
    await sleep(300);
    if (epoch !== myEpoch) return; // a new text arrived mid-beat
  }

  // 2 — the model's shortlist flickers through the gap
  if (w && beat && !ev.keep && ev.alts?.length > 1) {
    for (const alt of ev.alts.slice(0, 2)) {
      w.el.textContent = wordTextWithPiece(wi, ev.pos, alt.id);
      await sleep(95);
      if (epoch !== myEpoch) return;
    }
  }

  // 3 — commit
  ids = ev.ids.slice();
  pTok = ev.p.slice();
  words.forEach((word, k) => {
    word.text = ev.words[k].text;
  });
  if (w) {
    w.el.classList.remove("masking");
    w.el.textContent = w.text;
    if (!reducedMotion) {
      w.el.classList.remove("fresh", "settle");
      void w.el.offsetWidth; // restart animation
      w.el.classList.add(ev.keep ? "settle" : "fresh");
    }
  }
  respace();
  repaintAll();
  audio.onReplace(wi, ev.newId, ev.pNew, ev.keep);
  audio.tick(meanP);

  if (!ev.keep) {
    changeCount++;
    if (changeCount % 3 === 0) pushStratum(joinWords(words));
  }
  setStatus();
  kioskWatch();

  inflight = false;
  if (mode === "eroding") scheduleStep();
}

function wordTextWithPiece(wi, pos, altId) {
  // rebuild this word's text with the piece at `pos` swapped for altId
  const w = words[wi];
  let text = "";
  for (let k = 0; k < w.count; k++) {
    const tokenIndex = w.start + k;
    let piece =
      tokenIndex === pos ? pieceText(altId) : pieceText(ids[tokenIndex]);
    text += piece;
  }
  return text;
}

let vocabPieces = null; // lazily loaded only for alt flicker + replay
function pieceText(id) {
  if (vocabPieces) {
    const t = vocabPieces[id] ?? "";
    return t.startsWith("##") ? t.slice(2) : t;
  }
  return "▒";
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ fallback --
async function switchToReplay() {
  try {
    const [{ WordPiece }, vocabText, data] = await Promise.all([
      import("./tokenizer.js"),
      fetch(`${BASE}model/vocab.txt`).then((r) => r.text()),
      fetch(`${BASE}data/fallback.json`).then((r) => r.json()),
    ]);
    const wp = new WordPiece(vocabText);
    vocabPieces = wp.tokens;
    driver = new ReplayDriver(data, wp);
    driver.onEvent = handleEvent;
    driver.init();
  } catch (err) {
    el.veilStatus.textContent = "the room could not be opened at all — see about.html";
    console.error(err);
  }
}

// ---------------------------------------------------------- interaction --
async function tryEnter() {
  if (mode !== "landing" && mode !== "boot") return;
  const ok = await audio.start();
  if (!ok && KIOSK) {
    // autoplay blocked: wait for any gesture
    el.veilStatus.textContent = "touch to begin";
    const once = async () => {
      await audio.start();
      enter();
    };
    window.addEventListener("pointerdown", once, { once: true });
    window.addEventListener("keydown", once, { once: true });
    return;
  }
  enter();
}

// the single path for putting a text into the room
function speakText(text) {
  clearTimeout(stepTimer);
  inflight = false;
  awaitingText = true;
  mode = "reading";
  driver.setText(text);
}

function enter() {
  el.veil.classList.add("gone");
  speakText(qs.get("text") ?? SEED);
  armIdleReseed();
}

function openTypebox(seedChar = "") {
  if (driver instanceof ReplayDriver) return;
  el.typebox.classList.add("open");
  el.typeinput.value = seedChar;
  el.typeinput.focus();
  el.typenote.textContent = "enter — speak it into the room · esc — never mind";
}

function closeTypebox() {
  el.typebox.classList.remove("open");
  el.typeinput.value = "";
}

function commitTypebox() {
  const text = el.typeinput.value.trim();
  closeTypebox();
  if (!text) return;
  speakText(text);
  armIdleReseed();
}

window.addEventListener("keydown", (e) => {
  if (el.typebox.classList.contains("open")) {
    if (e.key === "Escape") closeTypebox();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitTypebox();
    }
    return;
  }
  if (mode === "boot" || mode === "landing") return;
  if (e.key === "m") {
    audio.setEnabled(!audio.enabled);
    setStatus();
  } else if (e.key === " ") {
    e.preventDefault();
    if (mode === "eroding") {
      mode = "paused";
      clearTimeout(stepTimer);
    } else if (mode === "paused") {
      mode = "eroding";
      scheduleStep(200);
    }
    setStatus();
  } else if (e.key === "[" || e.key === "-") {
    cadence = Math.min(4000, cadence + 250);
    setStatus(`cadence ${cadence} ms`);
  } else if (e.key === "]" || e.key === "+" || e.key === "=") {
    cadence = Math.max(500, cadence - 250);
    setStatus(`cadence ${cadence} ms`);
  } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
    openTypebox(e.key);
    e.preventDefault();
  }
  armIdleReseed();
});

el.enter.addEventListener("click", tryEnter);
window.addEventListener("pointerdown", () => armIdleReseed());

// ------------------------------------------------------------- kiosk ----
function kioskWatch() {
  lastMeans.push(meanP);
  if (lastMeans.length > 220) lastMeans.shift();
  if (!KIOSK || holdTimer) return;
  const plateau =
    lastMeans.length >= 200 &&
    Math.abs(lastMeans[lastMeans.length - 1] - lastMeans[0]) < 0.015;
  if (pass > 900 || (pass > 400 && plateau)) {
    // hold the resonant text, then reseed the room
    holdTimer = setTimeout(() => {
      holdTimer = null;
      lastMeans = [];
      speakText(SEED);
    }, 40_000);
  }
}

function armIdleReseed() {
  if (!KIOSK) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => speakText(SEED), 12 * 60_000);
}

// --------------------------------------------------------------- boot ----
async function boot() {
  mode = "landing";
  el.enter.disabled = true;
  el.veilStatus.textContent = "…";
  // lazy vocab for the flicker beat (small, non-blocking)
  fetch(`${BASE}model/vocab.txt`)
    .then((r) => r.text())
    .then((t) => {
      vocabPieces = t.split("\n");
    })
    .catch(() => {});
  if (FORCE_FALLBACK) {
    await switchToReplay();
    return;
  }
  try {
    driver = new WorkerDriver();
    driver.onEvent = handleEvent;
    driver.init();
  } catch (err) {
    console.warn(err);
    await switchToReplay();
  }
}

boot();

// exhibition/debug handle: lets an installation script (or a curious visitor)
// inspect the room from the console
window.SIAM = {
  audio,
  get mode() {
    return mode;
  },
  get pass() {
    return pass;
  },
  get meanP() {
    return meanP;
  },
  get cadence() {
    return cadence;
  },
  set cadence(ms) {
    cadence = Math.max(500, Math.min(4000, ms));
  },
  get sentence() {
    return joinWords(words);
  },
  speak(text) {
    speakText(String(text));
  },
};
