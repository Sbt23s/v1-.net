using Pixous.HrPortal.Domain.Modules.ApprovalConfig;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// The approval configuration rules.
///
/// These decide who a complaint can be sent to and which tabs a person sees,
/// and every one of them has a failure mode that is SILENT: getting "absent
/// means unrestricted" backwards empties every dropdown in the application, and
/// getting the visibility union backwards hides tabs from people who hold two
/// roles. None of it throws, and none of it shows up in a build -- so it is
/// pinned here.
/// </summary>
public sealed class ApprovalConfigRulesTests
{
    private static ApprovalCandidate Person(long id, string name, params string[] roles) =>
        new()
        {
            Id = id,
            Name = name,
            EmployeeCode = $"EMP{id:0000}",
            Enabled = true,
            ProfileStatus = "ACTIVE",
            RoleCodes = roles
        };

    private static ApprovalCandidate CtoPerson(long id = 900) =>
        new()
        {
            Id = id,
            Name = "The CTO",
            EmployeeCode = ApprovalConfigCatalog.CtoEmployeeCode,
            Enabled = true,
            ProfileStatus = "ACTIVE",
            RoleCodes = []
        };

    private static ApprovalRecipientRow RoleRow(string module, string role, bool enabled = true) =>
        new() { ModuleCode = module, RoleCode = role, Enabled = enabled };

    private static ApprovalRecipientRow PersonRow(string module, long userId, bool enabled = true) =>
        new() { ModuleCode = module, UserId = userId, Enabled = enabled };

    private static VisibilityRow Vis(string role, string module, bool visible) =>
        new() { RoleCode = role, ModuleCode = module, Visible = visible };

    // ---- Absent means unrestricted ----------------------------------------

    /// <summary>
    /// The rule the whole feature rests on. A module nobody has configured
    /// offers whatever it would have offered, which is what makes this safe to
    /// ship switched off -- and it means a fault here cannot empty a working
    /// dropdown.
    /// </summary>
    [Fact]
    public void AnUnconfiguredModuleAllowsEverybody()
    {
        ApprovalConfigRules.Rules rules = ApprovalConfigRules.RulesFor([]);

        Assert.True(rules.IsEmpty);
        Assert.True(ApprovalConfigRules.Allows(rules, Person(1, "Anyone")));
        Assert.True(ApprovalConfigRules.Allows(rules, Person(2, "Another", "SOME_ROLE")));
    }

    /// <summary>
    /// A disabled row does not count as configuration. If it did, unticking the
    /// last box by disabling it would restrict the module to NOBODY instead of
    /// returning it to unrestricted -- the exact inversion of what was meant.
    /// </summary>
    [Fact]
    public void DisabledRowsDoNotCountAsConfiguration()
    {
        ApprovalConfigRules.Rules rules =
            ApprovalConfigRules.RulesFor([RoleRow("LEAVE", "IT_MGR", enabled: false)]);

        Assert.True(rules.IsEmpty);
        Assert.True(ApprovalConfigRules.Allows(rules, Person(1, "Somebody", "IT_EMP")));
    }

    [Fact]
    public void ANullCandidateIsNeverAllowed()
    {
        Assert.False(ApprovalConfigRules.Allows(ApprovalConfigRules.RulesFor([]), null));
    }

    // ---- Role rules and person rules are alternatives ----------------------

    [Fact]
    public void AConfiguredModuleAllowsOnlyTheTickedRole()
    {
        ApprovalConfigRules.Rules rules =
            ApprovalConfigRules.RulesFor([RoleRow("LEAVE", "IT_MGR")]);

        Assert.True(ApprovalConfigRules.Allows(rules, Person(1, "Manager", "IT_MGR")));
        Assert.False(ApprovalConfigRules.Allows(rules, Person(2, "Employee", "IT_EMP")));
    }

    /// <summary>
    /// Naming somebody on a module that also allows a role offers BOTH. Treated
    /// as conditions rather than alternatives this would offer nobody -- the
    /// named person is not also in the role, and the role holders are not also
    /// the named person.
    ///
    /// This is the exact shape of the live COMPLAINT configuration, which has a
    /// CTO role row and a person row for user 71 side by side.
    /// </summary>
    [Fact]
    public void RoleRulesAndPersonRulesAreAlternativesNotConditions()
    {
        ApprovalConfigRules.Rules rules = ApprovalConfigRules.RulesFor(
            [RoleRow("COMPLAINT", "IT_HR"), PersonRow("COMPLAINT", 71)]);

        Assert.True(ApprovalConfigRules.Allows(rules, Person(71, "Named person")));
        Assert.True(ApprovalConfigRules.Allows(rules, Person(5, "An HR", "IT_HR")));
        Assert.False(ApprovalConfigRules.Allows(rules, Person(6, "Neither", "IT_EMP")));
    }

    // ---- CTO is an employee code, not a role -------------------------------

    /// <summary>
    /// CTO has no row in `roles` at all, so it is matched on the employee code.
    /// Matched as a role it would never match anybody and the tick would
    /// silently do nothing -- which is precisely the live HELPDESK and
    /// COMPLAINT configuration.
    /// </summary>
    [Fact]
    public void CtoIsMatchedByEmployeeCodeRatherThanByRole()
    {
        ApprovalConfigRules.Rules rules =
            ApprovalConfigRules.RulesFor([RoleRow("HELPDESK", "CTO")]);

        Assert.True(ApprovalConfigRules.Allows(rules, CtoPerson()));

        // Somebody with neither the code nor a matching role is not reached.
        Assert.False(ApprovalConfigRules.Allows(rules, Person(2, "Somebody else", "IT_EMP")));
    }

    /// <summary>
    /// The CTO check does not SHORT-CIRCUIT the role check -- it returns early
    /// when it matches and otherwise falls through, so a role whose code were
    /// literally "CTO" would also satisfy a CTO tick.
    ///
    /// Verified against the Java rather than assumed, and it is moot on this
    /// database: no row in `roles` is coded CTO, which is the whole reason it is
    /// a pseudo-role. Pinned anyway, because if such a role were ever added the
    /// two spellings would start meaning the same tick, and that should be a
    /// decision somebody makes rather than a surprise.
    /// </summary>
    [Fact]
    public void ACtoTickAlsoMatchesARoleCodedCto()
    {
        ApprovalConfigRules.Rules rules =
            ApprovalConfigRules.RulesFor([RoleRow("HELPDESK", "CTO")]);

        Assert.True(ApprovalConfigRules.Allows(rules, Person(2, "Holds a CTO role", "CTO")));
    }

    /// <summary>The CTO pseudo-role is added to a person's subject codes.</summary>
    [Fact]
    public void SubjectCodesIncludeTheCtoPseudoRole()
    {
        Assert.Contains("CTO", ApprovalConfigRules.SubjectCodes(CtoPerson()));
        Assert.DoesNotContain("CTO", ApprovalConfigRules.SubjectCodes(Person(1, "X", "IT_EMP")));
    }

    /// <summary>Role codes are matched case-insensitively, both directions.</summary>
    [Fact]
    public void RoleMatchingIgnoresCase()
    {
        ApprovalConfigRules.Rules rules =
            ApprovalConfigRules.RulesFor([RoleRow("LEAVE", "it_mgr")]);

        Assert.True(ApprovalConfigRules.Allows(rules, Person(1, "Manager", "IT_MGR")));
    }

    // ---- The recipient grid ------------------------------------------------

    /// <summary>
    /// Built from the full catalogue, not from the rows that exist, so an
    /// unconfigured module comes back with every box shown and none ticked.
    /// Returning only saved rows would leave the screen to guess the rest.
    /// </summary>
    [Fact]
    public void TheGridShowsEveryModuleAndEveryRoleEvenWhenUnconfigured()
    {
        var config = ApprovalConfigRules.Grid([RoleRow("LEAVE", "IT_MGR")]);

        Assert.Equal(ApprovalConfigCatalog.Modules.Count, config.Count);
        foreach (string module in ApprovalConfigCatalog.Modules)
        {
            Assert.Equal(ApprovalConfigCatalog.RecipientRoles.Count, config[module].Count);
        }

        Assert.True(config["LEAVE"]["IT_MGR"]);
        Assert.False(config["LEAVE"]["IT_HR"]);
        Assert.False(config["WFH"]["IT_MGR"]);
    }

    /// <summary>Person rows are not role ticks and must not appear as any.</summary>
    [Fact]
    public void PersonRowsDoNotAppearInTheRoleGrid()
    {
        var config = ApprovalConfigRules.Grid([PersonRow("COMPLAINT", 71)]);

        Assert.DoesNotContain(config["COMPLAINT"].Values, ticked => ticked);
    }

    [Fact]
    public void DisabledRowsDoNotAppearInTheGrid()
    {
        var config = ApprovalConfigRules.Grid([RoleRow("LEAVE", "IT_MGR", enabled: false)]);

        Assert.False(config["LEAVE"]["IT_MGR"]);
    }

    // ---- Normalising a save body -------------------------------------------

    /// <summary>
    /// A stale or unknown role code is dropped rather than failing the save --
    /// the screen sends what it renders, and one bad code should not lose the
    /// valid ones.
    /// </summary>
    [Fact]
    public void UnknownRoleCodesAreDroppedRatherThanRejected()
    {
        IReadOnlySet<string> wanted =
            ApprovalConfigRules.NormaliseRoles(["IT_HR", "NO_SUCH_ROLE", "  it_tl  "]);

        Assert.Equal(2, wanted.Count);
        Assert.Contains("IT_HR", wanted);
        Assert.Contains("IT_TL", wanted);   // trimmed and upper-cased
        Assert.DoesNotContain("NO_SUCH_ROLE", wanted);
    }

    /// <summary>
    /// An empty list is meaningful: it returns the module to unrestricted,
    /// which is the only way to say "offer whatever you would have offered".
    /// </summary>
    [Fact]
    public void AnEmptyRoleListNormalisesToNothingWhichMeansUnrestricted()
    {
        Assert.Empty(ApprovalConfigRules.NormaliseRoles([]));
        Assert.Empty(ApprovalConfigRules.NormaliseRoles(null));
        Assert.True(ApprovalConfigRules.RulesFor([]).IsEmpty);
    }

    [Fact]
    public void UnknownVisibilityModulesAreDropped()
    {
        IReadOnlySet<string> wanted =
            ApprovalConfigRules.NormaliseModules(["LEAVE", "NOT_A_TAB", " wfh "]);

        Assert.Equal(2, wanted.Count);
        Assert.Contains("LEAVE", wanted);
        Assert.Contains("WFH", wanted);
    }

    // ---- Visibility --------------------------------------------------------

    /// <summary>A person all of whose roles are unconfigured sees every tab.</summary>
    [Fact]
    public void AnUnconfiguredRoleSeesEverything()
    {
        IReadOnlyList<string> visible = ApprovalConfigRules.VisibleModules([]);

        Assert.Equal(ApprovalConfigCatalog.VisibilityModules.Count, visible.Count);
    }

    /// <summary>
    /// The union rule. Somebody holding IT_EMP and IT_HR is both, and a module
    /// hidden from employees but shown to HR is one they should see -- an
    /// intersection would let the narrower role silently cancel a grant made
    /// through the wider one, which is the opposite of how roles add up
    /// everywhere else in this application.
    /// </summary>
    [Fact]
    public void VisibilityIsAUnionAcrossRolesNotAnIntersection()
    {
        IReadOnlyList<string> visible = ApprovalConfigRules.VisibleModules(
        [
            Vis("IT_EMP", "APPROVALS", visible: false),
            Vis("IT_HR",  "APPROVALS", visible: true)
        ]);

        Assert.Contains("APPROVALS", visible);
    }

    /// <summary>The order of the rules does not change the answer.</summary>
    [Fact]
    public void TheUnionDoesNotDependOnRuleOrder()
    {
        IReadOnlyList<string> shownFirst = ApprovalConfigRules.VisibleModules(
        [
            Vis("IT_HR",  "APPROVALS", visible: true),
            Vis("IT_EMP", "APPROVALS", visible: false)
        ]);

        Assert.Contains("APPROVALS", shownFirst);
    }

    /// <summary>
    /// A module no rule mentions stays visible, even while another module on
    /// the same role is hidden. Configuring one tab must not hide the rest by
    /// omission.
    /// </summary>
    [Fact]
    public void AModuleNoRuleMentionsStaysVisible()
    {
        IReadOnlyList<string> visible = ApprovalConfigRules.VisibleModules(
            [Vis("IT_EMP", "APPROVALS", visible: false)]);

        Assert.DoesNotContain("APPROVALS", visible);
        Assert.Contains("LEAVE", visible);
        Assert.Contains("POLICIES", visible);
        Assert.Equal(ApprovalConfigCatalog.VisibilityModules.Count - 1, visible.Count);
    }

    /// <summary>
    /// Hiding everything is expressed as rows saying visible = false, never as
    /// absent rows. Were hiding a delete, a role with everything hidden would be
    /// indistinguishable from one nobody had touched and would come back
    /// showing everything -- the exact opposite of what was saved.
    /// </summary>
    [Fact]
    public void EverythingHiddenIsDistinctFromNothingConfigured()
    {
        VisibilityRow[] allHidden = ApprovalConfigCatalog.VisibilityModules
            .Select(m => Vis("IT_EMP", m, visible: false))
            .ToArray();

        Assert.Empty(ApprovalConfigRules.VisibleModules(allHidden));

        // Whereas no rows at all means the opposite.
        Assert.Equal(ApprovalConfigCatalog.VisibilityModules.Count,
                     ApprovalConfigRules.VisibleModules([]).Count);
    }

    /// <summary>Visible tabs come back in the order the screen shows them.</summary>
    [Fact]
    public void VisibleModulesKeepTheCatalogueOrder()
    {
        IReadOnlyList<string> visible = ApprovalConfigRules.VisibleModules(
            [Vis("IT_EMP", "LEAVE", visible: true)]);

        Assert.Equal(ApprovalConfigCatalog.VisibilityModules, visible);
    }

    /// <summary>
    /// The grid reads unconfigured as all-on, so an untouched role shows every
    /// box ticked. Reading it as hidden would show an administrator the
    /// opposite of what the application actually does.
    /// </summary>
    [Fact]
    public void TheVisibilityGridReadsUnconfiguredAsAllOn()
    {
        var config = ApprovalConfigRules.VisibilityGrid([]);

        Assert.Equal(ApprovalConfigCatalog.VisibilityRoles.Count, config.Count);
        Assert.All(config.Values, row => Assert.All(row.Values, Assert.True));
    }

    /// <summary>A saved false shows as unticked; the untouched modules stay ticked.</summary>
    [Fact]
    public void TheVisibilityGridShowsSavedRowsAndDefaultsTheRest()
    {
        var config = ApprovalConfigRules.VisibilityGrid(
            [Vis("IT_EMP", "APPROVALS", visible: false)]);

        Assert.False(config["IT_EMP"]["APPROVALS"]);
        Assert.True(config["IT_EMP"]["LEAVE"]);
        Assert.True(config["IT_TL"]["APPROVALS"]);
    }
}
