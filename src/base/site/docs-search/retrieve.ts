import type { SearchIndex, SearchResult } from './types';

const magnitude = (vector: number[]) => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
export function search(index: SearchIndex, query: number[], minimumScore = 0.55): SearchResult[] {
  if (query.length !== index.dimensions || !query.every(Number.isFinite)) throw Error('Invalid query embedding');
  const norm = magnitude(query);
  if (!norm) throw Error('Empty query embedding');
  const ranked = index.chunks.map(chunk => ({
    href: chunk.href,
    titlePath: chunk.titlePath,
    snippet: chunk.text.length > 155 ? `${chunk.text.slice(0, 154).replace(/\s+\S*$/, '')}…` : chunk.text,
    score: chunk.vector.reduce((sum, value, i) => sum + value * query[i], 0) / (norm * magnitude(chunk.vector)),
  })).filter(result => result.score >= minimumScore).sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  return ranked.filter(result => { if (seen.has(result.href)) return false; seen.add(result.href); return true; }).slice(0, 5);
}
