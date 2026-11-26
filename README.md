# PolyMind

PolyMind is a local multilingual study assistant built with Next.js, React, and Ollama. Chat, summaries, study notes, and PDF question answering run against models on your own computer.

## Features

- General chat with recent conversation history and multilingual prompts
- Paragraph and bullet summaries
- Exam study notes and interactive flashcards
- Text, PDF, and image upload controls
- PDF text extraction, overlapping chunks, local embeddings, and semantic retrieval for PDF chat
- Copy, download, and reset controls for generated content
- Translated interface for English, Hindi, Telugu, Tamil, Spanish, French, German, and Arabic

Multiple-choice question generation is not currently implemented.

## Requirements

- Node.js 20.9 or newer
- Ollama for Windows, running locally at `http://localhost:11434`
- The Qwen3 1.7B chat model and EmbeddingGemma embedding model

Pull the models once:

```powershell
ollama pull qwen3:1.7b
ollama pull embeddinggemma
ollama list
```

If PowerShell cannot find `ollama`, reopen the terminal or run the executable from `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`.

## Local configuration

Set these server-side values in the root `.env.local` file:

```dotenv
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=qwen3:1.7b
OLLAMA_EMBED_MODEL=embeddinggemma
```

`.env.local` is ignored by Git. Do not use `NEXT_PUBLIC_` prefixes for these settings. The application rejects non-loopback Ollama URLs so prompts and files are not sent to a remote AI service.

## Run PolyMind

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Validation

```powershell
npm run build
npx tsc --noEmit
```

There are no dedicated lint or automated test scripts in `package.json`.

## PDF question answering

PolyMind extracts text from text-based PDFs, splits it into overlapping chunks, embeds document and question text using the same configured embedding model, then retrieves the most relevant chunks for local chat. Scanned PDFs without extractable text are not supported.

## Limitations

- Image understanding requires a vision-capable Ollama chat model. A text-only model will return an explicit unsupported-image message.
- Chat model output quality and speed depend on local hardware and the selected model.
- Ollama must be running before using chat or summaries.
- Multiple-choice question generation is not implemented.

## License

MIT
