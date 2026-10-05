import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_GEMINI_MODEL, normalizeGeminiModelId } from "@workspace/llm";

test("Gemini uses the current Flash Lite model by default", () => {
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.5-flash-lite");
});

test("removed Flash Lite model ids migrate to the current model", () => {
  assert.equal(normalizeGeminiModelId("gemini-flash-lite-latest"), DEFAULT_GEMINI_MODEL);
  assert.equal(normalizeGeminiModelId("gemini-2.0-flash-lite"), DEFAULT_GEMINI_MODEL);
});
