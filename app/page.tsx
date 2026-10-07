'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import {
  FileText, Image, Type, Zap, BookOpen, ChevronRight,
  Copy, Download, RotateCcw, Key, Eye, EyeOff,
  Sparkles, GraduationCap, AlignLeft, List, CreditCard,
  X, Upload, ChevronLeft, ChevronRight as ChevronRightIcon,
  Check, Loader2, MessageCircle, SendHorizontal
} from 'lucide-react';
import { TRANSLATIONS, UI_LANGUAGES, fmt, type UiLang } from './i18n';
import { APP_NAME_PARTS } from './lib/brand';

type Mode = 'normal' | 'exam' | 'chat';
type OutputFormat = 'paragraph' | 'bullets' | 'flashcards';
type InputType = 'text' | 'pdf' | 'image';

interface Flashcard {
  front: string;
  back: string;
}

interface ChatMsg {
  role: 'user' | 'model';
  content: string;
}

interface SummaryResult {
  type: 'text' | 'bullets' | 'flashcards';
  data: string | Flashcard[];
}

export default function Home() {
  const [mode, setMode] = useState<Mode>('normal');
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('paragraph');
  const [inputType, setInputType] = useState<InputType>('text');
  const [textInput, setTextInput] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [currentCard, setCurrentCard] = useState(0);
  const [flippedCards, setFlippedCards] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Chat ────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isChatLoading]);

  // ── Multilingual ────────────────────────────────────────────────
  // No language pickers: the interface follows the browser's language and the
  // summary is always written in the same language as the content provided.
  const [uiLang, setUiLang] = useState<UiLang>('en');
  const t = TRANSLATIONS[uiLang];
  const uiDir = UI_LANGUAGES.find((l) => l.code === uiLang)?.dir ?? 'ltr';

  useEffect(() => {
    const browser = (navigator.language || 'en').slice(0, 2).toLowerCase() as UiLang;
    if (browser in TRANSLATIONS) setUiLang(browser);
  }, []);

  // Keep <html lang> and <html dir> in sync (accessibility + RTL layout)
  useEffect(() => {
    document.documentElement.lang = uiLang;
    document.documentElement.dir = uiDir;
  }, [uiLang, uiDir]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      setUploadedFile(file);
      toast.success(fmt(t.toastFileLoaded, { name: file.name }));
    }
  }, [t.toastFileLoaded]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: inputType === 'pdf'
      ? { 'application/pdf': ['.pdf'] }
      : { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif'] },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    onDropRejected: (fileRejections) => {
      const reason = fileRejections[0]?.errors[0]?.message || 'File rejected';
      toast.error(reason);
    },
  });

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    if (newMode !== 'exam' && outputFormat === 'flashcards') {
      setOutputFormat('paragraph');
    }
    setResult(null);
  };

  const handleSummarize = async () => {
    if (!textInput.trim() && !uploadedFile) {
      toast.error(t.toastAddContent);
      return;
    }

    setIsLoading(true);
    setResult(null);
    setFlippedCards(new Set());
    setCurrentCard(0);

    try {
      const formData = new FormData();
      formData.append('mode', mode);
      formData.append('outputFormat', outputFormat);
      formData.append('apiKey', apiKey);

      if (uploadedFile && inputType !== 'text') {
        formData.append('file', uploadedFile);
      } else {
        formData.append('text', textInput);
      }

      const response = await fetch('/api/summarize', {
        method: 'POST',
        body: formData,
        cache: 'no-store',
        credentials: 'same-origin',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to summarize');
      }

      setResult(data);
      toast.success(t.toastSummaryReady);
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(err.message || t.toastWrong);
    } finally {
      setIsLoading(false);
    }
  };

  const hasFileContext = Boolean(uploadedFile && inputType !== 'text');
  const hasTextContext = !hasFileContext && textInput.trim().length > 0;

  const sendChat = async (override?: string) => {
    const content = (override ?? chatInput).trim();
    if (!content || isChatLoading) return;

    const next: ChatMsg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const formData = new FormData();
      formData.append('messages', JSON.stringify(next.slice(-20)));
      formData.append('apiKey', apiKey);
      if (hasFileContext && uploadedFile) {
        formData.append('file', uploadedFile);
      } else if (hasTextContext) {
        formData.append('text', textInput);
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        body: formData,
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t.toastWrong);

      setMessages((m) => [...m, { role: 'model', content: String(data.reply || '') }]);
    } catch (error: unknown) {
      // Put the message back so the user can retry
      setMessages(messages);
      setChatInput(content);
      const err = error as { message?: string };
      toast.error(err.message || t.toastWrong);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Renders a chat reply: bullets and **bold** only, no raw HTML.
  const renderChatText = (text: string) =>
    text.split('\n').filter((l) => l.trim()).map((line, i) => {
      const trimmed = line.trim();
      const isBullet = /^[•\-\*]\s+/.test(trimmed);
      const body = isBullet ? trimmed.replace(/^[•\-\*]\s+/, '') : trimmed;
      const parts = body.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4
          ? <strong key={j} className="font-semibold text-white">{part.slice(2, -2)}</strong>
          : <span key={j}>{part}</span>
      );
      return isBullet ? (
        <div key={i} className="flex gap-2.5">
          <span className="mt-1 shrink-0 text-xs" style={{ color: modeColor }}>▸</span>
          <p dir="auto" className="text-[15px] leading-relaxed text-white/85">{parts}</p>
        </div>
      ) : (
        <p key={i} dir="auto" className="text-[15px] leading-relaxed text-white/85">{parts}</p>
      );
    });

  const handleCopy = async () => {
    let text = '';
    if (result?.type === 'flashcards') {
      const cards = result.data as Flashcard[];
      text = cards.map((c, i) => `${t.cardLabel} ${i + 1}\n${t.question}: ${c.front}\n${t.answer}: ${c.back}`).join('\n\n');
    } else {
      text = result?.data as string || '';
    }
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success(t.toastCopied);
  };

  const handleDownload = () => {
    let text = '';
    let filename = 'summary.txt';

    if (result?.type === 'flashcards') {
      const cards = result.data as Flashcard[];
      text = `${t.fcTitle}\n${'='.repeat(40)}\n\n` +
        cards.map((c, i) => `${t.cardLabel} ${i + 1}\n${t.question}: ${c.front}\n${t.answer}: ${c.back}`).join('\n\n---\n\n');
      filename = 'flashcards.txt';
    } else {
      text = result?.data as string || '';
      filename = mode === 'exam' ? 'exam-notes.txt' : 'summary.txt';
    }

    const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t.toastDownloaded);
  };

  const handleReset = () => {
    setResult(null);
    setTextInput('');
    setUploadedFile(null);
    setFlippedCards(new Set());
    setCurrentCard(0);
  };

  const toggleCard = (index: number) => {
    setFlippedCards(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const modeColor = mode === 'exam' ? '#00D4AA' : mode === 'chat' ? '#8B7CFF' : '#F5C842';
  const modeGlow = mode === 'exam' ? 'rgba(0,212,170,0.2)' : mode === 'chat' ? 'rgba(139,124,255,0.2)' : 'rgba(245,200,66,0.2)';

  const renderResult = () => {
    if (!result) return null;

    if (result.type === 'flashcards') {
      const cards = result.data as Flashcard[];
      return (
        <div className="space-y-6">
          {/* Card navigation */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-mono" style={{ color: modeColor }}>
              {fmt(t.cardsOf, { a: currentCard + 1, b: cards.length })}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentCard(Math.max(0, currentCard - 1))}
                disabled={currentCard === 0}
                className="p-2 rounded-lg transition-all disabled:opacity-30"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setCurrentCard(Math.min(cards.length - 1, currentCard + 1))}
                disabled={currentCard === cards.length - 1}
                className="p-2 rounded-lg transition-all disabled:opacity-30"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <ChevronRightIcon size={16} />
              </button>
            </div>
          </div>

          {/* Current flashcard */}
          <div className="flashcard-scene" style={{ height: '240px' }}>
            <div
              className={`flashcard-card w-full h-full ${flippedCards.has(currentCard) ? 'flipped' : ''}`}
              onClick={() => toggleCard(currentCard)}
            >
              {/* Front */}
              <div
                className="flashcard-face"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: `1px solid ${modeColor}30`,
                }}
              >
                <div className="text-xs font-mono mb-3 opacity-40 uppercase tracking-wider">{t.question}</div>
                <p dir="auto" className="text-center text-lg font-display font-medium leading-relaxed">
                  {cards[currentCard]?.front}
                </p>
                <div className="mt-4 text-xs opacity-30">{t.tapReveal}</div>
              </div>
              {/* Back */}
              <div
                className="flashcard-face flashcard-back"
                style={{
                  background: `${modeColor}10`,
                  border: `1px solid ${modeColor}40`,
                }}
              >
                <div className="text-xs font-mono mb-3 opacity-60 uppercase tracking-wider" style={{ color: modeColor }}>{t.answer}</div>
                <p dir="auto" className="text-center text-base leading-relaxed">
                  {cards[currentCard]?.back}
                </p>
                <div className="mt-4 text-xs opacity-30">{t.tapBack}</div>
              </div>
            </div>
          </div>

          {/* All cards grid */}
          <div className="mt-8">
            <p className="text-xs font-mono opacity-40 uppercase tracking-wider mb-4">{t.allCards}</p>
            <div className="grid gap-3">
              {cards.map((card, i) => (
                <div
                  key={i}
                  className="flashcard-scene cursor-pointer"
                  style={{ height: '120px' }}
                  onClick={() => {
                    setCurrentCard(i);
                    toggleCard(i);
                  }}
                >
                  <div className={`flashcard-card w-full h-full ${flippedCards.has(i) ? 'flipped' : ''}`}>
                    <div
                      className="flashcard-face rounded-xl"
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: `1px solid rgba(255,255,255,0.07)`,
                      }}
                    >
                      <span className="text-xs font-mono opacity-30 mb-2">Q{i + 1}</span>
                      <p dir="auto" className="text-center text-sm">{card.front}</p>
                    </div>
                    <div
                      className="flashcard-face flashcard-back rounded-xl"
                      style={{
                        background: `${modeColor}08`,
                        border: `1px solid ${modeColor}25`,
                      }}
                    >
                      <span className="text-xs font-mono opacity-40 mb-2" style={{ color: modeColor }}>A{i + 1}</span>
                      <p dir="auto" className="text-center text-sm">{card.back}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // Text / bullets output
    const text = result.data as string;
    const lines = text.split('\n').filter(l => l.trim());

    return (
      <div className="output-content space-y-2">
        {lines.map((line, i) => {
          const isBullet = line.trim().startsWith('•') || line.trim().startsWith('-') || line.trim().startsWith('*');
          const isHeader = line.trim().startsWith('**') && line.trim().endsWith('**');
          const isSubBullet = line.trim().startsWith('-') || line.trim().startsWith('  ');

          if (isHeader) {
            const headerText = line.replace(/\*\*/g, '').trim();
            return (
              <h3 key={i} dir="auto" className="font-display font-semibold text-base mt-6 mb-2 first:mt-0" style={{ color: modeColor }}>
                {headerText}
              </h3>
            );
          }

          if (isBullet || isSubBullet) {
            const bulletText = line.replace(/^[•\-\*]\s*/, '').trim();
            return (
              <div key={i} className={`flex gap-3 ${isSubBullet && !isBullet ? 'ml-4' : ''}`}>
                <span className="mt-1 shrink-0 text-xs" style={{ color: modeColor }}>▸</span>
                <p dir="auto" className="text-[15px] leading-relaxed text-white/85">{bulletText}</p>
              </div>
            );
          }

          return (
            <p key={i} dir="auto" className="text-[15px] leading-relaxed text-white/85">
              {line}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen" style={{ background: '#0A0A0F' }}>
      {/* Background gradient blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full opacity-[0.06]"
          style={{ background: `radial-gradient(circle, ${modeColor}, transparent)`, transition: 'background 0.5s' }}
        />
        <div
          className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full opacity-[0.04]"
          style={{ background: `radial-gradient(circle, ${modeColor}, transparent)`, transition: 'background 0.5s' }}
        />
        <div className="absolute top-[40%] left-[50%] w-[300px] h-[300px] rounded-full opacity-[0.03]"
          style={{ background: 'radial-gradient(circle, #FF4D6D, transparent)' }}
        />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 py-8 md:py-12">
        {/* Header */}
        <div className="text-center mb-12 animate-slide-up">
          <h1 className="text-5xl md:text-7xl font-display font-bold tracking-tight mb-3">
            <span className="text-white">{APP_NAME_PARTS[0]}</span>
            <span style={{ color: modeColor, textShadow: `0 0 40px ${modeGlow}`, transition: 'color 0.4s, text-shadow 0.4s' }}>{APP_NAME_PARTS[1]}</span>
          </h1>
          <p className="text-white/40 text-lg max-w-md mx-auto font-body">
            {t.tagline}
          </p>
        </div>

        {/* Mode Toggle */}
        <div className="flex justify-center mb-8">
          <div className="relative flex p-1 rounded-2xl gap-1" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            {[
              { id: 'normal', label: t.normal, icon: Sparkles, desc: t.normalDesc },
              { id: 'exam', label: t.exam, icon: GraduationCap, desc: t.examDesc },
              { id: 'chat', label: t.chat, icon: MessageCircle, desc: t.chatDesc },
            ].map(({ id, label, icon: Icon, desc }) => (
              <button
                key={id}
                onClick={() => handleModeChange(id as Mode)}
                className="relative flex items-center gap-2.5 px-4 sm:px-6 py-3 rounded-xl transition-all duration-300 group"
                style={mode === id ? {
                  background: `${modeColor}15`,
                  boxShadow: `0 0 20px ${modeColor}20`,
                  border: `1px solid ${modeColor}40`,
                } : { border: '1px solid transparent' }}
              >
                <Icon size={15} style={{ color: mode === id ? modeColor : 'rgba(255,255,255,0.4)', transition: 'color 0.3s' }} />
                <div className="text-left">
                  <div className="text-sm font-display font-semibold" style={{ color: mode === id ? modeColor : 'rgba(255,255,255,0.7)', transition: 'color 0.3s' }}>
                    {label}
                  </div>
                  <div className="text-xs opacity-50 hidden md:block">{desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* LEFT COLUMN: Input */}
          <div className="space-y-4">
            {mode === 'chat' && (
              <p className="text-xs font-mono uppercase tracking-wider text-white/30">{t.contextLabel}</p>
            )}
            {/* Input Type Selector */}
            <div className="flex gap-2">
              {[
                { id: 'text', label: t.text, icon: Type },
                { id: 'pdf', label: t.pdf, icon: FileText },
                { id: 'image', label: t.image, icon: Image },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => { setInputType(id as InputType); setUploadedFile(null); }}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all duration-200"
                  style={inputType === id ? {
                    background: `${modeColor}15`,
                    border: `1px solid ${modeColor}50`,
                    color: modeColor,
                  } : {
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    color: 'rgba(255,255,255,0.5)',
                  }}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>

            {/* Input Area */}
            <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              {inputType === 'text' ? (
                <textarea
                  ref={textareaRef}
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={t.textPlaceholder}
                  dir="auto"
                  className="w-full min-h-[280px] p-4 text-sm leading-relaxed resize-none outline-none text-white/80 placeholder:text-white/20 font-body"
                  style={{ background: 'rgba(255,255,255,0.02)' }}
                />
              ) : (
                <div
                  {...getRootProps()}
                  className="min-h-[280px] flex flex-col items-center justify-center p-8 cursor-pointer transition-all duration-200"
                  style={{
                    background: isDragActive ? `${modeColor}08` : 'rgba(255,255,255,0.02)',
                    border: isDragActive ? `2px dashed ${modeColor}60` : '2px dashed rgba(255,255,255,0.08)',
                  }}
                >
                  <input {...getInputProps()} />
                  {uploadedFile ? (
                    <div className="text-center">
                      <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ background: `${modeColor}15` }}>
                        {inputType === 'pdf' ? <FileText size={24} style={{ color: modeColor }} /> : <Image size={24} style={{ color: modeColor }} />}
                      </div>
                      <p className="font-display font-semibold text-white/80 mb-1">{uploadedFile.name}</p>
                      <p className="text-xs text-white/30">{(uploadedFile.size / 1024).toFixed(1)} KB</p>
                      <button
                        onClick={(e) => { e.stopPropagation(); setUploadedFile(null); }}
                        className="mt-3 text-xs text-white/30 hover:text-white/60 flex items-center gap-1 mx-auto transition-colors"
                      >
                        <X size={12} /> {t.remove}
                      </button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)' }}>
                        <Upload size={24} className="text-white/20" />
                      </div>
                      <p className="font-display font-semibold text-white/50 mb-1">
                        {isDragActive ? t.dropHere : fmt(t.dropYour, { type: inputType === 'pdf' ? t.pdf : t.image })}
                      </p>
                      <p className="text-xs text-white/25">{t.orBrowse}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Output Format */}
            {mode !== 'chat' && (
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-white/30 mb-2">{t.outputFormat}</p>
              <div className="flex gap-2">
                {[
                  { id: 'paragraph', label: t.paragraph, icon: AlignLeft },
                  { id: 'bullets', label: t.bullets, icon: List },
                  ...(mode === 'exam' ? [{ id: 'flashcards', label: t.flashcards, icon: CreditCard }] : []),
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setOutputFormat(id as OutputFormat)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-all duration-200"
                    style={outputFormat === id ? {
                      background: `${modeColor}15`,
                      border: `1px solid ${modeColor}50`,
                      color: modeColor,
                    } : {
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      color: 'rgba(255,255,255,0.5)',
                    }}
                  >
                    <Icon size={14} />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </div>
            </div>
            )}

            {/* API Key */}
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-white/30 mb-2 flex items-center gap-1.5">
                <Key size={10} /> {t.apiKey}
              </p>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  name="gemini-key"
                  maxLength={200}
                  placeholder={t.apiKeyPlaceholder}
                  className="w-full px-4 py-3 pr-12 rounded-xl text-sm outline-none text-white/70 placeholder:text-white/20 font-mono"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.07)',
                  }}
                />
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                >
                  {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="text-[11px] text-white/20 mt-1.5 flex items-center gap-1">
                <span>{t.getKeyAt}</span>
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer"
                  className="underline hover:text-white/40 transition-colors" style={{ color: modeColor + '80' }}>
                  aistudio.google.com
                </a>
              </p>
              <p className="text-[11px] text-white/20 mt-1">{t.keyNote}</p>
            </div>

            {/* Summarize Button */}
            {mode !== 'chat' && (
            <button
              onClick={handleSummarize}
              disabled={isLoading}
              className="w-full py-4 rounded-2xl font-display font-semibold text-base tracking-wide transition-all duration-300 relative overflow-hidden group"
              style={{
                background: isLoading ? 'rgba(255,255,255,0.05)' : modeColor,
                color: isLoading ? 'rgba(255,255,255,0.4)' : '#0A0A0F',
                boxShadow: isLoading ? 'none' : `0 8px 32px ${modeGlow}`,
                border: isLoading ? '1px solid rgba(255,255,255,0.07)' : 'none',
              }}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={18} className="animate-spin" />
                  {t.analyzing}
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Zap size={18} />
                  {t.summarizeNow}
                  <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </span>
              )}
            </button>
            )}
          </div>

          {/* RIGHT COLUMN: Output or Chat */}
          <div>
            {mode === 'chat' ? (
              <div
                className="rounded-2xl overflow-hidden h-full min-h-[520px] flex flex-col"
                style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${modeColor}25`, transition: 'border-color 0.4s' }}
              >
                {/* Chat header */}
                <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: modeColor }} />
                    <span className="text-xs font-mono uppercase tracking-wider text-white/30">{t.chatTitle}</span>
                  </div>
                  {messages.length > 0 && (
                    <button
                      onClick={() => { setMessages([]); setChatInput(''); }}
                      className="p-2 rounded-lg transition-all text-white/40 hover:text-white/70"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                      title={t.reset}
                      aria-label={t.reset}
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>

                {/* What the chat is using */}
                <div className="px-5 py-2 text-xs text-white/35" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  {hasFileContext && uploadedFile
                    ? fmt(t.chatUsingFile, { name: uploadedFile.name })
                    : hasTextContext
                      ? t.chatUsingText
                      : t.chatNoContext}
                </div>

                {/* Messages */}
                <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-5 space-y-4" style={{ maxHeight: '520px' }} aria-live="polite">
                  {messages.length === 0 && !isChatLoading ? (
                    <div className="h-full min-h-[260px] flex flex-col items-center justify-center gap-4 text-center">
                      <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: `${modeColor}12`, border: `1px solid ${modeColor}30` }}>
                        <MessageCircle size={26} style={{ color: modeColor }} />
                      </div>
                      <div>
                        <p className="font-display font-semibold text-white/50 mb-1.5">{t.chatEmptyTitle}</p>
                        <p className="text-xs text-white/25 max-w-[260px]">{t.chatEmptyHint}</p>
                      </div>
                      <div className="flex flex-wrap justify-center gap-2 max-w-sm">
                        {t.chatSuggestions.map((sug) => (
                          <button
                            key={sug}
                            onClick={() => sendChat(sug)}
                            className="px-3 py-1.5 rounded-full text-xs transition-all"
                            style={{ background: `${modeColor}10`, border: `1px solid ${modeColor}30`, color: modeColor }}
                          >
                            {sug}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    messages.map((m, i) => (
                      <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className="max-w-[88%] px-4 py-3 rounded-2xl space-y-1.5"
                          style={m.role === 'user'
                            ? { background: `${modeColor}18`, border: `1px solid ${modeColor}35` }
                            : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                        >
                          {m.role === 'user'
                            ? <p dir="auto" className="text-[15px] leading-relaxed text-white/90 whitespace-pre-wrap">{m.content}</p>
                            : renderChatText(m.content)}
                        </div>
                      </div>
                    ))
                  )}
                  {isChatLoading && (
                    <div className="flex justify-start">
                      <div className="px-4 py-3 rounded-2xl flex gap-1.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        {[0, 1, 2].map((d) => (
                          <span key={d} className="w-1.5 h-1.5 rounded-full animate-pulse-slow" style={{ background: modeColor, animationDelay: `${d * 0.25}s` }} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Message box */}
                <div className="p-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex items-end gap-2 rounded-2xl p-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <textarea
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        // isComposing: don't send while an Indic/CJK input method is still composing
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          sendChat();
                        }
                      }}
                      placeholder={t.chatPlaceholder}
                      aria-label={t.chatPlaceholder}
                      dir="auto"
                      rows={1}
                      maxLength={4000}
                      className="flex-1 resize-none bg-transparent outline-none px-2 py-2 text-sm text-white/85 placeholder:text-white/25 font-body max-h-32"
                    />
                    <button
                      onClick={() => sendChat()}
                      disabled={isChatLoading || !chatInput.trim()}
                      aria-label={t.send}
                      title={t.send}
                      className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all"
                      style={{
                        background: isChatLoading || !chatInput.trim() ? 'rgba(255,255,255,0.06)' : modeColor,
                        color: isChatLoading || !chatInput.trim() ? 'rgba(255,255,255,0.3)' : '#0A0A0F',
                      }}
                    >
                      {isChatLoading ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
            <div
              className="rounded-2xl overflow-hidden h-full min-h-[520px] flex flex-col"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: result ? `1px solid ${modeColor}25` : '1px solid rgba(255,255,255,0.06)',
                transition: 'border-color 0.4s',
              }}
            >
              {/* Output Header */}
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: result ? modeColor : 'rgba(255,255,255,0.15)', transition: 'background 0.3s' }} />
                  <span className="text-xs font-mono uppercase tracking-wider text-white/30">
                    {result ? (
                      result.type === 'flashcards' ? fmt(t.flashcardsCount, { n: (result.data as Flashcard[]).length }) :
                      result.type === 'bullets' ? t.bulletSummary : t.summary
                    ) : t.output}
                  </span>
                </div>
                {result && (
                  <div className="flex gap-1.5">
                    <button
                      onClick={handleCopy}
                      className="p-2 rounded-lg transition-all text-white/40 hover:text-white/70"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                      title={t.copy}
                    >
                      {copied ? <Check size={14} style={{ color: modeColor }} /> : <Copy size={14} />}
                    </button>
                    <button
                      onClick={handleDownload}
                      className="p-2 rounded-lg transition-all text-white/40 hover:text-white/70"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                      title={t.download}
                    >
                      <Download size={14} />
                    </button>
                    <button
                      onClick={handleReset}
                      className="p-2 rounded-lg transition-all text-white/40 hover:text-white/70"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                      title={t.reset}
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Output Body */}
              <div className="flex-1 p-5 overflow-y-auto">
                {isLoading ? (
                  <div className="h-full flex flex-col items-center justify-center gap-6">
                    <div className="relative">
                      <div className="w-16 h-16 rounded-full" style={{ border: `2px solid ${modeColor}20` }} />
                      <div
                        className="absolute inset-0 rounded-full"
                        style={{
                          border: `2px solid ${modeColor}`,
                          borderTopColor: 'transparent',
                          animation: 'spin 1s linear infinite',
                        }}
                      />
                    </div>
                    <div className="text-center">
                      <p className="font-display font-semibold text-white/60 mb-1">{t.processing}</p>
                      <p className="text-xs text-white/25 font-mono">
                        {outputFormat === 'flashcards' ? t.creatingCards :
                         mode === 'exam' ? t.generatingNotes : t.summarizingContent}
                      </p>
                    </div>
                    <div className="w-48 space-y-2">
                      {[1, 0.7, 0.5].map((opacity, i) => (
                        <div key={i} className="h-2 rounded-full shimmer" style={{ opacity, background: 'rgba(255,255,255,0.08)' }} />
                      ))}
                    </div>
                  </div>
                ) : result ? (
                  <div className="animate-fade-in">
                    {/* Mode badge */}
                    <div className="flex items-center gap-2 mb-5">
                      <span className="text-xs px-2.5 py-1 rounded-full font-mono tracking-wider"
                        style={{ background: `${modeColor}15`, color: modeColor, border: `1px solid ${modeColor}30` }}>
                        {mode === 'exam' ? t.examMode : t.normalMode}
                      </span>
                      {outputFormat !== 'paragraph' && (
                        <span className="text-xs px-2.5 py-1 rounded-full font-mono tracking-wider"
                          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}>
                          {outputFormat === 'flashcards' ? `🃏 ${t.flashcards}` : `• ${t.bullets}`}
                        </span>
                      )}
                    </div>
                    {renderResult()}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
                    <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      {mode === 'exam' ? (
                        <BookOpen size={28} className="text-white/15" />
                      ) : (
                        <AlignLeft size={28} className="text-white/15" />
                      )}
                    </div>
                    <div>
                      <p className="font-display font-semibold text-white/25 mb-1.5">{t.emptyTitle}</p>
                      <p className="text-xs text-white/15 max-w-[200px]">
                        {mode === 'exam'
                          ? t.emptyExam
                          : t.emptyNormal}
                      </p>
                    </div>
                    <div className="flex gap-1 mt-2">
                      {[modeColor + '40', modeColor + '25', modeColor + '15'].map((color, i) => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse-slow" style={{ background: color, animationDelay: `${i * 0.3}s` }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-10 text-center">
          <p className="text-xs text-white/15 font-mono">
            {t.footer}
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
