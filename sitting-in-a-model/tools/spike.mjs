// Spike: does iterated masked resampling through ALBERT produce a legible
// erosion arc? Runs the real algorithm, prints snapshots + stats.
import { AutoTokenizer, AutoModelForMaskedLM, Tensor } from "@huggingface/transformers";

const MODEL_ID = "Xenova/albert-base-v2";

const SEED =
  "I am sitting in a model, different from the room you are in. " +
  "I am typing the sound of my voice, and I will feed it back into the model " +
  "again and again, until the common words of the language reinforce themselves, " +
  "and any semblance of my writing, with perhaps the exception of rhythm, is destroyed. " +
  "What you read then are the natural resonant frequencies of the model, articulated by language.";

console.log("loading tokenizer + model (int8)...");
const t0 = Date.now();
const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
const model = await AutoModelForMaskedLM.from_pretrained(MODEL_ID, { dtype: "int8" });
console.log(`loaded in ${Date.now() - t0} ms`);

const MASK_ID = tokenizer.mask_token_id;
console.log("mask token:", tokenizer.mask_token, MASK_ID);

// --- helpers -------------------------------------------------------------
function encode(text) {
  const enc = tokenizer(text);
  return Array.from(enc.input_ids.data, Number);
}
function decode(ids) {
  return tokenizer.decode(ids, { skip_special_tokens: true });
}
function tensorFromIds(ids) {
  return new Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
}
async function forward(ids) {
  const input_ids = tensorFromIds(ids);
  const attention_mask = new Tensor(
    "int64",
    BigInt64Array.from(ids.map(() => 1n)),
    [1, ids.length]
  );
  const token_type_ids = new Tensor(
    "int64",
    BigInt64Array.from(ids.map(() => 0n)),
    [1, ids.length]
  );
  const { logits } = await model({ input_ids, attention_mask, token_type_ids });
  return logits; // [1, seq, vocab]
}
function softmaxAt(logits, pos) {
  const [, seq, vocab] = logits.dims;
  const off = pos * vocab;
  const data = logits.data;
  let max = -Infinity;
  for (let i = 0; i < vocab; i++) if (data[off + i] > max) max = data[off + i];
  const probs = new Float32Array(vocab);
  let sum = 0;
  for (let i = 0; i < vocab; i++) {
    const e = Math.exp(data[off + i] - max);
    probs[i] = e;
    sum += e;
  }
  for (let i = 0; i < vocab; i++) probs[i] /= sum;
  return probs;
}

// token id classification for constraints
const SPECIAL = new Set(tokenizer.all_special_ids);
const rawVocab = tokenizer._tokenizerJSON.model.vocab.map((v) => v[0]);
const idToToken = rawVocab.map((t) => t.replace(/▁/g, " "));
function isWordStart(id) {
  return (rawVocab[id] ?? "").startsWith("▁");
}

function sampleFrom(probs, { temperature, topK, constraint }) {
  // gather candidate ids
  const cand = [];
  for (let i = 0; i < probs.length; i++) {
    if (SPECIAL.has(i)) continue;
    if (constraint && !constraint(i)) continue;
    cand.push(i);
  }
  cand.sort((a, b) => probs[b] - probs[a]);
  const top = cand.slice(0, topK);
  // temperature on log-probs
  const logits = top.map((id) => Math.log(probs[id] + 1e-12) / temperature);
  const mx = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - mx));
  const s = exps.reduce((a, b) => a + b, 0);
  let r = Math.random() * s;
  for (let i = 0; i < top.length; i++) {
    r -= exps[i];
    if (r <= 0) return top[i];
  }
  return top[top.length - 1];
}

// --- the erosion loop ----------------------------------------------------
async function run({ passes, temperature, topK, boundary, label, snapshotAt }) {
  let ids = encode(SEED);
  const n = ids.length;
  console.log(`\n=== ${label}: seq=${n} tokens, τ=${temperature}, topK=${topK}, boundary=${boundary} ===`);

  // survey: masked pseudo-prob of each current token
  const pCache = new Float32Array(n).fill(0.5);
  const surveyStart = Date.now();
  for (let i = 1; i < n - 1; i++) {
    const masked = ids.slice();
    const orig = masked[i];
    masked[i] = MASK_ID;
    const logits = await forward(masked);
    const probs = softmaxAt(logits, i);
    pCache[i] = probs[orig];
  }
  console.log(
    `survey: ${Date.now() - surveyStart} ms for ${n - 2} positions (${((Date.now() - surveyStart) / (n - 2)).toFixed(0)} ms/forward)`
  );
  const meanP = () => {
    let s = 0;
    for (let i = 1; i < n - 1; i++) s += pCache[i];
    return s / (n - 2);
  };
  console.log(`initial mean masked-p: ${meanP().toFixed(3)}`);
  // show the least/most expected words initially
  const pairs = [];
  for (let i = 1; i < n - 1; i++) pairs.push([pCache[i], idToToken[ids[i]]]);
  pairs.sort((a, b) => a[0] - b[0]);
  console.log("least expected:", pairs.slice(0, 6).map(([p, w]) => `${w}(${p.toFixed(2)})`).join(" "));
  console.log("most expected:", pairs.slice(-6).map(([p, w]) => `${w}(${p.toFixed(2)})`).join(" "));

  let changed = 0;
  const stepStart = Date.now();
  for (let pass = 1; pass <= passes; pass++) {
    // choose position ∝ (1 - p + eps)
    let total = 0;
    const w = new Float32Array(n);
    for (let i = 1; i < n - 1; i++) {
      w[i] = 1 - pCache[i] + 0.05;
      total += w[i];
    }
    let r = Math.random() * total;
    let pos = 1;
    for (let i = 1; i < n - 1; i++) {
      r -= w[i];
      if (r <= 0) {
        pos = i;
        break;
      }
    }

    const orig = ids[pos];
    const masked = ids.slice();
    masked[pos] = MASK_ID;
    const logits = await forward(masked);
    const probs = softmaxAt(logits, pos);
    const constraint = boundary
      ? (id) => isWordStart(id) === isWordStart(orig)
      : null;
    const next = sampleFrom(probs, { temperature, topK, constraint });
    ids[pos] = next;
    pCache[pos] = probs[next];
    if (next !== orig) changed++;

    // refresh one random other position
    const rp = 1 + Math.floor(Math.random() * (n - 2));
    if (rp !== pos) {
      const m2 = ids.slice();
      const o2 = m2[rp];
      m2[rp] = MASK_ID;
      const l2 = await forward(m2);
      pCache[rp] = softmaxAt(l2, rp)[o2];
    }

    if (snapshotAt.includes(pass)) {
      console.log(`\n--- pass ${pass} (mean-p ${meanP().toFixed(3)}, ${changed} changes) ---`);
      console.log(decode(ids));
    }
  }
  const ms = Date.now() - stepStart;
  console.log(`\n${passes} passes in ${(ms / 1000).toFixed(1)} s → ${(ms / passes).toFixed(0)} ms/pass (2 forwards each)`);
  return decode(ids);
}

const snapshotAt = [1, 5, 10, 25, 50, 100, 200, 300];
await run({ passes: 300, temperature: 0.9, topK: 50, boundary: true, label: "A boundary τ0.9", snapshotAt });
await run({ passes: 300, temperature: 0.7, topK: 50, boundary: true, label: "B boundary τ0.7", snapshotAt });
await run({ passes: 300, temperature: 1.0, topK: 50, boundary: false, label: "C free τ1.0", snapshotAt });
