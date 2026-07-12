// Requires: npm i playwright-core (or NODE_PATH to a node_modules that has it)
// and a Chromium at /opt/pw-browsers/chromium or $CHROMIUM_PATH.
// Validates demo-scene content: replay session tool calls + acid node graph.
import { chromium } from "playwright-core";
import { createServer } from "http";
import { readFile } from "fs/promises";
import { extname, join } from "path";

import { fileURLToPath } from "url";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".md": "text/plain", ".json": "application/json" };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  try {
    const data = await readFile(join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(8766, r));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e)));

await page.goto("http://localhost:8766/spektrum/lab.html", { waitUntil: "networkidle" });
await page.click("#play");
await page.waitForTimeout(300);

// 1. execute every replay tool call directly (no typewriter) and check results
const replayReport = await page.evaluate(async () => {
  const { SCENES } = await import("./js/scenes.js");
  const { makeTools } = await import("./js/agent.js");
  const { makeRuntime } = await import("./js/runtime.js");
  const { ShaderScreen } = await import("./js/shader.js");
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 64;
  const screen = new ShaderScreen(canvas);
  const rt = makeRuntime({ getShader: () => screen });
  const tools = makeTools(rt);
  const script = SCENES.find((s) => s.id === "agent-demo").replay;
  const results = [];
  for (const step of script) {
    if (!step.tool) continue;
    const out = String(tools.execute(step.tool, step.input || {}));
    results.push({ tool: step.tool, path: step.input?.path, err: /^error/m.test(out) ? out.split("\n")[0] : null });
  }
  return results;
});
const errs = replayReport.filter((r) => r.err);
console.log("replay tool calls:", replayReport.length, "errors:", JSON.stringify(errs));
if (errs.length !== 1 || !/cutof/.test(errs[0].err)) {
  console.log("FAIL: expected exactly the intentional .cutof error");
  process.exit(1);
}

// 2. acid-wobble node scene
await page.selectOption("#scenes", "acid-wobble");
await page.waitForTimeout(800);
const nodeState = await page.evaluate(() => ({
  nodes: document.querySelectorAll("#station-nodes .node").length,
  wires: document.querySelectorAll("#station-nodes .nodes-wires path").length,
  power: document.querySelector('#station-nodes [data-act="power"]').textContent,
}));
console.log("acid-wobble:", JSON.stringify(nodeState));
if (nodeState.nodes !== 10 || nodeState.wires < 9 || nodeState.power !== "stop") {
  console.log("FAIL: acid graph not fully loaded/running");
  process.exit(1);
}
// let it run a moment; make sure no page errors and levels move
await page.waitForTimeout(1500);
const level = await page.evaluate(async () => {
  const engine = await import("./js/engine.js");
  return engine.levels().rms;
});
console.log("rms while node graph plays:", level);
if (!(level > 0)) { console.log("FAIL: node graph is silent"); process.exit(1); }

// 3. night-drive scene (the densest pattern code + grid shader)
await page.selectOption("#scenes", "night-drive");
await page.waitForTimeout(600);
const nd = await page.evaluate(async () => {
  const engine = await import("./js/engine.js");
  const vfs = await import("./js/vfs.js");
  return { slots: [...engine.slots.keys()], err: document.querySelector("#global-error").textContent };
});
console.log("night-drive:", JSON.stringify(nd));
if (nd.slots.length < 5 || nd.err) { console.log("FAIL: night drive"); process.exit(1); }

await browser.close();
server.close();
console.log("\nscene content checks passed");
