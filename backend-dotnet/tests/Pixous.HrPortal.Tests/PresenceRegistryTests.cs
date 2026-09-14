using Pixous.HrPortal.Domain.Modules.Presence;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// The socket counting behind "who is online".
///
/// One person may hold several sockets — two tabs and a phone — and the whole
/// rule is that they are online until the LAST one closes. Counting the first
/// close as a departure shows colleagues as offline while they are sitting
/// there, and never removing them shows people online for days.
/// </summary>
public sealed class PresenceRegistryTests
{
    private static IPresenceRegistry New() => new PresenceRegistry();

    [Fact]
    public void NobodyIsOnlineToBeginWith()
    {
        IPresenceRegistry registry = New();

        Assert.Empty(registry.Online);
        Assert.False(registry.IsOnline(1));
    }

    /// <summary>The first socket is an arrival and should be announced.</summary>
    [Fact]
    public void TheFirstSocketIsAnArrival()
    {
        IPresenceRegistry registry = New();

        Assert.True(registry.Connected("s1", 7));
        Assert.True(registry.IsOnline(7));
        Assert.Equal([7L], registry.Online);
    }

    /// <summary>
    /// A second socket for the same person is NOT an arrival — they were
    /// already here, and announcing again would flash them online twice.
    /// </summary>
    [Fact]
    public void ASecondSocketForTheSamePersonIsNotAnArrival()
    {
        IPresenceRegistry registry = New();

        Assert.True(registry.Connected("tab1", 7));
        Assert.False(registry.Connected("tab2", 7));
        Assert.False(registry.Connected("phone", 7));

        Assert.Single(registry.Online);
    }

    /// <summary>
    /// Closing one of several sockets is not a departure. This is the rule the
    /// whole module exists for.
    /// </summary>
    [Fact]
    public void ClosingOneOfSeveralSocketsIsNotADeparture()
    {
        IPresenceRegistry registry = New();

        registry.Connected("tab1", 7);
        registry.Connected("tab2", 7);
        registry.Connected("phone", 7);

        Assert.Null(registry.Disconnected("tab1"));
        Assert.True(registry.IsOnline(7));

        Assert.Null(registry.Disconnected("tab2"));
        Assert.True(registry.IsOnline(7));

        // Only the last one.
        Assert.Equal(7L, registry.Disconnected("phone"));
        Assert.False(registry.IsOnline(7));
        Assert.Empty(registry.Online);
    }

    /// <summary>
    /// A duplicate connect for one session id is ignored.
    ///
    /// Were it counted, the count would rise without a matching disconnect and
    /// the person would appear online for as long as the process lived.
    /// </summary>
    [Fact]
    public void ADuplicateConnectForOneSessionIsIgnored()
    {
        IPresenceRegistry registry = New();

        Assert.True(registry.Connected("s1", 7));
        Assert.False(registry.Connected("s1", 7));

        // One disconnect is still enough to take them offline.
        Assert.Equal(7L, registry.Disconnected("s1"));
        Assert.False(registry.IsOnline(7));
    }

    /// <summary>An unknown session id is not a departure and takes nobody offline.</summary>
    [Fact]
    public void DisconnectingAnUnknownSessionDoesNothing()
    {
        IPresenceRegistry registry = New();

        registry.Connected("s1", 7);

        Assert.Null(registry.Disconnected("never-seen"));
        Assert.True(registry.IsOnline(7));
    }

    /// <summary>Disconnecting the same session twice takes them offline once.</summary>
    [Fact]
    public void DisconnectingTheSameSessionTwiceAnnouncesOnce()
    {
        IPresenceRegistry registry = New();

        registry.Connected("s1", 7);

        Assert.Equal(7L, registry.Disconnected("s1"));
        Assert.Null(registry.Disconnected("s1"));
        Assert.False(registry.IsOnline(7));
    }

    /// <summary>People are tracked independently.</summary>
    [Fact]
    public void OnePersonLeavingDoesNotAffectAnother()
    {
        IPresenceRegistry registry = New();

        registry.Connected("a", 1);
        registry.Connected("b", 2);

        Assert.Equal(2, registry.Online.Count);

        Assert.Equal(1L, registry.Disconnected("a"));

        Assert.False(registry.IsOnline(1));
        Assert.True(registry.IsOnline(2));
        Assert.Equal([2L], registry.Online);
    }

    /// <summary>
    /// Somebody who left can come back, and that is an arrival again — the
    /// count must genuinely have been cleared rather than left at zero.
    /// </summary>
    [Fact]
    public void ReconnectingAfterLeavingIsAFreshArrival()
    {
        IPresenceRegistry registry = New();

        registry.Connected("s1", 7);
        registry.Disconnected("s1");

        Assert.True(registry.Connected("s2", 7));
        Assert.True(registry.IsOnline(7));
    }

    /// <summary>
    /// Many sockets opening and closing at once must leave the register clean.
    ///
    /// "Decrement, then remove if it reached zero" is a sequence, not one
    /// atomic step: unguarded, two closes racing could both see a non-zero
    /// count and leave somebody online forever.
    /// </summary>
    [Fact]
    public void ConcurrentConnectsAndDisconnectsLeaveNobodyStranded()
    {
        IPresenceRegistry registry = New();
        const int people = 20;
        const int socketsEach = 10;

        Parallel.For(0, people, person =>
        {
            for (int s = 0; s < socketsEach; s++)
            {
                registry.Connected($"u{person}-s{s}", person);
            }
        });

        Assert.Equal(people, registry.Online.Count);

        Parallel.For(0, people, person =>
        {
            for (int s = 0; s < socketsEach; s++)
            {
                registry.Disconnected($"u{person}-s{s}");
            }
        });

        Assert.Empty(registry.Online);
    }

    /// <summary>
    /// Exactly one departure is reported per person, however the closes
    /// interleave — otherwise the same person is announced offline twice.
    /// </summary>
    [Fact]
    public void ExactlyOneDepartureIsReportedPerPerson()
    {
        IPresenceRegistry registry = New();
        const int sockets = 50;

        for (int s = 0; s < sockets; s++)
        {
            registry.Connected($"s{s}", 7);
        }

        int departures = 0;

        Parallel.For(0, sockets, s =>
        {
            if (registry.Disconnected($"s{s}") is not null)
            {
                Interlocked.Increment(ref departures);
            }
        });

        Assert.Equal(1, departures);
        Assert.False(registry.IsOnline(7));
    }
}
