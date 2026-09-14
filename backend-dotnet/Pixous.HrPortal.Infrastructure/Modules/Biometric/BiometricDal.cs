using Dapper;
using Pixous.HrPortal.Domain.Modules.Biometric;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Biometric;

public sealed class BiometricDal : DalBase, IBiometricDal
{
    public BiometricDal(IDbConnectionFactory connectionFactory) : base(connectionFactory)
    {
    }

    public async Task<BiometricStatusResponse> GetStatusAsync(bool isConfigured, CancellationToken ct = default)
    {
        return await QueryAsync(async conn =>
        {
            long mappedPeople = await conn.ExecuteScalarAsync<long>(new CommandDefinition(
                "SELECT COUNT(*) FROM hik_person_map WHERE user_id IS NOT NULL", cancellationToken: ct));

            DateTime since = DateTime.UtcNow.AddDays(-1);
            long punchesLast24h = await conn.ExecuteScalarAsync<long>(new CommandDefinition(
                "SELECT COUNT(*) FROM biometric_events WHERE occur_time >= @Since", new { Since = since }, cancellationToken: ct));

            return new BiometricStatusResponse(
                Configured: isConfigured,
                MappedPeople: mappedPeople,
                PunchesLast24h: punchesLast24h,
                Receiving: punchesLast24h > 0
            );
        }, ct);
    }

    public async Task<IReadOnlyList<PersonMappingRow>> ListPersonMappingsAsync(long? companyId, CancellationToken ct = default)
    {
        const string sql = """
            SELECT 
                m.hik_person_id AS HikPersonId,
                m.person_code AS PersonCode,
                COALESCE(m.person_code, m.hik_person_id) AS TerminalName,
                m.user_id AS UserId,
                u.employee_code AS EmployeeCode,
                u.name AS EmployeeName,
                (m.updated_at IS NOT NULL) AS Manual,
                (m.face_enrolled = 1) AS FaceEnrolled,
                (m.fingerprint_enrolled = 1) AS FingerEnrolled,
                COALESCE((
                    SELECT COUNT(*) 
                    FROM biometric_events b 
                    WHERE b.hik_person_id = m.hik_person_id 
                      AND b.occur_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                ), 0) AS PunchesLast30Days
            FROM hik_person_map m
            LEFT JOIN users u ON u.id = m.user_id
            ORDER BY m.id DESC
            """;
        return (await QueryAsync(conn => conn.QueryAsync<PersonMappingRow>(new CommandDefinition(sql, cancellationToken: ct)), ct)).AsList();
    }

    public async Task MapPersonAsync(string hikPersonId, long? userId, string actor, CancellationToken ct = default)
    {
        await QueryAsync(async conn =>
        {
            long? companyId = null;
            if (userId.HasValue)
            {
                companyId = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
                    "SELECT company_id FROM users WHERE id = @UserId", new { UserId = userId.Value }, cancellationToken: ct));
            }

            const string sql = """
                UPDATE hik_person_map 
                SET user_id = @UserId, 
                    company_id = @CompanyId,
                    updated_at = NOW() 
                WHERE hik_person_id = @HikPersonId
                """;
            int updated = await conn.ExecuteAsync(new CommandDefinition(sql, new { UserId = userId, CompanyId = companyId, HikPersonId = hikPersonId }, cancellationToken: ct));
            if (updated == 0 && userId.HasValue)
            {
                const string insertSql = """
                    INSERT INTO hik_person_map (company_id, user_id, hik_person_id, updated_at)
                    VALUES (@CompanyId, @UserId, @HikPersonId, NOW())
                    """;
                await conn.ExecuteAsync(new CommandDefinition(insertSql, new { CompanyId = companyId, UserId = userId, HikPersonId = hikPersonId }, cancellationToken: ct));
            }
            return true;
        }, ct);
    }

    public async Task<(long? UserId, long? CompanyId)?> FindMappingAsync(string hikPersonId, CancellationToken ct = default)
    {
        const string sql = "SELECT user_id AS UserId, company_id AS CompanyId FROM hik_person_map WHERE hik_person_id = @HikPersonId LIMIT 1";
        return await QueryAsync<(long? UserId, long? CompanyId)?>(async conn =>
        {
            var res = await conn.QueryFirstOrDefaultAsync<dynamic>(new CommandDefinition(sql, new { HikPersonId = hikPersonId }, cancellationToken: ct));
            if (res == null) return null;
            return ((long?)res.UserId, (long?)res.CompanyId);
        }, ct);
    }

    public async Task<bool> StoreEventAsync(BiometricEventRow evt, CancellationToken ct = default)
    {
        const string sql = """
            INSERT INTO biometric_events (
                company_id, user_id, hik_person_id, event_type, auth_method,
                auth_result, occur_time, device_id, device_serial, device_name,
                area_id, area_name, hik_serial_no, current_event, attendance_status,
                batch_id, direction, processed, raw_payload, received_at
            ) VALUES (
                @CompanyId, @UserId, @HikPersonId, @EventType, @AuthMethod,
                @AuthResult, @OccurTime, @DeviceId, @DeviceSerial, @DeviceName,
                @AreaId, @AreaName, @HikSerialNo, @CurrentEvent, @AttendanceStatus,
                @BatchId, @Direction, @Processed, @RawPayload, @ReceivedAt
            )
            """;
        return await QueryAsync(async conn =>
        {
            try
            {
                int rows = await conn.ExecuteAsync(new CommandDefinition(sql, evt, cancellationToken: ct));
                return rows > 0;
            }
            catch
            {
                return false;
            }
        }, ct);
    }

    public async Task<IReadOnlyList<BiometricEventRow>> FindPendingEventsAsync(int limit, CancellationToken ct = default)
    {
        const string sql = """
            SELECT 
                id AS Id,
                company_id AS CompanyId,
                user_id AS UserId,
                hik_person_id AS HikPersonId,
                event_type AS EventType,
                auth_method AS AuthMethod,
                auth_result AS AuthResult,
                occur_time AS OccurTime,
                device_id AS DeviceId,
                device_serial AS DeviceSerial,
                device_name AS DeviceName,
                area_id AS AreaId,
                area_name AS AreaName,
                hik_serial_no AS HikSerialNo,
                current_event AS CurrentEvent,
                attendance_status AS AttendanceStatus,
                batch_id AS BatchId,
                direction AS Direction,
                processed AS Processed,
                processed_at AS ProcessedAt,
                process_error AS ProcessError,
                raw_payload AS RawPayload,
                received_at AS ReceivedAt
            FROM biometric_events
            WHERE processed = 0
            ORDER BY occur_time ASC
            LIMIT @Limit
            """;
        return (await QueryAsync(conn => conn.QueryAsync<BiometricEventRow>(new CommandDefinition(sql, new { Limit = limit }, cancellationToken: ct)), ct)).AsList();
    }

    public async Task MarkEventProcessedAsync(long eventId, string? direction, string? error, CancellationToken ct = default)
    {
        const string sql = """
            UPDATE biometric_events
            SET processed = 1,
                processed_at = NOW(),
                direction = COALESCE(@Direction, direction),
                process_error = @Error
            WHERE id = @EventId
            """;
        await QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(sql, new { EventId = eventId, Direction = direction, Error = error }, cancellationToken: ct)), ct);
    }

    public Task<string?> GetSettingAsync(string key, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<string?>(new CommandDefinition(
            "SELECT setting_value FROM system_settings WHERE setting_key = @Key LIMIT 1",
            new { Key = key },
            cancellationToken: ct
        )), ct);

    public async Task SaveAttendanceBiometricPunchAsync(
        long userId,
        DateOnly workDate,
        DateTime? punchInAt,
        DateTime? punchOutAt,
        string? inAuthMethod,
        string? outAuthMethod,
        string? inAreaName,
        string? outAreaName,
        string? inDevice,
        string? outDevice,
        int lateMinutes,
        bool isLate,
        double durationHours,
        CancellationToken ct = default)
    {
        await QueryAsync(async conn =>
        {
            const string checkSql = "SELECT id, punch_in_at, punch_out_at FROM attendance WHERE user_id = @UserId AND work_date = @WorkDate LIMIT 1";
            var existing = await conn.QueryFirstOrDefaultAsync<dynamic>(new CommandDefinition(checkSql, new { UserId = userId, WorkDate = workDate.ToString("yyyy-MM-dd") }, cancellationToken: ct));

            if (existing == null)
            {
                const string insertSql = """
                    INSERT INTO attendance (
                        user_id, work_date, status, mode, within_geofence,
                        punch_in_at, punch_out_at, in_auth_method, out_auth_method,
                        in_area_name, out_area_name, in_device, out_device,
                        late_minutes, late, duration_hours, created_at, updated_at
                    ) VALUES (
                        @UserId, @WorkDate, 'PRESENT', 'OFFICE', 1,
                        @PunchInAt, @PunchOutAt, @InAuthMethod, @OutAuthMethod,
                        @InAreaName, @OutAreaName, @InDevice, @OutDevice,
                        @LateMinutes, @IsLate, @DurationHours, NOW(), NOW()
                    )
                    """;
                await conn.ExecuteAsync(new CommandDefinition(insertSql, new
                {
                    UserId = userId,
                    WorkDate = workDate.ToString("yyyy-MM-dd"),
                    PunchInAt = punchInAt,
                    PunchOutAt = punchOutAt,
                    InAuthMethod = inAuthMethod,
                    OutAuthMethod = outAuthMethod,
                    InAreaName = inAreaName,
                    OutAreaName = outAreaName,
                    InDevice = inDevice,
                    OutDevice = outDevice,
                    LateMinutes = lateMinutes,
                    IsLate = isLate ? 1 : 0,
                    DurationHours = durationHours
                }, cancellationToken: ct));
            }
            else
            {
                long attendanceId = (long)existing.id;
                DateTime? currentIn = (DateTime?)existing.punch_in_at;
                DateTime? currentOut = (DateTime?)existing.punch_out_at;

                DateTime? finalIn = punchInAt ?? currentIn;
                DateTime? finalOut = punchOutAt ?? currentOut;
                if (currentIn.HasValue && punchInAt.HasValue && punchInAt.Value > currentIn.Value)
                {
                    finalIn = currentIn.Value;
                }
                if (currentOut.HasValue && punchOutAt.HasValue && punchOutAt.Value < currentOut.Value)
                {
                    finalOut = currentOut.Value;
                }

                const string updateSql = """
                    UPDATE attendance
                    SET 
                        punch_in_at = @FinalIn,
                        punch_out_at = @FinalOut,
                        in_auth_method = COALESCE(@InAuthMethod, in_auth_method),
                        out_auth_method = COALESCE(@OutAuthMethod, out_auth_method),
                        in_area_name = COALESCE(@InAreaName, in_area_name),
                        out_area_name = COALESCE(@OutAreaName, out_area_name),
                        in_device = COALESCE(@InDevice, in_device),
                        out_device = COALESCE(@OutDevice, out_device),
                        late_minutes = CASE WHEN @PunchInAt IS NOT NULL THEN @LateMinutes ELSE late_minutes END,
                        late = CASE WHEN @PunchInAt IS NOT NULL THEN @IsLate ELSE late END,
                        duration_hours = @DurationHours,
                        status = CASE WHEN status = 'ABSENT' THEN 'PRESENT' ELSE status END,
                        updated_at = NOW()
                    WHERE id = @Id
                    """;
                await conn.ExecuteAsync(new CommandDefinition(updateSql, new
                {
                    Id = attendanceId,
                    FinalIn = finalIn,
                    FinalOut = finalOut,
                    InAuthMethod = inAuthMethod,
                    OutAuthMethod = outAuthMethod,
                    InAreaName = inAreaName,
                    OutAreaName = outAreaName,
                    InDevice = inDevice,
                    OutDevice = outDevice,
                    PunchInAt = punchInAt,
                    LateMinutes = lateMinutes,
                    IsLate = isLate ? 1 : 0,
                    DurationHours = durationHours
                }, cancellationToken: ct));
            }
            return true;
        }, ct);
    }
}
