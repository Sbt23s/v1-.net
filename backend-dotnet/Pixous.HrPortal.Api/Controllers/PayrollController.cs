using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Payroll;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Payroll endpoints, ported from
/// com.pixous.hrportal.modules.payroll.PayrollController.
///
/// The permission split is the Java one: PAYROLL_RUN to generate or change
/// figures, PAYROLL_VIEW to read someone else's, and neither for the two
/// self-service reads -- an employee sees their own payslips without holding a
/// payroll permission.
/// </summary>
[ApiController]
[Route("api/payroll")]
[Authorize]
public sealed class PayrollController : ControllerBase
{
    private readonly IPayrollBal _payroll;
    private readonly ICurrentUser _currentUser;

    public PayrollController(IPayrollBal payroll, ICurrentUser currentUser)
    {
        _payroll = payroll;
        _currentUser = currentUser;
    }

    [HttpPost("payslip/generate")]
    [Authorize(Policy = "PAYROLL_RUN")]
    public async Task<ApiResponse<PayslipRecord>> Generate(
        [FromBody] GeneratePayslipRequest request, CancellationToken ct) =>
        ApiResponse<PayslipRecord>.Ok(await _payroll.GenerateAsync(request, ct), "Payslip generated");

    /// <summary>
    /// The figures without writing them.
    ///
    /// Not in the Java, and added because payroll is the one place where seeing
    /// the number before committing it is worth an endpoint: it runs the same
    /// code path as generate, so a preview cannot disagree with what would be
    /// stored. It writes nothing, and is gated on PAYROLL_RUN like the
    /// generation it previews.
    /// </summary>
    [HttpPost("payslip/preview")]
    [Authorize(Policy = "PAYROLL_RUN")]
    public async Task<ApiResponse<PayslipPreview>> Preview(
        [FromBody] GeneratePayslipRequest request, CancellationToken ct) =>
        ApiResponse<PayslipPreview>.Ok(await _payroll.PreviewAsync(request, ct));

    /// <summary>
    /// Creates or edits an employee's salary structure.
    ///
    /// PAYROLL_RUN, not PAYROLL_VIEW: this is the screen that decides what
    /// somebody is paid. The change is audited with a before-and-after, because
    /// it edits the active row in place and the previous figures are otherwise
    /// gone.
    /// </summary>
    [HttpPost("salary")]
    [Authorize(Policy = "PAYROLL_RUN")]
    public async Task<ApiResponse<SalaryStructureRecord>> SetSalary(
        [FromBody] SalaryStructureRequest request, CancellationToken ct) =>
        ApiResponse<SalaryStructureRecord>.Ok(
            await _payroll.UpsertSalaryAsync(request, _currentUser.UserId, ct), "Salary saved");

    [HttpGet("salary/{userId:long}")]
    [Authorize(Policy = "PAYROLL_VIEW")]
    public async Task<ApiResponse<SalaryStructureRecord>> GetSalary(long userId,
                                                                    CancellationToken ct) =>
        ApiResponse<SalaryStructureRecord>.Ok((await _payroll.GetSalaryAsync(userId, ct))!);

    /// <summary>The signed-in employee's own payslips. No payroll permission needed.</summary>
    [HttpGet("payslip/list")]
    public async Task<ApiResponse<IReadOnlyList<PayslipRecord>>> MyPayslips(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<PayslipRecord>>.Ok(
            await _payroll.ListForUserAsync(_currentUser.RequireUserId(), ct));

    [HttpGet("payslip/list/{userId:long}")]
    [Authorize(Policy = "PAYROLL_VIEW")]
    public async Task<ApiResponse<IReadOnlyList<PayslipRecord>>> PayslipsFor(
        long userId, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<PayslipRecord>>.Ok(await _payroll.ListForUserAsync(userId, ct));

    [HttpGet("payslips/month/detailed")]
    [Authorize(Policy = "PAYROLL_VIEW")]
    public async Task<ApiResponse<IReadOnlyList<PayslipRecord>>> PayslipsByMonth(
        [FromQuery] int month, [FromQuery] int year, CancellationToken ct)
    {
        if (month is < 1 or > 12)
        {
            throw ApiException.Business("Month must be between 1 and 12");
        }

        return ApiResponse<IReadOnlyList<PayslipRecord>>.Ok(
            await _payroll.ListForMonthAsync(year, month, ct));
    }

    // ---- the read-only views ----

    /// <summary>
    /// Salary structures.
    ///
    /// PAYROLL_VIEW WIDENS this rather than gating it: without the permission
    /// an employee gets a list containing their own row and nothing else, on
    /// this same route and in this same shape. That is the Java's behaviour and
    /// the reason nothing on the client needs to change.
    /// </summary>
    [HttpGet("salaries")]
    public async Task<ApiResponse<IReadOnlyList<SalaryStructureView>>> Salaries(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<SalaryStructureView>>.Ok(
            await _payroll.ListSalariesAsync(_currentUser.RequireUserId(),
                                           _currentUser.HasPermission("PAYROLL_VIEW"), ct));

    /// <summary>Every employee's basic pay recorded for one month.</summary>
    [HttpGet("salary-months")]
    [Authorize(Policy = "PAYROLL_VIEW")]
    public async Task<ApiResponse<IReadOnlyList<SalaryMonthView>>> SalaryMonths(
        [FromQuery] int month, [FromQuery] int year, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<SalaryMonthView>>.Ok(
            await _payroll.ListSalaryMonthsAsync(month, year, ct));

    /// <summary>Record one employee's basic salary for one month.</summary>
    [HttpPost("salary-months")]
    [Authorize(Policy = "PAYROLL_RUN")]
    public async Task<ApiResponse<SalaryMonthView>> SetSalaryMonth(
        [FromBody] SalaryMonthRequest req, CancellationToken ct) =>
        ApiResponse<SalaryMonthView>.Ok(await _payroll.UpsertSalaryMonthAsync(req, ct), "Basic salary saved");

    /// <summary>The caller's own basic pay, every month recorded, newest first.</summary>
    [HttpGet("salary-months/me")]
    public async Task<ApiResponse<IReadOnlyList<SalaryMonthView>>> MySalaryMonths(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<SalaryMonthView>>.Ok(
            await _payroll.SalaryMonthsForUserAsync(_currentUser.RequireUserId(), ct));

    /// <summary>Every employee's payslip for a month, keyed by user id.</summary>
    [HttpGet("payslips/month")]
    [Authorize(Policy = "PAYROLL_VIEW")]
    public async Task<ApiResponse<IReadOnlyDictionary<long, PayslipSummary>>> PayslipSummariesByMonth(
        [FromQuery] int month, [FromQuery] int year, CancellationToken ct) =>
        ApiResponse<IReadOnlyDictionary<long, PayslipSummary>>.Ok(
            await _payroll.ListByMonthAsync(month, year, ct));

    /// <summary>
    /// One payslip. No policy here on purpose: without PAYROLL_VIEW you may
    /// read your own, which is decided in the BAL where the row is known.
    /// </summary>
    [HttpGet("payslip/{id:long}")]
    public async Task<ApiResponse<PayslipView>> GetPayslip(long id, CancellationToken ct) =>
        ApiResponse<PayslipView>.Ok(
            await _payroll.GetPayslipAsync(_currentUser.RequireUserId(), id,
                                         _currentUser.HasPermission("PAYROLL_VIEW"), ct));

    [HttpGet("payslip/{id:long}/pdf")]
    public async Task<IActionResult> DownloadPdf(long id, CancellationToken ct)
    {
        bool privileged = _currentUser.HasPermission("PAYROLL_VIEW");
        byte[] bytes = await _payroll.GetPdfBytesAsync(_currentUser.RequireUserId(), id, privileged, ct);
        return File(bytes, "application/pdf", $"payslip-{id}.pdf");
    }

    [HttpPost("payslip/{id:long}/email")]
    public async Task<ApiResponse<object?>> EmailPayslip(long id, CancellationToken ct)
    {
        bool privileged = _currentUser.HasAnyPermission("PAYROLL_VIEW", "PAYROLL_RUN");
        string sentTo = await _payroll.EmailPayslipAsync(_currentUser.RequireUserId(), id, privileged, ct);
        return ApiResponse<object?>.Ok(null, "Payslip emailed to " + sentTo);
    }

    [HttpPost("runs")]
    [Authorize(Policy = "PAYROLL_RUN")]
    public async Task<ApiResponse<PayrollRunResponse>> StartBatch(
        [FromBody] BatchRunRequest req, CancellationToken ct) =>
        ApiResponse<PayrollRunResponse>.Ok(
            await _payroll.GenerateBatchAsync(req.Month, req.Year, _currentUser.RequireUserId(), ct),
            "Payroll run started");

    [HttpPost("runs/{id:long}/confirm")]
    [Authorize(Policy = "PAYROLL_RUN")]
    public async Task<ApiResponse<PayrollRunResponse>> ConfirmRun(
        long id, CancellationToken ct) =>
        ApiResponse<PayrollRunResponse>.Ok(
            await _payroll.ConfirmRunAsync(id, _currentUser.RequireUserId(), ct),
            "Payroll run confirmed");

    [HttpPost("runs/{id:long}/finance-approve")]
    [Authorize(Policy = "PAYROLL_APPROVE")]
    public async Task<ApiResponse<PayrollRunResponse>> FinanceApproveRun(
        long id, CancellationToken ct) =>
        ApiResponse<PayrollRunResponse>.Ok(
            await _payroll.FinanceApproveRunAsync(id, _currentUser.RequireUserId(), ct),
            "Payroll run approved by finance");

    [HttpPost("runs/{id:long}/finalise")]
    [Authorize(Policy = "PAYROLL_APPROVE")]
    public async Task<ApiResponse<PayrollRunResponse>> FinaliseRun(
        long id, CancellationToken ct) =>
        ApiResponse<PayrollRunResponse>.Ok(
            await _payroll.FinaliseRunAsync(id, _currentUser.RequireUserId(), ct),
            "Payroll run finalised");

    [HttpGet("runs")]
    [Authorize(Policy = "PAYROLL_RUN,PAYROLL_APPROVE")]
    public async Task<ApiResponse<IReadOnlyList<PayrollRunResponse>>> Runs(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<PayrollRunResponse>>.Ok(await _payroll.ListRunViewsAsync(ct));

    [HttpGet("runs/{id:long}")]
    [Authorize(Policy = "PAYROLL_RUN,PAYROLL_APPROVE")]
    public async Task<ApiResponse<PayrollRunResponse>> GetRun(long id, CancellationToken ct) =>
        ApiResponse<PayrollRunResponse>.Ok(await _payroll.GetRunDetailAsync(id, ct));

    /// <summary>The admin inbox of payslip requests. Pending only by default.</summary>
    [HttpGet("requests")]
    [Authorize(Policy = "PAYROLL_RUN")]
    public async Task<ApiResponse<IReadOnlyList<PayslipRequestView>>> RequestInbox(
        [FromQuery] bool pendingOnly = true, CancellationToken ct = default) =>
        ApiResponse<IReadOnlyList<PayslipRequestView>>.Ok(
            await _payroll.RequestInboxAsync(pendingOnly, ct));

    /// <summary>The caller's own payslip requests.</summary>
    [HttpGet("requests/me")]
    public async Task<ApiResponse<IReadOnlyList<PayslipRequestView>>> MyRequests(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<PayslipRequestView>>.Ok(
            await _payroll.MyRequestsAsync(_currentUser.RequireUserId(), ct));

    [HttpPost("requests")]
    public async Task<ApiResponse<PayslipRequestView>> RaiseRequest(
        [FromBody] CreatePayslipRequestDto req, CancellationToken ct) =>
        ApiResponse<PayslipRequestView>.Ok(
            await _payroll.RaiseRequestAsync(_currentUser.RequireUserId(), req.Month, req.Year, req.Note, ct),
            "Payslip request sent to admin");

    [HttpPost("requests/logo")]
    [Authorize(Policy = "PAYROLL_RUN")]
    public async Task<ApiResponse<Dictionary<string, string>>> UploadLogo(
        IFormFile file, CancellationToken ct)
    {
        if (file == null || file.Length == 0)
        {
            throw ApiException.BadRequest("File is required");
        }

        using var stream = file.OpenReadStream();
        string path = await _payroll.UploadLogoAsync(stream, file.FileName, file.ContentType, file.Length, ct);
        return ApiResponse<Dictionary<string, string>>.Ok(
            new Dictionary<string, string> { ["path"] = path },
            "Logo uploaded");
    }

    [HttpPost("requests/{id:long}/approve")]
    [Authorize(Policy = "PAYROLL_RUN")]
    public async Task<ApiResponse<PayslipView>> ApproveRequest(
        long id, [FromBody] ApprovePayslipRequestDto form, CancellationToken ct) =>
        ApiResponse<PayslipView>.Ok(
            await _payroll.ApproveRequestAsync(_currentUser.RequireUserId(), id, form, ct),
            "Payslip generated and sent to employee");

    [HttpPost("requests/{id:long}/reject")]
    [Authorize(Policy = "PAYROLL_RUN")]
    public async Task<ApiResponse<PayslipRequestView>> RejectRequest(
        long id, [FromBody] RejectRequestPayload? body, CancellationToken ct) =>
        ApiResponse<PayslipRequestView>.Ok(
            await _payroll.RejectRequestAsync(_currentUser.RequireUserId(), id, body?.Note, ct),
            "Request rejected");
}
