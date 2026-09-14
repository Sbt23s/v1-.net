using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.RequestThread;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Files and conversation on a leave or permission request.
/// Ported from RequestThreadController.
///
/// <c>type</c> is LEAVE or PERMISSION. One set of routes for both, because the
/// records differ only in what they hang off, and two sets would mean two of
/// every future change.
///
/// <para>No permission policy on these routes, ON PURPOSE. They are not gated
/// by a permission but by a RELATIONSHIP — you may read a request you raised,
/// one addressed to you, or any if you oversee the process — and that is
/// decided in the BAL, once, so no route can forget it.</para>
/// </summary>
[ApiController]
[Route("api/requests")]
[Authorize]
public sealed class RequestThreadController : ControllerBase
{
    private readonly IRequestThreadBal _bal;
    private readonly ICurrentUser _currentUser;

    public RequestThreadController(IRequestThreadBal bal, ICurrentUser currentUser)
    {
        _bal = bal;
        _currentUser = currentUser;
    }

    /// <summary>Every comment written to me, across every request.</summary>
    [HttpGet("comments/inbox")]
    public async Task<ApiResponse<IReadOnlyList<InboxComment>>> Inbox(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<InboxComment>>.Ok(
            await _bal.InboxAsync(_currentUser.UserId, ct));

    /// <summary>What this request is — for a thread opened from a notification.</summary>
    [HttpGet("{type}/{id:long}/summary")]
    public async Task<ApiResponse<RequestSummary>> Summary(string type, long id,
                                                           CancellationToken ct) =>
        ApiResponse<RequestSummary>.Ok(await _bal.SummaryAsync(type, id, ct));

    /// <summary>Files attached to this request.</summary>
    [HttpGet("{type}/{id:long}/attachments")]
    public async Task<ApiResponse<IReadOnlyList<AttachmentView>>> Attachments(
        string type, long id, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<AttachmentView>>.Ok(
            await _bal.ListAttachmentsAsync(type, id, ct));

    /// <summary>Attach a photograph or document.</summary>
    [HttpPost("{type}/{id:long}/attachments")]
    [Consumes("multipart/form-data")]
    public async Task<ApiResponse<AttachmentView>> Attach(
        string type, long id, IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
        {
            throw ApiException.Business("There is nothing to upload — the file came through empty.");
        }

        using Stream stream = file.OpenReadStream();
        AttachmentView result = await _bal.AttachAsync(
            type, id, stream, file.FileName, file.ContentType, file.Length,
            _currentUser.RequireUserId(), ct);

        return ApiResponse<AttachmentView>.Ok(result, "Attached");
    }


    /// <summary>Removes a file you uploaded.</summary>
    [HttpDelete("{type}/{id:long}/attachments/{attachmentId:long}")]
    public async Task<ApiResponse<object>> RemoveAttachment(
        string type, long id, long attachmentId, CancellationToken ct)
    {
        await _bal.DeleteAttachmentAsync(attachmentId, ct);
        return ApiResponse<object>.MessageOnly("Removed");
    }

    /// <summary>The conversation about this request.</summary>
    [HttpGet("{type}/{id:long}/comments")]
    public async Task<ApiResponse<IReadOnlyList<CommentView>>> Comments(
        string type, long id, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<CommentView>>.Ok(await _bal.ListCommentsAsync(type, id, ct));

    /// <summary>Says something about this request.</summary>
    [HttpPost("{type}/{id:long}/comments")]
    public async Task<ApiResponse<CommentView>> Comment(
        string type, long id, [FromBody] CommentRequest request, CancellationToken ct) =>
        ApiResponse<CommentView>.Ok(await _bal.CommentAsync(type, id, request, ct), "Sent");
}
