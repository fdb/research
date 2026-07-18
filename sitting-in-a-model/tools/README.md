# tools/

Node scripts used to prepare and verify the piece. None of these run at
deploy time — the site itself stays a no-build static folder; these scripts
produced the artifacts that are committed (`model/`, `vendor/`, `data/`,
`img/`).

Setup: `npm install` in this folder (installs `@huggingface/transformers`
for the node-side model, `onnxruntime-web` for the vendored runtime files,
`playwright` for browser verification).

| script                  | what it does                                                                 |
| ----------------------- | ---------------------------------------------------------------------------- |
| `fetch-model.mjs`       | downloads DistilBERT int8 ONNX + vocab, splits into <25 MiB chunks + manifest |
| `validate-tokenizer.mjs`| asserts our WordPiece port matches the HF tokenizer token-for-token           |
| `precompute.mjs`        | records the deterministic 700-pass fallback session (`data/fallback.json`)    |
| `browsertest.mjs`       | serves the repo with COOP/COEP and drives live/fallback/kiosk/mobile in Chromium |
| `stills.mjs`            | captures the documentation stills used on the about page                      |
| `spike.mjs` / `spike2.mjs` / `quality.mjs` | the research record: model-quality battery and erosion-dynamics sweeps that chose DistilBERT and the sampling parameters (see about.html, "Making of") |

The spike scripts are kept on purpose — they are the experiment notebook
behind the parameter choices cited in the essay.
