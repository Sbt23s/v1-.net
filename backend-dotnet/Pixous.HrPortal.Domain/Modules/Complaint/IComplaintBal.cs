using System.ComponentModel.DataAnnotations;

namespace Pixous.HrPortal.Domain.Modules.Complaint;

/// <summary>
/// Complaints and needs. Ported from
/// com.pixous.hrportal.modules.complaint.ComplaintService.
///
/// One table carries both: <c>kind</c> separates a complaint from a request for
/// something. The routing is the interesting part — a complaint addressed to a
/// particular desk is theirs to answer, and oversight answers anything.
/// </summary>
public interface IComplaintBal
{
    Task<ComplaintRecord> RaiseAsync(long userId, ComplaintRequest request,
                                     CancellationToken ct = default);

    /// <summary>Complaints the caller raised.</summary>
    Task<IReadOnlyList<ComplaintRecord>> MineAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyList<ComplaintRecord>> AllAsync(CancellationToken ct = default);

    Task<ComplaintRecord> GetAsync(long id, CancellationToken ct = default);

    /// <summary>
    /// Answers a complaint. Only the desk it was addressed to, anybody when it
    /// was addressed to nobody, and oversight always.
    /// </summary>
    Task<ComplaintRecord> RespondAsync(long staffId, long id, string? status, string? response,
                                       CancellationToken ct = default);

    /// <summary>Withdraws a complaint. Only its author, and only while OPEN.</summary>
    Task<ComplaintRecord> CancelAsync(long userId, long id, CancellationToken ct = default);

    /// <summary>HR and management staff a complaint or need can be addressed to.</summary>
    Task<IReadOnlyList<ComplaintRecipientView>> RecipientsAsync(long userId, CancellationToken ct = default);
}

public sealed record ComplaintRecipientView(long Id, string Name, string? Code, string Role);


/// <summary>What is being raised. Subject and description are required.</summary>
public sealed record ComplaintRequest
{
    /// <summary>COMPLAINT or NEED. One table carries both.</summary>
    public string? Kind { get; init; }

    public string? Category { get; init; }

    [Required(AllowEmptyStrings = false, ErrorMessage = "Subject is required")]
    public required string Subject { get; init; }

    [Required(AllowEmptyStrings = false,
        ErrorMessage = "Please describe your complaint or need")]
    public required string Description { get; init; }

    public string? Priority { get; init; }

    /// <summary>The desk this is for. Null means anybody may answer it.</summary>
    public long? RequestedTo { get; init; }
}

/// <summary>A row of <c>complaints_needs</c>.</summary>
public sealed class ComplaintRecord
{
    public long Id { get; set; }
    public string? ReferenceCode { get; set; }
    public long RaisedBy { get; set; }
    public long? RequestedTo { get; set; }
    public string? Kind { get; set; }
    public string? Category { get; set; }
    public string? Subject { get; set; }
    public string? Description { get; set; }
    public string? Priority { get; set; }
    public string? Status { get; set; }
    public string? HrResponse { get; set; }
    public long? HandledBy { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public long? CompanyId { get; set; }

    /// <summary>Denormalised for the list views.</summary>
    public string? RaisedByName { get; set; }
    public string? RequestedToName { get; set; }
}

/// <summary>The statuses a complaint may be set to.</summary>
public static class ComplaintStatuses
{
    public static readonly IReadOnlySet<string> Valid =
        new HashSet<string>(StringComparer.Ordinal)
        {
            "OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"
        };
}

/// <summary>Data access for complaints.</summary>
public interface IComplaintDal
{
    Task<string?> FindMaxReferenceCodeAsync(string prefix, CancellationToken ct = default);
    Task<long> InsertAsync(ComplaintRecord record, CancellationToken ct = default);
    Task UpdateAsync(ComplaintRecord record, CancellationToken ct = default);
    Task<ComplaintRecord?> FindAsync(long id, CancellationToken ct = default);
    Task<IReadOnlyList<ComplaintRecord>> FindForUserAsync(long userId,
                                                          CancellationToken ct = default);
    Task<IReadOnlyList<ComplaintRecord>> FindAllAsync(CancellationToken ct = default);

    /// <summary>Oversight — the CTO and the platform administrator, by employee code.</summary>
    Task<bool> SeesEveryRequestAsync(long userId, CancellationToken ct = default);

    Task<string?> FindUserNameAsync(long userId, CancellationToken ct = default);
    Task<IReadOnlyList<ComplaintRecipientView>> FindRecipientsAsync(long userId, CancellationToken ct = default);
}

