namespace Pixous.HrPortal.Domain.Modules.Privileges;

/// <summary>
/// The checks every privilege change passes before anything is written.
///
/// Pure functions over plain values, so each lockout case is pinned by a unit
/// test. They return the reasons a change is refused rather than throwing: a
/// preview wants every reason at once, a save wants to know whether the list
/// is empty.
/// </summary>
public static class PrivilegeRules
{
    /// <summary>
    /// Replacing a role's permission codes.
    /// </summary>
    public static IReadOnlyList<string> CheckRolePermissions(
        string roleCode,
        IReadOnlyCollection<string> current,
        IReadOnlyCollection<string> requested)
    {
        var problems = new List<string>();

        foreach (string code in requested)
        {
            if (!PrivilegeCatalog.KnownCodes.Contains(code))
            {
                problems.Add($"Unknown permission code '{code}'.");
            }
        }

        if (PrivilegeCatalog.AdminRoles.Contains(roleCode))
        {
            foreach (string locked in PrivilegeCatalog.LockedAdminCodes)
            {
                if (current.Contains(locked) && !requested.Contains(locked))
                {
                    problems.Add(
                        $"{locked} cannot be removed from {roleCode}: administrators would lose the screens needed to undo it.");
                }
            }
        }

        return problems;
    }

    /// <summary>One person as a role change sees them.</summary>
    public sealed record UserState(long UserId, string Name, bool Enabled, IReadOnlyCollection<string> Roles);

    /// <summary>
    /// Changing which roles a set of people hold. <paramref name="proposed"/>
    /// maps each affected user to the roles they would end with;
    /// <paramref name="superAdminsOutsideChange"/> counts enabled SUPER_ADMIN
    /// holders who are not in the change at all.
    /// </summary>
    public static IReadOnlyList<string> CheckUserRoles(
        long actorId,
        bool actorIsSuperAdmin,
        IReadOnlyCollection<UserState> before,
        IReadOnlyDictionary<long, IReadOnlyCollection<string>> proposed,
        IReadOnlySet<string> knownRoleCodes,
        int superAdminsOutsideChange)
    {
        var problems = new List<string>();

        if (proposed.Count == 0)
        {
            problems.Add("No users selected.");
            return problems;
        }

        if (proposed.Count > PrivilegeCatalog.MaxBulkUsers)
        {
            problems.Add($"At most {PrivilegeCatalog.MaxBulkUsers} users can be changed at once.");
            return problems;
        }

        int superAdminsAfter = superAdminsOutsideChange;

        foreach (UserState user in before)
        {
            if (!proposed.TryGetValue(user.UserId, out IReadOnlyCollection<string>? after))
            {
                continue;
            }

            foreach (string role in after)
            {
                if (!knownRoleCodes.Contains(role))
                {
                    problems.Add($"Unknown role '{role}'.");
                }
            }

            if (after.Count == 0)
            {
                problems.Add($"{user.Name} must keep at least one role.");
            }

            // Only a super admin may hand out or take away an admin role --
            // otherwise a company admin could promote themselves.
            if (!actorIsSuperAdmin)
            {
                foreach (string admin in PrivilegeCatalog.AdminRoles)
                {
                    bool had = user.Roles.Contains(admin);
                    bool has = after.Contains(admin);
                    if (had != has)
                    {
                        problems.Add($"Only a Super Admin can {(has ? "grant" : "remove")} {admin} ({user.Name}).");
                    }
                }
            }

            if (user.UserId == actorId)
            {
                foreach (string admin in PrivilegeCatalog.AdminRoles)
                {
                    if (user.Roles.Contains(admin) && !after.Contains(admin))
                    {
                        problems.Add($"You cannot remove {admin} from your own account.");
                    }
                }
            }

            if (user.Enabled && after.Contains(PrivilegeCatalog.SuperAdmin))
            {
                superAdminsAfter++;
            }
        }

        if (superAdminsAfter < 1)
        {
            problems.Add("At least one active Super Admin must remain.");
        }

        return problems.Distinct().ToArray();
    }

    /// <summary>
    /// The roles a user ends with after a bulk add/remove. Removal wins over
    /// addition when the same role is in both, so a mistaken double tick
    /// removes rather than silently grants.
    /// </summary>
    public static IReadOnlyCollection<string> ApplyBulk(
        IReadOnlyCollection<string> current,
        IReadOnlyCollection<string> add,
        IReadOnlyCollection<string> remove)
    {
        var result = new SortedSet<string>(current, StringComparer.Ordinal);
        result.UnionWith(add);
        result.ExceptWith(remove);
        return result;
    }

    /// <summary>Codes added and removed between two states, for the summary line.</summary>
    public static (IReadOnlyList<string> Added, IReadOnlyList<string> Removed) Diff(
        IEnumerable<string> before, IEnumerable<string> after)
    {
        var b = before.ToHashSet(StringComparer.Ordinal);
        var a = after.ToHashSet(StringComparer.Ordinal);
        return (a.Except(b).Order().ToArray(), b.Except(a).Order().ToArray());
    }
}
