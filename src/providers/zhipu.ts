import { OpenAIEmbeddingProvider, type OpenAIEmbeddingOptions } from "./openai.js";

export type ZhipuEmbeddingOptions = OpenAIEmbeddingOptions & {
  dimensions?: number;
};

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
      batchSize: opts.batchSize ?? 2,
      dims: opts.dimensions ?? 2048,
      ...opts,
    } as any);
  }

  /**
   * Zhipu's embedding-3 has a strict total token limit per request (3072).
   * We wrap the base embedBatch to handle oversized individual strings
   * by splitting them and averaging their embeddings.
   */
  override async embedBatch(texts: string[]): Promise<number[][]> {
    const processedTexts: { text: string; subCount: number; parts: string[] }[] = [];
    
    for (const t of texts) {
      // 2000 chars is roughly 1200-1500 tokens for CJK, safe for 3072 limit
      if (t.length > 2000) {
        const parts: string[] = [];
        for (let i = 0; i < t.length; i += 1500) {
          parts.push(t.slice(i, i + 1500));
        }
        processedTexts.push({ text: t, subCount: parts.length, parts });
      } else {
        processedTexts.push({ text: t, subCount: 1, parts: [t] });
      }
    }

    // If no splitting needed, use parent's efficient batching
    if (processedTexts.every(p => p.subCount === 1)) {
      return super.embedBatch(texts);
    }

    // If splitting occurred, we need to process parts and re-assemble
    const allParts = processedTexts.flatMap(p => p.parts);
    const allVecs = await super.embedBatch(allParts);

    const results: number[][] = [];
    let offset = 0;
    for (const item of processedTexts) {
      const subVecs = allVecs.slice(offset, offset + item.subCount);
      offset += item.subCount;

      if (subVecs.length === 1) {
        results.push(subVecs[0]);
      } else {
        // Average Pooling
        const dims = subVecs[0].length;
        const avgVec = new Array(dims).fill(0);
        for (const v of subVecs) {
          for (let d = 0; d < dims; d++) {
            avgVec[d] += v[d] / subVecs.length;
          }
        }
        results.push(avgVec);
      }
    }
    return results;
  }
}
