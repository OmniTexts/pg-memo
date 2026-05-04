import { OpenAIEmbeddingProvider, type OpenAIEmbeddingOptions } from "./openai.js";

export type AliyunEmbeddingOptions = OpenAIEmbeddingOptions;

/**
 * Aliyun DashScope Embedding Provider.
 * Fully compatible with OpenAI API format via compatible-mode.
 */
export class AliyunEmbeddingProvider extends OpenAIEmbeddingProvider {
  override readonly id = "aliyun";

  constructor(opts: AliyunEmbeddingOptions = {}) {
    super({
      apiKey: opts.apiKey ?? process.env.DASHSCOPE_API_KEY,
      model: opts.model ?? "text-embedding-v3",
      baseUrl: opts.baseUrl ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
      ...opts,
    });
  }
}
