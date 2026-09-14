using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Dapper;
using Pixous.HrPortal.Domain.Modules.Admin;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Admin;

/// <summary>
/// Dapper-backed implementation of company management for technical admins.
/// Ported from com.pixous.hrportal.modules.admin.CompanyService.
/// </summary>
public sealed class TechnicalAdminCompanyBal : DalBase, ITechnicalAdminCompanyBal
{
    private const string Characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    private const string SelectColumns = """
        c.id                  AS Id,
        c.company_id          AS CompanyId,
        c.company_name        AS CompanyName,
        c.code                AS Code,
        c.legal_name          AS LegalName,
        c.email               AS Email,
        c.phone               AS Phone,
        c.website             AS Website,
        c.address             AS Address,
        c.country             AS Country,
        c.state               AS State,
        c.city                AS City,
        c.timezone            AS Timezone,
        c.currency            AS Currency,
        c.date_format         AS DateFormat,
        c.language            AS Language,
        c.industry            AS Industry,
        c.organization_type   AS OrganizationType,
        (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS EmployeeCount,
        c.status              AS Status,
        c.logo_path           AS LogoPath,
        c.primary_color       AS PrimaryColor,
        c.secondary_color     AS SecondaryColor,
        c.created_at          AS CreatedAt,
        c.updated_at          AS UpdatedAt
        """;

    public TechnicalAdminCompanyBal(IDbConnectionFactory connectionFactory)
        : base(connectionFactory)
    {
    }

    public async Task<IReadOnlyList<CompanyResponse>> GetAllAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<CompanyResponse>(
            new CommandDefinition(
                $"SELECT {SelectColumns} FROM companies c ORDER BY c.id",
                cancellationToken: ct)), ct)).AsList();

    public Task<CompanyResponse?> GetByIdAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<CompanyResponse>(
            new CommandDefinition(
                $"SELECT {SelectColumns} FROM companies c WHERE c.id = @id",
                new { id },
                cancellationToken: ct)), ct);

    public async Task<CompanyResponse> CreateAsync(CreateCompanyRequest request, CancellationToken ct = default)
    {
        string companyId = string.IsNullOrWhiteSpace(request.CompanyId)
            ? await GenerateUniqueCompanyIdAsync(request.CompanyName, ct)
            : request.CompanyId.Trim();

        string code = string.IsNullOrWhiteSpace(request.Code)
            ? companyId
            : request.Code.Trim();

        string status = string.IsNullOrWhiteSpace(request.Status) ? "ACTIVE" : request.Status.Trim();

        long newId = await QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition("""
                INSERT INTO companies (
                    company_id, company_name, code, legal_name, email, phone, website, address,
                    country, state, city, timezone, currency, date_format, language, industry,
                    organization_type, employee_count, status, logo_path, primary_color, secondary_color,
                    created_at, updated_at
                ) VALUES (
                    @companyId, @companyName, @code, @legalName, @email, @phone, @website, @address,
                    @country, @state, @city, @timezone, @currency, @dateFormat, @language, @industry,
                    @organizationType, @employeeCount, @status, @logoPath, @primaryColor, @secondaryColor,
                    NOW(), NOW()
                );
                SELECT LAST_INSERT_ID();
                """,
                new
                {
                    companyId,
                    companyName = request.CompanyName?.Trim() ?? string.Empty,
                    code,
                    legalName = request.LegalName?.Trim(),
                    email = request.Email?.Trim(),
                    phone = request.Phone?.Trim(),
                    website = request.Website?.Trim(),
                    address = request.Address?.Trim(),
                    country = request.Country?.Trim(),
                    state = request.State?.Trim(),
                    city = request.City?.Trim(),
                    timezone = request.Timezone?.Trim(),
                    currency = request.Currency?.Trim(),
                    dateFormat = request.DateFormat?.Trim(),
                    language = request.Language?.Trim(),
                    industry = request.Industry?.Trim(),
                    organizationType = request.OrganizationType?.Trim(),
                    employeeCount = request.EmployeeCount,
                    status,
                    logoPath = request.LogoPath?.Trim(),
                    primaryColor = request.PrimaryColor?.Trim(),
                    secondaryColor = request.SecondaryColor?.Trim()
                },
                cancellationToken: ct)), ct);

        return (await GetByIdAsync(newId, ct))
            ?? throw new InvalidOperationException("Failed to retrieve created company");
    }

    public async Task<CompanyResponse> UpdateAsync(long id, UpdateCompanyRequest request, CancellationToken ct = default)
    {
        CompanyResponse existing = await GetByIdAsync(id, ct)
            ?? throw new KeyNotFoundException("Company not found");

        await QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("""
                UPDATE companies SET
                    company_name      = COALESCE(@companyName, company_name),
                    legal_name        = @legalName,
                    email             = @email,
                    phone             = @phone,
                    website           = @website,
                    address           = @address,
                    country           = @country,
                    state             = @state,
                    city              = @city,
                    timezone          = @timezone,
                    currency          = @currency,
                    date_format       = @dateFormat,
                    language          = @language,
                    industry          = @industry,
                    organization_type = @organizationType,
                    employee_count    = @employeeCount,
                    status            = COALESCE(@status, status),
                    logo_path         = @logoPath,
                    primary_color     = @primaryColor,
                    secondary_color   = @secondaryColor,
                    updated_at        = NOW()
                WHERE id = @id
                """,
                new
                {
                    id,
                    companyName = request.CompanyName?.Trim(),
                    legalName = request.LegalName?.Trim(),
                    email = request.Email?.Trim(),
                    phone = request.Phone?.Trim(),
                    website = request.Website?.Trim(),
                    address = request.Address?.Trim(),
                    country = request.Country?.Trim(),
                    state = request.State?.Trim(),
                    city = request.City?.Trim(),
                    timezone = request.Timezone?.Trim(),
                    currency = request.Currency?.Trim(),
                    dateFormat = request.DateFormat?.Trim(),
                    language = request.Language?.Trim(),
                    industry = request.Industry?.Trim(),
                    organizationType = request.OrganizationType?.Trim(),
                    employeeCount = request.EmployeeCount,
                    status = request.Status?.Trim(),
                    logoPath = request.LogoPath?.Trim(),
                    primaryColor = request.PrimaryColor?.Trim(),
                    secondaryColor = request.SecondaryColor?.Trim()
                },
                cancellationToken: ct)), ct);

        return (await GetByIdAsync(id, ct))
            ?? throw new KeyNotFoundException("Company not found");
    }

    public Task DeleteAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition(
                "DELETE FROM companies WHERE id = @id",
                new { id },
                cancellationToken: ct)), ct);

    public async Task SuspendAsync(long id, CancellationToken ct = default)
    {
        int affected = await QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition(
                "UPDATE companies SET status = 'SUSPENDED', updated_at = NOW() WHERE id = @id",
                new { id },
                cancellationToken: ct)), ct);

        if (affected == 0)
        {
            throw new KeyNotFoundException("Company not found");
        }
    }

    private async Task<string> GenerateUniqueCompanyIdAsync(string? companyName, CancellationToken ct)
    {
        string prefix = !string.IsNullOrWhiteSpace(companyName)
            ? Regex.Replace(companyName, "[^A-Za-z0-9]", "").ToUpperInvariant()
            : "COMP";

        if (prefix.Length > 6)
        {
            prefix = prefix[..6];
        }
        else if (prefix.Length < 3)
        {
            prefix = (prefix + "XXX")[..3];
        }

        int attempts = 0;
        while (attempts < 10)
        {
            attempts++;
            string suffix = GenerateRandomString(6);
            string candidate = $"{prefix}-{suffix}";

            int count = await QueryAsync(conn => conn.ExecuteScalarAsync<int>(
                new CommandDefinition(
                    "SELECT COUNT(*) FROM companies WHERE company_id = @candidate",
                    new { candidate },
                    cancellationToken: ct)), ct);

            if (count == 0)
            {
                return candidate;
            }
        }

        throw new InvalidOperationException("Could not generate a unique Company ID");
    }

    private static string GenerateRandomString(int length)
    {
        char[] chars = new char[length];
        byte[] randomBytes = new byte[length];
        RandomNumberGenerator.Fill(randomBytes);
        for (int i = 0; i < length; i++)
        {
            chars[i] = Characters[randomBytes[i] % Characters.Length];
        }
        return new string(chars);
    }
}
