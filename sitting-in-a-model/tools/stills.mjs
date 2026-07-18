// Documentation stills for about.html: run the piece fast for a while so the
// strata fill in, then take a full view and a detail crop.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "img");
const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm",
  ".txt": "text/plain",
};
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, p);
    await stat(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(8123, r));
await import("node:fs/promises").then((fs) => fs.mkdir(OUT, { recursive: true }));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.4 });
page.setDefaultTimeout(300_000);
await page.goto("http://localhost:8123/sitting-in-a-model/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#enter:enabled");
await page.click("#enter");
await page.waitForFunction(() => window.SIAM?.mode === "eroding");
await page.evaluate(() => { SIAM.cadence = 500; });
console.log("eroding fast…");
await page.waitForFunction(() => window.SIAM.pass >= 55, { timeout: 300_000 });
await page.evaluate(() => { SIAM.cadence = 4000; });
await page.waitForTimeout(1800); // let animations settle mid-glow
await page.screenshot({ path: path.join(OUT, "still-room.png") });

// catch the mask beat (░░░) for the detail shot
await page.evaluate(() => { SIAM.cadence = 700; });
for (let attempt = 0; attempt < 6; attempt++) {
  await page.waitForSelector("#sentence .w.masking", { state: "attached", timeout: 60_000 });
  await page.screenshot({
    path: path.join(OUT, "still-detail.png"),
    clip: { x: 360, y: 300, width: 900, height: 410 },
  });
  const stillMasking = await page.evaluate(
    () => !!document.querySelector("#sentence .w.masking")
  );
  if (stillMasking) break; // the shot landed inside the beat
  await page.waitForTimeout(400);
}
console.log("pass:", await page.evaluate(() => SIAM.pass));
console.log("sentence:", await page.evaluate(() => SIAM.sentence));
await browser.close();
server.close();
