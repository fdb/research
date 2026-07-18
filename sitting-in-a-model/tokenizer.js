// A dependency-free BERT WordPiece tokenizer (uncased), faithful to the
// reference implementation: basic tokenization (lowercase, accent-strip,
// punctuation split, CJK isolation) followed by greedy longest-match
// WordPiece. Validated token-for-token against the Hugging Face tokenizer
// in tools/validate-tokenizer.mjs.
//
// The piece runs on ids; this file is the only bridge between human text
// and the model's 30,522-entry vocabulary.

export const CLS = "[CLS]";
export const SEP = "[SEP]";
export const MASK = "[MASK]";
export const UNK = "[UNK]";
export const PAD = "[PAD]";

export class WordPiece {
  constructor(vocabText) {
    this.tokens = vocabText.split("\n");
    if (this.tokens[this.tokens.length - 1] === "") this.tokens.pop();
    this.ids = new Map();
    this.tokens.forEach((t, i) => this.ids.set(t, i));
    this.clsId = this.ids.get(CLS);
    this.sepId = this.ids.get(SEP);
    this.maskId = this.ids.get(MASK);
    this.unkId = this.ids.get(UNK);
    this.padId = this.ids.get(PAD);
    this.special = new Set([this.clsId, this.sepId, this.maskId, this.unkId, this.padId]);
  }

  // --- basic tokenizer ---------------------------------------------------
  static isPunctuation(ch) {
    const cp = ch.codePointAt(0);
    if (
      (cp >= 33 && cp <= 47) ||
      (cp >= 58 && cp <= 64) ||
      (cp >= 91 && cp <= 96) ||
      (cp >= 123 && cp <= 126)
    )
      return true;
    return /\p{P}/u.test(ch);
  }

  static isCJK(cp) {
    return (
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x20000 && cp <= 0x2a6df) ||
      (cp >= 0x2a700 && cp <= 0x2b73f) ||
      (cp >= 0x2b740 && cp <= 0x2b81f) ||
      (cp >= 0x2b820 && cp <= 0x2ceaf) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0x2f800 && cp <= 0x2fa1f)
    );
  }

  basicTokenize(text) {
    // clean: drop control chars and U+FFFD, normalize whitespace
    let out = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp === 0 || cp === 0xfffd) continue;
      if (/\p{Cc}|\p{Cf}/u.test(ch) && ch !== "\t" && ch !== "\n" && ch !== "\r") continue;
      out += /\s/.test(ch) ? " " : ch;
    }
    // lowercase + strip accents (NFD, drop combining marks)
    out = out.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
    // isolate CJK
    let spaced = "";
    for (const ch of out) {
      spaced += WordPiece.isCJK(ch.codePointAt(0)) ? ` ${ch} ` : ch;
    }
    // whitespace split, then punctuation split
    const words = [];
    for (const w of spaced.split(/\s+/)) {
      if (!w) continue;
      let cur = "";
      for (const ch of w) {
        if (WordPiece.isPunctuation(ch)) {
          if (cur) words.push(cur);
          words.push(ch);
          cur = "";
        } else {
          cur += ch;
        }
      }
      if (cur) words.push(cur);
    }
    return words;
  }

  // --- wordpiece ---------------------------------------------------------
  wordTokenize(word) {
    if (word.length > 100) return [UNK];
    const pieces = [];
    let start = 0;
    while (start < word.length) {
      let end = word.length;
      let piece = null;
      while (start < end) {
        let sub = word.slice(start, end);
        if (start > 0) sub = "##" + sub;
        if (this.ids.has(sub)) {
          piece = sub;
          break;
        }
        end -= 1;
      }
      if (piece === null) return [UNK];
      pieces.push(piece);
      start = end;
    }
    return pieces;
  }

  // encode without special tokens
  encode(text) {
    const ids = [];
    for (const w of this.basicTokenize(text)) {
      for (const p of this.wordTokenize(w)) ids.push(this.ids.get(p) ?? this.unkId);
    }
    return ids;
  }

  // encode with [CLS] ... [SEP]
  encodeSequence(text) {
    return [this.clsId, ...this.encode(text), this.sepId];
  }

  idToPiece(id) {
    return this.tokens[id] ?? UNK;
  }

  isContinuation(id) {
    return (this.tokens[id] ?? "").startsWith("##");
  }

  // Group token ids (without specials) into display words:
  // a word = start piece + its ## continuations. Returns
  // [{ text, start, count }] where start/count index into the ids array.
  words(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i++) {
      const piece = this.idToPiece(ids[i]);
      if (piece.startsWith("##") && out.length > 0) {
        const w = out[out.length - 1];
        w.text += piece.slice(2);
        w.count += 1;
      } else {
        out.push({ text: piece, start: i, count: 1 });
      }
    }
    return out;
  }

  // Flat string for strata lines.
  decode(ids) {
    let s = "";
    for (const w of this.words(ids)) {
      const attach =
        /^[.,;:!?'%)\]}»]/.test(w.text) || /['-]$/.test(s) || s === "";
      s += (attach ? "" : " ") + w.text;
    }
    return s;
  }
}
