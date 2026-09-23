using System.Text.Json;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Privileges;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Infrastructure.Modules.Privileges;

/// <summary>
/// Admin Settings -> Privileges &amp; Configuration.
///
/// Every change goes through the same three steps: load the current state,
/// check it against <see cref="PrivilegeRules"/>, and write it together with a
/// history row holding the before and after. Rollback is the same path run
/// with the "before" snapshot, so an undo can never do something a normal save
/// would have refused.
///
/// After a role or permission change the principal cache is invalidated, so
/// the endpoints enforce the new state on the next request.
/// </summary>
public sealed class PrivilegeBal : IPrivilegeBal
{
    private const int HistoryLimit = 300;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly IPrivilegeDal _dal;
    private readonly ICurrentUser _user;
    private readonly IPermissionCacheInvalidator _cache;

    public PrivilegeBal(IPrivilegeDal dal, ICurrentUser user, IPermissionCacheInvalidator cache)
    {
        _dal = dal;
        _user = user;
        _cache = cache;
    }

    private long? CompanyId => _user.CompanyId;

    private bool ActorIsSuperAdmin => _user.IsInRole(PrivilegeCatalog.SuperAdmin);

    private async Task RequireHistoryAsync(CancellationToken ct)
    {
        if (!await _dal.HistoryTableExistsAsync(ct))
        {
            throw ApiException.Business(
                "Privilege changes are disabled until database migration V155 (privilege_change_log) is applied. Nothing was changed.");
        }
    }

    // ---- Snapshots ---------------------------------------------------------

    private sealed record RoleSnapshot(long RoleId, string RoleCode, List<string> Permissions);

    private sealed record UserSnapshot(long UserId, string Name, List<long> RoleIds, List<string> Roles);

    private sealed record UsersSnapshot(List<UserSnapshot> Users);

    private sealed record ConfigSnapshot(Dictionary<string, string?> Values);

    // ---- Overview ----------------------------------------------------------

    public async Task<PrivilegeOverview> OverviewAsync(CancellationToken ct = default)
    {
        IReadOnlyList<RoleRow> roles = await _dal.FindRolesAsync(CompanyId, ct);
        IReadOnlyList<RolePermissionRow> grants = await _dal.FindRolePermissionsAsync(ct);
        IReadOnlyDictionary<long, int> counts = await _dal.CountUsersPerRoleAsync(CompanyId, ct);
        bool ready = await _dal.HistoryTableExistsAsync(ct);

        ILookup<long, string> byRole = grants.ToLookup(g => g.RoleId, g => g.Code);

        var views = roles.Select(r =>
        {
            bool isAdmin = PrivilegeCatalog.AdminRoles.Contains(r.Code);
            string[] held = byRole[r.Id].Distinct().Order().ToArray();
            return new RolePrivilegeView(
                r.Id, r.Code, string.IsNullOrWhiteSpace(r.Name) ? r.Code : r.Name!, r.Description,
                counts.TryGetValue(r.Id, out int c) ? c : 0, held, isAdmin,
                isAdmin ? PrivilegeCatalog.LockedAdminCodes.Where(held.Contains).Order().ToArray() : []);
        }).ToArray();

        return new PrivilegeOverview(ready, ActorIsSuperAdmin, PrivilegeCatalog.Actions,
                                     PrivilegeCatalog.Permissions, views);
    }

    // ---- Role permissions ---------------------------------------------------

    public async Task<ChangeResult> SetRolePermissionsAsync(long roleId, IReadOnlyCollection<string> permissions,
                                                            CancellationToken ct = default) =>
        await ApplyRolePermissionsAsync(roleId, permissions, rollbackOf: null, ct);

    private async Task<ChangeResult> ApplyRolePermissionsAsync(long roleId, IReadOnlyCollection<string> permissions,
                                                               long? rollbackOf, CancellationToken ct)
    {
        await RequireHistoryAsync(ct);

        RoleRow role = (await _dal.FindRolesAsync(CompanyId, ct)).FirstOrDefault(r => r.Id == roleId)
                       ?? throw ApiException.NotFound("Role");

        if (role.Code == PrivilegeCatalog.SuperAdmin && !ActorIsSuperAdmin)
        {
            throw ApiException.Forbidden("Only a Super Admin can change the Super Admin role.");
        }

        string[] current = (await _dal.FindRolePermissionsAsync(ct))
            .Where(g => g.RoleId == roleId).Select(g => g.Code).Distinct().Order().ToArray();
        string[] requested = permissions
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => p.Trim().ToUpperInvariant()).Distinct().Order().ToArray();

        IReadOnlyList<string> problems = PrivilegeRules.CheckRolePermissions(role.Code, current, requested);
        if (problems.Count > 0)
        {
            throw ApiException.BadRequest(string.Join(" ", problems));
        }

        (IReadOnlyList<string> added, IReadOnlyList<string> removed) = PrivilegeRules.Diff(current, requested);
        if (added.Count == 0 && removed.Count == 0)
        {
            return new ChangeResult(null, "No changes.");
        }

        string summary = (rollbackOf is null ? "" : $"Rollback of #{rollbackOf}: ")
            + $"{role.Code}: " + Describe(added, removed);

        long id = await _dal.ReplaceRolePermissionsAsync(roleId, requested, new ChangeLogRow
        {
            ChangeType = ChangeTypes.RolePermissions,
            TargetKey = roleId.ToString(),
            TargetLabel = role.Code,
            Summary = Truncate(summary),
            BeforeJson = JsonSerializer.Serialize(new RoleSnapshot(roleId, role.Code, [.. current]), Json),
            AfterJson = JsonSerializer.Serialize(new RoleSnapshot(roleId, role.Code, [.. requested]), Json),
            ActorId = _user.UserId,
            ActorName = _user.Username,
            RollbackOfId = rollbackOf
        }, CompanyId, ct);

        _cache.InvalidateAll();
        return new ChangeResult(id, summary);
    }

    // ---- User roles -----------------------------------------------------------

    public async Task<IReadOnlyList<UserPrivilegeView>> UsersAsync(CancellationToken ct = default)
    {
        IReadOnlyList<UserRoleRow> rows = await _dal.FindUsersWithRolesAsync(CompanyId, null, ct);
        return rows.GroupBy(r => r.UserId).Select(g =>
        {
            UserRoleRow f = g.First();
            return new UserPrivilegeView(f.UserId, f.Name, f.EmployeeCode, f.Username, f.Enabled, f.ProfileStatus,
                g.Where(r => r.RoleCode != null).Select(r => r.RoleCode!).Distinct().Order().ToArray());
        }).ToArray();
    }

    public async Task<ChangeResult> BulkUserRolesAsync(BulkUserRolesRequest request, CancellationToken ct = default)
    {
        await RequireHistoryAsync(ct);

        long[] ids = request.UserIds.Distinct().ToArray();
        string[] add = Clean(request.Add);
        string[] remove = Clean(request.Remove);

        if (add.Length == 0 && remove.Length == 0)
        {
            throw ApiException.BadRequest("Choose at least one role to add or remove.");
        }

        IReadOnlyList<RoleRow> roles = await _dal.FindRolesAsync(CompanyId, ct);
        string[] unknown = add.Where(code => PickRoleId(roles, code) is null).ToArray();
        if (unknown.Length > 0)
        {
            throw ApiException.BadRequest($"Unknown role: {string.Join(", ", unknown)}.");
        }

        var users = await LoadUsersAsync(ids, ct);

        var proposed = new Dictionary<long, IReadOnlyCollection<long>>();
        foreach (UserSnapshot u in users)
        {
            var keep = u.RoleIds.Where(rid => !remove.Contains(CodeOf(roles, rid, u))).ToHashSet();
            foreach (string code in add)
            {
                if (!keep.Any(rid => CodeOf(roles, rid, u) == code) && PickRoleId(roles, code) is long rid)
                {
                    keep.Add(rid);
                }
            }
            proposed[u.UserId] = keep;
        }

        return await ApplyUserRolesAsync(users, proposed, roles, rollbackOf: null, ct);
    }

    private async Task<List<UserSnapshot>> LoadUsersAsync(IReadOnlyCollection<long> ids, CancellationToken ct)
    {
        if (ids.Count == 0)
        {
            throw ApiException.BadRequest("No users selected.");
        }
        if (ids.Count > PrivilegeCatalog.MaxBulkUsers)
        {
            throw ApiException.BadRequest($"At most {PrivilegeCatalog.MaxBulkUsers} users can be changed at once.");
        }

        IReadOnlyList<UserRoleRow> rows = await _dal.FindUsersWithRolesAsync(CompanyId, ids, ct);
        // RoleIds and Roles are kept index-aligned (ordered by id), so the code
        // of any role a user holds is known even when that role sits outside
        // the catalogue this company sees.
        var users = rows.GroupBy(r => r.UserId).Select(g =>
        {
            var held = g.Where(r => r.RoleId != null)
                        .Select(r => (Id: r.RoleId!.Value, Code: r.RoleCode ?? string.Empty))
                        .DistinctBy(p => p.Id).OrderBy(p => p.Id).ToList();
            return new UserSnapshot(g.Key, g.First().Name,
                held.Select(p => p.Id).ToList(), held.Select(p => p.Code).ToList());
        }).ToList();

        if (users.Count != ids.Count)
        {
            throw ApiException.NotFound("One or more selected users");
        }
        return users;
    }

    private async Task<ChangeResult> ApplyUserRolesAsync(
        List<UserSnapshot> before, Dictionary<long, IReadOnlyCollection<long>> proposedIds,
        IReadOnlyList<RoleRow> roles, long? rollbackOf, CancellationToken ct)
    {
        var codeById = roles.ToDictionary(r => r.Id, r => r.Code);
        foreach (UserSnapshot u in before)
        {
            for (int i = 0; i < u.RoleIds.Count; i++)
            {
                codeById.TryAdd(u.RoleIds[i], u.Roles[i]);
            }
        }
        foreach (long rid in proposedIds.Values.SelectMany(v => v))
        {
            if (!codeById.ContainsKey(rid))
            {
                throw ApiException.BadRequest($"Role #{rid} no longer exists.");
            }
        }

        var enabled = (await _dal.FindUsersWithRolesAsync(CompanyId, proposedIds.Keys.ToArray(), ct))
            .GroupBy(r => r.UserId).ToDictionary(g => g.Key, g => g.First().Enabled);

        var proposedCodes = proposedIds.ToDictionary(
            kv => kv.Key,
            kv => (IReadOnlyCollection<string>)kv.Value.Select(rid => codeById[rid]).Distinct().Order().ToArray());

        int outside = await _dal.CountEnabledSuperAdminsExcludingAsync(CompanyId, proposedIds.Keys.ToArray(), ct);

        IReadOnlyList<string> problems = PrivilegeRules.CheckUserRoles(
            _user.RequireUserId(), ActorIsSuperAdmin,
            before.Select(u => new PrivilegeRules.UserState(u.UserId, u.Name,
                enabled.TryGetValue(u.UserId, out bool e) && e, u.Roles)).ToArray(),
            proposedCodes, codeById.Values.ToHashSet(StringComparer.Ordinal), outside);

        if (problems.Count > 0)
        {
            throw ApiException.BadRequest(string.Join(" ", problems));
        }

        // Only the people whose roles actually change are written and logged.
        var changedBefore = new List<UserSnapshot>();
        var changedAfter = new List<UserSnapshot>();
        var writes = new Dictionary<long, IReadOnlyCollection<long>>();
        foreach (UserSnapshot u in before)
        {
            long[] after = proposedIds[u.UserId].Distinct().Order().ToArray();
            if (after.SequenceEqual(u.RoleIds))
            {
                continue;
            }
            writes[u.UserId] = after;
            changedBefore.Add(u);
            changedAfter.Add(new UserSnapshot(u.UserId, u.Name, [.. after], [.. proposedCodes[u.UserId]]));
        }

        if (writes.Count == 0)
        {
            return new ChangeResult(null, "No changes: the selected users already have those roles.");
        }

        var added = changedAfter.SelectMany(a => a.Roles.Except(changedBefore.First(b => b.UserId == a.UserId).Roles)).Distinct().Order();
        var removed = changedBefore.SelectMany(b => b.Roles.Except(changedAfter.First(a => a.UserId == b.UserId).Roles)).Distinct().Order();
        string who = writes.Count == 1 ? changedBefore[0].Name : $"{writes.Count} users";
        string summary = (rollbackOf is null ? "" : $"Rollback of #{rollbackOf}: ")
            + $"{who}: " + Describe(added.ToArray(), removed.ToArray());

        long id = await _dal.ReplaceUserRolesAsync(writes, new ChangeLogRow
        {
            ChangeType = ChangeTypes.UserRoles,
            TargetKey = "users",
            TargetLabel = who,
            Summary = Truncate(summary),
            BeforeJson = JsonSerializer.Serialize(new UsersSnapshot(changedBefore), Json),
            AfterJson = JsonSerializer.Serialize(new UsersSnapshot(changedAfter), Json),
            ActorId = _user.UserId,
            ActorName = _user.Username,
            RollbackOfId = rollbackOf
        }, CompanyId, ct);

        _cache.InvalidateAll();
        return new ChangeResult(id, summary);
    }

    /// <summary>The code of a role id the user holds, even one outside the visible catalogue.</summary>
    private static string CodeOf(IReadOnlyList<RoleRow> roles, long roleId, UserSnapshot u) =>
        u.RoleIds.IndexOf(roleId) is int i and >= 0
            ? u.Roles[i]
            : roles.FirstOrDefault(r => r.Id == roleId)?.Code ?? string.Empty;

    /// <summary>Role codes are not unique since V91; prefer the company's own row, then the shared one.</summary>
    private long? PickRoleId(IReadOnlyList<RoleRow> roles, string code) =>
        roles.Where(r => r.Code == code)
             .OrderByDescending(r => r.CompanyId == CompanyId && CompanyId != null)
             .ThenBy(r => r.CompanyId.HasValue)
             .ThenBy(r => r.Id)
             .Select(r => (long?)r.Id).FirstOrDefault();

    // ---- Configuration ----------------------------------------------------------

    public async Task<IReadOnlyList<ConfigItemView>> ConfigurationAsync(CancellationToken ct = default)
    {
        IReadOnlyDictionary<string, string> stored =
            await _dal.FindSettingsAsync(ConfigCatalog.Settings.Select(s => s.Key).ToArray(), ct);

        return ConfigCatalog.Settings.Select(d => new ConfigItemView(
            d.Key, d.Group, d.Label, d.Description, d.Type.ToString(),
            stored.TryGetValue(d.Key, out string? v) ? v : d.DefaultValue,
            d.DefaultValue, d.Min, d.Max, stored.ContainsKey(d.Key))).ToArray();
    }

    public Task<ChangeResult> SaveConfigurationAsync(IReadOnlyDictionary<string, string> values,
                                                     CancellationToken ct = default) =>
        ApplyConfigurationAsync(values.ToDictionary(kv => kv.Key, kv => (string?)kv.Value), rollbackOf: null, ct);

    private async Task<ChangeResult> ApplyConfigurationAsync(IReadOnlyDictionary<string, string?> values,
                                                             long? rollbackOf, CancellationToken ct)
    {
        await RequireHistoryAsync(ct);

        var errors = new Dictionary<string, string>();
        var normalised = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach ((string key, string? raw) in values)
        {
            // A null in a rollback snapshot means the key had never been stored:
            // restoring it means going back to the value the reader defaults to.
            string? input = raw ?? (ConfigCatalog.ByKey.TryGetValue(key, out var d) ? d.DefaultValue : null);
            (string? value, string? error) = ConfigCatalog.Normalise(key, input);
            if (error != null)
            {
                errors[key] = error;
            }
            else
            {
                normalised[key] = value!;
            }
        }

        if (errors.Count > 0)
        {
            throw new ValidationException(errors);
        }

        IReadOnlyDictionary<string, string> current = await _dal.FindSettingsAsync(normalised.Keys.ToArray(), ct);
        var changed = normalised
            .Where(kv => !current.TryGetValue(kv.Key, out string? old) || old != kv.Value)
            .ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal);

        if (changed.Count == 0)
        {
            return new ChangeResult(null, "No changes.");
        }

        string summary = (rollbackOf is null ? "" : $"Rollback of #{rollbackOf}: ")
            + string.Join("; ", changed.Select(kv =>
                $"{ConfigCatalog.ByKey[kv.Key].Label}: {(current.TryGetValue(kv.Key, out string? o) ? o : "default")} -> {kv.Value}"));

        long id = await _dal.UpsertSettingsAsync(changed, new ChangeLogRow
        {
            ChangeType = ChangeTypes.Config,
            TargetKey = "config",
            TargetLabel = string.Join(", ", changed.Keys),
            Summary = Truncate(summary),
            BeforeJson = JsonSerializer.Serialize(new ConfigSnapshot(
                changed.Keys.ToDictionary(k => k, k => current.TryGetValue(k, out string? o) ? o : null)), Json),
            AfterJson = JsonSerializer.Serialize(new ConfigSnapshot(
                changed.ToDictionary(kv => kv.Key, kv => (string?)kv.Value)), Json),
            ActorId = _user.UserId,
            ActorName = _user.Username,
            RollbackOfId = rollbackOf
        }, CompanyId, ct);

        return new ChangeResult(id, summary);
    }

    // ---- History and rollback ---------------------------------------------------

    public async Task<IReadOnlyList<ChangeLogView>> HistoryAsync(string? changeType, CancellationToken ct = default)
    {
        if (!await _dal.HistoryTableExistsAsync(ct))
        {
            return [];
        }

        string? type = string.IsNullOrWhiteSpace(changeType) ? null : changeType.Trim().ToUpperInvariant();
        return (await _dal.FindHistoryAsync(CompanyId, type, HistoryLimit, ct))
            .Select(r => new ChangeLogView(r.Id, r.ChangeType, r.TargetKey, r.TargetLabel, r.Summary,
                                           r.BeforeJson, r.AfterJson, r.ActorName, r.RolledBack,
                                           r.RollbackOfId, r.CreatedAt))
            .ToArray();
    }

    /// <summary>
    /// Restores the "before" of a change -- but only while the target still
    /// holds that change's "after". If something has changed it since, undoing
    /// this one would silently discard the later edit too, so it is refused and
    /// the newer change has to be rolled back first.
    /// </summary>
    public async Task<ChangeResult> RollbackAsync(long changeId, CancellationToken ct = default)
    {
        await RequireHistoryAsync(ct);

        ChangeLogRow entry = await _dal.FindChangeAsync(changeId, CompanyId, ct)
                             ?? throw ApiException.NotFound("Change");
        if (entry.RolledBack)
        {
            throw ApiException.Conflict("This change has already been rolled back.");
        }

        const string Moved = "This has been changed again since. Roll back the newer change first.";
        ChangeResult result;

        switch (entry.ChangeType)
        {
            case ChangeTypes.RolePermissions:
            {
                RoleSnapshot before = Parse<RoleSnapshot>(entry.BeforeJson);
                RoleSnapshot after = Parse<RoleSnapshot>(entry.AfterJson);
                string[] now = (await _dal.FindRolePermissionsAsync(ct))
                    .Where(g => g.RoleId == after.RoleId).Select(g => g.Code).Distinct().Order().ToArray();
                if (!now.SequenceEqual(after.Permissions.Order()))
                {
                    throw ApiException.Conflict(Moved);
                }
                result = await ApplyRolePermissionsAsync(before.RoleId, before.Permissions, entry.Id, ct);
                break;
            }
            case ChangeTypes.UserRoles:
            {
                UsersSnapshot before = Parse<UsersSnapshot>(entry.BeforeJson);
                UsersSnapshot after = Parse<UsersSnapshot>(entry.AfterJson);
                List<UserSnapshot> now = await LoadUsersAsync(after.Users.Select(u => u.UserId).ToArray(), ct);
                foreach (UserSnapshot a in after.Users)
                {
                    if (!now.First(n => n.UserId == a.UserId).RoleIds.SequenceEqual(a.RoleIds.Order()))
                    {
                        throw ApiException.Conflict(Moved);
                    }
                }
                IReadOnlyList<RoleRow> roles = await _dal.FindRolesAsync(CompanyId, ct);
                result = await ApplyUserRolesAsync(now,
                    before.Users.ToDictionary(u => u.UserId, u => (IReadOnlyCollection<long>)u.RoleIds),
                    roles, entry.Id, ct);
                break;
            }
            case ChangeTypes.Config:
            {
                ConfigSnapshot before = Parse<ConfigSnapshot>(entry.BeforeJson);
                ConfigSnapshot after = Parse<ConfigSnapshot>(entry.AfterJson);
                IReadOnlyDictionary<string, string> now = await _dal.FindSettingsAsync(after.Values.Keys.ToArray(), ct);
                if (after.Values.Any(kv => !now.TryGetValue(kv.Key, out string? v) || v != kv.Value))
                {
                    throw ApiException.Conflict(Moved);
                }
                result = await ApplyConfigurationAsync(before.Values, entry.Id, ct);
                break;
            }
            default:
                throw ApiException.BadRequest($"Changes of type {entry.ChangeType} cannot be rolled back.");
        }

        await _dal.MarkRolledBackAsync(entry.Id, ct);
        return result;
    }

    // ---- Helpers ----------------------------------------------------------------

    private static T Parse<T>(string? json) =>
        (json is null ? default : JsonSerializer.Deserialize<T>(json, Json))
        ?? throw ApiException.Business("This history entry has no snapshot to restore.");

    private static string[] Clean(IEnumerable<string> codes) =>
        codes.Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => c.Trim().ToUpperInvariant()).Distinct().ToArray();

    private static string Describe(IReadOnlyCollection<string> added, IReadOnlyCollection<string> removed)
    {
        var parts = new List<string>();
        if (added.Count > 0) parts.Add("+" + string.Join(", +", added));
        if (removed.Count > 0) parts.Add("-" + string.Join(", -", removed));
        return string.Join("; ", parts);
    }

    private static string Truncate(string s) => s.Length <= 1000 ? s : s[..997] + "...";
}
