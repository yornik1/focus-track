import { Ollama } from "ollama";
import { normalizeCategory } from "@workspace/categories";
import { normalizeDirectionId, type LLMProvider, type AnalysisResult } from "./types";

export class OllamaProvider implements LLMProvider {
  private client: Ollama;
  private model: string;

  constructor(host: string = "http://localhost:11434", model: string = "llava:7b") {
    this.client = new Ollama({ host });
    this.model = model;
  }

  async analyze(imageBase64: string, prompt?: string): Promise<AnalysisResult> {
    const text = prompt ?? "";
    const response = await this.client.generate({
      model: this.model,
      prompt: text,
      images: [imageBase64],
      stream: false,
    });

    const parsed = parseOllamaResponse(response.response);
    return parsed;
  }

}

export function parseOllamaResponse(text: string): AnalysisResult {
  // Извлечь JSON из markdown code block если есть.
  const jsonMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/) || text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) throw new Error(`Failed to parse Ollama response: ${text}`);
  const json = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
  return {
    score: Math.max(0, Math.min(10, Number(json.score))),
    category: normalizeCategory(String(json.category)),
    summary: String(json.summary).slice(0, 200),
    direction_id: normalizeDirectionId(json.direction_id),
  };
}
