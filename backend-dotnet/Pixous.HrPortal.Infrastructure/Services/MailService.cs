using System.Net;
using System.Net.Mail;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Infrastructure.Configuration;

namespace Pixous.HrPortal.Infrastructure.Services;

/// <summary>
/// Sending mail out of the portal via SMTP.
/// Ported from com.pixous.hrportal.common.MailService.
/// </summary>
public sealed class MailService : IMailService
{
    private readonly ILogger<MailService> _log;
    private readonly MailOptions _options;

    public MailService(IOptions<AppOptions> options, ILogger<MailService> log)
    {
        _log = log;
        _options = options.Value.Mail;
    }

    public bool IsConfigured()
    {
        string host = _options.Host?.Trim() ?? string.Empty;
        string from = _options.From?.Trim() ?? string.Empty;

        return !string.IsNullOrEmpty(host)
            && !string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(host, "127.0.0.1", StringComparison.Ordinal)
            && !string.IsNullOrEmpty(from);
    }

    public string NotConfiguredMessage() =>
        "Email has not been set up on this server yet, so nothing was sent. "
        + "Ask your administrator to configure the mail settings.";

    public bool TrySend(string to, string subject, string bodyHtml)
    {
        if (!IsConfigured() || string.IsNullOrWhiteSpace(to)) return false;

        try
        {
            using var client = CreateSmtpClient();
            using var message = new MailMessage
            {
                From = new MailAddress(_options.From.Trim()),
                Subject = subject,
                Body = bodyHtml,
                IsBodyHtml = true
            };
            message.To.Add(to.Trim());

            client.Send(message);
            _log.LogInformation("Sent '{Subject}' to {To}", subject, to);
            return true;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not send '{Subject}' to {To}: {Message}", subject, to, ex.Message);
            return false;
        }
    }

    public async Task SendAttachmentAsync(string to, string subject, string bodyHtml,
                                         string attachmentName, string contentType, byte[] data,
                                         CancellationToken ct = default)
    {
        if (!IsConfigured())
        {
            throw ApiException.Business(NotConfiguredMessage());
        }

        if (string.IsNullOrWhiteSpace(to))
        {
            throw ApiException.Business("No email address was given.");
        }

        try
        {
            using var client = CreateSmtpClient();
            using var message = new MailMessage
            {
                From = new MailAddress(_options.From.Trim()),
                Subject = subject,
                Body = bodyHtml,
                IsBodyHtml = true
            };
            message.To.Add(to.Trim());

            using var stream = new MemoryStream(data);
            var attachment = new Attachment(stream, attachmentName, contentType);
            message.Attachments.Add(attachment);

            await client.SendMailAsync(message, ct);
            _log.LogInformation("Sent '{Subject}' with attachment '{Attachment}' to {To}",
                subject, attachmentName, to);
        }
        catch (Exception ex) when (ex is not ApiException)
        {
            _log.LogError(ex, "Could not send '{Subject}' to {To}", subject, to);
            throw ApiException.Business(
                "The email could not be sent. The mail server refused it — "
                + "the details are in the server log.");
        }
    }

    public Task SendWithPdfAsync(string to, string subject, string bodyHtml,
                                string attachmentName, byte[] pdf,
                                CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(to))
        {
            throw ApiException.Business("That employee has no email address on their profile.");
        }

        return SendAttachmentAsync(to, subject, bodyHtml, attachmentName, "application/pdf", pdf, ct);
    }

    private SmtpClient CreateSmtpClient()
    {
        var client = new SmtpClient(_options.Host.Trim(), _options.Port)
        {
            EnableSsl = _options.EnableSsl
        };

        if (!string.IsNullOrWhiteSpace(_options.Username))
        {
            client.Credentials = new NetworkCredential(_options.Username.Trim(), _options.Password ?? string.Empty);
        }

        return client;
    }
}
