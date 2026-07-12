/*
 * spektrum proxy — a minimal Cloudflare Worker that forwards
 * /v1/messages to the Anthropic API, adding the API key from the
 * ANTHROPIC_API_KEY secret and permissive-enough CORS for the lab.
 *
 * Deploy:  see README.md next to this file.
 */

const ANTHROPIC = "https://api.anthropic.com";

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/messages") {
      return json({ error: "POST /v1/messages only" }, 404, cors);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: "worker is missing the ANTHROPIC_API_KEY secret" }, 500, cors);
    }

    const upstream = await fetch(`${ANTHROPIC}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: request.body,
    });

    // Pass the (possibly streaming) body straight through.
    const headers = new Headers(cors);
    headers.set("content-type", upstream.headers.get("content-type") || "application/json");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function corsHeaders(request, env) {
  // Lock down with an ALLOWED_ORIGINS var ("https://a.com,https://b.com");
  // defaults to * so the lab works from localhost and previews.
  const origin = request.headers.get("Origin") || "*";
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  const ok = allowed.includes("*") || allowed.includes(origin);
  return {
    "access-control-allow-origin": ok ? origin : allowed[0] || "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
