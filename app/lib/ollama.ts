import { reply } from './security';

const REQUEST_TIMEOUT_MS = 180_000;

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

interface OllamaChatResponse {
  message?: {
    content?: unknown;
  };
}

interface OllamaEmbedResponse {
  embeddings?: unknown;
}

interface OllamaShowResponse {
  thinking?: {
    values?: unknown;
  };
}

const thinkingToggleCache = new Map<string, Promise<boolean>>();

export class OllamaError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'OllamaError';
  }
}

function ollamaBaseUrl(): string {
  const configured = process.env.OLLAMA_BASE_URL?.trim() || 'http://localhost:11434';
  let url: URL;

  try {
    url = new URL(configured);
  } catch {
    throw new OllamaError('OLLAMA_BASE_URL must be a valid local Ollama URL.', 500);
  }

  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new OllamaError('Ollama must be configured to use a local URL such as http://localhost:11434.', 500);
  }

  return url.toString().replace(/\/+$/, '');
}

export function getOllamaModels() {
  return {
    chat: process.env.OLLAMA_CHAT_MODEL?.trim() || 'qwen3:1.7b',
    embedding: process.env.OLLAMA_EMBED_MODEL?.trim() || 'embeddinggemma',
  };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${ollamaBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new OllamaError('Ollama did not respond before the local model request timed out. Try again or use a smaller model.', 504);
    }
    if (error instanceof TypeError) {
      throw new OllamaError('Cannot connect to Ollama. Start the Ollama application and try again.', 503);
    }
    throw error;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new OllamaError('Ollama returned an invalid response. Check that the local Ollama service is up to date.', 502);
  }

  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
      ? data.error
      : '';
    const model = typeof body === 'object' && body !== null && 'model' in body && typeof body.model === 'string'
      ? body.model
      : '';

    if (response.status === 404 && /model .* not found|model not found/i.test(message)) {
      throw new OllamaError(`Ollama model "${model}" is not installed. Run: ollama pull ${model}`, 503);
    }
    if (response.status === 404 && path === '/api/embed') {
      throw new OllamaError('This Ollama version does not support /api/embed. Update Ollama to a recent version and restart it.', 503);
    }
    if (/does not support.*image|image.*not supported|vision|multimodal.*does not support|does not support.*multimodal/i.test(message)) {
      throw new OllamaError('The configured Ollama chat model does not support image input. Use a local vision-capable Ollama model for image requests.', 422);
    }
    if (/requires more system memory|not enough memory|out of memory/i.test(message)) {
      throw new OllamaError('The configured Ollama model needs more memory than is currently available. Close other applications or use a smaller model.', 503);
    }

    const safeMessage = message.replace(/\s+/g, ' ').trim().slice(0, 300);
    throw new OllamaError(
      safeMessage ? `Ollama request failed (${response.status}): ${safeMessage}` : `Ollama request failed (${response.status}).`,
      response.status >= 400 && response.status < 600 ? response.status : 502,
    );
  }

  return data as T;
}

function supportsDisablingThinking(model: string): Promise<boolean> {
  const cached = thinkingToggleCache.get(model);
  if (cached) return cached;

  const request = postJson<OllamaShowResponse>('/api/show', { model })
    .then((response) =>
      Array.isArray(response.thinking?.values) && response.thinking.values.includes(false)
    )
    .catch((error: unknown) => {
      thinkingToggleCache.delete(model);
      throw error;
    });
  thinkingToggleCache.set(model, request);
  return request;
}

export async function generateOllamaChat(messages: OllamaMessage[]): Promise<string> {
  const { chat } = getOllamaModels();
  const canDisableThinking = await supportsDisablingThinking(chat);
  const response = await postJson<OllamaChatResponse>('/api/chat', {
    model: chat,
    messages,
    stream: false,
    think: !canDisableThinking,
    options: {
      num_ctx: 8192,
      num_predict: 2048,
    },
  });
  const content = response.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new OllamaError('Ollama returned an empty chat response. Please try again.', 502);
  }
  return content.trim();
}

export async function generateOllamaEmbeddings(inputs: string[], model = getOllamaModels().embedding): Promise<number[][]> {
  if (!inputs.length) return [];

  const response = await postJson<OllamaEmbedResponse>('/api/embed', {
    model,
    input: inputs,
    truncate: false,
  });
  const embeddings = response.embeddings;

  if (
    !Array.isArray(embeddings) ||
    embeddings.length !== inputs.length ||
    embeddings.some((embedding) =>
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    )
  ) {
    throw new OllamaError('Ollama returned missing or invalid embeddings. Check the configured embedding model.', 502);
  }

  const vectors = embeddings as number[][];
  const dimensions = vectors[0].length;
  if (vectors.some((embedding) => embedding.length !== dimensions)) {
    throw new OllamaError('Ollama returned embeddings with inconsistent dimensions.', 502);
  }

  return vectors;
}

export function handleOllamaError(error: unknown) {
  if (error instanceof OllamaError) {
    return reply({ error: error.message }, error.status);
  }

  console.error('Local Ollama request failed:', error instanceof Error ? error.name : 'Unknown error');
  return reply({ error: 'The local AI request failed unexpectedly. Please try again.' }, 500);
}
