// nodebox/ui/html.js
// htm bound to React.createElement — JSX without a build step.
import { createElement } from "react";
import htm from "htm";

export const html = htm.bind(createElement);
