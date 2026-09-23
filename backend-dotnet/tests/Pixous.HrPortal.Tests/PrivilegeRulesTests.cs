using Pixous.HrPortal.Domain.Modules.Privileges;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// The lockout protections on Admin Settings -> Privileges.
///
/// Each one guards against a change that would leave nobody able to undo it,
/// and none of them fails loudly if it is wrong -- the save simply succeeds.
/// So every case is pinned here.
/// </summary>
public sealed class PrivilegeRulesTests
{
    private static readonly IReadOnlySet<string> Roles =
        new HashSet<string> { "SUPER_ADMIN", "COMPANY_ADMIN", "IT_HR", "IT_EMP", "IT_TL" };

    private static PrivilegeRules.UserState User(long id, params string[] roles) =>
        new(id, $"User {id}", true, roles);

    private static Dictionary<long, IReadOnlyCollection<string>> Proposed(params (long Id, string[] Roles)[] items) =>
        items.ToDictionary(i => i.Id, i => (IReadOnlyCollection<string>)i.Roles);

    // ---- Role permissions --------------------------------------------------

    [Fact]
    public void AnOrdinaryRoleCanLoseAnyCode()
    {
        var problems = PrivilegeRules.CheckRolePermissions("IT_HR", ["USER_MANAGE", "ORG_MANAGE"], []);
        Assert.Empty(problems);
    }

    [Theory]
    [InlineData("SUPER_ADMIN", "USER_MANAGE")]
    [InlineData("SUPER_ADMIN", "ORG_MANAGE")]
    [InlineData("COMPANY_ADMIN", "USER_MANAGE")]
    public void AnAdminRoleCannotLoseALockedCode(string role, string code)
    {
        var problems = PrivilegeRules.CheckRolePermissions(role, ["USER_MANAGE", "ORG_MANAGE"],
            new[] { "USER_MANAGE", "ORG_MANAGE" }.Where(c => c != code).ToArray());
        Assert.Contains(problems, p => p.Contains(code));
    }

    [Fact]
    public void AnAdminRoleCanLoseAnUnlockedCode()
    {
        var problems = PrivilegeRules.CheckRolePermissions("SUPER_ADMIN",
            ["USER_MANAGE", "ORG_MANAGE", "PAYROLL_RUN"], ["USER_MANAGE", "ORG_MANAGE"]);
        Assert.Empty(problems);
    }

    [Fact]
    public void ALockedCodeTheRoleNeverHadIsNotDemanded()
    {
        // A fresh rebuild can leave COMPANY_ADMIN without USER_MANAGE; editing
        // it must not be blocked for a code it never held.
        var problems = PrivilegeRules.CheckRolePermissions("COMPANY_ADMIN", ["ORG_MANAGE"], ["ORG_MANAGE", "REPORT_VIEW"]);
        Assert.Empty(problems);
    }

    [Fact]
    public void AnUnknownCodeIsRefused()
    {
        var problems = PrivilegeRules.CheckRolePermissions("IT_EMP", [], ["MAKE_ME_ADMIN"]);
        Assert.Single(problems);
    }

    [Fact]
    public void EveryCatalogueCodeIsUniqueAndHasAModuleAndActions()
    {
        Assert.Equal(PrivilegeCatalog.Permissions.Count, PrivilegeCatalog.KnownCodes.Count);
        Assert.All(PrivilegeCatalog.Permissions, p =>
        {
            Assert.False(string.IsNullOrWhiteSpace(p.Module));
            Assert.NotEmpty(p.Actions);
            Assert.All(p.Actions, a => Assert.Contains(a, PrivilegeCatalog.Actions));
        });
    }

    [Fact]
    public void TheLockedCodesAreInTheCatalogue() =>
        Assert.All(PrivilegeCatalog.LockedAdminCodes, c => Assert.Contains(c, PrivilegeCatalog.KnownCodes));

    // ---- User roles ----------------------------------------------------------

    [Fact]
    public void AnOrdinaryRoleChangePasses()
    {
        var problems = PrivilegeRules.CheckUserRoles(1, false, [User(5, "IT_EMP")],
            Proposed((5, ["IT_EMP", "IT_TL"])), Roles, superAdminsOutsideChange: 1);
        Assert.Empty(problems);
    }

    [Fact]
    public void YouCannotRemoveYourOwnAdminRole()
    {
        var problems = PrivilegeRules.CheckUserRoles(1, true, [User(1, "SUPER_ADMIN", "IT_EMP")],
            Proposed((1, ["IT_EMP"])), Roles, superAdminsOutsideChange: 3);
        Assert.Contains(problems, p => p.Contains("your own account"));
    }

    [Fact]
    public void TheLastSuperAdminCannotBeRemoved()
    {
        var problems = PrivilegeRules.CheckUserRoles(1, true, [User(7, "SUPER_ADMIN")],
            Proposed((7, ["IT_EMP"])), Roles, superAdminsOutsideChange: 0);
        Assert.Contains(problems, p => p.Contains("At least one active Super Admin"));
    }

    [Fact]
    public void ASuperAdminCanBeRemovedWhileAnotherRemains()
    {
        var problems = PrivilegeRules.CheckUserRoles(1, true, [User(7, "SUPER_ADMIN")],
            Proposed((7, ["IT_EMP"])), Roles, superAdminsOutsideChange: 1);
        Assert.Empty(problems);
    }

    [Fact]
    public void ADisabledSuperAdminDoesNotCountAsRemaining()
    {
        var disabled = new PrivilegeRules.UserState(8, "Disabled", false, ["SUPER_ADMIN"]);
        var problems = PrivilegeRules.CheckUserRoles(1, true, [disabled],
            Proposed((8, ["SUPER_ADMIN"])), Roles, superAdminsOutsideChange: 0);
        Assert.Contains(problems, p => p.Contains("At least one active Super Admin"));
    }

    [Theory]
    [InlineData("SUPER_ADMIN")]
    [InlineData("COMPANY_ADMIN")]
    public void ACompanyAdminCannotGrantAnAdminRole(string role)
    {
        var problems = PrivilegeRules.CheckUserRoles(1, false, [User(5, "IT_EMP")],
            Proposed((5, ["IT_EMP", role])), Roles, superAdminsOutsideChange: 1);
        Assert.Contains(problems, p => p.Contains("Only a Super Admin"));
    }

    [Fact]
    public void ACompanyAdminCannotPromoteThemselves()
    {
        var problems = PrivilegeRules.CheckUserRoles(1, false, [User(1, "COMPANY_ADMIN")],
            Proposed((1, ["COMPANY_ADMIN", "SUPER_ADMIN"])), Roles, superAdminsOutsideChange: 1);
        Assert.Contains(problems, p => p.Contains("Only a Super Admin"));
    }

    [Fact]
    public void ASuperAdminCanGrantAnAdminRole()
    {
        var problems = PrivilegeRules.CheckUserRoles(1, true, [User(5, "IT_EMP")],
            Proposed((5, ["IT_EMP", "COMPANY_ADMIN"])), Roles, superAdminsOutsideChange: 1);
        Assert.Empty(problems);
    }

    [Fact]
    public void EveryoneKeepsAtLeastOneRole()
    {
        var problems = PrivilegeRules.CheckUserRoles(1, true, [User(5, "IT_EMP")],
            Proposed((5, [])), Roles, superAdminsOutsideChange: 1);
        Assert.Contains(problems, p => p.Contains("at least one role"));
    }

    [Fact]
    public void AnUnknownRoleIsRefused()
    {
        var problems = PrivilegeRules.CheckUserRoles(1, true, [User(5, "IT_EMP")],
            Proposed((5, ["GOD_MODE"])), Roles, superAdminsOutsideChange: 1);
        Assert.Contains(problems, p => p.Contains("Unknown role"));
    }

    [Fact]
    public void AnOversizedBulkChangeIsRefused()
    {
        var proposed = Enumerable.Range(1, PrivilegeCatalog.MaxBulkUsers + 1)
            .ToDictionary(i => (long)i, _ => (IReadOnlyCollection<string>)["IT_EMP"]);
        var problems = PrivilegeRules.CheckUserRoles(1, true, [], proposed, Roles, 1);
        Assert.Single(problems);
    }

    [Fact]
    public void BulkRemovalWinsOverAddition()
    {
        var result = PrivilegeRules.ApplyBulk(["IT_EMP"], add: ["IT_TL"], remove: ["IT_TL"]);
        Assert.Equal(["IT_EMP"], result);
    }

    [Fact]
    public void DiffListsAddedAndRemoved()
    {
        (var added, var removed) = PrivilegeRules.Diff(["A", "B"], ["B", "C"]);
        Assert.Equal(["C"], added);
        Assert.Equal(["A"], removed);
    }

    // ---- Configuration ---------------------------------------------------------

    [Theory]
    [InlineData("task.reminder_enabled", "TRUE", "true")]
    [InlineData("task.reminder_time", "09:30", "09:30")]
    [InlineData("task.reminder_lead_days", "3", "3")]
    [InlineData("chat.retention_days", "0", "0")]
    [InlineData("HILLS_KM_RATE", "5", "5.0")]
    [InlineData("PLAINS_KM_RATE", "3.25", "3.25")]
    public void ValidValuesAreNormalised(string key, string raw, string expected)
    {
        (string? value, string? error) = ConfigCatalog.Normalise(key, raw);
        Assert.Null(error);
        Assert.Equal(expected, value);
    }

    [Theory]
    [InlineData("task.reminder_enabled", "yes")]
    [InlineData("task.reminder_time", "25:00")]
    [InlineData("task.reminder_time", "9:30")]
    [InlineData("task.reminder_lead_days", "31")]
    [InlineData("task.reminder_lead_days", "-1")]
    [InlineData("chat.retention_days", "abc")]
    [InlineData("HILLS_KM_RATE", "-2")]
    [InlineData("GROQ_API_KEY", "anything")]
    public void InvalidValuesAndUnknownKeysAreRefused(string key, string raw)
    {
        (string? value, string? error) = ConfigCatalog.Normalise(key, raw);
        Assert.Null(value);
        Assert.NotNull(error);
    }

    [Theory]
    [InlineData("GROQ_API_KEY", true)]
    [InlineData("App_Secret", true)]
    [InlineData("HILLS_KM_RATE", false)]
    [InlineData("task.reminder_time", false)]
    public void SecretKeysAreRecognised(string key, bool secret) =>
        Assert.Equal(secret, ConfigCatalog.IsSecretKey(key));

    [Fact]
    public void EveryDefaultIsItselfValid() =>
        Assert.All(ConfigCatalog.Settings, s => Assert.Null(ConfigCatalog.Normalise(s.Key, s.DefaultValue).Error));
}
