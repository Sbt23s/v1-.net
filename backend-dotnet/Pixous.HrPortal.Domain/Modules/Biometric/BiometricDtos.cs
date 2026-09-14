namespace Pixous.HrPortal.Domain.Modules.Biometric;

public sealed record PersonMappingRow(
    string HikPersonId,
    string? PersonCode,
    string? TerminalName,
    long? UserId,
    string? EmployeeCode,
    string? EmployeeName,
    bool Manual,
    bool FaceEnrolled,
    bool FingerEnrolled,
    long PunchesLast30Days
);

public sealed record BiometricStatusResponse(
    bool Configured,
    long MappedPeople,
    long PunchesLast24h,
    bool Receiving
);

public sealed record BiometricSyncResult(
    bool Ran,
    int PeopleOnTerminal,
    int Matched,
    int Created,
    int Updated,
    int Unmatched
)
{
    public static BiometricSyncResult Skipped() => new(false, 0, 0, 0, 0, 0);

    public string Summary() =>
        !Ran
            ? "Hikvision is not configured, so nothing was synced"
            : $"{PeopleOnTerminal} on the terminal, {Matched} matched ({Created} new, {Updated} changed), {Unmatched} unmatched";
}

public sealed record BiometricBackfillResult(
    bool Ran,
    int Read,
    int Stored,
    int Duplicates,
    int Unmatched,
    int Applied
)
{
    public static BiometricBackfillResult Skipped() => new(false, 0, 0, 0, 0, 0);

    public string Summary() =>
        !Ran
            ? "Hikvision is not configured, so nothing was imported"
            : $"{Read} read, {Stored} stored, {Duplicates} already held, {Unmatched} unmatched, {Applied} attendance rows updated";
}

public sealed record BiometricIngestResult(
    int Stored,
    int Duplicates,
    int Unmatched,
    int Ignored
);

public sealed class BiometricEventRow
{
    public long Id { get; set; }
    public long? CompanyId { get; set; }
    public long? UserId { get; set; }
    public string? HikPersonId { get; set; }
    public int EventType { get; set; }
    public string? AuthMethod { get; set; }
    public int? AuthResult { get; set; }
    public DateTime OccurTime { get; set; }
    public string? DeviceId { get; set; }
    public string? DeviceSerial { get; set; }
    public string? DeviceName { get; set; }
    public string? AreaId { get; set; }
    public string? AreaName { get; set; }
    public long? HikSerialNo { get; set; }
    public int? CurrentEvent { get; set; } = 1;
    public int? AttendanceStatus { get; set; }
    public string? BatchId { get; set; }
    public string? Direction { get; set; }
    public bool Processed { get; set; }
    public DateTime? ProcessedAt { get; set; }
    public string? ProcessError { get; set; }
    public string? RawPayload { get; set; }
    public DateTime ReceivedAt { get; set; } = DateTime.UtcNow;

    public bool IsUsablePunch => UserId.HasValue && AuthResult == 1;
    public bool IsBuffered => CurrentEvent == 0;
}
