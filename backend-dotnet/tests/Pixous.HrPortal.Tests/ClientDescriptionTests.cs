using Pixous.HrPortal.Domain.Modules.Audit;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// Reading a user agent, checked against AuditController.describeClient.
/// The ORDER of the checks is the rule, and two orderings are load-bearing.
/// </summary>
public class ClientDescriptionTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Nothing_is_Unknown(string? ua) =>
        Assert.Equal("Unknown", ClientDescription.Describe(ua));

    /// <summary>
    /// Edge is tested BEFORE Chrome because Edge's user agent contains
    /// "chrome". Reverse them and every Edge user is reported as Chrome.
    /// </summary>
    [Fact]
    public void Edge_is_not_reported_as_Chrome()
    {
        const string edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          + "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
        Assert.Equal("Edge on Windows", ClientDescription.Describe(edge));
    }

    /// <summary>
    /// The app markers are tested FIRST, because a mobile app's agent often
    /// also mentions a browser engine.
    /// </summary>
    [Theory]
    [InlineData("okhttp/4.9.0", "Mobile app")]
    [InlineData("Dart/3.0 (dart:io)", "Mobile app")]
    [InlineData("PixousHR/1.2 Chrome/120", "Mobile app")]
    public void An_app_is_an_app_even_when_it_mentions_a_browser(string ua, string expected) =>
        Assert.Equal(expected, ClientDescription.Describe(ua));

    [Fact]
    public void Chromium_is_not_Chrome() =>
        Assert.Equal("Other on Linux", ClientDescription.Describe("Mozilla/5.0 (X11; Linux) Chromium/120"));

    [Theory]
    [InlineData("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537", "Chrome on Windows")]
    [InlineData("Mozilla/5.0 (Macintosh; Intel Mac OS X) Firefox/121", "Firefox on macOS")]
    [InlineData("Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/605", "Safari on iOS")]
    [InlineData("Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile", "Chrome on Android")]
    public void Browser_and_os_are_both_named(string ua, string expected) =>
        Assert.Equal(expected, ClientDescription.Describe(ua));

    /// <summary>
    /// With no OS recognised, the browser stands alone — no trailing " on ".
    /// </summary>
    [Fact]
    public void An_unknown_os_leaves_the_browser_alone() =>
        Assert.Equal("Firefox", ClientDescription.Describe("Firefox/121"));
}
