import { Ollama } from "ollama";
import type { LLMProvider, AnalysisResult } from "./types";

const PROMPT = `Analyze this screenshot. What is the user doing?

Return JSON:
{"score": <0-10>, "category": "<string>", "summary": "<one sentence>"}

- score: focus level. 10 = deep productive work, 0 = pure distraction
- category: short label for the activity. Examples: code, research, design, writing, video, social, gaming, news, shopping, communication. Pick the best fit or invent your own — one word, lowercase.
- summary: what exactly is on screen, one sentence, max 200 chars`;

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
      category: String(json.category).toLowerCase().slice(0, 30),
      summary: String(json.summary).slice(0, 200),
    };
  }
}
