using System.Net;

namespace Pixous.HrPortal.Domain.Common;

/// <summary>
/// Canonical application error codes mapped to HTTP statuses.
/// Ported one-for-one from com.pixous.hrportal.common.ErrorCode; the status
/// attached to each code is what the React client branches on, so neither the
/// set of codes nor the status each maps to may drift.
/// </summary>
public enum ErrorCode
{
    ValidationError,
    BadCredentials,
    Unauthenticated,
    TokenExpired,
    AccountLocked,
    AccessDenied,
    NotFound,
    Conflict,
    TooManyAttempts,
    GeofenceViolation,
    BusinessRule,
    Internal
}

public static class ErrorCodeExtensions
{
    /// <summary>The HTTP status this code answers with, matching ErrorCode.status() in Java.</summary>
    public static HttpStatusCode Status(this ErrorCode code) => code switch
    {
        ErrorCode.ValidationError    => HttpStatusCode.BadRequest,           // 400
        ErrorCode.BadCredentials     => HttpStatusCode.Unauthorized,         // 401
        ErrorCode.Unauthenticated    => HttpStatusCode.Unauthorized,         // 401
        ErrorCode.TokenExpired       => HttpStatusCode.Unauthorized,         // 401
        ErrorCode.AccountLocked      => HttpStatusCode.Locked,               // 423
        ErrorCode.AccessDenied       => HttpStatusCode.Forbidden,            // 403
        ErrorCode.NotFound           => HttpStatusCode.NotFound,             // 404
        ErrorCode.Conflict           => HttpStatusCode.Conflict,             // 409
        ErrorCode.TooManyAttempts    => HttpStatusCode.TooManyRequests,      // 429
        ErrorCode.GeofenceViolation  => HttpStatusCode.UnprocessableEntity,  // 422
        ErrorCode.BusinessRule       => HttpStatusCode.UnprocessableEntity,  // 422
        ErrorCode.Internal           => HttpStatusCode.InternalServerError,  // 500
        _ => HttpStatusCode.InternalServerError
    };

    public static int StatusCode(this ErrorCode code) => (int)code.Status();
}
