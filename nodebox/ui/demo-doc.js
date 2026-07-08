// nodebox/ui/demo-doc.js
// The starter document for the live demo. It deliberately exercises all
// three ways of defining behavior in the unified model:
//   1. built-in nodes (grid, wave, rect, colorize, ...),
//   2. a SUBNETWORK used as a node ("size1" — distance → convert_range,
//      with published ports, participating in the parent's list-matching),
//   3. a CODE NODE ("gear" — an ES module stored in the document,
//      insertable from the node dialog under the "custom" category).

import * as M from "../core/model.js";

const GEAR_SOURCE = `// A custom node type, defined as code and stored in the document.
// Ports are declared as data; the default export is the node function.
// The evaluator's list-matching maps it over lists like any other node.
import { makePath } from "nodebox:graphics";

export const node = {
  name: "gear",
  description: "A gear wheel with teeth and a center hole.",
  category: "custom",
  outputType: "shape",
  ports: [
    { name: "position", type: "point" },
    { name: "teeth", type: "int", value: 12, min: 3 },
    { name: "outer", type: "float", value: 120, min: 1 },
    { name: "inner", type: "float", value: 90, min: 1 },
    { name: "hole", type: "float", value: 25, min: 0 },
  ],
};

export default function gear(position, teeth, outer, inner, hole) {
  const cmds = [];
  const n = teeth * 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = (i % 4 < 2 ? outer : inner) / 2;
    cmds.push({
      type: i === 0 ? "M" : "L",
      x: position.x + Math.cos(a) * r,
      y: position.y + Math.sin(a) * r,
    });
  }
  cmds.push({ type: "Z" });
  if (hole > 0) {
    const hr = hole / 2;
    for (let i = 0; i <= 24; i++) {
      const a = -(i / 24) * Math.PI * 2; // reverse winding cuts the hole
      cmds.push({
        type: i === 0 ? "M" : "L",
        x: position.x + Math.cos(a) * hr,
        y: position.y + Math.sin(a) * hr,
      });
    }
    cmds.push({ type: "Z" });
  }
  return makePath(cmds);
}
`;

const node = (type, name, x, y, values = {}) => ({
  ...M.createNode(type, name, { x, y }),
  values,
});

/** @returns {import('../core/model.js').NodeBoxDocument} */
export function createDemoDocument() {
  // Subnetwork: maps a point to a size based on distance to a center.
  const size1 = {
    ...M.createNetwork("size1", { x: 250, y: 240 }),
    children: [
      node("math.distance", "distance1", 100, 80),
      node("math.convert_range", "convert1", 100, 180, {
        source_start: 0,
        source_end: 300,
        target_start: 26,
        target_end: 3,
      }),
    ],
    connections: [{ output: "distance1", input: "convert1", port: "value" }],
    renderedChild: "convert1",
    publishedPorts: [
      { name: "point", child: "distance1", port: "point1" },
      { name: "center", child: "distance1", port: "point2" },
    ],
  };

  const root = {
    ...M.createNetwork("root"),
    children: [
      node("core.frame", "frame1", 40, 30),
      node("math.wave", "wave_x", 20, 100, { min: -160, max: 160, period: 113 }),
      node("math.wave", "wave_y", 160, 100, { min: -160, max: 160, period: 89 }),
      node("corevector.make_point", "center1", 90, 170),
      node("corevector.grid", "grid1", 290, 100, {
        columns: 12,
        rows: 12,
        width: 440,
        height: 440,
      }),
      size1,
      node("corevector.rect", "rect1", 290, 310),
      node("math.convert_range", "hue1", 100, 310, {
        source_start: 3,
        source_end: 26,
        target_start: 0.72,
        target_end: 0.05,
      }),
      node("color.hsb_color", "hsb1", 100, 380, { saturation: 0.75, brightness: 0.95 }),
      node("corevector.colorize", "colorize1", 290, 380),
    ],
    connections: [
      { output: "frame1", input: "wave_x", port: "offset" },
      { output: "frame1", input: "wave_y", port: "offset" },
      { output: "wave_x", input: "center1", port: "x" },
      { output: "wave_y", input: "center1", port: "y" },
      { output: "grid1", input: "size1", port: "point" },
      { output: "center1", input: "size1", port: "center" },
      { output: "grid1", input: "rect1", port: "position" },
      { output: "size1", input: "rect1", port: "width" },
      { output: "size1", input: "rect1", port: "height" },
      { output: "size1", input: "hue1", port: "value" },
      { output: "hue1", input: "hsb1", port: "hue" },
      { output: "hsb1", input: "colorize1", port: "fill" },
      { output: "rect1", input: "colorize1", port: "shape" },
    ],
    renderedChild: "colorize1",
    publishedPorts: [],
  };

  return {
    type: "nodebox",
    formatVersion: M.FORMAT_VERSION,
    name: "Wave grid",
    properties: { width: 600, height: 600, background: "#ffffff" },
    functions: [{ name: "gear", source: GEAR_SOURCE }],
    root,
  };
}
