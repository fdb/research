// Minimal parser for NodeBox 3 .ndbx files (XML, formatVersion ≤ 21).
// Handles exactly the tags the format uses — ndbx, property, link, node,
// port, conn, menu — attributes only, no text content.

export function parseNDBX(xml) {
  const root = { tag: "#doc", attrs: {}, children: [] };
  const stack = [root];
  const re = /<(\/?)([a-zA-Z][\w.-]*)((?:\s+[\w.-]+="[^"]*")*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, close, tag, attrText, selfClose] = m;
    if (close) {
      stack.pop();
      continue;
    }
    const attrs = {};
    const attrRe = /([\w.-]+)="([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(attrText))) attrs[a[1]] = decodeEntities(a[2]);
    const el = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root;
}

export function decodeEntities(s) {
  if (s.indexOf("&") === -1) return s;
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Parse a port value attribute according to its NodeBox type. */
export function parsePortValue(type, value) {
  if (value === undefined) return undefined;
  switch (type) {
    case "float":
      return parseFloat(value);
    case "int":
      return parseInt(value, 10);
    case "boolean":
      return value === "true";
    case "point": {
      const [x, y] = value.split(",").map(parseFloat);
      return { x, y };
    }
    case "color":
      return parseHexColor(value);
    default:
      return value; // string / menu keys / file names
  }
}

/** "#rrggbbaa" → {r,g,b,a} with channels 0..1. */
export function parseHexColor(s) {
  let hex = String(s).trim().replace(/^#/, "");
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  if (hex.length === 6) hex += "ff";
  const n = parseInt(hex, 16);
  return {
    r: ((n >>> 24) & 255) / 255,
    g: ((n >>> 16) & 255) / 255,
    b: ((n >>> 8) & 255) / 255,
    a: (n & 255) / 255,
  };
}
