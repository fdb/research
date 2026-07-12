/*
 * editor.js — a deliberately small code editor built on a textarea.
 *
 * Live-coding ergonomics over features:
 *   Ctrl/Cmd+Enter        evaluate the current block (paragraph)
 *   Ctrl/Cmd+Shift+Enter  evaluate the whole buffer
 *   Esc or Ctrl+.         hush (handled globally, see ui.js)
 *   Tab                   insert two spaces
 * The evaluated block flashes so you always see what just ran.
 */

export class Editor {
  /**
   * opts: {
   *   onRun(code, {all}) => {ok, error?}   evaluate handler
   *   onSave?(text)                        called (debounced) on every edit
   * }
   */
  constructor(parent, opts = {}) {
    this.opts = opts;
    this.el = document.createElement("div");
    this.el.className = "ed";
    this.flashEl = document.createElement("div");
    this.flashEl.className = "ed-flash";
    this.ta = document.createElement("textarea");
    this.ta.spellcheck = false;
    this.ta.autocapitalize = "off";
    this.ta.autocomplete = "off";
    this.ta.setAttribute("autocorrect", "off");
    this.ta.wrap = "off";
    this.el.appendChild(this.flashEl);
    this.el.appendChild(this.ta);
    parent.appendChild(this.el);

    this._saveTimer = null;
    this.ta.addEventListener("input", () => {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.opts.onSave?.(this.ta.value), 300);
    });

    this.ta.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "Enter") {
        e.preventDefault();
        this.run(e.shiftKey);
      } else if (e.key === "Tab") {
        e.preventDefault();
        this.insert("  ");
      }
    });
  }

  get value() {
    return this.ta.value;
  }

  set value(text) {
    this.ta.value = text;
  }

  focus() {
    this.ta.focus();
  }

  insert(text) {
    const { selectionStart: a, selectionEnd: b, value } = this.ta;
    this.ta.value = value.slice(0, a) + text + value.slice(b);
    this.ta.selectionStart = this.ta.selectionEnd = a + text.length;
    this.ta.dispatchEvent(new Event("input"));
  }

  // The block = contiguous non-blank lines around the cursor.
  currentBlock() {
    const text = this.ta.value;
    const lines = text.split("\n");
    // find cursor line
    let pos = 0, cursorLine = 0;
    const cursor = this.ta.selectionStart;
    for (let i = 0; i < lines.length; i++) {
      if (cursor <= pos + lines[i].length) { cursorLine = i; break; }
      pos += lines[i].length + 1;
      cursorLine = i + 1;
    }
    if (cursorLine >= lines.length) cursorLine = lines.length - 1;
    const blank = (i) => lines[i] === undefined || lines[i].trim() === "";
    if (blank(cursorLine)) return null;
    let from = cursorLine, to = cursorLine;
    while (from > 0 && !blank(from - 1)) from--;
    while (to < lines.length - 1 && !blank(to + 1)) to++;
    return {
      code: lines.slice(from, to + 1).join("\n"),
      from,
      to,
      total: lines.length,
    };
  }

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

  // Flash the evaluated line range: green-ish for ok, red-ish for error.
  flash(region, ok = true) {
    const cs = getComputedStyle(this.ta);
    const lh = parseFloat(cs.lineHeight) || 20;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const f = this.flashEl;
    f.style.top = padTop + region.from * lh - this.ta.scrollTop + "px";
    f.style.height = (region.to - region.from + 1) * lh + "px";
    f.dataset.state = ok ? "ok" : "error";
    f.classList.remove("on");
    // restart the CSS animation
    void f.offsetWidth;
    f.classList.add("on");
  }
}
