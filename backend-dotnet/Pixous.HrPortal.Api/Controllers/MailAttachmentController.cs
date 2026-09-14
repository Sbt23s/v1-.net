using System.Net;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Emailing a report that the browser produced.
/// Ported from com.pixous.hrportal.modules.admin.MailAttachmentController.
/// </summary>
[ApiController]
[Route("api/mail")]
[Authorize]
public sealed class MailAttachmentController : ControllerBase
{
    private static readonly Regex EmailRegex = new(
        @"^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly HashSet<string> AllowedTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "text/csv",
        "application/pdf"
    };

    private const long MaxBytes = 10L * 1024 * 1024; // 10 MB

    private readonly IMailService _mailService;
    private readonly ICurrentUser _currentUser;
    private readonly ILogger<MailAttachmentController> _log;

    public MailAttachmentController(
        IMailService mailService,
        ICurrentUser currentUser,
        ILogger<MailAttachmentController> log)
    {
        _mailService = mailService;
        _currentUser = currentUser;
        _log = log;
    }

    [HttpPost("send-report")]
    public async Task<ApiResponse<object>> SendReport(
        [FromForm] string to,
        [FromForm] string subject,
        [FromForm] string? message,
        IFormFile file,
        CancellationToken ct)
    {
        if (!_currentUser.HasAnyPermission("USER_MANAGE", "CLAIM_APPROVE", "DASHBOARD_EXEC", "PAYROLL_VIEW"))
        {
            throw ApiException.Forbidden("You do not have permission to send reports via email.");
        }

        string recipient = to?.Trim() ?? string.Empty;
        if (!EmailRegex.IsMatch(recipient))
        {
            throw ApiException.Business("That does not look like an email address.");
        }

        if (file is null || file.Length == 0)
        {
            throw ApiException.Business("There is nothing to send — the report came through empty.");
        }

        if (file.Length > MaxBytes)
        {
            throw ApiException.Business("That report is too large to email. Narrow the filters and try again.");
        }

        string contentType = file.ContentType ?? string.Empty;
        if (!AllowedTypes.Contains(contentType))
        {
            throw ApiException.Business("Only spreadsheets and PDFs can be emailed from here.");
        }

        string cleanSubject = string.IsNullOrWhiteSpace(subject)
            ? "Report from Pixous HR Portal"
            : subject.Trim();

        string note = string.IsNullOrWhiteSpace(message)
            ? string.Empty
            : $"<p>{WebUtility.HtmlEncode(message.Trim()).Replace("\n", "<br>")}</p>";

        string body = note
            + "<p>The report is attached.</p>"
            + "<p style=\"color:#6b7280;font-size:12px\">"
            + "Sent from the Pixous HR portal. This attachment may contain confidential company information.</p>";

        _log.LogInformation("User {UserId} is emailing '{FileName}' ({Bytes} bytes) to {Recipient}",
            _currentUser.UserId, file.FileName, file.Length, recipient);

        string attachmentName = string.IsNullOrWhiteSpace(file.FileName) ? "report.xlsx" : file.FileName;

        using var memoryStream = new MemoryStream();
        await file.CopyToAsync(memoryStream, ct);
        byte[] data = memoryStream.ToArray();

        await _mailService.SendAttachmentAsync(recipient, cleanSubject, body, attachmentName, contentType, data, ct);

        return ApiResponse<object>.MessageOnly("Sent to " + recipient);
    }
}
