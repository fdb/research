/*
 * editor.js — a small code editor built on a textarea, tuned for
 * live coding. Still no dependency, still readable in one sitting.
 *
 * A syntax-highlight <pre> sits behind a transparent-text textarea;
 * both share metrics exactly, so the caret is native and undo is the
 * browser's. All programmatic edits go through execCommand so they
 * stay on the native undo stack.
 *
 * Keys (mod = ctrl or cmd):
 *   mod+enter          run block under cursor
 *   mod+shift+enter    run whole buffer
 *   mod+↑ / mod+↓      nudge number under cursor ±1 (shift ×10, alt ×.1)
 *                      …and re-run its block: parameter sweeps by keyboard
 *   mod+/              toggle comment (mute a voice without deleting it)
 *   mod+d              duplicate line / selection
 *   alt+↑ / alt+↓      move line up / down
 *   tab / shift+tab    indent / dedent (selection-aware)
 */

// ------------------------------------------------------- highlighting

const JS_KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|of|in|new|true|false|null|undefined|typeof|=>)\b/;
const GLSL_KEYWORDS = /\b(void|float|int|bool|vec2|vec3|vec4|mat2|mat3|mat4|uniform|varying|attribute|precision|highp|mediump|lowp|if|else|for|return|true|false)\b/;
const GLSL_BUILTINS = /\b(gl_FragCoord|gl_FragColor|sin|cos|tan|atan|pow|exp|log|sqrt|abs|sign|floor|ceil|fract|mod|min|max|clamp|mix|step|smoothstep|length|distance|dot|cross|normalize|u_res|u_time|u_cycle|u_beat|u_rms|u_bass|u_mid|u_high)\b/;
const DSL_NAMES = /\b(d[1-9]|p|s|n|note|sound|gain|pan|speed|cutoff|lpf|resonance|attack|decay|sustain|release|delay|room|legato|detune|fmh|fmi|crush|hush|bpm|visual|stack|seq|cat|slowcat|fastcat|timecat|silence|mini|m|pure|signal|sine|cosine|saw|isaw|tri|square|rand|irand|perlin|choose|run|scale|fast|slow|rev|iter|every|off|ply|degrade|degradeBy|sometimes|sometimesBy|often|rarely|jux|struct|euclid|range|rangex|round)\b/;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function highlight(src, lang = "js") {
  // one pass: comments and strings first (they swallow everything),
  // then numbers / keywords / dsl names on the remainder.
  const out = [];
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|([^\/"'`]+|.)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) {
      out.push(`<span class="c">${esc(m[1])}</span>`);
    } else if (m[2] !== undefined) {
      out.push(`<span class="s">${esc(m[2])}</span>`);
    } else {
      out.push(plain(m[3], lang));
    }
  }
  return out.join("");
}

function plain(chunk, lang) {
  let html = esc(chunk);
  html = html.replace(/\b\d+\.?\d*\b|\.\d+\b/g, '<span class="d">$&</span>');
  if (lang === "glsl") {
    html = html.replace(new RegExp(GLSL_KEYWORDS.source, "g"), '<span class="k">$&</span>');
    html = html.replace(new RegExp(GLSL_BUILTINS.source, "g"), '<span class="f">$&</span>');
  } else if (lang === "js") {
    html = html.replace(new RegExp(JS_KEYWORDS.source, "g"), '<span class="k">$&</span>');
    html = html.replace(new RegExp(DSL_NAMES.source, "g"), '<span class="f">$&</span>');
  }
  return html;
}

export function langForPath(path = "") {
  if (path.endsWith(".glsl")) return "glsl";
  if (path.endsWith(".json")) return "js";
  if (path.endsWith(".md")) return "text";
  return "js";
}

// ------------------------------------------------------------- editor

export class Editor {
  /**
   * opts: {
   *   onRun(code, {all}) => {ok, error?}
   *   onSave?(text)                       debounced on every edit
   *   lang?: "js" | "glsl" | "text"
   * }
   */
  constructor(parent, opts = {}) {
    this.opts = opts;
    this.lang = opts.lang || "js";

    this.el = document.createElement("div");
    this.el.className = "ed";
    this.hl = document.createElement("pre");
    this.hl.className = "ed-hl";
    this.hlCode = document.createElement("code");
    this.hl.appendChild(this.hlCode);
    this.blockMark = document.createElement("div");
    this.blockMark.className = "ed-block";
    this.flashEl = document.createElement("div");
    this.flashEl.className = "ed-flash";
    this.ta = document.createElement("textarea");
    this.ta.spellcheck = false;
    this.ta.autocapitalize = "off";
    this.ta.autocomplete = "off";
    this.ta.setAttribute("autocorrect", "off");
    this.ta.wrap = "off";
    this.el.append(this.hl, this.blockMark, this.flashEl, this.ta);
    parent.appendChild(this.el);

    this._saveTimer = null;
    this.ta.addEventListener("input", () => {
      this.render();
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.opts.onSave?.(this.ta.value), 300);
    });
    this.ta.addEventListener("scroll", () => this.syncScroll());
    for (const evt of ["keyup", "click", "focus"]) {
      this.ta.addEventListener(evt, () => this.updateBlockMark());
    }
    this.ta.addEventListener("blur", () => { this.blockMark.style.opacity = "0"; });
    this.ta.addEventListener("keydown", (e) => this.keydown(e));
  }

  get value() { return this.ta.value; }
  set value(text) {
    this.ta.value = text;
    this.render();
  }

  setLang(lang) {
    this.lang = lang;
    this.render();
  }

  focus() { this.ta.focus(); }

  render() {
    this.hlCode.innerHTML =
      (this.lang === "text" ? esc(this.ta.value) : highlight(this.ta.value, this.lang)) + "\n";
    this.syncScroll();
    this.updateBlockMark();
  }

  syncScroll() {
    this.hl.scrollTop = this.ta.scrollTop;
    this.hl.scrollLeft = this.ta.scrollLeft;
    this.updateBlockMark();
    this.flashEl.style.transform = `translateY(${-this.ta.scrollTop}px)`;
  }

  metrics() {
    const cs = getComputedStyle(this.ta);
    return {
      lh: parseFloat(cs.lineHeight) || 20,
      padTop: parseFloat(cs.paddingTop) || 0,
    };
  }

  // ---- edits that keep the native undo stack ----

  replaceRange(from, to, text, selFrom = null, selTo = null) {
    const value = this.ta.value;
    const expected = value.slice(0, from) + text + value.slice(to);
    this.ta.focus();
    this.ta.setSelectionRange(from, to);
    try {
      if (text === "") {
        document.execCommand("delete");
      } else {
        // Chromium's insertText drops newlines in textareas; insert
        // line by line with insertLineBreak in between.
        text.split("\n").forEach((part, i) => {
          if (i) document.execCommand("insertLineBreak");
          if (part) document.execCommand("insertText", false, part);
        });
      }
    } catch { /* verified below */ }
    if (this.ta.value !== expected) {
      // execCommand unsupported or partial: set directly (undo is lost
      // for this edit only, and only in browsers without execCommand)
      this.ta.value = expected;
      this.ta.setSelectionRange(from + text.length, from + text.length);
      this.ta.dispatchEvent(new Event("input"));
    }
    if (selFrom !== null) this.ta.setSelectionRange(selFrom, selTo ?? selFrom);
  }

  insert(text) {
    const { selectionStart: a, selectionEnd: b } = this.ta;
    this.replaceRange(a, b, text);
  }

  // ---- structure helpers ----

  lineIndexAt(pos) {
    return this.ta.value.slice(0, pos).split("\n").length - 1;
  }

  lineRange(i) {
    const lines = this.ta.value.split("\n");
    let start = 0;
    for (let j = 0; j < i; j++) start += lines[j].length + 1;
    return { start, end: start + (lines[i]?.length ?? 0), text: lines[i] ?? "" };
  }

  currentBlock() {
    const lines = this.ta.value.split("\n");
    let cursorLine = this.lineIndexAt(this.ta.selectionStart);
    if (cursorLine >= lines.length) cursorLine = lines.length - 1;
    const blank = (i) => lines[i] === undefined || lines[i].trim() === "";
    if (blank(cursorLine)) return null;
    let from = cursorLine, to = cursorLine;
    while (from > 0 && !blank(from - 1)) from--;
    while (to < lines.length - 1 && !blank(to + 1)) to++;
    return { code: lines.slice(from, to + 1).join("\n"), from, to };
  }

  // ---- key handling ----

  keydown(e) {
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key === "Enter") {
      e.preventDefault();
      this.run(e.shiftKey);
      return;
    }
    if (mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      if (this.nudgeNumber(e.key === "ArrowUp" ? 1 : -1, e.shiftKey ? 10 : e.altKey ? 0.1 : 1)) {
        e.preventDefault();
        return;
      }
      return; // no number under cursor: let the caret move
    }
    if (mod && (e.key === "/" || e.code === "Slash")) {
      e.preventDefault();
      this.toggleComment();
      return;
    }
    if (mod && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      this.duplicate();
      return;
    }
    if (e.altKey && !mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      this.moveLine(e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      this.indent(e.shiftKey);
      return;
    }
    if (e.key === "Enter" && !mod) {
      e.preventDefault();
      this.smartNewline();
      return;
    }
    if (!mod && !e.altKey) this.autoPairs(e);
  }

  autoPairs(e) {
    const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "`": "`" };
    const { selectionStart: a, selectionEnd: b, value } = this.ta;
    // skip over an identical closing char
    if ([")", "]", "}", '"', "`"].includes(e.key) && a === b && value[a] === e.key) {
      e.preventDefault();
      this.ta.setSelectionRange(a + 1, a + 1);
      return;
    }
    if (PAIRS[e.key]) {
      // don't pair a quote directly before a word character
      if ((e.key === '"' || e.key === "`") && /\w/.test(value[a] || "")) return;
      e.preventDefault();
      if (a !== b) {
        const inner = value.slice(a, b);
        this.replaceRange(a, b, e.key + inner + PAIRS[e.key], a + 1, b + 1);
      } else {
        this.replaceRange(a, a, e.key + PAIRS[e.key], a + 1, a + 1);
      }
      return;
    }
    if (e.key === "Backspace" && a === b && a > 0) {
      const pair = value[a - 1] + (value[a] || "");
      if (["()", "[]", "{}", '""', "``"].includes(pair)) {
        e.preventDefault();
        this.replaceRange(a - 1, a + 1, "");
      }
    }
  }

  smartNewline() {
    const { selectionStart: a, value } = this.ta;
    const line = this.lineRange(this.lineIndexAt(a));
    const indent = /^[ \t]*/.exec(line.text)[0];
    const before = value[a - 1], after = value[a];
    if (before === "{" && after === "}") {
      this.replaceRange(a, this.ta.selectionEnd, "\n" + indent + "  " + "\n" + indent,
        a + 1 + indent.length + 2);
    } else {
      this.replaceRange(a, this.ta.selectionEnd, "\n" + indent);
    }
  }

  indent(dedent) {
    const { selectionStart: a, selectionEnd: b, value } = this.ta;
    const l0 = this.lineIndexAt(a), l1 = this.lineIndexAt(b);
    if (l0 === l1 && !dedent) { this.insert("  "); return; }
    const lines = value.split("\n");
    const start = this.lineRange(l0).start;
    const end = this.lineRange(l1).end;
    const changed = lines.slice(l0, l1 + 1).map((ln) =>
      dedent ? ln.replace(/^ {1,2}/, "") : (ln.trim() ? "  " + ln : ln));
    this.replaceRange(start, end, changed.join("\n"), start, start + changed.join("\n").length);
  }

  toggleComment() {
    const marker = this.lang === "glsl" || this.lang === "js" ? "// " : "// ";
    const { selectionStart: a, selectionEnd: b, value } = this.ta;
    const l0 = this.lineIndexAt(a), l1 = this.lineIndexAt(b);
    const lines = value.split("\n").slice(l0, l1 + 1);
    const nonEmpty = lines.filter((l) => l.trim());
    const allCommented = nonEmpty.length > 0 && nonEmpty.every((l) => /^\s*\/\//.test(l));
    const changed = lines.map((ln) => {
      if (!ln.trim()) return ln;
      if (allCommented) return ln.replace(/^(\s*)\/\/ ?/, "$1");
      return ln.replace(/^(\s*)/, "$1" + marker);
    });
    const start = this.lineRange(l0).start;
    const end = this.lineRange(l1).end;
    const text = changed.join("\n");
    this.replaceRange(start, end, text, start, start + text.length);
  }

  duplicate() {
    const { selectionStart: a, selectionEnd: b } = this.ta;
    if (a !== b) {
      const sel = this.ta.value.slice(a, b);
      this.replaceRange(b, b, sel, b, b + sel.length);
    } else {
      const line = this.lineRange(this.lineIndexAt(a));
      const col = a - line.start;
      this.replaceRange(line.end, line.end, "\n" + line.text,
        line.end + 1 + col);
    }
  }

  moveLine(dir) {
    const { selectionStart: a } = this.ta;
    const i = this.lineIndexAt(a);
    const lines = this.ta.value.split("\n");
    const j = i + dir;
    if (j < 0 || j >= lines.length) return;
    const col = a - this.lineRange(i).start;
    [lines[i], lines[j]] = [lines[j], lines[i]];
    const from = this.lineRange(Math.min(i, j)).start;
    const to = this.lineRange(Math.max(i, j)).end;
    const text = lines.slice(Math.min(i, j), Math.max(i, j) + 1).join("\n");
    this.replaceRange(from, to, text);
    const newLine = this.lineRange(j);
    const pos = Math.min(newLine.start + col, newLine.end);
    this.ta.setSelectionRange(pos, pos);
    this.updateBlockMark();
  }

  // Nudge the number the cursor is on/next to; re-run its block so
  // parameter sweeps are a keyboard gesture. Returns false if no number.
  nudgeNumber(sign, step) {
    const { selectionStart: a } = this.ta;
    const li = this.lineIndexAt(a);
    const line = this.lineRange(li);
    const col = a - line.start;
    const re = /-?\d+\.?\d*|-?\.\d+/g;
    let m, hit = null;
    while ((m = re.exec(line.text))) {
      if (col >= m.index && col <= m.index + m[0].length) { hit = m; break; }
    }
    if (!hit) return false;
    const oldNum = parseFloat(hit[0]);
    const decimals = Math.max(
      (hit[0].split(".")[1] || "").length,
      step < 1 ? 1 : 0
    );
    const next = (oldNum + sign * step).toFixed(decimals)
      .replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    const from = line.start + hit.index;
    this.replaceRange(from, from + hit[0].length, next, from, from + next.length);
    // re-run the block this number lives in
    const block = this.currentBlock();
    if (block) {
      const result = this.opts.onRun?.(block.code, { all: false, nudge: true }) || { ok: true };
      this.flash(block, result.ok !== false, true);
    }
    return true;
  }

  // ---- run & feedback ----

  run(all = false) {
    let code, region;
    if (all) {
      code = this.ta.value;
      region = { from: 0, to: this.ta.value.split("\n").length - 1 };
    } else {
      const block = this.currentBlock();
      if (!block) return;
      code = block.code;
      region = block;
    }
    const result = this.opts.onRun?.(code, { all }) || { ok: true };
    this.flash(region, result.ok !== false);
    return result;
  }

  flash(region, ok = true, subtle = false) {
    const { lh, padTop } = this.metrics();
    const f = this.flashEl;
    f.style.top = padTop + region.from * lh + "px";
    f.style.height = (region.to - region.from + 1) * lh + "px";
    f.style.transform = `translateY(${-this.ta.scrollTop}px)`;
    f.dataset.state = ok ? "ok" : "error";
    f.classList.toggle("subtle", subtle);
    f.classList.remove("on");
    void f.offsetWidth;
    f.classList.add("on");
  }

  updateBlockMark() {
    const block = document.activeElement === this.ta ? this.currentBlock() : null;
    if (!block) { this.blockMark.style.opacity = "0"; return; }
    const { lh, padTop } = this.metrics();
    this.blockMark.style.opacity = "1";
    this.blockMark.style.top = padTop + block.from * lh - this.ta.scrollTop + "px";
    this.blockMark.style.height = (block.to - block.from + 1) * lh + "px";
  }
}
