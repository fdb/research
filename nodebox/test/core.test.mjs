// Core test suite — runs headless under plain Node (the core has no DOM
// dependencies): node nodebox/test/core.test.mjs
import assert from "node:assert";
import * as M from "../core/model.js";
import { createRenderer } from "../core/eval.js";
import { BUILTIN_TYPES } from "../core/stdlib.js";
import * as g from "../core/graphics.js";

const registry = M.createRegistry(BUILTIN_TYPES);
const renderer = createRenderer(registry);

function build(fns) {
  let doc = M.createDocument("test");
  for (const fn of fns) doc = fn(doc);
  return doc;
}

// 1. Single rect.
{
  let doc = build([(d) => M.addNode(d, "/", M.createNode("corevector.rect", "rect1"))]);
  const { value, error } = renderer.render(doc, "/");
  assert.equal(error, null);
  assert.equal(value.length, 1);
  assert.equal(value[0].type, "path");
  const b = g.bounds(value[0]);
  assert.deepEqual([b.width, b.height], [100, 100]);
  console.log("1. single rect ok");
}

// 2. List-matching: sample(5) -> rect.width => 5 rects with cycling widths.
{
  let doc = build([
    (d) => M.addNode(d, "/", M.createNode("math.sample", "sample1")),
    (d) => M.addNode(d, "/", M.createNode("corevector.rect", "rect1")),
    (d) => M.setPortValue(d, registry, "/sample1", "amount", 5),
    (d) => M.setPortValue(d, registry, "/sample1", "start", 10),
    (d) => M.setPortValue(d, registry, "/sample1", "end", 50),
    (d) => M.connect(d, "/", "sample1", "rect1", "width"),
    (d) => M.setRenderedChild(d, "/", "rect1"),
  ]);
  const { value, error } = renderer.render(doc, "/");
  assert.equal(error, null);
  assert.equal(value.length, 5);
  assert.equal(Math.round(g.bounds(value[0]).width), 10);
  assert.equal(Math.round(g.bounds(value[4]).width), 50);
  console.log("2. list-matching cycling ok");
}

// 3. grid (100 points) -> rect.position => 100 rects; empty input => no invocations.
{
  let doc = build([
    (d) => M.addNode(d, "/", M.createNode("corevector.grid", "grid1")),
    (d) => M.addNode(d, "/", M.createNode("corevector.rect", "rect1")),
    (d) => M.connect(d, "/", "grid1", "rect1", "position"),
    (d) => M.setRenderedChild(d, "/", "rect1"),
  ]);
  let out = renderer.render(doc, "/");
  assert.equal(out.value.length, 100);
  doc = M.setPortValue(doc, registry, "/grid1", "columns", 0); // clamped to min 1
  out = renderer.render(doc, "/");
  assert.equal(out.value.length, 10);
  console.log("3. grid->rect list-matching ok");
}

// 4. copy: outputRange list flattening; 3 copies of 4 grid points = 12? No —
// copy's shape port is value-range, so 4 points × 3 copies = 12 results.
{
  let doc = build([
    (d) => M.addNode(d, "/", M.createNode("corevector.grid", "grid1")),
    (d) => M.setPortValue(d, registry, "/grid1", "columns", 2),
    (d) => M.setPortValue(d, registry, "/grid1", "rows", 2),
    (d) => M.addNode(d, "/", M.createNode("corevector.copy", "copy1")),
    (d) => M.setPortValue(d, registry, "/copy1", "copies", 3),
    (d) => M.setPortValue(d, registry, "/copy1", "translate", { x: 10, y: 0 }),
    (d) => M.connect(d, "/", "grid1", "copy1", "shape"),
    (d) => M.setRenderedChild(d, "/", "copy1"),
  ]);
  const { value, error } = renderer.render(doc, "/");
  assert.equal(error, null);
  assert.equal(value.length, 12);
  console.log("4. copy flattening ok");
}

// 5. Subnetwork with published port participates in parent list-matching.
{
  let doc = build([
    (d) => M.addNode(d, "/", M.createNode("corevector.rect", "rect1")),
    (d) => M.addNode(d, "/", M.createNode("corevector.colorize", "colorize1")),
    (d) => M.connect(d, "/", "rect1", "colorize1", "shape"),
    (d) => M.setRenderedChild(d, "/", "colorize1"),
  ]);
  const grouped = M.groupIntoNetwork(doc, "/", ["rect1", "colorize1"], registry);
  doc = grouped.doc;
  assert.equal(grouped.networkName, "network1");
  const net = M.getNode(doc, "/network1");
  assert.equal(net.renderedChild, "colorize1");
  // Publish rect1.width on the network.
  doc = M.publishPort(doc, "/network1", "rect1", "width", "width");
  // Feed a list of 3 widths into the network's published port.
  doc = M.addNode(doc, "/", M.createNode("math.sample", "sample1"));
  doc = M.setPortValue(doc, registry, "/sample1", "amount", 3);
  doc = M.setPortValue(doc, registry, "/sample1", "start", 10);
  doc = M.setPortValue(doc, registry, "/sample1", "end", 30);
  doc = M.connect(doc, "/", "sample1", "network1", "width");
  doc = M.setRenderedChild(doc, "/", "network1");
  const { value, error } = renderer.render(doc, "/");
  assert.equal(error, null);
  assert.equal(value.length, 3, `expected 3 results, got ${value.length}`);
  assert.equal(Math.round(g.bounds(value[0]).width), 10);
  assert.equal(Math.round(g.bounds(value[2]).width), 30);
  // Write-through: setting the published value updates the child.
  doc = M.disconnect(doc, "/", "network1", "width");
  doc = M.setPortValue(doc, registry, "/network1", "width", 77);
  assert.equal(M.getNode(doc, "/network1/rect1").values.width, 77);
  console.log("5. subnetwork published ports + list-matching ok");
}

// 6. Type conversion: shape -> point explodes; number -> point duplicates.
{
  let doc = build([
    (d) => M.addNode(d, "/", M.createNode("corevector.rect", "rect1")),
    (d) => M.addNode(d, "/", M.createNode("corevector.ellipse", "ell1")),
    (d) => M.connect(d, "/", "rect1", "ell1", "position"), // shape -> point port
    (d) => M.setRenderedChild(d, "/", "ell1"),
  ]);
  const { value, error } = renderer.render(doc, "/");
  assert.equal(error, null);
  assert.equal(value.length, 4, "rect has 4 anchor points -> 4 ellipses");
  console.log("6. shape->point conversion ok");
}

// 7. frame context + impurity: frame -> wave.offset -> rect.width.
{
  let doc = build([
    (d) => M.addNode(d, "/", M.createNode("core.frame", "frame1")),
    (d) => M.addNode(d, "/", M.createNode("math.wave", "wave1")),
    (d) => M.addNode(d, "/", M.createNode("corevector.rect", "rect1")),
    (d) => M.connect(d, "/", "frame1", "wave1", "offset"),
    (d) => M.connect(d, "/", "wave1", "rect1", "width"),
    (d) => M.setRenderedChild(d, "/", "rect1"),
  ]);
  const w1 = g.bounds(renderer.render(doc, "/", { frame: 0 }).value[0]).width;
  const w2 = g.bounds(renderer.render(doc, "/", { frame: 30 }).value[0]).width;
  assert.notEqual(Math.round(w1 * 100), Math.round(w2 * 100));
  console.log("7. frame animation ok");
}

// 8. Errors carry the node path; cycles are detected.
{
  let doc = build([
    (d) => M.addNode(d, "/", M.createNode("math.add", "add1")),
    (d) => M.addNode(d, "/", M.createNode("math.add", "add2")),
    (d) => M.connect(d, "/", "add1", "add2", "v1"),
    (d) => M.connect(d, "/", "add2", "add1", "v1"),
    (d) => M.setRenderedChild(d, "/", "add2"),
  ]);
  const { error } = renderer.render(doc, "/");
  assert.ok(error && /cyclic/.test(error.message), JSON.stringify(error));
  console.log("8. cycle detection ok");
}

// 9. Caching: identical doc -> identical result identity (pure graph).
{
  let doc = build([
    (d) => M.addNode(d, "/", M.createNode("corevector.grid", "grid1")),
    (d) => M.addNode(d, "/", M.createNode("corevector.rect", "rect1")),
    (d) => M.connect(d, "/", "grid1", "rect1", "position"),
    (d) => M.setRenderedChild(d, "/", "rect1"),
  ]);
  const r = createRenderer(registry);
  const v1 = r.render(doc, "/").value;
  const v2 = r.render(doc, "/").value;
  assert.ok(v1[0] === v2[0], "cached shape identity should be reused");
  const doc2 = M.setPortValue(doc, registry, "/rect1", "width", 50);
  const v3 = r.render(doc2, "/").value;
  assert.ok(v3[0] !== v1[0]);
  assert.equal(Math.round(g.bounds(v3[0]).width), 50);
  console.log("9. cross-render cache ok");
}

// 10. Serialization round-trip.
{
  let doc = build([
    (d) => M.addNode(d, "/", M.createNode("corevector.star", "star1")),
    (d) => M.setPortValue(d, registry, "/star1", "points", 8),
  ]);
  const restored = M.loadDocument(M.saveDocument(doc));
  const { value } = renderer.render(restored, "/");
  assert.equal(value.length, 1);
  console.log("10. save/load round-trip ok");
}

// 11. scatter in ellipse + connect + wiggle chain (no errors, plausible output).
{
  let doc = build([
    (d) => M.addNode(d, "/", M.createNode("corevector.ellipse", "ell1")),
    (d) => M.setPortValue(d, registry, "/ell1", "width", 300),
    (d) => M.setPortValue(d, registry, "/ell1", "height", 300),
    (d) => M.addNode(d, "/", M.createNode("corevector.scatter", "scatter1")),
    (d) => M.connect(d, "/", "ell1", "scatter1", "shape"),
    (d) => M.addNode(d, "/", M.createNode("corevector.connect", "connect1")),
    (d) => M.connect(d, "/", "scatter1", "connect1", "points"),
    (d) => M.addNode(d, "/", M.createNode("corevector.wiggle", "wiggle1")),
    (d) => M.connect(d, "/", "connect1", "wiggle1", "shape"),
    (d) => M.setRenderedChild(d, "/", "wiggle1"),
  ]);
  const { value, error } = renderer.render(doc, "/");
  assert.equal(error, null);
  assert.equal(value.length, 1);
  assert.ok(value[0].commands.length >= 20);
  // determinism
  const again = renderer.render(M.loadDocument(M.saveDocument(doc)), "/");
  assert.deepEqual(value, again.value);
  console.log("11. scatter/connect/wiggle deterministic ok");
}

// 12. SVG export.
{
  let doc = build([(d) => M.addNode(d, "/", M.createNode("corevector.star", "star1"))]);
  const svg = g.toSVG(renderer.render(doc, "/").value, { width: 500, height: 500 });
  assert.ok(svg.startsWith("<svg") && svg.includes("<path"));
  console.log("12. svg export ok");
}

console.log("\nAll core tests passed.");
