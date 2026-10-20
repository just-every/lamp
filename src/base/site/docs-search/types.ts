export type SearchSection = { anchor: string; titlePath: string[]; text: string };
export type SearchPage = { href: string; searchSections: SearchSection[] };
export type SearchChunk = SearchSection & { href: string; hash: string };
export type SearchIndex = {
  version: 1;
  model: string;
  pooling: 'cls';
  dimensions: number;
  corpusHash: string;
  chunks: (SearchChunk & { vector: number[] })[];
};
export type Embeddings = { shape: number[]; data: number[][] };
export type Embed = (model: string, input: { text: string[]; pooling: 'cls' }) => Promise<Embeddings>;
export type SearchResult = { href: string; titlePath: string[]; snippet: string; score: number };
