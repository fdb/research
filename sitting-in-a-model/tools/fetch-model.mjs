// Downloads the model + vocab that the piece runs on, and splits the ONNX
// file into <25 MiB chunks (Cloudflare Pages per-file limit).
//
//   node fetch-model.mjs
//
// Writes into ../model/:
//   model_int8.onnx.part-000 .. part-002
//   vocab.txt        (30522 WordPiece tokens, one per line, index = id)
//   manifest.json    (chunk list + sha256 of the whole file)
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "model");
const REPO = "https://huggingface.co/Xenova/distilbert-base-uncased/resolve/main";
const CHUNK = 23 * 1000 * 1000; // 23 MB, safely under the 25 MiB limit

await mkdir(OUT, { recursive: true });

async function fetchBytes(url) {
  process.stdout.write(`fetching ${url} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  return buf;
}

// 1. tokenizer.json → vocab.txt ordered by id
const tokJson = JSON.parse(new TextDecoder().decode(await fetchBytes(`${REPO}/tokenizer.json`)));
const vocabObj = tokJson.model.vocab; // { token: id }
const vocab = [];
for (const [tok, id] of Object.entries(vocabObj)) vocab[id] = tok;
if (vocab.some((v) => v === undefined)) throw new Error("vocab has holes");
await writeFile(path.join(OUT, "vocab.txt"), vocab.join("\n") + "\n");
console.log(`vocab.txt: ${vocab.length} tokens`);

// 2. model, split into chunks
const model = await fetchBytes(`${REPO}/onnx/model_int8.onnx`);
const sha256 = createHash("sha256").update(model).digest("hex");
const parts = [];
for (let i = 0, n = 0; i < model.length; i += CHUNK, n++) {
  const name = `model_int8.onnx.part-${String(n).padStart(3, "0")}`;
  const slice = model.subarray(i, Math.min(i + CHUNK, model.length));
  await writeFile(path.join(OUT, name), slice);
  parts.push({ name, bytes: slice.length });
  console.log(`${name}: ${(slice.length / 1e6).toFixed(1)} MB`);
}

await writeFile(
  path.join(OUT, "manifest.json"),
  JSON.stringify(
    {
      source: "Xenova/distilbert-base-uncased onnx/model_int8.onnx",
      totalBytes: model.length,
      sha256,
      parts,
    },
    null,
    2
  )
);
console.log(`manifest.json written · sha256 ${sha256.slice(0, 16)}…`);
