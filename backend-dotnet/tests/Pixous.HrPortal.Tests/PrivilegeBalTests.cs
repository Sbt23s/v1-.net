using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Privileges;
using Pixous.HrPortal.Domain.Security;
using Pixous.HrPortal.Infrastructure.Modules.Privileges;
using Pixous.HrPortal.Infrastructure.Security;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// The Privileges service end to end over an in-memory store: that a save
/// writes what it says and logs it, that the cache is invalidated so the
/// endpoints see it, and that rollback restores exactly the before-state and
/// refuses when something newer would be lost.
/// </summary>
public sealed class PrivilegeBalTests
{
    // ---- Fakes ---------------------------------------------------------------

    private sealed class Actor(long id, params string[] roles) : ICurrentUser
    {
        public long? UserId => id;
        public string? Username => $"user{id}";
        public string? UserType => "USER";
        public IReadOnlyList<string> Roles => roles;
        public long? CompanyId => null;
        public bool IsAuthenticated => true;
        public long RequireUserId() => id;
        public bool IsInRole(string role) => roles.Contains(role);
        public bool HasPermission(string permissionCode) => false;
    }

    private sealed class MemoryDal : IPrivilegeDal
    {
        public bool Ready = true;
        public readonly List<RoleRow> Roles =
        [
            new() { Id = 1, Code = "SUPER_ADMIN" },
            new() { Id = 2, Code = "COMPANY_ADMIN" },
            new() { Id = 3, Code = "IT_HR" },
            new() { Id = 4, Code = "IT_EMP" },
        ];
        public readonly Dictionary<long, HashSet<string>> Grants = new()
        {
            [1] = ["USER_MANAGE", "ORG_MANAGE", "PAYROLL_RUN"],
            [2] = ["USER_MANAGE", "ORG_MANAGE"],
            [3] = ["USER_MANAGE", "LEAVE_APPROVE"],
            [4] = [],
        };
        public readonly Dictionary<long, (string Name, bool Enabled, HashSet<long> Roles)> Users = new()
        {
            [10] = ("Admin", true, [1]),
            [11] = ("Second Admin", true, [1]),
            [20] = ("Asha", true, [4]),
            [21] = ("Ravi", true, [4]),
        };
        public readonly Dictionary<string, string> Settings = new() { ["task.reminder_time"] = "09:30" };
        public readonly List<ChangeLogRow> Log = [];

        public Task<bool> HistoryTableExistsAsync(CancellationToken ct = default) => Task.FromResult(Ready);
        public Task<IReadOnlyList<RoleRow>> FindRolesAsync(long? companyId, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<RoleRow>>(Roles);
        public Task<IReadOnlyList<RolePermissionRow>> FindRolePermissionsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<RolePermissionRow>>(
                Grants.SelectMany(g => g.Value.Select(c => new RolePermissionRow { RoleId = g.Key, Code = c })).ToList());
        public Task<IReadOnlyDictionary<long, int>> CountUsersPerRoleAsync(long? companyId, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyDictionary<long, int>>(
                Users.Values.SelectMany(u => u.Roles).GroupBy(r => r).ToDictionary(g => g.Key, g => g.Count()));

        public Task<IReadOnlyList<UserRoleRow>> FindUsersWithRolesAsync(long? companyId, IReadOnlyCollection<long>? userIds,
                                                                        CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<UserRoleRow>>(Users
                .Where(u => userIds is null || userIds.Contains(u.Key))
                .SelectMany(u => u.Value.Roles.Count == 0
                    ? [new UserRoleRow { UserId = u.Key, Name = u.Value.Name, Enabled = u.Value.Enabled }]
                    : u.Value.Roles.Select(r => new UserRoleRow
                    {
                        UserId = u.Key, Name = u.Value.Name, Enabled = u.Value.Enabled,
                        RoleId = r, RoleCode = Roles.First(x => x.Id == r).Code
                    })).ToList());

        public Task<int> CountEnabledSuperAdminsExcludingAsync(long? companyId, IReadOnlyCollection<long> excluded,
                                                               CancellationToken ct = default) =>
            Task.FromResult(Users.Count(u => !excluded.Contains(u.Key) && u.Value.Enabled && u.Value.Roles.Contains(1)));

        private long Append(ChangeLogRow log)
        {
            log.Id = Log.Count + 1;
            Log.Add(log);
            return log.Id;
        }

        public Task<long> ReplaceRolePermissionsAsync(long roleId, IReadOnlyCollection<string> codes, ChangeLogRow log,
                                                      long? companyId, CancellationToken ct = default)
        {
            Grants[roleId] = [.. codes];
            return Task.FromResult(Append(log));
        }

        public Task<long> ReplaceUserRolesAsync(IReadOnlyDictionary<long, IReadOnlyCollection<long>> rolesByUser,
                                                ChangeLogRow log, long? companyId, CancellationToken ct = default)
        {
            foreach ((long id, var roles) in rolesByUser)
            {
                Users[id] = (Users[id].Name, Users[id].Enabled, [.. roles]);
            }
            return Task.FromResult(Append(log));
        }

        public Task<IReadOnlyDictionary<string, string>> FindSettingsAsync(IReadOnlyCollection<string> keys,
                                                                           CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyDictionary<string, string>>(
                Settings.Where(s => keys.Contains(s.Key)).ToDictionary(s => s.Key, s => s.Value));

        public Task<long> UpsertSettingsAsync(IReadOnlyDictionary<string, string> values, ChangeLogRow log,
                                              long? companyId, CancellationToken ct = default)
        {
            foreach ((string k, string v) in values) Settings[k] = v;
            return Task.FromResult(Append(log));
        }

        public Task<IReadOnlyList<ChangeLogRow>> FindHistoryAsync(long? companyId, string? changeType, int limit,
                                                                  CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<ChangeLogRow>>(Log.AsEnumerable().Reverse()
                .Where(l => changeType is null || l.ChangeType == changeType).Take(limit).ToList());

        public Task<ChangeLogRow?> FindChangeAsync(long id, long? companyId, CancellationToken ct = default) =>
            Task.FromResult(Log.FirstOrDefault(l => l.Id == id));

        public Task MarkRolledBackAsync(long id, CancellationToken ct = default)
        {
            Log.First(l => l.Id == id).RolledBack = true;
            return Task.CompletedTask;
        }
    }

    private static (PrivilegeBal Bal, MemoryDal Dal, PermissionCacheInvalidator Cache) Make(
        long actorId = 10, params string[] roles)
    {
        var dal = new MemoryDal();
        var cache = new PermissionCacheInvalidator();
        var bal = new PrivilegeBal(dal, new Actor(actorId, roles.Length == 0 ? ["SUPER_ADMIN"] : roles), cache);
        return (bal, dal, cache);
    }

    // ---- Role permissions --------------------------------------------------------

    [Fact]
    public async Task SavingARoleWritesLogsAndInvalidatesTheCache()
    {
        (var bal, var dal, var cache) = Make();
        long before = cache.Version;

        ChangeResult r = await bal.SetRolePermissionsAsync(4, ["LEAVE_APPROVE", "report_view"]);

        Assert.Equal(["LEAVE_APPROVE", "REPORT_VIEW"], dal.Grants[4].Order());
        Assert.NotNull(r.ChangeId);
        Assert.Single(dal.Log);
        Assert.Contains("+LEAVE_APPROVE", r.Summary);
        Assert.True(cache.Version > before);
    }

    [Fact]
    public async Task SavingTheSameStateWritesNothing()
    {
        (var bal, var dal, var cache) = Make();
        ChangeResult r = await bal.SetRolePermissionsAsync(3, ["LEAVE_APPROVE", "USER_MANAGE"]);
        Assert.Null(r.ChangeId);
        Assert.Empty(dal.Log);
        Assert.Equal(0, cache.Version);
    }

    [Fact]
    public async Task RemovingALockedAdminCodeIsRefusedAndNothingChanges()
    {
        (var bal, var dal, _) = Make();
        await Assert.ThrowsAsync<ApiException>(() => bal.SetRolePermissionsAsync(1, ["ORG_MANAGE"]));
        Assert.Contains("USER_MANAGE", dal.Grants[1]);
        Assert.Empty(dal.Log);
    }

    [Fact]
    public async Task ACompanyAdminCannotEditTheSuperAdminRole()
    {
        (var bal, _, _) = Make(10, "COMPANY_ADMIN");
        var ex = await Assert.ThrowsAsync<ApiException>(() =>
            bal.SetRolePermissionsAsync(1, ["USER_MANAGE", "ORG_MANAGE"]));
        Assert.Equal(ErrorCode.AccessDenied, ex.Code);
    }

    [Fact]
    public async Task WithoutTheHistoryTableNothingCanBeChanged()
    {
        (var bal, var dal, _) = Make();
        dal.Ready = false;
        await Assert.ThrowsAsync<ApiException>(() => bal.SetRolePermissionsAsync(4, ["REPORT_VIEW"]));
        Assert.Empty(dal.Grants[4]);
        Assert.Empty(await bal.HistoryAsync(null));
        Assert.False((await bal.OverviewAsync()).HistoryReady);
    }

    [Fact]
    public async Task RollbackRestoresTheRoleExactly()
    {
        (var bal, var dal, _) = Make();
        ChangeResult change = await bal.SetRolePermissionsAsync(3, ["REPORT_VIEW"]);

        ChangeResult undo = await bal.RollbackAsync(change.ChangeId!.Value);

        Assert.Equal(["LEAVE_APPROVE", "USER_MANAGE"], dal.Grants[3].Order());
        Assert.True(dal.Log[0].RolledBack);
        Assert.Equal(change.ChangeId, dal.Log[1].RollbackOfId);
        Assert.StartsWith("Rollback of #", undo.Summary);
    }

    [Fact]
    public async Task RollbackIsRefusedWhenANewerChangeWouldBeLost()
    {
        (var bal, var dal, _) = Make();
        ChangeResult first = await bal.SetRolePermissionsAsync(3, ["REPORT_VIEW"]);
        await bal.SetRolePermissionsAsync(3, ["REPORT_VIEW", "TASK_ASSIGN"]);

        var ex = await Assert.ThrowsAsync<ApiException>(() => bal.RollbackAsync(first.ChangeId!.Value));
        Assert.Equal(ErrorCode.Conflict, ex.Code);
        Assert.Equal(["REPORT_VIEW", "TASK_ASSIGN"], dal.Grants[3].Order());
    }

    [Fact]
    public async Task AChangeCannotBeRolledBackTwice()
    {
        (var bal, _, _) = Make();
        ChangeResult change = await bal.SetRolePermissionsAsync(4, ["REPORT_VIEW"]);
        await bal.RollbackAsync(change.ChangeId!.Value);
        await Assert.ThrowsAsync<ApiException>(() => bal.RollbackAsync(change.ChangeId!.Value));
    }

    // ---- User roles ------------------------------------------------------------------

    [Fact]
    public async Task BulkAddAssignsEveryoneSelected()
    {
        (var bal, var dal, _) = Make();
        ChangeResult r = await bal.BulkUserRolesAsync(new BulkUserRolesRequest
        {
            UserIds = [20, 21], Add = ["IT_HR"]
        });

        Assert.Contains(3L, dal.Users[20].Roles);
        Assert.Contains(3L, dal.Users[21].Roles);
        Assert.Contains("2 users", r.Summary);
    }

    [Fact]
    public async Task BulkRollbackRestoresEveryUser()
    {
        (var bal, var dal, _) = Make();
        ChangeResult r = await bal.BulkUserRolesAsync(new BulkUserRolesRequest
        {
            UserIds = [20, 21], Add = ["IT_HR"], Remove = ["IT_EMP"]
        });
        await bal.RollbackAsync(r.ChangeId!.Value);

        Assert.Equal([4L], dal.Users[20].Roles);
        Assert.Equal([4L], dal.Users[21].Roles);
    }

    [Fact]
    public async Task YouCannotStripYourOwnSuperAdminInBulk()
    {
        (var bal, var dal, _) = Make(10);
        await Assert.ThrowsAsync<ApiException>(() => bal.BulkUserRolesAsync(new BulkUserRolesRequest
        {
            UserIds = [10, 20], Remove = ["SUPER_ADMIN"], Add = ["IT_EMP"]
        }));
        Assert.Contains(1L, dal.Users[10].Roles);
        Assert.Empty(dal.Log);
    }

    [Fact]
    public async Task RemovingEverySuperAdminIsRefused()
    {
        (var bal, var dal, _) = Make(20, "SUPER_ADMIN");
        await Assert.ThrowsAsync<ApiException>(() => bal.BulkUserRolesAsync(new BulkUserRolesRequest
        {
            UserIds = [10, 11], Remove = ["SUPER_ADMIN"], Add = ["IT_EMP"]
        }));
        Assert.Contains(1L, dal.Users[10].Roles);
        Assert.Contains(1L, dal.Users[11].Roles);
    }

    [Fact]
    public async Task AddingAnUnknownRoleIsRefused()
    {
        (var bal, _, _) = Make();
        await Assert.ThrowsAsync<ApiException>(() => bal.BulkUserRolesAsync(new BulkUserRolesRequest
        {
            UserIds = [20], Add = ["NOPE"]
        }));
    }

    // ---- Configuration -----------------------------------------------------------------

    [Fact]
    public async Task ConfigurationSavesOnlyWhatChangedAndRollsBack()
    {
        (var bal, var dal, _) = Make();
        ChangeResult r = await bal.SaveConfigurationAsync(new Dictionary<string, string>
        {
            ["task.reminder_time"] = "10:15",
            ["HILLS_KM_RATE"] = "6"
        });

        Assert.Equal("10:15", dal.Settings["task.reminder_time"]);
        Assert.Equal("6.0", dal.Settings["HILLS_KM_RATE"]);

        await bal.RollbackAsync(r.ChangeId!.Value);

        Assert.Equal("09:30", dal.Settings["task.reminder_time"]);
        // It had never been stored, so rollback returns it to its default.
        Assert.Equal("5.0", dal.Settings["HILLS_KM_RATE"]);
    }

    [Fact]
    public async Task InvalidConfigurationIsRefusedWithPerFieldErrors()
    {
        (var bal, var dal, _) = Make();
        var ex = await Assert.ThrowsAsync<ValidationException>(() => bal.SaveConfigurationAsync(
            new Dictionary<string, string> { ["task.reminder_time"] = "99:99", ["HILLS_KM_RATE"] = "4" }));
        Assert.True(ex.FieldErrors.ContainsKey("task.reminder_time"));
        Assert.Equal("09:30", dal.Settings["task.reminder_time"]);
        Assert.False(dal.Settings.ContainsKey("HILLS_KM_RATE"));
    }

    [Fact]
    public async Task ConfigurationListsDefaultsForUnstoredKeys()
    {
        (var bal, _, _) = Make();
        var items = await bal.ConfigurationAsync();
        var hills = items.Single(i => i.Key == "HILLS_KM_RATE");
        Assert.False(hills.Stored);
        Assert.Equal("5.0", hills.Value);
        Assert.True(items.Single(i => i.Key == "task.reminder_time").Stored);
    }
}
