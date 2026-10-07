# PolyMind — Multilingual AI Summarizer, Study & Chat

A multilingual AI app built with Next.js and Google Gemini. Summarize text, PDFs and images, study with exam notes and flashcards, or chat about your content. Everything automatically works in the language you use.

---

## ✨ Features

- **Three Input Types**: Paste text, upload a PDF, or upload an image
- **Three Modes**:
  - **Chat** — Ask questions about your text, PDF or image (or chat freely). Replies come back in the language you write in
  - **Normal** — Clean paragraph or bullet-point summaries
  - **Exam** — Study-optimized notes, structured bullets, or interactive flashcards
- **Three Output Formats**: Paragraph, Bullet Points, Flashcards (Exam mode)
- **Interactive Flashcards**: Flip cards with 3D animation, navigate through them
- **Your Own API Key**: Users can provide their own Gemini API key
- **One-Click Copy & Download**: Export your summary as a text file
- **Drag & Drop**: File uploads via drag and drop
- **Multilingual (automatic)**: Paste or upload content in any language and the summary or flashcards come back in that same language. The interface follows the browser language (English, Hindi, Telugu, Tamil, Spanish, French, German, Arabic with RTL).

---

## 🚀 Quick Start (Local)

### 1. Unzip and install

```bash
unzip ai-summarizer.zip
cd ai-summarizer
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:
```
GEMINI_API_KEY=your_gemini_api_key_here
```

Get your free Gemini API key at: https://aistudio.google.com/app/apikey

### 3. Run development server

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

---

## 🌐 Deploy to Vercel

### Option A: Vercel Dashboard (Easiest)

1. Push this project to a GitHub repository
2. Go to https://vercel.com and import the repository
3. In the Vercel dashboard, add your environment variable:
   - Key: `GEMINI_API_KEY`
   - Value: `your_gemini_api_key`
4. Click Deploy — done!

### Option B: Vercel CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

When prompted, add the `GEMINI_API_KEY` environment variable.

---

## 🔑 API Key Options

The app supports two API key modes:

1. **Default (Server-side)**: Set `GEMINI_API_KEY` in your environment. Users don't need to provide anything.
2. **User-provided**: Users can paste their own Gemini API key in the UI. This overrides the default key and is never stored.

If neither is provided, the app shows a helpful error prompting users to add their key.

---

## 📁 Project Structure

```
ai-summarizer/
├── app/
│   ├── api/
│   │   └── summarize/
│   │       └── route.ts      # API endpoint (Gemini integration)
│   ├── globals.css            # Global styles + animations
│   ├── layout.tsx             # Root layout
│   └── page.tsx               # Main UI page
├── .env.example               # Example environment file
├── next.config.js             # Next.js config
├── package.json               # Dependencies
├── tailwind.config.js         # Tailwind CSS config
├── tsconfig.json              # TypeScript config
└── vercel.json                # Vercel deployment config
```

---

## 🛠️ Tech Stack

- **Framework**: Next.js 14 (App Router)
- **AI**: Google Gemini 1.5 Flash (via `@google/generative-ai`)
- **Styling**: Tailwind CSS + custom CSS animations
- **File Uploads**: react-dropzone
- **Notifications**: react-hot-toast
- **Icons**: lucide-react
- **Language**: TypeScript

---

## 📝 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Optional* | Your Google Gemini API key. Users can also provide their own in the UI. |

*If not set, users must provide their own API key through the UI.

---

## 🎨 Customization

- **Brand name**: Edit the `h1` in `app/page.tsx`
- **Default model**: Change `gemini-3.1-flash-lite` in `app/api/summarize/route.ts`
- **Colors**: Edit `tailwind.config.js` and CSS variables in `globals.css`
- **Prompts**: Customize `buildPrompt()` in `app/api/summarize/route.ts`

---

## 🐛 Troubleshooting

**"No API key provided"** — Add `GEMINI_API_KEY` to your `.env.local` or enter a key in the UI

**"Invalid API key"** — Verify your key at https://aistudio.google.com/app/apikey

**PDF not working** — Ensure the PDF is under 10MB and not password-protected

**Build errors** — Run `npm install` again, ensure Node.js 18+ is installed

---

## 📄 License

MIT License — free to use, modify, and deploy commercially.


## Security

- **Server key stays on the server.** Set `GEMINI_API_KEY` in Vercel → Project → Settings → Environment Variables (or in `.env.local` locally). Never prefix it with `NEXT_PUBLIC_` and never commit it. `.env*.local` is already in `.gitignore`.
- **Visitors can use their own key.** It is held only in the page's memory, sent once over HTTPS in the request body, validated, used for that single request and never stored or logged on the server.
- **Shared key is protected.** Requests that use your server key are rate limited per IP (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MINUTES`, default 10 per 10 minutes). Visitors with their own key are not limited.
- **Input limits.** Max 10MB files (PDF, JPG, PNG, WebP, GIF only) and 100,000 characters of text.
- **Same-origin only.** Other websites cannot call the API from a visitor's browser.
- **Hardened responses.** Security headers (CSP, no framing, no sniffing, HSTS), no-store caching on the API, and generic error messages that never expose internals.
- **Recommended in Google AI Studio / Cloud Console:** restrict the key to the Generative Language API and set a daily quota/budget alert. If a key was ever pasted somewhere public, delete it and create a new one.

## Requirements and updating

- **Node.js 20.9 or newer** (Next.js 16). Check with `node -v`.
- Dependencies are kept free of known vulnerabilities (`npm audit` reports 0). Unused packages were removed. To check again at any time run `npm audit`.
- The app name lives in one file: `app/lib/brand.ts`.
