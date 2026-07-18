// Module worker: loads ONNX Runtime + the chunked DistilBERT model and runs
// the Room engine off the main thread. Speaks a small message protocol with
// app.js; the main thread owns cadence, sound and typography.
import { WordPiece } from "./tokenizer.js";
import { Room } from "./engine.js";

let ort = null;
let session = null;
let wp = null;
let room = null;

const post = (msg) => self.postMessage(msg);

async function fetchWithProgress(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onBytes(buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function load(base) {
  // 1. runtime
  post({ t: "phase", phase: "runtime" });
  ort = (await import(`${base}vendor/ort.wasm.bundle.min.mjs`)).default ??
    (await import(`${base}vendor/ort.wasm.bundle.min.mjs`));
  ort.env.wasm.wasmPaths = `${base}vendor/`;
  // threads only work under cross-origin isolation; fall back silently
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(4, self.navigator?.hardwareConcurrency ?? 1)
    : 1;

  // 2. vocabulary
  post({ t: "phase", phase: "vocab" });
  const vocabText = await (await fetch(`${base}model/vocab.txt`)).text();
  wp = new WordPiece(vocabText);

  // 3. model chunks
  const manifest = await (await fetch(`${base}model/manifest.json`)).json();
  const total = manifest.totalBytes;
  let loaded = 0;
  post({ t: "phase", phase: "weights", total });
  const buf = new Uint8Array(total);
  let off = 0;
  for (const part of manifest.parts) {
    const bytes = await fetchWithProgress(`${base}model/${part.name}`, (n) => {
      loaded += n;
      post({ t: "progress", loaded, total });
    });
    buf.set(bytes, off);
    off += bytes.length;
  }

  // 4. session
  post({ t: "phase", phase: "session" });
  session = await ort.InferenceSession.create(buf, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });

  room = new Room({ forward, wp });
  post({ t: "ready" });
}

async function forward(ids) {
  const n = ids.length;
  const feeds = {
    input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, n]),
    attention_mask: new ort.Tensor("int64", new BigInt64Array(n).fill(1n), [1, n]),
  };
  const out = await session.run(feeds);
  const logits = out.logits ?? out[Object.keys(out)[0]];
  return { data: logits.data, seq: n, vocab: logits.dims[2] };
}

function textPayload() {
  const snap = room.snapshot();
  const inner = snap.ids.slice(1, -1);
  return {
    t: "text",
    ids: inner,
    words: wp.words(inner),
    p: snap.p.slice(1, -1),
    pass: snap.pass,
  };
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.t === "init") {
      await load(m.base);
    } else if (m.t === "setText") {
      room.reset(m.text);
      post(textPayload());
    } else if (m.t === "survey") {
      const r = await room.surveyStep();
      if (r.i !== undefined) post({ t: "survey", i: r.i - 1, p: r.p, done: r.done });
      else post({ t: "survey", done: true });
    } else if (m.t === "step") {
      const ev = await room.step();
      if (!ev) {
        post({ t: "error", message: "the text is empty — nothing to erode" });
        return;
      }
      // shift positions to inner coordinates for the renderer
      post({
        t: "step",
        ev: {
          ...ev,
          pos: ev.pos - 1,
          refresh: ev.refresh ? { i: ev.refresh.i - 1, p: ev.refresh.p } : null,
          ids: room.ids.slice(1, -1),
          words: wp.words(room.ids.slice(1, -1)),
          p: Array.from(room.p.slice(1, -1)),
        },
      });
    } else if (m.t === "params") {
      Object.assign(room.params, m.params);
    }
  } catch (err) {
    post({ t: "error", message: String(err?.message ?? err) });
  }
};
