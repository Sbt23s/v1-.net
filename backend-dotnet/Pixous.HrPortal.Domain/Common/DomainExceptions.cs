namespace Pixous.HrPortal.Domain.Common;

/// <summary>
/// Raised when a unique constraint the application did not catch first is
/// violated. The DAL translates MySQL error 1062 into this so the middleware
/// can name the offending field without the Api project referencing a database
/// driver. Carries the driver's own message, which is what the Java handler
/// inspects via getMostSpecificCause().
/// </summary>
public sealed class DataIntegrityException : Exception
{
    public DataIntegrityException(string message, Exception? inner = null)
        : base(message, inner) { }
}

/// <summary>
/// Signed in, but not allowed to do this. Mirrors Spring Security's
/// AccessDeniedException and the SecurityException the services throw by hand;
/// both answer 403 with the same wording in the Java handler.
/// </summary>
public sealed class AccessDeniedException : Exception
{
    public AccessDeniedException(string? message = null) : base(message) { }
}

/// <summary>
/// The credentials presented did not match. Mirrors Spring Security's
/// BadCredentialsException. The handler answers 401 with a fixed message and
/// deliberately does not echo this exception's own text, so a caller cannot
/// learn whether it was the identifier or the password that was wrong.
/// </summary>
public sealed class BadCredentialsException : Exception
{
    public BadCredentialsException(string? message = null) : base(message) { }
}

/// <summary>
/// Model-binding and validation failures, carrying per-field messages.
/// Mirrors MethodArgumentNotValidException: the handler answers 400 with
/// "Validation failed" and this map under "errors".
/// </summary>
public sealed class ValidationException : Exception
{
    public IReadOnlyDictionary<string, string> FieldErrors { get; }

    public ValidationException(IReadOnlyDictionary<string, string> fieldErrors)
        : base("Validation failed")
    {
        FieldErrors = fieldErrors;
    }
}
