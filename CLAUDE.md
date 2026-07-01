# CLAUDE.md

Guidance for working in this repository.

## What this is

`research.enigmeta.com` — a collection of small, AI-driven research
experiments. Each experiment lives in its own folder and is a **no-build**
static project: plain HTML/CSS/JS that runs directly in the browser.

## Hard rules

- **No build step.** No bundlers, no transpilation, no `npm run build`. If a
  file can't be served as-is by a static host, it doesn't belong here. Prefer
  ES modules and modern browser APIs over tooling. CDN imports are acceptable
  when a library is truly needed.
- **One folder per experiment.** Self-contained, with its own `index.html`.
- **Register new experiments** in the root `index.html` (`<ul class="experiments">`).

## Design system

Shared styles live in `/styles.css`. Link it from any experiment:
`<link rel="stylesheet" href="/styles.css" />`.

Conventions (from the fdb-stack):

- **OKLCH** for all colors; derive tints/shades by varying lightness only.
- **No rounded corners** (`border-radius: 0`).
- Black/white palette with gray shades; all colors via CSS variables.
- **Light/dark mode** via `prefers-color-scheme`, overridable with the
  `data-theme` attribute (`light` / `dark`) on `:root`.
- Mobile-first; breakpoints at 768px and 480px.
- Transitions: `0.15s ease` for hover states.

## Deployment

Cloudflare Pages, auto-deployed on push to `main`. No build command; output
directory is the repository root. Just commit static files.
