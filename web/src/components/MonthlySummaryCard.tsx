import { useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Sparkles, Square, Volume2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fetchTtsUrl } from "@/lib/chatbot";
import { cn } from "@/lib/utils";

/** One figure beside the summary text. */
export type SummaryStat = {
  icon: LucideIcon;
  value: string | number;
  label: string;
  /** Tailwind classes for the icon chip, e.g. "bg-sky-100 text-sky-600". */
  tone?: string;
};

/**
 * A month's summary in English and Tamil, read aloud on request.
 *
 * The caller supplies the sentences, so each page decides what its month means —
 * an employee's own work, a team's, or the whole organisation's — and this only
 * handles presenting it, switching language and speaking it.
 */
export function toTamilMonthLabel(label: string) {
  if (!label) return "";
  return label
    .replace(/January/gi, "ஜனவரி")
    .replace(/February/gi, "பிப்ரவரி")
    .replace(/March/gi, "மார்ச்")
    .replace(/April/gi, "ஏப்ரல்")
    .replace(/May/gi, "மே")
    .replace(/June/gi, "ஜூன்")
    .replace(/July/gi, "ஜூலை")
    .replace(/August/gi, "ஆகஸ்ட்")
    .replace(/September/gi, "செப்டம்பர்")
    .replace(/October/gi, "அக்டோபர்")
    .replace(/November/gi, "நவம்பர்")
    .replace(/December/gi, "டிசம்பர்");
}

export function toTamilTeamName(name: string) {
  if (!name) return "";
  return name
    .replace(/AI Engineer/gi, "செயற்கை நுண்ணறிவு பொறியாளர்")
    .replace(/Software Engineer/gi, "மென்பொருள் பொறியாளர்")
    .replace(/Civil Engineer/gi, "சிவில் பொறியாளர்")
    .replace(/System Admin/gi, "கணினி நிர்வாகி")
    .replace(/Admin/gi, "நிர்வாகி");
}

function translateStatLabel(label: string, lang: "en" | "ta") {
  if (lang !== "ta") return label;
  if (/projects/i.test(label)) return "திட்டங்கள்";
  if (/hours/i.test(label)) return "மணி நேரம்";
  if (/entries/i.test(label)) return "பதிவுகள்";
  if (/employees/i.test(label)) return "ஊழியர்கள்";
  if (/completed/i.test(label)) return "முடிந்தவை";
  if (/pending/i.test(label)) return "நிலுவையில் உள்ளன";
  return label;
}

export function MonthlySummaryCard({
  title = "Monthly Summary",
  monthLabel,
  shortEn,
  shortTa,
  spokenEn,
  spokenTa,
  stats = []
}: {
  title?: string;
  monthLabel: string;
  shortEn: string;
  shortTa: string;
  spokenEn: string;
  spokenTa: string;
  stats?: SummaryStat[];
}) {
  const [lang, setLang] = useState<"en" | "ta">("en");
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = () => {
    try { window.speechSynthesis?.cancel(); } catch { /* not available */ }
    if (audioRef.current) audioRef.current.pause();
    setSpeaking(false);
  };

  const speak = async () => {
    if (speaking) { stop(); return; }
    const text = lang === "ta" ? spokenTa : spokenEn;
    setSpeaking(true);
    try {
      const url = await fetchTtsUrl(text, lang);
      if (url) {
        const audio = audioRef.current ?? new Audio();
        audioRef.current = audio;
        audio.src = url;
        audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
        await audio.play();
        return;
      }
    } catch { /* fall through */ }
    try {
      const synth = window.speechSynthesis;
      if (!synth) { setSpeaking(false); return; }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === "ta" ? "ta-IN" : "en-US";
      const match = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith(lang));
      if (match) u.voice = match;
      u.onend = () => setSpeaking(false);
      synth.speak(u);
    } catch {
      setSpeaking(false);
    }
  };

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {lang === "ta" ? (title === "Monthly Summary" ? "மாதாந்திர சுருக்கம்" : title) : title} <Badge variant="secondary" className="text-[10px]">BETA</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">{lang === "ta" ? toTamilMonthLabel(monthLabel) : monthLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-full border bg-muted/60 p-1">
              {([["en", "English"], ["ta", "தமிழ்"]] as const).map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => { stop(); setLang(code); }}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold transition-all",
                    lang === code
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant={speaking ? "outline" : "default"}
              onClick={speak}
              title={speaking ? "Stop" : "Hear this summary"}
            >
              {speaking ? (
                <><Square className="mr-1.5 h-3.5 w-3.5" /> {lang === "ta" ? "நிறுத்து" : "Stop"}</>
              ) : (
                <><Volume2 className="mr-1.5 h-4 w-4" /> {lang === "ta" ? "ஒலி சுருக்கம்" : "Summary"}</>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="space-y-1.5">
            <p className="text-sm">{lang === "ta" ? shortTa : shortEn}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {lang === "ta" ? spokenTa : spokenEn}
            </p>
          </div>
        </div>

        {stats.length > 0 && (
          <div className="grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="flex items-center gap-2.5">
                <span className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                  s.tone || "bg-primary/10 text-primary"
                )}>
                  <s.icon className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-lg font-bold leading-none tabular-nums">{s.value}</div>
                  <div className="text-[11px] text-muted-foreground">{translateStatLabel(s.label, lang)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
