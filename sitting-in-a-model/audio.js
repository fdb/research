// The audible room. Every word in the sentence is a partial in a chord:
//   frequency  — a deterministic fold of the token id into five octaves
//                (the vocabulary as a fixed instrument; nothing is composed)
//   amplitude  — the probability the model assigns the word, so improbable
//                (human, specific) words are nearly silent and the drone
//                swells as the text becomes what the model expects
//   unrest     — detune wobble proportional to (1 - p): unsettled words
//                warble, settled words hold still. Lucier's arc, sonified.
// Replacements strike a filtered noise grain at the word's own frequency.

const MAX_VOICES = 28;

export class RoomTone {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.voices = []; // { osc, gain, panner, freq, wobble }
    this.wordVoice = []; // word index -> voice index (or -1)
  }

  get running() {
    return !!this.ctx && this.ctx.state === "running";
  }

  async start() {
    // resume() without a user gesture can stay pending forever — never await
    // it bare; race against a short timeout and report state honestly.
    const tryResume = async (ctx) => {
      if (ctx.state === "running") return;
      await Promise.race([
        ctx.resume().catch(() => {}),
        new Promise((r) => setTimeout(r, 300)),
      ]);
    };
    if (this.ctx) {
      await tryResume(this.ctx);
      return this.running;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    await tryResume(ctx);

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;

    // generated impulse response: 2.6 s exponential-decay noise
    const irLen = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++)
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.8);
    }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.5;
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.6;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -28;
    comp.ratio.value = 6;

    this.master.connect(this.dry).connect(comp);
    this.master.connect(this.verb).connect(this.wet).connect(comp);
    comp.connect(ctx.destination);

    // sub drone — the room's confidence hum
    this.sub = ctx.createOscillator();
    this.sub.type = "sine";
    this.sub.frequency.value = 55;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0;
    this.sub.connect(this.subGain).connect(this.master);
    this.sub.start();

    // noise buffer for grains
    const nb = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = nb;

    for (let v = 0; v < MAX_VOICES; v++) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner
        ? ctx.createStereoPanner()
        : null;
      if (pan) {
        pan.pan.value = 0;
        osc.connect(gain).connect(pan).connect(this.master);
      } else {
        osc.connect(gain).connect(this.master);
      }
      osc.frequency.value = 110;
      osc.start();
      this.voices.push({ osc, gain, pan, freq: 110, p: 0 });
    }

    this._fadeMaster(this.enabled ? 1 : 0, 2.0);
    this.wobbleTimer = setInterval(() => this._wobble(), 240);
    return this.running;
  }

  _fadeMaster(to, secs) {
    if (!this.ctx) return;
    const g = this.master.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(to * 0.9, this.ctx.currentTime, secs / 3);
  }

  setEnabled(on) {
    this.enabled = on;
    this._fadeMaster(on ? 1 : 0, 0.6);
  }

  static freqOf(id) {
    // fold the token id into 5 octaves above 55 Hz — the vocabulary as keyboard
    const u = (id * 2654435761 % 4294967296) / 4294967296;
    return 55 * Math.pow(2, u * 5);
  }

  static ampOf(p, nWords) {
    const clamped = Math.max(0, Math.min(1, p));
    return (Math.pow(clamped, 1.7) * 1.7) / Math.max(8, nWords);
  }

  // Bind current words (display groups) to voices. wordIds = first token id
  // per word; wordP = min piece-probability per word.
  syncWords(wordIds, wordP) {
    if (!this.ctx) return;
    const n = wordIds.length;
    this.wordVoice = new Array(n).fill(-1);
    const stride = Math.max(1, Math.ceil(n / MAX_VOICES));
    let v = 0;
    for (let i = 0; i < n && v < MAX_VOICES; i += stride, v++) {
      this.wordVoice[i] = v;
      const voice = this.voices[v];
      voice.freq = RoomTone.freqOf(wordIds[i]);
      voice.p = Math.max(0, wordP[i]);
      voice.osc.frequency.setTargetAtTime(voice.freq, this.ctx.currentTime, 0.2);
      if (voice.pan) voice.pan.pan.value = (i / Math.max(1, n - 1)) * 1.4 - 0.7;
      voice.gain.gain.setTargetAtTime(
        RoomTone.ampOf(voice.p, n),
        this.ctx.currentTime,
        0.8
      );
    }
    for (; v < MAX_VOICES; v++)
      this.voices[v].gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
    this.nWords = n;
  }

  // A word was read for the first time (survey): fade its partial in.
  onSurvey(wordIndex, id, p) {
    if (!this.ctx) return;
    const v = this.wordVoice[wordIndex];
    if (v == null || v < 0) return;
    const voice = this.voices[v];
    voice.p = p;
    voice.freq = RoomTone.freqOf(id);
    voice.osc.frequency.setTargetAtTime(voice.freq, this.ctx.currentTime, 0.15);
    voice.gain.gain.setTargetAtTime(
      RoomTone.ampOf(p, this.nWords ?? 24),
      this.ctx.currentTime,
      1.2
    );
  }

  // A replacement landed: glide the voice, strike a grain.
  onReplace(wordIndex, id, p, keep) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = this.wordVoice[wordIndex];
    if (v != null && v >= 0) {
      const voice = this.voices[v];
      voice.p = p;
      const f = RoomTone.freqOf(id);
      voice.freq = f;
      voice.osc.frequency.setTargetAtTime(f, t, keep ? 0.05 : 0.35);
      const amp = RoomTone.ampOf(p, this.nWords ?? 24);
      if (keep) {
        // settle pulse: the room agreeing with itself
        voice.gain.gain.setTargetAtTime(amp * 2.2, t, 0.05);
        voice.gain.gain.setTargetAtTime(amp, t + 0.18, 0.4);
      } else {
        voice.gain.gain.setTargetAtTime(amp, t, 0.6);
      }
    }
    // grain
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = RoomTone.freqOf(id);
    bp.Q.value = keep ? 24 : 9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(keep ? 0.05 : 0.11, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (keep ? 0.2 : 0.42));
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.5);
  }

  // Called each step with the room's overall expectancy.
  tick(meanP) {
    if (!this.ctx) return;
    this.subGain.gain.setTargetAtTime(0.05 + meanP * 0.16, this.ctx.currentTime, 1.5);
  }

  // unsettled words warble; settled words hold still
  _wobble() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    for (const voice of this.voices) {
      if (voice.p <= 0) continue;
      const unrest = 1 - Math.max(0, Math.min(1, voice.p));
      if (unrest < 0.02) continue;
      const cents = (Math.random() * 2 - 1) * 55 * unrest;
      voice.osc.detune.setTargetAtTime(cents, t, 0.24);
    }
  }
}
