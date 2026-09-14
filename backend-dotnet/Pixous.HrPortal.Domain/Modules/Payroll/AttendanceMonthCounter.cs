using Pixous.HrPortal.Domain.Common;

namespace Pixous.HrPortal.Domain.Modules.Payroll;

/// <summary>
/// Counts a month's attendance into the figures payroll deducts from.
/// Ported from PayslipService.countMonth.
///
/// Static and dependency-free for the same reason as the calculator: the number
/// of unpaid days is multiplied by a day's pay, so an error here is money.
/// </summary>
public static class AttendanceMonthCounter
{
    /// <summary>
    /// Counts the month.
    ///
    /// Two boundaries matter and they are deliberately different:
    ///
    ///   - **Working days** are counted across the WHOLE month, because that is
    ///     the divisor for a day's pay and it does not depend on today.
    ///   - **Attendance** is counted only up to today, because a run on the 10th
    ///     must not mark the rest of the month absent.
    ///
    ///   - **Whether the register was kept** is judged across the whole month
    ///     again: a run on the 3rd would otherwise see two days, find nothing in
    ///     them, and conclude the register was not kept when it plainly was.
    /// </summary>
    /// <param name="statusByDay">
    /// Attendance status per day, already upper-cased. A day absent from this
    /// map has no row.
    /// </param>
    /// <param name="rowsInMonth">
    /// How many attendance rows exist for this person across the whole month --
    /// not just up to today. Decides <see cref="WorkCalendar.AttendanceWasKept"/>.
    /// </param>
    public static AttendanceMonth Count(
        int year,
        int month,
        DateOnly today,
        IReadOnlySet<DateOnly> holidays,
        IReadOnlyDictionary<DateOnly, string> statusByDay,
        long rowsInMonth)
    {
        var start = new DateOnly(year, month, 1);
        DateOnly monthEnd = start.AddMonths(1).AddDays(-1);

        // Attendance is not read past today.
        DateOnly end = monthEnd > today ? today : monthEnd;

        int workingDays = 0;
        int holidayCount = 0;
        for (DateOnly d = start; d <= monthEnd; d = d.AddDays(1))
        {
            if (WorkCalendar.IsWeekend(d))
            {
                continue;
            }

            if (holidays.Contains(d))
            {
                holidayCount++;
                continue;
            }

            workingDays++;
        }

        bool tracked = WorkCalendar.AttendanceWasKept(rowsInMonth);

        int present = 0, paid = 0, unpaid = 0, wfh = 0;
        for (DateOnly d = start; d <= end; d = d.AddDays(1))
        {
            if (WorkCalendar.IsWeekend(d) || holidays.Contains(d))
            {
                continue;
            }

            if (!statusByDay.TryGetValue(d, out string? status))
            {
                // No row for this day.
                //
                // An absence only if the register was being kept. Where it was
                // not, every working day landed here and the month's entire
                // salary was deducted as absence -- a payslip with a negative
                // net, produced without an error, on figures that otherwise
                // looked right.
                if (tracked)
                {
                    unpaid++;
                }
                continue;
            }

            switch (status)
            {
                case "WFH":
                    present++;
                    wfh++;
                    break;
                case "PRESENT":
                case "LATE":
                case "HALF_DAY":
                    present++;
                    break;
                case "LEAVE":
                case "PAID_LEAVE":
                case "ON_LEAVE":
                    paid++;
                    break;
                default:
                    // Anything else -- ABSENT, and any status added later -- is
                    // unpaid, as the Java default arm does.
                    unpaid++;
                    break;
            }
        }

        return new AttendanceMonth(
            DaysInMonth: DateTime.DaysInMonth(year, month),
            WorkingDays: workingDays,
            Present: present,
            PaidLeave: paid,
            UnpaidDays: unpaid,
            Holidays: holidayCount,
            Wfh: wfh);
    }
}

/// <summary>A month of attendance, counted.</summary>
public sealed record AttendanceMonth(
    int DaysInMonth,
    int WorkingDays,
    int Present,
    int PaidLeave,
    int UnpaidDays,
    int Holidays,
    int Wfh);
