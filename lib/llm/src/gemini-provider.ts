import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LLMProvider, AnalysisResult } from "./types";

const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.0-flash-lite"];

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes("429") || err.message.includes("quota") || err.message.includes("RESOURCE_EXHAUSTED");
  }
  return false;
}

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;
  private model: string;
  public usedModel: string = "";

  constructor(apiKey: string, model: string = "gemini-2.5-flash") {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async analyze(imageBase64: string, prompt?: string): Promise<AnalysisResult> {
    const text = prompt ?? "";
    const modelsToTry = [this.model, ...FALLBACK_MODELS.filter(m => m !== this.model)];
    let lastError: unknown;

    for (const modelId of modelsToTry) {
      try {
        const model = this.client.getGenerativeModel({ model: modelId });
        const result = await model.generateContent([
          text,
          { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
        ]);
        this.usedModel = modelId;
        return this.parseResponse(result.response.text());
      } catch (err) {
        lastError = err;
        if (!isRateLimitError(err)) throw err;
      }
    }

    throw lastError;
  }

  private parseResponse(text: string): AnalysisResult {
    const jsonMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/) || text.match(/(\{[\s\S]*?\})/);
    if (!jsonMatch) {
      throw new Error(`Failed to parse Gemini response: ${text}`);
    }

    const json = JSON.parse(jsonMatch[1]);

    return {
      score: Math.max(0, Math.min(10, Number(json.score))),
      category: String(json.category).toLowerCase().slice(0, 30),
      summary: String(json.summary).slice(0, 200),
    };
  }
}
