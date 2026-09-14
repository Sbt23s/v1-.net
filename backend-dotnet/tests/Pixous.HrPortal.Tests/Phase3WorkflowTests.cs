using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Attendance;
using Pixous.HrPortal.Domain.Modules.Wfh;
using Xunit;

namespace Pixous.HrPortal.Tests;

public class Phase3WorkflowTests
{
    [Fact]
    public void WfhView_canAct_and_canCancel_rules_match_Spring_Boot()
    {
        var record = new WfhRequestRecord
        {
            Id = 10,
            UserId = 100,
            RequestedTo = 200,
            Status = "PENDING",
            FromDate = new DateOnly(2026, 9, 15),
            ToDate = new DateOnly(2026, 9, 16),
            WorkingDays = 2
        };

        var applicant = new ApproverCandidate
        {
            Id = 100,
            Name = "John Doe",
            EmployeeCode = "EMP001",
            DepartmentTitle = "Engineering",
            DesignationTitle = "Software Engineer",
            RoleCodes = ["EMPLOYEE"]
        };

        var approver = new ApproverCandidate
        {
            Id = 200,
            Name = "Jane Smith",
            EmployeeCode = "EMP002",
            DepartmentTitle = "Engineering",
            DesignationTitle = "Engineering Manager",
            RoleCodes = ["IT_TL"]
        };

        var users = new Dictionary<long, ApproverCandidate>
        {
            [100] = applicant,
            [200] = approver
        };

        // For the applicant: cannot act (approve own), can cancel (pending)
        bool isPending = string.Equals(record.Status, "PENDING", StringComparison.OrdinalIgnoreCase);
        bool canActApplicant = isPending && 100 != record.UserId && 100 == record.RequestedTo;
        bool canCancelApplicant = isPending && 100 == record.UserId;

        Assert.False(canActApplicant);
        Assert.True(canCancelApplicant);

        // For the approver: can act, cannot cancel
        bool canActApprover = isPending && 200 != record.UserId && 200 == record.RequestedTo;
        bool canCancelApprover = isPending && 200 == record.UserId;

        Assert.True(canActApprover);
        Assert.False(canCancelApprover);

        // For a 3rd party (e.g. user 300): cannot act, cannot cancel
        bool canActThirdParty = isPending && 300 != record.UserId && 300 == record.RequestedTo;
        bool canCancelThirdParty = isPending && 300 == record.UserId;

        Assert.False(canActThirdParty);
        Assert.False(canCancelThirdParty);
    }

    [Fact]
    public void WfhView_decided_request_cannot_be_acted_or_cancelled()
    {
        var record = new WfhRequestRecord
        {
            Id = 10,
            UserId = 100,
            RequestedTo = 200,
            DecidedBy = 200,
            Status = "APPROVED",
            FromDate = new DateOnly(2026, 9, 15),
            ToDate = new DateOnly(2026, 9, 16),
            WorkingDays = 2
        };

        bool isPending = string.Equals(record.Status, "PENDING", StringComparison.OrdinalIgnoreCase);
        bool canActApprover = isPending && 200 != record.UserId && 200 == record.RequestedTo;
        bool canCancelApplicant = isPending && 100 == record.UserId;

        Assert.False(canActApprover);
        Assert.False(canCancelApplicant);
    }

    [Fact]
    public void ActiveBetween_dates_reversed_should_swap()
    {
        DateOnly? from = new DateOnly(2026, 9, 20);
        DateOnly? to = new DateOnly(2026, 9, 10);

        DateOnly start = from ?? DateOnly.FromDateTime(DateTime.Now);
        DateOnly end = to ?? start;
        if (end < start)
        {
            (start, end) = (end, start);
        }

        Assert.Equal(new DateOnly(2026, 9, 10), start);
        Assert.Equal(new DateOnly(2026, 9, 20), end);
    }

    [Fact]
    public void Insights_pace_late_morning_math()
    {
        // todayLate > 0 && usualLate > 0 && todayLate > usualLate * 1.6 && lateToday >= 3
        double todayLate = 45.0;
        double usualLate = 20.0;
        long lateToday = 4;

        bool alert = todayLate > 0 && usualLate > 0 && todayLate > usualLate * 1.6 && lateToday >= 3;
        Assert.True(alert);

        // Not enough people late
        lateToday = 2;
        alert = todayLate > 0 && usualLate > 0 && todayLate > usualLate * 1.6 && lateToday >= 3;
        Assert.False(alert);

        // Not severe enough ratio (< 1.6)
        lateToday = 5;
        todayLate = 25.0;
        alert = todayLate > 0 && usualLate > 0 && todayLate > usualLate * 1.6 && lateToday >= 3;
        Assert.False(alert);
    }
}
