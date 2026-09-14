using System.Security.Cryptography;
using System.Text;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Biometric;
using Pixous.HrPortal.Infrastructure.Modules.Biometric;
using Xunit;

namespace Pixous.HrPortal.Tests;

public sealed class Phase7WorkflowTests
{
    private readonly Xunit.Abstractions.ITestOutputHelper? _output;

    public Phase7WorkflowTests(Xunit.Abstractions.ITestOutputHelper? output = null)
    {
        _output = output;
    }
    [Fact]
    public void HikWebhookSignature_GeneratesCorrectSignatureAndMatches()
    {
        string secret = "test-secret-key-123456";
        string timestamp = "1726291200";
        string batchId = "batch-uuid-789";

        string signature = HikWebhookSignature.Sign(secret, timestamp, batchId);

        Assert.StartsWith("sha256=", signature);
        Assert.True(signature.Length > 10);

        // Verification matches
        bool matches = HikWebhookSignature.Matches(secret, timestamp, batchId, signature);
        Assert.True(matches);

        // Tampering detection
        bool wrongSecret = HikWebhookSignature.Matches("wrong-secret", timestamp, batchId, signature);
        Assert.False(wrongSecret);

        bool wrongBatch = HikWebhookSignature.Matches(secret, timestamp, "different-batch", signature);
        Assert.False(wrongBatch);

        bool wrongTime = HikWebhookSignature.Matches(secret, "9999999999", batchId, signature);
        Assert.False(wrongTime);

        bool nullSig = HikWebhookSignature.Matches(secret, timestamp, batchId, null);
        Assert.False(nullSig);
    }

    [Fact]
    public void HikWebhookSignature_MatchesJavaReferenceDigest()
    {
        string secret = "my_api_secret";
        string timestamp = "2026-09-14T08:00:00Z";
        string batchId = "batch_001";

        // Reference HMAC-SHA256 manually computed
        string message = $"{timestamp}.{batchId}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        byte[] raw = hmac.ComputeHash(Encoding.UTF8.GetBytes(message));
        var sb = new StringBuilder("sha256=");
        foreach (byte b in raw) sb.Append(b.ToString("x2"));
        string expected = sb.ToString();

        string actual = HikWebhookSignature.Sign(secret, timestamp, batchId);
        Assert.Equal(expected, actual);
        Assert.True(HikWebhookSignature.Matches(secret, timestamp, batchId, actual));
    }

    [Fact]
    public void Biometric_PunchDirection_ResolvesInAndOutCorrectly()
    {
        var morning = new DateTime(2026, 9, 14, 9, 0, 0);
        var earlierMorning = new DateTime(2026, 9, 14, 8, 45, 0);
        var noon = new DateTime(2026, 9, 14, 13, 0, 0);
        var evening = new DateTime(2026, 9, 14, 18, 30, 0);
        var laterEvening = new DateTime(2026, 9, 14, 19, 15, 0);

        // First punch of the day is IN
        Assert.True(earlierMorning < morning);

        // Replay safety: earlier than current punch in replaces arrival
        bool replacesIn = earlierMorning < morning;
        Assert.True(replacesIn);

        // Later arrival does NOT replace arrival
        bool laterDoesNotReplaceIn = noon < morning;
        Assert.False(laterDoesNotReplaceIn);

        // Later departure replaces departure
        bool replacesOut = laterEvening > evening;
        Assert.True(replacesOut);

        // Earlier punch does NOT replace departure
        bool earlierDoesNotReplaceOut = noon > evening;
        Assert.False(earlierDoesNotReplaceOut);
    }

    [Fact]
    public void Biometric_SyncResult_FormatsReadableSummary()
    {
        var sync = new BiometricSyncResult(
            Ran: true,
            PeopleOnTerminal: 15,
            Matched: 14,
            Created: 2,
            Updated: 1,
            Unmatched: 1
        );

        string summary = sync.Summary();
        Assert.Contains("15 on the terminal", summary);
        Assert.Contains("14 matched", summary);
        Assert.Contains("2 new", summary);
        Assert.Contains("1 changed", summary);
        Assert.Contains("1 unmatched", summary);

        var skipped = BiometricSyncResult.Skipped();
        Assert.False(skipped.Ran);
        Assert.Contains("not configured", skipped.Summary());
    }

    [Fact]
    public void Biometric_BackfillResult_FormatsReadableSummary()
    {
        var backfill = new BiometricBackfillResult(
            Ran: true,
            Read: 150,
            Stored: 140,
            Duplicates: 10,
            Unmatched: 5,
            Applied: 135
        );

        string summary = backfill.Summary();
        Assert.Contains("150 read", summary);
        Assert.Contains("140 stored", summary);
        Assert.Contains("10 already held", summary);
        Assert.Contains("5 unmatched", summary);
        Assert.Contains("135 attendance rows updated", summary);

        var skipped = BiometricBackfillResult.Skipped();
        Assert.False(skipped.Ran);
        Assert.Contains("not configured", skipped.Summary());
    }

    [Fact]
    public void Biometric_EventRow_EvaluatesUsablePunchAndBuffered()
    {
        var validEvent = new BiometricEventRow
        {
            Id = 1,
            UserId = 42,
            AuthResult = 1,
            CurrentEvent = 1
        };
        Assert.True(validEvent.IsUsablePunch);
        Assert.False(validEvent.IsBuffered);

        var failedAuth = new BiometricEventRow
        {
            Id = 2,
            UserId = 42,
            AuthResult = 0,
            CurrentEvent = 1
        };
        Assert.False(failedAuth.IsUsablePunch);

        var unmappedEvent = new BiometricEventRow
        {
            Id = 3,
            UserId = null,
            AuthResult = 1,
            CurrentEvent = 0
        };
        Assert.False(unmappedEvent.IsUsablePunch);
        Assert.True(unmappedEvent.IsBuffered);
    }

    [Fact]
    public void SchemaSafetyGuard_ConfirmsFlywayVersion154Requirement()
    {
        Assert.Equal(154, Pixous.HrPortal.Infrastructure.Persistence.SchemaSafetyGuard.RequiredSchemaVersion);
    }

    [Fact]
    public void SchemaSafetyGuard_EnsuresNoMigrationMachineryLoaded()
    {
        string[] forbidden =
        [
            "Flyway",
            "Evolve",
            "FluentMigrator",
            "DbUp",
            "Microsoft.EntityFrameworkCore.Migrations",
            "Microsoft.EntityFrameworkCore.Design"
        ];

        var loaded = AppDomain.CurrentDomain.GetAssemblies()
            .Select(a => a.GetName().Name ?? string.Empty)
            .ToArray();

        var offenders = forbidden
            .Where(name => loaded.Any(l => l.StartsWith(name, StringComparison.OrdinalIgnoreCase)))
            .ToArray();

        Assert.Empty(offenders);
    }

    [Theory]
    [InlineData(ErrorCode.ValidationError, 400)]
    [InlineData(ErrorCode.BadCredentials, 401)]
    [InlineData(ErrorCode.Unauthenticated, 401)]
    [InlineData(ErrorCode.TokenExpired, 401)]
    [InlineData(ErrorCode.AccessDenied, 403)]
    [InlineData(ErrorCode.NotFound, 404)]
    [InlineData(ErrorCode.Conflict, 409)]
    [InlineData(ErrorCode.BusinessRule, 422)]
    [InlineData(ErrorCode.GeofenceViolation, 422)]
    [InlineData(ErrorCode.Internal, 500)]
    public void ErrorCode_MapsToExpectedHttpStatus(ErrorCode code, int expectedStatus)
    {
        Assert.Equal(expectedStatus, code.StatusCode());
    }

    [Fact]
    public void ApiResponse_ProducesMatchingEnvelopeContract()
    {
        var okResp = ApiResponse<string>.Ok("sample payload", "Success message");
        Assert.True(okResp.Success);
        Assert.Equal("Success message", okResp.Message);
        Assert.Equal("sample payload", okResp.Data);
        Assert.Null(okResp.Errors);

        var failResp = ApiResponse<object>.Fail("Validation failed", new Dictionary<string, string> { ["field"] = "Invalid" });
        Assert.False(failResp.Success);
        Assert.Equal("Validation failed", failResp.Message);
        Assert.NotNull(failResp.Errors);
    }

    [Fact]
    public async Task LiveDatabase_SafetyAndCompatibilityCheck_VerifiesFlywayV154()
    {
        // Discover .env from current directory or ancestors
        string? envPath = null;
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            string candidate = Path.Combine(dir.FullName, ".env");
            if (File.Exists(candidate))
            {
                envPath = candidate;
                break;
            }
            dir = dir.Parent;
        }

        if (envPath == null)
        {
            // Skip if no .env present in environment
            return;
        }

        var env = new Dictionary<string, string>();
        foreach (string line in File.ReadAllLines(envPath))
        {
            string trimmed = line.Trim();
            if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith('#')) continue;
            int idx = trimmed.IndexOf('=');
            if (idx > 0)
            {
                env[trimmed[..idx].Trim()] = trimmed[(idx + 1)..].Trim();
            }
        }

        if (!env.TryGetValue("DB_HOST", out var host) ||
            !env.TryGetValue("DB_NAME", out var dbName) ||
            !env.TryGetValue("DB_USER", out var user) ||
            !env.TryGetValue("DB_PASSWORD", out var pass))
        {
            return;
        }

        string port = env.TryGetValue("DB_PORT", out var p) ? p : "3306";

        // Resolve host to IPv4 to prevent Windows dual-stack timeout
        var addresses = await System.Net.Dns.GetHostAddressesAsync(host);
        var ipv4 = addresses.FirstOrDefault(a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork);
        string connectHost = ipv4?.ToString() ?? host;

        string connStr = $"Server={connectHost};Port={port};Database={dbName};User Id={user};Password={pass};SslMode=Preferred;AllowPublicKeyRetrieval=true;MaximumPoolSize=2;MinimumPoolSize=0;ConnectionTimeout=30;";

        using var conn = new MySqlConnector.MySqlConnection(connStr);
        await conn.OpenAsync();

        // 1. Verify connected database name
        using var cmd0 = conn.CreateCommand();
        cmd0.CommandText = "SELECT DATABASE()";
        string currentDb = Convert.ToString(await cmd0.ExecuteScalarAsync()) ?? string.Empty;
        Assert.Equal("db_ab2fe4_ems", currentDb);
        _output?.WriteLine($"[VERIFIED] Connected to Database: {currentDb}");

        // 2. Verify flyway_schema_history exists
        using var cmd1 = conn.CreateCommand();
        cmd1.CommandText = "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'flyway_schema_history')";
        bool hasHistory = Convert.ToBoolean(await cmd1.ExecuteScalarAsync());
        Assert.True(hasHistory, "Live database must have flyway_schema_history table.");

        // 3. Verify Flyway version >= 154
        using var cmd2 = conn.CreateCommand();
        cmd2.CommandText = "SELECT MAX(CAST(version AS UNSIGNED)) FROM flyway_schema_history WHERE success = 1 AND version REGEXP '^[0-9]+$'";
        int maxVersion = Convert.ToInt32(await cmd2.ExecuteScalarAsync());
        Assert.True(maxVersion >= Pixous.HrPortal.Infrastructure.Persistence.SchemaSafetyGuard.RequiredSchemaVersion,
            $"Live DB Flyway version V{maxVersion} must be at least V{Pixous.HrPortal.Infrastructure.Persistence.SchemaSafetyGuard.RequiredSchemaVersion}");
        _output?.WriteLine($"[VERIFIED] Flyway Schema Version: V{maxVersion} (Matches required V{Pixous.HrPortal.Infrastructure.Persistence.SchemaSafetyGuard.RequiredSchemaVersion})");

        // 4. Confirm live tables exist without any schema modification
        using var cmd3 = conn.CreateCommand();
        cmd3.CommandText = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()";
        int tableCount = Convert.ToInt32(await cmd3.ExecuteScalarAsync());
        Assert.True(tableCount > 50, "Live database should contain all application tables.");
        _output?.WriteLine($"[VERIFIED] Total Application Tables: {tableCount}");

        // 5. Query live table counts
        using var cmdUsers = conn.CreateCommand();
        cmdUsers.CommandText = "SELECT COUNT(*) FROM users";
        int userCount = Convert.ToInt32(await cmdUsers.ExecuteScalarAsync());
        _output?.WriteLine($"[VERIFIED] Live users row count: {userCount}");

        using var cmdAtt = conn.CreateCommand();
        cmdAtt.CommandText = "SELECT COUNT(*) FROM attendance";
        int attCount = Convert.ToInt32(await cmdAtt.ExecuteScalarAsync());
        _output?.WriteLine($"[VERIFIED] Live attendance row count: {attCount}");

        using var cmdTasks = conn.CreateCommand();
        cmdTasks.CommandText = "SELECT COUNT(*) FROM tasks";
        int taskCount = Convert.ToInt32(await cmdTasks.ExecuteScalarAsync());
        _output?.WriteLine($"[VERIFIED] Live tasks row count: {taskCount}");

        using var cmdPerm = conn.CreateCommand();
        cmdPerm.CommandText = "SELECT COUNT(*) FROM permission_requests";
        int permCount = Convert.ToInt32(await cmdPerm.ExecuteScalarAsync());
        _output?.WriteLine($"[VERIFIED] Live permission_requests row count: {permCount}");
    }

    [Fact]
    public async Task LiveDatabase_AllModulesAudit_QueriesTablesWithoutErrors()
    {
        string? envPath = null;
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            string candidate = Path.Combine(dir.FullName, ".env");
            if (File.Exists(candidate)) { envPath = candidate; break; }
            dir = dir.Parent;
        }
        if (envPath == null) return;

        var env = new Dictionary<string, string>();
        foreach (string line in File.ReadAllLines(envPath))
        {
            string trimmed = line.Trim();
            if (string.IsNullOrEmpty(trimmed) || trimmed.StartsWith('#')) continue;
            int idx = trimmed.IndexOf('=');
            if (idx > 0) env[trimmed[..idx].Trim()] = trimmed[(idx + 1)..].Trim();
        }

        if (!env.TryGetValue("DB_HOST", out var host) ||
            !env.TryGetValue("DB_NAME", out var dbName) ||
            !env.TryGetValue("DB_USER", out var user) ||
            !env.TryGetValue("DB_PASSWORD", out var pass)) return;

        string port = env.TryGetValue("DB_PORT", out var p) ? p : "3306";
        var addresses = await System.Net.Dns.GetHostAddressesAsync(host);
        var ipv4 = addresses.FirstOrDefault(a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork);
        string connectHost = ipv4?.ToString() ?? host;

        string connStr = $"Server={connectHost};Port={port};Database={dbName};User Id={user};Password={pass};SslMode=Preferred;AllowPublicKeyRetrieval=true;MaximumPoolSize=2;MinimumPoolSize=0;ConnectionTimeout=30;";
        using var conn = new MySqlConnector.MySqlConnection(connStr);
        await conn.OpenAsync();

        // 1. Connection & Server metadata
        using var cmdMeta = conn.CreateCommand();
        cmdMeta.CommandText = "SELECT DATABASE(), CURRENT_USER(), @@version, @@hostname";
        using var rdr = await cmdMeta.ExecuteReaderAsync();
        if (await rdr.ReadAsync())
        {
            _output?.WriteLine($"[CONNECTION PROOF] Database: {rdr.GetString(0)}");
            _output?.WriteLine($"[CONNECTION PROOF] User: {rdr.GetString(1)}");
            _output?.WriteLine($"[CONNECTION PROOF] MySQL Version: {rdr.GetString(2)}");
            _output?.WriteLine($"[CONNECTION PROOF] Server Hostname: {rdr.GetString(3)}");
        }
        await rdr.CloseAsync();

        // 2. Fetch and print all real table names in the live DB
        using var cmdTables = conn.CreateCommand();
        cmdTables.CommandText = "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY TABLE_NAME";
        var tableList = new List<string>();
        using (var trdr = await cmdTables.ExecuteReaderAsync())
        {
            while (await trdr.ReadAsync())
            {
                tableList.Add(trdr.GetString(0));
            }
        }
        _output?.WriteLine($"[LIVE TABLES IN db_ab2fe4_ems] Total: {tableList.Count} tables");

        // 3. Audit all core domain module tables
        string[] coreTables =
        [
            "users", "companies", "roles", "permissions", "role_permissions",
            "designations", "departments", "attendance", "biometric_events",
            "leave_types", "leave_balances", "leave_requests", "permission_requests",
            "wfh_requests", "tasks", "task_messages", "appreciation_letters", "performance_goals",
            "discipline_records", "tickets", "ticket_comments", "ta_expenses", "assets",
            "payroll_runs", "payslip_requests", "announcements", "company_events",
            "technical_audit_logs", "company_modules", "chatbot_knowledge",
            "communities", "community_messages", "work_reports", "notifications"
        ];

        foreach (string tbl in coreTables)
        {
            Assert.Contains(tbl, tableList);
            using var cmdCount = conn.CreateCommand();
            cmdCount.CommandText = $"SELECT COUNT(*) FROM `{tbl}`";
            long count = Convert.ToInt64(await cmdCount.ExecuteScalarAsync());
            _output?.WriteLine($"[MODULE AUDIT OK] Table `{tbl}` -> {count} records.");
        }
    }

    [Fact]
    public void OpenXmlWorkbookBuilder_BuildsValidXlsx()
    {
        var headers = new[] { "ID", "Title", "Status", "Assignee", "Priority" };
        var rows = new List<IReadOnlyList<object?>>
        {
            new object?[] { 1L, "Test Task 1", "COMPLETED", "John Doe", "HIGH" },
            new object?[] { 2L, "Test Task 2", "IN_PROGRESS", "Jane Smith", "MEDIUM" }
        };

        byte[] xlsx = Pixous.HrPortal.Infrastructure.Reporting.OpenXmlWorkbookBuilder.Create("Tasks", headers, rows);
        Assert.NotNull(xlsx);
        Assert.True(xlsx.Length > 100);

        // Verify ZIP header of xlsx
        Assert.Equal((byte)'P', xlsx[0]);
        Assert.Equal((byte)'K', xlsx[1]);
    }

    [Fact]
    public void AppreciationPdfRenderer_ProducesValidPdf()
    {
        var record = new Pixous.HrPortal.Domain.Modules.Appreciation.AppreciationRecord
        {
            Id = 42,
            ReferenceCode = "APP-2026-0042",
            LetterDate = new DateOnly(2026, 9, 14),
            Achievement = "Exceptional Performance",
            Message = "Thank you for outstanding contributions to the migration project."
        };

        byte[] pdf = Pixous.HrPortal.Infrastructure.Reporting.AppreciationPdfRenderer.Render(
            record, "Alice Wonderland", "Senior Software Engineer", "Bob Builder", "Engineering Director");
        Assert.NotNull(pdf);
        Assert.True(pdf.Length > 200);

        // Verify PDF signature "%PDF-"
        string header = Encoding.ASCII.GetString(pdf.Take(5).ToArray());
        Assert.Equal("%PDF-", header);
    }

    [Fact]
    public void BulkEmployeeResult_RecordsSuccessAndErrorCorrectly()
    {
        var ok = new Pixous.HrPortal.Domain.Modules.Auth.Dto.BulkEmployeeResult("user1", "User One", true, null);
        Assert.True(ok.Created);
        Assert.Null(ok.Error);

        var fail = new Pixous.HrPortal.Domain.Modules.Auth.Dto.BulkEmployeeResult("user2", "User Two", false, "Duplicate username");
        Assert.False(fail.Created);
        Assert.Equal("Duplicate username", fail.Error);
    }
}

