import { PixousLoader, PixousPanelLoader } from "@/components/ui/pixous-loader";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, KeyRound, Globe, Trash2, Save, RefreshCw, Database, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  getAdminSettings,
  saveAdminSettings,
  ingestWebsite,
  getKnowledge,
  deleteKnowledge,
  type AdminSettings
} from "@/lib/chatbot";
import { apiMessage } from "@/lib/api";
import toast from "react-hot-toast";

function Field({
  label,
  children,
  hint
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20";

// Premade ElevenLabs voices that work on the free API tier and speak
// Tamil / Hindi / English via the multilingual model. Shared "library" and
// cloned voices need a paid plan, so they are intentionally not listed here.
const PREMADE_VOICES: { id: string; label: string }[] = [
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah — Female, warm (recommended)" },
  { id: "pFZP5JQG7iQjIQuC4Bku", label: "Lily — Female, velvety" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", label: "Alice — Female, clear" },
  { id: "XrExE9yKIg1WjnnlVkGX", label: "Matilda — Female, professional" },
  { id: "cgSgspJ2msm6clMCkdW9", label: "Jessica — Female, bright" },
  { id: "hpp4J3VqNfWAUOO0d1Us", label: "Bella — Female, professional" },
  { id: "JBFqnCBsd6RMkjVDRZzb", label: "George — Male, warm storyteller" },
  { id: "nPczCjzI2devNBz1zQrb", label: "Brian — Male, deep" },
  { id: "onwK4e9ZLuTAKqWW03F9", label: "Daniel — Male, broadcaster" },
  { id: "cjVigY5qzO86Huf0OWal", label: "Eric — Male, smooth" },
  { id: "pqHfZKP75CvOlQylNhV4", label: "Bill — Male, mature" }
];

function KeyRow({
  label,
  set,
  masked,
  value,
  onChange
}: {
  label: string;
  set: boolean;
  masked: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label} hint={set ? `Current: ${masked} — leave blank to keep` : "Not configured yet"}>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={set ? "•••• (unchanged)" : "Paste API key"}
          className={inputCls}
          autoComplete="off"
        />
        <Badge variant={set ? "success" : "warning"} className="shrink-0 text-[10px]">
          {set ? "Set" : "Missing"}
        </Badge>
      </div>
    </Field>
  );
}

export default function AdminChatbotSettings() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["chatbot-admin"], queryFn: getAdminSettings });
  const knowledge = useQuery({ queryKey: ["chatbot-knowledge"], queryFn: getKnowledge });

  // form state
  const [form, setForm] = useState<Partial<AdminSettings>>({});
  const [keys, setKeys] = useState({ groq: "", gemini: "", eleven: "", firecrawl: "" });

  useEffect(() => {
    if (settings.data) {
      const s = settings.data;
      setForm({
        enabled: s.enabled,
        llmProvider: s.llmProvider,
        groqModel: s.groqModel,
        groqSttModel: s.groqSttModel,
        geminiModel: s.geminiModel,
        elevenLabsVoiceId: s.elevenLabsVoiceId,
        elevenLabsModel: s.elevenLabsModel,
        websiteUrl: s.websiteUrl
      });
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, string | boolean> = {
        enabled: !!form.enabled,
        llmProvider: form.llmProvider ?? "groq",
        groqModel: form.groqModel ?? "",
        groqSttModel: form.groqSttModel ?? "",
        geminiModel: form.geminiModel ?? "",
        elevenLabsVoiceId: form.elevenLabsVoiceId ?? "",
        elevenLabsModel: form.elevenLabsModel ?? "",
        websiteUrl: form.websiteUrl ?? ""
      };
      if (keys.groq.trim()) payload.groqApiKey = keys.groq.trim();
      if (keys.gemini.trim()) payload.geminiApiKey = keys.gemini.trim();
      if (keys.eleven.trim()) payload.elevenLabsApiKey = keys.eleven.trim();
      if (keys.firecrawl.trim()) payload.firecrawlApiKey = keys.firecrawl.trim();
      return saveAdminSettings(payload);
    },
    onSuccess: () => {
      toast.success("AI assistant settings saved");
      setKeys({ groq: "", gemini: "", eleven: "", firecrawl: "" });
      qc.invalidateQueries({ queryKey: ["chatbot-admin"] });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not save settings"))
  });

  const ingest = useMutation({
    mutationFn: () => ingestWebsite(form.websiteUrl || undefined),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(`Ingested "${r.title ?? "page"}" (${r.chars} chars)`);
        qc.invalidateQueries({ queryKey: ["chatbot-knowledge"] });
        qc.invalidateQueries({ queryKey: ["chatbot-admin"] });
      } else {
        toast.error(r.message || "Ingestion failed");
      }
    },
    onError: (e) => toast.error(apiMessage(e, "Ingestion failed"))
  });

  const removeDoc = useMutation({
    mutationFn: (id: number) => deleteKnowledge(id),
    onSuccess: () => {
      toast.success("Document removed");
      qc.invalidateQueries({ queryKey: ["chatbot-knowledge"] });
      qc.invalidateQueries({ queryKey: ["chatbot-admin"] });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not delete"))
  });

  const s = settings.data;

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bot className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">AI Assistant Settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure the chatbot's API keys, models and website knowledge. Keys are stored
            server-side and never shown to employees.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-300">
        <ShieldCheck className="mr-1.5 inline h-3.5 w-3.5" />
        API keys are write-only here. Existing keys are shown masked and are never returned in
        full. Rotate any key that may have been exposed.
      </div>

      {settings.isLoading || !s ? (
        <PixousPanelLoader height="h-96" />
      ) : (
        <>
          {/* Providers / keys */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <KeyRound className="h-5 w-5 text-primary" /> Provider API Keys
              </CardTitle>
              <CardDescription>
                Groq powers chat + speech-to-text, ElevenLabs powers the voice, Gemini is the
                fallback, and Firecrawl ingests your website.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <KeyRow
                label="Groq API Key (chat + speech-to-text)"
                set={s.groqKeySet}
                masked={s.groqKeyMasked}
                value={keys.groq}
                onChange={(v) => setKeys((k) => ({ ...k, groq: v }))}
              />
              <KeyRow
                label="ElevenLabs API Key (text-to-speech)"
                set={s.elevenLabsKeySet}
                masked={s.elevenLabsKeyMasked}
                value={keys.eleven}
                onChange={(v) => setKeys((k) => ({ ...k, eleven: v }))}
              />
              <KeyRow
                label="Gemini API Key (LLM fallback + translate)"
                set={s.geminiKeySet}
                masked={s.geminiKeyMasked}
                value={keys.gemini}
                onChange={(v) => setKeys((k) => ({ ...k, gemini: v }))}
              />
              <KeyRow
                label="Firecrawl API Key (website ingestion)"
                set={s.firecrawlKeySet}
                masked={s.firecrawlKeyMasked}
                value={keys.firecrawl}
                onChange={(v) => setKeys((k) => ({ ...k, firecrawl: v }))}
              />
            </CardContent>
          </Card>

          {/* Behaviour / models */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Behaviour &amp; Models</CardTitle>
              <CardDescription>Fine-tune which models the assistant uses.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <Field label="Assistant enabled">
                <select
                  value={form.enabled ? "true" : "false"}
                  onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.value === "true" }))}
                  className={inputCls}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </Field>
              <Field label="Primary LLM provider">
                <select
                  value={form.llmProvider ?? "groq"}
                  onChange={(e) => setForm((f) => ({ ...f, llmProvider: e.target.value }))}
                  className={inputCls}
                >
                  <option value="groq">Groq (recommended)</option>
                  <option value="gemini">Gemini</option>
                </select>
              </Field>
              <Field label="Groq chat model">
                <input
                  className={inputCls}
                  value={form.groqModel ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, groqModel: e.target.value }))}
                />
              </Field>
              <Field label="Groq speech-to-text model">
                <input
                  className={inputCls}
                  value={form.groqSttModel ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, groqSttModel: e.target.value }))}
                />
              </Field>
              <Field label="Gemini model">
                <input
                  className={inputCls}
                  value={form.geminiModel ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, geminiModel: e.target.value }))}
                />
              </Field>
              <Field label="ElevenLabs model">
                <input
                  className={inputCls}
                  value={form.elevenLabsModel ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, elevenLabsModel: e.target.value }))}
                />
              </Field>
              <Field
                label="ElevenLabs voice"
                hint="Premade voices work on the free plan. Library/cloned voices need a paid ElevenLabs plan."
              >
                <select
                  className={inputCls}
                  value={form.elevenLabsVoiceId ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, elevenLabsVoiceId: e.target.value }))}
                >
                  {form.elevenLabsVoiceId &&
                    !PREMADE_VOICES.some((v) => v.id === form.elevenLabsVoiceId) && (
                      <option value={form.elevenLabsVoiceId}>
                        Current (custom): {form.elevenLabsVoiceId}
                      </option>
                    )}
                  {PREMADE_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </Field>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={() => save.mutate()} disabled={save.isPending} className="gap-2">
              {save.isPending ? <PixousLoader size="xs" /> : <Save className="h-4 w-4" />}
              Save settings
            </Button>
          </div>

          {/* Knowledge / Firecrawl */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Database className="h-5 w-5 text-primary" /> Website Knowledge
              </CardTitle>
              <CardDescription>
                Train the assistant on your website. Firecrawl scrapes the page and adds it to the
                knowledge base the bot uses to answer questions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Field label="Website URL to crawl">
                    <input
                      className={inputCls}
                      value={form.websiteUrl ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
                      placeholder="https://pixoustech.com"
                    />
                  </Field>
                </div>
                <Button
                  variant="outline"
                  onClick={() => ingest.mutate()}
                  disabled={ingest.isPending || !s.firecrawlKeySet}
                  className="gap-2"
                >
                  {ingest.isPending ? (
                    <PixousLoader size="xs" />
                  ) : (
                    <Globe className="h-4 w-4" />
                  )}
                  Ingest website
                </Button>
              </div>
              {!s.firecrawlKeySet && (
                <p className="text-[11px] text-muted-foreground">
                  Add a Firecrawl key above and save before ingesting.
                </p>
              )}

              <div className="rounded-lg border">
                <div className="flex items-center justify-between border-b px-4 py-2.5">
                  <span className="text-xs font-semibold">
                    Knowledge documents ({knowledge.data?.length ?? 0})
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => knowledge.refetch()}
                  >
                    <RefreshCw className="h-3 w-3" /> Refresh
                  </Button>
                </div>
                {knowledge.isLoading ? (
                  <div className="p-4">
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : (knowledge.data?.length ?? 0) === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                    No crawled documents yet. The bot still knows the built-in portal guide.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {knowledge.data!.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-[9px] uppercase">
                              {d.source}
                            </Badge>
                            <span className="truncate text-sm font-medium">{d.title || "Untitled"}</span>
                          </div>
                          <span className="text-[11px] text-muted-foreground">{d.chars} chars</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          onClick={() => removeDoc.mutate(d.id)}
                          disabled={removeDoc.isPending}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
