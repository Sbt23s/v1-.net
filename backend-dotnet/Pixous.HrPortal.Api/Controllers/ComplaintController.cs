using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Complaint;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Complaints and needs, ported from
/// com.pixous.hrportal.modules.complaint.ComplaintController.
///
/// Not yet ported: /recipients, which lists the desks a complaint may be sent to.
/// </summary>
[ApiController]
[Route("api/complaints")]
[Authorize]
public sealed class ComplaintController : ControllerBase
{
    private readonly IComplaintBal _complaints;
    private readonly ICurrentUser _currentUser;

    public ComplaintController(IComplaintBal complaints, ICurrentUser currentUser)
    {
        _complaints = complaints;
        _currentUser = currentUser;
    }

    [HttpPost]
    public async Task<ApiResponse<ComplaintRecord>> Raise([FromBody] ComplaintRequest request,
                                                          CancellationToken ct) =>
        ApiResponse<ComplaintRecord>.Ok(
            await _complaints.RaiseAsync(_currentUser.RequireUserId(), request, ct));

    [HttpGet("recipients")]
    public async Task<ApiResponse<IReadOnlyList<ComplaintRecipientView>>> Recipients(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<ComplaintRecipientView>>.Ok(
            await _complaints.RecipientsAsync(_currentUser.RequireUserId(), ct));

    /// <summary>Complaints the caller raised. No permission needed.</summary>
    [HttpGet("mine")]
    public async Task<ApiResponse<IReadOnlyList<ComplaintRecord>>> Mine(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<ComplaintRecord>>.Ok(
            await _complaints.MineAsync(_currentUser.RequireUserId(), ct));


    [HttpGet]
    [Authorize(Policy = "USER_MANAGE,COMPLAINT_MANAGE")]
    public async Task<ApiResponse<IReadOnlyList<ComplaintRecord>>> All(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<ComplaintRecord>>.Ok(await _complaints.AllAsync(ct));

    [HttpGet("{id:long}")]
    public async Task<ApiResponse<ComplaintRecord>> Get(long id, CancellationToken ct) =>
        ApiResponse<ComplaintRecord>.Ok(await _complaints.GetAsync(id, ct));

    [HttpPost("{id:long}/respond")]
    [Authorize(Policy = "USER_MANAGE,COMPLAINT_MANAGE")]
    public async Task<ApiResponse<ComplaintRecord>> Respond(long id,
                                                            [FromBody] DecisionRequest request,
                                                            CancellationToken ct) =>
        ApiResponse<ComplaintRecord>.Ok(
            await _complaints.RespondAsync(_currentUser.RequireUserId(), id,
                                           request.Status, request.Response, ct));

    [HttpPost("{id:long}/cancel")]
    public async Task<ApiResponse<ComplaintRecord>> Cancel(long id, CancellationToken ct) =>
        ApiResponse<ComplaintRecord>.Ok(
            await _complaints.CancelAsync(_currentUser.RequireUserId(), id, ct));

    public sealed record DecisionRequest(string? Status, string? Response);
}
