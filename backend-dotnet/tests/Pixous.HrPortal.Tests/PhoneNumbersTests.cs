using Pixous.HrPortal.Domain.Common;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// Phone normalisation, checked against com.pixous.hrportal.common.SmsService.
/// Every expectation below was produced by RUNNING the Java, not by reading it.
/// </summary>
public class PhoneNumbersTests
{
    [Theory]
    [InlineData("9876543210", "+919876543210")]      // plain local number
    [InlineData("09876543210", "+919876543210")]     // trunk prefix dropped
    [InlineData("+919876543210", "+919876543210")]   // already E.164
    [InlineData("98765 43210", "+919876543210")]     // spaces stripped
    [InlineData("(98765) 43210", "+919876543210")]   // punctuation stripped
    [InlineData("0091 9876543210", "+919876543210")] // 00 prefix dropped
    [InlineData("91 9876543210", "+919876543210")]   // country code present
    public void Normalises_to_E164(string input, string expected) =>
        Assert.Equal(expected, PhoneNumbers.ToE164(input));

    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData(null)]
    public void Nothing_usable_is_null(string? input) =>
        Assert.Null(PhoneNumbers.ToE164(input));

    /// <summary>
    /// All zeros leaves nothing after the trunk prefix is dropped, and the Java
    /// answers a bare "+". Useless as a number, and the gateway rejects it --
    /// but reproduced so the two backends do not differ on what they hand a
    /// caller that checks for null.
    /// </summary>
    [Fact]
    public void All_zeros_gives_a_bare_plus_as_the_Java_does() =>
        Assert.Equal("+", PhoneNumbers.ToE164("000"));

    /// <summary>
    /// Nine digits is not ten, so it is assumed to already carry a country code
    /// and only gains the "+". That is a guess and it is the Java's guess; the
    /// result is undeliverable and the gateway says so.
    /// </summary>
    [Fact]
    public void A_short_number_is_passed_through_rather_than_rejected() =>
        Assert.Equal("+987654321", PhoneNumbers.ToE164("987654321"));
}
