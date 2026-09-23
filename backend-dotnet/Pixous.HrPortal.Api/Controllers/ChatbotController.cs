using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Chatbot;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// AI assistant API. Chat / TTS / STT / translate are available to any
/// authenticated user; everything under /admin requires USER_MANAGE.
/// Ported from ChatbotController.java.
/// </summary>
[ApiController]
[Route("api/chatbot")]
[Authorize]
public sealed class ChatbotController : ControllerBase
{
    private readonly IChatbotBal _chatbotBal;
    private readonly ICurrentUser _currentUser;

    public ChatbotController(IChatbotBal chatbotBal, ICurrentUser currentUser)
    {
        _chatbotBal = chatbotBal;
        _currentUser = currentUser;
    }

    [HttpGet("config")]
    public async Task<ApiResponse<ChatbotConfig>> Config(CancellationToken ct) =>
        ApiResponse<ChatbotConfig>.Ok(await _chatbotBal.ConfigAsync(ct));

    [HttpPost("chat")]
    public async Task<ApiResponse<ChatResponse>> Chat([FromBody] ChatRequest req, CancellationToken ct)
    {
        bool privileged = _currentUser.HasPermission("USER_MANAGE") || _currentUser.HasPermission("DASHBOARD_EXEC");
        return ApiResponse<ChatResponse>.Ok(await _chatbotBal.ChatAsync(req, privileged, ct));
    }

    [HttpPost("translate")]
    public async Task<ApiResponse<TranslateResponse>> Translate([FromBody] TranslateRequest req, CancellationToken ct) =>
        ApiResponse<TranslateResponse>.Ok(await _chatbotBal.TranslateAsync(req, ct));

    [HttpGet("tts")]
    public async Task<IActionResult> TtsGet([FromQuery] string text, [FromQuery] string? lang, [FromQuery] string? voiceId, CancellationToken ct)
    {
        byte[]? audio = await _chatbotBal.TextToSpeechAsync(new TtsRequest(text, lang ?? "en", voiceId), ct);
        if (audio is null || audio.Length == 0) return NoContent();
        return File(audio, "audio/mpeg");
    }

    [HttpPost("tts")]
    public async Task<IActionResult> Tts([FromBody] TtsRequest req, CancellationToken ct)
    {
        byte[]? audio = await _chatbotBal.TextToSpeechAsync(req, ct);
        if (audio is null || audio.Length == 0) return NoContent();
        return File(audio, "audio/mpeg");
    }

    [HttpPost("stt")]
    public async Task<ApiResponse<SttResponse>> Stt(
        IFormFile? audio, [FromQuery] string? lang, CancellationToken ct)
    {
        if (audio is null || audio.Length == 0)
        {
            throw ApiException.BadRequest("Audio is required.");
        }

        using var ms = new MemoryStream();
        await audio.CopyToAsync(ms, ct);
        return ApiResponse<SttResponse>.Ok(
            await _chatbotBal.SpeechToTextAsync(ms.ToArray(), audio.FileName, audio.ContentType, lang, ct));
    }

    // ------------------------------------------------------------ admin only

    [HttpGet("admin/settings")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<AdminSettingsResponse>> AdminSettings(CancellationToken ct) =>
        ApiResponse<AdminSettingsResponse>.Ok(await _chatbotBal.AdminSettingsAsync(ct));

    [HttpPut("admin/settings")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<AdminSettingsResponse>> UpdateSettings(
        [FromBody] AdminSettingsRequest req, CancellationToken ct)
    {
        await _chatbotBal.UpdateSettingsAsync(req, ct);
        return ApiResponse<AdminSettingsResponse>.Ok(await _chatbotBal.AdminSettingsAsync(ct), "Settings saved");
    }

    [HttpPost("admin/ingest")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<IngestResponse>> Ingest(
        [FromBody] IngestRequest? req, CancellationToken ct) =>
        ApiResponse<IngestResponse>.Ok(await _chatbotBal.IngestWebsiteAsync(req?.Url, ct));

    [HttpGet("admin/knowledge")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<IReadOnlyList<KnowledgeDoc>>> Knowledge(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<KnowledgeDoc>>.Ok(await _chatbotBal.KnowledgeAsync(ct));

    [HttpDelete("admin/knowledge/{id:long}")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<object>> DeleteKnowledge(long id, CancellationToken ct)
    {
        await _chatbotBal.DeleteKnowledgeAsync(id, ct);
        return ApiResponse<object>.MessageOnly("Deleted");
    }
}
