using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.ApprovalConfig;

namespace Pixous.HrPortal.Infrastructure.Modules.ApprovalConfig;

/// <summary>
/// Ported from ApprovalRecipientService and ModuleVisibilityService, which the
/// Java keeps as two classes behind one controller. They are together here
/// because they back a single screen and share the CTO pseudo-role rule.
///
/// The decisions themselves live in <see cref="ApprovalConfigRules"/> in the
/// Domain — they are pure functions over rows, and every one of them fails
/// silently when wrong, so they are tested directly. What remains here is
/// fetching rows and writing them back.
/// </summary>
public sealed class ApprovalConfigBal : IApprovalConfigBal
{
    private readonly IApprovalConfigDal _dal;

    public ApprovalConfigBal(IApprovalConfigDal dal)
    {
        _dal = dal;
    }

    // ---- Recipients -------------------------------------------------------

    private async Task<ApprovalConfigRules.Rules> RulesForAsync(string? moduleCode,
                                                                CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(moduleCode))
        {
            return ApprovalConfigRules.RulesFor([]);
        }

        return ApprovalConfigRules.RulesFor(
            await _dal.FindByModuleAsync(moduleCode.ToUpperInvariant(), ct));
    }

    public async Task<bool> AllowsAsync(string? moduleCode, ApprovalCandidate? candidate,
                                        CancellationToken ct = default) =>
        ApprovalConfigRules.Allows(await RulesForAsync(moduleCode, ct), candidate);

    public async Task<IReadOnlyList<ApprovalCandidate>> FilterAsync(
        string? moduleCode, IReadOnlyList<ApprovalCandidate> candidates,
        CancellationToken ct = default)
    {
        ApprovalConfigRules.Rules rules = await RulesForAsync(moduleCode, ct);

        // Unconfigured returns the list untouched -- the rule that makes this
        // feature safe to ship switched off.
        return rules.IsEmpty
            ? candidates
            : candidates.Where(u => ApprovalConfigRules.Matches(rules, u)).ToArray();
    }

    public async Task<ApprovalConfigView> GridAsync(CancellationToken ct = default)
    {
        IReadOnlyList<ApprovalRecipientRow> all = await _dal.FindAllRecipientsAsync(ct);

        // The people named per module, by id -- a different kind of rule from
        // the role ticks, shown in a different control on screen.
        var people = new Dictionary<string, IReadOnlyList<long>>(StringComparer.Ordinal);
        foreach (string module in ApprovalConfigCatalog.Modules)
        {
            people[module] = all.Where(r => r.Enabled
                                         && r.UserId is not null
                                         && string.Equals(r.ModuleCode, module,
                                                          StringComparison.OrdinalIgnoreCase))
                                .Select(r => r.UserId!.Value)
                                .ToArray();
        }

        IReadOnlyList<ApprovalCandidate> pickable = await PickableAsync(ct);

        var candidates = pickable
            .Select(u => new CandidateView(u.Id, u.Name?.Trim() ?? "", u.EmployeeCode ?? "",
                                           u.RoleCodes.OrderBy(c => c, StringComparer.Ordinal)
                                                      .ToArray()))
            .OrderBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return new ApprovalConfigView(
            ApprovalConfigCatalog.Modules,
            ApprovalConfigCatalog.RecipientRoles,
            ApprovalConfigRules.Grid(all),
            people,
            candidates,
            Holders(pickable));
    }

    /// <summary>Everybody who could be named on a module: the configurable roles, plus the CTO.</summary>
    private Task<IReadOnlyList<ApprovalCandidate>> PickableAsync(CancellationToken ct)
    {
        // CTO is dropped from the role query because it is not a role; the DAL
        // brings that account back by employee code in the same statement.
        string[] wanted = ApprovalConfigCatalog.RecipientRoles
                                               .Where(r => r != "CTO")
                                               .ToArray();

        return _dal.FindCandidatesAsync(wanted, ct);
    }

    /// <summary>
    /// Who actually holds each configurable role, by name.
    ///
    /// The grid shows role codes, and an administrator ticking one could not
    /// otherwise tell who that reaches -- HR is three accounts on this data,
    /// and which people a tick reaches is the whole question being answered.
    ///
    /// An empty list against a role is shown rather than hidden: it says
    /// "nobody holds this yet", which is a real answer and stops a tick that
    /// would silently do nothing.
    /// </summary>
    private static IReadOnlyDictionary<string, IReadOnlyList<string>> Holders(
        IReadOnlyList<ApprovalCandidate> pickable)
    {
        var holders = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);

        foreach (string role in ApprovalConfigCatalog.RecipientRoles)
        {
            IEnumerable<ApprovalCandidate> people = role == "CTO"
                ? pickable.Where(u => string.Equals(u.EmployeeCode,
                                                    ApprovalConfigCatalog.CtoEmployeeCode,
                                                    StringComparison.OrdinalIgnoreCase))
                : pickable.Where(u => u.RoleCodes.Contains(role, StringComparer.OrdinalIgnoreCase));

            holders[role] = people.Select(u => u.Name?.Trim() ?? "")
                                  .Where(n => n.Length > 0)
                                  .Distinct(StringComparer.OrdinalIgnoreCase)
                                  .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
                                  .ToArray();
        }

        return holders;
    }

    public async Task<IReadOnlyDictionary<string, bool>> SaveAsync(
        string? moduleCode, IReadOnlyList<string>? roleCodes, long? actorId,
        CancellationToken ct = default)
    {
        string module = (moduleCode ?? "").Trim().ToUpperInvariant();

        if (!ApprovalConfigCatalog.Modules.Contains(module))
        {
            throw ApiException.Business($"Unknown module: {moduleCode}");
        }

        IReadOnlySet<string> wanted = ApprovalConfigRules.NormaliseRoles(roleCodes);

        await _dal.ReplaceRoleRowsAsync(module, wanted, actorId, ct);

        var row = new Dictionary<string, bool>(StringComparer.Ordinal);
        foreach (string role in ApprovalConfigCatalog.RecipientRoles)
        {
            row[role] = wanted.Contains(role);
        }

        return row;
    }

    public async Task<IReadOnlyList<long>> SavePeopleAsync(
        string? moduleCode, IReadOnlyList<long>? userIds, long? actorId,
        CancellationToken ct = default)
    {
        string module = (moduleCode ?? "").Trim().ToUpperInvariant();

        if (!ApprovalConfigCatalog.Modules.Contains(module))
        {
            throw ApiException.Business($"Unknown module: {moduleCode}");
        }

        // Only real, addressable accounts: an id typed into a request body must
        // not create a rule naming somebody who has left. Resolved in ONE query
        // rather than one per id, and the caller's order is preserved because
        // the ids drive the result rather than the lookup.
        long[] requested = (userIds ?? []).Distinct().ToArray();

        HashSet<long> addressable = requested.Length == 0
            ? []
            : (await _dal.FindUsersAsync(requested, ct))
                .Where(u => u.Enabled)
                .Where(u => !string.Equals(u.ProfileStatus, "OFFBOARDED",
                                           StringComparison.OrdinalIgnoreCase))
                .Select(u => u.Id)
                .ToHashSet();

        long[] wanted = requested.Where(addressable.Contains).ToArray();

        await _dal.ReplacePersonRowsAsync(module, wanted, actorId, ct);
        return wanted;
    }

    // ---- Visibility -------------------------------------------------------

    public async Task<VisibilityView> VisibilityGridAsync(CancellationToken ct = default) =>
        new(ApprovalConfigCatalog.VisibilityRoles,
            ApprovalConfigCatalog.VisibilityModules,
            ApprovalConfigRules.VisibilityGrid(await _dal.FindAllVisibilityAsync(ct)));

    public async Task<IReadOnlyDictionary<string, bool>> SaveVisibilityAsync(
        string? roleCode, IReadOnlyList<string>? modules, long? actorId,
        CancellationToken ct = default)
    {
        string role = (roleCode ?? "").Trim().ToUpperInvariant();

        if (!ApprovalConfigCatalog.VisibilityRoles.Contains(role))
        {
            throw ApiException.Business($"Unknown role: {roleCode}");
        }

        IReadOnlySet<string> wanted = ApprovalConfigRules.NormaliseModules(modules);

        // A row per module, hidden ones included -- see the DAL for why absence
        // must keep meaning "nobody configured this role".
        var row = new Dictionary<string, bool>(StringComparer.Ordinal);
        foreach (string module in ApprovalConfigCatalog.VisibilityModules)
        {
            row[module] = wanted.Contains(module);
        }

        await _dal.ReplaceVisibilityAsync(role, row, actorId, ct);
        return row;
    }

    public async Task<IReadOnlyList<string>> VisibleForAsync(long? userId,
                                                             CancellationToken ct = default)
    {
        if (userId is null)
        {
            return ApprovalConfigCatalog.VisibilityModules;
        }

        ApprovalCandidate? user = await _dal.FindUserAsync(userId.Value, ct);

        // An unknown user sees everything rather than nothing: this is a
        // display preference, and failing it closed would blank the tab strip.
        if (user is null)
        {
            return ApprovalConfigCatalog.VisibilityModules;
        }

        IReadOnlySet<string> codes = ApprovalConfigRules.SubjectCodes(user);

        if (codes.Count == 0)
        {
            return ApprovalConfigCatalog.VisibilityModules;
        }

        return ApprovalConfigRules.VisibleModules(
            await _dal.FindVisibilityByRolesAsync(codes, ct));
    }
}
