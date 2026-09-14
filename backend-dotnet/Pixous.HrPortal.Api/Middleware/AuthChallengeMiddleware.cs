using System.Text.Json;
using Pixous.HrPortal.Domain.Common;

namespace Pixous.HrPortal.Api.Middleware;

/// <summary>
/// Gives 401 and 403 the same envelope every other response has.
///
/// ASP.NET's authentication and authorization middleware set the status code and
/// write nothing, so without this the client receives an empty body where it
/// expects {success, message, ...} and fails while parsing rather than on the
/// status it was given.
///
/// The body shape here is NOT the ApiResponse envelope, and that is deliberate.
/// Spring's entry point calls HttpServletResponse.sendError, which hands the
/// request to the container's error page rather than to the @RestControllerAdvice
/// -- so the envelope never runs for these two, and what actually goes on the
/// wire is Tomcat's error JSON. Verified against the running Java backend:
///
///   GET /api/nope  (no token)
///   401 {"timestamp":"2026-09-12T15:08:36.942+00:00","status":401,
///        "error":"Unauthorized",
///        "message":"Your session has expired. Please sign in again.",
///        "path":"/api/nope"}
///
/// Reproducing the envelope here instead would have been the tidier choice and
/// would have broken any client branch that reads .status or .path off a 401.
///
/// The two messages are the ones Spring's entry point and access-denied handler
/// send, kept word for word:
///
///   401 "Your session has expired. Please sign in again."
///   403 "You do not have permission to do this."
///
/// The distinction matters to the browser client: 401 means "refresh the token,
/// retry, and log out if that fails", while 403 means "signed in, but not
/// allowed" and must NOT trigger a refresh. Spring's default answered 403 to
/// both, which skipped the refresh path entirely and showed a bare "forbidden"
/// mid-task instead of quietly renewing the session.
/// </summary>
public sealed class AuthChallengeMiddleware
{
    private readonly RequestDelegate _next;

    public AuthChallengeMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    /// <summary>
    /// The relaxed encoder matters here. The default escapes non-alphanumerics
    /// aggressively, which turns the "+05:30" offset in the timestamp into
    /// "+05:30" -- still valid JSON and still parsed correctly by a browser,
    /// but not byte-identical to what Tomcat writes, and anything comparing the
    /// raw text would see a difference that is not really there.
    /// </summary>
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public async Task InvokeAsync(HttpContext context)
    {
        await _next(context);

        // Only an empty challenge is filled in. A handler that already wrote its
        // own 401 or 403 body -- an ApiException carrying AccessDenied, say --
        // has said something more specific and is left alone.
        if (context.Response.HasStarted)
        {
            return;
        }

        // 404 is included because a bare ASP.NET 404 has no body at all, while
        // the servlet container writes the same error JSON it writes for the
        // other two. A client parsing the response should not meet an empty body.
        if (context.Response.StatusCode is not (StatusCodes.Status401Unauthorized
                                             or StatusCodes.Status403Forbidden
                                             or StatusCodes.Status404NotFound))
        {
            return;
        }

        // A response that already has a body is not a bare challenge.
        if (context.Response.ContentLength is > 0)
        {
            return;
        }

        int status = context.Response.StatusCode;

        (string error, string message) = status switch
        {
            StatusCodes.Status401Unauthorized =>
                ("Unauthorized", "Your session has expired. Please sign in again."),
            StatusCodes.Status403Forbidden =>
                ("Forbidden", "You do not have permission to do this."),
            _ =>
                ("Not Found", "Not found.")
        };

        // Tomcat's error-page shape, not the ApiResponse envelope. See above.
        // The timestamp is local time with a millisecond precision and an offset,
        // which is what the container writes.
        var body = new ContainerError(
            DateTimeOffset.Now.ToString("yyyy-MM-dd'T'HH:mm:ss.fffzzz"),
            status,
            error,
            message,
            context.Request.Path.Value ?? string.Empty);

        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync(JsonSerializer.Serialize(body, JsonOptions));
    }

    /// <summary>
    /// The servlet container's error body, reproduced field for field and in
    /// the same order Tomcat emits them.
    /// </summary>
    private sealed record ContainerError(
        string Timestamp,
        int Status,
        string Error,
        string Message,
        string Path);
}
