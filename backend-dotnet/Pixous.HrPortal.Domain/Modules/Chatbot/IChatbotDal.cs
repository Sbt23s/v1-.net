namespace Pixous.HrPortal.Domain.Modules.Chatbot;

public interface IChatbotDal
{
    Task<string?> GetSettingAsync(string key, CancellationToken ct = default);
    Task SetSettingAsync(string key, string value, string? description, CancellationToken ct = default);
    Task<IReadOnlyList<ChatbotKnowledgeRow>> FindAllKnowledgeAsync(CancellationToken ct = default);
    Task<IReadOnlyList<ChatbotKnowledgeRow>> FindEnabledKnowledgeAsync(CancellationToken ct = default);
    Task<long> InsertKnowledgeAsync(ChatbotKnowledgeRow row, CancellationToken ct = default);
    Task DeleteKnowledgeAsync(long id, CancellationToken ct = default);
    Task<string> GetLiveOrgContextAsync(CancellationToken ct = default);
    Task<string> GetPeopleMentionedContextAsync(string question, CancellationToken ct = default);
    Task<string?> GetDirectAnswerAsync(string question, string lang, CancellationToken ct = default);
    Task<IReadOnlySet<string>> GetEnabledModulesAsync(long? companyId, CancellationToken ct = default);
}
