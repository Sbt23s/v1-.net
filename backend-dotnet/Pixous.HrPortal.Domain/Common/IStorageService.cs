namespace Pixous.HrPortal.Domain.Common;

/// <summary>
/// Stores and reads uploaded files. Ported from
/// com.pixous.hrportal.common.StorageService.
///
/// Files live in the DATABASE — the <c>system_files</c> table — not on the
/// filesystem, with the filesystem kept only as a read fallback for rows written
/// before that change. A deployment that moves to a new machine therefore
/// carries its files with the database.
/// </summary>
public interface IStorageService
{
    /// <summary>
    /// Stores an upload under <c>&lt;folder&gt;/&lt;yyyy-MM&gt;/&lt;uuid&gt;.&lt;ext&gt;</c>
    /// and returns the relative path, which is what the owning row stores.
    ///
    /// The extension is allowlisted, not preserved — see
    /// <see cref="StoragePaths.SafeExtension"/>.
    /// </summary>
    Task<string> StoreAsync(Stream content, string? originalFileName, string? contentType,
                            long sizeBytes, string folder, CancellationToken ct = default);

    /// <summary>Writes raw bytes (a generated PDF, a QR png) under a known name.</summary>
    Task<string> StoreBytesAsync(byte[] content, string folder, string fileName,
                                 CancellationToken ct = default);

    /// <summary>The stored bytes, or a not-found error.</summary>
    Task<StoredFile> ReadAsync(string relativePath, CancellationToken ct = default);
}

/// <summary>A file as it comes back out of storage.</summary>
public sealed record StoredFile(string RelativePath, string FileName, string? ContentType,
                                byte[] Data);

/// <summary>
/// The naming and safety rules for stored files, kept separate so they can be
/// tested without a database.
/// </summary>
public static class StoragePaths
{
    /// <summary>
    /// Extensions that are safe for a browser to open on our own origin.
    ///
    /// Everything else keeps its bytes but is stored under ".bin", so the file
    /// endpoint can never be talked into serving it as text/html or
    /// image/svg+xml. Without this, uploading "x.html" produced a file the
    /// server handed back as HTML from a public URL — a script running on the
    /// API's own origin, from a link that looks entirely legitimate.
    ///
    /// SVG is deliberately NOT here: it is an image everywhere except that it
    /// can carry script.
    /// </summary>
    private static readonly HashSet<string> InlineSafeExtensions = new(StringComparer.Ordinal)
    {
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico",
        "pdf", "txt", "csv",
        "doc", "docx", "xls", "xlsx", "ppt", "pptx",
        "zip", "mp3", "wav", "m4a", "ogg", "mp4", "webm"
    };

    /// <summary>
    /// Lower-cased, stripped of anything that is not a letter or digit, and
    /// allowlisted. Anything unrecognised — or absurdly long, or empty — becomes
    /// "bin".
    ///
    /// The stripping matters as much as the allowlist: it is what turns
    /// "html?x=" or "ph\np" into a single token before the set is consulted.
    /// </summary>
    public static string SafeExtension(string? raw)
    {
        string ext = new string((raw ?? string.Empty)
            .ToLowerInvariant()
            .Where(char.IsAsciiLetterOrDigit)
            .ToArray());

        if (ext.Length == 0 || ext.Length > 8)
        {
            return "bin";
        }

        return InlineSafeExtensions.Contains(ext) ? ext : "bin";
    }

    /// <summary>
    /// The relative path an upload is stored under:
    /// <c>folder/yyyy-MM/{guid}.{ext}</c>. The month folder keeps any one
    /// directory from growing without limit, and the GUID means an upload can
    /// never overwrite another or be guessed from its name.
    /// </summary>
    public static string BuildRelativePath(string folder, string? originalFileName,
                                           DateOnly today)
    {
        string raw = originalFileName ?? "file";
        string ext = raw.Contains('.')
            ? raw[(raw.LastIndexOf('.') + 1)..]
            : "bin";

        return $"{folder}/{today:yyyy-MM}/{Guid.NewGuid()}.{SafeExtension(ext)}";
    }

    /// <summary>
    /// Refuses a path that escapes the storage root.
    ///
    /// The traversal check lived only in the file controller, which rejects a
    /// path containing "..". That covers the one route serving files today, but
    /// it puts the guarantee in the caller rather than in the thing being
    /// guarded — so the next caller inherits nothing.
    ///
    /// Purely defensive: legitimate paths are GUID-based names under the root
    /// and are unaffected.
    /// </summary>
    public static bool IsSafeRelativePath(string? relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
        {
            return false;
        }

        // A rooted or drive-qualified path escapes by definition, before any
        // ".." is considered.
        if (Path.IsPathRooted(relativePath) || relativePath.Contains(':'))
        {
            return false;
        }

        // Both separators, because a path written on Windows may be read on
        // Linux and the reverse.
        string[] segments = relativePath.Split('/', '\\');
        return !segments.Any(s => s == ".." || s == ".");
    }
}
