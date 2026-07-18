// The room itself: iterated masked resampling (a Gibbs walk) through a
// masked language model. Environment-agnostic — the model is injected as
// an async forward(ids) -> { data: Float32Array, seq, vocab } function, so
// the same code runs in the browser worker (ONNX Runtime Web) and in node
// (tools/precompute.mjs).
//
// One step of the walk:
//   1. choose a position, weighted toward words the model finds improbable
//      ("resonant erosion": the room replaces what it does not expect)
//   2. mask it, run the model, sample a replacement from the top-k of the
//      predicted distribution at a low temperature
//   3. re-measure one other random position (probabilities drift as
//      context changes; the cache follows)
//
// What survives is not the message but the medium.

export const DEFAULTS = {
  temperature: 0.65,
  topK: 12,
  epsilon: 0.05, // floor on selection weight: no word is immortal
  maxTokens: 144, // inner tokens, excluding [CLS]/[SEP]; fits the full seed score
  settledP: 0.6,
};

export class Room {
  constructor({ forward, wp, params = {}, random = Math.random }) {
    this.forward = forward; // async (ids:number[]) => {data, seq, vocab}
    this.wp = wp; // WordPiece instance
    this.params = { ...DEFAULTS, ...params };
    this.random = random;
    // candidate filter: lowercase ascii word pieces and plain punctuation —
    // the register the model itself dominates in
    this.allowed = this.wp.tokens.map(
      (t) => /^(##)?[a-z0-9'.,;:!?()\-]+$/.test(t) && !/^\[unused/.test(t)
    );
    this.reset("");
  }

  reset(text) {
    let inner = this.wp.encode(text);
    if (inner.length > this.params.maxTokens) inner = inner.slice(0, this.params.maxTokens);
    this.ids = [this.wp.clsId, ...inner, this.wp.sepId];
    const n = this.ids.length;
    this.p = new Float32Array(n).fill(-1); // -1 = not yet surveyed
    this.surveyOrder = [];
    for (let i = 1; i < n - 1; i++) this.surveyOrder.push(i);
    shuffle(this.surveyOrder, this.random);
    this.pass = 0;
    this.changed = 0;
    this.kept = 0;
    return this.snapshot();
  }

  get n() {
    return this.ids.length;
  }

  surveyed() {
    return this.surveyOrder.length === 0;
  }

  meanP() {
    let s = 0,
      c = 0;
    for (let i = 1; i < this.n - 1; i++)
      if (this.p[i] >= 0) {
        s += this.p[i];
        c++;
      }
    return c ? s / c : 0;
  }

  settledCount() {
    let c = 0;
    for (let i = 1; i < this.n - 1; i++) if (this.p[i] >= this.params.settledP) c++;
    return c;
  }

  snapshot() {
    return {
      ids: this.ids.slice(),
      p: Array.from(this.p),
      pass: this.pass,
      changed: this.changed,
      kept: this.kept,
      meanP: this.meanP(),
      settled: this.settledCount(),
    };
  }

  async measure(i) {
    const masked = this.ids.slice();
    const orig = masked[i];
    masked[i] = this.wp.maskId;
    const logits = await this.forward(masked);
    const dist = softmaxAt(logits, i);
    this.p[i] = dist[orig];
    return dist;
  }

  // One survey measurement; returns {i, p, done}. The model reading the text.
  async surveyStep() {
    if (this.surveyed()) return { done: true };
    const i = this.surveyOrder.pop();
    await this.measure(i);
    return { i, p: this.p[i], done: this.surveyed() };
  }

  choosePosition() {
    const { epsilon } = this.params;
    let total = 0;
    const w = new Float32Array(this.n);
    for (let i = 1; i < this.n - 1; i++) {
      const pi = this.p[i] >= 0 ? this.p[i] : 0.5;
      w[i] = 1 - pi + epsilon;
      total += w[i];
    }
    let r = this.random() * total;
    for (let i = 1; i < this.n - 1; i++) {
      r -= w[i];
      if (r <= 0) return i;
    }
    return this.n - 2;
  }

  sample(dist, origId) {
    const { temperature, topK } = this.params;
    const contWanted = this.wp.isContinuation(origId);
    const cand = [];
    for (let i = 0; i < dist.length; i++) {
      if (this.wp.special.has(i) || !this.allowed[i]) continue;
      if (this.wp.isContinuation(i) !== contWanted) continue;
      cand.push(i);
    }
    cand.sort((a, b) => dist[b] - dist[a]);
    const top = cand.slice(0, topK);
    const logits = top.map((id) => Math.log(dist[id] + 1e-12) / temperature);
    const mx = Math.max(...logits);
    const exps = logits.map((l) => Math.exp(l - mx));
    const sum = exps.reduce((a, b) => a + b, 0);
    let r = this.random() * sum;
    for (let i = 0; i < top.length; i++) {
      r -= exps[i];
      if (r <= 0) return { id: top[i], top };
    }
    return { id: top[top.length - 1], top };
  }

  // One erosion step. Returns the event the renderer needs.
  async step() {
    if (this.n <= 2) return null; // nothing but [CLS][SEP]: no room to erode
    const pos = this.choosePosition();
    const oldId = this.ids[pos];
    const dist = await this.measure(pos); // p[pos] updated for oldId
    const pOld = dist[oldId];
    const { id: newId, top } = this.sample(dist, oldId);
    this.ids[pos] = newId;
    this.p[pos] = dist[newId];
    this.pass += 1;
    if (newId === oldId) this.kept += 1;
    else this.changed += 1;

    // drift correction: re-measure one other random position
    let refresh = null;
    if (this.n > 4) {
      let rp = 1 + Math.floor(this.random() * (this.n - 2));
      if (rp === pos) rp = rp === this.n - 2 ? 1 : rp + 1;
      await this.measure(rp);
      refresh = { i: rp, p: this.p[rp] };
    }

    return {
      pos,
      oldId,
      newId,
      pOld,
      pNew: this.p[pos],
      keep: newId === oldId,
      // the model's live shortlist at that position (for the flicker beat)
      alts: top.slice(0, 3).map((id) => ({ id, p: dist[id] })),
      refresh,
      pass: this.pass,
      meanP: this.meanP(),
      settled: this.settledCount(),
    };
  }
}

export function softmaxAt(logits, pos) {
  const { data, vocab } = logits;
  const off = pos * vocab;
  let max = -Infinity;
  for (let i = 0; i < vocab; i++) if (data[off + i] > max) max = data[off + i];
  const out = new Float32Array(vocab);
  let sum = 0;
  for (let i = 0; i < vocab; i++) {
    const e = Math.exp(data[off + i] - max);
    out[i] = e;
    sum += e;
  }
  for (let i = 0; i < vocab; i++) out[i] /= sum;
  return out;
}

function shuffle(a, random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}
