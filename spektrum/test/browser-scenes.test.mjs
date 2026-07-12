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

// 4. raymarch scene (SDF toolkit end-to-end)
await page.selectOption("#scenes", "raymarch");
await page.waitForTimeout(600);
const rm = await page.evaluate(async () => {
  const engine = await import("./js/engine.js");
  return { slots: [...engine.slots.keys()], err: document.querySelector("#global-error").textContent };
});
console.log("raymarch:", JSON.stringify(rm));
if (rm.slots.length < 4 || rm.err) { console.log("FAIL: raymarch scene"); process.exit(1); }

// 5. SDF injection rules on a fresh ShaderScreen
const sdfChecks = await page.evaluate(async () => {
  const { ShaderScreen } = await import("./js/shader.js");
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 64;
  const s = new ShaderScreen(canvas);
  const out = {};
  // (a) map + full pipeline compiles
  out.pipeline = s.set(`float map(vec3 p){ return opU(sdSphere(p - vec3(0.0,1.0,0.0), 0.5 + u_bass*0.3), sdPlane(p, 0.0)); }
void main(){
  vec2 uv=(gl_FragCoord.xy*2.0-u_res)/u_res.y;
  vec3 ro=vec3(3.0,1.5,3.0);
  vec3 rd=rayDir(uv, ro, vec3(0.0,0.8,0.0), 1.7);
  gl_FragColor=vec4(shade(ro, rd, vec3(0.6,0.9,-0.4)),1.0);
}`);
  // (b) plain shader without map still compiles (pipeline not injected)
  out.plain = s.set("void main(){ gl_FragColor = vec4(vec3(u_rms), 1.0); }");
  // (c) //!nolib lets you redefine toolkit names from scratch
  out.nolib = s.set(`//!nolib
float sdSphere(vec3 p, float r){ return length(p)-r; }
void main(){ gl_FragColor = vec4(vec3(1.0 - sdSphere(vec3(0.5), 1.0)), 1.0); }`);
  // (d) redefining without nolib errors non-fatally (previous keeps running)
  out.conflict = s.set(`float sdSphere(vec3 p, float r){ return length(p)-r; }
void main(){ gl_FragColor = vec4(1.0); }`);
  // (e) error line numbers point into the user's source
  out.lineErr = s.set("void main(){ oops }");
  return out;
});
console.log("sdf checks:", JSON.stringify(sdfChecks).slice(0, 300));
if (sdfChecks.pipeline || sdfChecks.plain || sdfChecks.nolib) {
  console.log("FAIL: SDF toolkit should compile cleanly"); process.exit(1);
}
if (!sdfChecks.conflict) { console.log("FAIL: redefinition should error"); process.exit(1); }
if (!/line 1\b/.test(sdfChecks.lineErr || "")) {
  console.log("FAIL: error line not remapped: " + sdfChecks.lineErr); process.exit(1);
}

await browser.close();
server.close();
console.log("\nscene content checks passed");
