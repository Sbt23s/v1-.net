using System.Text.Json.Serialization;

namespace Pixous.HrPortal.Domain.Common;

/// <summary>
/// Uniform envelope returned by every REST endpoint so the web and mobile
/// clients can rely on a single, predictable shape.
///
/// Ported from com.pixous.hrportal.common.ApiResponse. The Java record carries
/// @JsonInclude(NON_NULL), so a null member is omitted from the JSON rather
/// than serialised as null -- the React client distinguishes "absent" from
/// "null" in places, so JsonIgnoreCondition.WhenWritingNull reproduces it.
///
/// Property order matches the Java record's component order, because the
/// serialiser emits in declaration order and some recorded fixtures compare
/// raw response text.
/// </summary>
public sealed record ApiResponse<T>(
    [property: JsonPropertyName("success")] bool Success,
    [property: JsonPropertyName("message")] string? Message,
    [property: JsonPropertyName("data"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] T? Data,
    [property: JsonPropertyName("errors"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] object? Errors,
    [property: JsonPropertyName("timestamp")] DateTimeOffset Timestamp)
{
    public static ApiResponse<T> Ok(T data) =>
        new(true, "OK", data, null, DateTimeOffset.UtcNow);

    public static ApiResponse<T> Ok(T data, string message) =>
        new(true, message, data, null, DateTimeOffset.UtcNow);

    /// <summary>
    /// A success carrying no payload. Named Of rather than Message because the
    /// record already has a Message property; the Java factory is
    /// ApiResponse.message(..) and this is its counterpart.
    /// </summary>
    public static ApiResponse<T> MessageOnly(string message) =>
        new(true, message, default, null, DateTimeOffset.UtcNow);

    public static ApiResponse<T> Fail(string message, object? errors) =>
        new(false, message, default, errors, DateTimeOffset.UtcNow);
}

/// <summary>
/// Non-generic helpers for the common ApiResponse&lt;object&gt; case, which is
/// what every error path returns (the Java handler's ApiResponse&lt;Void&gt;).
/// </summary>
public static class ApiResponse
{
    public static ApiResponse<object> Message(string message) =>
        ApiResponse<object>.MessageOnly(message);

    public static ApiResponse<object> Fail(string message, object? errors = null) =>
        ApiResponse<object>.Fail(message, errors);
}
