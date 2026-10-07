import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  GEMINI_MODEL, MAX_FILE_BYTES, MAX_TEXT_CHARS, ALLOWED_FILE_TYPES, SUMMARY_RATE_LIMIT,
  isRateLimited, clientIp, isSameOrigin, looksLikeApiKey, reply, handleGeminiError, formString,
} from '../../lib/security';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const ALLOWED_MODES = ['normal', 'exam'];
const ALLOWED_FORMATS = ['paragraph', 'bullets', 'flashcards'];

// Optional override (not exposed in the UI). Plain language names only; anything
// else falls back to "auto" = same language as the content.
function sanitizeLanguage(raw: string): string {
  const lang = (raw || '').trim();
  return /^[A-Za-z][A-Za-z ()\-]{1,39}$/.test(lang) && lang.toLowerCase() !== 'auto' ? lang : 'auto';
}

function languageRule(language: string, outputFormat: string): string {
  const base = language === 'auto'
    ? 'LANGUAGE: First detect the language of the content (for a PDF or image, the language of the text in it). Then write the ENTIRE output — including headings, labels, bullet text and flashcards — in that same language. If the content mixes languages, use the dominant one. Never translate to English unless the content is in English.'
    : `LANGUAGE: Write the entire output in ${language}, even if the content is in a different language. Translate headings, labels and all text into ${language}.`;
  const jsonNote = outputFormat === 'flashcards'
    ? ' Keep the JSON keys "front" and "back" exactly as written in English; only the values are in the output language.'
    : ' Keep formatting markers (•, -, **) exactly as instructed.';
  return `${base}${jsonNote}`;
}

function buildPrompt(mode: string, outputFormat: string, content: string, language: string = 'auto'): string {
  return `${buildBasePrompt(mode, outputFormat, content)}\n\n${languageRule(language, outputFormat)}`;
}

function buildBasePrompt(mode: string, outputFormat: string, content: string): string {
  const baseInstructions = mode === 'exam'
    ? `You are an expert academic tutor. Analyze the content and create study-ready material.`
    : `You are an expert content summarizer. Create a clear, insightful summary.`;

  if (mode === 'exam' && outputFormat === 'flashcards') {
    return `${baseInstructions}

Create 8-12 flashcards from this content. Each flashcard should test a key concept.

Return ONLY a valid JSON array (no markdown, no code blocks, just raw JSON):
[
  {
    "front": "Question or concept to test",
    "back": "Answer or explanation"
  }
]

Content to analyze:
${content}`;
  }

  if (mode === 'exam' && outputFormat === 'bullets') {
    return `${baseInstructions}

Create comprehensive exam-ready bullet points from this content. Structure them as:
1. A brief 2-3 sentence overview
2. Key concepts as bullet points (use • for main points, use - for sub-points)
3. Important terms/definitions
4. Key takeaways for exams

Format your response with clear sections using **Section Name** for headers.

Content to analyze:
${content}`;
  }

  if (mode === 'normal' && outputFormat === 'bullets') {
    return `${baseInstructions}

Summarize this content as clear, concise bullet points. Cover:
• The main topic/purpose
• Key points and arguments  
• Important details worth remembering
• Conclusion or outcome

Use • for main points and - for sub-points. Keep it scannable and clear.

Content to analyze:
${content}`;
  }

  // Normal paragraph mode
  return `${baseInstructions}

Write a clear, well-structured summary of this content in flowing paragraphs. Include:
- An opening sentence capturing the main idea
- The key points and their significance  
- Any important details or nuances
- A brief concluding thought

Aim for 150-300 words. Write naturally and engagingly.

Content to analyze:
${content}`;
}

export async function POST(req: NextRequest) {
  try {
    if (!isSameOrigin(req)) {
      return reply({ error: 'Request blocked.' }, 403);
    }

    const formData = await req.formData();

    const str = (name: string, fallback = '') => formString(formData, name, fallback);
    const modeRaw = str('mode', 'normal');
    const formatRaw = str('outputFormat', 'paragraph');
    const mode = ALLOWED_MODES.includes(modeRaw) ? modeRaw : 'normal';
    const outputFormat = ALLOWED_FORMATS.includes(formatRaw) ? formatRaw : 'paragraph';
    const userApiKey = str('apiKey').trim();
    const language = sanitizeLanguage(str('language', 'auto'));
    const textContent = str('text');
    const fileEntry = formData.get('file');
    const file = fileEntry instanceof File ? fileEntry : null;

    // ── API key: the visitor's own key wins, otherwise the server key ──
    if (userApiKey && !looksLikeApiKey(userApiKey)) {
      return reply({ error: 'That does not look like a valid Gemini API key.' }, 400);
    }
    const usingServerKey = !userApiKey;
    const apiKey = userApiKey || process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      return reply({ error: 'No API key provided. Please add your Gemini API key.' }, 400);
    }
    if (usingServerKey && isRateLimited('summarize', clientIp(req), SUMMARY_RATE_LIMIT)) {
      return reply(
        { error: 'Too many requests with the shared key. Please wait a few minutes or add your own Gemini API key.' },
        429
      );
    }

    // ── Input limits ──
    if (textContent.length > MAX_TEXT_CHARS) {
      return reply({ error: 'Text is too long. Please shorten it or upload it as a PDF.' }, 413);
    }
    if (file && file.size > MAX_FILE_BYTES) {
      return reply({ error: 'File is too large. Maximum size is 10MB.' }, 413);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    let result;

    if (file) {
      if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        return reply({ error: 'Unsupported file type. Please upload a PDF or an image (JPG, PNG, WebP, GIF).' }, 400);
      }
      const base64Data = Buffer.from(await file.arrayBuffer()).toString('base64');
      const isPdf = file.type === 'application/pdf';
      const prompt = buildPrompt(
        mode,
        outputFormat,
        isPdf
          ? 'the provided PDF document'
          : 'the provided image — extract all text and visual information from it',
        language
      );
      result = await model.generateContent([
        prompt,
        { inlineData: { data: base64Data, mimeType: file.type } },
      ]);
    } else if (textContent.trim()) {
      result = await model.generateContent(buildPrompt(mode, outputFormat, textContent, language));
    } else {
      return reply({ error: 'Please provide text content or upload a file.' }, 400);
    }

    const responseText = result.response.text();

    // Parse flashcards if needed
    if (mode === 'exam' && outputFormat === 'flashcards') {
      try {
        const cleaned = responseText
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        return reply({ type: 'flashcards', data: JSON.parse(cleaned) });
      } catch {
        return reply({ type: 'text', data: responseText });
      }
    }

    return reply({ type: outputFormat === 'bullets' ? 'bullets' : 'text', data: responseText });
  } catch (error: unknown) {
    return handleGeminiError(error);
  }
}
