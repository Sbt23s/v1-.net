using System.Globalization;
using System.Text;
using Pixous.HrPortal.Domain.Modules.Payroll;

namespace Pixous.HrPortal.Infrastructure.Reporting;

/// <summary>
/// Renders standard A4 Payslip PDF matching Pixous Technologies layout.
/// Self-contained, valid PDF-1.4 generator with zero external dependencies.
/// </summary>
public static class PayslipPdfRenderer
{
    public static byte[] Render(
        PayslipRecord p,
        string? employeeName,
        string? employeeCode,
        string? designation,
        string? department)
    {
        var sb = new StringBuilder();

        // Palette
        // Dark ink: 0.07 0.09 0.15 rg
        // Muted gray: 0.35 0.38 0.42 rg
        // Hairline line: 0.75 0.75 0.75 RG
        // Band background: 0.91 0.92 0.94 rg

        double pageHeight = 842;
        double pageWidth = 595;
        double left = 42;
        double right = pageWidth - 42;
        double width = right - left; // 511 pt

        double y = pageHeight - 45;

        // 1. Header Box
        string companyName = string.IsNullOrWhiteSpace(p.CompanyName) ? "Pixous Technologies Pvt. Ltd" : p.CompanyName;
        string address = string.IsNullOrWhiteSpace(p.CompanyAddress) ? "382, Lakshmanan Nagar, 2nd St. Ext, Gandhipuram, Coimbatore - 641012" : p.CompanyAddress;
        string gstin = string.IsNullOrWhiteSpace(p.CompanyGstin) ? "33AAMCP3151E1ZO" : p.CompanyGstin;

        // Company Name (Bold 14pt, Centered)
        DrawCenteredText(sb, companyName, 14, true, pageWidth / 2, y);
        y -= 18;
        DrawCenteredText(sb, "PAYSLIP", 12, true, pageWidth / 2, y);
        y -= 14;
        DrawCenteredText(sb, address, 8, false, pageWidth / 2, y, 0.35, 0.38, 0.42);
        y -= 12;
        DrawCenteredText(sb, "GSTIN # " + gstin, 8, false, pageWidth / 2, y, 0.35, 0.38, 0.42);
        y -= 20;

        // Divider
        DrawLine(sb, left, y, right, y, 0.75, 0.75, 0.75);
        y -= 16;

        // 2. Meta Grid (2 columns: left identity, right pay/dept)
        string empCodeStr = !string.IsNullOrWhiteSpace(employeeCode) ? employeeCode : (p.UserId > 0 ? $"EMP-{p.UserId}" : "-");
        string empNameStr = !string.IsNullOrWhiteSpace(employeeName) ? employeeName : "-";
        string desigStr = !string.IsNullOrWhiteSpace(p.Designation) ? p.Designation : (!string.IsNullOrWhiteSpace(designation) ? designation : "-");
        string deptStr = !string.IsNullOrWhiteSpace(p.Department) ? p.Department : (!string.IsNullOrWhiteSpace(department) ? department : "-");

        string payPeriodStr = $"{CultureInfo.CurrentCulture.DateTimeFormat.GetMonthName(p.PayMonth)}, {p.PayYear}";
        string payDateStr = p.PayDate?.ToString("M/d/yyyy") ?? $"{p.PayMonth}/28/{p.PayYear}";
        string workingDaysStr = p.WorkingDays?.ToString() ?? "26";
        string lopDaysStr = p.LopDays.ToString("0.##");

        double col1Label = left;
        double col1Val = left + 95;
        double col2Label = left + 260;
        double col2Val = left + 360;

        DrawMetaRow(sb, "Employee ID", empCodeStr, "Designation", desigStr, col1Label, col1Val, col2Label, col2Val, y);
        y -= 15;
        DrawMetaRow(sb, "Employee Name", empNameStr, "Department", deptStr, col1Label, col1Val, col2Label, col2Val, y);
        y -= 15;
        DrawMetaRow(sb, "Pay Date", payDateStr, "Pay Period", payPeriodStr, col1Label, col1Val, col2Label, col2Val, y);
        y -= 15;
        DrawMetaRow(sb, "Bank Name", p.BankName ?? "-", "Bank A/C #", p.BankAccount ?? "-", col1Label, col1Val, col2Label, col2Val, y);
        y -= 15;
        DrawMetaRow(sb, "No of Working Days", workingDaysStr, "Basic Pay", FormatInr(p.BasicSalary), col1Label, col1Val, col2Label, col2Val, y);
        y -= 15;
        DrawMetaRow(sb, "Loss of Pay Days", lopDaysStr, "", "", col1Label, col1Val, col2Label, col2Val, y);
        y -= 22;

        // 3. Earnings & Deductions Table
        // Headers
        double eCol1 = left + 6;
        double eCol2 = left + 245;
        double dCol1 = left + 265;
        double dCol2 = right - 6;

        // Header line top & bottom
        DrawRect(sb, left, y - 4, width, 18, 0.94, 0.95, 0.96);
        DrawLine(sb, left, y + 14, right, y + 14, 0.2, 0.2, 0.2);
        DrawLine(sb, left, y - 4, right, y - 4, 0.2, 0.2, 0.2);

        DrawText(sb, "Earnings", 9.5, true, eCol1, y);
        DrawRightText(sb, "Amount", 9.5, true, eCol2, y);
        DrawText(sb, "Deductions", 9.5, true, dCol1, y);
        DrawRightText(sb, "Amount", 9.5, true, dCol2, y);
        y -= 18;

        var earnings = new List<(string Label, decimal Val)>();
        earnings.Add(("Basic Pay Adj", p.BasicSalary));
        if (p.Hra > 0) earnings.Add(("HRA", p.Hra));
        if (p.Allowances > 0) earnings.Add(("Allowances", p.Allowances));
        if (p.ConveyanceAllowance > 0) earnings.Add(("Conveyance", p.ConveyanceAllowance));
        if (p.SpecialAllowance > 0) earnings.Add(("Special Allowance", p.SpecialAllowance));
        if (p.OvertimePay > 0) earnings.Add(("Overtime", p.OvertimePay));
        if (p.PerformancePay > 0) earnings.Add(("Performance Pay", p.PerformancePay));
        if (p.ExpensesPay > 0) earnings.Add(("Expenses", p.ExpensesPay));
        if (p.Bonus > 0) earnings.Add(("Bonus", p.Bonus));

        var deductions = new List<(string Label, decimal Val)>();
        if (p.PfDeduction > 0) deductions.Add(("PF", p.PfDeduction));
        if (p.EsiDeduction > 0) deductions.Add(("ESI", p.EsiDeduction));
        if (p.PtDeduction > 0) deductions.Add(("Professional Tax", p.PtDeduction));
        if (p.TdsDeduction > 0) deductions.Add(("TDS", p.TdsDeduction));
        if (p.HealthInsurance > 0) deductions.Add(("Health Insurance", p.HealthInsurance));
        if (p.SalaryAdvance > 0) deductions.Add(("Salary Advance", p.SalaryAdvance));
        if (p.LeaveDeduction > 0)
        {
            string days = p.LopDays.ToString("0.##");
            string label = (days == "0" || string.IsNullOrEmpty(days))
                ? "Loss of Pay"
                : $"Loss of Pay ({days} {(days == "1" ? "day" : "days")})";
            deductions.Add((label, p.LeaveDeduction));
        }
        if (p.OtherDeductions > 0) deductions.Add(("Other Deductions", p.OtherDeductions));

        int rowsCount = Math.Max(earnings.Count, deductions.Count);
        for (int i = 0; i < rowsCount; i++)
        {
            if (i < earnings.Count)
            {
                DrawText(sb, earnings[i].Label, 9, false, eCol1, y);
                DrawRightText(sb, FormatInr(earnings[i].Val), 9, false, eCol2, y);
            }

            if (i < deductions.Count)
            {
                DrawText(sb, deductions[i].Label, 9, false, dCol1, y);
                DrawRightText(sb, FormatInr(deductions[i].Val), 9, false, dCol2, y);
            }

            // Hairline below row
            DrawLine(sb, left, y - 3, right, y - 3, 0.88, 0.88, 0.88);
            y -= 16;
        }

        // Totals Row Band
        DrawRect(sb, left, y - 4, width, 18, 0.91, 0.92, 0.94);
        DrawLine(sb, left, y + 14, right, y + 14, 0.2, 0.2, 0.2);
        DrawLine(sb, left, y - 4, right, y - 4, 0.2, 0.2, 0.2);

        DrawText(sb, "Total Earnings", 9.5, true, eCol1, y);
        DrawRightText(sb, FormatInr(p.GrossSalary), 9.5, true, eCol2, y);
        DrawText(sb, "Total Deductions", 9.5, true, dCol1, y);
        DrawRightText(sb, FormatInr(p.TotalDeductions), 9.5, true, dCol2, y);
        y -= 22;

        // Net Pay Box
        DrawText(sb, "Net Pay", 10, true, dCol1, y);
        DrawRightText(sb, FormatInr(p.NetPay), 10, true, dCol2, y);
        DrawLine(sb, dCol1, y - 4, right, y - 4, 0.2, 0.2, 0.2);
        y -= 24;

        // Net pay in words (Large, Centered)
        DrawCenteredText(sb, FormatInr(p.NetPay), 13, true, pageWidth / 2, y);
        y -= 16;
        DrawCenteredText(sb, IndianRupeesInWords(p.NetPay), 9.5, true, pageWidth / 2, y, 0.2, 0.2, 0.2);
        y -= 45;

        // 4. Signatures
        double signLeftCol = left + (width / 4);
        double signRightCol = right - (width / 4);

        DrawCenteredText(sb, "Employer Signature", 9.5, true, signLeftCol, y);
        DrawCenteredText(sb, "Employee Signature", 9.5, true, signRightCol, y);
        y -= 38;

        DrawCenteredText(sb, "Vanaraja D", 9, true, signLeftCol, y);
        DrawCenteredText(sb, empNameStr, 9, true, signRightCol, y);
        y -= 12;

        DrawCenteredText(sb, "Office Administrator", 8.5, false, signLeftCol, y, 0.35, 0.38, 0.42);
        DrawCenteredText(sb, desigStr, 8.5, false, signRightCol, y, 0.35, 0.38, 0.42);
        y -= 12;

        DrawCenteredText(sb, companyName, 8.5, false, signLeftCol, y, 0.35, 0.38, 0.42);
        DrawCenteredText(sb, companyName, 8.5, false, signRightCol, y, 0.35, 0.38, 0.42);
        y -= 30;

        // Computer generated document footer
        DrawCenteredText(sb, "This is a computer-generated document and requires no signature.", 8.5, true, pageWidth / 2, y, 0.35, 0.38, 0.42);

        string contentStream = sb.ToString();
        return BuildPdfDocument(contentStream);
    }

    private static void DrawText(StringBuilder sb, string text, double size, bool bold, double x, double y, double r = 0.07, double g = 0.09, double b = 0.15)
    {
        sb.Append($"q {r.ToString("0.##", CultureInfo.InvariantCulture)} {g.ToString("0.##", CultureInfo.InvariantCulture)} {b.ToString("0.##", CultureInfo.InvariantCulture)} rg ");
        sb.Append($"BT /{(bold ? "F2" : "F1")} {size.ToString("0.##", CultureInfo.InvariantCulture)} Tf ");
        sb.Append($"{x.ToString("0.##", CultureInfo.InvariantCulture)} {y.ToString("0.##", CultureInfo.InvariantCulture)} Td ");
        sb.Append($"({EscapePdf(text)}) Tj ET Q\n");
    }

    private static void DrawCenteredText(StringBuilder sb, string text, double size, bool bold, double cx, double y, double r = 0.07, double g = 0.09, double b = 0.15)
    {
        // Average char width estimation for Helvetica (~0.52 * size)
        double estimatedWidth = text.Length * (size * 0.52);
        double x = cx - (estimatedWidth / 2);
        DrawText(sb, text, size, bold, x, y, r, g, b);
    }

    private static void DrawRightText(StringBuilder sb, string text, double size, bool bold, double rightX, double y, double r = 0.07, double g = 0.09, double b = 0.15)
    {
        double estimatedWidth = text.Length * (size * 0.52);
        double x = rightX - estimatedWidth;
        DrawText(sb, text, size, bold, x, y, r, g, b);
    }

    private static void DrawLine(StringBuilder sb, double x1, double y1, double x2, double y2, double r, double g, double b, double width = 0.75)
    {
        sb.Append($"q {r.ToString("0.##", CultureInfo.InvariantCulture)} {g.ToString("0.##", CultureInfo.InvariantCulture)} {b.ToString("0.##", CultureInfo.InvariantCulture)} RG ");
        sb.Append($"{width.ToString("0.##", CultureInfo.InvariantCulture)} w ");
        sb.Append($"{x1.ToString("0.##", CultureInfo.InvariantCulture)} {y1.ToString("0.##", CultureInfo.InvariantCulture)} m ");
        sb.Append($"{x2.ToString("0.##", CultureInfo.InvariantCulture)} {y2.ToString("0.##", CultureInfo.InvariantCulture)} l S Q\n");
    }

    private static void DrawRect(StringBuilder sb, double x, double y, double w, double h, double r, double g, double b)
    {
        sb.Append($"q {r.ToString("0.##", CultureInfo.InvariantCulture)} {g.ToString("0.##", CultureInfo.InvariantCulture)} {b.ToString("0.##", CultureInfo.InvariantCulture)} rg ");
        sb.Append($"{x.ToString("0.##", CultureInfo.InvariantCulture)} {y.ToString("0.##", CultureInfo.InvariantCulture)} ");
        sb.Append($"{w.ToString("0.##", CultureInfo.InvariantCulture)} {h.ToString("0.##", CultureInfo.InvariantCulture)} re f Q\n");
    }

    private static void DrawMetaRow(StringBuilder sb, string l1, string v1, string l2, string v2, double x1, double vx1, double x2, double vx2, double y)
    {
        DrawText(sb, l1, 9, false, x1, y, 0.35, 0.38, 0.42);
        DrawText(sb, v1, 9.5, true, vx1, y);
        if (!string.IsNullOrEmpty(l2))
        {
            DrawText(sb, l2, 9, false, x2, y, 0.35, 0.38, 0.42);
            DrawText(sb, v2, 9.5, true, vx2, y);
        }
    }

    private static string EscapePdf(string s)
    {
        if (string.IsNullOrEmpty(s)) return string.Empty;
        return s.Replace("\\", "\\\\").Replace("(", "\\(").Replace(")", "\\)");
    }

    private static string FormatInr(decimal amount) =>
        "Rs. " + amount.ToString("N2", CultureInfo.InvariantCulture);

    private static byte[] BuildPdfDocument(string streamContent)
    {
        byte[] streamBytes = Encoding.Latin1.GetBytes(streamContent);

        var objects = new List<string>();
        objects.Add("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        objects.Add("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
        objects.Add("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n");
        objects.Add($"4 0 obj\n<< /Length {streamBytes.Length} >>\nstream\n{streamContent}endstream\nendobj\n");
        objects.Add("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
        objects.Add("6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n");

        var outStream = new MemoryStream();
        using var writer = new StreamWriter(outStream, Encoding.Latin1, leaveOpen: true);
        writer.Write("%PDF-1.4\n");
        writer.Flush();

        var offsets = new List<long>();
        offsets.Add(0); // 0th object

        foreach (string obj in objects)
        {
            offsets.Add(outStream.Position);
            writer.Write(obj);
            writer.Flush();
        }

        long startXref = outStream.Position;
        writer.Write($"xref\n0 {objects.Count + 1}\n");
        writer.Write("0000000000 65535 f \n");
        for (int i = 1; i <= objects.Count; i++)
        {
            writer.Write($"{offsets[i]:D10} 00000 n \n");
        }

        writer.Write($"trailer\n<< /Size {objects.Count + 1} /Root 1 0 R >>\nstartxref\n{startXref}\n%%EOF\n");
        writer.Flush();

        return outStream.ToArray();
    }

    private static readonly string[] Ones = {
        "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
        "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
        "Eighteen", "Nineteen"
    };

    private static readonly string[] Tens = {
        "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
    };

    public static string IndianRupeesInWords(decimal amount)
    {
        long rupees = (long)Math.Floor(amount);
        int paise = (int)Math.Round((amount - rupees) * 100);

        var sb = new StringBuilder(IndianWords(rupees)).Append(" Rupees");
        if (paise > 0)
        {
            sb.Append(" and ").Append(Words99(paise)).Append(" Paise");
        }
        return sb.ToString();
    }

    private static string IndianWords(long n)
    {
        if (n == 0) return "Zero";
        var sb = new StringBuilder();
        long crore = n / 10_000_000; n %= 10_000_000;
        long lakh = n / 100_000; n %= 100_000;
        long thousand = n / 1_000; n %= 1_000;
        long hundred = n / 100; n %= 100;

        if (crore > 0) sb.Append(IndianWords(crore)).Append(" Crore ");
        if (lakh > 0) sb.Append(Words99((int)lakh)).Append(" Lakh ");
        if (thousand > 0) sb.Append(Words99((int)thousand)).Append(" Thousand ");
        if (hundred > 0) sb.Append(Ones[(int)hundred]).Append(" Hundred ");
        if (n > 0) sb.Append(Words99((int)n));

        return sb.ToString().Trim();
    }

    private static string Words99(int n)
    {
        if (n < 20) return Ones[n];
        return (Tens[n / 10] + (n % 10 > 0 ? " " + Ones[n % 10] : string.Empty)).Trim();
    }
}
