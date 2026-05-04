import type { EmbeddingProvider } from "../types.js";
import { withRetry, concurrentBatch } from "../utils/api.js";

export type OpenAIEmbeddingOptions = {
  /** API key. Default: process.env.OPENAI_API_KEY */
  apiKey?: string;
  /** Model name. Default: "text-embedding-3-small" */
  model?: string;
  /** Output dimensions (Matryoshka reduction). Default: model's native dims */
  dims?: number;
  /** API base URL. Default: "https://api.openai.com/v1" */
  baseUrl?: string;
  /** Max texts per API call. Default: 100 */
  batchSize?: number;
  /** Max concurrent API calls. Default: 2 */
  concurrency?: number;
};

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  id: string = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly dims?: number;
  private readonly baseUrl: string;
  private readonly batchSize: number;
  private readonly concurrency: number;

  constructor(opts: OpenAIEmbeddingOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    if (!this.apiKey) {
      throw new Error(
        "OpenAI API key is required. Set OPENAI_API_KEY env var or pass apiKey option.",
      );
    }
    this.model = opts.model ?? "text-embedding-3-small";
    this.dims = opts.dims;
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.batchSize = opts.batchSize ?? 100;
    this.concurrency = opts.concurrency ?? 2;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vec] = await this.embedBatch([text]);
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return concurrentBatch(
      texts,
      this.batchSize,
      this.concurrency,
      (batch) => withRetry(() => this.callApi(batch)),
    );
  }

  private async callApi(inputs: string[]): Promise<number[][]> {
    const body: Record<string, unknown> = { input: inputs, model: this.model };
    if (this.dims) body.dimensions = this.dims;

    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI embedding API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to preserve order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}
