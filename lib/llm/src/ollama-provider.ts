import { Ollama } from "ollama";
import type { LLMProvider, AnalysisResult, Category } from "./types";

const PROMPT = `Analyze this screenshot and provide:
1. Focus score (0-10): How focused is the user? 10 = deep work, 0 = distracted
2. Category: code, video, social, or idle
3. Summary: One short sentence describing what the user is doing

Respond in JSON format:
{"score": <number>, "category": "<category>", "summary": "<text>"}`;

export class OllamaProvider implements LLMProvider {
  private client: Ollama;
  private model: string;

  constructor(host: string = "http://localhost:11434", model: string = "llava:7b") {
    this.client = new Ollama({ host });
    this.model = model;
  }

  async analyze(imageBase64: string): Promise<AnalysisResult> {
    const response = await this.client.generate({
      model: this.model,
      prompt: PROMPT,
      images: [imageBase64],
      stream: false,
    });

    const parsed = this.parseResponse(response.response);
    return parsed;
  }

  private parseResponse(text: string): AnalysisResult {
    // Извлечь JSON из markdown code block если есть
    const jsonMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/) || text.match(/(\{[\s\S]*?\})/);
    if (!jsonMatch) {
      throw new Error(`Failed to parse Ollama response: ${text}`);
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
