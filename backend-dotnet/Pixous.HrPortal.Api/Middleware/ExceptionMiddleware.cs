using System.Net;
using System.Text.Json;
using Pixous.HrPortal.Domain.Common;
using AccessDeniedException = Pixous.HrPortal.Domain.Common.AccessDeniedException;
using BadCredentialsException = Pixous.HrPortal.Domain.Common.BadCredentialsException;
using ValidationException = Pixous.HrPortal.Domain.Common.ValidationException;

namespace Pixous.HrPortal.Api.Middleware;

/// <summary>
/// Translates exceptions into the standard <see cref="ApiResponse{T}"/> envelope.
///
/// This is the port of com.pixous.hrportal.common.GlobalExceptionHandler, and it
/// is deliberately a near-transcription rather than a tidier design. Almost every
/// branch in the Java class documents a fault that reached production -- a client
/// mistake answered as 500, a constraint violation shown to HR as a reference
/// number with no actionable field. Each branch keeps its Java counterpart's
/// status AND its exact message text, because the React client matches on some of
/// these strings and the rest are read by people.
/// </summary>
public sealed class ExceptionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionMiddleware> _log;

    /// <summary>
    /// Whether to include exception detail in the response. True only while the
    /// dev profile is active; production sends a reference instead.
    /// </summary>
    private readonly bool _devProfile;

    public ExceptionMiddleware(RequestDelegate next,
                               ILogger<ExceptionMiddleware> log,
                               IHostEnvironment env)
    {
        _next = next;
        _log = log;
        // Java reads spring.profiles.active and tests contains("dev"), defaulting
        // to "prod" when unset -- so detail is off unless dev is explicitly on.
        _devProfile = env.EnvironmentName.Contains("dev", StringComparison.OrdinalIgnoreCase);
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            await HandleAsync(context, ex);
        }
    }

    private async Task HandleAsync(HttpContext context, Exception ex)
    {
        // Once the response has begun there is no envelope left to write; the
        // connection is aborted instead so the client sees a failed request
        // rather than a truncated success body.
        if (context.Response.HasStarted)
        {
            _log.LogError(ex, "Exception after the response had started; aborting");
            context.Abort();
            return;
        }

        var (status, body) = Translate(ex);

        context.Response.Clear();
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync(JsonSerializer.Serialize(body, JsonOptions));
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private (int Status, ApiResponse<object> Body) Translate(Exception ex) => ex switch
    {
        ApiException e =>
            (e.Code.StatusCode(), ApiResponse.Fail(e.Message)),

        ValidationException e =>
            (ErrorCode.ValidationError.StatusCode(), ApiResponse.Fail("Validation failed", e.FieldErrors)),

        BadCredentialsException =>
            // The message is fixed and does not echo the exception's own text:
            // the caller must not learn which half of the pair was wrong.
            //
            // NOTE: this branch is effectively dead, and is ported anyway so the
            // behaviour does not change if it ever stops being. AuthService
            // rejects a bad login by throwing ApiException(BAD_CREDENTIALS,
            // "Invalid username or password"), which the ApiException branch
            // above answers first -- so a failed login says "username", not
            // "Aadhaar number". Confirmed against the running Java backend:
            //   POST /api/auth/login  ->  401
            //   {"success":false,"message":"Invalid username or password",...}
            // Spring only reaches this handler for a BadCredentialsException
            // raised by the authentication provider itself, which this
            // application's login path never lets happen.
            (ErrorCode.BadCredentials.StatusCode(),
             ApiResponse.Fail("Invalid Aadhaar number or password")),

        // Spring maps AccessDeniedException and a bare SecurityException to the
        // same 403; SecurityException keeps its own message when it has one.
        AccessDeniedException e =>
            (ErrorCode.AccessDenied.StatusCode(),
             ApiResponse.Fail(Fallback(e.Message, "You do not have permission to perform this action"))),

        ArgumentException e =>
            (ErrorCode.ValidationError.StatusCode(),
             ApiResponse.Fail(Fallback(e.Message, "Invalid request"))),

        DataIntegrityException e => HandleDataIntegrity(e),

        _ => HandleGeneric(ex)
    };

    /// <summary>Java uses the message when it is neither null nor blank, else a default.</summary>
    private static string Fallback(string? message, string standIn) =>
        string.IsNullOrWhiteSpace(message) ? standIn : message;

    /// <summary>
    /// A unique constraint the application did not catch first.
    ///
    /// Every one of these is a bug -- the checks upstream exist so a duplicate is
    /// reported in the caller's own words -- but the person in front of the screen
    /// should still be told which field is the problem rather than "Something went
    /// wrong". That is what happened when an employee ID collided: HR saw a
    /// reference number and had nothing to act on.
    ///
    /// The column name is read out of the constraint text and mapped to a human
    /// word. Anything unrecognised falls back to a general message, because the
    /// raw text names tables and indexes and belongs in the log.
    /// </summary>
    private (int, ApiResponse<object>) HandleDataIntegrity(DataIntegrityException ex)
    {
        string reference = Reference();
        _log.LogError(ex, "Constraint violation [ref={Ref}]", reference);

        // Java lowercases the most specific cause's message before matching; the
        // DAL puts that driver text into this exception's Message.
        string detail = (ex.Message ?? string.Empty).ToLowerInvariant();

        // Order matters and mirrors the Java ternary chain exactly: "aadhar" is
        // the spelling used in the schema, while the word shown to the user is
        // "Aadhaar".
        string? field =
              detail.Contains("employee_code") ? "employee ID"
            : detail.Contains("username")      ? "username"
            : detail.Contains("aadhar")        ? "Aadhaar number"
            : detail.Contains("phone")         ? "phone number"
            : detail.Contains("email")         ? "email address"
            : null;

        string message = field is not null
            ? $"That {field} is already in use."
            : $"That change conflicts with data that already exists. (ref {reference})";

        return ((int)HttpStatusCode.Conflict, ApiResponse.Fail(message));
    }

    private (int, ApiResponse<object>) HandleGeneric(Exception ex)
    {
        // A correlation id ties what the caller sees to what is in the log, which
        // is the part that was actually useful about the old behaviour.
        string reference = Reference();
        _log.LogError(ex, "Unhandled exception [ref={Ref}]", reference);

        // The exception chain used to be returned to the client. It made a failure
        // easy to read from a response -- and it also handed out package names,
        // entity names and primary keys to anyone who could provoke an error.
        // Kept for the dev profile, where that convenience costs nothing.
        string? detail = null;
        if (_devProfile)
        {
            var sb = new System.Text.StringBuilder();
            for (Exception? t = ex; t is not null && sb.Length < 1500; t = t.InnerException)
            {
                sb.Append(t.GetType().Name).Append(": ").Append(t.Message).Append(" || ");
            }
            detail = sb.ToString();
        }

        return ((int)HttpStatusCode.InternalServerError,
                ApiResponse.Fail($"Something went wrong. Please try again later. (ref {reference})", detail));
    }

    /// <summary>The first eight characters of a UUID, as the Java handler does.</summary>
    private static string Reference() => Guid.NewGuid().ToString().Substring(0, 8);
}
