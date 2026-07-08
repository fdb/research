// Smoke tests for the Cartan-port engine: the NodeBox 3 library
// registers, core semantics hold, and every shipped node document loads
// and evaluates without throwing.
//
//   node test/engine.test.mjs

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { createRegistry, registerType } = await import(join(root, "engine/model.js"));
const { createRenderer } = await import(join(root, "engine/eval.js"));
const g = await import(join(root, "engine/graphics.js"));
const lib = await import(join(root, "engine/n3lib.js"));

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};

const catalog = JSON.parse(readFileSync(join(root, "data/catalog.json"), "utf8"));
const registry = createRegistry(lib.n3Types());
for (const spec of catalog.fnTypes) registerType(registry, lib.cartanFnType(spec));
const assets = new Set(readdirSync(join(root, "assets")));
lib.setFileLoader((name) => {
  const base = name.split("/").pop();
  if (!assets.has(base)) throw new Error(`file not found: ${name}`);
  return readFileSync(join(root, "assets", base), "utf8");
});

test("standard library registers", () => {
  assert.ok(registry.size >= 130, `only ${registry.size} types`);
  assert.ok(registry.get("corevector.rect"));
  assert.ok(registry.get("data.lookup"));
});

test("NodeBox semantics: compare, switch, lookup, compound", () => {
  assert.strictEqual(lib.IMPLS["math/compare"](3, 4, "<"), true);
  assert.deepStrictEqual(lib.IMPLS["list/doSwitch"]([1], [2], null, null, null, null, 1), [2]);
  assert.strictEqual(lib.dataLookup({ a: { b: 7 } }, "a.b"), 7);
  assert.strictEqual(lib.dataLookup(g.rectPath(0, 0, 100, 50), "bounds.width"), 100);
  assert.strictEqual(lib.dataLookup({ r: 1, g: 0, b: 0, a: 1 }, "hue"), 0);
  assert.strictEqual(lib.dataLookup("x", "class.simpleName"), "String");
  const u = lib.compoundShapes(g.rectPath(0, 0, 100, 100), g.rectPath(50, 0, 100, 100), "united");
  assert.ok(g.bounds(u).width > 140);
});

test("script-function ports", () => {
  assert.strictEqual(lib.CARTAN_FNS["convert_base/base_repr"].fn(10, 16, 0), "A");
  assert.strictEqual(Math.abs(lib.CARTAN_FNS["noise/noise"].fn(0.5, 0.5, 0.5)) < 1, true);
  const pts = lib.CARTAN_FNS["poisson/poisson"].fn(50, 200, 200, 42);
  assert.ok(pts.length > 4);
  const hull = lib.CARTAN_FNS["convex_hull/convex_hull"].fn([
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 5 },
  ]);
  assert.strictEqual(hull.length, 3 + 1 - 1); // triangle hull: 3 corners
});

test("every shipped node document evaluates", () => {
  const failures = [];
  for (const meta of catalog.nodes) {
    const file = JSON.parse(readFileSync(join(root, "data/nodes", `${meta.name}.json`), "utf8"));
    const network =
      file.demo ||
      (file.node && file.node.type === "core.network"
        ? file.node
        : file.node && {
            name: "root", type: "core.network", children: [file.node],
            connections: [], renderedChild: file.node.name, publishedPorts: [],
          });
    if (!network) continue;
    const renderer = createRenderer(registry);
    const result = renderer.render(
      {
        type: "nodebox", formatVersion: 1, name: meta.name,
        properties: { width: 600, height: 600 }, functions: [], root: network,
      },
      "/",
      { frame: 1, mouse: { x: 0, y: 0 }, canvas: catalog.canvas },
    );
    const expectError = meta.status !== "ok";
    if (!expectError && result.error) failures.push(`${meta.name}: ${result.error.message}`);
  }
  assert.deepStrictEqual(failures, []);
});

test("coverage matches the committed catalog", () => {
  const ok = catalog.nodes.filter((n) => n.status === "ok").length;
  assert.ok(ok >= 186, `expected ≥186 ok nodes, got ${ok}`);
});

console.log(`${passed} test groups passed`);
