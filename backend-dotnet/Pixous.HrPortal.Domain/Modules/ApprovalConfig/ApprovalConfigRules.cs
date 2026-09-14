namespace Pixous.HrPortal.Domain.Modules.ApprovalConfig;

/// <summary>
/// The decisions in the approval configuration, as pure functions over rows
/// that have already been read.
///
/// They live in Domain rather than in the BAL because they are the part worth
/// testing directly: every one of them fails SILENTLY when it is wrong. Getting
/// "absent means unrestricted" backwards empties every dropdown in the
/// application; getting the visibility union backwards hides tabs from people
/// who hold two roles. Neither throws. Neither shows up in a build.
///
/// Transcribed from ApprovalRecipientService and ModuleVisibilityService.
/// </summary>
public static class ApprovalConfigRules
{
    /// <summary>
    /// What a module is configured with. Empty on both counts means
    /// unconfigured, and unconfigured means unrestricted.
    /// </summary>
    public readonly record struct Rules(IReadOnlySet<string> Roles, IReadOnlySet<long> Users)
    {
        public bool IsEmpty => Roles.Count == 0 && Users.Count == 0;
    }

    /// <summary>
    /// Reduces one module's rows to its rules, dropping the disabled ones.
    ///
    /// A disabled row must not count as configuration: if it did, unticking the
    /// last box by disabling it would restrict the module to NOBODY rather than
    /// returning it to unrestricted.
    /// </summary>
    public static Rules RulesFor(IEnumerable<ApprovalRecipientRow> rows)
    {
        ApprovalRecipientRow[] live = rows.Where(r => r.Enabled).ToArray();

        return new Rules(
            live.Where(r => r.RoleCode is not null)
                .Select(r => r.RoleCode!.ToUpperInvariant())
                .ToHashSet(StringComparer.Ordinal),
            live.Where(r => r.UserId is not null)
                .Select(r => r.UserId!.Value)
                .ToHashSet());
    }

    /// <summary>
    /// Whether a person satisfies a module's rules.
    ///
    /// Role rules and person rules are ALTERNATIVES, not conditions to be met
    /// together: naming somebody on a module that also allows the HR role
    /// offers both, rather than offering nobody because they are not both at
    /// once.
    /// </summary>
    public static bool Matches(Rules rules, ApprovalCandidate candidate)
    {
        if (rules.Users.Contains(candidate.Id))
        {
            return true;
        }

        // CTO before the role check, because it is matched on the EMPLOYEE CODE
        // rather than on a role -- it has no row in `roles` at all, so matching
        // it as a role would never match anybody and the tick would silently do
        // nothing.
        if (rules.Roles.Contains("CTO")
            && string.Equals(candidate.EmployeeCode, ApprovalConfigCatalog.CtoEmployeeCode,
                             StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return candidate.RoleCodes.Any(c => rules.Roles.Contains(c.ToUpperInvariant()));
    }

    /// <summary>
    /// Whether a module may address requests to this person.
    /// True when the module has no configuration at all.
    /// </summary>
    public static bool Allows(Rules rules, ApprovalCandidate? candidate) =>
        candidate is not null && (rules.IsEmpty || Matches(rules, candidate));

    /// <summary>
    /// Which Leave Management tabs a person may see, given the rules that apply
    /// to the roles they hold.
    ///
    /// Two rules, both load-bearing:
    ///
    ///   - a module NO rule mentions stays visible, so configuring one tab does
    ///     not hide the rest by omission; and
    ///   - configured roles are read as a UNION, not an intersection. Somebody
    ///     holding IT_EMP and IT_HR is both, and a module hidden from employees
    ///     but shown to HR is one they should see -- the narrower role would
    ///     otherwise silently cancel a grant made through the wider one, which
    ///     is the opposite of how roles add up everywhere else here.
    /// </summary>
    public static IReadOnlyList<string> VisibleModules(IReadOnlyList<VisibilityRow> rules)
    {
        // A person all of whose roles are unconfigured sees everything.
        if (rules.Count == 0)
        {
            return ApprovalConfigCatalog.VisibilityModules;
        }

        var visible = new List<string>();

        foreach (string module in ApprovalConfigCatalog.VisibilityModules)
        {
            VisibilityRow[] speaking = rules
                .Where(r => string.Equals(r.ModuleCode, module, StringComparison.OrdinalIgnoreCase))
                .ToArray();

            if (speaking.Length == 0 || speaking.Any(r => r.Visible))
            {
                visible.Add(module);
            }
        }

        return visible;
    }

    /// <summary>
    /// The role codes a person is configured under: the roles they hold, plus
    /// the CTO pseudo-role when their employee code says so.
    /// </summary>
    public static IReadOnlySet<string> SubjectCodes(ApprovalCandidate user)
    {
        var codes = user.RoleCodes.Select(c => c.ToUpperInvariant())
                                  .ToHashSet(StringComparer.Ordinal);

        if (string.Equals(user.EmployeeCode, ApprovalConfigCatalog.CtoEmployeeCode,
                          StringComparison.OrdinalIgnoreCase))
        {
            codes.Add("CTO");
        }

        return codes;
    }

    /// <summary>
    /// The recipient grid: every module, every role, ticked or not.
    ///
    /// Built from the full catalogue rather than from the rows that exist, so
    /// an unconfigured module comes back with every box shown and none ticked --
    /// which is what it is. Returning only the saved rows would leave the screen
    /// to guess the rest.
    ///
    /// Person rows are excluded here and reported separately: they are a
    /// different kind of rule and the screen shows them in a different control.
    /// </summary>
    public static IReadOnlyDictionary<string, IReadOnlyDictionary<string, bool>> Grid(
        IEnumerable<ApprovalRecipientRow> all)
    {
        var saved = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

        foreach (ApprovalRecipientRow r in all.Where(r => r.Enabled && r.RoleCode is not null))
        {
            string module = r.ModuleCode.ToUpperInvariant();

            if (!saved.TryGetValue(module, out HashSet<string>? set))
            {
                set = new HashSet<string>(StringComparer.Ordinal);
                saved[module] = set;
            }

            set.Add(r.RoleCode!.ToUpperInvariant());
        }

        var config = new Dictionary<string, IReadOnlyDictionary<string, bool>>(StringComparer.Ordinal);

        foreach (string module in ApprovalConfigCatalog.Modules)
        {
            saved.TryGetValue(module, out HashSet<string>? on);

            var row = new Dictionary<string, bool>(StringComparer.Ordinal);
            foreach (string role in ApprovalConfigCatalog.RecipientRoles)
            {
                row[role] = on is not null && on.Contains(role);
            }

            config[module] = row;
        }

        return config;
    }

    /// <summary>
    /// The visibility grid: every role, every module, shown or hidden.
    ///
    /// Unconfigured reads as VISIBLE, so an untouched role shows every box
    /// ticked. Reading it as hidden would show an administrator the opposite of
    /// what the application actually does.
    /// </summary>
    public static IReadOnlyDictionary<string, IReadOnlyDictionary<string, bool>> VisibilityGrid(
        IEnumerable<VisibilityRow> all)
    {
        var saved = new Dictionary<string, Dictionary<string, bool>>(StringComparer.Ordinal);

        foreach (VisibilityRow r in all)
        {
            string role = r.RoleCode.ToUpperInvariant();

            if (!saved.TryGetValue(role, out Dictionary<string, bool>? row))
            {
                row = new Dictionary<string, bool>(StringComparer.Ordinal);
                saved[role] = row;
            }

            row[r.ModuleCode.ToUpperInvariant()] = r.Visible;
        }

        var config = new Dictionary<string, IReadOnlyDictionary<string, bool>>(StringComparer.Ordinal);

        foreach (string role in ApprovalConfigCatalog.VisibilityRoles)
        {
            saved.TryGetValue(role, out Dictionary<string, bool>? on);

            var row = new Dictionary<string, bool>(StringComparer.Ordinal);
            foreach (string module in ApprovalConfigCatalog.VisibilityModules)
            {
                row[module] = on is null || !on.TryGetValue(module, out bool v) || v;
            }

            config[role] = row;
        }

        return config;
    }

    /// <summary>
    /// Normalises a list of role codes from a request body: trimmed, upper
    /// cased, and narrowed to the ones the screen actually offers.
    ///
    /// Unknown codes are DROPPED rather than rejected, as the Java's filter
    /// does -- the screen sends what it renders, and a stale code in a body
    /// should not fail a save of the valid ones.
    /// </summary>
    public static IReadOnlySet<string> NormaliseRoles(IEnumerable<string>? roleCodes) =>
        (roleCodes ?? [])
            .Where(r => r is not null)
            .Select(r => r.Trim().ToUpperInvariant())
            .Where(ApprovalConfigCatalog.RecipientRoles.Contains)
            .ToHashSet(StringComparer.Ordinal);

    /// <summary>The same, for the visibility modules.</summary>
    public static IReadOnlySet<string> NormaliseModules(IEnumerable<string>? modules) =>
        (modules ?? [])
            .Where(m => m is not null)
            .Select(m => m.Trim().ToUpperInvariant())
            .Where(ApprovalConfigCatalog.VisibilityModules.Contains)
            .ToHashSet(StringComparer.Ordinal);
}
