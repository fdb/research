# spektrum proxy worker

A ~60-line Cloudflare Worker that lets the agent station talk to the
Anthropic API without exposing your key to the browser. It forwards
`POST /v1/messages` (including streaming) and nothing else.

## Deploy

```sh
cd spektrum/worker
npx wrangler deploy worker.js --name spektrum-proxy --compatibility-date 2026-01-01
npx wrangler secret put ANTHROPIC_API_KEY --name spektrum-proxy
# paste your key when prompted
```

Optionally restrict CORS to your deployed origin:

```sh
npx wrangler deploy worker.js --name spektrum-proxy \
  --compatibility-date 2026-01-01 \
  --var ALLOWED_ORIGINS:https://research.enigmeta.com
```

Then open the lab → station III → **setup** → paste the worker URL
(`https://spektrum-proxy.<your-subdomain>.workers.dev`).

## Notes

- The key lives only in the Worker secret (`env.ANTHROPIC_API_KEY`).
- Anyone who knows the worker URL can spend your tokens; set
  `ALLOWED_ORIGINS`, or add your own auth header check, for anything
  beyond personal/performance use.
- No worker? Station III can replay a recorded session (scenes menu →
  "agent: demo session") — tool calls execute for real, only the model
  responses are canned.
