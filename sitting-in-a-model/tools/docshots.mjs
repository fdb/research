// Screenshot the about page (light + dark) and the root index.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "shots");
const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".wasm": "application/wasm", ".txt": "text/plain",
  ".png": "image/png",
};
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(ROOT, p);
    await stat(f);
    res.writeHead(200, { "content-type": MIME[path.extname(f)] ?? "application/octet-stream" });
    res.end(await readFile(f));
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(8124, r));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 2600 },
    colorScheme: scheme,
  });
  await page.goto("http://localhost:8124/sitting-in-a-model/about.html", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SHOTS, `about-${scheme}.png`), fullPage: false });
  await page.close();
}
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.goto("http://localhost:8124/", { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(SHOTS, "root-index.png") });
await browser.close();
server.close();
console.log("done");
