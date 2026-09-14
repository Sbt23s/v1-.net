using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Expense;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Travel-allowance claims, ported from
/// com.pixous.hrportal.modules.expense.TaExpenseController.
/// </summary>
[ApiController]
[Route("api/ta-expenses")]
[Authorize]
public sealed class ExpenseController : ControllerBase
{
    private static readonly string[] ApproverPermissions =
        ["USER_MANAGE", "DASHBOARD_EXEC", "CLAIM_APPROVE", "ORG_MANAGE"];

    private readonly IExpenseBal _expenses;
    private readonly IStorageService _storage;
    private readonly ICurrentUser _currentUser;

    public ExpenseController(
        IExpenseBal expenses,
        IStorageService storage,
        ICurrentUser currentUser)
    {
        _expenses = expenses;
        _storage = storage;
        _currentUser = currentUser;
    }

    private bool IsApprover() =>
        User.FindAll("roles").Any(c => ApproverPermissions.Contains(c.Value, StringComparer.Ordinal));

    [HttpPost("upload")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, string>>> UploadAttachment(
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
            "ta-attachments",
            ct);

        return ApiResponse<IReadOnlyDictionary<string, string>>.Ok(
            new Dictionary<string, string> { ["path"] = path },
            "Attachment uploaded");
    }

    [HttpPost]
    public async Task<ApiResponse<ExpenseRecord>> Create(
        [FromBody] ExpenseRequest request,
        CancellationToken ct) =>
        ApiResponse<ExpenseRecord>.Ok(
            await _expenses.CreateAsync(_currentUser.RequireUserId(), request, ct));

    [HttpPut("{id:long}")]
    public async Task<ApiResponse<ExpenseRecord>> Update(
        long id,
        [FromBody] ExpenseRequest request,
        CancellationToken ct) =>
        ApiResponse<ExpenseRecord>.Ok(
            await _expenses.UpdateAsync(_currentUser.RequireUserId(), id, request, IsApprover(), ct),
            "Claim updated");

    [HttpGet("me")]
    public async Task<ApiResponse<IReadOnlyList<ExpenseRecord>>> Mine(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<ExpenseRecord>>.Ok(
            await _expenses.MineAsync(_currentUser.RequireUserId(), ct));

    [HttpGet("team")]
    public async Task<ApiResponse<IReadOnlyList<ExpenseRecord>>> Team(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<ExpenseRecord>>.Ok(
            await _expenses.MyTeamAsync(_currentUser.RequireUserId(), ct));

    [HttpGet("all")]
    [Authorize(Policy = "USER_MANAGE,DASHBOARD_EXEC,CLAIM_APPROVE")]
    public async Task<ApiResponse<IReadOnlyList<ExpenseRecord>>> All(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<ExpenseRecord>>.Ok(await _expenses.AllAsync(ct));

    [HttpPut("{id:long}/status")]
    [Authorize(Policy = "USER_MANAGE,DASHBOARD_EXEC,CLAIM_APPROVE")]
    public async Task<ApiResponse<ExpenseRecord>> UpdateStatus(
        long id,
        [FromBody] DecisionRequest request,
        CancellationToken ct) =>
        ApiResponse<ExpenseRecord>.Ok(
            await _expenses.DecideAsync(
                _currentUser.RequireUserId(),
                id,
                request.Status,
                request.Comment,
                ct));

    [HttpPost("{id:long}/cancel")]
    public async Task<ApiResponse<object>> Cancel(long id, CancellationToken ct)
    {
        await _expenses.CancelAsync(_currentUser.RequireUserId(), id, ct);
        return ApiResponse.Message("Claim cancelled");
    }

    [HttpDelete("{id:long}")]
    public async Task<ApiResponse<object>> Delete(long id, CancellationToken ct)
    {
        await _expenses.DeleteAsync(_currentUser.RequireUserId(), id, IsApprover(), ct);
        return ApiResponse.Message("Claim deleted");
    }

    public sealed record DecisionRequest(string? Status, string? Comment);
}
