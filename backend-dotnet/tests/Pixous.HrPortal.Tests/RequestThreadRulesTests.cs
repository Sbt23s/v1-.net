using Pixous.HrPortal.Domain.Modules.RequestThread;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// The attachment and thread rules.
///
/// The allow-list and the filename handling are the two that matter for safety:
/// one decides what can be stored, the other makes sure a name a browser sent
/// can never be read as a path.
/// </summary>
public sealed class RequestThreadRulesTests
{
    // ---- The request kind --------------------------------------------------

    [Theory]
    [InlineData("LEAVE", "LEAVE")]
    [InlineData("leave", "LEAVE")]
    [InlineData("  Leave  ", "LEAVE")]
    [InlineData("PERMISSION", "PERMISSION")]
    [InlineData("permission", "PERMISSION")]
    public void TheKnownKindsAreAcceptedInAnyCasing(string input, string expected)
    {
        Assert.True(RequestKinds.TryNormalise(input, out string kind));
        Assert.Equal(expected, kind);
    }

    /// <summary>
    /// Anything else is refused rather than quietly treated as one of the two.
    /// A typo must not end up reading the other table.
    /// </summary>
    [Theory]
    [InlineData("WFH")]
    [InlineData("LEAVES")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("../leave")]
    public void AnythingElseIsRefused(string? input)
    {
        Assert.False(RequestKinds.TryNormalise(input, out _));
    }

    // ---- What may be attached ----------------------------------------------

    /// <summary>
    /// An allow-list, not a block-list. The question is what a medical
    /// certificate or a photograph of a document can be, and the answer is
    /// short.
    /// </summary>
    [Theory]
    [InlineData("image/jpeg")]
    [InlineData("image/png")]
    [InlineData("image/webp")]
    [InlineData("image/heic")]
    [InlineData("image/heif")]
    [InlineData("application/pdf")]
    [InlineData("application/msword")]
    [InlineData("application/vnd.openxmlformats-officedocument.wordprocessingml.document")]
    public void TheAllowedTypesAreAccepted(string contentType)
    {
        Assert.True(AttachmentRules.IsAllowed(contentType));
    }

    /// <summary>
    /// An archive, a script or an executable has no business on a leave request
    /// whatever it claims to be. SVG is absent for the same reason it is absent
    /// from the file module: it can carry script.
    /// </summary>
    [Theory]
    [InlineData("application/zip")]
    [InlineData("application/x-msdownload")]
    [InlineData("text/html")]
    [InlineData("image/svg+xml")]
    [InlineData("application/octet-stream")]
    [InlineData("")]
    [InlineData(null)]
    public void EverythingElseIsRefused(string? contentType)
    {
        Assert.False(AttachmentRules.IsAllowed(contentType));
    }

    [Fact]
    public void TheTypeCheckIsCaseInsensitive()
    {
        Assert.True(AttachmentRules.IsAllowed("IMAGE/JPEG"));
        Assert.True(AttachmentRules.IsAllowed("Application/PDF"));
    }

    /// <summary>
    /// An image is rendered inline; a PDF gets a download rather than being
    /// squeezed into an img tag.
    /// </summary>
    [Fact]
    public void OnlyImagesAreRenderedInline()
    {
        Assert.True(AttachmentRules.IsImage("image/png"));
        Assert.True(AttachmentRules.IsImage("IMAGE/JPEG"));
        Assert.False(AttachmentRules.IsImage("application/pdf"));
        Assert.False(AttachmentRules.IsImage(null));
    }

    [Fact]
    public void TheLimitsAreTenFilesAndTenMegabytes()
    {
        Assert.Equal(10, AttachmentRules.MaxFilesPerRequest);
        Assert.Equal(10L * 1024 * 1024, AttachmentRules.MaxFileBytes);
    }

    // ---- The filename ------------------------------------------------------

    /// <summary>
    /// A browser may send a path. The name is for display and is never used to
    /// build one, but it is reduced to its last segment anyway -- defence that
    /// costs nothing.
    /// </summary>
    [Theory]
    [InlineData("report.pdf", "report.pdf")]
    [InlineData("C:\\Users\\me\\report.pdf", "report.pdf")]
    [InlineData("/var/tmp/report.pdf", "report.pdf")]
    [InlineData("../../etc/passwd", "passwd")]
    [InlineData("..\\..\\windows\\system32\\config", "config")]
    public void OnlyTheLastSegmentOfAFilenameIsKept(string given, string expected)
    {
        Assert.Equal(expected, AttachmentRules.SafeName(given));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("/")]
    [InlineData("some/dir/")]
    public void AnEmptyOrDirectoryOnlyNameFallsBack(string? given)
    {
        Assert.Equal("attachment", AttachmentRules.SafeName(given));
    }

    /// <summary>Trimmed to the column, keeping the END so the extension survives.</summary>
    [Fact]
    public void AVeryLongNameIsTrimmedToTheColumn()
    {
        string long300 = new string('a', 296) + ".pdf";

        string safe = AttachmentRules.SafeName(long300);

        Assert.Equal(255, safe.Length);
        Assert.EndsWith(".pdf", safe);
    }

    // ---- The notification preview ------------------------------------------

    /// <summary>Whitespace collapsed, so a multi-line comment reads as one line.</summary>
    [Fact]
    public void ThePreviewCollapsesWhitespace()
    {
        Assert.Equal("one two three",
                     AttachmentRules.Preview("  one\n\ttwo   three  "));
    }

    /// <summary>Cut at 90 with an ellipsis, and left alone below that.</summary>
    [Fact]
    public void ThePreviewIsCutAtNinetyCharacters()
    {
        string exactly90 = new string('x', 90);
        Assert.Equal(exactly90, AttachmentRules.Preview(exactly90));

        string tooLong = new string('x', 200);
        string preview = AttachmentRules.Preview(tooLong);

        Assert.Equal(90, preview.Length);      // 89 characters plus the ellipsis
        Assert.EndsWith("\u2026", preview);
    }

    [Fact]
    public void AnEmptyMessagePreviewsAsEmpty()
    {
        Assert.Equal("", AttachmentRules.Preview(""));
        Assert.Equal("", AttachmentRules.Preview("   \n  "));
    }
}
