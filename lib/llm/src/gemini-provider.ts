import { GoogleGenerativeAI } from "@google/generative-ai";
import { normalizeCategory } from "@workspace/categories";
import { normalizeDirectionId, type LLMProvider, type AnalysisResult } from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

const RETIRED_GEMINI_MODELS = new Set(["gemini-flash-lite-latest", "gemini-2.0-flash-lite"]);
const FALLBACK_MODELS = [DEFAULT_GEMINI_MODEL, "gemini-3.6-flash", "gemini-3.8-flash"];

export function normalizeGeminiModelId(model: string): string {
  const normalized = model.trim();
  return RETIRED_GEMINI_MODELS.has(normalized) ? DEFAULT_GEMINI_MODEL : normalized || DEFAULT_GEMINI_MODEL;
}

export function isRetryableGeminiError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    /\b(?:429|5\d{2})\b/.test(err.message) ||
    err.message.includes("quota") ||
    err.message.includes("RESOURCE_EXHAUSTED") ||
    err.message.includes("high demand")
  );
}

/** Ключ не годится сам по себе (невалидный/заблокированный) — сразу переходим к следующему. */
function isAuthError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.message.includes("401") ||
      err.message.includes("403") ||
      err.message.includes("API_KEY_INVALID") ||
      err.message.includes("API key not valid") ||
      err.message.includes("PERMISSION_DENIED")
    );
  }
  return false;
}

export class GeminiProvider implements LLMProvider {
  private apiKeys: string[];
  private model: string;
  public usedModel: string = "";

  /** `apiKey` — один ключ или массив: при лимите/невалидности первого ротация уходит к следующему. */
  constructor(apiKey: string | string[], model: string = DEFAULT_GEMINI_MODEL) {
    const keys = (Array.isArray(apiKey) ? apiKey : [apiKey]).map((k) => k.trim()).filter(Boolean);
    this.apiKeys = keys.length > 0 ? keys : [""];
    this.model = normalizeGeminiModelId(model);
  }

  async analyze(imageBase64: string, prompt?: string): Promise<AnalysisResult> {
    const text = prompt ?? "";
    const modelsToTry = [this.model, ...FALLBACK_MODELS.filter(m => m !== this.model)];
    let lastError: unknown;

    // Внешний цикл — ключи (ротация), внутренний — модели (fallback внутри ключа).
    for (const apiKey of this.apiKeys) {
      const client = new GoogleGenerativeAI(apiKey);

      for (const modelId of modelsToTry) {
        try {
          const model = client.getGenerativeModel({ model: modelId });
          const result = await model.generateContent([
            text,
            { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
          ]);
          this.usedModel = modelId;
          return parseGeminiResponse(result.response.text());
        } catch (err) {
          lastError = err;
          if (isAuthError(err)) break; // сам ключ негодный → следующий ключ, модели не спасут
          if (!isRetryableGeminiError(err)) throw err; // не временная ошибка и не auth → реальная ошибка
        }
      }
      // Лимит по всем моделям (или битый ключ) — внешний цикл берёт следующий ключ.
    }

    throw lastError;
  }

}

export function parseGeminiResponse(text: string): AnalysisResult {
  const jsonMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/) || text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) throw new Error(`Failed to parse Gemini response: ${text}`);
  const json = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
  return {
    score: Math.max(0, Math.min(10, Number(json.score))),
    category: normalizeCategory(String(json.category)),
    summary: String(json.summary).slice(0, 200),
    direction_id: normalizeDirectionId(json.direction_id),
  };
}
