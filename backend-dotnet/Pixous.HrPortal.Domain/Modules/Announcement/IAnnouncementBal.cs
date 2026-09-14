namespace Pixous.HrPortal.Domain.Modules.Announcement;

/// <summary>
/// The announcement every user sees at sign-in. Ported from
/// com.pixous.hrportal.modules.announcement.GlobalLoginAnnouncementService.
///
/// Two controllers sit on this, and they are not equally trusted: employees get
/// one read-only endpoint, and everything that writes is behind
/// hasRole('TECHNICAL_ADMIN').
/// </summary>
public interface IAnnouncementBal
{
    /// <summary>
    /// The announcement to show this role, or null.
    ///
    /// See <see cref="IAnnouncementDal.FindLatestActiveAsync"/> for the part of
    /// this that surprises people: it considers exactly ONE announcement.
    /// </summary>
    Task<AnnouncementRecord?> ActiveForRoleAsync(string? role, CancellationToken ct = default);

    /// <summary>Everything not deleted, newest first. Technical admin only.</summary>
    Task<IReadOnlyList<AnnouncementRecord>> ListAllAsync(CancellationToken ct = default);

    /// <summary>
    /// Publishes or retires one. Publishing retires whatever else was active —
    /// only one announcement is ever on the login screen.
    /// </summary>
    Task<AnnouncementRecord> UpdateStatusAsync(long id, string? status,
                                               CancellationToken ct = default);

    /// <summary>
    /// Retires an announcement for good. A soft delete: the row stays, its
    /// status becomes DELETED, and <see cref="ListAllAsync"/> stops returning
    /// it. Nothing is removed from the table.
    /// </summary>
    Task DeleteAsync(long id, CancellationToken ct = default);

    Task<AnnouncementRecord> CreateAndPublishAsync(
        string? mediaType,
        string? title,
        string? description,
        string? targetRoles,
        int? durationSeconds,
        bool? publishImmediately,
        Stream? fileStream,
        string? fileName,
        string? contentType,
        long? fileSize,
        Stream? effectStream,
        string? effectFileName,
        string? effectContentType,
        long? effectFileSize,
        bool? effectEnabled,
        long? createdBy,
        string? createdByName,
        CancellationToken ct = default);
}

/// <summary>A row of <c>global_login_announcements</c>.</summary>
public sealed class AnnouncementRecord
{
    public long Id { get; set; }
    public string? Title { get; set; }
    public string? Description { get; set; }

    /// <summary>VIDEO | IMAGE | POSTER.</summary>
    public string? MediaType { get; set; }

    public string? MediaUrl { get; set; }
    public string? MediaName { get; set; }
    public long? MediaSize { get; set; }

    /// <summary>
    /// An optional Lottie animation layered OVER the media, not replacing it.
    /// Null when none was uploaded.
    /// </summary>
    public string? EffectUrl { get; set; }
    public string? EffectName { get; set; }
    public long? EffectSize { get; set; }

    /// <summary>
    /// Whether to play it — distinct from having one, so an effect can be
    /// switched off and back on without uploading it again.
    /// </summary>
    public bool EffectEnabled { get; set; }

    /// <summary>ACTIVE | INACTIVE | DELETED.</summary>
    public string? Status { get; set; }

    /// <summary>Comma separated, e.g. "Employee,TL,HR,Admin".</summary>
    public string? TargetRoles { get; set; }

    public int DurationSeconds { get; set; }
    public long? CreatedBy { get; set; }
    public string? CreatedByName { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public DateTime? PublishedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
}

/// <summary>
/// Does an announcement aimed at <paramref name="targetRoles"/> reach someone
/// holding <paramref name="role"/>?
///
/// Transcribed from GlobalLoginAnnouncementService.getActiveForUserRole. It is
/// deliberately loose, and the looseness is the point: the stored targets are
/// four fixed words ("Employee,TL,HR,Admin") while the roles in this database
/// are free text — "IT Employee", "Civil HR Manager", "Platform Super Admin".
/// An exact match would reach almost nobody, so each arm asks whether the role
/// name CONTAINS a marker.
/// </summary>
public static class AnnouncementTargeting
{
    public static bool Reaches(string? targetRoles, string? role)
    {
        // No targets at all means everyone: the Java skips the whole check.
        if (string.IsNullOrWhiteSpace(targetRoles))
        {
            return true;
        }

        string normalised = (role ?? "Employee").Trim().ToUpperInvariant();
        string target = targetRoles.ToUpperInvariant();

        return target.Contains("ALL")
            || target.Contains(normalised)
            || (normalised.Contains("EMP") && target.Contains("EMPLOYEE"))
            || (normalised.Contains("TL") && target.Contains("TL"))
            || ((normalised.Contains("HR") || normalised.Contains("MGR")) && target.Contains("HR"))
            || ((normalised.Contains("ADMIN") || normalised.Contains("SUPER")) && target.Contains("ADMIN"));
    }
}

/// <summary>Data access for announcements.</summary>
public interface IAnnouncementDal
{
    /// <summary>
    /// The most recently published ACTIVE announcement — ONE row, before any
    /// role filtering.
    ///
    /// This is findFirstByStatusOrderByPublishedAtDesc, and it has a
    /// consequence worth naming: the role test is applied AFTER the row is
    /// chosen, so if the single active announcement does not target the caller
    /// they see nothing. It does not fall through to an older active one.
    /// In practice only one row is ever ACTIVE, because publishing retires the
    /// rest, so the two readings coincide — but the ordering is preserved here
    /// rather than "improved", because changing it would change who sees what.
    /// </summary>
    Task<AnnouncementRecord?> FindLatestActiveAsync(CancellationToken ct = default);

    /// <summary>Everything whose status is not DELETED, newest created first.</summary>
    Task<IReadOnlyList<AnnouncementRecord>> FindNotDeletedAsync(CancellationToken ct = default);

    Task<IReadOnlyList<AnnouncementRecord>> FindByStatusAsync(string status,
                                                              CancellationToken ct = default);

    Task<AnnouncementRecord?> FindAsync(long id, CancellationToken ct = default);

    Task UpdateStatusAsync(long id, string status, DateTime? publishedAt, DateTime? deletedAt,
                           CancellationToken ct = default);

    Task<long> InsertAsync(AnnouncementRecord record, CancellationToken ct = default);
}
