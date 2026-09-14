namespace Pixous.HrPortal.Domain.Common;

/// <summary>
/// Sends SMS. Ported from com.pixous.hrportal.common.SmsService.
///
/// **Never throws.** A delivery failure must not break the action that triggered
/// it — a leave request that was approved is still approved even if the text
/// telling somebody about it did not go out. The Java marks send as @Async for
/// the same reason; here the failure is caught rather than thrown away with the
/// thread, so it still reaches the log.
/// </summary>
public interface ISmsService
{
    Task SendAsync(string? toRaw, string body, CancellationToken ct = default);

    Task SendBulkAsync(IEnumerable<string?> rawNumbers, string body,
                       CancellationToken ct = default);
}

/// <summary>
/// Turning what somebody typed into a number a gateway will accept. Separated
/// so it can be tested without a gateway.
/// </summary>
public static class PhoneNumbers
{
    /// <summary>
    /// E.164, the way the Java does it:
    ///
    ///   - everything but digits and a leading + is stripped, so "+91 98765
    ///     43210", "098765-43210" and "(98765) 43210" converge;
    ///   - anything already starting with + is taken as final;
    ///   - leading zeros are dropped — trunk prefixes, not part of the number;
    ///   - exactly ten digits gets the default country code, because that is a
    ///     local Indian number;
    ///   - anything else is assumed to already carry a country code and only
    ///     gains the +.
    ///
    /// That last rule is a guess, and it is the Java's guess. A nine-digit
    /// number becomes "+987654321", which no gateway will deliver — but it is
    /// returned rather than rejected, and the gateway reports the failure. Made
    /// explicit here because it looks like an oversight and is not one to
    /// "fix" quietly.
    /// </summary>
    public static string? ToE164(string? raw, string defaultCountryCode = "+91")
    {
        if (raw is null)
        {
            return null;
        }

        string cleaned = new string(raw.Where(c => char.IsAsciiDigit(c) || c == '+').ToArray());

        if (cleaned.Length == 0)
        {
            return null;
        }

        if (cleaned.StartsWith('+'))
        {
            return cleaned;
        }

        cleaned = cleaned.TrimStart('0');

        // NOT a null here, deliberately. An input of all zeros leaves nothing,
        // and the Java returns a bare "+" -- replaceFirst on an empty remainder,
        // then "+" + "". Verified against the running Java: "000" -> "+".
        //
        // It is useless as a number and the gateway rejects it, which is the
        // same outcome either way; reproduced so the two backends do not differ
        // on what they hand a caller that checks for null.

        string cc = string.IsNullOrWhiteSpace(defaultCountryCode) ? "+91" : defaultCountryCode;

        return cleaned.Length == 10 ? cc + cleaned : "+" + cleaned;
    }
}
