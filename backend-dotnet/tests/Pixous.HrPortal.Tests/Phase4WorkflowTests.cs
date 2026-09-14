using System.IO.Compression;
using System.Text;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Payroll;
using Pixous.HrPortal.Infrastructure.Reporting;
using Xunit;

namespace Pixous.HrPortal.Tests;

public class Phase4WorkflowTests
{
    [Fact]
    public void PayslipPdfRenderer_GeneratesValidPdf14Stream()
    {
        var payslip = new PayslipRecord
        {
            Id = 42,
            UserId = 101,
            PayMonth = 9,
            PayYear = 2026,
            BasicSalary = 45000m,
            Hra = 18000m,
            Allowances = 5000m,
            GrossSalary = 68000m,
            PfDeduction = 1800m,
            PtDeduction = 200m,
            TotalDeductions = 2000m,
            NetPay = 66000m,
            WorkingDays = 26,
            LopDays = 0m,
            CompanyName = "Pixous Technologies Pvt. Ltd",
            Designation = "Senior Software Engineer",
            Department = "Product Development"
        };

        byte[] pdfBytes = PayslipPdfRenderer.Render(payslip, "Alex Mercer", "EMP-042", payslip.Designation, payslip.Department);

        Assert.NotNull(pdfBytes);
        Assert.True(pdfBytes.Length > 200);

        string rawPdf = Encoding.Latin1.GetString(pdfBytes);
        Assert.StartsWith("%PDF-1.4", rawPdf);
        Assert.Contains("%%EOF", rawPdf);
        Assert.Contains("Pixous Technologies", rawPdf);
        Assert.Contains("Alex Mercer", rawPdf);
        Assert.Contains("EMP-042", rawPdf);
        Assert.Contains("Senior Software Engineer", rawPdf);
    }

    [Theory]
    [InlineData(0, "Zero Rupees")]
    [InlineData(100, "One Hundred Rupees")]
    [InlineData(1250, "One Thousand Two Hundred Fifty Rupees")]
    [InlineData(25500.50, "Twenty Five Thousand Five Hundred Rupees and Fifty Paise")]
    [InlineData(100000, "One Lakh Rupees")]
    [InlineData(5000000, "Fifty Lakh Rupees")]
    public void PayslipPdfRenderer_IndianRupeesInWords_FormatsCorrectly(decimal amount, string expected)
    {
        string words = PayslipPdfRenderer.IndianRupeesInWords(amount);
        Assert.Equal(expected, words);
    }

    [Fact]
    public void OpenXmlWorkbookBuilder_GeneratesValidExcelZipArchive()
    {
        var headers = new List<string> { "Employee Code", "Employee Name", "Gross Pay", "Net Pay" };
        var rows = new List<IReadOnlyList<object?>>
        {
            new List<object?> { "EMP-001", "Alice Smith", 50000m, 46000m },
            new List<object?> { "EMP-002", "Bob Jones", 60000m, 55000m }
        };

        byte[] xlsxBytes = OpenXmlWorkbookBuilder.Create("Payroll Report", headers, rows);

        Assert.NotNull(xlsxBytes);
        Assert.True(xlsxBytes.Length > 0);

        using var memStream = new MemoryStream(xlsxBytes);
        using var archive = new ZipArchive(memStream, ZipArchiveMode.Read);

        Assert.NotNull(archive.GetEntry("[Content_Types].xml"));
        Assert.NotNull(archive.GetEntry("_rels/.rels"));
        Assert.NotNull(archive.GetEntry("xl/workbook.xml"));
        Assert.NotNull(archive.GetEntry("xl/worksheets/sheet1.xml"));
    }

    [Fact]
    public void PayrollRunResponse_DualNaming_EnsuresContractCompatibility()
    {
        var response = new PayrollRunResponse(
            Id: 99,
            PayMonth: 8,
            PayYear: 2026,
            RunMonth: 8,
            RunYear: 2026,
            Status: "CONFIRMED",
            RunBy: 1,
            RunAt: DateTime.Now,
            FinanceApprovedBy: null,
            FinanceApprovedAt: null,
            TotalEmployees: 15,
            TotalGross: 750000m,
            TotalNet: 680000m,
            Payslips: null
        );

        Assert.Equal(response.PayMonth, response.RunMonth);
        Assert.Equal(response.PayYear, response.RunYear);
        Assert.Equal(15, response.TotalEmployees);
        Assert.Equal(750000m, response.TotalGross);
        Assert.Equal(680000m, response.NetPayOrTotalNet());
    }

    [Fact]
    public void StoragePaths_SafeExtension_PreventsExecutableAndScriptUploads()
    {
        Assert.Equal("bin", StoragePaths.SafeExtension("exe"));
        Assert.Equal("bin", StoragePaths.SafeExtension("html"));
        Assert.Equal("bin", StoragePaths.SafeExtension("php"));
        Assert.Equal("bin", StoragePaths.SafeExtension("svg"));
        Assert.Equal("pdf", StoragePaths.SafeExtension("pdf"));
        Assert.Equal("png", StoragePaths.SafeExtension("png"));
        Assert.Equal("xlsx", StoragePaths.SafeExtension("xlsx"));
    }

    [Fact]
    public void StoragePaths_IsSafeRelativePath_RejectsPathTraversal()
    {
        Assert.False(StoragePaths.IsSafeRelativePath("../escape.txt"));
        Assert.False(StoragePaths.IsSafeRelativePath("..\\escape.txt"));
        Assert.False(StoragePaths.IsSafeRelativePath("/etc/passwd"));
        Assert.False(StoragePaths.IsSafeRelativePath("C:\\Windows\\system32"));
        Assert.True(StoragePaths.IsSafeRelativePath("payslips/2026-09/test.pdf"));
    }
}

public static class TestExtensions
{
    public static decimal NetPayOrTotalNet(this PayrollRunResponse r) => r.TotalNet;
}
