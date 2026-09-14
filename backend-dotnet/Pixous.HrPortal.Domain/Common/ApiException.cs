namespace Pixous.HrPortal.Domain.Common;

/// <summary>
/// Single exception type carrying an <see cref="ErrorCode"/>; mapped by the
/// exception middleware. Ported from com.pixous.hrportal.common.ApiException.
///
/// The three factories below produce the exact message wording the Java ones
/// do -- NotFound in particular appends " not found" to the caller's noun, and
/// that composed string reaches the user interface verbatim.
/// </summary>
public class ApiException : Exception
{
    public ErrorCode Code { get; }

    public ApiException(ErrorCode code, string message) : base(message)
    {
        Code = code;
    }

    public static ApiException NotFound(string what) =>
        new(ErrorCode.NotFound, what + " not found");

    public static ApiException Conflict(string message) =>
        new(ErrorCode.Conflict, message);

    public static ApiException Business(string message) =>
        new(ErrorCode.BusinessRule, message);

    public static ApiException Forbidden(string message = "Access denied") =>
        new(ErrorCode.AccessDenied, message);

    public static ApiException BadRequest(string message) =>
        new(ErrorCode.ValidationError, message);
}
