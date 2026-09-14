using Pixous.HrPortal.Domain.Modules.Admin;
using Pixous.HrPortal.Domain.Modules.Announcement;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// Unit tests for Technical Admin domain models, DTOs, and business rules.
/// </summary>
public sealed class TechnicalAdminTests
{
    [Fact]
    public void CompanyResponse_DefaultValues_AreCorrect()
    {
        var company = new CompanyResponse
        {
            Id = 1L,
            CompanyId = "PIX-MASTER",
            CompanyName = "Pixous Technologies"
        };

        Assert.Equal(1L, company.Id);
        Assert.Equal("PIX-MASTER", company.CompanyId);
        Assert.Equal("Pixous Technologies", company.CompanyName);
        Assert.Equal("ACTIVE", company.Status);
        Assert.Null(company.EmployeeCount);
    }

    [Fact]
    public void ModuleView_RecordSemantics_Preserved()
    {
        var module1 = new ModuleView(1L, "ATTENDANCE", true, "{\"visibleRoles\":[\"EMPLOYEE\"]}");
        var module2 = new ModuleView(1L, "ATTENDANCE", true, "{\"visibleRoles\":[\"EMPLOYEE\"]}");

        Assert.Equal(module1, module2);
        Assert.Equal(1L, module1.Id);
        Assert.Equal("ATTENDANCE", module1.ModuleCode);
        Assert.True(module1.Enabled);
    }

    [Fact]
    public void SimulateAccessResponse_Defaults_AreSuccessful()
    {
        var modules = new List<ModuleView>
        {
            new(1L, "ATTENDANCE", true, null),
            new(2L, "PAYROLL", true, null)
        };

        var response = new SimulateAccessResponse
        {
            SimulatedCompanyId = 5L,
            SimulatedRole = "EMPLOYEE",
            EntitledModules = modules
        };

        Assert.Equal(5L, response.SimulatedCompanyId);
        Assert.Equal("EMPLOYEE", response.SimulatedRole);
        Assert.Equal("SUCCESS", response.Status);
        Assert.Equal("Simulated access successfully generated.", response.Message);
        Assert.Equal(2, response.EntitledModules.Count);
    }

    [Fact]
    public void UsageResponse_Note_ExplainsDeploymentConstraint()
    {
        var usage = new UsageResponse();
        Assert.Equal(0, usage.Days);
        Assert.Empty(usage.People);
        Assert.Contains("earlier activity was never stored", usage.Note);
    }

    [Fact]
    public void UsagePersonView_ComputesMetricsAccurately()
    {
        var person = new UsagePersonView
        {
            UserId = 42L,
            Username = "test.user",
            CompanyId = 1L,
            Touches = 120,
            DaysActive = 10,
            ActiveMinutes = 600,
            Modules = new Dictionary<string, long>
            {
                ["ATTENDANCE"] = 50,
                ["LEAVE"] = 40,
                ["PAYROLL"] = 30
            }
        };

        Assert.Equal(42L, person.UserId);
        Assert.Equal("test.user", person.Username);
        Assert.Equal(120, person.Touches);
        Assert.Equal(3, person.Modules.Count);
        Assert.Equal(50, person.Modules["ATTENDANCE"]);
        Assert.Equal(40, person.Modules["LEAVE"]);
        Assert.Equal(30, person.Modules["PAYROLL"]);
    }

    [Fact]
    public void RoleView_Permissions_CountAndOrderingPreserved()
    {
        var perms = new List<TechnicalAdminPermissionView>
        {
            new(1L, "ATTENDANCE_VIEW", "View Attendance"),
            new(2L, "LEAVE_APPLY", "Apply Leave")
        };

        var role = new TechnicalAdminRoleView(
            1L,
            "ROLE_EMPLOYEE",
            "Employee",
            "General employee",
            "BOTH",
            perms.Count,
            perms);

        Assert.Equal(2, role.PermissionCount);
        Assert.Equal("ROLE_EMPLOYEE", role.Code);
        Assert.Equal(2, role.Permissions.Count);
        Assert.Equal("ATTENDANCE_VIEW", role.Permissions[0].Code);
    }

    [Fact]
    public void AnnouncementTargeting_TechnicalAdmin_ReachesAdmins()
    {
        Assert.True(AnnouncementTargeting.Reaches("Admin", "Platform Super Admin"));
        Assert.True(AnnouncementTargeting.Reaches("Admin", "COMPANY ADMIN"));
        Assert.False(AnnouncementTargeting.Reaches("Employee", "Technical Admin"));
    }
}
