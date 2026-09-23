using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.Authorization;
using Dapper;
using Pixous.HrPortal.Api.Middleware;
using Pixous.HrPortal.Api.RealTime;
using Pixous.HrPortal.Api.Security;
using Pixous.HrPortal.Api.Serialization;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Security;
using Pixous.HrPortal.Infrastructure;
using Pixous.HrPortal.Infrastructure.Configuration;
using Pixous.HrPortal.Infrastructure.Persistence;
using Pixous.HrPortal.Infrastructure.Security;

var builder = WebApplication.CreateBuilder(args);

// Explicitly load appsettings.json
builder.Configuration
    .SetBasePath(builder.Environment.ContentRootPath)
    .AddJsonFile(
        "appsettings.json",
        optional: false,
        reloadOnChange: true)
    .AddJsonFile(
        $"appsettings.{builder.Environment.EnvironmentName}.json",
        optional: true,
        reloadOnChange: true)
    .AddEnvironmentVariables();

var connectionString =
    builder.Configuration.GetConnectionString("HrPortal")
    ?? builder.Configuration["ConnectionStrings:HrPortal"];

if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException(
        $"Connection string 'HrPortal' was not found. " +
        $"ContentRoot: {builder.Environment.ContentRootPath}");
}

var jwtSecret = builder.Configuration["App:Jwt:Secret"];

if (string.IsNullOrWhiteSpace(jwtSecret))
{
    throw new InvalidOperationException(
        "App:Jwt:Secret is missing from appsettings.json.");
}

var jwtIssuer = builder.Configuration["App:Jwt:Issuer"];

if (string.IsNullOrWhiteSpace(jwtIssuer))
{
    throw new InvalidOperationException(
        "App:Jwt:Issuer is missing from appsettings.json.");
}

// ============================================================================
// INFRASTRUCTURE
// ============================================================================

builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddMemoryCache();

// ============================================================================
// JSON
// ============================================================================

builder.Services
    .AddControllers(options =>
    {
        // Match Spring/Jackson content-type behaviour.
        options.ReturnHttpNotAcceptable = true;
    })
    .AddJsonOptions(options =>
    {
        // Java/Jackson camelCase compatibility.
        options.JsonSerializerOptions.PropertyNamingPolicy =
            JsonNamingPolicy.CamelCase;

        // Ignore null values.
        options.JsonSerializerOptions.DefaultIgnoreCondition =
            JsonIgnoreCondition.WhenWritingNull;

        // Serialize enums by name instead of integer value.
        options.JsonSerializerOptions.Converters.Add(
            new JsonStringEnumConverter());

        // Preserve Java LocalDateTime-style serialization.
        options.JsonSerializerOptions.Converters.Add(
            new LocalDateTimeConverter());

        options.JsonSerializerOptions.Converters.Add(
            new NullableLocalDateTimeConverter());
    });

// ============================================================================
// MODEL VALIDATION
// ============================================================================

builder.Services.Configure<ApiBehaviorOptions>(options =>
{
    options.InvalidModelStateResponseFactory = context =>
    {
        var fieldErrors = new Dictionary<string, string>();

        foreach ((string field, var entry) in context.ModelState)
        {
            if (entry.Errors.Count == 0)
            {
                continue;
            }

            string message = entry.Errors[0].ErrorMessage;

            if (string.IsNullOrWhiteSpace(message))
            {
                message = "Invalid value";
            }

            // Convert property name to camelCase.
            string name = string.IsNullOrEmpty(field)
                ? field
                : char.ToLowerInvariant(field[0]) + field[1..];

            fieldErrors.TryAdd(name, message);
        }

        var body = ApiResponse.Fail(
            "Validation failed",
            fieldErrors);

        return new BadRequestObjectResult(body);
    };
});

// ============================================================================
// AUTHENTICATION
// ============================================================================

builder.Services
    .AddOptions<JwtBearerOptions>(
        JwtBearerDefaults.AuthenticationScheme)
    .Configure<IJwtService>((options, jwt) =>
    {
        options.TokenValidationParameters =
            jwt.ValidationParameters;

        options.TokenValidationParameters.RoleClaimType =
            "roles";
    });

builder.Services
    .AddAuthentication(
        JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Events = new JwtBearerEvents
        {
            // Match existing Spring behaviour:
            // invalid token does not immediately terminate the request.
            OnAuthenticationFailed = context =>
            {
                context.NoResult();
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

// ============================================================================
// REALTIME / SCHEDULING
// ============================================================================

builder.Services.AddHostedService<
    Pixous.HrPortal.Api.Scheduling.ScheduledJobs>();

builder.Services.AddSingleton<StompRegistry>();

builder.Services.AddSingleton<IStompPublisher>(
    sp => sp.GetRequiredService<StompRegistry>());

builder.Services.AddSingleton<
    IStompAuthorizer,
    StompAuthorizer>();

builder.Services.AddSingleton<
    Pixous.HrPortal.Domain.Common.IRealtimePublisher,
    StompRealtimePublisher>();

// ============================================================================
// UPLOAD LIMITS
// ============================================================================

const long MaxRequestBytes = 25L * 1024 * 1024;

builder.Services.Configure<IISServerOptions>(options =>
{
    options.MaxRequestBodySize = MaxRequestBytes;
});

builder.Services.Configure<KestrelServerOptions>(options =>
{
    options.Limits.MaxRequestBodySize = MaxRequestBytes;
});

builder.Services.Configure<FormOptions>(options =>
{
    // Maximum size per uploaded file.
    options.MultipartBodyLengthLimit = 10L * 1024 * 1024;
});

// ============================================================================
// PERMISSION SYSTEM
// ============================================================================

builder.Services.AddSingleton<
    IAuthorizationPolicyProvider,
    PermissionPolicyProvider>();

builder.Services.AddSingleton<
    IAuthorizationHandler,
    PermissionHandler>();

// ============================================================================
// CORS - ONLY appsettings.json
// ============================================================================

const string CorsPolicy = "HrPortalCors";

builder.Services.AddCors(options =>
{
    var configuredOrigins =
        builder.Configuration
            .GetSection($"{AppOptions.SectionName}:Cors:AllowedOrigins")
            .Get<string[]>() ?? [];

    var originsList =
        new HashSet<string>(
            StringComparer.OrdinalIgnoreCase);

    foreach (var origin in configuredOrigins)
    {
        if (!string.IsNullOrWhiteSpace(origin))
        {
            originsList.Add(origin.Trim());
        }
    }

    options.AddPolicy(
        CorsPolicy,
        policy =>
        {
            policy
                .WithOrigins([.. originsList])
                .WithMethods(
                    "GET",
                    "POST",
                    "PUT",
                    "PATCH",
                    "DELETE",
                    "OPTIONS")
                .AllowAnyHeader()
                .WithExposedHeaders("Authorization")
                .AllowCredentials()
                .SetPreflightMaxAge(
                    TimeSpan.FromSeconds(3600));
        });
});

// ============================================================================
// SWAGGER
// ============================================================================

builder.Services.AddEndpointsApiExplorer();

builder.Services.AddSwaggerGen(options =>
{
    options.CustomSchemaIds(
        type => type.FullName?.Replace('+', '.')
               ?? type.Name);
});

// ============================================================================
// BUILD APPLICATION
// ============================================================================

var app = builder.Build();

// ============================================================================
// DATABASE SAFETY CHECK
// ============================================================================

{
    bool expectReadOnly =
        app.Configuration.GetValue(
            "Database:ReadOnly",
            false);

    using IServiceScope scope =
        app.Services.CreateScope();

    var guard =
        scope.ServiceProvider
            .GetRequiredService<SchemaSafetyGuard>();

    await guard.AssertSafeAsync(expectReadOnly);
}

// ============================================================================
// MIDDLEWARE PIPELINE
// ============================================================================

// Normalize multiple redundant slashes (e.g. //api/auth/login -> /api/auth/login)
app.Use(async (context, next) =>
{
    var rawPath = context.Request.Path.Value;
    if (!string.IsNullOrEmpty(rawPath) && rawPath.Contains("//"))
    {
        var normalized = System.Text.RegularExpressions.Regex.Replace(rawPath, "/+", "/");
        context.Request.Path = normalized;
    }
    await next();
});

// Exception handling first.
app.UseMiddleware<ExceptionMiddleware>();

// CORS before authentication.
app.UseCors(CorsPolicy);

// Static files for unified React + .NET deployment.
app.UseDefaultFiles();
app.UseStaticFiles();

// ============================================================================
// SWAGGER
// ============================================================================
// Swagger is enabled when Swagger:Enabled=true.
// Add the following to appsettings.json:
//
// "Swagger": {
//   "Enabled": true
// }
// ============================================================================

if (app.Configuration.GetValue(
        "Swagger:Enabled",
        false))
{
    app.UseSwagger();

    app.UseSwaggerUI(options =>
    {
        options.RoutePrefix = "swagger";
    });
}

// ============================================================================
// AUTHENTICATION / AUTHORIZATION
// ============================================================================

app.UseAuthentication();

// Converts authentication failures to the application's
// standard response envelope.
app.UseMiddleware<AuthChallengeMiddleware>();

// Loads the user's current permissions.
app.UseMiddleware<PrincipalEnricher>();

app.UseAuthorization();

// Usage tracking.
app.UseMiddleware<UsageTrackerMiddleware>();

// ============================================================================
// WEBSOCKETS / STOMP
// ============================================================================

app.UseWebSockets(
    new WebSocketOptions
    {
        KeepAliveInterval =
            TimeSpan.FromSeconds(30)
    });

app.MapStomp();

// ============================================================================
// DEVELOPMENT REALTIME TEST ENDPOINT
// ============================================================================

if (app.Environment.IsDevelopment())
{
    app.MapPost(
        "/__dev/publish",
        async (
            string destination,
            string? user,
            IStompPublisher publisher,
            HttpContext ctx) =>
        {
            using var reader =
                new StreamReader(ctx.Request.Body);

            string body =
                await reader.ReadToEndAsync();

            if (string.IsNullOrWhiteSpace(body))
            {
                body = "{}";
            }

            if (user is null)
            {
                await publisher.PublishAsync(
                    destination,
                    body);
            }
            else
            {
                await publisher.PublishToUserAsync(
                    user,
                    destination,
                    body);
            }

            return Results.Ok(
                new
                {
                    published = destination,
                    user
                });
        })
        .AllowAnonymous();
}

// ============================================================================
// CONTROLLERS
// ============================================================================

app.MapControllers();

// ============================================================================
// PUBLIC PATHS
// ============================================================================

string[] publicPrefixes =
[
    "/api/auth/",
    "/api/public/",
    "/api/technical-admin/auth/",
    "/api/files/",
    "/api/biometric/webhook",
    "/v3/api-docs",
    "/swagger-ui",
    "/swagger",
    "/ws/",
    "/actuator/health",
    "/error"
];

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.MapGet(
    "/actuator/health",
    async (IDbConnectionFactory dbFactory) =>
    {
        try
        {
            using var conn =
                await dbFactory
                    .CreateOpenConnectionAsync();

            var dbName =
                await conn.ExecuteScalarAsync<string>(
                    "SELECT DATABASE()");

            var tableCount =
                await conn.ExecuteScalarAsync<int>(
                    """
                    SELECT COUNT(*)
                    FROM information_schema.tables
                    WHERE table_schema = DATABASE()
                    """);

            var userCount =
                await conn.ExecuteScalarAsync<int>(
                    "SELECT COUNT(*) FROM users");

            return Results.Json(
                new
                {
                    status = "UP",
                    database = dbName,
                    tables = tableCount,
                    users = userCount,
                    timestamp = DateTime.UtcNow
                });
        }
        catch
        {
            return Results.Json(
                new
                {
                    status = "UP"
                });
        }
    })
    .AllowAnonymous();

// ============================================================================
// SPA FALLBACK
// ============================================================================

app.MapFallback(async context =>
{
    string path =
        context.Request.Path.Value ?? "/";

    // Unknown API/WebSocket paths.
    if (path.StartsWith(
            "/api/",
            StringComparison.OrdinalIgnoreCase)
        ||
        path.StartsWith(
            "/ws/",
            StringComparison.OrdinalIgnoreCase))
    {
        bool isPublic =
            publicPrefixes.Any(
                prefix =>
                    path.StartsWith(
                        prefix,
                        StringComparison.OrdinalIgnoreCase));

        context.Response.StatusCode =
            isPublic ||
            context.User.Identity?.IsAuthenticated == true
                ? StatusCodes.Status404NotFound
                : StatusCodes.Status401Unauthorized;

        return;
    }

    // React SPA from wwwroot.
    string webRoot =
        app.Environment.WebRootPath
        ?? Path.Combine(
            AppContext.BaseDirectory,
            "wwwroot");

    string indexPath =
        Path.Combine(
            webRoot,
            "index.html");

    if (HttpMethods.IsGet(context.Request.Method)
        && File.Exists(indexPath))
    {
        context.Response.ContentType =
            "text/html; charset=utf-8";

        await context.Response.SendFileAsync(
            indexPath);

        return;
    }

    bool isPublicPath =
        path == "/"
        || publicPrefixes.Any(
            prefix =>
                path.StartsWith(
                    prefix,
                    StringComparison.OrdinalIgnoreCase));

    context.Response.StatusCode =
        isPublicPath ||
        context.User.Identity?.IsAuthenticated == true
            ? StatusCodes.Status404NotFound
            : StatusCodes.Status401Unauthorized;
});

// ============================================================================
// DATABASE SAFETY CHECK
// ============================================================================

try
{
    using var startupScope =
        app.Services.CreateScope();

    var guard =
        startupScope.ServiceProvider
            .GetRequiredService<SchemaSafetyGuard>();

    var dbOptions =
        app.Configuration
            .GetSection("Database");

    bool expectReadOnly =
        dbOptions.GetValue<bool>("ReadOnly");

    await guard.AssertSafeAsync(
        expectReadOnly);
}
catch (Exception ex)
{
    app.Logger.LogWarning(
        "Schema safety check at startup: {Message}",
        ex.Message);
}

// ============================================================================
// RUN
// ============================================================================

app.Run();


// ============================================================================
// PROGRAM CLASS
// ============================================================================

/// <summary>
/// Exposed so integration tests can drive the app in-process.
/// </summary>
public partial class Program
{
}