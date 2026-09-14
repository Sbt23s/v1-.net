namespace Pixous.HrPortal.Domain.Common;

/// <summary>
/// Sending transactional mail and report attachments out of the portal.
/// Ported from com.pixous.hrportal.common.MailService.
/// </summary>
public interface IMailService
{
    /// <summary>Whether an external SMTP server has been configured.</summary>
    bool IsConfigured();

    /// <summary>User-friendly error message when mail settings are absent.</summary>
    string NotConfiguredMessage();

    /// <summary>
    /// Attempts to send an HTML email. Never throws; returns false on failure.
    /// Used for non-critical notification emails.
    /// </summary>
    bool TrySend(string to, string subject, string bodyHtml);

    /// <summary>
    /// Sends an email with an attachment (spreadsheet or PDF). Throws ApiException on failure.
    /// </summary>
    Task SendAttachmentAsync(string to, string subject, string bodyHtml,
                             string attachmentName, string contentType, byte[] data,
                             CancellationToken ct = default);

    /// <summary>
    /// Sends an email with a PDF attachment. Throws ApiException on failure.
    /// </summary>
    Task SendWithPdfAsync(string to, string subject, string bodyHtml,
                          string attachmentName, byte[] pdf,
                          CancellationToken ct = default);
}
