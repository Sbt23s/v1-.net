using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Helpdesk;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Support tickets, ported from
/// com.pixous.hrportal.modules.helpdesk.HelpdeskController.
/// </summary>
[ApiController]
[Route("api/tickets")]
[Authorize]
public sealed class HelpdeskController : ControllerBase
{
    private readonly IHelpdeskBal _helpdesk;
    private readonly IStorageService _storage;
    private readonly ICurrentUser _currentUser;

    public HelpdeskController(
        IHelpdeskBal helpdesk,
        IStorageService storage,
        ICurrentUser currentUser)
    {
        _helpdesk = helpdesk;
        _storage = storage;
        _currentUser = currentUser;
    }

    [HttpGet]
    public async Task<PageResponse<TicketResponse>> MyTickets(
        [FromQuery] int page = 0,
        [FromQuery] int size = 20,
        CancellationToken ct = default) =>
        await _helpdesk.MyTicketsPagedAsync(_currentUser.RequireUserId(), page, size, ct);

    [HttpGet("me")]
    public async Task<ApiResponse<IReadOnlyList<TicketRecord>>> Mine(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<TicketRecord>>.Ok(
            await _helpdesk.MineAsync(_currentUser.RequireUserId(), ct));

    [HttpPost]
    public async Task<ApiResponse<TicketResponse>> Create(
        [FromBody] RaiseTicketRequest request,
        CancellationToken ct) =>
        ApiResponse<TicketResponse>.Ok(
            await _helpdesk.RaiseTicketAsync(_currentUser.RequireUserId(), request, ct),
            "Ticket raised");

    [HttpPost("upload")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, string>>> Upload(
        IFormFile file,
        CancellationToken ct)
    {
        if (file == null || file.Length == 0)
        {
            throw ApiException.Business("No file received");
        }

        using Stream stream = file.OpenReadStream();
        string path = await _storage.StoreAsync(
            stream,
            file.FileName,
            file.ContentType,
            file.Length,
            "ticket-attachments",
            ct);

        return ApiResponse<IReadOnlyDictionary<string, string>>.Ok(
            new Dictionary<string, string> { ["path"] = path },
            "Attachment uploaded");
    }

    [HttpGet("agents")]
    public async Task<ApiResponse<IReadOnlyList<AgentView>>> Agents(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<AgentView>>.Ok(
            await _helpdesk.GetAgentsAsync(_currentUser.RequireUserId(), ct));

    [HttpGet("assigned-to-me")]
    [Authorize(Policy = "HELPDESK_AGENT")]
    public async Task<PageResponse<TicketResponse>> AgentQueue(
        [FromQuery] string? status,
        [FromQuery] int page = 0,
        [FromQuery] int size = 20,
        CancellationToken ct = default) =>
        await _helpdesk.AgentQueuePagedAsync(_currentUser.RequireUserId(), status, page, size, ct);

    [HttpGet("all")]
    [Authorize(Policy = "HELPDESK_AGENT,USER_MANAGE,DASHBOARD_EXEC")]
    public async Task<PageResponse<TicketResponse>> AllTickets(
        [FromQuery] string? status,
        [FromQuery] int page = 0,
        [FromQuery] int size = 50,
        CancellationToken ct = default) =>
        await _helpdesk.AllTicketsPagedAsync(_currentUser.RequireUserId(), status, page, size, ct);

    [HttpPut("{id:long}")]
    public async Task<ApiResponse<TicketResponse>> Update(
        long id,
        [FromBody] RaiseTicketRequest request,
        CancellationToken ct) =>
        ApiResponse<TicketResponse>.Ok(
            await _helpdesk.UpdateOwnAsync(_currentUser.RequireUserId(), id, request, ct),
            "Ticket updated");

    [HttpPost("{id:long}/cancel")]
    public async Task<ApiResponse<object>> Cancel(long id, CancellationToken ct)
    {
        await _helpdesk.CancelOwnAsync(_currentUser.RequireUserId(), id, ct);
        return ApiResponse.Message("Ticket cancelled");
    }

    [HttpGet("{id:long}")]
    public async Task<ApiResponse<TicketResponse>> Get(long id, CancellationToken ct) =>
        ApiResponse<TicketResponse>.Ok(await _helpdesk.GetResponseAsync(id, ct));

    [HttpPost("{id:long}/comments")]
    public async Task<ApiResponse<CommentResponse>> Comment(
        long id,
        [FromBody] CommentRequest request,
        CancellationToken ct) =>
        ApiResponse<CommentResponse>.Ok(
            await _helpdesk.AddCommentAsync(
                _currentUser.RequireUserId(),
                id,
                request.Comment ?? string.Empty,
                request.AttachmentPath,
                ct),
            "Comment added");

    [HttpPost("{id:long}/status")]
    [Authorize(Policy = "HELPDESK_AGENT")]
    public async Task<ApiResponse<TicketResponse>> ChangeStatus(
        long id,
        [FromBody] StatusRequest request,
        CancellationToken ct) =>
        ApiResponse<TicketResponse>.Ok(
            await _helpdesk.ChangeStatusResponseAsync(
                _currentUser.RequireUserId(),
                id,
                request.Status,
                request.AssignTo,
                ct),
            "Status updated");

    [HttpPost("{id:long}/rating")]
    public async Task<ApiResponse<TicketResponse>> Rate(
        long id,
        [FromBody] RatingRequest request,
        CancellationToken ct) =>
        ApiResponse<TicketResponse>.Ok(
            await _helpdesk.RateTicketAsync(_currentUser.RequireUserId(), id, request.Rating, ct),
            "Thanks for the feedback");

    public sealed record StatusRequest(string? Status, long? AssignTo);
    public sealed record CommentRequest(string? Comment, string? AttachmentPath);
    public sealed record RatingRequest(int Rating);
}
