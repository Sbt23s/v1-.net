using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Modules.Community;
using Pixous.HrPortal.Domain.Modules.User;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Communities: group chat, direct conversations, announcements and calling.
/// Ported from CommunityController.java.
///
/// NOTE: Endpoints return bare JSON (records/lists), NOT ApiResponse envelope,
/// to maintain 100% contract parity with Spring Boot and the React frontend.
/// </summary>
[ApiController]
[Route("api/communities")]
[Authorize]
public sealed class CommunityController : ControllerBase
{
    private readonly ICommunityBal _bal;
    private readonly ICurrentUser _currentUser;

    public CommunityController(ICommunityBal bal, ICurrentUser currentUser)
    {
        _bal = bal;
        _currentUser = currentUser;
    }

    [HttpGet("me")]
    public async Task<IReadOnlyList<CommunityRoom>> Mine(CancellationToken ct) =>
        await _bal.MyCommunitiesAsync(_currentUser.RequireUserId(), ct);

    [HttpGet]
    public async Task<IReadOnlyList<CommunityRoom>> All(CancellationToken ct) =>
        await _bal.AllCommunitiesAsync(_currentUser.RequireUserId(), ct);

    [HttpPost]
    public async Task<CommunityRoom> Create(
        [FromBody] CreateGroupRequest request, CancellationToken ct) =>
        await _bal.CreateGroupAsync(_currentUser.RequireUserId(), request, ct);

    [HttpGet("diagnose")]
    public async Task<DiagnoseResult> Diagnose(CancellationToken ct) =>
        await _bal.DiagnoseAsync(_currentUser.RequireUserId(), ct);

    [HttpGet("contacts")]
    public async Task<IReadOnlyList<UserSummary>> Contacts(CancellationToken ct) =>
        await _bal.GetContactsAsync(_currentUser.RequireUserId(), ct);

    [HttpPost("direct/{userId:long}")]
    public async Task<CommunityRoom> OpenDirect(long userId, CancellationToken ct) =>
        await _bal.OpenDirectAsync(_currentUser.RequireUserId(), userId, ct);

    [HttpPost("team")]
    public async Task<CommunityRoom> OpenTeam(CancellationToken ct) =>
        await _bal.OpenTeamRoomAsync(_currentUser.RequireUserId(), ct);

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        await _bal.DeleteGroupAsync(id, _currentUser.RequireUserId(), ct);
        return Ok();
    }

    [HttpGet("{id:long}/members")]
    public async Task<IReadOnlyList<CommunityMemberView>> Members(
        long id, CancellationToken ct) =>
        await _bal.MembersAsync(id, _currentUser.RequireUserId(), ct);

    [HttpPost("{id:long}/members")]
    public async Task<IActionResult> AddMember(
        long id, [FromBody] MemberRequest body, CancellationToken ct)
    {
        await _bal.AddMemberAsync(id, body.UserId, _currentUser.RequireUserId(), ct);
        return Ok();
    }

    [HttpDelete("{id:long}/members/{userId:long}")]
    public async Task<IActionResult> RemoveMember(
        long id, long userId, CancellationToken ct)
    {
        await _bal.RemoveMemberAsync(id, userId, _currentUser.RequireUserId(), ct);
        return Ok();
    }

    [HttpGet("{id:long}/messages")]
    public async Task<IReadOnlyList<ChatMessage>> Messages(
        long id, CancellationToken ct) =>
        await _bal.MessagesAsync(id, _currentUser.RequireUserId(), ct);

    [HttpPost("{id:long}/messages")]
    public async Task<IActionResult> Send(
        long id, [FromBody] SendMessageRequest request, CancellationToken ct)
    {
        await _bal.SendMessageAsync(id, _currentUser.RequireUserId(), request, ct);
        return Ok();
    }

    [HttpGet("{id:long}/messages/search")]
    public async Task<IReadOnlyList<ChatMessage>> Search(
        long id, [FromQuery] string q, CancellationToken ct) =>
        await _bal.SearchMessagesAsync(id, q, _currentUser.RequireUserId(), ct);

    [HttpGet("{id:long}/messages/pinned")]
    public async Task<IReadOnlyList<ChatMessage>> Pinned(
        long id, CancellationToken ct) =>
        await _bal.PinnedMessagesAsync(id, _currentUser.RequireUserId(), ct);

    [HttpPost("messages/{messageId:long}/pin")]
    public async Task<IActionResult> SetPinned(
        long messageId, [FromBody] SetPinnedRequest body, CancellationToken ct)
    {
        await _bal.SetPinnedAsync(messageId, body.Pinned, _currentUser.RequireUserId(), ct);
        return Ok();
    }

    [HttpPost("messages/{messageId:long}/reactions")]
    public async Task<IActionResult> React(
        long messageId, [FromBody] ToggleReactionRequest body, CancellationToken ct)
    {
        await _bal.ToggleReactionAsync(messageId, body.Emoji ?? string.Empty, _currentUser.RequireUserId(), ct);
        return Ok();
    }

    [HttpPost("messages/{messageId:long}/read")]
    public async Task<IActionResult> MarkRead(long messageId, CancellationToken ct)
    {
        await _bal.MarkReadAsync(messageId, _currentUser.RequireUserId(), ct);
        return Ok();
    }

    [HttpPost("messages/{messageId:long}/acknowledge")]
    public async Task<IActionResult> Acknowledge(long messageId, CancellationToken ct)
    {
        await _bal.AcknowledgeAsync(messageId, _currentUser.RequireUserId(), ct);
        return Ok();
    }

    [HttpGet("messages/{messageId:long}/receipts")]
    public async Task<ReadReceiptsResult> Receipts(long messageId, CancellationToken ct) =>
        await _bal.ReadReceiptsAsync(messageId, _currentUser.RequireUserId(), ct);

    [HttpPost("messages/{messageId:long}/vote")]
    public async Task<IActionResult> Vote(
        long messageId, [FromBody] VotePollRequest body, CancellationToken ct)
    {
        if (!body.OptionIndex.HasValue) return BadRequest(new { message = "Which choice?" });
        await _bal.VotePollAsync(messageId, body.OptionIndex.Value, _currentUser.RequireUserId(), ct);
        return Ok();
    }

    [HttpGet("retention")]
    public async Task<object> Retention(CancellationToken ct) =>
        new { days = await _bal.GetRetentionDaysAsync(ct) };

    [HttpPut("retention")]
    public async Task<IActionResult> SetRetention(
        [FromBody] SetRetentionRequest body, CancellationToken ct)
    {
        if (!body.Days.HasValue) return BadRequest(new { message = "How many days?" });
        await _bal.SetRetentionDaysAsync(body.Days.Value, _currentUser.RequireUserId(), ct);
        return Ok();
    }

    [HttpPost("{id:long}/voice")]
    public async Task<IActionResult> SendVoice(
        long id, CancellationToken ct)
    {
        var file = Request.HasFormContentType && Request.Form.Files.Count > 0
            ? Request.Form.Files[0]
            : null;
        if (file is null || file.Length == 0) return BadRequest(new { message = "Audio file required." });
        using var stream = file.OpenReadStream();
        await _bal.SendVoiceAsync(id, _currentUser.RequireUserId(), stream, file.FileName, file.ContentType, ct);
        return Ok();
    }

    [HttpPost("{id:long}/attachments")]
    public async Task<IActionResult> SendAttachments(
        long id, [FromQuery] string? caption, CancellationToken ct)
    {
        var effectiveCaption = caption ?? (Request.HasFormContentType ? Request.Form["caption"].FirstOrDefault() : null);
        var files = Request.HasFormContentType ? Request.Form.Files : null;
        if (files is null || files.Count == 0) return BadRequest(new { message = "Files required." });
        var list = new List<(Stream, string, string)>();
        foreach (var f in files)
        {
            list.Add((f.OpenReadStream(), f.FileName, f.ContentType));
        }

        try
        {
            await _bal.SendAttachmentsAsync(id, _currentUser.RequireUserId(), list, effectiveCaption, ct);
            return Ok();
        }
        finally
        {
            foreach (var item in list)
            {
                item.Item1.Dispose();
            }
        }
    }

    [HttpDelete("messages/{messageId:long}")]
    public async Task<IActionResult> DeleteMessage(long messageId, CancellationToken ct)
    {
        await _bal.DeleteMessageAsync(messageId, _currentUser.RequireUserId(), ct);
        return Ok();
    }
}

/// <summary>Adding somebody to a room.</summary>
public sealed record MemberRequest
{
    public long UserId { get; init; }
}
