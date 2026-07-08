// nodebox/ui/params.js
// The parameter panel for the selected node (Java's PortView / Live's
// properties panel): one row per port — a widget when the port is free, a
// connection indicator when it's wired, and a publish toggle when editing
// inside a subnetwork.

import { html } from "./html.js";
import { DraggableNumber, PointWidget, ColorWidget } from "./widgets.js";
import * as M from "../core/model.js";

export function ParamsPanel({ store, state }) {
  const { doc, activePath, selection, registry } = state;
  const network = M.getNode(doc, activePath);
  const node =
    selection.length === 1 ? network.children.find((c) => c.name === selection[0]) : null;

  if (!node) return html`<${NetworkInfo} store=${store} state=${state} network=${network} />`;

  const type = registry.get(node.type);
  const isNetwork = node.type === M.NETWORK_TYPE;
  const ports = M.nodePorts(registry, node).filter((p) => p.type !== "context");
  const contextPorts = M.nodePorts(registry, node).filter((p) => p.type === "context");
  const isRendered = network.renderedChild === node.name;

  return html`<div class="flex h-full flex-col overflow-y-auto">
    <div class="border-b border-neutral-800 px-3 py-2">
      <div class="flex items-baseline justify-between gap-2">
        <span class="font-semibold text-neutral-100">${node.name}</span>
        <span class="text-[10px] uppercase tracking-wide text-neutral-500"
          >${isNetwork ? "network" : node.type}</span
        >
      </div>
      ${type?.description &&
      html`<div class="mt-0.5 text-[11px] text-neutral-500">${type.description}</div>`}
      <div class="mt-2 flex flex-wrap gap-1">
        ${!isRendered &&
        html`<${Btn} onClick=${() => store.setRenderedChild(node.name)}>render<//>`}
        ${isRendered &&
        html`<span class="border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400"
          >● rendered</span
        >`}
        ${isNetwork &&
        html`<${Btn} onClick=${() => store.setActivePath(M.joinPath(activePath, node.name))}
          >edit children ▸<//
        >`}
        ${node.type.startsWith("local.") &&
        html`<${Btn}
          onClick=${() => store.openDialog({ type: "functions", name: node.type.slice(6) })}
          >edit code ƒ<//
        >`}
        <${Btn} onClick=${() => store.removeSelection()}>delete<//>
      </div>
    </div>
    <div class="flex-1 px-3 py-2">
      ${ports.length === 0 &&
      html`<div class="text-[11px] text-neutral-600">
        ${contextPorts.length > 0
          ? "This node reads external state (frame, mouse) and has no input ports."
          : "No input ports."}
      </div>`}
      ${ports.map(
        (port) => html`<${PortRow}
          key=${port.name}
          store=${store}
          state=${state}
          network=${network}
          node=${node}
          port=${port}
        />`,
      )}
      ${isNetwork &&
      html`<div class="mt-3 text-[10px] text-neutral-600">
        Values above are the network's published ports — they write through to the child nodes
        inside.
      </div>`}
    </div>
  </div>`;
}

function PortRow({ store, state, network, node, port }) {
  const { registry, activePath } = state;
  const conn = (network.connections || []).find(
    (c) => c.input === node.name && c.port === port.name,
  );
  const published = (network.publishedPorts || []).find(
    (p) => p.child === node.name && p.port === port.name,
  );
  const insideSubnetwork = activePath !== "/";
  const value = M.portValue(registry, node, port.name);

  const setValue = (v, scrub = false) => store.setPortValue(node.name, port.name, v, scrub);

  let control;
  if (conn) {
    control = html`<span class="flex items-center gap-1 text-[11px] text-sky-300">
      ← ${conn.output}
      <button
        class="px-1 text-neutral-500 hover:text-neutral-200"
        title="disconnect"
        onClick=${() => store.disconnect(node.name, port.name)}
      >
        ×
      </button>
    </span>`;
  } else if (published && insideSubnetwork) {
    control = html`<span class="text-[11px] text-violet-300">↑ published as “${published.name}”</span>`;
  } else {
    control = html`<${PortWidget} port=${port} value=${value} onChange=${setValue} />`;
  }

  return html`<div class="flex min-h-6 items-center justify-between gap-2 border-b border-neutral-900 py-1">
    <span class="text-[11px] text-neutral-400" title=${`${port.name}: ${port.type}${
      port.range === "list" ? " (list)" : ""
    }`}
      >${port.label || port.name}${port.range === "list" ? html`<span class="text-neutral-600"> ⋯</span>` : ""}</span
    >
    <span class="flex items-center gap-1">
      ${control}
      ${insideSubnetwork &&
      !conn &&
      html`<button
        class=${"px-1 text-[10px] " +
        (published ? "text-violet-300" : "text-neutral-600 hover:text-neutral-300")}
        title=${published ? "unpublish from parent network" : "publish on parent network"}
        onClick=${() =>
          published
            ? store.unpublishPort(published.name)
            : store.publishPort(node.name, port.name)}
      >
        ↑
      </button>`}
    </span>
  </div>`;
}

function PortWidget({ port, value, onChange }) {
  switch (port.widget || port.type) {
    case "menu":
      return html`<select
        class="border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-xs text-neutral-100"
        value=${value}
        onChange=${(e) => onChange(e.target.value)}
      >
        ${(port.menu || []).map(
          (m) => html`<option key=${m.key} value=${m.key}>${m.label}</option>`,
        )}
      </select>`;
    case "boolean":
      return html`<input
        type="checkbox"
        checked=${Boolean(value)}
        onChange=${(e) => onChange(e.target.checked)}
      />`;
    case "string":
      return html`<input
        class="w-28 border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-xs text-neutral-100 focus:outline-none focus:border-neutral-500"
        value=${value ?? ""}
        onChange=${(e) => onChange(e.target.value)}
      />`;
    case "point":
      return html`<${PointWidget} value=${value} onChange=${onChange} />`;
    case "color":
      return html`<${ColorWidget} value=${value} onChange=${onChange} />`;
    case "int":
    case "seed":
      return html`<${DraggableNumber} int value=${value ?? 0} onChange=${onChange} />`;
    case "float":
      return html`<${DraggableNumber}
        value=${value ?? 0}
        step=${port.max !== undefined && port.min !== undefined && port.max - port.min <= 2
          ? 0.01
          : 1}
        onChange=${onChange}
      />`;
    case "shape":
    case "list":
      return html`<span class="text-[11px] text-neutral-600">connect a node</span>`;
    default:
      return html`<span class="text-[11px] text-neutral-600">${String(value)}</span>`;
  }
}

function NetworkInfo({ store, state, network }) {
  const { activePath } = state;
  return html`<div class="flex h-full flex-col px-3 py-2">
    <div class="flex items-baseline justify-between">
      <span class="font-semibold text-neutral-100">${activePath === "/" ? "root" : network.name}</span>
      <span class="text-[10px] uppercase tracking-wide text-neutral-500">network</span>
    </div>
    <div class="mt-2 text-[11px] leading-relaxed text-neutral-500">
      <p>Rendered node: <span class="text-neutral-300">${network.renderedChild || "none"}</span></p>
      ${(network.publishedPorts || []).length > 0 &&
      html`<p class="mt-1">
        Published: ${network.publishedPorts.map((p) => `${p.name} → ${p.child}.${p.port}`).join(", ")}
      </p>`}
      <p class="mt-3 text-neutral-600">
        Select a node to edit its parameters. Double-click a node to render it. Double-click the
        canvas to insert a node. Drag from a node's bottom edge to connect it.
      </p>
    </div>
  </div>`;
}

export function Btn({ onClick, children, title }) {
  return html`<button
    class="border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
    title=${title}
    onClick=${onClick}
  >
    ${children}
  </button>`;
}
