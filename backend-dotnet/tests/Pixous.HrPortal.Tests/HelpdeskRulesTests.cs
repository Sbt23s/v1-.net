using Pixous.HrPortal.Domain.Modules.Helpdesk;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// The helpdesk lifecycle and SLA, checked against
/// com.pixous.hrportal.modules.helpdesk.HelpdeskService.
/// </summary>
public class HelpdeskRulesTests
{
    private static readonly DateTime Noon = new(2026, 9, 13, 12, 0, 0);

    [Theory]
    [InlineData("CRITICAL", 4)]
    [InlineData("HIGH", 8)]
    [InlineData("MEDIUM", 24)]
    [InlineData("LOW", 48)]
    public void Sla_is_set_by_priority(string priority, int hours) =>
        Assert.Equal(Noon.AddHours(hours), HelpdeskRules.SlaDue(priority, Noon));

    /// <summary>
    /// Anything unrecognised falls to the 48-hour default rather than being
    /// treated as urgent — the Java's `default ->` arm.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("critical")]   // lower case does NOT match the switch
    [InlineData("URGENT")]
    public void An_unknown_priority_gets_the_longest_sla(string? priority) =>
        Assert.Equal(Noon.AddHours(48), HelpdeskRules.SlaDue(priority, Noon));

    [Fact]
    public void Ticket_codes_are_padded_to_five_digits()
    {
        Assert.Equal("TKT-2026-00001", HelpdeskRules.TicketCode(0, 2026));
        Assert.Equal("TKT-2026-00008", HelpdeskRules.TicketCode(7, 2026));
        Assert.Equal("TKT-2026-00100", HelpdeskRules.TicketCode(99, 2026));
    }

    /// <summary>
    /// The counter is the total ticket count, not a per-year sequence, so it
    /// does not restart in January. Stated as a test because it looks like a bug
    /// and is the Java's behaviour.
    /// </summary>
    [Fact]
    public void The_number_does_not_restart_each_year()
    {
        Assert.Equal("TKT-2027-00101", HelpdeskRules.TicketCode(100, 2027));
    }

    [Theory]
    [InlineData("OPEN", "IN_PROGRESS")]
    [InlineData("IN_PROGRESS", "AWAITING_PARTS")]
    [InlineData("IN_PROGRESS", "RESOLVED")]      // the skip, deliberately allowed
    [InlineData("AWAITING_PARTS", "RESOLVED")]
    [InlineData("RESOLVED", "CLOSED")]
    public void Forward_moves_are_allowed(string from, string to) =>
        Assert.True(HelpdeskRules.IsAllowedTransition(from, to));

    [Theory]
    [InlineData("OPEN", "RESOLVED")]             // skipping IN_PROGRESS
    [InlineData("OPEN", "AWAITING_PARTS")]
    [InlineData("OPEN", "CLOSED")]
    [InlineData("AWAITING_PARTS", "CLOSED")]     // only IN_PROGRESS may skip
    public void Skipping_a_step_is_refused(string from, string to) =>
        Assert.False(HelpdeskRules.IsAllowedTransition(from, to));

    [Theory]
    [InlineData("RESOLVED", "OPEN")]
    [InlineData("CLOSED", "RESOLVED")]
    [InlineData("IN_PROGRESS", "OPEN")]
    public void Going_backwards_is_refused(string from, string to) =>
        Assert.False(HelpdeskRules.IsAllowedTransition(from, to));

    [Theory]
    [InlineData("OPEN", "OPEN")]
    [InlineData("RESOLVED", "RESOLVED")]
    public void Staying_put_is_refused(string from, string to) =>
        Assert.False(HelpdeskRules.IsAllowedTransition(from, to));

    /// <summary>
    /// A status outside the lifecycle is not judged by this rule at all — the
    /// Java applies it only when both positions are found. The surrounding
    /// checks catch those.
    /// </summary>
    [Theory]
    [InlineData("CANCELLED", "OPEN")]
    [InlineData("OPEN", "CANCELLED")]
    [InlineData("SOMETHING_ELSE", "OPEN")]
    public void A_status_off_the_lifecycle_is_left_to_the_other_checks(string from, string to) =>
        Assert.True(HelpdeskRules.IsAllowedTransition(from, to));
}
