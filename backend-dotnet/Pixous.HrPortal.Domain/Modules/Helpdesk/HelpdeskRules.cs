namespace Pixous.HrPortal.Domain.Modules.Helpdesk;

/// <summary>
/// The helpdesk rules that do not need a database: the SLA clock, the ticket
/// code, and which status may follow which.
/// </summary>
public static class HelpdeskRules
{
    /// <summary>
    /// The ordered lifecycle. The ORDER is the rule — a transition is judged by
    /// comparing positions in this list, so reordering it changes what is
    /// allowed.
    /// </summary>
    public static readonly string[] Lifecycle =
        ["OPEN", "IN_PROGRESS", "AWAITING_PARTS", "RESOLVED", "CLOSED"];

    /// <summary>
    /// Every status a ticket may be set to. CANCELLED is reachable only through
    /// the cancel endpoint, not through a status change, which is why it is not
    /// in the lifecycle above.
    /// </summary>
    public static readonly IReadOnlySet<string> ValidStatuses =
        new HashSet<string>(StringComparer.Ordinal)
        {
            "OPEN", "IN_PROGRESS", "AWAITING_PARTS", "RESOLVED", "CLOSED", "CANCELLED"
        };

    /// <summary>
    /// How long until the SLA is breached, by priority. Anything unrecognised
    /// gets the 48-hour default, which is the Java's `default ->` arm — so a
    /// ticket with no priority is not treated as urgent.
    /// </summary>
    public static DateTime SlaDue(string? priority, DateTime now) => priority switch
    {
        "CRITICAL" => now.AddHours(4),
        "HIGH" => now.AddHours(8),
        "MEDIUM" => now.AddHours(24),
        _ => now.AddHours(48)
    };

    /// <summary>
    /// <c>TKT-{year}-{00001}</c>, numbered from the total ticket count plus one.
    ///
    /// That is the Java's scheme and it is worth naming what it is: the counter
    /// is the COUNT of all tickets ever, not a per-year sequence, so the number
    /// keeps climbing across years and does not restart at 00001 each January.
    /// Deleting a ticket would also make the next code collide with an existing
    /// one — nothing deletes tickets today, which is why it has not bitten.
    /// </summary>
    public static string TicketCode(long existingTicketCount, int year) =>
        $"TKT-{year}-{existingTicketCount + 1:00000}";

    /// <summary>
    /// Whether a ticket may move from one status to another.
    ///
    /// Forward only, one step at a time — with one exception: from IN_PROGRESS a
    /// ticket may go to AWAITING_PARTS **or** straight to RESOLVED, because not
    /// every job is waiting on a part.
    ///
    /// A status outside the lifecycle (CANCELLED, or an unknown value already in
    /// the row) is not judged at all: the Java only applies the rule when BOTH
    /// positions are found, so a cancelled ticket is let through here and caught
    /// by the checks around it.
    /// </summary>
    public static bool IsAllowedTransition(string? from, string? to)
    {
        int currentIdx = Array.IndexOf(Lifecycle, from);
        int targetIdx = Array.IndexOf(Lifecycle, to);

        if (currentIdx == -1 || targetIdx == -1)
        {
            // One of them is off the lifecycle; the Java leaves such a move
            // alone rather than refusing it.
            return true;
        }

        if (targetIdx <= currentIdx)
        {
            // Never backwards, and never to the status it is already in.
            return false;
        }

        // IN_PROGRESS is index 1: from there, AWAITING_PARTS (2) or RESOLVED (3).
        if (currentIdx == 1)
        {
            return targetIdx is 2 or 3;
        }

        return targetIdx == currentIdx + 1;
    }
}
