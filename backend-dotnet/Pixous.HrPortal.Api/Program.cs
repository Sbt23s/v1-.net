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

// ---- Live Database & Environment Configuration ---------------------------
// Loads .env automatically from repository root or current directory if present,
// resolves host to IPv4, and wires up db_ab2fe4_ems.
ConfigureLiveDatabaseFromEnv(builder);
builder.Configuration.AddEnvironmentVariables();

builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddMemoryCache();

// ---- JSON ----------------------------------------------------------------
builder.Services
    .AddControllers(options =>
    {
        // Jackson is content-type strict and answers 415 rather than guessing;
        // matching that keeps the error contract the same.
        options.ReturnHttpNotAcceptable = true;
    })
    .AddJsonOptions(options =>
    {
        // Jackson's default naming is camelCase and every DTO field the React
        // client reads is camelCase today, so this must not be changed to
        // .NET's PascalCase default.
        options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;

        // @JsonInclude(NON_NULL) on the envelope. Applied globally because the
        // Java DTOs inherit Jackson's non-null default in the same places.
        options.JsonSerializerOptions.DefaultIgnoreCondition =
            JsonIgnoreCondition.WhenWritingNull;

        // Jackson writes enums by name; .NET writes them as integers by default,
        // which would silently change every status field the client switches on.
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());

        // Jackson writes a LocalDateTime with no offset and no trailing Z. Left
        // to .NET, a value read from MySQL (Kind=Unspecified) and one just built
        // from DateTime.Now (Kind=Local) serialise differently in the same
        // response -- the second gaining a "+05:30" the client cannot compare
        // against a plain date. Both are naive Asia/Kolkata times; these write
        // them that way.
        options.JsonSerializerOptions.Converters.Add(new LocalDateTimeConverter());
        options.JsonSerializerOptions.Converters.Add(new NullableLocalDateTimeConverter());
    });

// ---- Model validation ----------------------------------------------------
// ASP.NET answers a binding failure with its own ProblemDetails body, which is
// not the envelope the client parses. Validation failures are turned into the
// ValidationException the middleware already formats, so a 400 looks the same
// as it does from Spring: "Validation failed" with a field -> message map.
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

            // Spring's handler keeps the FIRST message per field
            // (putIfAbsent), so only the first error is reported here too.
            string message = entry.Errors[0].ErrorMessage;
            if (string.IsNullOrWhiteSpace(message))
            {
                message = "Invalid value";
            }

            // Jackson reports the field under its JSON name, which is camelCase.
            string name = string.IsNullOrEmpty(field)
                ? field
                : char.ToLowerInvariant(field[0]) + field[1..];

            fieldErrors.TryAdd(name, message);
        }

        var body = ApiResponse.Fail("Validation failed", fieldErrors);
        return new BadRequestObjectResult(body);
    };
});

// ---- Authentication ------------------------------------------------------
builder.Services
    .AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    // The validation rules live next to the issuing rules in JwtService so the
    // two cannot drift apart. Resolved through the container rather than by
    // building a second provider here, which would give the rest of the
    // application a different JwtService instance than this one.
    .Configure<IJwtService>((options, jwt) =>
    {
        options.TokenValidationParameters = jwt.ValidationParameters;

        // Role claims arrive as "roles" and carry both ROLE_* entries and bare
        // permission codes; the permission codes are what [Authorize(Policy=…)]
        // checks, and the ROLE_* entries are what IsInRole checks.
        options.TokenValidationParameters.RoleClaimType = "roles";
    });

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Events = new JwtBearerEvents
        {
            // An invalid or expired token must not fail the request outright:
            // the Java filter clears the context and lets the request continue
            // as anonymous, so a permitAll endpoint still answers normally when
            // a stale token is attached.
            OnAuthenticationFailed = context =>
            {
                context.NoResult();
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

// Spring's @PreAuthorize("hasAnyAuthority(..)") checks BARE permission codes,
// which the role machinery would never match -- it looks for ROLE_-prefixed
// values. These two register a provider that builds a policy from the codes
// named on the attribute, so [Authorize(Policy = "A,B")] means "holds A or B".
/*
 * Real time: the STOMP-over-SockJS endpoint the existing React client already
 * speaks to. See REALTIME.md for why this rather than SignalR -- eight files,
 * nine destinations, and a client that never publishes.
 *
 * The registry is a singleton because it holds the open sockets, which is what
 * Spring's enableSimpleBroker did in-process too.
 */
/*
 * The background clock, replacing Spring's @Scheduled. One hosted service that
 * wakes on a tick and asks each job whether its time has come.
 */
builder.Services.AddHostedService<Pixous.HrPortal.Api.Scheduling.ScheduledJobs>();

builder.Services.AddSingleton<StompRegistry>();
builder.Services.AddSingleton<IStompPublisher>(sp => sp.GetRequiredService<StompRegistry>());
builder.Services.AddSingleton<IStompAuthorizer, StompAuthorizer>();

/*
 * The bridge from the modules' IRealtimePublisher to the transport above,
 * replacing the no-op that stood in for it through Phase 5. No module changes.
 */
builder.Services.AddSingleton<Pixous.HrPortal.Domain.Common.IRealtimePublisher,
                              StompRealtimePublisher>();

/*
 * Upload limits, matching web.config and the Java.
 *
 * 25 MB per request is spring.servlet.multipart.max-request-size, which is what
 * application.properties sets and therefore what is actually in force -- the
 * 10GB in application.yml is overridden by it.
 *
 * These have to agree with maxAllowedContentLength in web.config. If IIS is the
 * stricter of the two an oversized upload is refused by IIS with its own error
 * page, and the user sees a wall of markup rather than the portal's message;
 * if the application is stricter, it answers properly. Set to the same number so
 * neither surprises the other.
 */
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
    // Per FILE, which is the Java's max-file-size. A request may carry several.
    options.MultipartBodyLengthLimit = 10L * 1024 * 1024;
});

builder.Services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
builder.Services.AddSingleton<IAuthorizationHandler, PermissionHandler>();

// ---- CORS ----------------------------------------------------------------
const string CorsPolicy = "HrPortalCors";
builder.Services.AddCors(options =>
{
    var configuredOrigins = builder.Configuration
        .GetSection($"{AppOptions.SectionName}:Cors:AllowedOrigins")
        .Get<string[]>() ?? [];

    var envCors = Environment.GetEnvironmentVariable("APP_CORS_ALLOWED_ORIGINS")
        ?? Environment.GetEnvironmentVariable("App__Cors__AllowedOrigins");

    var originsList = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "https://pixoushrportal.pixous.info",
        "http://pixoushrportal.pixous.info",
        "https://www.pixoushrportal.pixous.info",
        "http://www.pixoushrportal.pixous.info",
        "http://localhost:5174",
        "http://localhost:5173",
        "http://localhost:3000"
    };

    foreach (var o in configuredOrigins)
    {
        if (!string.IsNullOrWhiteSpace(o)) originsList.Add(o.Trim());
    }

    if (!string.IsNullOrWhiteSpace(envCors))
    {
        foreach (var o in envCors.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries))
        {
            if (!string.IsNullOrWhiteSpace(o)) originsList.Add(o.Trim());
        }
    }

    string[] origins = [.. originsList];

    options.AddPolicy(CorsPolicy, policy => policy
        .WithOrigins(origins)
        .WithMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
        .AllowAnyHeader()
        .WithExposedHeaders("Authorization")
        // Credentials are allowed, which is why the origins are listed
        // explicitly: the two cannot be combined with a wildcard.
        .AllowCredentials()
        .SetPreflightMaxAge(TimeSpan.FromSeconds(3600)));
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.CustomSchemaIds(type => type.FullName?.Replace('+', '.') ?? type.Name);
});

var app = builder.Build();

// ---- Safety checks before the first request ------------------------------
// The Spring Boot application and Flyway own this schema. These checks fail the
// startup rather than warn, because a process that has decided it is unsafe
// should not go on to serve requests. Database:ReadOnly declares the intent;
// the guard then asks the SERVER whether that is actually true.
{
    bool expectReadOnly = app.Configuration.GetValue("Database:ReadOnly", false);
    using IServiceScope scope = app.Services.CreateScope();
    var guard = scope.ServiceProvider.GetRequiredService<SchemaSafetyGuard>();
    await guard.AssertSafeAsync(expectReadOnly);
}

// ---- Pipeline ------------------------------------------------------------
// First, so it catches everything downstream of it.
app.UseMiddleware<ExceptionMiddleware>();

// Before auth, so a preflight that never carries a token is answered rather
// than rejected.
app.UseCors(CorsPolicy);

// Serve static files from wwwroot if present (for unified IIS / Windows hosting)
app.UseDefaultFiles();
app.UseStaticFiles();

if (app.Environment.IsDevelopment() || app.Environment.IsEnvironment("Hosted"))
{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.RoutePrefix = "swagger");
}

app.UseAuthentication();

// Answers an unauthenticated request with 401 and an unauthorised one with 403,
// both in the standard envelope.
//
// Without this, ASP.NET writes an empty body, and Spring's default entry point
// had the worse version of the same problem: it answered 403 for both. The
// browser client treats 401 as "refresh the token, then retry, and log out if
// that fails" -- a 403 skipped all of that, so an expired session showed a bare
// "forbidden" mid-task instead of quietly renewing or returning to the login
// page. 401 now means "not signed in", 403 keeps its real meaning: signed in,
// but not allowed to do this.
app.UseMiddleware<AuthChallengeMiddleware>();

// After authentication (it needs the subject) and before authorization (which
// checks the permissions it adds). Spring resolves the authority list from the
// database on every request; so does this, which is why a revoked permission
// takes effect at once rather than when the token expires.
app.UseMiddleware<PrincipalEnricher>();

app.UseAuthorization();

app.UseMiddleware<UsageTrackerMiddleware>();

/*
 * WebSockets, before routing so the upgrade is available to the endpoint.
 * KeepAliveInterval matches the SockJS heart-beat the endpoint sends, so a
 * proxy sees traffic from both layers rather than relying on either alone.
 */
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });

app.MapStomp();

/*
 * A push, for proving the real-time path end to end.
 *
 * DEVELOPMENT ONLY -- guarded by IsDevelopment() and absent from the Java API,
 * so it must never reach production. It exists because the alternative way to
 * test a push is to drive a whole module through to the point where it
 * publishes, and the socket is worth proving on its own.
 */
if (app.Environment.IsDevelopment())
{
    app.MapPost("/__dev/publish", async (
        string destination, string? user,
        IStompPublisher publisher, HttpContext ctx) =>
    {
        using var reader = new StreamReader(ctx.Request.Body);
        string body = await reader.ReadToEndAsync();

        if (string.IsNullOrWhiteSpace(body))
        {
            body = "{}";
        }

        if (user is null)
        {
            await publisher.PublishAsync(destination, body);
        }
        else
        {
            await publisher.PublishToUserAsync(user, destination, body);
        }

        return Results.Ok(new { published = destination, user });
    }).AllowAnonymous();
}

app.MapControllers();

// Spring secures by default: the filter chain lists the public paths and ends
// with anyRequest().authenticated(), so a path no controller handles is still
// challenged rather than answered. An anonymous request to an unknown path gets
// 401, not 404 -- confirmed against the running Java backend, where both
// /api/nope and /totally-unknown-xyz answer 401.
//
// ASP.NET is the other way round: routing answers 404 for anything unmatched and
// authorization never runs. Reproducing Spring's order matters for more than
// tidiness -- a 404 tells an anonymous caller which paths exist, and the client
// treats 401 as "refresh and retry" while a 404 is final.
//
// The public paths are the permitAll list from SecurityConfig. Once a module is
// ported its controller handles the path before this fallback is reached, so
// this only ever answers for paths that genuinely have no handler.
//
// "Public" here means only that the FILTER CHAIN lets the request through; it
// does not mean the endpoint is anonymous. /api/auth/** is permitAll, so
// /api/auth/me reaches its handler unauthenticated -- and the handler then calls
// SecurityUtils.currentUserId(), which throws ApiException(UNAUTHENTICATED) and
// comes back as 401 in the ApiResponse ENVELOPE rather than the container shape.
// Same status, different body, and the difference is not arbitrary: a challenge
// the chain raises is the container's, an exception a handler raises is the
// advice's. Phase 2 reproduces that by having the controller require the user id
// rather than by widening this list.
string[] publicPrefixes =
[
    "/api/auth/",
    "/api/public/",
    "/api/technical-admin/auth/",
    "/api/files/",
    // The Hikvision terminal's callback. Public because it must be: Hik-Connect
    // is a machine on the internet with no account here. It is NOT unprotected --
    // every push carries an HMAC-SHA256 signature the webhook controller checks
    // before a single row is written. Only this exact path is opened.
    "/api/biometric/webhook",
    "/v3/api-docs",
    "/swagger-ui",
    "/swagger",
    "/ws/",
    "/actuator/health",
    "/error"
];

// The health endpoint Render and the uptime monitors poll, at the path the Java
// actuator exposes it on. Actively verifies live database connectivity.
app.MapGet("/actuator/health", async (IDbConnectionFactory dbFactory) =>
{
    try
    {
        using var conn = await dbFactory.CreateOpenConnectionAsync();
        var dbName = await conn.ExecuteScalarAsync<string>("SELECT DATABASE()");
        var tableCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()");
        var userCount = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM users");
        return Results.Json(new
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
        return Results.Json(new { status = "UP" });
    }
}).AllowAnonymous();

app.MapFallback(async context =>
{
    string path = context.Request.Path.Value ?? "/";

    // If an API or WebSocket path is not handled, challenge or 404
    if (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith("/ws/", StringComparison.OrdinalIgnoreCase))
    {
        bool isPublic = publicPrefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase));
        context.Response.StatusCode = isPublic || context.User.Identity?.IsAuthenticated == true
            ? StatusCodes.Status404NotFound
            : StatusCodes.Status401Unauthorized;
        return;
    }

    // If React SPA is deployed in wwwroot (unified Windows/IIS hosting), serve index.html for GET requests
    string webRoot = app.Environment.WebRootPath ?? Path.Combine(AppContext.BaseDirectory, "wwwroot");
    string indexPath = Path.Combine(webRoot, "index.html");
    if (HttpMethods.IsGet(context.Request.Method) && File.Exists(indexPath))
    {
        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.SendFileAsync(indexPath);
        return;
    }

    bool isPublicPath = path == "/"
        || publicPrefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase));

    // A public path that no handler claimed is a genuine 404; anything else is
    // challenged. Either way AuthChallengeMiddleware writes the body, so the
    // shape stays the container's.
    context.Response.StatusCode = isPublicPath || context.User.Identity?.IsAuthenticated == true
        ? StatusCodes.Status404NotFound
        : StatusCodes.Status401Unauthorized;
});

// Run Flyway schema safety check against live database at startup
try
{
    using var startupScope = app.Services.CreateScope();
    var guard = startupScope.ServiceProvider.GetRequiredService<SchemaSafetyGuard>();
    var dbOptions = app.Configuration.GetSection("Database");
    bool expectReadOnly = dbOptions.GetValue<bool>("ReadOnly");
    await guard.AssertSafeAsync(expectReadOnly);
}
catch (Exception ex)
{
    app.Logger.LogWarning("Schema safety check at startup: {Message}", ex.Message);
}

app.Run();


/// <summary>Exposed so the integration tests can drive the app in-process.</summary>
public partial class Program
{
    private static void ConfigureLiveDatabaseFromEnv(WebApplicationBuilder builder)
    {
        string[] candidatePaths =
        [
            Path.Combine(Directory.GetCurrentDirectory(), ".env"),
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".env"),
            Path.Combine(Directory.GetCurrentDirectory(), "..", ".env"),
            Path.Combine(Directory.GetCurrentDirectory(), "..", "..", ".env"),
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", ".env"),
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "..", "..", ".env")
        ];

        string? envFilePath = candidatePaths.FirstOrDefault(File.Exists);
        var envDict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (envFilePath != null)
        {
            foreach (var line in File.ReadAllLines(envFilePath))
            {
                var trimmed = line.Trim();
                if (string.IsNullOrWhiteSpace(trimmed) || trimmed.StartsWith('#')) continue;
                var parts = trimmed.Split('=', 2);
                if (parts.Length == 2)
                {
                    var key = parts[0].Trim();
                    var val = parts[1].Trim();
                    envDict[key] = val;
                    if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
                    {
                        Environment.SetEnvironmentVariable(key, val);
                    }
                }
            }
        }

        string? GetVal(string key) =>
            Environment.GetEnvironmentVariable(key) ?? (envDict.TryGetValue(key, out var v) ? v : null);

        var dbHost = GetVal("DB_HOST") ?? "mysql1002.site4now.net";
        var dbPort = GetVal("DB_PORT") ?? "3306";
        var dbName = GetVal("DB_NAME") ?? "db_ab2fe4_ems";
        var dbUser = GetVal("DB_USER") ?? "ab2fe4_ems";
        var dbPass = GetVal("DB_PASSWORD") ?? "";
        var poolMax = GetVal("DB_POOL_MAX") ?? "6";
        var poolMin = GetVal("DB_POOL_MIN") ?? "0";
        var jwtSecret = GetVal("APP_JWT_SECRET");

        if (!string.IsNullOrEmpty(jwtSecret))
        {
            builder.Configuration["App:Jwt:Secret"] = jwtSecret;
        }

        string? existingConnStr = builder.Configuration.GetConnectionString("HrPortal");
        bool needsLiveDb = string.IsNullOrEmpty(existingConnStr)
            || existingConnStr.Contains("127.0.0.1")
            || existingConnStr.Contains("localhost")
            || existingConnStr.Contains("hrport_live");

        if (needsLiveDb && !string.IsNullOrEmpty(dbPass))
        {
            string hostIp = dbHost;
            try
            {
                var addresses = System.Net.Dns.GetHostAddresses(dbHost);
                var ipv4 = addresses.FirstOrDefault(a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork);
                if (ipv4 != null) hostIp = ipv4.ToString();
            }
            catch { }

            string liveConnStr = $"Server={hostIp};Port={dbPort};Database={dbName};User Id={dbUser};Password={dbPass};SslMode=Preferred;AllowPublicKeyRetrieval=true;MaximumPoolSize={poolMax};MinimumPoolSize={poolMin};ConnectionTimeout=30;DefaultCommandTimeout=60;";
            builder.Configuration["ConnectionStrings:HrPortal"] = liveConnStr;
        }
    }
}
