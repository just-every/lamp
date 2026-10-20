import { createHash } from 'node:crypto';

export const model = '@cf/baai/bge-base-en-v1.5';
export const pooling = 'cls';
export const dimensions = 768;
const digest = value => createHash('sha256').update(value).digest('hex');

// Keep long sections inside the model's context. Every part keeps the same
// heading link; retrieval collapses duplicate links after scoring.
function parts(text) {
  const chunks = [];
  // Paragraph boundaries are stable cache boundaries. Within a long paragraph,
  // keep sentences together so a short task isn't diluted by an entire guide.
  for (const paragraph of text.split(/\n\n+/).filter(Boolean)) {
    let part = '';
    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      if (part && part.length + sentence.length > 650) { chunks.push(part.trim()); part = ''; }
      if (sentence.length > 650) {
        for (const word of sentence.split(/\s+/).filter(Boolean)) {
          if (part && part.length + word.length > 650) { chunks.push(part.trim()); part = ''; }
          if (word.length > 650) {
            if (part) { chunks.push(part.trim()); part = ''; }
            for (let i = 0; i < word.length; i += 650) chunks.push(word.slice(i, i + 650));
          } else part += `${part ? ' ' : ''}${word}`;
        }
      } else part += `${part ? ' ' : ''}${sentence.trim()}`;
    }
    if (part.trim()) chunks.push(part.trim());
  }
  return chunks;
}

export function searchChunks(pages) {
  return pages.flatMap(page => page.searchSections.flatMap(section => parts(section.text).map(text => {
    const href = `${page.href}#${section.anchor}`;
    const hash = digest(JSON.stringify([model, pooling, href, section.titlePath, text]));
    return { ...section, text, href, hash };
  })));
}

export function validVector(vector) {
  return Array.isArray(vector) && vector.length === dimensions && vector.every(Number.isFinite) && vector.some(value => value !== 0);
}

export async function buildSearchIndex(pages, { previous = [], embed, onBatch = () => {} }) {
  const chunks = searchChunks(pages);
  const cached = new Map(previous.filter(index => index?.version === 1 && index.model === model && index.pooling === pooling && index.dimensions === dimensions)
    .flatMap(index => index.chunks).filter(chunk => validVector(chunk.vector)).map(chunk => [chunk.hash, chunk.vector]));
  const missing = chunks.filter(chunk => !cached.has(chunk.hash));
  let embedded = 0;
  for (let offset = 0; offset < missing.length; offset += 32) {
    const batch = missing.slice(offset, offset + 32);
    const response = await embed(model, { text: batch.map(chunk => `${chunk.titlePath.join(' > ')}\n${chunk.text}`), pooling });
    if (response.data?.length !== batch.length || !response.data.every(validVector)) throw Error('Workers AI returned invalid embeddings; search build stopped.');
    batch.forEach((chunk, i) => cached.set(chunk.hash, response.data[i].map(value => Number(value.toFixed(6)))));
    embedded += batch.length;
    onBatch({ embedded, total: missing.length });
  }
  const index = { version: 1, model, pooling, dimensions, corpusHash: digest(chunks.map(chunk => chunk.hash).join('\n')),
    chunks: chunks.map(chunk => ({ ...chunk, vector: cached.get(chunk.hash) })) };
  return { index, counts: { total: chunks.length, reused: chunks.length - embedded, embedded } };
}
