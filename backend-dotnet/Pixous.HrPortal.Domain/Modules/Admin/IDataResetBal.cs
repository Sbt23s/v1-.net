namespace Pixous.HrPortal.Domain.Modules.Admin;

/// <summary>
/// Clears operational data, area by area. Ported from
/// com.pixous.hrportal.modules.admin.DataResetService.
///
/// This deletes real data and there is no undo. Two guards stand in front of it
/// and both are enforced HERE rather than only in the browser, so nothing can be
/// emptied by a stray request:
///
///   1. the caller must hold SUPER_ADMIN or COMPANY_ADMIN, and
///   2. the word RESET must be typed out.
/// </summary>
public interface IDataResetBal
{
    /// <summary>What each area holds right now, and what it would leave behind.</summary>
    Task<IReadOnlyList<DataResetPreview>> PreviewAsync(CancellationToken ct = default);

    /// <summary>
    /// Clears the named areas and reports how many rows each held.
    ///
    /// Throws when the confirmation is not exactly "RESET", when no area is
    /// named, or when a name matches nothing — all three before a single row is
    /// touched.
    /// </summary>
    Task<DataResetResult> ResetAsync(IReadOnlyCollection<string>? areaNames, string? confirmation,
                                     long? actorId, CancellationToken ct = default);
}

/// <summary>One area's current size, for the confirmation screen.</summary>
public sealed record DataResetPreview(string Area, string Clears, string Keeps, long Rows);

/// <summary>What a reset cleared: rows per area, and the total.</summary>
public sealed record DataResetResult(IReadOnlyDictionary<string, long> Cleared, long Total);
