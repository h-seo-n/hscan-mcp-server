import type { Request, Response, Router } from "express";
import express from "express";
import { LLM_BASE_URL, LLM_MODEL, OPENAI_API_KEY } from "../lib/config.js";

type ChatCompletionBody = {
  messages?: unknown;
  stream?: unknown;
  tools?: unknown;
};

const router: Router = express.Router();

function buildOpenAIRequestBody(body: ChatCompletionBody): Record<string, unknown> {
  const upstreamBody: Record<string, unknown> = {
    model: LLM_MODEL,
    messages: body.messages,
    stream: body.stream === true,
  };

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    upstreamBody.tools = body.tools;
  }

  return upstreamBody;
}

function validateChatCompletionBody(body: ChatCompletionBody): string | undefined {
  if (!Array.isArray(body.messages)) {
    return "messages must be an array";
  }

  return undefined;
}

async function writeStreamingResponse(upstream: globalThis.Response, res: Response): Promise<void> {
  if (!upstream.body) {
    res.status(502).json({ error: "Upstream response body is empty" });
    return;
  }

  res.status(upstream.status);
  res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}

router.post("/chat/completions", async (req: Request, res: Response) => {
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: "LLM backend is not configured" });
    return;
  }

  const validationError = validateChatCompletionBody(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  try {
    const upstream = await fetch(LLM_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(buildOpenAIRequestBody(req.body)),
      signal: abortController.signal,
    });

    if (req.body.stream === true) {
      await writeStreamingResponse(upstream, res);
      return;
    }

    const responseText = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    res.send(responseText);
  } catch (error) {
    if (abortController.signal.aborted) return;
    console.error("[LLM Proxy] upstream request failed", error);
    res.status(502).json({ error: "LLM upstream request failed" });
  }
});

export default router;
