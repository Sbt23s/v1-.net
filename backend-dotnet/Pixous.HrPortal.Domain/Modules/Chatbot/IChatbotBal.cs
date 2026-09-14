namespace Pixous.HrPortal.Domain.Modules.Chatbot;

public interface IChatbotBal
{
    Task<ChatbotConfig> ConfigAsync(CancellationToken ct = default);
    Task<ChatResponse> ChatAsync(ChatRequest req, bool privileged, CancellationToken ct = default);
    Task<TranslateResponse> TranslateAsync(TranslateRequest req, CancellationToken ct = default);
    Task<byte[]?> TextToSpeechAsync(TtsRequest req, CancellationToken ct = default);
    Task<SttResponse> SpeechToTextAsync(byte[] audio, string? filename, string? contentType, string? lang, CancellationToken ct = default);
    Task<AdminSettingsResponse> AdminSettingsAsync(CancellationToken ct = default);
    Task UpdateSettingsAsync(AdminSettingsRequest req, CancellationToken ct = default);
    Task<IngestResponse> IngestWebsiteAsync(string? url, CancellationToken ct = default);
    Task<IReadOnlyList<KnowledgeDoc>> KnowledgeAsync(CancellationToken ct = default);
    Task DeleteKnowledgeAsync(long id, CancellationToken ct = default);
}
