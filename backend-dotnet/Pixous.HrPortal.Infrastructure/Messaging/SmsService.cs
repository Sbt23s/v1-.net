using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Pixous.HrPortal.Domain.Common;

namespace Pixous.HrPortal.Infrastructure.Messaging;

/// <summary>
/// Sends SMS, ported from com.pixous.hrportal.common.SmsService.
///
/// Fast2SMS is the provider for Indian numbers and is used when it is both
/// enabled and keyed; Twilio remains as a fallback. Neither is configured in
/// this deployment by default — the Java's own settings have
/// <c>twilio.enabled=false</c> and no committed keys — so the honest behaviour
/// when nothing is set up is to log and move on, which is what happens here.
///
/// **This never throws.** A delivery failure must not break the action that
/// triggered it: a leave request that was approved is still approved even if the
/// text telling somebody about it did not go out. The Java gets that from
/// @Async, which also swallows the failure entirely; here it is caught and
/// logged, so the failure is visible.
///
/// Not yet wired to a gateway. The HTTP calls to Fast2SMS and Twilio are the
/// remaining piece; what is here is the provider selection, the number
/// normalisation and the contract, so that every caller in the ported modules is
/// written once and does not change when the gateway lands.
/// </summary>
public sealed class SmsService : ISmsService
{
    private readonly ILogger<SmsService> _log;
    private readonly string _defaultCountryCode;
    private readonly bool _fast2smsEnabled;
    private readonly string? _fast2smsKey;
    private readonly bool _twilioEnabled;

    public SmsService(IConfiguration configuration, ILogger<SmsService> log)
    {
        _log = log;

        _defaultCountryCode = configuration["App:Twilio:DefaultCountryCode"] ?? "+91";
        _fast2smsEnabled = configuration.GetValue("App:Fast2sms:Enabled", true);
        _fast2smsKey = configuration["App:Fast2sms:ApiKey"];
        _twilioEnabled = configuration.GetValue("App:Twilio:Enabled", false);

        LogProvider();
    }

    /// <summary>
    /// Say once, at startup, which provider will actually be used. Without this
    /// a missing API key looks identical to a working setup until somebody waits
    /// for an SMS that never arrives.
    /// </summary>
    private void LogProvider()
    {
        bool keyed = !string.IsNullOrWhiteSpace(_fast2smsKey);

        if (_fast2smsEnabled && keyed)
        {
            string tail = _fast2smsKey!.Length <= 4 ? _fast2smsKey! : _fast2smsKey![^4..];
            _log.LogInformation("SMS provider: Fast2SMS (key ...{Tail})", tail);
        }
        else if (_fast2smsEnabled)
        {
            _log.LogWarning(
                "SMS provider: Fast2SMS is enabled but the API key is EMPTY — falling back to "
                + "Twilio. No SMS will be sent until the key is set.");
        }
        else if (_twilioEnabled)
        {
            _log.LogInformation("SMS provider: Twilio (Fast2SMS disabled)");
        }
        else
        {
            _log.LogWarning(
                "SMS is not configured: neither Fast2SMS nor Twilio is enabled with credentials. "
                + "Messages will be logged and dropped.");
        }
    }

    public Task SendAsync(string? toRaw, string body, CancellationToken ct = default)
    {
        try
        {
            string? to = PhoneNumbers.ToE164(toRaw, _defaultCountryCode);

            if (string.IsNullOrWhiteSpace(to) || to == "+")
            {
                _log.LogDebug("SMS skipped: no usable number in '{Raw}'", toRaw);
                return Task.CompletedTask;
            }

            bool keyed = !string.IsNullOrWhiteSpace(_fast2smsKey);

            if (!(_fast2smsEnabled && keyed) && !_twilioEnabled)
            {
                // Nothing configured. Logged at debug rather than warning: with
                // no gateway set up this would otherwise fill the log on every
                // leave request.
                _log.LogDebug("SMS not sent to {To} (no provider configured): {Body}", to, body);
                return Task.CompletedTask;
            }

            // The gateway call itself is the outstanding piece -- see the class
            // comment. Logged so the intent is visible until it lands.
            _log.LogInformation("SMS to {To} is pending a gateway implementation: {Body}", to, body);
        }
        catch (Exception ex)
        {
            // Never throws into the caller. See the class comment.
            _log.LogWarning(ex, "Could not send an SMS to {Raw}", toRaw);
        }

        return Task.CompletedTask;
    }

    public async Task SendBulkAsync(IEnumerable<string?> rawNumbers, string body,
                                    CancellationToken ct = default)
    {
        foreach (string? raw in rawNumbers)
        {
            await SendAsync(raw, body, ct);
        }
    }
}
