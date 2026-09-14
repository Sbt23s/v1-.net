using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Chatbot;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Infrastructure.Modules.Chatbot;

public sealed class ChatbotBal : IChatbotBal
{
    private readonly IChatbotDal _dal;
    private readonly ICurrentUser _currentUser;
    private readonly HttpClient _http;
    private readonly ILogger<ChatbotBal> _log;

    private const string GroqChatUrl = "https://api.groq.com/openai/v1/chat/completions";
    private const string GroqSttUrl = "https://api.groq.com/openai/v1/audio/transcriptions";
    private const string GeminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/{0}:generateContent?key={1}";
    private const string ElevenLabsUrl = "https://api.elevenlabs.io/v1/text-to-speech/{0}";
    private const string FirecrawlUrl = "https://api.firecrawl.dev/v1/scrape";

    private const int MaxHistoryTurns = 8;
    private const int MaxKnowledgeChars = 6000;
    private const int MaxIngestChars = 12000;

    private const string EmsGuide = """
        === PIXOUS HR PORTAL — EMPLOYEE MANAGEMENT SYSTEM ===
        Pixous HR Portal is a full HR & Employee Management System for a company that spans
        IT (desk staff) and Civil/Facilities (on-site field workers). It handles attendance,
        leave, payroll, assets, helpdesk, reports and more, with role-based access.

        SIDEBAR MODULES (guide the user to the matching menu item):
        - Dashboard: personal overview — today's attendance status, pending leaves, assets, open tickets. Punch In / Punch Out lives here.
        - Attendance: view your punch logs; field workers punch with GPS geofencing.
        - Team Attendance: managers/HR view their team's attendance.
        - Leave: check leave balances and apply for leave. Approvals appear under "Approvals" for managers/HR.
        - Leave Policies: HR/Admin configure leave types and rules.
        - Payroll Runs / Payslip Requests: HR/Finance run payroll and approve payslip requests.
        - Payslips: employees view and download monthly payslips (PDF).
        - Work Reports: log and review daily project work hours.
        - Employees: HR/Admin manage the employee directory, create new employees.
        - Claims: travel-allowance claims (per-km for hills/plains, bus fare, etc.).
        - Assets: company devices/machinery assigned to you (with QR tags).
        - Helpdesk: raise and track support tickets (with SLA + ratings).
        - Complaints / Needs: raise complaints or needs; HR/Admin review and respond.
        - Onboarding: HR-managed onboarding checklists for new joiners.
        - Safety: site safety incident reporting (Civil).
        - Reports: analytics and exports for leadership.
        - Communities / Chat: internal group chat and audio/video calls.
        - Admin > AI Assistant: (admins only) configure the assistant's API keys and website knowledge.

        HOW-TO QUICK ANSWERS:
        - Punch attendance: open the Dashboard and use "Punch In" / "Punch Out". Field staff must be inside the site geofence.
        - Apply for leave: Leave menu → choose leave type and dates → submit. HR approves it.
        - View salary/payslip: Payslips menu → open the month → download PDF.
        - Raise an IT/facility issue: Helpdesk → New Ticket.
        - See assigned laptop/equipment: Assets menu.
        - Reset password / profile details: Profile (top-right avatar menu).

        ROLES: Super Admin (full config), IT/Civil Employee (self-service), IT/Civil HR (employees, payroll,
        leave approvals), HR/Supervisor (team + approvals), Finance (payroll approvals), CEO (executive dashboards),
        Asset Managers, Facilities Admin. Login is by username; every account has its own permissions.

        STYLE: You are the Pixous HR Assistant. Be warm, concise and professional. Answer HR/portal questions and
        general questions. When a task maps to a screen, name the exact sidebar menu. You guide users — you cannot
        perform actions or read a specific person's private data yourself. If unsure, say so briefly.
        """;

    public ChatbotBal(IChatbotDal dal, ICurrentUser currentUser, HttpClient http, ILogger<ChatbotBal> log)
    {
        _dal = dal;
        _currentUser = currentUser;
        _http = http;
        _log = log;
    }

    public async Task<ChatbotConfig> ConfigAsync(CancellationToken ct = default)
    {
        string? enabledVal = await _dal.GetSettingAsync("CHATBOT_ENABLED", ct);
        bool enabled = !"false".Equals(enabledVal?.Trim(), StringComparison.OrdinalIgnoreCase);

        string? groqKey = await _dal.GetSettingAsync("GROQ_API_KEY", ct);
        string? geminiKey = await _dal.GetSettingAsync("GEMINI_API_KEY", ct);
        string? elevenKey = await _dal.GetSettingAsync("ELEVENLABS_API_KEY", ct);

        bool hasGroq = !string.IsNullOrWhiteSpace(groqKey);
        bool hasGemini = !string.IsNullOrWhiteSpace(geminiKey);
        bool hasEleven = !string.IsNullOrWhiteSpace(elevenKey);

        return new ChatbotConfig(
            enabled,
            hasEleven,
            hasGroq,
            hasGroq || hasGemini,
            "Pixous HR Assistant",
            ["en", "ta", "hi"]);
    }

    public async Task<ChatResponse> ChatAsync(ChatRequest req, bool privileged, CancellationToken ct = default)
    {
        string message = req.Message?.Trim() ?? string.Empty;
        string lang = NormaliseLang(req.Lang);

        if (string.IsNullOrEmpty(message))
        {
            throw ApiException.BadRequest("Message is required.");
        }

        string? enabledVal = await _dal.GetSettingAsync("CHATBOT_ENABLED", ct);
        bool enabled = !"false".Equals(enabledVal?.Trim(), StringComparison.OrdinalIgnoreCase);

        if (!enabled)
        {
            if (privileged)
            {
                string? direct = await _dal.GetDirectAnswerAsync(message, lang, ct);
                if (direct is not null) return new ChatResponse(direct, "live-data", lang);
            }
            return new ChatResponse(await LocalFallbackAsync(message, lang, ct), "disabled", lang);
        }

        string system = await BuildSystemPromptAsync(lang, ct);

        if (privileged)
        {
            string live = await _dal.GetLiveOrgContextAsync(ct);
            if (!string.IsNullOrWhiteSpace(live)) system += live;

            string people = await _dal.GetPeopleMentionedContextAsync(message, ct);
            if (!string.IsNullOrWhiteSpace(people)) system += people;
        }

        var history = req.History ?? [];
        string provider = (await _dal.GetSettingAsync("CHATBOT_LLM_PROVIDER", ct)) ?? "groq";

        var order = "gemini".Equals(provider, StringComparison.OrdinalIgnoreCase)
            ? new[] { "gemini", "groq" }
            : new[] { "groq", "gemini" };

        foreach (var p in order)
        {
            try
            {
                if ("groq".Equals(p) && !string.IsNullOrWhiteSpace(await _dal.GetSettingAsync("GROQ_API_KEY", ct)))
                {
                    string reply = await CallGroqChatAsync(system, history, message, ct);
                    return new ChatResponse(reply, "groq", lang);
                }

                if ("gemini".Equals(p) && !string.IsNullOrWhiteSpace(await _dal.GetSettingAsync("GEMINI_API_KEY", ct)))
                {
                    string reply = await CallGeminiAsync(system, history, message, ct);
                    return new ChatResponse(reply, "gemini", lang);
                }
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Chatbot provider {Provider} failed: {Message}", p, ex.Message);
            }
        }

        if (privileged)
        {
            string? direct = await _dal.GetDirectAnswerAsync(message, lang, ct);
            if (direct is not null) return new ChatResponse(direct, "live-data", lang);
        }

        return new ChatResponse(await LocalFallbackAsync(message, lang, ct), "local", lang);
    }

    public async Task<TranslateResponse> TranslateAsync(TranslateRequest req, CancellationToken ct = default)
    {
        string text = req.Text?.Trim() ?? string.Empty;
        string target = NormaliseLang(req.TargetLang);

        if (string.IsNullOrEmpty(text))
        {
            return new TranslateResponse(string.Empty, target);
        }

        string system = $"You are a precise translation engine. Translate the user's text into {LangName(target)}. Reply with ONLY the translation, no notes or quotes.";

        try
        {
            string? groqKey = await _dal.GetSettingAsync("GROQ_API_KEY", ct);
            if (!string.IsNullOrWhiteSpace(groqKey))
            {
                string res = await CallGroqChatAsync(system, [], text, ct);
                return new TranslateResponse(res, target);
            }

            string? geminiKey = await _dal.GetSettingAsync("GEMINI_API_KEY", ct);
            if (!string.IsNullOrWhiteSpace(geminiKey))
            {
                string res = await CallGeminiAsync(system, [], text, ct);
                return new TranslateResponse(res, target);
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Translate failed: {Message}", ex.Message);
        }

        return new TranslateResponse(text, target);
    }

    public async Task<byte[]?> TextToSpeechAsync(TtsRequest req, CancellationToken ct = default)
    {
        string text = req.Text?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(text)) return null;

        string reqLang = NormaliseLang(req.Lang);

        if ("ta".Equals(reqLang) || "hi".Equals(reqLang))
        {
            byte[]? g = await GoogleTtsAsync(text, reqLang, ct);
            if (g is not null && g.Length > 0) return g;
        }

        string? key = await _dal.GetSettingAsync("ELEVENLABS_API_KEY", ct);
        if (string.IsNullOrWhiteSpace(key)) return null;

        string voiceId = !string.IsNullOrWhiteSpace(req.VoiceId)
            ? req.VoiceId.Trim()
            : (await _dal.GetSettingAsync("ELEVENLABS_VOICE_ID", ct) ?? "EXAVITQu4vr4xnSDxMaL");

        string model = await _dal.GetSettingAsync("ELEVENLABS_MODEL", ct) ?? "eleven_multilingual_v2";

        bool nonEnglish = !string.IsNullOrEmpty(reqLang) && !"en".Equals(reqLang);
        if (nonEnglish && !model.Contains("turbo") && !model.Contains("flash"))
        {
            model = "eleven_turbo_v2_5";
        }
        bool supportsLangCode = model.Contains("turbo") || model.Contains("flash");

        string speak = text.Length > 2500 ? text[..2500] : text;

        var bodyObj = new JsonObject
        {
            ["text"] = speak,
            ["model_id"] = model,
            ["voice_settings"] = new JsonObject
            {
                ["stability"] = 0.5,
                ["similarity_boost"] = 0.75,
                ["style"] = 0.0
            }
        };

        if (supportsLangCode && !string.IsNullOrEmpty(reqLang))
        {
            bodyObj["language_code"] = reqLang;
        }

        try
        {
            using var msg = new HttpRequestMessage(HttpMethod.Post, string.Format(ElevenLabsUrl, voiceId));
            msg.Headers.Add("xi-api-key", key);
            msg.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("audio/mpeg"));
            msg.Content = new StringContent(bodyObj.ToJsonString(), Encoding.UTF8, "application/json");

            var res = await _http.SendAsync(msg, ct);
            if (res.IsSuccessStatusCode)
            {
                byte[] bytes = await res.Content.ReadAsByteArrayAsync(ct);
                if (bytes.Length > 0) return bytes;
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "ElevenLabs TTS failed: {Message}", ex.Message);
        }

        return null;
    }

    public async Task<SttResponse> SpeechToTextAsync(
        byte[] audio, string? filename, string? contentType, string? lang, CancellationToken ct = default)
    {
        if (audio is null || audio.Length == 0)
        {
            throw ApiException.BadRequest("Audio is required.");
        }

        string? key = await _dal.GetSettingAsync("GROQ_API_KEY", ct);
        if (string.IsNullOrWhiteSpace(key))
        {
            throw ApiException.Business("Speech-to-text is not configured.");
        }

        string model = await _dal.GetSettingAsync("GROQ_STT_MODEL", ct) ?? "whisper-large-v3";
        string safeName = string.IsNullOrWhiteSpace(filename) ? "audio.webm" : filename;
        string safeType = string.IsNullOrWhiteSpace(contentType) ? "audio/webm" : contentType;

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(model), "model");
        form.Add(new StringContent("verbose_json"), "response_format");
        form.Add(new StringContent("0"), "temperature");

        if (!string.IsNullOrWhiteSpace(lang) && !"auto".Equals(lang, StringComparison.OrdinalIgnoreCase))
        {
            form.Add(new StringContent(NormaliseLang(lang)), "language");
        }

        var fileContent = new ByteArrayContent(audio);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(safeType);
        form.Add(fileContent, "file", safeName);

        using var request = new HttpRequestMessage(HttpMethod.Post, GroqSttUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        request.Content = form;

        var res = await _http.SendAsync(request, ct);
        if (!res.IsSuccessStatusCode)
        {
            throw ApiException.Business("Could not transcribe audio.");
        }

        string json = await res.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(json);
        string text = doc.RootElement.TryGetProperty("text", out var t) ? t.GetString() ?? string.Empty : string.Empty;
        string detected = doc.RootElement.TryGetProperty("language", out var l) ? MapWhisperLanguage(l.GetString()) : "en";

        return new SttResponse(text.Trim(), detected);
    }

    public async Task<AdminSettingsResponse> AdminSettingsAsync(CancellationToken ct = default)
    {
        string? groqKey = await _dal.GetSettingAsync("GROQ_API_KEY", ct);
        string? geminiKey = await _dal.GetSettingAsync("GEMINI_API_KEY", ct);
        string? elevenKey = await _dal.GetSettingAsync("ELEVENLABS_API_KEY", ct);
        string? firecrawlKey = await _dal.GetSettingAsync("FIRECRAWL_API_KEY", ct);

        string? enabledVal = await _dal.GetSettingAsync("CHATBOT_ENABLED", ct);
        bool enabled = !"false".Equals(enabledVal?.Trim(), StringComparison.OrdinalIgnoreCase);

        var docs = await _dal.FindAllKnowledgeAsync(ct);

        return new AdminSettingsResponse(
            enabled,
            await _dal.GetSettingAsync("CHATBOT_LLM_PROVIDER", ct) ?? "groq",
            await _dal.GetSettingAsync("GROQ_MODEL", ct) ?? "llama-3.3-70b-versatile",
            await _dal.GetSettingAsync("GROQ_STT_MODEL", ct) ?? "whisper-large-v3",
            await _dal.GetSettingAsync("GEMINI_MODEL", ct) ?? "gemini-1.5-flash",
            await _dal.GetSettingAsync("ELEVENLABS_VOICE_ID", ct) ?? "EXAVITQu4vr4xnSDxMaL",
            await _dal.GetSettingAsync("ELEVENLABS_MODEL", ct) ?? "eleven_multilingual_v2",
            await _dal.GetSettingAsync("CHATBOT_WEBSITE_URL", ct) ?? "https://pixoustech.com",
            !string.IsNullOrWhiteSpace(groqKey),
            !string.IsNullOrWhiteSpace(geminiKey),
            !string.IsNullOrWhiteSpace(elevenKey),
            !string.IsNullOrWhiteSpace(firecrawlKey),
            Mask(groqKey),
            Mask(geminiKey),
            Mask(elevenKey),
            Mask(firecrawlKey),
            docs.Count);
    }

    public async Task UpdateSettingsAsync(AdminSettingsRequest req, CancellationToken ct = default)
    {
        if (req.Enabled.HasValue)
        {
            await _dal.SetSettingAsync("CHATBOT_ENABLED", req.Enabled.Value ? "true" : "false", "Master on/off switch", ct);
        }

        await PutIfPresentAsync("CHATBOT_LLM_PROVIDER", req.LlmProvider, "Primary LLM provider", ct);
        await PutIfPresentAsync("GROQ_MODEL", req.GroqModel, "Groq chat model", ct);
        await PutIfPresentAsync("GROQ_STT_MODEL", req.GroqSttModel, "Groq Whisper model", ct);
        await PutIfPresentAsync("GEMINI_MODEL", req.GeminiModel, "Gemini model", ct);
        await PutIfPresentAsync("ELEVENLABS_VOICE_ID", req.ElevenLabsVoiceId, "ElevenLabs voice id", ct);
        await PutIfPresentAsync("ELEVENLABS_MODEL", req.ElevenLabsModel, "ElevenLabs model", ct);
        await PutIfPresentAsync("CHATBOT_WEBSITE_URL", req.WebsiteUrl, "Company website", ct);

        await PutIfPresentAsync("GROQ_API_KEY", req.GroqApiKey, "Groq API key", ct);
        await PutIfPresentAsync("GEMINI_API_KEY", req.GeminiApiKey, "Gemini API key", ct);
        await PutIfPresentAsync("ELEVENLABS_API_KEY", req.ElevenLabsApiKey, "ElevenLabs API key", ct);
        await PutIfPresentAsync("FIRECRAWL_API_KEY", req.FirecrawlApiKey, "Firecrawl API key", ct);
    }

    public async Task<IngestResponse> IngestWebsiteAsync(string? url, CancellationToken ct = default)
    {
        string target = !string.IsNullOrWhiteSpace(url)
            ? url.Trim()
            : (await _dal.GetSettingAsync("CHATBOT_WEBSITE_URL", ct) ?? "https://pixoustech.com");

        string? key = await _dal.GetSettingAsync("FIRECRAWL_API_KEY", ct);
        if (string.IsNullOrWhiteSpace(key))
        {
            return new IngestResponse(false, "Firecrawl API key is not configured", null, 0);
        }

        var bodyObj = new JsonObject
        {
            ["url"] = target,
            ["formats"] = new JsonArray("markdown"),
            ["onlyMainContent"] = true
        };

        try
        {
            using var msg = new HttpRequestMessage(HttpMethod.Post, FirecrawlUrl);
            msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
            msg.Content = new StringContent(bodyObj.ToJsonString(), Encoding.UTF8, "application/json");

            var res = await _http.SendAsync(msg, ct);
            if (!res.IsSuccessStatusCode)
            {
                return new IngestResponse(false, $"Firecrawl {(int)res.StatusCode}", null, 0);
            }

            string json = await res.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(json);
            var data = doc.RootElement.GetProperty("data");
            string markdown = data.TryGetProperty("markdown", out var m) ? m.GetString() ?? string.Empty : string.Empty;
            string title = data.TryGetProperty("metadata", out var meta) && meta.TryGetProperty("title", out var tit)
                ? tit.GetString() ?? target : target;

            if (string.IsNullOrWhiteSpace(markdown))
            {
                return new IngestResponse(false, "No content returned for that URL", title, 0);
            }

            if (markdown.Length > MaxIngestChars)
            {
                markdown = markdown[..MaxIngestChars];
            }

            var row = new ChatbotKnowledgeRow
            {
                Source = "firecrawl",
                Title = title,
                Content = $"Source URL: {target}\n\n{markdown}",
                Enabled = true
            };

            await _dal.InsertKnowledgeAsync(row, ct);

            return new IngestResponse(true, "Ingested website content into the knowledge base", title, markdown.Length);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Firecrawl ingest failed: {Message}", ex.Message);
            return new IngestResponse(false, $"Ingestion failed: {ex.Message}", null, 0);
        }
    }

    public async Task<IReadOnlyList<KnowledgeDoc>> KnowledgeAsync(CancellationToken ct = default)
    {
        var all = await _dal.FindAllKnowledgeAsync(ct);
        return all.Select(k => new KnowledgeDoc(
            k.Id,
            k.Source,
            k.Title,
            k.Enabled,
            k.Content?.Length ?? 0
        )).ToList();
    }

    public Task DeleteKnowledgeAsync(long id, CancellationToken ct = default) =>
        _dal.DeleteKnowledgeAsync(id, ct);

    // ---- helpers ------------------------------------------------------------

    private async Task<string> CallGroqChatAsync(
        string system, IReadOnlyList<ChatTurn> history, string message, CancellationToken ct)
    {
        string key = (await _dal.GetSettingAsync("GROQ_API_KEY", ct)) ?? string.Empty;
        string model = (await _dal.GetSettingAsync("GROQ_MODEL", ct)) ?? "llama-3.3-70b-versatile";

        var msgs = new JsonArray
        {
            new JsonObject { ["role"] = "system", ["content"] = system }
        };

        foreach (var t in TrimHistory(history))
        {
            string role = "bot".Equals(t.Role, StringComparison.OrdinalIgnoreCase) ||
                          "assistant".Equals(t.Role, StringComparison.OrdinalIgnoreCase)
                          ? "assistant" : "user";
            msgs.Add(new JsonObject { ["role"] = role, ["content"] = t.Content });
        }

        msgs.Add(new JsonObject { ["role"] = "user", ["content"] = message });

        var payload = new JsonObject
        {
            ["model"] = model,
            ["temperature"] = 0.3,
            ["max_tokens"] = 800,
            ["messages"] = msgs
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, GroqChatUrl);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        req.Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json");

        var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            string err = await res.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"Groq {(int)res.StatusCode}: {err}");
        }

        string json = await res.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(json);
        string? content = doc.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString();

        if (string.IsNullOrWhiteSpace(content))
        {
            throw new InvalidOperationException("Empty Groq response.");
        }

        return content.Trim();
    }

    private async Task<string> CallGeminiAsync(
        string system, IReadOnlyList<ChatTurn> history, string message, CancellationToken ct)
    {
        string key = (await _dal.GetSettingAsync("GEMINI_API_KEY", ct)) ?? string.Empty;
        string model = (await _dal.GetSettingAsync("GEMINI_MODEL", ct)) ?? "gemini-1.5-flash";

        var contents = new JsonArray();
        foreach (var t in TrimHistory(history))
        {
            string role = "bot".Equals(t.Role, StringComparison.OrdinalIgnoreCase) ||
                          "model".Equals(t.Role, StringComparison.OrdinalIgnoreCase)
                          ? "model" : "user";

            contents.Add(new JsonObject
            {
                ["role"] = role,
                ["parts"] = new JsonArray(new JsonObject { ["text"] = t.Content })
            });
        }

        contents.Add(new JsonObject
        {
            ["role"] = "user",
            ["parts"] = new JsonArray(new JsonObject { ["text"] = message })
        });

        var payload = new JsonObject
        {
            ["systemInstruction"] = new JsonObject
            {
                ["parts"] = new JsonArray(new JsonObject { ["text"] = system })
            },
            ["contents"] = contents,
            ["generationConfig"] = new JsonObject
            {
                ["temperature"] = 0.3,
                ["maxOutputTokens"] = 800
            }
        };

        string url = string.Format(GeminiUrl, model, key);
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        req.Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json");

        var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            string err = await res.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"Gemini {(int)res.StatusCode}: {err}");
        }

        string json = await res.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(json);
        string? content = doc.RootElement
            .GetProperty("candidates")[0]
            .GetProperty("content")
            .GetProperty("parts")[0]
            .GetProperty("text")
            .GetString();

        if (string.IsNullOrWhiteSpace(content))
        {
            throw new InvalidOperationException("Empty Gemini response.");
        }

        return content.Trim();
    }

    private async Task<string> BuildSystemPromptAsync(string lang, CancellationToken ct)
    {
        var sb = new StringBuilder();
        sb.AppendLine("You are the Pixous HR Assistant, an advanced AI helper embedded in the Pixous HR Portal.");
        sb.AppendLine($"Reply strictly in {LangName(lang)}, regardless of the language of the question, unless the user explicitly asks for another language.");
        sb.AppendLine("Keep answers clear and concise (usually 1–4 sentences). Use the knowledge below to answer questions about the portal. For general questions, answer helpfully.\n");
        sb.AppendLine(EmsGuide);

        var enabledDocs = await _dal.FindEnabledKnowledgeAsync(ct);
        if (enabledDocs.Count > 0)
        {
            sb.AppendLine("\n=== ADDITIONAL KNOWLEDGE (from the company website / admin) ===");
            int remaining = MaxKnowledgeChars;
            foreach (var doc in enabledDocs)
            {
                if (string.IsNullOrWhiteSpace(doc.Content)) continue;
                if (!string.IsNullOrWhiteSpace(doc.Title)) sb.AppendLine($"# {doc.Title}");
                string chunk = doc.Content.Trim();
                if (chunk.Length > remaining) chunk = chunk[..remaining];
                sb.AppendLine(chunk);
                sb.AppendLine();
                remaining -= chunk.Length;
                if (remaining <= 0) break;
            }
        }

        return sb.ToString();
    }

    private async Task<byte[]?> GoogleTtsAsync(string text, string lang, CancellationToken ct)
    {
        try
        {
            var chunks = new List<string>();
            string rem = text;
            while (!string.IsNullOrEmpty(rem))
            {
                int cut = Math.Min(180, rem.Length);
                if (cut < rem.Length)
                {
                    int sp = rem.LastIndexOf(' ', cut);
                    if (sp > 40) cut = sp;
                }
                chunks.Add(rem[..cut].Trim());
                rem = rem[cut..].Trim();
                if (chunks.Count > 20) break;
            }

            using var ms = new MemoryStream();
            foreach (var c in chunks)
            {
                if (string.IsNullOrEmpty(c)) continue;
                string url = $"https://translate.google.com/translate_tts?ie=UTF-8&tl={lang}&client=tw-ob&q={Uri.EscapeDataString(c)}";
                using var r = new HttpRequestMessage(HttpMethod.Get, url);
                r.Headers.UserAgent.ParseAdd("Mozilla/5.0");

                var res = await _http.SendAsync(r, ct);
                if (res.IsSuccessStatusCode)
                {
                    byte[] b = await res.Content.ReadAsByteArrayAsync(ct);
                    if (b.Length > 0) ms.Write(b, 0, b.Length);
                }
            }

            byte[] result = ms.ToArray();
            return result.Length > 0 ? result : null;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Google TTS failed: {Message}", ex.Message);
            return null;
        }
    }

    private async Task<string> LocalFallbackAsync(string message, string lang, CancellationToken ct)
    {
        string q = message.ToLowerInvariant();
        long? companyId = _currentUser.CompanyId;
        var on = await _dal.GetEnabledModulesAsync(companyId, ct);

        bool canDiscuss(string mod) => on.Count == 0 || on.Contains(mod);

        bool leaveAsked = q.Contains("leave") || q.Contains("விடுப்பு") || q.Contains("छुट्टी") || q.Contains("अवकाश");
        bool attendanceAsked = q.Contains("attendance") || q.Contains("punch") || q.Contains("வருகை") || q.Contains("हाज़िरी") || q.Contains("उपस्थिति");
        bool payAsked = q.Contains("pay") || q.Contains("salary") || q.Contains("payslip") || q.Contains("சம்பள") || q.Contains("वेतन") || q.Contains("सैलरी");
        bool assetAsked = q.Contains("asset") || q.Contains("laptop") || q.Contains("சொத்து") || q.Contains("संपत्ति");

        bool leave = leaveAsked && canDiscuss("LEAVE");
        bool attendance = attendanceAsked && canDiscuss("ATTENDANCE");
        bool pay = payAsked && canDiscuss("PAYROLL");
        bool asset = assetAsked && canDiscuss("ASSETS");

        bool askedSomethingOff = (leaveAsked && !leave) || (attendanceAsked && !attendance)
                                || (payAsked && !pay) || (assetAsked && !asset);

        if (askedSomethingOff)
        {
            return lang switch
            {
                "ta" => "அந்த வசதி உங்கள் நிறுவனத்தில் இயக்கப்படவில்லை. நிர்வாகியை அணுகுங்கள்.",
                "hi" => "यह सुविधा आपकी कंपनी में सक्रिय नहीं है। कृपया अपने प्रशासक से संपर्क करें।",
                _ => "That is not switched on for your company. Ask your administrator if you need it."
            };
        }

        return lang switch
        {
            "ta" => leave ? "'Leave' மெனுவில் உங்கள் விடுப்பு விவரங்களைப் பார்த்து விண்ணப்பிக்கலாம்."
                 : attendance ? "Dashboard-இல் 'Punch In/Out' மூலம் வருகையைப் பதிவு செய்யலாம்; விவரங்கள் 'Attendance' பக்கத்தில்."
                 : pay ? "உங்கள் சம்பள விவரங்களையும் பேஸ்லிப்களையும் 'Payslips' பக்கத்தில் காணலாம்."
                 : asset ? "உங்களுக்கு வழங்கப்பட்ட சாதனங்கள் 'Assets' மெனுவில் பட்டியலிடப்பட்டுள்ளன."
                 : "நான் Pixous HR உதவியாளர். விடுப்பு, வருகை, சம்பளம், சொத்துக்கள் குறித்து கேளுங்கள். (AI சேவை தற்காலிகமாக கிடைக்கவில்லை.)",

            "hi" => leave ? "'Leave' मेन्यू में आप अपनी छुट्टी का बैलेंस देख सकते हैं और आवेदन कर सकते हैं।"
                 : attendance ? "Dashboard पर 'Punch In/Out' से हाज़िरी दर्ज करें; विवरण 'Attendance' पेज पर देखें।"
                 : pay ? "अपने वेतन और मासिक पे-स्लिप 'Payslips' पेज पर देखें और डाउनलोड करें।"
                 : asset ? "आपको सौंपे गए कंपनी उपकरण 'Assets' मेन्यू में सूचीबद्ध हैं।"
                 : "मैं Pixous HR सहायक हूँ। छुट्टी, हाज़िरी, वेतन और संपत्ति के बारे में पूछें। (AI सेवा अभी उपलब्ध नहीं है।)",

            _ => leave ? "You can check your leave balance and apply under the 'Leave' menu."
               : attendance ? "Punch in/out on the Dashboard, and view your logs under 'Attendance'."
               : pay ? "View and download your monthly payslips under the 'Payslips' menu."
               : asset ? "Company devices assigned to you are listed under the 'Assets' menu."
               : "I'm the Pixous HR Assistant. Ask me about leave, attendance, payslips or assets. (The AI service is temporarily unavailable.)"
        };
    }

    private static IReadOnlyList<ChatTurn> TrimHistory(IReadOnlyList<ChatTurn> history)
    {
        var clean = history.Where(t => !string.IsNullOrWhiteSpace(t.Content)).ToList();
        return clean.Count > MaxHistoryTurns ? clean.TakeLast(MaxHistoryTurns).ToList() : clean;
    }

    private static string NormaliseLang(string? lang)
    {
        if (string.IsNullOrWhiteSpace(lang)) return "en";
        string l = lang.Trim().ToLowerInvariant();
        if (l.StartsWith("ta")) return "ta";
        if (l.StartsWith("hi")) return "hi";
        return "en";
    }

    private static string LangName(string lang) => NormaliseLang(lang) switch
    {
        "ta" => "Tamil (தமிழ்)",
        "hi" => "Hindi (हिन्दी)",
        _ => "English"
    };

    private static string MapWhisperLanguage(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "en";
        string r = raw.Trim().ToLowerInvariant();
        if (r.StartsWith("ta") || r.Contains("tamil")) return "ta";
        if (r.StartsWith("hi") || r.Contains("hindi")) return "hi";
        return "en";
    }

    private static string Mask(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        string v = value.Trim();
        if (v.Length <= 8) return "••••";
        return v[..4] + "••••••••" + v[^4..];
    }

    private async Task PutIfPresentAsync(string key, string? value, string description, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            await _dal.SetSettingAsync(key, value.Trim(), description, ct);
        }
    }
}
