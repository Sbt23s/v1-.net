using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Pixous.HrPortal.Domain.Common;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Serves stored files (profile photos, receipts) as raw bytes so they can be
/// used directly in an <c>&lt;img src&gt;</c>.
///
/// Ported from com.pixous.hrportal.modules.file.FileController.
///
/// **Public on purpose.** Image requests from the browser do not carry the JWT
/// Authorization header, so a guarded route would show broken images everywhere.
/// Stored paths are GUID-based and unguessable, which is what stands in for the
/// missing authentication — and it is why `StoragePaths.BuildRelativePath` must
/// keep using a GUID rather than anything derived from the uploaded name.
///
/// Two defences sit behind that, and both are here deliberately:
///
///   1. the extension allowlist in StoragePaths.SafeExtension, which means an
///      uploaded "x.html" is already stored as ".bin"; and
///   2. the inline/attachment decision below, so anything that is not plainly an
///      image is SAVED rather than rendered even if it reached here.
///
/// Without them, uploading an HTML file produced a script running on the API's
/// own origin, from a link that looks entirely legitimate.
/// </summary>
[ApiController]
[Route("api/files")]
[AllowAnonymous]
public sealed class FileController : ControllerBase
{
    private readonly IStorageService _storage;

    /// <summary>
    /// Maps an extension to a content type, as Spring's MediaTypeFactory does.
    /// Anything unrecognised becomes application/octet-stream, which is not
    /// rendered by a browser.
    /// </summary>
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    public FileController(IStorageService storage)
    {
        _storage = storage;
    }

    [HttpGet("{**relativePath}")]
    public async Task<IActionResult> Serve(string relativePath, CancellationToken ct)
    {
        // ASP.NET has already decoded the catch-all segment, unlike the Java
        // which decodes the raw URI by hand.
        if (string.IsNullOrWhiteSpace(relativePath) || relativePath.Contains(".."))
        {
            return BadRequest();
        }

        StoredFile file = await _storage.ReadAsync(relativePath, ct);

        if (!ContentTypes.TryGetContentType(relativePath, out string? contentType))
        {
            contentType = "application/octet-stream";
        }

        // Second line of defence behind the extension allowlist.
        //
        // This route is public so that <img src> works without an Authorization
        // header, which means anything served inline runs on our origin. Images
        // stay inline -- that is the whole point of the route. Everything else
        // is sent as a download, so a file that somehow reaches here with an
        // executable-in-a-browser type is saved rather than rendered.
        //
        // SVG is excluded from "image" for that reason: it is an image
        // everywhere except that it can carry script.
        bool inline = contentType.StartsWith("image/", StringComparison.Ordinal)
                   && !contentType.Contains("svg", StringComparison.Ordinal);

        // Stops the browser second-guessing the type we declared.
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers.CacheControl = "public, max-age=604800"; // seven days

        if (!inline)
        {
            string name = relativePath[(relativePath.LastIndexOf('/') + 1)..];
            Response.Headers.ContentDisposition = $"attachment; filename=\"{name}\"";
        }

        return File(file.Data, contentType);
    }
}
