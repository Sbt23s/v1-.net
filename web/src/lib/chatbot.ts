// Client for the server-side AI assistant. All provider keys live on the
// backend — this module only talks to /api/chatbot/*, never to third parties.
import { api, tokenStore } from "@/lib/api";
import type { ApiEnvelope } from "@/types";

const BASE = import.meta.env.VITE_API_URL || "";

export type Lang = "en" | "ta";

export const LANGUAGES: { code: Lang; label: string; speech: string }[] = [
  { code: "en", label: "English", speech: "en-US" },
  { code: "ta", label: "தமிழ்", speech: "ta-IN" }
];

export interface ChatTurn {
  role: "user" | "bot";
  content: string;
}

export interface ChatResponse {
  reply: string;
  provider: string;
  lang: string;
}

export interface ChatbotConfig {
  enabled: boolean;
  ttsAvailable: boolean;
  sttAvailable: boolean;
  llmAvailable: boolean;
  assistantName: string;
  languages: string[];
}

export interface SttResponse {
  text: string;
  lang: string;
}

export interface AdminSettings {
  enabled: boolean;
  llmProvider: string;
  groqModel: string;
  groqSttModel: string;
  geminiModel: string;
  elevenLabsVoiceId: string;
  elevenLabsModel: string;
  websiteUrl: string;
  groqKeySet: boolean;
  geminiKeySet: boolean;
  elevenLabsKeySet: boolean;
  firecrawlKeySet: boolean;
  groqKeyMasked: string;
  geminiKeyMasked: string;
  elevenLabsKeyMasked: string;
  firecrawlKeyMasked: string;
  knowledgeDocs: number;
}

export interface KnowledgeDoc {
  id: number;
  source: string;
  title: string;
  enabled: boolean;
  chars: number;
}

export interface IngestResult {
  ok: boolean;
  message: string;
  title?: string;
  chars: number;
}

export async function getChatbotConfig(): Promise<ChatbotConfig> {
  const res = await api.get<ApiEnvelope<ChatbotConfig>>("/chatbot/config");
  return res.data.data;
}

export async function sendChat(
  message: string,
  lang: Lang,
  history: ChatTurn[]
): Promise<ChatResponse> {
  const res = await api.post<ApiEnvelope<ChatResponse>>("/chatbot/chat", {
    message,
    lang,
    history
  });
  return res.data.data;
}

export async function translateText(text: string, targetLang: Lang): Promise<string> {
  const res = await api.post<ApiEnvelope<{ text: string }>>("/chatbot/translate", {
    text,
    targetLang
  });
  return res.data.data.text;
}

/**
 * Fetch ElevenLabs speech for `text`. Returns an object-URL for an <audio>
 * element, or null when the server has no TTS key (caller uses browser speech).
 */
export async function fetchTtsUrl(text: string, lang: Lang): Promise<string | null> {
  const res = await api.post("/chatbot/tts", { text, lang }, {
    responseType: "arraybuffer",
    // 204 = TTS unavailable; treat as a normal (non-error) response
    validateStatus: (s) => s === 200 || s === 204
  });
  if (res.status !== 200) return null;
  const buf = res.data as ArrayBuffer;
  if (!buf || buf.byteLength === 0) return null;
  return URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
}

/**
 * Send recorded audio to Groq Whisper and get back the transcript + detected
 * language. Uses fetch (not axios) so the browser sets the multipart boundary;
 * the shared axios instance forces a JSON content-type which would break it.
 */
export async function transcribeAudio(blob: Blob, lang: Lang | "auto"): Promise<SttResponse> {
  const form = new FormData();
  const type = blob.type || "audio/webm";
  const ext = type.includes("ogg")
    ? "ogg"
    : type.includes("mp4") || type.includes("m4a") || type.includes("aac")
      ? "m4a"
      : type.includes("wav")
        ? "wav"
        : type.includes("mpeg")
          ? "mp3"
          : "webm";
  form.append("audio", blob, `audio.${ext}`);

  const res = await fetch(`${BASE}/api/chatbot/stt?lang=${encodeURIComponent(lang)}`, {
    method: "POST",
    headers: tokenStore.access ? { Authorization: `Bearer ${tokenStore.access}` } : undefined,
    body: form
  });
  if (!res.ok) throw new Error(`Speech-to-text failed (${res.status})`);
  const json = (await res.json()) as ApiEnvelope<SttResponse>;
  return json.data;
}

// ---- admin ----

export async function getAdminSettings(): Promise<AdminSettings> {
  const res = await api.get<ApiEnvelope<AdminSettings>>("/chatbot/admin/settings");
  return res.data.data;
}

export async function saveAdminSettings(
  payload: Partial<Record<string, string | boolean>>
): Promise<AdminSettings> {
  const res = await api.put<ApiEnvelope<AdminSettings>>("/chatbot/admin/settings", payload);
  return res.data.data;
}

export async function ingestWebsite(url?: string): Promise<IngestResult> {
  const res = await api.post<ApiEnvelope<IngestResult>>("/chatbot/admin/ingest", { url });
  return res.data.data;
}

export async function getKnowledge(): Promise<KnowledgeDoc[]> {
  const res = await api.get<ApiEnvelope<KnowledgeDoc[]>>("/chatbot/admin/knowledge");
  return res.data.data;
}

export async function deleteKnowledge(id: number): Promise<void> {
  await api.delete(`/chatbot/admin/knowledge/${id}`);
}
