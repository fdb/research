// Erosion arc with distilbert int8: parameter sweep for the piece's dynamics.
import { AutoTokenizer, AutoModelForMaskedLM, Tensor } from "@huggingface/transformers";

const MODEL_ID = "Xenova/distilbert-base-uncased";

const SEED =
  "I am sitting in a model, different from the room you are in. " +
  "I am typing the sound of my voice, and I will feed it back into the model " +
  "again and again, until the common words of the language reinforce themselves, " +
  "and any semblance of my writing, with perhaps the exception of rhythm, is destroyed. " +
  "What you read then are the natural resonant frequencies of the model, articulated by language.";

const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
const model = await AutoModelForMaskedLM.from_pretrained(MODEL_ID, { dtype: "int8" });
const MASK_ID = tokenizer.mask_token_id;
const SPECIAL = new Set(tokenizer.all_special_ids);

// distilbert = WordPiece: vocab in tokenizerJSON.model.vocab as {token: id}
const vocabObj = tokenizer._tokenizerJSON.model.vocab;
const rawVocab = [];
for (const [tok, id] of Object.entries(vocabObj)) rawVocab[id] = tok;
const ALLOWED = rawVocab.map((t) => !!t && /^(##)?[a-z0-9'.,;:!?()\-]+$/.test(t) && !/^\[unused/.test(t));
function isCont(id) { return (rawVocab[id] ?? "").startsWith("##"); }

function encode(text) { return Array.from(tokenizer(text).input_ids.data, Number); }
function decode(ids) { return tokenizer.decode(ids, { skip_special_tokens: true }); }
async function forward(ids) {
  const feeds = {
    input_ids: new Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    attention_mask: new Tensor("int64", BigInt64Array.from(ids.map(() => 1n)), [1, ids.length]),
  };
  const { logits } = await model(feeds);
  return logits;
}
function softmaxAt(logits, pos) {
  const [, , vocab] = logits.dims;
  const off = pos * vocab, data = logits.data;
  let max = -Infinity;
  for (let i = 0; i < vocab; i++) if (data[off + i] > max) max = data[off + i];
  const probs = new Float32Array(vocab);
  let sum = 0;
  for (let i = 0; i < vocab; i++) { const e = Math.exp(data[off + i] - max); probs[i] = e; sum += e; }
  for (let i = 0; i < vocab; i++) probs[i] /= sum;
  return probs;
}
function sampleFrom(probs, orig, { temperature, topK }) {
  const cand = [];
  for (let i = 0; i < probs.length; i++) {
    if (SPECIAL.has(i) || !ALLOWED[i]) continue;
    if (isCont(i) !== isCont(orig)) continue;
    cand.push(i);
  }
  cand.sort((a, b) => probs[b] - probs[a]);
  const top = cand.slice(0, topK);
  const logits = top.map((id) => Math.log(probs[id] + 1e-12) / temperature);
  const mx = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - mx));
  const s = exps.reduce((a, b) => a + b, 0);
  let r = Math.random() * s;
  for (let i = 0; i < top.length; i++) { r -= exps[i]; if (r <= 0) return top[i]; }
  return top[top.length - 1];
}

async function run({ passes, temperature, topK, strategy, label, snapshotAt }) {
  let ids = encode(SEED);
  const n = ids.length;
  console.log(`\n=== ${label} — seq ${n}, τ${temperature}, top-k ${topK}, select=${strategy} ===`);
  const pCache = new Float32Array(n).fill(0.3);
  for (let i = 1; i < n - 1; i++) {
    const m = ids.slice(); const orig = m[i]; m[i] = MASK_ID;
    pCache[i] = softmaxAt(await forward(m), i)[orig];
  }
  const meanP = () => { let s = 0; for (let i = 1; i < n - 1; i++) s += pCache[i]; return s / (n - 2); };
  console.log(`initial mean masked-p: ${meanP().toFixed(3)}`);
  let changed = 0, kept = 0;
  const t0 = Date.now();
  for (let pass = 1; pass <= passes; pass++) {
    let pos;
    if (strategy === "resonant") {
      let total = 0; const w = new Float32Array(n);
      for (let i = 1; i < n - 1; i++) { w[i] = 1 - pCache[i] + 0.05; total += w[i]; }
      let r = Math.random() * total; pos = 1;
      for (let i = 1; i < n - 1; i++) { r -= w[i]; if (r <= 0) { pos = i; break; } }
    } else {
      pos = 1 + Math.floor(Math.random() * (n - 2));
    }
    const orig = ids[pos];
    const m = ids.slice(); m[pos] = MASK_ID;
    const probs = softmaxAt(await forward(m), pos);
    const next = sampleFrom(probs, orig, { temperature, topK });
    ids[pos] = next;
    pCache[pos] = probs[next];
    if (next !== orig) changed++; else kept++;
    const rp = 1 + Math.floor(Math.random() * (n - 2));
    if (rp !== pos) {
      const m2 = ids.slice(); const o2 = m2[rp]; m2[rp] = MASK_ID;
      pCache[rp] = softmaxAt(await forward(m2), rp)[o2];
    }
    if (snapshotAt.includes(pass)) {
      console.log(`\n-- pass ${pass} · mean-p ${meanP().toFixed(3)} · changed ${changed} kept ${kept}`);
      console.log(decode(ids));
    }
  }
  console.log(`(${((Date.now() - t0) / passes).toFixed(0)} ms/pass)`);
}

const snaps = [10, 30, 60, 120, 250, 400];
await run({ passes: 400, temperature: 0.8, topK: 20, strategy: "resonant", label: "A τ0.8 k20 resonant", snapshotAt: snaps });
await run({ passes: 400, temperature: 1.0, topK: 30, strategy: "uniform", label: "B τ1.0 k30 uniform", snapshotAt: snaps });
await run({ passes: 400, temperature: 0.6, topK: 10, strategy: "resonant", label: "C τ0.6 k10 resonant", snapshotAt: snaps });
