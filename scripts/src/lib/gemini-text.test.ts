import assert from "node:assert/strict";
import test from "node:test";
import { generateGeminiText } from "@workspace/llm";

// К сети тесты не обращаются: проверяется только отказ до первого запроса.
test("generateGeminiText: без ключей отказ сразу, без запроса", async () => {
  await assert.rejects(
    generateGeminiText({ apiKeys: [], model: "gemini-3.5-flash-lite", prompt: "hello" }),
    /API key/,
  );
});

test("generateGeminiText: пустые и пробельные ключи считаются отсутствующими", async () => {
  await assert.rejects(
    generateGeminiText({ apiKeys: ["", "   "], model: "gemini-3.5-flash-lite", prompt: "hello", timeoutMs: 50 }),
    /API key/,
  );
});
