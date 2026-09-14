using System.Text;
using Dapper;
using Pixous.HrPortal.Domain.Modules.Chatbot;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Chatbot;

public sealed class ChatbotDal : DalBase, IChatbotDal
{
    public ChatbotDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    public Task<string?> GetSettingAsync(string key, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<string>(
            new CommandDefinition("""
                SELECT setting_value FROM system_settings WHERE setting_key = @key LIMIT 1
                """, new { key }, cancellationToken: ct)), ct);

    public Task SetSettingAsync(string key, string value, string? description, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("""
                INSERT INTO system_settings (setting_key, setting_value, description)
                VALUES (@key, @value, @description)
                ON DUPLICATE KEY UPDATE setting_value = @value
                """, new { key, value, description }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<ChatbotKnowledgeRow>> FindAllKnowledgeAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<ChatbotKnowledgeRow>(
            new CommandDefinition("""
                SELECT id AS Id, source AS Source, title AS Title, content AS Content,
                       enabled AS Enabled, created_at AS CreatedAt, updated_at AS UpdatedAt
                FROM chatbot_knowledge
                ORDER BY id ASC
                """, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<ChatbotKnowledgeRow>> FindEnabledKnowledgeAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<ChatbotKnowledgeRow>(
            new CommandDefinition("""
                SELECT id AS Id, source AS Source, title AS Title, content AS Content,
                       enabled AS Enabled, created_at AS CreatedAt, updated_at AS UpdatedAt
                FROM chatbot_knowledge
                WHERE enabled = 1
                ORDER BY id ASC
                """, cancellationToken: ct)), ct)).AsList();

    public Task<long> InsertKnowledgeAsync(ChatbotKnowledgeRow row, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            row.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO chatbot_knowledge (source, title, content, enabled)
                VALUES (@Source, @Title, @Content, @Enabled);
                SELECT LAST_INSERT_ID();
                """, row, cancellationToken: ct));
            return row.Id;
        }, ct);

    public Task DeleteKnowledgeAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            DELETE FROM chatbot_knowledge WHERE id = @id
            """, new { id }, cancellationToken: ct)), ct);

    public async Task<string> GetLiveOrgContextAsync(CancellationToken ct = default)
    {
        try
        {
            int headcount = await QueryAsync(conn => conn.ExecuteScalarAsync<int>(
                new CommandDefinition("SELECT COUNT(*) FROM users WHERE enabled = 1", cancellationToken: ct)), ct);

            int present = await QueryAsync(conn => conn.ExecuteScalarAsync<int>(
                new CommandDefinition("""
                    SELECT COUNT(DISTINCT user_id) FROM attendance
                    WHERE work_date = CURDATE() AND punch_in_at IS NOT NULL
                    """, cancellationToken: ct)), ct);

            int absent = Math.Max(0, headcount - present);

            int pendingLeave = await QueryAsync(conn => conn.ExecuteScalarAsync<int>(
                new CommandDefinition("SELECT COUNT(*) FROM leave_requests WHERE status = 'PENDING'", cancellationToken: ct)), ct);

            int openTickets = await QueryAsync(conn => conn.ExecuteScalarAsync<int>(
                new CommandDefinition("SELECT COUNT(*) FROM helpdesk_tickets WHERE status <> 'CLOSED'", cancellationToken: ct)), ct);

            var teams = await QueryAsync(conn => conn.QueryAsync<(string Designation, string Name, string Code)>(
                new CommandDefinition("""
                    SELECT d.name AS Designation, u.name AS Name, COALESCE(u.employee_code, '-') AS Code
                    FROM users u
                    JOIN designations d ON d.id = u.designation_id
                    WHERE u.enabled = 1
                    ORDER BY d.name, u.name
                    """, cancellationToken: ct)), ct);

            var sb = new StringBuilder();
            sb.AppendLine($"\n=== LIVE ORG DATA (as of {DateTime.Today:yyyy-MM-dd}) ===");
            sb.AppendLine("These are real, current numbers from the database. Use them verbatim when the user asks about current attendance, headcount, approvals, tickets or team members.");
            sb.AppendLine($"Total active employees: {headcount}");
            sb.AppendLine($"Present today (punched in): {present}");
            sb.AppendLine($"Absent today (no punch-in): {absent}");
            sb.AppendLine($"Pending leave approvals: {pendingLeave}");
            sb.AppendLine($"Open tickets: {openTickets}\n");

            var grouped = teams.GroupBy(t => t.Designation);
            sb.AppendLine("TEAMS (a team = a designation; here are the members of each):");
            foreach (var g in grouped)
            {
                var members = g.Select(m => $"{m.Name} ({m.Code})");
                sb.AppendLine($"- {g.Key} ({g.Count()} members): {string.Join(", ", members)}");
            }

            return sb.ToString();
        }
        catch
        {
            return string.Empty;
        }
    }

    public async Task<string> GetPeopleMentionedContextAsync(string question, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(question)) return string.Empty;

        try
        {
            var users = (await QueryAsync(conn => conn.QueryAsync<(long Id, string Name, string? Code, string? Designation)>(
                new CommandDefinition("""
                    SELECT u.id AS Id, u.name AS Name, u.employee_code AS Code, u.designation_title AS Designation
                    FROM users u
                    WHERE u.enabled = 1
                    """, cancellationToken: ct)), ct)).ToList();

            string q = question.ToLowerInvariant();
            var named = users.Where(u =>
                (!string.IsNullOrWhiteSpace(u.Name) && q.Contains(u.Name.ToLowerInvariant())) ||
                (!string.IsNullOrWhiteSpace(u.Code) && q.Contains(u.Code.ToLowerInvariant()))
            ).Take(3).ToList();

            if (named.Count == 0) return string.Empty;

            var sb = new StringBuilder();
            sb.AppendLine("\n=== INDIVIDUAL RECORDS FOR MENTIONED EMPLOYEES ===");

            foreach (var u in named)
            {
                var attendance = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<(DateTime? InTime, DateTime? OutTime)>(
                    new CommandDefinition("""
                        SELECT punch_in_at AS InTime, punch_out_at AS OutTime
                        FROM attendance
                        WHERE user_id = @Id AND work_date = CURDATE()
                        LIMIT 1
                        """, new { u.Id }, cancellationToken: ct)), ct);

                string attStatus = attendance.InTime.HasValue ? $"Present today (punched in at {attendance.InTime:HH:mm})" : "Absent / Not punched in today";

                int pendingLeaves = await QueryAsync(conn => conn.ExecuteScalarAsync<int>(
                    new CommandDefinition("""
                        SELECT COUNT(*) FROM leave_requests WHERE user_id = @Id AND status = 'PENDING'
                        """, new { u.Id }, cancellationToken: ct)), ct);

                sb.AppendLine($"- {u.Name} ({u.Code ?? "-"}, {u.Designation ?? "No designation"}): {attStatus}. Pending leave requests: {pendingLeaves}.");
            }

            return sb.ToString();
        }
        catch
        {
            return string.Empty;
        }
    }

    public async Task<string?> GetDirectAnswerAsync(string question, string lang, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(question)) return null;

        string q = question.ToLowerInvariant();
        bool isAbsent = q.Contains("absent") || q.Contains("வருகை இல்லை") || q.Contains("अनुपस्थित");
        bool isPresent = (q.Contains("present") || q.Contains("punched in") || q.Contains("வந்தவர்கள்")) && !isAbsent;
        bool isLeave = q.Contains("pending leave") || q.Contains("விடுப்பு விண்ணப்பங்கள்");

        try
        {
            if (isAbsent)
            {
                var absentUsers = (await QueryAsync(conn => conn.QueryAsync<string>(
                    new CommandDefinition("""
                        SELECT u.name
                        FROM users u
                        WHERE u.enabled = 1
                          AND NOT EXISTS (
                              SELECT 1 FROM attendance a
                              WHERE a.user_id = u.id AND a.work_date = CURDATE() AND a.punch_in_at IS NOT NULL
                          )
                        ORDER BY u.name
                        """, cancellationToken: ct)), ct)).ToList();

                string list = absentUsers.Count == 0 ? "None" : string.Join(", ", absentUsers);
                return lang switch
                {
                    "ta" => $"இன்று வருகை தராதவர்கள் ({absentUsers.Count} பேர்): {list}",
                    "hi" => $"आज अनुपस्थित कर्मचारी ({absentUsers.Count}): {list}",
                    _ => $"Employees absent today ({absentUsers.Count}): {list}"
                };
            }

            if (isPresent)
            {
                int presentCount = await QueryAsync(conn => conn.ExecuteScalarAsync<int>(
                    new CommandDefinition("""
                        SELECT COUNT(DISTINCT user_id) FROM attendance
                        WHERE work_date = CURDATE() AND punch_in_at IS NOT NULL
                        """, cancellationToken: ct)), ct);

                return lang switch
                {
                    "ta" => $"இன்று பணிக்கு வந்துள்ளவர்கள்: {presentCount} பேர்.",
                    "hi" => $"आज उपस्थित कर्मचारी: {presentCount}",
                    _ => $"Employees present today: {presentCount}."
                };
            }

            if (isLeave)
            {
                int pendingCount = await QueryAsync(conn => conn.ExecuteScalarAsync<int>(
                    new CommandDefinition("SELECT COUNT(*) FROM leave_requests WHERE status = 'PENDING'", cancellationToken: ct)), ct);

                return lang switch
                {
                    "ta" => $"நிலுவையில் உள்ள விடுப்பு விண்ணப்பங்கள்: {pendingCount}.",
                    "hi" => $"लंबित छुट्टी के आवेदन: {pendingCount}",
                    _ => $"Pending leave requests awaiting approval: {pendingCount}."
                };
            }
        }
        catch
        {
            // fallback
        }

        return null;
    }

    public async Task<IReadOnlySet<string>> GetEnabledModulesAsync(long? companyId, CancellationToken ct = default)
    {
        if (!companyId.HasValue) return new HashSet<string>();

        try
        {
            var codes = await QueryAsync(conn => conn.QueryAsync<string>(
                new CommandDefinition("""
                    SELECT module_code FROM company_modules
                    WHERE company_id = @companyId AND is_enabled = 1
                    """, new { companyId = companyId.Value }, cancellationToken: ct)), ct);

            return new HashSet<string>(codes.Select(c => c.Trim().ToUpperInvariant()), StringComparer.Ordinal);
        }
        catch
        {
            return new HashSet<string>();
        }
    }
}
