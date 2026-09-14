using System.Text.Json.Serialization;

namespace Pixous.HrPortal.Domain.Common;

/// <summary>
/// Lightweight pagination wrapper, ported from
/// com.pixous.hrportal.common.PageResponse.
///
/// Spring's Page is zero-based, so <paramref name="Page"/> is the zero-based
/// page index and <paramref name="Last"/> is true on the final page. Both are
/// read directly by the React pager, so the zero-basing is preserved rather
/// than "corrected".
/// </summary>
public sealed record PageResponse<T>(
    [property: JsonPropertyName("content")] IReadOnlyList<T> Content,
    [property: JsonPropertyName("page")] int Page,
    [property: JsonPropertyName("size")] int Size,
    [property: JsonPropertyName("totalElements")] long TotalElements,
    [property: JsonPropertyName("totalPages")] int TotalPages,
    [property: JsonPropertyName("last")] bool Last)
{
    /// <summary>
    /// Builds the envelope from a materialised slice plus the total row count,
    /// deriving totalPages and last exactly as Spring's PageImpl does.
    /// A size of zero would divide by zero in that derivation, so it yields a
    /// single page, which is what Spring reports for an unpaged result.
    /// </summary>
    public static PageResponse<T> Of(IReadOnlyList<T> content, int page, int size, long totalElements)
    {
        int totalPages = size <= 0 ? 1 : (int)Math.Ceiling(totalElements / (double)size);
        bool last = page >= totalPages - 1;
        return new PageResponse<T>(content, page, size, totalElements, totalPages, last);
    }
}
