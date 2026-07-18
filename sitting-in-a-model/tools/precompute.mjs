// Records a full session of the piece — the same Room engine the browser
// runs, driven from node — into data/fallback.json. The recording plays
// when the model itself cannot be loaded (offline installs, old browsers).
// Deterministic: seeded RNG, so the recording is a citable artifact.
import { AutoTokenizer, AutoModelForMaskedLM, Tensor } from "@huggingface/transformers";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { WordPiece } from "../tokenizer.js";
import { Room } from "../engine.js";

const SEED_TEXT =
  "I am sitting in a model, different from the room you are in. " +
  "I am typing the sound of my voice, and I will feed it back into the model " +
  "again and again, until the common words of the language reinforce themselves, " +
  "and any semblance of my writing, with perhaps the exception of rhythm, is destroyed. " +
  "What you read then are the natural resonant frequencies of the model, articulated by language.";

const STEPS = 700;
const RNG_SEED = 20260718;

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hf = await AutoTokenizer.from_pretrained("Xenova/distilbert-base-uncased");
const model = await AutoModelForMaskedLM.from_pretrained("Xenova/distilbert-base-uncased", {
  dtype: "int8",
});
const wp = new WordPiece(await readFile(new URL("../model/vocab.txt", import.meta.url), "utf8"));

async function forward(ids) {
  const n = ids.length;
  const feeds = {
    input_ids: new Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, n]),
    attention_mask: new Tensor("int64", BigInt64Array.from(ids.map(() => 1n)), [1, n]),
  };
  const { logits } = await model(feeds);
  return { data: logits.data, seq: n, vocab: logits.dims[2] };
}

const room = new Room({ forward, wp, random: mulberry32(RNG_SEED) });
room.reset(SEED_TEXT);

// sanity: our ids must match HF's
const ours = room.ids.join(",");
const hfIds = Array.from(hf(SEED_TEXT).input_ids.data, Number).join(",");
if (ours !== hfIds) throw new Error("tokenizer drift vs HF — refusing to record");

const r3 = (x) => Math.round(x * 1000) / 1000;

const survey = [];
while (!room.surveyed()) {
  const r = await room.surveyStep();
  if (r.i !== undefined) survey.push({ i: r.i - 1, p: r3(r.p) });
}
console.log(`survey recorded: ${survey.length} positions, mean-p ${room.meanP().toFixed(3)}`);

const steps = [];
const t0 = Date.now();
for (let s = 0; s < STEPS; s++) {
  const ev = await room.step();
  steps.push({
    pos: ev.pos - 1,
    oldId: ev.oldId,
    newId: ev.newId,
    pOld: r3(ev.pOld),
    pNew: r3(ev.pNew),
    keep: ev.keep,
    alts: ev.alts.map((a) => ({ id: a.id, p: r3(a.p) })),
    refresh: ev.refresh ? { i: ev.refresh.i - 1, p: r3(ev.refresh.p) } : null,
    pass: ev.pass,
    meanP: r3(ev.meanP),
    settled: ev.settled,
    ids: room.ids.slice(1, -1),
    p: Array.from(room.p.slice(1, -1), r3),
  });
  if ((s + 1) % 100 === 0)
    console.log(
      `pass ${s + 1} · mean-p ${ev.meanP.toFixed(3)} · ${wp.decode(room.ids.slice(1, -1)).slice(0, 90)}…`
    );
}
console.log(`${STEPS} steps in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const out = {
  title: "I Am Sitting in a Model — recorded session",
  seedText: SEED_TEXT,
  rngSeed: RNG_SEED,
  recordedAt: new Date().toISOString(),
  model: "distilbert-base-uncased (int8 ONNX)",
  params: room.params,
  ids0: (() => {
    const r = new Room({ forward, wp, random: mulberry32(RNG_SEED) });
    r.reset(SEED_TEXT);
    return r.ids.slice(1, -1);
  })(),
  survey,
  steps,
};

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
const json = JSON.stringify(out);
await writeFile(new URL("../data/fallback.json", import.meta.url), json);
console.log(`fallback.json: ${(json.length / 1e6).toFixed(1)} MB`);

// print the arc for the essay
for (const s of [1, 60, 150, 300, 500, 700]) {
  const st = steps[s - 1];
  console.log(`\n== pass ${s} (expectancy ${(st.meanP * 100).toFixed(0)}%)`);
  console.log(wp.decode(st.ids));
}
