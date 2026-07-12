/*
 * agent.js — station III: a coding agent as live-coding instrument.
 *
 * A miniature Claude Code, in the browser: the "repository" is the
 * shared VFS (the same files stations I and II edit), the tools are
 * list/read/write/run/hush/status, and the loop streams from the
 * Anthropic API through a small Cloudflare Worker proxy (worker/).
 *
 * Without a worker URL, a recorded session can be replayed — the tool
 * calls execute for real, so the music is real; only the model is
 * canned. Useful offline, and honest about it in the UI.
 */

import * as vfs from "./vfs.js";
import * as engine from "./engine.js";
import { REFERENCE_MD } from "./docs.js";
import { Editor, langForPath } from "./editor.js";

const CFG_KEY = "spektrum.agent.v1";
const HIST_KEY = "spektrum.agent.history.v1";
const MAX_TURNS = 16;

// one-tap performance moves — sent immediately, like preset gestures
const QUICK_PROMPTS = [
  "give me a groove",
  "add an acid bassline",
  "more energy",
  "strip it back to just drums",
  "make the visuals react harder",
  "surprise me",
];

// ------------------------------------------------------------- tools

export function makeTools(runtime) {
  const clamp = (s, n = 4000) =>
    s.length > n ? s.slice(0, n) + `\n… (${s.length - n} more chars)` : s;

  const defs = [
    {
      name: "list_files",
      description: "List all files in the project.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "read_file",
      description: "Read a file from the project.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    {
      name: "write_file",
      description:
        "Create or overwrite a file with new content. Writing does not run it — call run_file afterwards to hear/see the result.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
    {
      name: "run_file",
      description:
        "Execute a project file: .js evaluates as pattern code, .glsl compiles as the fragment shader, graph.json loads into the node patcher. Returns ok or the error, plus what is now playing. Errors never stop the music.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    {
      name: "get_status",
      description:
        "Current engine status: bpm, cycle, active pattern slots, last error, available sound names.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "set_bpm",
      description: "Set the tempo in beats per minute (4 beats per cycle).",
      input_schema: {
        type: "object",
        properties: { bpm: { type: "number" } },
        required: ["bpm"],
      },
    },
    {
      name: "hush",
      description: "Silence all pattern slots immediately.",
      input_schema: { type: "object", properties: {} },
    },
  ];

  function execute(name, input) {
    switch (name) {
      case "list_files":
        return vfs.list().join("\n") || "(empty project)";
      case "read_file": {
        const c = vfs.read(input.path);
        return c === null ? `error: no such file: ${input.path}` : clamp(c, 12000);
      }
      case "write_file": {
        if (!input.path || typeof input.content !== "string")
          return "error: need path and content";
        vfs.write(input.path, input.content);
        return `wrote ${input.path} (${input.content.split("\n").length} lines)`;
      }
      case "run_file": {
        const c = vfs.read(input.path);
        if (c === null) return `error: no such file: ${input.path}`;
        const res = runtime.applyFile(input.path, c);
        const st = runtime.status();
        return res.ok
          ? `ok. playing: [${st.activeSlots.join(", ") || "nothing"}] at ${st.bpm} bpm`
          : `error: ${res.error}\n(the previous state is still playing — fix and run again)`;
      }
      case "get_status":
        return JSON.stringify(runtime.status(), null, 2);
      case "set_bpm":
        engine.setBpm(input.bpm);
        return `bpm = ${Math.round(engine.getBpm())}`;
      case "hush":
        engine.hush();
        return "silence.";
      default:
        return `error: unknown tool ${name}`;
    }
  }

  return { defs, execute };
}

const SYSTEM = `You are a live-coding performer embedded in "spektrum", a
browser music+visuals environment. You work like a coding agent: you have a
small project filesystem and tools to list, read, write and run files. The
audience is listening RIGHT NOW — the music must keep playing while you work.

Rules of the stage:
- Make small, musical changes; run after every write. Never leave a file
  unrun. If run_file reports an error, read it, fix it, run again.
- Prefer editing scene/pattern.js (sound) and scene/visual.glsl (visuals).
  scene/graph.json is the visual patcher — valid JSON only.
- Keep replies to one or two short sentences — you are performing, not
  documenting. Say what changed musically, not what the code says.
- Build gradually: change one element per turn (a rhythm, a voice, a
  filter move, a visual accent) unless asked for more.
- Never call hush unless asked for silence.

The full language reference is in docs/REFERENCE.md (read it once, early).

Quick reminders: d1..d9 take patterns; mini-notation strings like
"bd*2 [~ sn] hh(5,8)"; chain controls .gain() .cutoff() .room(); signals
sine.range(a,b).slow(n); visuals via scene/visual.glsl with u_bass/u_beat
uniforms. Drums: bd sn hh oh cp rim lt mt ht cr. Synths: sine tri saw
square sub bass fm pluck noise.`;

// ------------------------------------------------- streaming API client

async function streamMessage({ url, model, messages, tools, signal, onText }) {
  const res = await fetch(url.replace(/\/$/, "") + "/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM + "\n\n" + REFERENCE_MD,
      messages,
      tools,
      stream: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  }

  const content = [];
  let stopReason = null;
  let current = null;
  let jsonBuf = "";

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      switch (ev.type) {
        case "content_block_start":
          current = ev.content_block.type === "tool_use"
            ? { type: "tool_use", id: ev.content_block.id, name: ev.content_block.name, input: {} }
            : { type: "text", text: ev.content_block.text || "" };
          jsonBuf = "";
          break;
        case "content_block_delta":
          if (!current) break;
          if (ev.delta.type === "text_delta") {
            current.text += ev.delta.text;
            onText?.(current.text);
          } else if (ev.delta.type === "input_json_delta") {
            jsonBuf += ev.delta.partial_json;
          }
          break;
        case "content_block_stop":
          if (current?.type === "tool_use") {
            try { current.input = jsonBuf ? JSON.parse(jsonBuf) : {}; }
            catch { current.input = {}; }
          }
          if (current) content.push(current);
          current = null;
          break;
        case "message_delta":
          stopReason = ev.delta?.stop_reason ?? stopReason;
          break;
        case "error":
          throw new Error(ev.error?.message || "stream error");
      }
    }
  }
  return { content, stopReason };
}

// ---------------------------------------------------------------- UI

export function mountAgent(root, runtime, { toast = () => {} } = {}) {
  const tools = makeTools(runtime);
  let cfg = loadCfg();
  let history = [];   // Anthropic messages
  let busy = false;
  let abort = null;

  // prompt history (↑/↓ in the input, like a shell)
  let promptHistory = [];
  try { promptHistory = JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch { /* fresh */ }
  let histCursor = -1;
  let histDraft = "";
  function pushPrompt(text) {
    if (promptHistory[promptHistory.length - 1] !== text) promptHistory.push(text);
    while (promptHistory.length > 50) promptHistory.shift();
    localStorage.setItem(HIST_KEY, JSON.stringify(promptHistory));
    histCursor = -1;
  }

  root.innerHTML = "";
  const el = document.createElement("div");
  el.className = "agent";
  el.innerHTML = `
    <div class="agent-files">
      <div class="agent-files-head">files</div>
      <ul class="agent-file-list"></ul>
      <button class="btn agent-newfile">+ file</button>
    </div>
    <div class="agent-editor">
      <div class="agent-editor-head">
        <span class="agent-editor-path"></span>
        <button class="btn agent-run">run (ctrl+enter)</button>
      </div>
      <div class="agent-editor-host"></div>
    </div>
    <div class="agent-chat">
      <div class="agent-chat-head">
        <span>agent</span>
        <button class="btn agent-settings-toggle">setup</button>
      </div>
      <div class="agent-settings hidden">
        <label>worker url
          <input type="text" class="cfg-url" placeholder="https://spektrum-proxy.YOUR.workers.dev" />
        </label>
        <label>model
          <input type="text" class="cfg-model" />
        </label>
        <p class="agent-settings-note">Deploy <code>worker/</code> to Cloudflare
        with your <code>ANTHROPIC_API_KEY</code> secret — see
        <code>worker/README.md</code>. No URL? The <em>demo session</em>
        below replays a recorded performance with real tool calls.</p>
        <button class="btn cfg-save">save</button>
      </div>
      <div class="agent-log"></div>
      <div class="agent-quick"></div>
      <form class="agent-input">
        <textarea rows="2" placeholder="ask for music… (enter to send · ↑ history)"></textarea>
        <div class="agent-input-row">
          <button type="submit" class="btn primary agent-send">send</button>
          <button type="button" class="btn agent-stop hidden">stop</button>
          <button type="button" class="btn agent-clear">clear</button>
        </div>
      </form>
    </div>`;
  root.appendChild(el);

  const $ = (sel) => el.querySelector(sel);
  const log = $(".agent-log");
  const fileList = $(".agent-file-list");
  const pathLabel = $(".agent-editor-path");
  const input = $(".agent-input textarea");

  // ---- editor over VFS ----
  let currentFile = "scene/pattern.js";
  let squelch = false;
  const editor = new Editor($(".agent-editor-host"), {
    onRun() {
      const res = runtime.applyFile(currentFile, editor.value);
      note(res.ok ? `ran ${currentFile}` : res.error, res.ok ? "info" : "error");
      return res;
    },
    onSave(text) {
      squelch = true;
      vfs.write(currentFile, text);
      squelch = false;
      renderFiles();
    },
  });
  $(".agent-run").onclick = () => {
    squelch = true; vfs.write(currentFile, editor.value); squelch = false;
    editor.run(true);
  };

  function openFile(path) {
    currentFile = path;
    pathLabel.textContent = path;
    editor.setLang(langForPath(path));
    editor.value = vfs.read(path) ?? "";
    renderFiles();
  }

  function renderFiles() {
    fileList.innerHTML = "";
    for (const f of vfs.list()) {
      const li = document.createElement("li");
      li.textContent = f;
      li.className = f === currentFile ? "active" : "";
      li.onclick = () => openFile(f);
      fileList.appendChild(li);
    }
  }

  $(".agent-newfile").onclick = () => {
    const name = prompt("new file path:", "scene/sketch.js");
    if (!name) return;
    if (!vfs.exists(name)) vfs.write(name, "");
    openFile(name);
  };

  vfs.onChange((path) => {
    renderFiles();
    if (squelch) return;
    if (path === null || path === currentFile) {
      const text = vfs.read(currentFile);
      if (text !== null && text !== editor.value) editor.value = text;
      else if (text === null) openFile(vfs.list()[0] || "scene/pattern.js");
    }
  });

  // ---- settings ----
  $(".cfg-url").value = cfg.url || "";
  $(".cfg-model").value = cfg.model;
  $(".agent-settings-toggle").onclick = () => $(".agent-settings").classList.toggle("hidden");
  $(".cfg-save").onclick = () => {
    cfg = { url: $(".cfg-url").value.trim(), model: $(".cfg-model").value.trim() || DEFAULT_MODEL };
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    $(".agent-settings").classList.add("hidden");
    note(cfg.url ? `worker: ${cfg.url}` : "no worker url — demo replay available", "info");
  };

  // ---- chat rendering ----
  function bubble(role, text = "") {
    const div = document.createElement("div");
    div.className = "msg " + role;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function toolChip(name, input) {
    const div = document.createElement("div");
    div.className = "msg tool";
    const arg =
      name === "write_file" ? `${input.path} (${String(input.content ?? "").split("\n").length} lines)` :
      name === "read_file" || name === "run_file" ? input.path :
      name === "set_bpm" ? String(input.bpm) : "";
    div.textContent = `⚙ ${name} ${arg}`;
    if (input?.path) {
      div.classList.add("clickable");
      div.title = "open " + input.path;
      div.onclick = () => openFile(input.path);
    }
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function note(text, kind = "info") {
    const div = bubble("note", text);
    div.classList.add(kind);
    return div;
  }

  // ---- the agent loop ----
  async function send(userText) {
    if (busy) return;
    if (!cfg.url) {
      note("no worker url configured — open setup, or load the demo session from the scenes menu", "error");
      return;
    }
    engine.audioCtx(); // user gesture: unlock audio before the agent plays
    vfs.snapshot(`before agent: ${userText.slice(0, 40)}`); // safety net
    pushPrompt(userText);
    busy = true;
    setBusy(true);
    bubble("user", userText);
    history.push({ role: "user", content: userText });
    abort = new AbortController();

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const div = bubble("assistant", "…");
        const { content, stopReason } = await streamMessage({
          url: cfg.url,
          model: cfg.model,
          messages: history,
          tools: tools.defs,
          signal: abort.signal,
          onText: (t) => {
            div.textContent = t;
            log.scrollTop = log.scrollHeight;
          },
        });
        if (!content.some((b) => b.type === "text" && b.text.trim())) div.remove();
        history.push({ role: "assistant", content });

        if (stopReason !== "tool_use") break;
        const results = [];
        for (const block of content) {
          if (block.type !== "tool_use") continue;
          toolChip(block.name, block.input);
          let out;
          try { out = String(tools.execute(block.name, block.input)); }
          catch (err) { out = "error: " + err.message; }
          if (block.name === "run_file" || block.name === "write_file") {
            renderFiles();
            if (block.input?.path === currentFile) {
              const text = vfs.read(currentFile);
              if (text !== null) editor.value = text;
            }
          }
          if (/^error/m.test(out)) note(out.split("\n")[0], "error");
          results.push({ type: "tool_result", tool_use_id: block.id, content: out });
        }
        history.push({ role: "user", content: results });
      }
    } catch (err) {
      if (err.name !== "AbortError") note(String(err.message || err), "error");
    } finally {
      busy = false;
      setBusy(false);
      abort = null;
    }
  }

  function setBusy(b) {
    $(".agent-send").classList.toggle("hidden", b);
    $(".agent-stop").classList.toggle("hidden", !b);
    input.disabled = b;
  }

  $(".agent-input").onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    send(text);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $(".agent-input").requestSubmit();
      return;
    }
    // shell-style history: ↑ on the first line, ↓ on the last
    const beforeCursor = input.value.slice(0, input.selectionStart);
    if (e.key === "ArrowUp" && !beforeCursor.includes("\n") && promptHistory.length) {
      e.preventDefault();
      if (histCursor === -1) { histDraft = input.value; histCursor = promptHistory.length; }
      histCursor = Math.max(0, histCursor - 1);
      input.value = promptHistory[histCursor];
    } else if (e.key === "ArrowDown" && histCursor !== -1) {
      const afterCursor = input.value.slice(input.selectionEnd);
      if (afterCursor.includes("\n")) return;
      e.preventDefault();
      histCursor++;
      if (histCursor >= promptHistory.length) {
        histCursor = -1;
        input.value = histDraft;
      } else {
        input.value = promptHistory[histCursor];
      }
    }
  });

  // quick prompts — one-tap performance moves
  const quick = $(".agent-quick");
  function renderQuick() {
    quick.innerHTML = "";
    const prompts = [...QUICK_PROMPTS];
    if (runtime.lastError) prompts.unshift("fix the last error");
    for (const p of prompts.slice(0, 6)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = p;
      b.onclick = () => {
        if (busy) return;
        send(p);
      };
      quick.appendChild(b);
    }
  }
  runtime.onError(() => renderQuick());
  renderQuick();
  $(".agent-stop").onclick = () => abort?.abort();
  $(".agent-clear").onclick = () => {
    history = [];
    log.innerHTML = "";
    note("history cleared — the music keeps playing", "info");
  };

  // ---- replay (offline demo) ----
  async function replay(script) {
    if (busy) return;
    busy = true;
    setBusy(true);
    engine.audioCtx();
    vfs.snapshot("before replay session");
    note("replaying a recorded session — tool calls are real, the model is canned", "info");
    try {
      for (const step of script) {
        if (step.user) {
          bubble("user", step.user);
          await wait(600);
        }
        if (step.say) {
          const div = bubble("assistant", "");
          for (let i = 0; i < step.say.length; i += 3) {
            div.textContent = step.say.slice(0, i + 3);
            log.scrollTop = log.scrollHeight;
            await wait(18);
          }
        }
        if (step.tool) {
          toolChip(step.tool, step.input || {});
          await wait(350);
          const out = tools.execute(step.tool, step.input || {});
          renderFiles();
          if (step.input?.path === currentFile) editor.value = vfs.read(currentFile) ?? "";
          if (/^error/m.test(String(out))) note(String(out).split("\n")[0], "error");
        }
        await wait(step.pause ?? 500);
      }
      note("replay finished — take over in any station", "info");
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  renderFiles();
  openFile(currentFile);
  if (!cfg.url) {
    note("agent needs a worker url (setup) — or load “agent: demo session” from the scenes menu", "info");
  }

  return { replay, openFile };
}

const DEFAULT_MODEL = "claude-sonnet-5";

function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY)) || {};
    return { url: c.url || "", model: c.model || DEFAULT_MODEL };
  } catch {
    return { url: "", model: DEFAULT_MODEL };
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
