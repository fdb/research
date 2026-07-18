// Fill-mask quality battery across candidate models/precisions.
import { AutoTokenizer, AutoModelForMaskedLM, Tensor } from "@huggingface/transformers";

const CLOZE = [
  ["paris is the [MASK] of france.", "capital"],
  ["the sun rises in the [MASK].", "east"],
  ["i am sitting in a [MASK], different from the one you are in now.", "room"],
  ["she poured the tea into a [MASK].", "cup"],
  ["the opposite of hot is [MASK].", "cold"],
  ["he played a slow song on the [MASK].", "piano"],
];

async function evalModel(id, dtype) {
  const label = `${id.split("/")[1]} ${dtype}`;
  try {
    const tokenizer = await AutoTokenizer.from_pretrained(id);
    const model = await AutoModelForMaskedLM.from_pretrained(id, { dtype });
    const MASK = tokenizer.mask_token;
    const MASK_ID = tokenizer.mask_token_id;
    let sumP = 0, hits = 0;
    const lines = [];
    for (const [tpl, answer] of CLOZE) {
      const text = tpl.replace("[MASK]", MASK);
      const enc = tokenizer(text);
      const ids = Array.from(enc.input_ids.data, Number);
      const pos = ids.indexOf(MASK_ID);
      const feeds = {
        input_ids: new Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        attention_mask: new Tensor("int64", BigInt64Array.from(ids.map(() => 1n)), [1, ids.length]),
        token_type_ids: new Tensor("int64", BigInt64Array.from(ids.map(() => 0n)), [1, ids.length]),
      };
      const t0 = Date.now();
      const { logits } = await model(feeds);
      const dt = Date.now() - t0;
      const [, , vocab] = logits.dims;
      const off = pos * vocab;
      const data = logits.data;
      let max = -Infinity;
      for (let i = 0; i < vocab; i++) if (data[off + i] > max) max = data[off + i];
      let sum = 0;
      const exps = new Float32Array(vocab);
      for (let i = 0; i < vocab; i++) { exps[i] = Math.exp(data[off + i] - max); sum += exps[i]; }
      const top = [...exps.keys()].sort((a, b) => exps[b] - exps[a]).slice(0, 5);
      const top5 = top.map((i) => `${tokenizer.decode([i]).trim()}:${(exps[i] / sum).toFixed(2)}`).join(" ");
      // p(answer)
      const ansIds = Array.from(tokenizer(answer, { add_special_tokens: false }).input_ids.data, Number);
      const pAns = ansIds.length === 1 ? exps[ansIds[0]] / sum : 0;
      sumP += pAns;
      if (top.slice(0, 3).some((i) => tokenizer.decode([i]).trim() === answer)) hits++;
      lines.push(`   [${answer}] p=${pAns.toFixed(3)} top5: ${top5}  (${dt}ms)`);
    }
    console.log(`\n### ${label} — top3-hit ${hits}/${CLOZE.length}, mean p(answer) ${(sumP / CLOZE.length).toFixed(3)}`);
    for (const l of lines) console.log(l);
    await model.dispose?.();
  } catch (e) {
    console.log(`\n### ${label} — FAILED: ${String(e).slice(0, 160)}`);
  }
}

const runs = [
  ["Xenova/albert-base-v2", "int8"],
  ["Xenova/albert-base-v2", "q4f16"],
  ["Xenova/albert-base-v2", "fp16"],
  ["Xenova/albert-base-v2", "fp32"],
  ["Xenova/distilbert-base-uncased", "int8"],
  ["Xenova/distilbert-base-uncased", "fp32"],
];
for (const [id, dtype] of runs) await evalModel(id, dtype);
