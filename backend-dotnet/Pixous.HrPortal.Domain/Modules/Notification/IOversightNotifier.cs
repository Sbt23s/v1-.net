namespace Pixous.HrPortal.Domain.Modules.Notification;

/// <summary>
/// Sends a copy of what happened to the people who oversee it.
///
/// <para>Every module already tells the two people in a request — the person
/// who asked and the person deciding. What was missing was the copy to whoever
/// watches the whole thing, and adding it module by module would have meant six
/// more places that each look up the CTO their own way. This is one reader of
/// that rule rather than a sixth copy of it.</para>
///
/// <para><b>Nothing here throws.</b> A notification is a courtesy alongside the
/// thing that actually happened, and a leave request must not fail because the
/// CTO's account could not be read — so a failure is logged and swallowed,
/// exactly as the SMS helper does.</para>
/// </summary>
public interface IOversightNotifier
{
    /// <summary>
    /// Tells the CTO, unless the CTO is the one who did it.
    ///
    /// Suppressing the self-copy matters: the CTO approves requests too, and
    /// being notified of one's own decision is noise that teaches people to
    /// ignore the bell.
    /// </summary>
    Task NotifyCtoAsync(long? actorId, string title, string body, string type, string link,
                        CancellationToken ct = default);
}

/// <summary>The accounts that oversee the whole portal.</summary>
public static class OversightAccounts
{
    /// <summary>The company head, who receives a copy of every request.</summary>
    public const string CtoCode = "PIX-E100";

    /// <summary>The platform administrator, which keeps the portal running.</summary>
    public const string SystemAdminCode = "ADM0001";

    /// <summary>
    /// Whether this account may read every request in the portal, whoever it
    /// was addressed to.
    ///
    /// <para>Keyed on the ACCOUNT rather than on a permission, because the
    /// permissions do not separate these people. HR holds USER_MANAGE — they
    /// manage employee records, which is what the permission is for — so a
    /// check on USER_MANAGE let HR read the complaints somebody had
    /// deliberately addressed past them to the CTO. That was the bug this rule
    /// exists to prevent, and it was reintroduced once by the exception written
    /// for it.</para>
    ///
    /// <para>The CTO sees everything because the buck stops there. The platform
    /// administrator sees everything because a queue they cannot see is one they
    /// cannot repair. Nobody else does, HR included.</para>
    /// </summary>
    public static bool SeesEveryRequest(string? employeeCode) =>
        string.Equals(employeeCode, CtoCode, StringComparison.OrdinalIgnoreCase)
        || string.Equals(employeeCode, SystemAdminCode, StringComparison.OrdinalIgnoreCase);
}
