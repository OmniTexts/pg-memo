declare module "segmentit" {
  export interface Token {
    w: string; // 词语
    p: number; // 词性
  }

  export class Segment {
    constructor();
    use(modules: unknown | unknown[]): this;
    loadDict(dict: unknown): void;
    loadSynonymDict(dict: unknown): void;
    loadStopwordDict(dict: unknown): void;
    doSegment(text: string, options: { simple: true }): string[];
    doSegment(text: string): Token[];
  }

  export function useDefault(segment: Segment): Segment;
}
