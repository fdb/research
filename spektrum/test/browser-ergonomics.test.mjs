// Requires: npm i playwright-core (or NODE_PATH to a node_modules that has it)
// and a Chromium at /opt/pw-browsers/chromium or $CHROMIUM_PATH.
// Ergonomics smoke test: highlighting, smart keys, palette, snapshots,
// tap tempo, step cells, node palette search, agent chips.
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
await new Promise((r) => server.listen(8767, r));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

let failed = 0;
const step = async (name, fn) => {
  try { await fn(); console.log("ok", name); }
  catch (e) { failed++; console.log("FAIL", name, String(e).slice(0, 300)); }
};

await page.goto("http://localhost:8767/spektrum/lab.html#primitives", { waitUntil: "networkidle" });
await page.click("#play");
await page.waitForTimeout(400);

const ta = page.locator("#station-primitives .ed textarea");

await step("syntax highlight layer renders tokens", async () => {
  const counts = await page.evaluate(() => {
    const hl = document.querySelector("#station-primitives .ed-hl code");
    return {
      strings: hl.querySelectorAll(".s").length,
      numbers: hl.querySelectorAll(".d").length,
      comments: hl.querySelectorAll(".c").length,
      dsl: hl.querySelectorAll(".f").length,
    };
  });
  for (const [k, v] of Object.entries(counts)) {
    if (v < 1) throw new Error(`no ${k} tokens: ${JSON.stringify(counts)}`);
  }
});

await step("block marker appears at cursor", async () => {
  await ta.click({ position: { x: 60, y: 12 } }); // first line, non-blank
  await page.waitForTimeout(100);
  const op = await page.evaluate(() =>
    document.querySelector("#station-primitives .ed-block").style.opacity);
  if (op !== "1") throw new Error("block marker hidden: " + op);
});

await step("auto-pairs + typed close chars come out balanced", async () => {
  await ta.press("Control+a");
  await ta.pressSequentially('d1( s("bd sn").gain(.5) )', { delay: 0 });
  const v = await ta.inputValue();
  if (v !== 'd1( s("bd sn").gain(.5) )') throw new Error("mangled: " + v);
});

await step("number nudge (mod+up) edits and re-runs", async () => {
  const v = await ta.inputValue();
  const pos = v.indexOf(".5") + 1;
  await page.evaluate((p) => {
    const t = document.querySelector("#station-primitives .ed textarea");
    t.focus();
    t.setSelectionRange(p, p);
  }, pos);
  await ta.press("Control+ArrowUp");
  const v2 = await ta.inputValue();
  if (!v2.includes("gain(1.5)")) throw new Error("nudge failed: " + v2);
  await ta.press("Control+ArrowDown");
  await ta.press("Control+ArrowDown");
  const v3 = await ta.inputValue();
  if (!v3.includes("gain(-0.5)")) throw new Error("nudge down failed: " + v3);
  await ta.press("Control+ArrowUp");
});

await step("comment toggle mutes and unmutes", async () => {
  await ta.press("Control+/");
  let v = await ta.inputValue();
  if (!v.startsWith("// ")) throw new Error("not commented: " + v.slice(0, 30));
  await ta.press("Control+/");
  v = await ta.inputValue();
  if (v.startsWith("//")) throw new Error("not uncommented");
});

await step("duplicate line (mod+d)", async () => {
  await ta.press("ArrowRight"); // collapse the selection left by mod+/
  await ta.press("Control+d");
  const v = await ta.inputValue();
  if (v.split("\n").length !== 2) throw new Error("no dup: " + JSON.stringify(v));
  // native undo still works after programmatic edits (dup = 2 steps)
  await ta.press("Control+z");
  await ta.press("Control+z");
  const v2 = await ta.inputValue();
  if (v2.split("\n").length !== 1) throw new Error("undo broken: " + JSON.stringify(v2));
});

await step("move line (alt+down)", async () => {
  await ta.press("Control+a");
  await ta.pressSequentially("aaa", { delay: 0 });
  await ta.press("Enter");
  await ta.pressSequentially("bbb", { delay: 0 });
  await page.evaluate(() => {
    const t = document.querySelector("#station-primitives .ed textarea");
    t.setSelectionRange(0, 0);
  });
  await ta.press("Alt+ArrowDown");
  const v = await ta.inputValue();
  if (v !== "bbb\naaa") throw new Error("move failed: " + JSON.stringify(v));
});

await step("command palette: open, fuzzy, run scene", async () => {
  await page.keyboard.press("Control+k");
  await page.waitForSelector("#palette:not(.hidden)");
  await page.fill("#palette-input", "night");
  await page.waitForTimeout(100);
  const first = await page.textContent("#palette-list li.sel");
  if (!/night drive/.test(first)) throw new Error("fuzzy pick wrong: " + first);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  const slots = await page.evaluate(async () => {
    const engine = await import("./js/engine.js");
    return [...engine.slots.keys()];
  });
  if (slots.length < 5) throw new Error("scene not playing: " + slots);
});

await step("snapshots: auto (scene) + manual (mod+s) + restore", async () => {
  const before = await page.evaluate(async () => (await import("./js/vfs.js")).snapshots().length);
  if (before < 1) throw new Error("no auto-snapshot from scene load");
  // mutate, snapshot, mutate again, restore via palette
  await page.evaluate(async () => {
    const vfs = await import("./js/vfs.js");
    vfs.write("scene/pattern.js", "// version A");
  });
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(100);
  await page.evaluate(async () => {
    const vfs = await import("./js/vfs.js");
    vfs.write("scene/pattern.js", "// version B");
  });
  await page.keyboard.press("Control+k");
  await page.fill("#palette-input", "restore manual");
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const content = await page.evaluate(async () => (await import("./js/vfs.js")).read("scene/pattern.js"));
  if (content !== "// version A") throw new Error("restore failed: " + content);
});

await step("tap tempo", async () => {
  await page.click(".lab-bar", { position: { x: 5, y: 5 } });
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("t");
    await page.waitForTimeout(300);
  }
  const bpm = parseInt(await page.textContent("#bpm"), 10);
  if (Math.abs(bpm - 200) > 25) throw new Error("tap bpm off: " + bpm);
});

await step("toast is visible", async () => {
  const cls = await page.getAttribute("#toast", "class");
  if (!cls.includes("on")) throw new Error("no toast");
});

// ---- nodes station ----
await step("step cells render and paint", async () => {
  // restore a graph first (pattern.js was replaced above)
  await page.evaluate(async () => {
    const vfs = await import("./js/vfs.js");
    const { DEFAULT_FILES } = await import("./js/scenes.js");
    vfs.write("scene/graph.json", DEFAULT_FILES["scene/graph.json"]);
  });
  await page.click('[data-station="nodes"]');
  await page.waitForTimeout(300);
  const cells = await page.locator("#station-nodes .node .step-cell").count();
  if (cells < 32) throw new Error("cells missing: " + cells);
  const firstCell = page.locator("#station-nodes .node .step-cell").first();
  const wasOn = await firstCell.evaluate((el) => el.classList.contains("on"));
  await firstCell.dispatchEvent("pointerdown", { button: 0, buttons: 1 });
  await page.waitForTimeout(500); // save debounce
  const isOn = await firstCell.evaluate((el) => el.classList.contains("on"));
  if (isOn === wasOn) throw new Error("cell did not toggle");
  const graph = await page.evaluate(async () => (await import("./js/vfs.js")).read("scene/graph.json"));
  const steps = JSON.parse(graph).nodes.find((n) => n.type === "seq").params.steps;
  if (steps[0] !== (wasOn ? "." : "x")) throw new Error("steps not persisted: " + steps);
});

await step("node palette search + enter", async () => {
  const before = await page.locator("#station-nodes .node").count();
  await page.dblclick("#station-nodes .nodes-canvas", { position: { x: 790, y: 110 } });
  await page.waitForSelector(".palette-search");
  await page.keyboard.type("val");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const after = await page.locator("#station-nodes .node").count();
  if (after !== before + 1) throw new Error(`node not added: ${before} -> ${after}`);
});

await step("duplicate node (mod+d) + arrow nudge", async () => {
  const before = await page.locator("#station-nodes .node").count();
  // the just-added node is selected
  await page.keyboard.press("Control+d");
  await page.waitForTimeout(100);
  const after = await page.locator("#station-nodes .node").count();
  if (after !== before + 1) throw new Error("dup failed");
  const sel = page.locator("#station-nodes .node.selected");
  const x0 = await sel.evaluate((el) => parseInt(el.style.left));
  await page.keyboard.press("ArrowRight");
  const x1 = await sel.evaluate((el) => parseInt(el.style.left));
  if (x1 !== x0 + 2) throw new Error(`nudge failed: ${x0} -> ${x1}`);
});

await step("dblclick cable cuts it", async () => {
  const before = await page.evaluate(async () => {
    const g = JSON.parse((await import("./js/vfs.js")).read("scene/graph.json"));
    return g.edges.length;
  });
  const wire = page.locator("#station-nodes .nodes-wires path").first();
  await wire.dispatchEvent("dblclick");
  await page.waitForTimeout(500);
  const after = await page.evaluate(async () => {
    const g = JSON.parse((await import("./js/vfs.js")).read("scene/graph.json"));
    return g.edges.length;
  });
  if (after !== before - 1) throw new Error(`edge not cut: ${before} -> ${after}`);
});

// ---- agent station ----
await step("agent quick prompts + highlighted editor", async () => {
  await page.click('[data-station="agent"]');
  await page.waitForTimeout(200);
  const chips = await page.locator("#station-agent .chip").count();
  if (chips < 5) throw new Error("chips missing: " + chips);
  const hl = await page.locator("#station-agent .ed-hl").count();
  if (!hl) throw new Error("agent editor not highlighted");
});

await step("esc still hushes everywhere", async () => {
  await page.keyboard.press("Escape");
  const slots = await page.evaluate(async () => {
    const engine = await import("./js/engine.js");
    return [...engine.slots.keys()];
  });
  if (slots.length) throw new Error("hush failed");
});

await browser.close();
server.close();
if (errors.length) {
  console.log("\nPAGE ERRORS:");
  errors.forEach((e) => console.log(" ", e.slice(0, 300)));
}
if (failed || errors.length) process.exit(1);
console.log("\nergonomics smoke test passed clean");
