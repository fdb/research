// Validate our WordPiece port against the Hugging Face tokenizer.
import { AutoTokenizer } from "@huggingface/transformers";
import { readFile } from "node:fs/promises";
import { WordPiece } from "../tokenizer.js";

const hf = await AutoTokenizer.from_pretrained("Xenova/distilbert-base-uncased");
const ours = new WordPiece(await readFile(new URL("../model/vocab.txt", import.meta.url), "utf8"));

const CASES = [
  "I am sitting in a model, different from the room you are in now. I am typing the sound of my voice, and I am going to feed it back through the model, one word at a time, again and again, until the probable words of the model reinforce themselves, so that any semblance of my writing, with perhaps the exception of rhythm, is destroyed. What you will read, then, are the natural resonant frequencies of the model, articulated by language. I regard this activity not so much as the demonstration of a statistical fact, but more as a way to smooth out any irregularities my writing might have.",
  "Hello, world! This is a test.",
  "The quick brown fox jumps over the lazy dog (twice).",
  "naïve café — résumé; coöperate…",
  "Unbelievable! Anti-disestablishmentarianism, 42.5% of $1,000?",
  "we're can't shouldn't o'clock don't",
  "snake_case camelCase kebab-case dot.case",
  "日本語のテキストと中文字符 mixed with English",
  "    weird   whitespace\tand\nnewlines   ",
  "emoji 🌊 and symbols © ® ™ § ¶",
  "ALLCAPS SENTENCE WITH Numbers 123 AND 456!",
  "a",
  "Ægir straße œuvre ﬁ ligature",
];

let pass = 0, fail = 0;
for (const text of CASES) {
  const a = Array.from(hf(text).input_ids.data, Number);
  const b = ours.encodeSequence(text);
  const ok = a.length === b.length && a.every((x, i) => x === b[i]);
  if (ok) pass++;
  else {
    fail++;
    console.log(`MISMATCH: ${JSON.stringify(text.slice(0, 60))}`);
    console.log("  hf :", a.join(" "));
    console.log("  our:", b.join(" "));
    const hfToks = a.map((id) => hf.decode([id]));
    const ourToks = b.map((id) => ours.idToPiece(id));
    console.log("  hf :", hfToks.join("|"));
    console.log("  our:", ourToks.join("|"));
  }
}
console.log(`\n${pass}/${CASES.length} match, ${fail} mismatches`);
if (fail) process.exit(1);
