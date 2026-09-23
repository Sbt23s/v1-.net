import AdminChatbotSettings from "@/pages/AdminChatbotSettings";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Bot, Webhook, Cpu, ShieldCheck } from "lucide-react";

export function SettingsAiChatbotTab() {
  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card shadow-sm">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            AI Chatbot & System Integrations
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure LLM providers (Groq, Gemini), ElevenLabs voice synthesis, and knowledge crawling.
          </p>
        </div>
      </div>

      {/* Embed AdminChatbotSettings */}
      <AdminChatbotSettings />
    </div>
  );
}
