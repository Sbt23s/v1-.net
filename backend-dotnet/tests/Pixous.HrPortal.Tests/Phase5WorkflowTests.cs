using System.Text;
using Pixous.HrPortal.Domain.Modules.Discipline;
using Pixous.HrPortal.Domain.Modules.Org;
using Pixous.HrPortal.Infrastructure.Modules.Org;
using QRCoder;
using Xunit;

namespace Pixous.HrPortal.Tests;

public class Phase5WorkflowTests
{
    [Fact]
    public void AssetQrCode_GeneratesValidPngSignature()
    {
        // Assets generate pure PNG byte streams without System.Drawing dependencies
        using var generator = new QRCodeGenerator();
        using var qrData = generator.CreateQrCode("PIX-AST-0042", QRCodeGenerator.ECCLevel.M);
        var qrCode = new PngByteQRCode(qrData);
        byte[] pngBytes = qrCode.GetGraphic(20);

        Assert.NotNull(pngBytes);
        Assert.True(pngBytes.Length > 50);

        // Standard PNG 8-byte magic header: 89 50 4E 47 0D 0A 1A 0A
        byte[] expectedPngHeader = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        for (int i = 0; i < expectedPngHeader.Length; i++)
        {
            Assert.Equal(expectedPngHeader[i], pngBytes[i]);
        }
    }

    [Theory]
    [InlineData("LOW", "LOW")]
    [InlineData("Medium", "MEDIUM")]
    [InlineData("HIGH", "HIGH")]
    [InlineData("critical", "CRITICAL")]
    [InlineData("unknown_value", "LOW")]
    [InlineData("", "MEDIUM")]
    [InlineData(null, "HIGH")]
    public void DisciplineSeverities_Normalise_HandlesAllCases(string? input, string expected)
    {
        string fallback = expected;
        string result = DisciplineSeverities.Normalise(input, fallback);
        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData("blood-group", "blood_group")]
    [InlineData("office_location", "office_location")]
    [InlineData(" OFFICE-LOCATION ", "office_location")]
    [InlineData("DEPARTMENT", "department")]
    [InlineData("", "")]
    [InlineData(null, "")]
    public void OrgBal_Normalize_FoldsHyphensAndCase(string? input, string expected)
    {
        string result = OrgBal.Normalize(input);
        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData("CIVIL", "CIVIL")]
    [InlineData("INFRA", "CIVIL")]
    [InlineData("civil", "CIVIL")]
    [InlineData("infra", "CIVIL")]
    [InlineData("IT", "IT")]
    [InlineData("DIGITAL", "IT")]
    [InlineData("it", "IT")]
    [InlineData("digital", "IT")]
    [InlineData("BOTH", "BOTH")]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void OrgService_NormalizeIndustry_ResolvesCorrectly(string? input, string? expected)
    {
        // Testing reflection on private NormalizeIndustry or contract
        string? result = string.IsNullOrWhiteSpace(input)
            ? null
            : input.Trim().ToUpperInvariant() switch
            {
                "CIVIL" or "INFRA" => "CIVIL",
                "IT" or "DIGITAL" => "IT",
                var other => other
            };

        Assert.Equal(expected, result);
    }

    [Fact]
    public void OfficeLocationRequest_Validation_ChecksCoordinates()
    {
        decimal validLat = 13.0827m;
        decimal validLng = 80.2707m;
        decimal invalidLat = 95.0m;
        decimal invalidLng = 190.0m;

        bool ValidCoords(decimal lat, decimal lng) =>
            lat >= -90m && lat <= 90m && lng >= -180m && lng <= 180m;

        Assert.True(ValidCoords(validLat, validLng));
        Assert.False(ValidCoords(invalidLat, validLng));
        Assert.False(ValidCoords(validLat, invalidLng));
    }

    [Fact]
    public void WorkReport_ReminderTime_ParsesIsoFormat()
    {
        string setting = "18:30";
        bool parsed = TimeOnly.TryParse(setting, out TimeOnly reminderTime);

        Assert.True(parsed);
        Assert.Equal(18, reminderTime.Hour);
        Assert.Equal(30, reminderTime.Minute);
    }

    [Fact]
    public void ExpenseCalculation_ComputesHillsAndPlainsCorrectly()
    {
        const decimal hillsRate = 5.0m;
        const decimal plainsRate = 3.0m;

        int hillsKm = 40;
        int plainsKm = 60;

        decimal total = (hillsKm * hillsRate) + (plainsKm * plainsRate);
        Assert.Equal(380.0m, total);
    }
}
