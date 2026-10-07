import { createHash } from 'node:crypto';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { MAX_TEXT_CHARS } from './security';

const EMBEDDING_MODEL = 'gemini-embedding-001';
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
  return chunks
    .map((chunk) => ({ text: chunk.text, similarity: cosineSimilarity(chunk.embedding, queryEmbedding) }))
    .filter((chunk) => chunk.similarity >= minSimilarity)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, limit)
    .map((chunk) => chunk.text);
}

export async function retrievePdfContext(
  apiKey: string,
  data: Uint8Array,
  question: string,
): Promise<string[]> {
  const hash = createHash('sha256').update(apiKey).update(data).digest('hex');
  let indexPromise = indexCache.get(hash);

  if (!indexPromise) {
    indexPromise = createIndex(apiKey, data);
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

  const embeddingModel = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: EMBEDDING_MODEL });
  const response = await embeddingModel.embedContent({
    content: { role: 'user', parts: [{ text: question }] },
    taskType: TaskType.RETRIEVAL_QUERY,
  });
  return rankChunks(index, response.embedding.values);
}

async function createIndex(apiKey: string, data: Uint8Array): Promise<VectorChunk[]> {
  const text = await extractPdfText(data);
  const textChunks = splitIntoChunks(text);
  const embeddingModel = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: EMBEDDING_MODEL });
  const indexed: VectorChunk[] = [];

  for (let start = 0; start < textChunks.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = textChunks.slice(start, start + EMBEDDING_BATCH_SIZE);
    const response = await embeddingModel.batchEmbedContents({
      requests: batch.map((chunk) => ({
        content: { role: 'user', parts: [{ text: chunk }] },
        taskType: TaskType.RETRIEVAL_DOCUMENT,
      })),
    });
    indexed.push(...batch.map((chunk, index) => ({
      text: chunk,
      embedding: response.embeddings[index].values,
    })));
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