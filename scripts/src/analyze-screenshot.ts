#!/usr/bin/env node
import { readFileSync } from "fs";
import { db, focusLogTable } from "@workspace/db";
import { GeminiProvider, OllamaProvider } from "@workspace/llm";

const PROVIDER = process.env.FOCUS_PROVIDER || "gemini";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

async function analyzeScreenshot(imagePath: string) {
  // Читаем изображение и конвертируем в base64
  const imageBuffer = readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString("base64");

  // Выбираем провайдера
  const provider =
    PROVIDER === "ollama"
      ? new OllamaProvider(OLLAMA_HOST)
      : new GeminiProvider(GEMINI_API_KEY);

  // Анализируем
  const result = await provider.analyze(imageBase64);

  // Сохраняем в БД
  const now = new Date();
  const datetime = now.toISOString();
  const timestamp = Math.floor(now.getTime() / 1000);

  await db.insert(focusLogTable).values({
    datetime,
    timestamp,
    category: result.category,
    focus_score: result.score,
    summary: result.summary,
  });

  console.log(JSON.stringify({ datetime, ...result }));
}

const imagePath = process.argv[2];
if (!imagePath) {
  console.error("Usage: analyze-screenshot <image-path>");
  process.exit(1);
}

analyzeScreenshot(imagePath).catch((err) => {
  console.error("Error analyzing screenshot:", err);
  process.exit(1);
});
