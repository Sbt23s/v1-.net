using System.ComponentModel.DataAnnotations;

namespace Pixous.HrPortal.Domain.Modules.Appreciation;

/// <summary>
/// Appreciation letters. Ported from
/// com.pixous.hrportal.modules.appreciation.AppreciationService.
/// </summary>
public interface IAppreciationBal
{
    /// <summary>
    /// Writes a letter. <c>Send</c> false saves a draft; true sends it and tells
    /// the employee.
    /// </summary>
    Task<AppreciationRecord> CreateAsync(long issuerId, AppreciationRequest request,
                                         CancellationToken ct = default);

    /// <summary>Sends a letter that was saved as a draft.</summary>
    Task<AppreciationRecord> SendAsync(long actorId, long id, CancellationToken ct = default);

    /// <summary>
    /// Deletes a letter — **only a draft**. A sent one has been read by the
    /// person it praises, and withdrawing an appreciation after the fact is not
    /// a thing the product should make easy.
    /// </summary>
    Task DeleteAsync(long id, CancellationToken ct = default);

    Task<IReadOnlyList<AppreciationRecord>> AllAsync(CancellationToken ct = default);

    /// <summary>Letters addressed to the caller.</summary>
    Task<IReadOnlyList<AppreciationRecord>> MineAsync(long userId, CancellationToken ct = default);

    /// <summary>
    /// One letter, if the caller is its subject, its issuer, or somebody who
    /// issues letters.
    ///
    /// Reading it as the SUBJECT marks it viewed and tells the issuer — but only
    /// once, and only for a sent letter. Writing a letter and then opening it
    /// must not mark it viewed.
    /// </summary>
    Task<AppreciationRecord> GetAsync(long viewerId, long id, bool canIssue,
                                      CancellationToken ct = default);

    /// <summary>Renders the appreciation letter as an official PDF.</summary>
    Task<byte[]> GetPdfAsync(long viewerId, long id, bool canIssue, CancellationToken ct = default);

    /// <summary>Records that the employee downloaded their appreciation letter.</summary>
    Task MarkDownloadedAsync(long viewerId, long id, CancellationToken ct = default);
}


/// <summary>
/// A letter being written.
///
/// The four required fields match the Java's @NotNull / @NotBlank. Marked here
/// so a missing one is a 400 from the model binder rather than a 500 from a NOT
/// NULL column.
/// </summary>
public sealed record AppreciationRequest
{
    [Required(ErrorMessage = "employeeId is required")]
    public required long EmployeeId { get; init; }

    [Required(ErrorMessage = "letterDate is required")]
    public required DateOnly LetterDate { get; init; }

    [Required(AllowEmptyStrings = false, ErrorMessage = "achievement is required")]
    public required string Achievement { get; init; }

    [Required(AllowEmptyStrings = false, ErrorMessage = "message is required")]
    public required string Message { get; init; }

    public string? Template { get; init; }

    /// <summary>False saves a draft; true sends it and tells the employee.</summary>
    public bool? Send { get; init; }
}

/// <summary>A row of <c>appreciation_letters</c>.</summary>
public sealed class AppreciationRecord
{
    public long Id { get; set; }
    public string? ReferenceCode { get; set; }
    public long EmployeeId { get; set; }
    public long? IssuedBy { get; set; }
    public DateOnly? LetterDate { get; set; }
    public string? Achievement { get; set; }
    public string? Message { get; set; }
    public string? Template { get; set; }
    public string? Status { get; set; }
    public DateTime? ViewedAt { get; set; }
    public DateTime? DownloadedAt { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    /// <summary>Denormalised for the list views.</summary>
    public string? EmployeeName { get; set; }
    public string? IssuedByName { get; set; }
    public string? EmployeeDesignation { get; set; }
    public string? IssuedByDesignation { get; set; }
}


/// <summary>Data access for appreciation letters.</summary>
public interface IAppreciationDal
{
    Task<string?> FindMaxReferenceCodeAsync(string prefix, CancellationToken ct = default);
    Task<long> InsertAsync(AppreciationRecord record, CancellationToken ct = default);
    Task UpdateAsync(AppreciationRecord record, CancellationToken ct = default);
    Task DeleteAsync(long id, CancellationToken ct = default);
    Task<AppreciationRecord?> FindAsync(long id, CancellationToken ct = default);
    Task<IReadOnlyList<AppreciationRecord>> FindForEmployeeAsync(long employeeId,
                                                                 CancellationToken ct = default);
    Task<IReadOnlyList<AppreciationRecord>> FindAllAsync(CancellationToken ct = default);
}
