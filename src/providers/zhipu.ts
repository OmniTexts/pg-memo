import { OpenAIEmbeddingProvider, type OpenAIEmbeddingOptions } from "./openai.js";

export type ZhipuEmbeddingOptions = OpenAIEmbeddingOptions;

/**
 * Zhipu AI (BigModel) Embedding Provider.
 * Fully compatible with OpenAI API format.
 */
export class ZhipuEmbeddingProvider extends OpenAIEmbeddingProvider {
  override readonly id = "zhipu";

  constructor(opts: ZhipuEmbeddingOptions = {}) {
    super({
      apiKey: opts.apiKey ?? process.env.ZHIPU_API_KEY,
      model: opts.model ?? "embedding-3",
      baseUrl: opts.baseUrl ?? "https://open.bigmodel.cn/api/paas/v4",
      ...opts,
    });
  }
}
