namespace Pixous.HrPortal.Domain.Modules.Chatbot;

/// <summary>Request/response payloads for the AI assistant endpoints.</summary>
public sealed record ChatTurn(string Role, string Content);

public sealed record ChatRequest(string Message, string? Lang, IReadOnlyList<ChatTurn>? History);

public sealed record ChatResponse(string Reply, string Provider, string Lang);

public sealed record TtsRequest(string? Text, string? Lang, string? VoiceId);

public sealed record SttResponse(string Text, string Lang);

public sealed record TranslateRequest(string? Text, string? TargetLang);

public sealed record TranslateResponse(string Text, string TargetLang);

/// <summary>Public, secret-free config the widget reads on startup.</summary>
public sealed record ChatbotConfig(
    bool Enabled,
    bool TtsAvailable,
    bool SttAvailable,
    bool LlmAvailable,
    string AssistantName,
    IReadOnlyList<string> Languages);

/// <summary>Admin view — keys are masked, never returned in full.</summary>
public sealed record AdminSettingsResponse(
    bool Enabled,
    string LlmProvider,
    string GroqModel,
    string GroqSttModel,
    string GeminiModel,
    string ElevenLabsVoiceId,
    string ElevenLabsModel,
    string WebsiteUrl,
    bool GroqKeySet,
    bool GeminiKeySet,
    bool ElevenLabsKeySet,
    bool FirecrawlKeySet,
    string GroqKeyMasked,
    string GeminiKeyMasked,
    string ElevenLabsKeyMasked,
    string FirecrawlKeyMasked,
    int KnowledgeDocs);

/// <summary>
/// Admin update. Every field is optional (null = leave unchanged).
/// Send a non-blank key to replace it; keys are write-only.
/// </summary>
public sealed record AdminSettingsRequest
{
    public bool? Enabled { get; init; }
    public string? LlmProvider { get; init; }
    public string? GroqModel { get; init; }
    public string? GroqSttModel { get; init; }
    public string? GeminiModel { get; init; }
    public string? ElevenLabsVoiceId { get; init; }
    public string? ElevenLabsModel { get; init; }
    public string? WebsiteUrl { get; init; }
    public string? GroqApiKey { get; init; }
    public string? GeminiApiKey { get; init; }
    public string? ElevenLabsApiKey { get; init; }
    public string? FirecrawlApiKey { get; init; }
}

public sealed record IngestRequest(string? Url);

public sealed record IngestResponse(bool Ok, string Message, string? Title, int Chars);

public sealed record KnowledgeDoc(long Id, string Source, string? Title, bool Enabled, int Chars);

public sealed class ChatbotKnowledgeRow
{
    public long Id { get; set; }
    public string Source { get; set; } = string.Empty;
    public string? Title { get; set; }
    public string Content { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
