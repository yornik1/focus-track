import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LLMProvider, AnalysisResult, Category } from "./types";

const PROMPT = `Analyze this screenshot and provide:
1. Focus score (0-10): How focused is the user? 10 = deep work, 0 = distracted
2. Category: code, video, social, or idle
3. Summary: One short sentence describing what the user is doing

Respond in JSON format:
{"score": <number>, "category": "<category>", "summary": "<text>"}`;

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model: string = "gemini-2.0-flash-exp") {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async analyze(imageBase64: string): Promise<AnalysisResult> {
    const model = this.client.getGenerativeModel({ model: this.model });

    const result = await model.generateContent([
      PROMPT,
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBase64,
        },
      },
    ]);

    const text = result.response.text();
    const parsed = this.parseResponse(text);

    return parsed;
  }

  private parseResponse(text: string): AnalysisResult {
    // Извлечь JSON из markdown code block если есть
    const jsonMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/) || text.match(/(\{[\s\S]*?\})/);
    if (!jsonMatch) {
      throw new Error(`Failed to parse Gemini response: ${text}`);
    }

    const json = JSON.parse(jsonMatch[1]);

    return {
      score: Math.max(0, Math.min(10, Number(json.score))),
      category: this.validateCategory(json.category),
      summary: String(json.summary).slice(0, 200),
    };
  }

  private validateCategory(cat: string): Category {
    const valid: Category[] = ["code", "video", "social", "idle"];
    return valid.includes(cat as Category) ? (cat as Category) : "idle";
  }
}
