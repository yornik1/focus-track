import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableGeminiError } from "@workspace/llm";

test("Gemini временные 429/5xx ошибки разрешают fallback на другую модель", () => {
  for (const message of [
    "[429 Too Many Requests] RESOURCE_EXHAUSTED",
    "[500 Internal Server Error]",
    "[502 Bad Gateway]",
    "[503 Service Unavailable] This model is currently experiencing high demand.",
    "[504 Gateway Timeout]",
  ]) {
    assert.equal(isRetryableGeminiError(new Error(message)), true, message);
  }
});

test("Gemini постоянные ошибки не маскируются fallback-логикой", () => {
  for (const message of [
    "[400 Bad Request] invalid image",
    "[404 Not Found] model does not exist",
    "Failed to parse Gemini response",
  ]) {
    assert.equal(isRetryableGeminiError(new Error(message)), false, message);
  }
  assert.equal(isRetryableGeminiError("503"), false);
});
