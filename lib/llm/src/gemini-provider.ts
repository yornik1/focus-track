import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LLMProvider, AnalysisResult } from "./types";

const PROMPT = `Analyze this screenshot. What is the user doing?

Return JSON:
{"score": <0-10>, "category": "<string>", "summary": "<one sentence>"}

- score: focus level. 10 = deep productive work, 0 = pure distraction
- category: short label for the activity. Examples: code, research, design, writing, video, social, gaming, news, shopping, communication. Pick the best fit or invent your own — one word, lowercase.
- summary: what exactly is on screen, one sentence, max 200 chars`;

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

  async analyze(imageBase64: string): Promise<AnalysisResult> {
    const modelsToTry = [this.model, ...FALLBACK_MODELS.filter(m => m !== this.model)];
    let lastError: unknown;

    for (const modelId of modelsToTry) {
      try {
        const model = this.client.getGenerativeModel({ model: modelId });
        const result = await model.generateContent([
          PROMPT,
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
