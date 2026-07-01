# research.enigmeta.com

A home for small, AI-driven research experiments. Each experiment is a
self-contained, **no-build** project in its own folder — plain HTML, CSS, and
JS that runs directly in the browser with no bundler or build step.

## Structure

```
/
├── index.html      # Landing page listing the experiments
├── styles.css      # Shared design system (OKLCH, light/dark, no radius)
├── CLAUDE.md       # Conventions for adding experiments
└── <experiment>/   # One folder per experiment, each with its own index.html
    └── index.html
```

## Adding an experiment

1. Create a folder, e.g. `my-experiment/`, with an `index.html`.
2. Link the shared design system: `<link rel="stylesheet" href="/styles.css" />`.
3. Add a link to it in the root `index.html` under `<ul class="experiments">`.

Keep it no-build: if it can't be opened as a static file, it doesn't belong
here.

## Deployment

Hosted on **Cloudflare Pages** and deployed automatically on every push to
`main`. Because everything is static:

- **Build command:** _(none)_
- **Build output directory:** `/` (repository root)

One-time setup in the Cloudflare dashboard: create a Pages project connected to
this Git repository, leave the build command empty, set the output directory to
the root, and add `research.enigmeta.com` as a custom domain.
