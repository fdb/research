// Requires: npm i playwright-core (or NODE_PATH to a node_modules that has it)
// and a Chromium at /opt/pw-browsers/chromium or $CHROMIUM_PATH.
// Browser smoke test for spektrum: load pages, poke stations, collect errors.
import { chromium } from "playwright-core";
import { createServer } from "http";
import { readFile } from "fs/promises";
import { extname, join } from "path";

import { fileURLToPath } from "url";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".md": "text/plain", ".json": "application/json", ".mjs": "text/javascript" };

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  try {
    const data = await readFile(join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("nope");
  }
});
await new Promise((r) => server.listen(8765, r));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});
const errors = [];
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push(["pageerror", page.url(), String(e)]));
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(["console." + m.type(), page.url(), m.text()]);
});
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(["http" + r.status(), page.url(), r.url()]);
});

const step = async (name, fn) => {
  try { await fn(); console.log("ok", name); }
  catch (e) { errors.push(["step", name, String(e)]); console.log("FAIL", name, String(e).slice(0, 200)); }
};

// ---- essay page ----
await step("essay loads", async () => {
  await page.goto("http://localhost:8765/spektrum/", { waitUntil: "networkidle" });
  await page.waitForSelector(".spectrum-desc strong");
});
await step("pattern widget renders", async () => {
  const rects = await page.locator("#pattern-widget svg rect").count();
  if (rects < 4) throw new Error("expected haps, got " + rects);
});
await step("pattern widget updates + errors", async () => {
  await page.fill("#pattern-widget input", "bd(3,8) sn");
  const rects = await page.locator("#pattern-widget svg rect").count();
  if (rects < 4) throw new Error("no rects after edit: " + rects);
  await page.fill("#pattern-widget input", "bd [unclosed");
  const err = await page.textContent("#pattern-widget .perr");
  if (!err.trim()) throw new Error("no parse error shown");
  await page.fill("#pattern-widget input", "bd sn");
});
await step("spectrum stops switch", async () => {
  await page.click('.spectrum-stop[data-i="2"]');
  const t = await page.textContent("#spectrum-desc");
  if (!/coding agents/i.test(t)) throw new Error("desc did not switch");
});

// ---- talk page ----
await step("talk renders md", async () => {
  await page.goto("http://localhost:8765/spektrum/talk.html", { waitUntil: "networkidle" });
  await page.waitForSelector("#talk h1");
  const html = await page.innerHTML("#talk");
  if (!/Laying Tracks/.test(html)) throw new Error("title missing");
  if (!/<table>/.test(html)) throw new Error("table missing");
  if (!/<ol>/.test(html)) throw new Error("ordered list missing");
});

// ---- lab ----
await step("lab loads", async () => {
  await page.goto("http://localhost:8765/spektrum/lab.html", { waitUntil: "networkidle" });
  await page.waitForSelector("#station-primitives .ed textarea");
});
await step("editor has seeded content", async () => {
  const v = await page.inputValue("#station-primitives .ed textarea");
  if (!/first beat/.test(v)) throw new Error("seed missing: " + v.slice(0, 60));
});
await step("play starts audio + patterns", async () => {
  await page.click("#play");
  await page.waitForTimeout(700);
  const st = await page.evaluate(async () => {
    const engine = await import("./js/engine.js");
    return { running: engine.isRunning(), slots: [...engine.slots.keys()] };
  });
  if (!st.running) throw new Error("audio not running: " + JSON.stringify(st));
  if (!st.slots.length) throw new Error("no active slots");
});
await step("block eval works", async () => {
  const ta = page.locator("#station-primitives .ed textarea");
  await ta.click();
  await ta.press("Control+a");
  await ta.pressSequentially("d1( s(\"bd*4\").gain(.9) )", { delay: 0 });
  await ta.press("Control+Enter");
  await page.waitForTimeout(200);
  const status = await page.textContent("#station-primitives .statusline");
  if (!/ok/.test(status)) throw new Error("statusline: " + status);
});
await step("eval error is non-fatal", async () => {
  const ta = page.locator("#station-primitives .ed textarea");
  await ta.press("Control+a");
  await ta.pressSequentially("d1( s(\"bd*4\").nope(3) )", { delay: 0 });
  await ta.press("Control+Enter");
  await page.waitForTimeout(200);
  const status = await page.textContent("#station-primitives .statusline");
  if (!/not a function|error/i.test(status)) throw new Error("no error shown: " + status);
  const slots = await page.evaluate(async () => {
    const engine = await import("./js/engine.js");
    return [...engine.slots.keys()];
  });
  if (!slots.includes("d1")) throw new Error("previous pattern lost");
});
await step("glsl tab + shader error non-fatal", async () => {
  await page.click('#station-primitives .tab:has-text("visual.glsl")');
  const ta = page.locator("#station-primitives .ed textarea");
  const v = await ta.inputValue();
  if (!/gl_FragColor/.test(v)) throw new Error("glsl not loaded");
  await ta.click();
  await ta.press("Control+a");
  await ta.pressSequentially("void main() { broken", { delay: 0 });
  await ta.press("Control+Enter");
  await page.waitForTimeout(200);
  const status = await page.textContent("#station-primitives .statusline");
  if (!/error|shader/i.test(status)) throw new Error("no shader error: " + status);
  // restore
  await ta.press("Control+a");
  await ta.pressSequentially("void main() { gl_FragColor = vec4(vec3(u_bass), 1.0); }", { delay: 0 });
  await ta.press("Control+Enter");
});
await step("nodes station renders graph", async () => {
  await page.click('[data-station="nodes"]');
  await page.waitForTimeout(300);
  const nodes = await page.locator("#station-nodes .node").count();
  if (nodes < 5) throw new Error("expected seeded graph nodes, got " + nodes);
  const wires = await page.locator("#station-nodes .nodes-wires path").count();
  if (wires < 5) throw new Error("expected wires, got " + wires);
});
await step("nodes run + param drag lives", async () => {
  await page.click('#station-nodes [data-act="power"]');
  await page.waitForTimeout(600);
  const txt = await page.textContent('#station-nodes [data-act="power"]');
  if (!/stop/.test(txt)) throw new Error("power button state: " + txt);
});
await step("add node via palette", async () => {
  const canvas = page.locator("#station-nodes .nodes-canvas");
  await canvas.dblclick({ position: { x: 790, y: 110 } });
  await page.click('.palette button:has-text("lfo")');
  const nodes = await page.locator("#station-nodes .node").count();
  if (nodes < 10) throw new Error("node not added: " + nodes);
});
await step("agent station mounts", async () => {
  await page.click('[data-station="agent"]');
  await page.waitForSelector("#station-agent .agent-file-list li");
  const files = await page.locator("#station-agent .agent-file-list li").count();
  if (files < 3) throw new Error("files missing: " + files);
});
await step("agent tools work headlessly", async () => {
  const out = await page.evaluate(async () => {
    const { makeTools } = await import("./js/agent.js");
    // grab the shared runtime through a fresh one — same engine/vfs
    const { makeRuntime } = await import("./js/runtime.js");
    const rt = makeRuntime({ getShader: () => null });
    const tools = makeTools(rt);
    const r1 = tools.execute("list_files", {});
    const r2 = tools.execute("write_file", { path: "scene/pattern.js", content: "d2( s(\"hh*8\") )" });
    const r3 = tools.execute("run_file", { path: "scene/pattern.js" });
    const r4 = tools.execute("get_status", {});
    return [r1, r2, r3, r4].join("\n---\n");
  });
  if (!/scene\/pattern\.js/.test(out)) throw new Error("list failed");
  if (!/ok\. playing/.test(out)) throw new Error("run failed: " + out);
});
await step("scene menu loads acid scene", async () => {
  await page.selectOption("#scenes", "acid");
  await page.waitForTimeout(500);
  const v = await page.evaluate(async () => {
    const vfs = await import("./js/vfs.js");
    return vfs.read("scene/pattern.js");
  });
  if (!/acid/.test(v)) throw new Error("scene not loaded");
  const slots = await page.evaluate(async () => {
    const engine = await import("./js/engine.js");
    return [...engine.slots.keys()];
  });
  if (slots.length < 3) throw new Error("acid slots not playing: " + slots);
});
await step("esc hushes", async () => {
  await page.keyboard.press("Escape");
  const slots = await page.evaluate(async () => {
    const engine = await import("./js/engine.js");
    return [...engine.slots.keys()];
  });
  if (slots.length) throw new Error("slots survived hush: " + slots);
});
await step("help overlay", async () => {
  await page.click("#help-toggle");
  const t = await page.textContent("#help-body");
  if (!/mini-notation/.test(t)) throw new Error("reference missing");
});

await browser.close();
server.close();

const real = errors.filter(([k, , t]) =>
  !/favicon|Autoplay|AudioContext was not allowed|preloaded|Slow network|GPU stall|Failed to load resource|eval error:/i.test(t));
if (real.length) {
  console.log("\nERRORS:");
  for (const e of real) console.log(" ", e.join(" | ").slice(0, 400));
  process.exit(1);
}
console.log("\nsmoke test passed clean");
