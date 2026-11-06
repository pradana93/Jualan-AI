// Minimal OpenAI-compatible mock upstream for testing the reseller metering
// pipeline end to end. Serves POST /v1/chat/completions (streaming SSE) and
// reports a fixed token usage so billing math can be asserted deterministically.
const http = require("http");

const PORT = 11434; // matches ollama-local baseUrl if that route is taken
// Actually point openai override at 8787 instead — see connection row.
const FIXED_PROMPT_TOKENS = 1000;
const FIXED_COMPLETION_TOKENS = 2000;

function sseChunks(res) {
  // OpenAI streaming format: chat.completion.chunk frames, with usage in the
  // final frame (stream_options.include_usage convention — the runner also
  // tolerates usage arriving via the x-9r-usage header fallback).
  const id = "chatcmpl-mock-" + Date.now();
  const base = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "gpt-5",
  };
  const frames = [
    { ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: { content: "Hello from the mock upstream!" }, finish_reason: null }] },
    {
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: FIXED_PROMPT_TOKENS,
        completion_tokens: FIXED_COMPLETION_TOKENS,
        total_tokens: FIXED_PROMPT_TOKENS + FIXED_COMPLETION_TOKENS,
      },
    },
  ];
  for (const f of frames) {
    res.write(`data: ${JSON.stringify(f)}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = http.createServer((req, res) => {
  const url = req.url || "";
  console.log(`[mock-upstream] ${req.method} ${url}`);
  if (url.endsWith("/chat/completions")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      console.log("[mock-upstream] request body:", body.slice(0, 300));
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      });
      sseChunks(res);
    });
    return;
  }
  if (url.endsWith("/embeddings")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const out = {
        object: "list",
        data: [{ object: "embedding", index: 0, embedding: Array(8).fill(0.1) }],
        usage: { prompt_tokens: FIXED_PROMPT_TOKENS, total_tokens: FIXED_PROMPT_TOKENS },
        model: "text-embedding-3-small",
      };
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: `mock-upstream: no route for ${url}` } }));
});

server.listen(PORT, () => console.log(`[mock-upstream] listening on :${PORT}`));
