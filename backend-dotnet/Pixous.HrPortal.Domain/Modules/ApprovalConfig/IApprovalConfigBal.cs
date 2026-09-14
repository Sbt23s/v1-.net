namespace Pixous.HrPortal.Domain.Modules.ApprovalConfig;

/// <summary>
/// Who each module's "Request to" dropdown may offer, and which Leave
/// Management tabs a role sees.
///
/// Ported from com.pixous.hrportal.modules.approvalconfig --
/// ApprovalRecipientService and ModuleVisibilityService, which are companions:
/// one decides who a request may be addressed to, the other which tabs appear
/// at all. Neither expresses the other.
///
/// <para><b>It narrows; it does not produce.</b> Each module's own service
/// still builds its candidate list -- it knows routing rules a table cannot,
/// like "a complaint raised by HR goes above HR" -- and then asks this whether
/// each candidate is allowed.</para>
///
/// <para><b>Absent means unrestricted.</b> A module with no rows behaves
/// exactly as it did before this feature existed. That is what makes it safe
/// to ship switched off, and it means a fault here cannot empty a dropdown
/// that was working.</para>
/// </summary>
public interface IApprovalConfigBal
{
    /// <summary>
    /// Whether this module may address requests to this person. True when the
    /// module has no configuration at all.
    /// </summary>
    Task<bool> AllowsAsync(string? moduleCode, ApprovalCandidate? candidate,
                           CancellationToken ct = default);

    /// <summary>
    /// Filters a candidate list a caller has already built -- the shape most
    /// callers want, keeping "unconfigured means unchanged" in one place.
    /// </summary>
    Task<IReadOnlyList<ApprovalCandidate>> FilterAsync(
        string? moduleCode, IReadOnlyList<ApprovalCandidate> candidates,
        CancellationToken ct = default);

    /// <summary>The whole admin screen: grid, people, candidates and holders.</summary>
    Task<ApprovalConfigView> GridAsync(CancellationToken ct = default);

    /// <summary>
    /// Replaces one module's role ticks. A replace, not a merge: the screen
    /// sends the state of every box, so a role missing from the list is one
    /// somebody unticked and merging would make unticking impossible.
    /// Leaves the module's named people alone.
    /// </summary>
    Task<IReadOnlyDictionary<string, bool>> SaveAsync(string? moduleCode,
                                                      IReadOnlyList<string>? roleCodes,
                                                      long? actorId,
                                                      CancellationToken ct = default);

    /// <summary>
    /// Replaces the people named on one module, leaving its role rules alone --
    /// they are separate controls on screen and saving one must not clear the
    /// other.
    /// </summary>
    Task<IReadOnlyList<long>> SavePeopleAsync(string? moduleCode,
                                              IReadOnlyList<long>? userIds,
                                              long? actorId,
                                              CancellationToken ct = default);

    /// <summary>The visibility grid: which Leave modules each role sees.</summary>
    Task<VisibilityView> VisibilityGridAsync(CancellationToken ct = default);

    /// <summary>Replaces one role's ticks. An empty list hides every module from it.</summary>
    Task<IReadOnlyDictionary<string, bool>> SaveVisibilityAsync(string? roleCode,
                                                                IReadOnlyList<string>? modules,
                                                                long? actorId,
                                                                CancellationToken ct = default);

    /// <summary>
    /// Which Leave Management tabs the signed-in person may see.
    ///
    /// Not a security boundary: a tab appearing grants nothing, and the page
    /// behind it is guarded on its own permission. Hiding one takes it off the
    /// screen without stopping the endpoint answering.
    /// </summary>
    Task<IReadOnlyList<string>> VisibleForAsync(long? userId, CancellationToken ct = default);
}

/// <summary>The fixed vocabulary of both grids, in the order the screen shows them.</summary>
public static class ApprovalConfigCatalog
{
    /// <summary>The modules whose recipients can be configured.</summary>
    public static readonly IReadOnlyList<string> Modules =
        ["HELPDESK", "COMPLAINT", "PERMISSION", "LEAVE", "WFH"];

    /// <summary>
    /// The recipients that can be ticked.
    ///
    /// CTO is a pseudo-role: an employee code in this schema, not a row in
    /// <c>roles</c>. It is spelled as a role because to the administrator it is
    /// the same kind of choice, and splitting the list to honour a storage
    /// detail would push that detail onto them.
    /// </summary>
    public static readonly IReadOnlyList<string> RecipientRoles =
        ["CTO", "SUPER_ADMIN", "COMPANY_ADMIN", "IT_MGR", "IT_HR", "CV_HR", "IT_TL"];

    /// <summary>The Leave Management tabs.</summary>
    public static readonly IReadOnlyList<string> VisibilityModules =
        ["LEAVE", "PERMISSION", "WFH", "APPROVALS", "POLICIES"];

    /// <summary>The subjects whose visibility can be configured.</summary>
    public static readonly IReadOnlyList<string> VisibilityRoles =
        ["IT_EMP", "IT_TL", "IT_HR", "CV_HR", "IT_MGR", "CTO", "SUPER_ADMIN", "COMPANY_ADMIN"];

    /// <summary>The CTO's employee code -- PlatformAccounts.CTO in the Java.</summary>
    public const string CtoEmployeeCode = "PIX-E100";
}

/// <summary>Somebody a request could be addressed to.</summary>
public sealed record ApprovalCandidate
{
    public long Id { get; init; }
    public string? Name { get; init; }
    public string? EmployeeCode { get; init; }
    public bool Enabled { get; init; }
    public string? ProfileStatus { get; init; }

    /// <summary>The role codes this person holds, upper-cased.</summary>
    public IReadOnlyList<string> RoleCodes { get; init; } = [];
}

/// <summary>Everything the admin approval screen renders.</summary>
public sealed record ApprovalConfigView(
    IReadOnlyList<string> Modules,
    IReadOnlyList<string> Roles,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, bool>> Config,
    IReadOnlyDictionary<string, IReadOnlyList<long>> People,
    IReadOnlyList<CandidateView> Candidates,
    IReadOnlyDictionary<string, IReadOnlyList<string>> Holders);

/// <summary>One pickable person, with enough beside the name to tell colleagues apart.</summary>
public sealed record CandidateView(long Id, string Name, string Code, IReadOnlyList<string> Roles);

/// <summary>The visibility screen.</summary>
public sealed record VisibilityView(
    IReadOnlyList<string> Roles,
    IReadOnlyList<string> Modules,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, bool>> Config);

/// <summary>One row of <c>approval_recipient_config</c>.</summary>
public sealed class ApprovalRecipientRow
{
    public long Id { get; set; }
    public long? CompanyId { get; set; }
    public string ModuleCode { get; set; } = "";

    /// <summary>A role code or the pseudo-role CTO; null on a person row.</summary>
    public string? RoleCode { get; set; }

    /// <summary>
    /// One named person; null on a role row. A row is one or the other --
    /// exactly one of this and <see cref="RoleCode"/> is set.
    /// </summary>
    public long? UserId { get; set; }

    public bool Enabled { get; set; }
    public long? UpdatedBy { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>One row of <c>role_module_visibility</c>.</summary>
public sealed class VisibilityRow
{
    public long Id { get; set; }
    public long? CompanyId { get; set; }
    public string RoleCode { get; set; } = "";
    public string ModuleCode { get; set; } = "";
    public bool Visible { get; set; }
    public long? UpdatedBy { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Data access for both configuration tables.</summary>
public interface IApprovalConfigDal
{
    Task<IReadOnlyList<ApprovalRecipientRow>> FindByModuleAsync(string moduleCode,
                                                                CancellationToken ct = default);
    Task<IReadOnlyList<ApprovalRecipientRow>> FindAllRecipientsAsync(CancellationToken ct = default);

    /// <summary>Replaces this module's ROLE rows, leaving its person rows alone.</summary>
    Task ReplaceRoleRowsAsync(string moduleCode, IReadOnlyCollection<string> roleCodes,
                              long? actorId, CancellationToken ct = default);

    /// <summary>Replaces this module's PERSON rows, leaving its role rows alone.</summary>
    Task ReplacePersonRowsAsync(string moduleCode, IReadOnlyCollection<long> userIds,
                                long? actorId, CancellationToken ct = default);

    Task<IReadOnlyList<VisibilityRow>> FindVisibilityByRolesAsync(
        IReadOnlyCollection<string> roleCodes, CancellationToken ct = default);
    Task<IReadOnlyList<VisibilityRow>> FindAllVisibilityAsync(CancellationToken ct = default);

    /// <summary>
    /// Replaces one role's rows. Writes a row for every module including the
    /// hidden ones, as <c>visible = false</c> -- see the BAL for why absence
    /// must keep meaning "nobody configured this".
    /// </summary>
    Task ReplaceVisibilityAsync(string roleCode,
                                IReadOnlyDictionary<string, bool> modules,
                                long? actorId, CancellationToken ct = default);

    /// <summary>Addressable people holding any of these roles, plus the CTO.</summary>
    Task<IReadOnlyList<ApprovalCandidate>> FindCandidatesAsync(
        IReadOnlyCollection<string> roleCodes, CancellationToken ct = default);

    Task<ApprovalCandidate?> FindUserAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyList<ApprovalCandidate>> FindUsersAsync(IReadOnlyCollection<long> userIds,
                                                          CancellationToken ct = default);
}
