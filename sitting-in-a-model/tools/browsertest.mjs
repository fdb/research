// End-to-end verification: serves the repo root with COOP/COEP (like the
// production _headers), then drives the piece through its states in
// Chromium — live model, fallback recording, kiosk, mobile.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "shots");
await mkdir(SHOTS, { recursive: true });

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
  ".onnx": "application/octet-stream",
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, p);
    const st = await stat(file);
    if (st.isDirectory()) {
      res.writeHead(301, { location: p + "/" });
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(8123, r));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function drive({ name, query, viewport, waitReady = true, erodeMs = 20000, shots = true }) {
  console.log(`\n--- scenario: ${name} ---`);
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(240_000);
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[console] ${m.text().slice(0, 240)}`);
  });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${String(e).slice(0, 240)}`));
  page.on("requestfailed", (r) => errors.push(`[reqfail] ${r.url().slice(-80)}`));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`[${r.status()}] ${r.url().slice(-80)}`);
  });

  await page.goto(`http://localhost:8123/sitting-in-a-model/${query}`, {
    waitUntil: "domcontentloaded",
  });

  if (waitReady) {
    await page.waitForSelector("#enter:enabled", { timeout: 180_000 });
    console.log("ready:", (await page.textContent("#veil-status"))?.trim());
    console.log("enter label:", (await page.textContent("#enter"))?.trim());
  }

  const kiosk = query.includes("kiosk=1");
  if (!kiosk) await page.click("#enter");
  else {
    // kiosk auto-enters; if autoplay is blocked it asks for a touch
    await page.waitForFunction(
      () =>
        document.querySelector("#veil-status")?.textContent?.includes("touch to begin") ||
        document.querySelector("#veil")?.classList.contains("gone")
    );
    await page.mouse.click(700, 450);
  }

  await page.waitForTimeout(1200);
  if (shots) await page.screenshot({ path: path.join(SHOTS, `${name}-reading.png`) });

  await page.waitForFunction(
    () => window.SIAM && (window.SIAM.mode === "eroding" || window.SIAM.pass > 0),
    { timeout: 240_000 }
  );
  await page.waitForTimeout(erodeMs);
  if (shots) await page.screenshot({ path: path.join(SHOTS, `${name}-eroding.png`) });

  // visitor speaks into the room (live mode only)
  if (name === "live") {
    await page.keyboard.type("t");
    await page.waitForSelector("#typebox.open");
    await page.keyboard.type("he sun is a door left open in the dark");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => SIAM.sentence.startsWith("the sun is a door"),
      { timeout: 30_000 }
    );
    console.log("typed sentence accepted:", await page.evaluate(() => SIAM.sentence));
    await page.waitForFunction(() => SIAM.mode === "eroding", { timeout: 120_000 });
    console.log("typed sentence eroding");
    await page.screenshot({ path: path.join(SHOTS, `${name}-typed.png`) });
  }

  const state = await page.evaluate(() => ({
    mode: SIAM.mode,
    pass: SIAM.pass,
    meanP: +SIAM.meanP.toFixed(3),
    sentence: SIAM.sentence.slice(0, 120),
    audioState: SIAM.audio.ctx?.state ?? "none",
    audioVoices: SIAM.audio.voices?.filter((v) => v.p > 0).length ?? 0,
    masterGain: +(SIAM.audio.master?.gain?.value ?? 0).toFixed(3),
    isolated: crossOriginIsolated,
    strata: document.querySelectorAll(".stratum").length,
  }));
  console.log(state);
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no errors");
  await page.close();
  return state;
}

await drive({ name: "live", query: "", viewport: { width: 1440, height: 900 } });
await drive({ name: "fallback", query: "?fallback=1", viewport: { width: 1440, height: 900 }, erodeMs: 14000 });
await drive({ name: "kiosk", query: "?kiosk=1", viewport: { width: 1920, height: 1080 }, waitReady: false, erodeMs: 14000 });
await drive({ name: "mobile", query: "", viewport: { width: 390, height: 844 }, erodeMs: 12000 });

await browser.close();
server.close();
console.log("\nall scenarios done");
