// WebAudio synth + pattern sequencer. Everything is synthesized — no samples.
//
// Music model (in project.music):
//   root:   midi note of scale root
//   scale:  semitone offsets, e.g. [0,3,5,7,10]
//   gains:  per-instrument mix levels
//   patterns: name -> { kick[16], snare[16], hat[16], bass[16], arp[16], pad }
//     drums: 0 = rest, 1 = hit (hat: 2 = open)
//     bass/arp: 0 = rest, n = scale degree (1-based, wraps octaves)
//     pad: 0 = none, n = chord on scale degree n (root+3rd+5th within scale)
//   song:  array of pattern names, one per bar
//
// The audio clock is the master clock: visuals derive beats from
// AudioContext.currentTime, so image and sound cannot drift apart.

const STEPS = 16; // 16th notes per bar (4/4)

export const INSTRUMENTS = ['kick', 'snare', 'hat', 'bass', 'arp', 'pad'];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.playing = false;
    this.startCtxTime = 0;
    this.startBeat = 0;
    this.pausedBeat = 0;
    this.timer = null;
    this.nextStep = 0; // absolute step index being scheduled next
    this.project = null;
    this.muted = new Set();
  }

  ensureCtx() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.buses = {};
    for (const name of INSTRUMENTS) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[name] = g;
    }

    // shared echo send (dotted-8th flavour set at play time)
    this.delay = ctx.createDelay(2);
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.35;
    const delayLp = ctx.createBiquadFilter();
    delayLp.type = 'lowpass';
    delayLp.frequency.value = 2500;
    this.delay.connect(delayLp);
    delayLp.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delaySendArp = ctx.createGain();
    this.delaySendArp.gain.value = 0.35;
    this.delaySendArp.connect(this.delay);
    delayLp.connect(this.master);

    // shared noise buffer
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  setProject(project) {
    this.project = project;
  }

  get bpm() {
    return this.project?.bpm || 120;
  }

  get songBars() {
    return this.project?.music?.song?.length || 1;
  }

  beatDur() {
    return 60 / this.bpm;
  }

  stepDur() {
    return this.beatDur() / 4;
  }

  // Current playhead position in beats (wraps around song length).
  beatNow() {
    if (!this.playing || !this.ctx) return this.pausedBeat;
    const raw = this.startBeat + (this.ctx.currentTime - this.startCtxTime) / this.beatDur();
    return raw % (this.songBars * 4);
  }

  play(fromBeat = null) {
    this.ensureCtx();
    this.ctx.resume();
    const at = fromBeat !== null ? fromBeat : this.pausedBeat;
    this.startBeat = at;
    this.startCtxTime = this.ctx.currentTime + 0.06;
    this.nextStep = Math.ceil(at * 4);
    this.playing = true;
    this.delay.delayTime.value = this.stepDur() * 3;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    this.pausedBeat = this.beatNow();
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  seek(beat) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.stop();
    this.pausedBeat = beat % (this.songBars * 4);
    if (wasPlaying) this.play(this.pausedBeat);
  }

  stepTime(stepAbs) {
    return this.startCtxTime + (stepAbs / 4 - this.startBeat) * this.beatDur();
  }

  patternAt(bar) {
    const m = this.project.music;
    const name = m.song[((bar % m.song.length) + m.song.length) % m.song.length];
    return m.patterns[name];
  }

  schedule() {
    if (!this.playing || !this.project) return;
    const horizon = this.ctx.currentTime + 0.12;
    while (this.stepTime(this.nextStep) < horizon) {
      const stepAbs = this.nextStep++;
      const t = this.stepTime(stepAbs);
      if (t < this.ctx.currentTime - 0.02) continue;
      const totalSteps = this.songBars * STEPS;
      const s = ((stepAbs % totalSteps) + totalSteps) % totalSteps;
      const bar = Math.floor(s / STEPS);
      const step = s % STEPS;
      const pat = this.patternAt(bar);
      if (!pat) continue;
      const g = this.project.music.gains || {};
      const on = (name) => !this.muted.has(name) && (g[name] ?? 1) > 0;
      if (pat.kick?.[step] && on('kick')) this.playKick(t, g.kick ?? 1);
      if (pat.snare?.[step] && on('snare')) this.playSnare(t, g.snare ?? 1);
      if (pat.hat?.[step] && on('hat')) this.playHat(t, g.hat ?? 1, pat.hat[step] === 2);
      if (pat.bass?.[step] && on('bass')) {
        let lenSteps = 1;
        while (step + lenSteps < STEPS && pat.bass[step + lenSteps] === -1) lenSteps++;
        this.playBass(t, this.degreeToMidi(pat.bass[step], -1), lenSteps * this.stepDur(), g.bass ?? 1);
      }
      if (pat.arp?.[step] && on('arp')) this.playArp(t, this.degreeToMidi(pat.arp[step], 1), g.arp ?? 1);
      if (step === 0 && pat.pad && on('pad')) {
        this.playPad(t, pat.pad, 4 * this.beatDur(), g.pad ?? 1);
      }
    }
  }

  degreeToMidi(deg, octave = 0) {
    const m = this.project.music;
    const scale = m.scale || [0, 3, 5, 7, 10];
    const d = deg - 1;
    const oct = Math.floor(d / scale.length);
    return (m.root || 45) + octave * 12 + oct * 12 + scale[((d % scale.length) + scale.length) % scale.length];
  }

  midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // --- instruments -----------------------------------------------------------

  playKick(t, gain) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(g);
    g.connect(this.buses.kick);
    osc.start(t);
    osc.stop(t + 0.3);
    // click
    const click = ctx.createBufferSource();
    click.buffer = this.noiseBuf;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(gain * 0.4, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    click.connect(hp);
    hp.connect(cg);
    cg.connect(this.buses.kick);
    click.start(t, Math.random());
    click.stop(t + 0.02);
  }

  playSnare(t, gain) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * 0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.buses.snare);
    n.start(t, Math.random());
    n.stop(t + 0.2);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.06);
    const og = ctx.createGain();
    og.gain.setValueAtTime(gain * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(og);
    og.connect(this.buses.snare);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  playHat(t, gain, open) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const g = ctx.createGain();
    const dur = open ? 0.22 : 0.045;
    g.gain.setValueAtTime(gain * 0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(hp);
    hp.connect(g);
    g.connect(this.buses.hat);
    n.start(t, Math.random());
    n.stop(t + dur + 0.01);
  }

  playBass(t, midi, len, gain) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = this.midiToFreq(midi);
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = this.midiToFreq(midi - 12);
    const subG = ctx.createGain();
    subG.gain.value = 0.4;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + Math.min(0.3, len));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * 0.55, t + 0.008);
    g.gain.setValueAtTime(gain * 0.55, t + len * 0.8);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    osc.connect(lp);
    sub.connect(subG);
    subG.connect(lp);
    lp.connect(g);
    g.connect(this.buses.bass);
    osc.start(t);
    osc.stop(t + len + 0.05);
    sub.start(t);
    sub.stop(t + len + 0.05);
  }

  playArp(t, midi, gain) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = this.midiToFreq(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.buses.arp);
    g.connect(this.delaySendArp);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  playPad(t, degree, len, gain) {
    const ctx = this.ctx;
    // triad on the scale: degree, degree+2, degree+4
    const notes = [degree, degree + 2, degree + 4].map((d) => this.degreeToMidi(d, 0));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const g = ctx.createGain();
    const a = Math.min(0.6, len * 0.25);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * 0.14, t + a);
    g.gain.setValueAtTime(gain * 0.14, t + len * 0.85);
    g.gain.linearRampToValueAtTime(0, t + len + 0.3);
    lp.connect(g);
    g.connect(this.buses.pad);
    for (const midi of notes) {
      for (const det of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = this.midiToFreq(midi);
        osc.detune.value = det;
        osc.connect(lp);
        osc.start(t);
        osc.stop(t + len + 0.4);
      }
    }
  }

  // --- pattern envelopes for expressions --------------------------------------
  // env value 1.0 at a hit, exponential decay in beats. Deterministic — read
  // from pattern data, not audio analysis, so scrubbing works too.

  envAt(name, beat, decay = 6) {
    if (!this.project) return 0;
    const totalBeats = this.songBars * 4;
    const bWrapped = ((beat % totalBeats) + totalBeats) % totalBeats;
    // scan back up to 2 bars for the most recent hit
    let best = -Infinity;
    for (let back = 0; back < 2 * STEPS; back++) {
      const stepAbs = Math.floor(bWrapped * 4) - back;
      const sw = ((stepAbs % (this.songBars * STEPS)) + this.songBars * STEPS) % (this.songBars * STEPS);
      const pat = this.patternAt(Math.floor(sw / STEPS));
      const v = pat?.[name]?.[sw % STEPS];
      if (v && v !== -1) {
        best = stepAbs / 4;
        break;
      }
    }
    if (best === -Infinity) return 0;
    const dt = bWrapped - best;
    return dt < 0 ? 0 : Math.exp(-dt * decay);
  }
}

export function makeEmptyPattern() {
  return {
    kick: new Array(STEPS).fill(0),
    snare: new Array(STEPS).fill(0),
    hat: new Array(STEPS).fill(0),
    bass: new Array(STEPS).fill(0),
    arp: new Array(STEPS).fill(0),
    pad: 0,
  };
}

export { STEPS };
