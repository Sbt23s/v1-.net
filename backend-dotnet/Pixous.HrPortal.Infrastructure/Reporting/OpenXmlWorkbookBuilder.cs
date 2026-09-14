using System.IO.Compression;
using System.Security;
using System.Text;

namespace Pixous.HrPortal.Infrastructure.Reporting;

/// <summary>
/// Lightweight, dependency-free OpenXML (.xlsx) spreadsheet generator.
/// Produces valid Excel workbooks using .NET's built-in System.IO.Compression.
/// </summary>
public static class OpenXmlWorkbookBuilder
{
    public static byte[] Create(string sheetName, IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<object?>> rows)
    {
        using var memory = new MemoryStream();
        using (var archive = new ZipArchive(memory, ZipArchiveMode.Create, leaveOpen: true))
        {
            WriteEntry(archive, "[Content_Types].xml", ContentTypesXml());
            WriteEntry(archive, "_rels/.rels", RootRelsXml());
            WriteEntry(archive, "xl/_rels/workbook.xml.rels", WorkbookRelsXml());
            WriteEntry(archive, "xl/workbook.xml", WorkbookXml(sheetName));
            WriteEntry(archive, "xl/worksheets/sheet1.xml", WorksheetXml(headers, rows));
        }

        return memory.ToArray();
    }

    private static void WriteEntry(ZipArchive archive, string entryName, string content)
    {
        var entry = archive.CreateEntry(entryName, CompressionLevel.Fastest);
        using var stream = entry.Open();
        byte[] bytes = Encoding.UTF8.GetBytes(content);
        stream.Write(bytes, 0, bytes.Length);
    }

    private static string Escape(string? s)
    {
        if (string.IsNullOrEmpty(s)) return string.Empty;
        return SecurityElement.Escape(s) ?? string.Empty;
    }

    private static string ColumnLetter(int colIndex)
    {
        int dividend = colIndex + 1;
        string column = string.Empty;
        while (dividend > 0)
        {
            int modulo = (dividend - 1) % 26;
            column = Convert.ToChar(65 + modulo) + column;
            dividend = (dividend - modulo) / 26;
        }
        return column;
    }

    private static string ContentTypesXml() => """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Default Extension="xml" ContentType="application/xml"/>
          <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
          <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        </Types>
        """;

    private static string RootRelsXml() => """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
        </Relationships>
        """;

    private static string WorkbookRelsXml() => """
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
        </Relationships>
        """;

    private static string WorkbookXml(string sheetName)
    {
        string safeName = Escape(string.IsNullOrWhiteSpace(sheetName) ? "Sheet1" : sheetName);
        return $"""
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
              <sheets>
                <sheet name="{safeName}" sheetId="1" r:id="rId1"/>
              </sheets>
            </workbook>
            """;
    }

    private static string WorksheetXml(IReadOnlyList<string> headers, IReadOnlyList<IReadOnlyList<object?>> rows)
    {
        var sb = new StringBuilder();
        sb.Append("""
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
              <sheetData>
            """);

        int rowIndex = 1;

        // Header row
        if (headers.Count > 0)
        {
            sb.Append($"""<row r="{rowIndex}">""");
            for (int col = 0; col < headers.Count; col++)
            {
                string cellRef = $"{ColumnLetter(col)}{rowIndex}";
                sb.Append($"""<c r="{cellRef}" t="inlineStr"><is><t>{Escape(headers[col])}</t></is></c>""");
            }
            sb.Append("</row>");
            rowIndex++;
        }

        // Body rows
        foreach (var row in rows)
        {
            sb.Append($"""<row r="{rowIndex}">""");
            for (int col = 0; col < row.Count; col++)
            {
                string cellRef = $"{ColumnLetter(col)}{rowIndex}";
                object? val = row[col];
                if (val is null)
                {
                    continue;
                }

                if (val is int or long or short or byte)
                {
                    sb.Append($"""<c r="{cellRef}"><v>{val}</v></c>""");
                }
                else if (val is decimal or double or float)
                {
                    sb.Append($"""<c r="{cellRef}"><v>{Convert.ToString(val, System.Globalization.CultureInfo.InvariantCulture)}</v></c>""");
                }
                else
                {
                    sb.Append($"""<c r="{cellRef}" t="inlineStr"><is><t>{Escape(val.ToString())}</t></is></c>""");
                }
            }
            sb.Append("</row>");
            rowIndex++;
        }

        sb.Append("""
              </sheetData>
            </worksheet>
            """);

        return sb.ToString();
    }
}
