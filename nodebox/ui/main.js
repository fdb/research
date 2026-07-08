// nodebox/ui/main.js
// Bootstrap: build the store, restore any saved document from the fake
// backend, compile the document's code nodes, render the app.

import { createRoot } from "react-dom/client";
import { html } from "./html.js";
import { createStore } from "./store.js";
import { createDemoDocument } from "./demo-doc.js";
import { App } from "./app.js";

const store = createStore(createDemoDocument());
await store.loadSaved(); // restores + recompiles if a save exists
await store.recompileFunctions(); // compiles the demo's code nodes otherwise
store.evaluate();

createRoot(document.getElementById("root")).render(html`<${App} store=${store} />`);
