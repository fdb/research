/*
 * engine.js — the shared audio substrate.
 *
 * All three stations (primitives, nodes, agent) drive this one engine:
 * a lookahead clock measured in cycles, pattern slots, synth voices,
 * procedurally generated drum samples (no assets — every sound is built
 * from first principles at load time), and two FX sends.
 *
 * The engine never stops when code fails: bad input replaces nothing.
 */

import { Pattern } from "./pattern.js";

// ------------------------------------------------------------ context

let ctx = null;
let master, limiter, analyser, delaySend, delayNode, delayFb, delayFilter,
  roomSend, convolver;

export function audioCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    buildMaster();
    buildSamples();
    startClock();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function isRunning() {
  return !!ctx && ctx.state === "running";
}

function buildMaster() {
  master = ctx.createGain();
  master.gain.value = 0.8;

  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;

  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;

  master.connect(limiter);
  limiter.connect(analyser);
  analyser.connect(ctx.destination);

  // delay send: filtered feedback delay
  delaySend = ctx.createGain();
  delayNode = ctx.createDelay(2);
  delayNode.delayTime.value = 0.375;
  delayFb = ctx.createGain();
  delayFb.gain.value = 0.4;
  delayFilter = ctx.createBiquadFilter();
  delayFilter.type = "lowpass";
  delayFilter.frequency.value = 3200;
  delaySend.connect(delayNode);
  delayNode.connect(delayFilter);
  delayFilter.connect(delayFb);
  delayFb.connect(delayNode);
  delayFilter.connect(master);

  // room send: convolver with a synthesized impulse response
  roomSend = ctx.createGain();
  convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(2.2, 2.4);
  roomSend.connect(convolver);
  convolver.connect(master);
}

export function masterInput() {
  audioCtx();
  return master;
}

export function sends() {
  audioCtx();
  return { delay: delaySend, room: roomSend };
}

function makeImpulse(seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

// --------------------------------------------- procedural drum samples
//
// A tiny RBJ biquad run offline over Float32Arrays lets us sculpt noise
// into snares, hats and claps without shipping a single sample file.

function biquad(data, type, f0, q, rate) {
  const w0 = (2 * Math.PI * f0) / rate;
  const alpha = Math.sin(w0) / (2 * q);
  const cw = Math.cos(w0);
  let b0, b1, b2, a0, a1, a2;
  if (type === "lp") {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0;
  } else if (type === "hp") {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0;
  } else { // bp (constant peak)
    b0 = alpha; b1 = 0; b2 = -alpha;
  }
  a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    data[i] = y;
  }
  return data;
}

const env = (i, rate, t) => Math.exp((-i / rate) / t);

export const samples = {}; // name -> AudioBuffer

function toBuffer(data) {
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}

function buildSamples() {
  const rate = ctx.sampleRate;
  const secs = (s) => Math.floor(rate * s);

  // bd — sine with exponential pitch drop + click
  {
    const n = secs(0.4), d = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const f = 42 + 160 * Math.exp((-i / rate) / 0.045);
      phase += (2 * Math.PI * f) / rate;
      d[i] = Math.tanh(Math.sin(phase) * 2.2) * env(i, rate, 0.16);
      if (i < rate * 0.004) d[i] += (Math.random() * 2 - 1) * 0.4 * (1 - i / (rate * 0.004));
    }
    samples.bd = toBuffer(d);
  }
  // sn — two detuned sines + bandpassed noise
  {
    const n = secs(0.28), d = new Float32Array(n);
    const noise = new Float32Array(n);
    for (let i = 0; i < n; i++) noise[i] = Math.random() * 2 - 1;
    biquad(noise, "bp", 1800, 0.8, rate);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const body =
        (Math.sin(2 * Math.PI * 186 * t) + Math.sin(2 * Math.PI * 332 * t)) *
        0.5 * env(i, rate, 0.055);
      d[i] = body * 0.7 + noise[i] * env(i, rate, 0.085) * 0.9;
    }
    samples.sn = toBuffer(d);
  }
  // hh / oh — highpassed noise, short and long
  for (const [name, t] of [["hh", 0.035], ["oh", 0.28]]) {
    const n = secs(t * 4), d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    biquad(d, "hp", 6800, 0.9, rate);
    biquad(d, "hp", 6800, 0.9, rate);
    for (let i = 0; i < n; i++) d[i] *= env(i, rate, t) * 0.8;
    samples[name] = toBuffer(d);
  }
  // cp — three noise bursts through a bandpass
  {
    const n = secs(0.35), d = new Float32Array(n);
    for (const off of [0, 0.011, 0.023]) {
      const start = Math.floor(off * rate);
      for (let i = start; i < n; i++) {
        d[i] += (Math.random() * 2 - 1) * Math.exp((-(i - start) / rate) / (off === 0.023 ? 0.09 : 0.008));
      }
    }
    biquad(d, "bp", 1100, 1.2, rate);
    for (let i = 0; i < n; i++) d[i] *= 1.4;
    samples.cp = toBuffer(d);
  }
  // rim — short resonant blip
  {
    const n = secs(0.08), d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * env(i, rate, 0.004);
    biquad(d, "bp", 1750, 8, rate);
    for (let i = 0; i < n; i++) d[i] = Math.tanh(d[i] * 6);
    samples.rt = samples.rim = toBuffer(d);
  }
  // lt / mt / ht — toms: sine drops at three pitches
  for (const [name, f0] of [["lt", 90], ["mt", 140], ["ht", 200]]) {
    const n = secs(0.35), d = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const f = f0 * (0.7 + 0.5 * Math.exp((-i / rate) / 0.04));
      phase += (2 * Math.PI * f) / rate;
      d[i] = Math.sin(phase) * env(i, rate, 0.12);
    }
    samples[name] = toBuffer(d);
  }
  // cr — crash: long high noise with slow decay
  {
    const n = secs(1.6), d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    biquad(d, "hp", 4200, 0.7, rate);
    for (let i = 0; i < n; i++) {
      d[i] *= (env(i, rate, 0.5) * 0.8 + env(i, rate, 0.05) * 0.4) * 0.6;
    }
    samples.cr = toBuffer(d);
  }
  // click — 2ms tick
  {
    const n = secs(0.01), d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * env(i, rate, 0.0015);
    samples.click = toBuffer(d);
  }
}

// Karplus–Strong plucked string, cached per midi note.
const pluckCache = new Map();
function pluckBuffer(midi) {
  if (pluckCache.has(midi)) return pluckCache.get(midi);
  const rate = ctx.sampleRate;
  const freq = midiToFreq(midi);
  const period = Math.max(2, Math.round(rate / freq));
  const n = Math.floor(rate * 1.4);
  const d = new Float32Array(n);
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const cur = ring[idx];
    const nxt = ring[(idx + 1) % period];
    d[i] = cur;
    ring[idx] = (cur + nxt) * 0.498; // slight loss = decay
    idx = (idx + 1) % period;
  }
  const buf = toBuffer(d);
  pluckCache.set(midi, buf);
  return buf;
}

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

const SYNTHS = new Set(["sine", "saw", "square", "tri", "triangle", "fm", "sub", "pluck", "noise", "bass"]);

export function soundNames() {
  return [...Object.keys(samples), ...SYNTHS].sort();
}

// ------------------------------------------------------------- voices

let noiseBuf = null;
function getNoiseBuf() {
  if (!noiseBuf) {
    const n = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function crushCurve(bits) {
  const steps = Math.pow(2, Math.max(1, Math.min(16, bits)));
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * 2 - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  return curve;
}

const activeStops = new Set(); // {stop(t)} — so hush can cut everything

/*
 * play(event, when, dur, out?) — schedule one sound.
 * event: {s, note, n, gain, pan, speed, cutoff, resonance,
 *         attack, decay, sustain, release, delay, room, legato,
 *         detune, fmh, fmi, crush}
 * `out`: destination node (defaults to master). Node station passes
 * its own per-node gains here — same voices, different wiring.
 */
export function play(ev, when, dur = 0.25, out = null) {
  if (!ctx) return;
  const name = ev.s || (ev.note !== undefined ? "sine" : "bd");
  const gain = ev.gain ?? 0.8;
  if (gain <= 0) return;
  const dest = out || master;
  const t = Math.max(when, ctx.currentTime);

  const vGain = ctx.createGain();
  let head = vGain; // chain tail that connects toward dest

  // panner
  const panner = ctx.createStereoPanner();
  panner.pan.value = ((ev.pan ?? 0.5) - 0.5) * 2;
  vGain.connect(panner);
  head = panner;

  // optional filter
  if (ev.cutoff !== undefined) {
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(Math.max(30, Math.min(18000, ev.cutoff)), t);
    filt.Q.value = ev.resonance ?? 1;
    head.connect(filt);
    head = filt;
  }

  // optional bitcrush
  if (ev.crush !== undefined) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = crushCurve(ev.crush);
    head.connect(shaper);
    head = shaper;
  }

  head.connect(dest);
  if (ev.delay) {
    const send = ctx.createGain();
    send.gain.value = ev.delay;
    head.connect(send);
    send.connect(delaySend);
  }
  if (ev.room) {
    const send = ctx.createGain();
    send.gain.value = ev.room;
    head.connect(send);
    send.connect(roomSend);
  }

  const legato = ev.legato ?? 1;
  const noteDur = Math.max(0.03, dur * legato);
  const att = ev.attack ?? 0.002;
  const rel = ev.release ?? 0.06;

  const stopAt = (src, end) => {
    try { src.stop(end); } catch { /* already stopped */ }
  };

  const finish = (nodes, end) => {
    const h = {
      stop(tt) {
        vGain.gain.cancelScheduledValues(tt);
        vGain.gain.setTargetAtTime(0, tt, 0.01);
        nodes.forEach((s) => stopAt(s, tt + 0.05));
        activeStops.delete(h);
      },
    };
    activeStops.add(h);
    setTimeout(() => activeStops.delete(h), (end - ctx.currentTime + 0.3) * 1000);
  };

  if (samples[name]) {
    // sample voice
    const src = ctx.createBufferSource();
    src.buffer = name === "pluck" ? pluckBuffer(ev.note ?? 60) : samples[name];
    let rate = ev.speed ?? 1;
    if (ev.n) rate *= Math.pow(2, ev.n / 12); // n retunes generated drums
    if (ev.note !== undefined && !SYNTHS.has(name)) rate *= midiToFreq(ev.note) / midiToFreq(60);
    src.playbackRate.value = rate;
    vGain.gain.setValueAtTime(gain, t);
    src.connect(vGain);
    src.start(t);
    const end = t + src.buffer.duration / Math.abs(rate || 1) + 0.05;
    stopAt(src, end);
    finish([src], end);
    return;
  }

  if (!SYNTHS.has(name)) return; // unknown sound: silently skip (keep playing!)

  // synth voice
  const midi = ev.note ?? 48;
  const freq = midiToFreq(midi) * Math.pow(2, (ev.detune ?? 0) / 1200);
  const sus = ev.sustain ?? 0.7;
  const dec = ev.decay ?? 0.08;
  const end = t + att + noteDur + rel + 0.1;
  const peak = gain;

  vGain.gain.setValueAtTime(0, t);
  vGain.gain.linearRampToValueAtTime(peak, t + att);
  vGain.gain.setTargetAtTime(peak * sus, t + att, Math.max(0.005, dec / 3));
  vGain.gain.setTargetAtTime(0, t + att + noteDur, Math.max(0.01, rel / 3));

  const srcs = [];
  const mk = (type, f, g = 1) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (g !== 1) {
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg);
      gg.connect(vGain);
    } else {
      o.connect(vGain);
    }
    o.start(t);
    stopAt(o, end);
    srcs.push(o);
    return o;
  };

  switch (name) {
    case "sine": mk("sine", freq); break;
    case "tri":
    case "triangle": mk("triangle", freq); break;
    case "square": mk("square", freq, 0.5); break;
    case "saw": mk("sawtooth", freq, 0.6); break;
    case "sub": {
      mk("sine", freq);
      mk("sine", freq / 2, 0.6);
      break;
    }
    case "bass": {
      const o = mk("sawtooth", freq, 0.7);
      const o2 = mk("square", freq * 0.995, 0.35);
      void o; void o2;
      break;
    }
    case "fm": {
      const car = ctx.createOscillator();
      car.type = "sine";
      car.frequency.setValueAtTime(freq, t);
      const mod = ctx.createOscillator();
      mod.type = "sine";
      mod.frequency.setValueAtTime(freq * (ev.fmh ?? 2), t);
      const modGain = ctx.createGain();
      const index = (ev.fmi ?? 3) * freq;
      modGain.gain.setValueAtTime(index, t);
      modGain.gain.setTargetAtTime(index * 0.25, t, noteDur / 2);
      mod.connect(modGain);
      modGain.connect(car.frequency);
      car.connect(vGain);
      car.start(t); mod.start(t);
      stopAt(car, end); stopAt(mod, end);
      srcs.push(car, mod);
      break;
    }
    case "pluck": {
      const src = ctx.createBufferSource();
      src.buffer = pluckBuffer(midi);
      src.connect(vGain);
      src.start(t);
      stopAt(src, end);
      srcs.push(src);
      break;
    }
    case "noise": {
      const src = ctx.createBufferSource();
      src.buffer = getNoiseBuf();
      src.loop = true;
      src.connect(vGain);
      src.start(t);
      stopAt(src, end);
      srcs.push(src);
      break;
    }
  }
  finish(srcs, end);
}

// -------------------------------------------------------------- clock
//
// Cycle-based transport: cycleAt(t) maps audio time to cycle position.
// Patterns are queried span by span, 120ms ahead of the playhead.

const state = {
  cps: 0.5,          // cycles per second (1 cycle = 1 bar of 4 beats)
  time0: 0,          // audio time at cycle0
  cycle0: 0,
  lastCycle: 0,
  timer: null,
};

export const slots = new Map();     // name -> {pattern, out}
const clockSubs = new Set();        // fn(spanBegin, spanEnd, cycleToTime)

export function cycleAt(t) {
  return state.cycle0 + (t - state.time0) * state.cps;
}
export function timeAt(cycle) {
  return state.time0 + (cycle - state.cycle0) / state.cps;
}
export function nowCycle() {
  return ctx ? cycleAt(ctx.currentTime) : 0;
}

export function setBpm(bpm) {
  const b = Math.max(20, Math.min(300, Number(bpm) || 120));
  if (!ctx) { state.cps = b / 240; return; }
  // re-anchor so the cycle position is continuous through the change
  const t = ctx.currentTime;
  state.cycle0 = cycleAt(t);
  state.time0 = t;
  state.cps = b / 240; // 4 beats per cycle
}
export function getBpm() {
  return state.cps * 240;
}

function startClock() {
  state.time0 = ctx.currentTime;
  state.cycle0 = 0;
  state.lastCycle = 0;
  const LOOKAHEAD = 0.15; // seconds
  state.timer = setInterval(() => {
    if (ctx.state !== "running") return;
    const horizon = cycleAt(ctx.currentTime + LOOKAHEAD);
    if (horizon <= state.lastCycle) return;
    const b = state.lastCycle, e = horizon;
    state.lastCycle = horizon;
    for (const [, slot] of slots) {
      if (!slot.pattern) continue;
      let haps;
      try {
        haps = slot.pattern.query(b, e);
      } catch (err) {
        console.warn("pattern query failed:", err);
        continue;
      }
      for (const h of haps) {
        if (h.b < b - 1e-9) continue;
        const v = typeof h.v === "object" && h.v !== null ? h.v : { s: String(h.v) };
        const when = timeAt(h.b);
        const dur = (h.e - h.b) / state.cps;
        try { play(v, when, dur, slot.out); } catch (err) { console.warn(err); }
      }
    }
    for (const fn of clockSubs) {
      try { fn(b, e, timeAt); } catch (err) { console.warn(err); }
    }
  }, 30);
}

// Subscribe to clock spans (node-station sequencers, visual beat cues).
export function onClock(fn) {
  clockSubs.add(fn);
  return () => clockSubs.delete(fn);
}

export function setSlot(name, pattern, out = null) {
  if (pattern != null && !(pattern instanceof Pattern)) {
    throw new Error(`slot ${name}: not a pattern`);
  }
  if (pattern == null) slots.delete(name);
  else slots.set(name, { pattern, out });
}

export function clearSlots(prefix = "") {
  for (const k of [...slots.keys()]) {
    if (k.startsWith(prefix)) slots.delete(k);
  }
}

export function hush() {
  slots.clear();
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const h of [...activeStops]) h.stop(t);
}

// --------------------------------------------------------- analysis
//
// Levels for the shader uniforms and UI meters.

const freqData = new Uint8Array(512);

export function levels() {
  if (!ctx) return { rms: 0, bass: 0, mid: 0, high: 0 };
  analyser.getByteFrequencyData(freqData);
  const n = analyser.frequencyBinCount;
  const band = (from, to) => {
    let sum = 0;
    const a = Math.floor(from * n), bEnd = Math.max(Math.floor(to * n), a + 1);
    for (let i = a; i < bEnd; i++) sum += freqData[i];
    return sum / (bEnd - a) / 255;
  };
  return {
    rms: band(0, 1),
    bass: band(0, 0.04),
    mid: band(0.04, 0.25),
    high: band(0.25, 0.9),
  };
}
