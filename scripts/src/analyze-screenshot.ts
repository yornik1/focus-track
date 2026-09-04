#!/usr/bin/env node
import "dotenv/config";
import { readFileSync } from "fs";
import {
  db,
  focusLogTable,
  readAppSettings,
  DEFAULT_PROMPT,
  getTopCategoriesFromLogs,
} from "@workspace/db";
import { buildAnalysisPrompt, normalizeCategory } from "@workspace/categories";
import { GeminiProvider, OllamaProvider } from "@workspace/llm";

const stored = readAppSettings();
const fromFile = stored != null;

const PROVIDER = fromFile
  ? stored.provider
  : ((process.env.FOCUS_PROVIDER || "gemini") as "gemini" | "ollama");
const trimmedToken = fromFile ? stored.token.trim() : "";
const MODEL = fromFile && stored.model ? stored.model : (PROVIDER === "ollama" ? "llava:7b" : "gemini-flash-lite-latest");
const BASE_PROMPT = fromFile ? stored.prompt : DEFAULT_PROMPT;

const GEMINI_API_KEY =
  PROVIDER === "gemini"
    ? trimmedToken || (process.env.GEMINI_API_KEY ?? "")
    : (process.env.GEMINI_API_KEY ?? "");
// Основной ключ + резервные (ротация): дубли и пустые отбрасываем.
const GEMINI_API_KEYS = [
  ...new Set([GEMINI_API_KEY, ...(fromFile ? stored.tokens : [])].map((k) => k.trim()).filter(Boolean)),
];
const OLLAMA_HOST =
  PROVIDER === "ollama"
    ? trimmedToken || (process.env.OLLAMA_HOST ?? "http://localhost:11434")
    : (process.env.OLLAMA_HOST ?? "http://localhost:11434");

async function analyzeScreenshot(imagePath: string) {
  const imageBuffer = readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString("base64");

  const provider =
    PROVIDER === "ollama"
      ? new OllamaProvider(OLLAMA_HOST, MODEL)
      : new GeminiProvider(GEMINI_API_KEYS, MODEL);

  const frequent = await getTopCategoriesFromLogs(5, 30);
  const prompt = buildAnalysisPrompt(BASE_PROMPT, frequent);
  const result = await provider.analyze(imageBase64, prompt);
  const category = normalizeCategory(result.category);

  const usedModel = provider instanceof GeminiProvider ? provider.usedModel : MODEL;

  const now = new Date();
  const datetime = now.toISOString();
  const timestamp = Math.floor(now.getTime() / 1000);

  await db.insert(focusLogTable).values({
    datetime,
    timestamp,
    category,
    focus_score: result.score,
    summary: result.summary,
  });

  console.log(JSON.stringify({ datetime, ...result, category, model: usedModel }));
}

const imagePath = process.argv[2];
if (!imagePath) {
  console.error("Usage: analyze-screenshot <image-path>");
  process.exit(1);
}

analyzeScreenshot(imagePath).catch((err) => {
  const errorInfo = {
    provider: PROVIDER,
    model: MODEL,
    error: err instanceof Error ? err.message : String(err),
  };
  console.error(JSON.stringify(errorInfo));
  process.exit(1);
});
