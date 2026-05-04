import type { EmbeddingProvider } from "../types.js";
import { withRetry, concurrentBatch } from "../utils/api.js";

export type GoogleEmbeddingOptions = {
  /** API key. Default: process.env.GOOGLE_API_KEY */
  apiKey?: string;
  /** Model name. Default: "text-embedding-004" */
  model?: string;
  /** Max texts per API call. Default: 100 */
  batchSize?: number;
  /** Max concurrent API calls. Default: 2 */
  concurrency?: number;
  /** API base URL. Default: "https://generativelanguage.googleapis.com" */
  baseUrl?: string;
  /**
   * Task type for the embedding.
   * Use RETRIEVAL_DOCUMENT for indexing and RETRIEVAL_QUERY for search.
   * Default: RETRIEVAL_DOCUMENT
   */
  taskType?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY" | "CLASSIFICATION" | "CLUSTERING";
};

export class GoogleEmbeddingProvider implements EmbeddingProvider {
  readonly id = "google";
  readonly model: string;
  private readonly apiKey: string;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly baseUrl: string;
  private readonly taskType: string;

  constructor(opts: GoogleEmbeddingOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.GOOGLE_API_KEY ?? "";
    if (!this.apiKey) {
      throw new Error(
        "Google API key is required. Set GOOGLE_API_KEY env var or pass apiKey option.",
      );
    }
    this.model = opts.model ?? "text-embedding-004";
    this.batchSize = opts.batchSize ?? 100;
    this.concurrency = opts.concurrency ?? 2;
    this.baseUrl = (opts.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    this.taskType = opts.taskType ?? "RETRIEVAL_DOCUMENT";
  }

  async embedQuery(text: string): Promise<number[]> {
    // For queries, we should ideally use RETRIEVAL_QUERY
    // But since embedBatch uses the provider's default, we might need to handle this
    const result = await withRetry(() => this.callApi([text], "RETRIEVAL_QUERY"));
    return result[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return concurrentBatch(
      texts,
      this.batchSize,
      this.concurrency,
      (batch) => withRetry(() => this.callApi(batch, this.taskType)),
    );
  }

  private async callApi(inputs: string[], taskType: string): Promise<number[][]> {
    const url = `${this.baseUrl}/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`;

    const body = {
      requests: inputs.map((text) => ({
        model: `models/${this.model}`,
        taskType: taskType,
        content: { parts: [{ text }] },
      })),
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Google embedding API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      embeddings: Array<{ values: number[] }>;
    };

    return data.embeddings.map((e) => e.values);
  }
}
