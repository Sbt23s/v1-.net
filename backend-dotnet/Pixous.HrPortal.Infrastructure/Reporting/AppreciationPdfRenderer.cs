using System.Globalization;
using System.Text;
using Pixous.HrPortal.Domain.Modules.Appreciation;

namespace Pixous.HrPortal.Infrastructure.Reporting;

/// <summary>
/// Renders standard A4 Appreciation Letter PDF matching Pixous Technologies layout.
/// Self-contained, valid PDF-1.4 generator with zero external dependencies.
/// </summary>
public static class AppreciationPdfRenderer
{
    public static byte[] Render(
        AppreciationRecord letter,
        string? employeeName,
        string? designation,
        string? issuerName,
        string? issuerRole)
    {
        var sb = new StringBuilder();

        double pageHeight = 842;
        double pageWidth = 595;
        double left = 56;
        double right = pageWidth - 56;
        double width = right - left;

        double y = pageHeight - 56;

        // Brand Purple: 0.31, 0.22, 0.78
        double br = 0.31, bg = 0.22, bb = 0.78;

        // 1. Header
        DrawText(sb, "PIXOUS TECHNOLOGIES", 14, true, left, y, br, bg, bb);
        DrawRightText(sb, "OFFICIAL COMMUNICATION", 8, false, right, y + 2, 0.45, 0.45, 0.45);
        y -= 14;

        DrawLine(sb, left, y, right, y, br, bg, bb, 1.5);
        y -= 28;

        // 2. Main Title
        DrawCenteredText(sb, "LETTER OF APPRECIATION", 16, true, pageWidth / 2, y, br, bg, bb);
        y -= 24;

        // 3. Metadata Row: Reference and Date
        string refCode = letter.ReferenceCode ?? "AL-";
        string dateStr = letter.LetterDate.HasValue 
            ? letter.LetterDate.Value.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)
            : DateTime.Now.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

        DrawText(sb, $"Ref: {refCode}", 9.5, true, left, y, 0.3, 0.3, 0.3);
        DrawRightText(sb, $"Date: {dateStr}", 9.5, true, right, y, 0.3, 0.3, 0.3);
        y -= 20;

        DrawLine(sb, left, y, right, y, 0.85, 0.85, 0.85, 0.5);
        y -= 24;

        // 4. Recipient block
        string recipient = !string.IsNullOrWhiteSpace(employeeName) ? employeeName : (letter.EmployeeName ?? "Valued Employee");
        DrawText(sb, "To:", 10.5, true, left, y);
        y -= 14;
        DrawText(sb, recipient, 12, true, left, y, br, bg, bb);
        y -= 14;
        if (!string.IsNullOrWhiteSpace(designation))
        {
            DrawText(sb, designation, 10, false, left, y, 0.35, 0.38, 0.42);
            y -= 14;
        }
        y -= 12;

        // 5. Subject
        string achievement = letter.Achievement ?? "Outstanding Contribution";
        DrawText(sb, $"Subject: In Recognition of {achievement}", 11, true, left, y);
        y -= 18;

        // 6. Body text
        string message = letter.Message ?? "Thank you for your valuable contributions and dedicated service to Pixous Technologies.";
        var lines = WrapText(message, 78);
        foreach (var line in lines)
        {
            DrawText(sb, line, 10, false, left, y, 0.15, 0.15, 0.15);
            y -= 15;
            if (y < 120) break;
        }

        y -= 20;

        // 7. Closing & Signature
        DrawText(sb, "With sincere appreciation,", 10, false, left, y);
        y -= 30;

        string signatory = !string.IsNullOrWhiteSpace(issuerName) ? issuerName : (letter.IssuedByName ?? "Management");
        DrawText(sb, signatory, 11, true, left, y, br, bg, bb);
        y -= 13;
        if (!string.IsNullOrWhiteSpace(issuerRole))
        {
            DrawText(sb, issuerRole, 9.5, false, left, y, 0.35, 0.38, 0.42);
            y -= 13;
        }
        DrawText(sb, "Pixous Technologies Pvt. Ltd", 9.5, false, left, y, 0.35, 0.38, 0.42);

        // 8. Footer
        DrawLine(sb, left, 50, right, 50, 0.85, 0.85, 0.85, 0.5);
        DrawCenteredText(sb, "Pixous Technologies Pvt. Ltd • Confidential • Official Human Resources Communication", 7.5, false, pageWidth / 2, 38, 0.5, 0.5, 0.5);

        return BuildPdfDocument(sb.ToString());
    }

    private static List<string> WrapText(string text, int maxCharsPerLine)
    {
        var result = new List<string>();
        var paragraphs = text.Replace("\r\n", "\n").Split('\n');
        foreach (var para in paragraphs)
        {
            if (string.IsNullOrWhiteSpace(para))
            {
                result.Add(string.Empty);
                continue;
            }

            var words = para.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var currentLine = new StringBuilder();
            foreach (var word in words)
            {
                if (currentLine.Length + word.Length + 1 > maxCharsPerLine)
                {
                    result.Add(currentLine.ToString());
                    currentLine.Clear();
                }
                if (currentLine.Length > 0) currentLine.Append(' ');
                currentLine.Append(word);
            }
            if (currentLine.Length > 0)
            {
                result.Add(currentLine.ToString());
            }
        }
        return result;
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

    private static string EscapePdf(string s)
    {
        if (string.IsNullOrEmpty(s)) return string.Empty;
        return s.Replace("\\", "\\\\").Replace("(", "\\(").Replace(")", "\\)");
    }

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
}
