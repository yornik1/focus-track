export type Category = "code" | "video" | "social" | "idle";

export interface AnalysisResult {
  score: number; // 0-10
  category: Category;
  summary: string;
}

export interface LLMProvider {
  analyze(imageBase64: string): Promise<AnalysisResult>;
}
