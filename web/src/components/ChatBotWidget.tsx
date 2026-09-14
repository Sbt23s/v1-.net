import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { Volume2, VolumeX, Mic, Square, Send, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  getChatbotConfig,
  sendChat,
  fetchTtsUrl,
  transcribeAudio,
  LANGUAGES,
  type Lang,
  type ChatbotConfig,
  type ChatTurn
} from "@/lib/chatbot";
import toast from "react-hot-toast";

interface Message {
  id: string;
  sender: "user" | "bot";
  text: string;
  timestamp: Date;
}

const WELCOME_KEY = "hrp.chatbot.welcomed";

// ---- localized copy -------------------------------------------------------

/**
 * The topics the greeting offers, each with the module it belongs to.
 *
 * The greeting used to name leave, attendance, payslips and assets whatever the
 * company had switched on, so it invited questions about pages that were not
 * there — and the first thing the assistant did was contradict itself.
 */
const GREETING_TOPICS: { module: string; en: string; ta: string }[] = [
  { module: "LEAVE", en: "leave", ta: "விடுப்பு" },
  { module: "ATTENDANCE", en: "attendance", ta: "வருகை" },
  { module: "PAYROLL", en: "payslips", ta: "சம்பளம்" },
  { module: "ASSETS", en: "assets", ta: "சொத்துக்கள்" }
];

/** Joins a list the way a person would: "a, b and c". */
function listOut(items: string[], and: string): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

function greeting(lang: Lang, hasModule: (code: string) => boolean): string {
  const topics = GREETING_TOPICS.filter((t) => hasModule(t.module));

  if (lang === "ta") {
    const named = listOut(topics.map((t) => t.ta), "மற்றும்");
    // With nothing switched on, ask the open question rather than naming
    // subjects that would only lead somewhere empty.
    return named
      ? `வணக்கம்! நான் உங்கள் Pixous HR உதவியாளர் 🤖 — ${named} அல்லது போர்ட்டல் பற்றி எதையும் கேளுங்கள். தட்டச்சு செய்யலாம் அல்லது பேச மைக்கை அழுத்தவும்.`
      : "வணக்கம்! நான் உங்கள் Pixous HR உதவியாளர் 🤖 — போர்ட்டல் பற்றி எதையும் கேளுங்கள். தட்டச்சு செய்யலாம் அல்லது பேச மைக்கை அழுத்தவும்.";
  }

  const named = listOut(topics.map((t) => t.en), "and");
  return named
    ? `Hi! I'm your Pixous HR Assistant 🤖 — ask me about ${named}, or anything about the portal. You can type or tap the mic to talk.`
    : "Hi! I'm your Pixous HR Assistant 🤖 — ask me anything about the portal. You can type or tap the mic to talk.";
}

const welcomeText = (lang: Lang, name: string): string => {
  const who = name ? `, ${name}` : "";
  switch (lang) {
    case "ta":
      return `வரவேற்பு${who}! 🎉 உங்கள் Dashboard-க்கு வரவேற்கிறோம். இன்று உங்களுக்கு நான் எப்படி உதவட்டும்? விடுப்பு, வருகை அல்லது சம்பளம் பற்றி கேளுங்கள்.`;
    default:
      return `Welcome${who}! 🎉 Great to see you on your dashboard. How can I help today — leave, attendance, payslips or something else?`;
  }
};

/**
 * Starter questions, each tied to the module that can answer it.
 *
 * Offering "Where are my payslips?" with payroll switched off invites the one
 * question the assistant has to refuse — and it is the assistant's own prompt
 * that led there.
 */
const SUGGESTIONS: { module: string; en: string; ta: string }[] = [
  { module: "LEAVE", en: "How do I apply for leave?", ta: "விடுப்புக்கு எப்படி விண்ணப்பிப்பது?" },
  { module: "ATTENDANCE", en: "How do I punch attendance?", ta: "வருகையை எப்படி பதிவு செய்வது?" },
  { module: "PAYROLL", en: "Where are my payslips?", ta: "என் பேஸ்லிப் எங்கே?" }
];

/**
 * Starter questions for HR and administrators.
 *
 * The employee list above is the wrong opening for someone who approves leave
 * rather than requests it: a CTO shown "How do I apply for leave?" learns
 * nothing about what the assistant can actually do for them. These ask the
 * questions their role does ask, and the last one demonstrates the part that is
 * easy to miss -- that naming a person returns that person's real records.
 *
 * Not module-gated. Unlike the employee prompts, these track the viewer's
 * authority rather than a switched-on module, and the same privilege test runs
 * server-side before any of it is answered.
 */
const ADMIN_SUGGESTIONS: { en: string; ta: string }[] = [
  { en: "Who is absent today?", ta: "இன்று யார் வரலை?" },
  { en: "Which leave requests are pending my approval?", ta: "என் அனுமதிக்காக காதிருக்கும் விடுப்புகள்?" },
  { en: "Show open support tickets and complaints", ta: "நிலுவையில் உள்ள ஆதரவு கோரிக்கைகள்" },
  { en: "Type an employee name for their attendance and leave", ta: "ஒரு பணியாளர் பெயரைட்டால் அவர் விவரம் வரும்" }
];

const PLACEHOLDER: Record<Lang, string> = {
  en: "Type your message…",
  ta: "தமிழில் தட்டச்சு செய்யவும்…"
};

const ERROR_TEXT: Record<Lang, string> = {
  en: "Sorry, I couldn't reach the assistant just now. Please try again in a moment.",
  ta: "மன்னிக்கவும், உதவியாளரை இப்போது அணுக முடியவில்லை. சிறிது நேரத்தில் மீண்டும் முயற்சிக்கவும்."
};

// ---- speech helpers -------------------------------------------------------

function cleanForSpeech(text: string): string {
  return text
    .replace(/[*#_`~>|]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(
      /([☀-➿]|[-]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDFFF])/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

const SPEECH_LANG: Record<Lang, string> = { en: "en-US", ta: "ta-IN" };

function pickVoice(lang: Lang): SpeechSynthesisVoice | null {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const target = SPEECH_LANG[lang].toLowerCase();
  const base = lang;
  return (
    voices.find((v) => v.lang.toLowerCase() === target) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base)) ||
    (lang === "en"
      ? voices.find((v) => v.lang.toLowerCase().startsWith("en")) ?? null
      : null)
  );
}

function unlockAudio() {
  try {
    const silentPlay = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAAAD");
    silentPlay.volume = 0;
    silentPlay.play().catch((e) => console.debug("Audio unlock failed or already unlocked", e));
  } catch (e) {
    console.warn("Audio unlock helper error", e);
  }
}

// ---- polished bot avatar --------------------------------------------------

function BotAvatar({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="botGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22C55E" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill="url(#botGrad)" />
      {/* antenna */}
      <line x1="24" y1="8" x2="24" y2="13" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="7" r="2.2" fill="#fff" />
      {/* head */}
      <rect x="12" y="13" width="24" height="19" rx="6" fill="#fff" />
      {/* eyes */}
      <circle cx="19.5" cy="22" r="2.6" fill="#15803D">
        <animate attributeName="r" values="2.6;0.6;2.6" dur="4s" repeatCount="indefinite" />
      </circle>
      <circle cx="28.5" cy="22" r="2.6" fill="#15803D">
        <animate attributeName="r" values="2.6;0.6;2.6" dur="4s" repeatCount="indefinite" />
      </circle>
      {/* smile */}
      <path d="M19 27 q5 4 10 0" stroke="#15803D" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      {/* ears */}
      <rect x="9.5" y="19" width="2.5" height="7" rx="1.25" fill="#fff" />
      <rect x="36" y="19" width="2.5" height="7" rx="1.25" fill="#fff" />
    </svg>
  );
}

// ---- widget ---------------------------------------------------------------

export function ChatBotWidget() {
  const { user, hasModule, hasPermission } = useAuth();

  // The same test the server applies before it will attach anyone's records.
  // Kept identical on purpose: prompts that offer more than the backend will
  // answer are worse than no prompts at all.
  const privileged = hasPermission("USER_MANAGE") || hasPermission("DASHBOARD_EXEC");
  const location = useLocation();

  const [config, setConfig] = useState<ChatbotConfig | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [status, setStatus] = useState("Online");

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);
  const langRef = useRef<Lang>("en");
  const mutedRef = useRef(false);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);

  const firstName = user?.name?.split(" ")[0] ?? "";

  // Load config once.
  useEffect(() => {
    let active = true;
    getChatbotConfig()
      .then((c) => {
        if (!active) return;
        setConfig(c);
        setStatus(c.llmAvailable ? "AI Online" : "Assistant");
      })
      .catch(() => {
        if (active) setConfig({
          enabled: true,
          ttsAvailable: false,
          sttAvailable: false,
          llmAvailable: false,
          assistantName: "Pixous HR Assistant",
          languages: ["en", "ta"]
        });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen, isTyping]);

  // ---- speech: stop / speak ----

  const stopSpeaking = useCallback(() => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const webSpeak = useCallback((text: string, l: Lang) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(l);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else {
      u.lang = SPEECH_LANG[l];
    }
    u.rate = l === "en" ? 1 : 0.9;
    window.speechSynthesis.speak(u);
  }, []);

  // Play text via Google Translate TTS — natural, native voice. Long text is
  // split into <=180-char chunks and played back to back so nothing is cut.
  const playGoogleTts = useCallback(async (clean: string, l: Lang): Promise<boolean> => {
    const chunks = clean.match(/[\s\S]{1,180}(?=\s|$)/g) ?? [clean];
    // Reuse the same Audio object ElevenLabs uses — it is already unlocked by
    // the user gesture, so autoplay after the async reply is allowed.
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    try {
      for (const c of chunks) {
        if (!c.trim()) continue;
        audio.src = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${l}&client=tw-ob&q=${encodeURIComponent(c.trim())}`;
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("tts chunk failed"));
          audio.play().catch(reject);
        });
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const playEleven = useCallback(async (clean: string, l: Lang): Promise<boolean> => {
    try {
      const url = await fetchTtsUrl(clean, l);
      if (!url) return false;
      audioUrlRef.current = url;
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.src = url;
      audio.onended = () => {
        if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null; }
      };
      await audio.play();
      return true;
    } catch {
      return false;
    }
  }, []);

  const speak = useCallback(
    async (text: string, l: Lang) => {
      if (mutedRef.current) return;
      const clean = cleanForSpeech(text);
      if (!clean) return;
      stopSpeaking();

      // Tamil / Hindi → Google's native voice first (ElevenLabs speaks these with
      // an English accent). English → ElevenLabs first for the premium voice.
      // Backend /chatbot/tts returns native Google audio for Tamil/Hindi and
      // ElevenLabs for English, so try it first; browser Google TTS is a backup.
      const order = [() => playEleven(clean, l), () => playGoogleTts(clean, l)];

      for (const attempt of order) {
        // eslint-disable-next-line no-await-in-loop
        if (await attempt()) return;
      }
      // Last resort: browser speech synthesis.
      webSpeak(clean, l);
    },
    [stopSpeaking, webSpeak, playGoogleTts, playEleven]
  );

  // ---- send ----

  const pushBot = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `b-${Date.now()}-${Math.round(performance.now())}`, sender: "bot", text, timestamp: new Date() }
    ]);
  }, []);

  const handleSend = useCallback(
    async (raw?: string) => {
      const text = (raw ?? inputText).trim();
      if (!text || isTyping) return;
      unlockAudio();

      const currentLang = langRef.current;
      const userMsg: Message = {
        id: `u-${Date.now()}`,
        sender: "user",
        text,
        timestamp: new Date()
      };

      // history from prior messages (before this new one)
      const history: ChatTurn[] = messages.map((m) => ({
        role: m.sender,
        content: m.text
      }));

      setMessages((prev) => [...prev, userMsg]);
      setInputText("");
      setIsTyping(true);
      stopSpeaking();

      try {
        const res = await sendChat(text, currentLang, history);
        pushBot(res.reply);
        setStatus(res.provider === "groq" ? "AI Online" : res.provider === "gemini" ? "AI Online" : "Assistant");
        void speak(res.reply, currentLang);
      } catch {
        const fallback = ERROR_TEXT[currentLang];
        pushBot(fallback);
        setStatus("Offline");
      } finally {
        setIsTyping(false);
      }
    },
    [inputText, isTyping, messages, pushBot, speak, stopSpeaking]
  );

  // ---- speech-to-text ----

  const startBrowserSR = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Voice input isn't supported in this browser.");
      return;
    }
    const rec = new SR();
    rec.lang = SPEECH_LANG[langRef.current];
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart = () => setIsRecording(true);
    rec.onerror = () => setIsRecording(false);
    rec.onend = () => setIsRecording(false);
    rec.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript;
      if (transcript) void handleSend(transcript);
    };
    recognitionRef.current = rec;
    rec.start();
  }, [handleSend]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        setIsTranscribing(true);
        try {
          const { text, lang: detected } = await transcribeAudio(blob, langRef.current);
          if (detected === "en" || detected === "ta") {
            setLang(detected);
            langRef.current = detected;
          }
          if (text.trim()) {
            await handleSend(text);
          } else {
            toast("I didn't catch that — please try again.", { icon: "🎤" });
          }
        } catch {
          toast.error("Couldn't transcribe — using browser voice instead.");
          startBrowserSR();
        } finally {
          setIsTranscribing(false);
        }
      };
      recorderRef.current = mr;
      mr.start();
      setIsRecording(true);
    } catch {
      // permission denied / no device — try the browser engine
      startBrowserSR();
    }
  }, [handleSend, startBrowserSR]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    } else if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* noop */
      }
    }
    setIsRecording(false);
  }, []);

  const toggleMic = useCallback(() => {
    if (isRecording) {
      stopRecording();
      return;
    }
    if (isTranscribing || isTyping) return;
    const canRecord =
      config?.sttAvailable &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof (window as any).MediaRecorder === "function";
    if (canRecord) {
      void startRecording();
    } else {
      startBrowserSR();
    }
  }, [config, isRecording, isTranscribing, isTyping, startRecording, stopRecording, startBrowserSR]);

  // ---- open + greeting + dashboard welcome ----

  const openChat = useCallback(() => {
    setIsOpen(true);
    unlockAudio();
    setMessages((prev) =>
      prev.length === 0
        ? [{ id: "greeting", sender: "bot", text: greeting(langRef.current, hasModule), timestamp: new Date() }]
        : prev
    );
  }, []);

  const closeChat = useCallback(() => {
    setIsOpen(false);
    stopSpeaking();
  }, [stopSpeaking]);

  // The greeting was written in whatever language was current when the chat
  // opened. Choosing another one rewrites it, so the first bubble is not left
  // sitting in English.
  useEffect(() => {
    setMessages((prev) => prev.some((m) => m.id === "greeting")
      ? prev.map((m) => m.id === "greeting" ? { ...m, text: greeting(lang, hasModule) } : m)
      : prev);
  }, [lang]);

  // Auto-welcome once per session when the user lands on the dashboard.
  useEffect(() => {
    if (!config) return;
    if (location.pathname !== "/") return;
    if (sessionStorage.getItem(WELCOME_KEY)) return;
    sessionStorage.setItem(WELCOME_KEY, "1");
    const text = welcomeText(langRef.current, firstName);
    setIsOpen(true);
    setMessages((prev) => [
      ...prev,
      { id: "welcome-pop", sender: "bot", text, timestamp: new Date() }
    ]);
    const t = setTimeout(() => void speak(text, langRef.current), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, location.pathname]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const showSuggestions = messages.length <= 1 && !isTyping;

  return (
    <div className="fixed bottom-6 right-6 z-50 font-sans">
      {/*
        The assistant sits in the corner, ready to be opened. Nothing pulses for
        attention, and there is no arrow to press first.
      */}
      {!isOpen && (
        <div className="flex items-center justify-end">
          <button
            onClick={openChat}
            className="relative flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-transform duration-200 hover:scale-105 active:scale-95"
            style={{ boxShadow: "0 10px 26px -8px rgba(99,102,241,0.5)" }}
            aria-label="Open AI assistant"
          >
            <BotAvatar className="h-12 w-12 drop-shadow" />
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-green-500 ring-2 ring-white">
              <Sparkles className="h-2 w-2 text-white" />
            </span>
          </button>
        </div>
      )}

      {/* Panel */}
      {isOpen && (
        <div
          className="flex h-[560px] w-[min(94vw,24rem)] flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-2xl animate-in slide-in-from-bottom-5"
          style={{ boxShadow: "0 24px 48px -12px rgba(0,0,0,0.25)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between bg-gradient-to-r from-green-600 to-green-600 px-4 py-3 text-white">
            <div className="flex items-center gap-3">
              <BotAvatar className="h-9 w-9" />
              <div>
                <h3 className="text-sm font-bold leading-tight">Pixous HR Assistant</h3>
                <span className="flex items-center gap-1 text-[10px] text-white/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" /> {status}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-white hover:bg-white/15"
                onClick={() => {
                  setIsMuted((m) => !m);
                  if (!isMuted) stopSpeaking();
                }}
                title={isMuted ? "Unmute voice" : "Mute voice"}
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-white hover:bg-white/15"
                onClick={closeChat}
                title="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Language selector */}
          <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Language</span>
            <div className="flex overflow-hidden rounded-lg border bg-background">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLang(l.code)}
                  className={`px-3 py-1 text-xs transition-all ${
                    lang === l.code
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-4 overflow-y-auto bg-card p-4 dark:bg-zinc-950/20">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
              >
                <div className="flex max-w-[85%] items-end gap-2">
                  {msg.sender === "bot" && <BotAvatar className="h-6 w-6 shrink-0" />}
                  <div
                    className={`rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
                      msg.sender === "user"
                        ? "rounded-tr-none bg-primary text-primary-foreground"
                        : "rounded-tl-none border bg-card text-card-foreground"
                    }`}
                  >
                    <p className="whitespace-pre-line leading-relaxed">{msg.text}</p>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
                  <span>
                    {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {msg.sender === "bot" && (
                    <button
                      onClick={() => void speak(msg.text, lang)}
                      className="transition hover:text-primary"
                      title="Play voice"
                    >
                      <Volume2 className="inline h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex items-center gap-2">
                <BotAvatar className="h-6 w-6" />
                <div className="flex items-center gap-1 rounded-2xl rounded-tl-none border bg-card px-4 py-3 shadow-sm">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: "0ms" }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: "150ms" }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}

            {/* Quick suggestions */}
            {showSuggestions && (
              <div className="flex flex-wrap gap-2 pt-1">
                {(privileged
                  ? ADMIN_SUGGESTIONS
                  : SUGGESTIONS.filter((s) => hasModule(s.module))
                ).map((item) => item[lang]).map((s) => (
                  <button
                    key={s}
                    onClick={() => void handleSend(s)}
                    className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary transition hover:bg-primary/10"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 border-t bg-card p-3">
            <Button
              variant="outline"
              size="icon"
              onClick={toggleMic}
              disabled={isTranscribing}
              className={`h-10 w-10 shrink-0 rounded-full transition-all ${
                isRecording
                  ? "animate-pulse border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "hover:bg-muted"
              }`}
              title={isRecording ? "Stop recording" : "Speak"}
            >
              {isTranscribing ? (
                <PixousLoader size="sm" />
              ) : isRecording ? (
                <Square className="h-5 w-5" />
              ) : (
                <Mic className="h-5 w-5" />
              )}
            </Button>

            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              disabled={isTyping || isRecording}
              placeholder={isRecording ? "Listening…" : PLACEHOLDER[lang]}
              className="h-10 flex-1 rounded-full border bg-muted/30 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />

            <Button
              onClick={() => handleSend()}
              size="icon"
              disabled={!inputText.trim() || isTyping}
              className="h-10 w-10 shrink-0 rounded-full"
              title="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
