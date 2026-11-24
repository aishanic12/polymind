import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { generateOllamaEmbeddings, getOllamaModels, OllamaError } from './ollama';
import { MAX_TEXT_CHARS } from './security';

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 180;
const EMBEDDING_BATCH_SIZE = 100;
const MAX_CACHED_PDFS = 3;
const MAX_PDF_PAGES = 250;
const MIN_SIMILARITY = 0.4;
const MAX_RESULTS = 4;

interface VectorChunk {
  text: string;
  embedding: number[];
}

export class RagInputError extends Error {}

const indexCache = new Map<string, Promise<VectorChunk[]>>();

export function splitIntoChunks(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + CHUNK_SIZE, normalized.length);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf(' ', end);
      if (boundary > start + CHUNK_SIZE * 0.6) end = boundary;
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }

  return chunks;
}

export async function extractPdfText(data: Uint8Array): Promise<string> {
  const loadingTask = getDocument({ data: new Uint8Array(data) });
  let document: Awaited<typeof loadingTask.promise>;
  try {
    document = await loadingTask.promise;
  } catch {
    throw new RagInputError('Could not read this PDF. Please upload a valid PDF file.');
  }
  const pages: string[] = [];
  let characterCount = 0;

  try {
    if (document.numPages > MAX_PDF_PAGES) {
      throw new RagInputError(`PDF has too many pages. Maximum supported is ${MAX_PDF_PAGES}.`);
    }

    for (let pageNumber = 1; pageNumber <= document.numPages && characterCount < MAX_TEXT_CHARS; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim();
      if (pageText) {
        const remaining = MAX_TEXT_CHARS - characterCount;
        pages.push(pageText.slice(0, remaining));
        characterCount += pageText.length;
      }
    }
  } finally {
    await document.destroy();
  }

  const text = pages.join('\n').trim();
  if (!text) {
    throw new RagInputError('This PDF has no extractable text. Scanned PDFs are not supported for chat yet.');
  }
  return text;
}

export function rankChunks(
  chunks: VectorChunk[],
  queryEmbedding: number[],
  minSimilarity = MIN_SIMILARITY,
  limit = MAX_RESULTS,
): string[] {
  if (!queryEmbedding.length || chunks.some((chunk) => chunk.embedding.length !== queryEmbedding.length)) {
    throw new OllamaError('PDF and question embeddings have different dimensions. Re-index the PDF with the configured embedding model.', 502);
  }

  return chunks
    .map((chunk) => ({ text: chunk.text, similarity: cosineSimilarity(chunk.embedding, queryEmbedding) }))
    .filter((chunk) => chunk.similarity >= minSimilarity)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, limit)
    .map((chunk) => chunk.text);
}

export async function retrievePdfContext(
  data: Uint8Array,
  question: string,
): Promise<string[]> {
  const { embedding: embeddingModel } = getOllamaModels();
  const hash = createHash('sha256').update(embeddingModel).update(data).digest('hex');
  let indexPromise = indexCache.get(hash);

  if (!indexPromise) {
    indexPromise = createIndex(embeddingModel, data);
    indexCache.set(hash, indexPromise);
    if (indexCache.size > MAX_CACHED_PDFS) {
      const oldest = indexCache.keys().next().value;
      if (oldest) indexCache.delete(oldest);
    }
  } else {
    indexCache.delete(hash);
    indexCache.set(hash, indexPromise);
  }

  let index: VectorChunk[];
  try {
    index = await indexPromise;
  } catch (error) {
    if (indexCache.get(hash) === indexPromise) indexCache.delete(hash);
    throw error;
  }

  const [queryEmbedding] = await generateOllamaEmbeddings(
    [`task: search_query\nquery: ${question}`],
    embeddingModel,
  );
  return rankChunks(index, queryEmbedding);
}

async function createIndex(embeddingModel: string, data: Uint8Array): Promise<VectorChunk[]> {
  const text = await extractPdfText(data);
  const textChunks = splitIntoChunks(text);
  const indexed: VectorChunk[] = [];

  for (let start = 0; start < textChunks.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = textChunks.slice(start, start + EMBEDDING_BATCH_SIZE);
    const embeddings = await generateOllamaEmbeddings(
      batch.map((chunk) => `task: search_document\nquery: ${chunk}`),
      embeddingModel,
    );
    indexed.push(...batch.map((chunk, index) => ({
      text: chunk,
      embedding: embeddings[index],
    })));
  }

  if (indexed.some((chunk) => chunk.embedding.length !== indexed[0]?.embedding.length)) {
    throw new OllamaError('Ollama returned PDF embeddings with inconsistent dimensions.', 502);
  }

  return indexed;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index++) {
    dotProduct += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}