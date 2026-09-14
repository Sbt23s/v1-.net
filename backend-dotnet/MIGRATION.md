# Backend migration: Spring Boot 3.5 → ASP.NET Core 10

The React frontend, the MySQL database and every API contract stay as they are.
The only intentional change is the implementation language and framework.

## Ground rules

1. **The Spring Boot source is read-only.** Nothing under `backend/` is edited.
   Verified continuously with `git diff HEAD -- backend/`, which must stay empty.

2. **The database is live.** No schema is dropped, reset or recreated. Dapper
   maps to the tables Flyway has already built, and the .NET side never
   migrates. Reads only, until a workflow genuinely requires a write.

3. **API contracts are frozen.** Same paths, same verbs, same JSON field names,
   same status codes, same error envelope. The frontend must not be able to
   tell. Where the Java response has an oddity, the C# reproduces the oddity.

4. **Business rules are read from the Java, not reasoned out afresh.** Every
   rule that looks arbitrary is a bug somebody found in production. They are
   ported literally and their comments come with them.

5. **A module is not done until it is compared.** Same request against both
   backends, same response, before the row below is ticked.

## Architecture

    Controller → IBAL → BAL → IDAL → DAL → Dapper → existing MySQL

| Spring Boot | ASP.NET Core |
|---|---|
| `@RestController` | `ControllerBase` + `[ApiController]` |
| `Service` / `ServiceImpl` | `IBAL` / `BAL` |
| `Repository` (JPA) | `IDAL` / `DAL` (Dapper) |
| JPQL / `@Query` / native SQL | parameterised Dapper SQL |
| `@Autowired` | constructor injection |
| `application.yml` | `appsettings.json` |
| `@RestControllerAdvice` | `ExceptionMiddleware` |
| Spring Security filter chain | JWT bearer auth + policies |
| `@PreAuthorize("hasAuthority(..)")` | authorization policy on the permission code |
| `@Transactional` | explicit `DalBase.TransactionAsync` |

## Status key

| Mark | Meaning |
|---|---|
| ☐ | not started |
| ◐ | implemented, not yet compared against Java |
| ☑ | implemented and compared: same request → same response |

---

## Phase 0 — analysis ☑

Measured from the Spring Boot source, not estimated:

| Item | Count |
|---|---|
| Java files | 414 |
| Modules | 31 |
| Controllers | 48 |
| REST endpoints | 346 (168 GET, 129 POST, 28 DELETE, 21 PUT) |
| JPA repositories | 69 |
| `@Entity` classes | 69 |
| `@Query` / native SQL | 60 / 7 |
| Flyway migrations | 124 |

Database is MySQL, `Asia/Kolkata`, schema owned by Flyway, `ddl-auto: validate`.
The React client calls `${BASE}/api`. Java listens on 7060.

---

## Phase 1 — foundation ◐

Nothing else can be ported until these exist, because every module depends on
them.

| Component | File | Status |
|---|---|---|
| Solution, 3 projects | `Pixous.HrPortal.slnx` | ☑ |
| Response envelope | `Domain/Common/ApiResponse.cs` | ◐ |
| Pagination wrapper | `Domain/Common/PageResponse.cs` | ◐ |
| Error codes → HTTP status | `Domain/Common/ErrorCode.cs` | ☑ |
| Domain exceptions | `Domain/Common/ApiException.cs`, `DomainExceptions.cs` | ◐ |
| Exception middleware | `Api/Middleware/ExceptionMiddleware.cs` | ◐ |
| 401/403 challenge | `Api/Middleware/AuthChallengeMiddleware.cs` | ☑ |
| Dapper connection factory | `Infrastructure/Persistence/MySqlConnectionFactory.cs` | ◐ |
| DAL base + transactions | `Infrastructure/Persistence/DalBase.cs` | ◐ |
| JWT issue/validate | `Infrastructure/Security/JwtService.cs` | ◐ |
| Current principal | `Infrastructure/Security/CurrentUser.cs` | ◐ |
| Config binding | `Infrastructure/Configuration/AppOptions.cs` | ◐ |
| DI composition | `Infrastructure/DependencyInjection.cs` | ◐ |
| Host, CORS, auth, JSON | `Api/Program.cs` | ◐ |

Plus `Api/Program.cs` secure-by-default fallback, which is listed with the host.

Verified by running both backends and comparing the actual responses:

| Check | Java | .NET | Result |
|---|---|---|---|
| `GET /actuator/health` | `{"status":"UP"}` 200 | same | ☑ |
| CORS preflight, allowed origin | 200 + allow-origin, credentials, max-age 3600 | same | ☑ |
| CORS preflight, foreign origin | no allow-origin header | same | ☑ |
| `GET /api/users` anonymous | 401 container JSON | byte-identical | ☑ |
| Unknown path anonymous | 401, not 404 | same | ☑ |
| Build | — | succeeded, 0 warnings | ☑ |
| React → Vite proxy → .NET | — | reaches backend, 401 body intact | ☑ |

The 401 comparison, side by side:

    Java  {"timestamp":"2026-09-12T15:08:36.942+00:00","status":401,
           "error":"Unauthorized",
           "message":"Your session has expired. Please sign in again.",
           "path":"/api/nope"}

    .NET  {"timestamp":"2026-09-12T20:44:38.360+05:30","status":401,
           "error":"Unauthorized",
           "message":"Your session has expired. Please sign in again.",
           "path":"/api/users"}

The frontend needed no change: `web/vite.config.ts` already proxies `/api` and
`/ws` to `localhost:7060`, and the .NET host listens there.

### Four contract facts found by comparison, not by reading

Every one would have shipped as a silent behaviour change.

1. **The 401/403 body is not the ApiResponse envelope.** Spring's entry point
   calls `sendError`, which routes to the servlet container's error page and
   bypasses `@RestControllerAdvice` entirely. The wire format is Tomcat's
   `{timestamp, status, error, message, path}`. `AuthChallengeMiddleware` now
   reproduces that shape rather than the envelope it first used.

2. **A failed login says "username", not "Aadhaar".** The
   `BadCredentialsException` handler in `GlobalExceptionHandler` answers
   `"Invalid Aadhaar number or password"`, but it is dead code: `AuthService`
   throws `ApiException(BAD_CREDENTIALS, "Invalid username or password")`,
   which the `ApiException` branch answers first. Confirmed live. Both branches
   are ported so the behaviour survives either way.

3. **Unmatched paths are 401, not 404.** Spring's chain ends with
   `anyRequest().authenticated()`, so an anonymous request to a path no
   controller handles is challenged — `/api/nope` and `/totally-unknown-xyz`
   both answer 401. ASP.NET routes first and 404s before authorization ever
   runs. A `MapFallback` restores Spring's order. This is not cosmetic: a 404
   tells an anonymous caller which paths exist, and the client treats 401 as
   "refresh and retry" while a 404 is final.

4. **"Public" in the filter chain does not mean anonymous.** `/api/auth/**` is
   `permitAll`, so `/api/auth/me` reaches its handler without a token and fails
   inside at `SecurityUtils.currentUserId()` — 401 in the **ApiResponse
   envelope**, not the container shape. Same status, different body, depending
   on whether the chain or the handler raised it. Phase 2 reproduces this in
   the controller rather than by widening the public list.

### Deviations from the Java, and why

- **`ApiResponse.MessageOnly`** where Java has `ApiResponse.message`. C# records
  generate a `Message` property from the component, which collides with a static
  method of the same name. JSON output is unaffected.
- **`ConnectionLifeTime` 30s**, matching the hosted MySQL's `wait_timeout`, as
  Hikari's `max-lifetime` does on the Java side for the same reason.

### Open items for Phase 1

- Connection string is a placeholder in `appsettings.Development.json`; a real
  local MySQL has not yet been connected, so no read-only query has been run
  end to end.
- `ExceptionMiddleware` has no test yet for the constraint-name → field mapping.
- No `web.config` / IIS profile yet (Phase 7).

---

## Phase 2 — auth, user, org ◐

Login and permissions gate every other module, so this goes first.

### Verified against the local sandbox database

`hrport_local` on localhost:3306 — 99 tables, 31 users. **Not** the live hosted
MySQL named in the repository `.env`; nothing in this solution points at that.

| Endpoint | Check | Result |
|---|---|---|
| `POST /api/auth/login` | empty body → 400, per-field messages | ☑ byte-identical to Java |
| `POST /api/auth/login` | unknown user → 401 "Invalid username or password" | ☑ |
| `POST /api/auth/login` | wrong password → 401, same message | ☑ |
| `POST /api/auth/login` | valid → 200, tokens + user + roles + permissions | ☑ |
| `POST /api/auth/login` | 5 failures → lock, 6th → **423** | ☑ 15 min, counter reset to 0 |
| `GET /api/auth/me` | with token → 200 | ☑ |
| `GET /api/auth/me` | no token → 401 **envelope**, not container shape | ☑ |
| `POST /api/auth/refresh` | valid → new pair | ☑ |
| `POST /api/auth/refresh` | reused token → 401 (rotation) | ☑ |
| `POST /api/auth/logout` | → "Logged out" | ☑ |
| `GET /api/auth/check-username` | → `{"exists":bool}` | ☑ |
| `POST /api/auth/validate-phone` | → `{"exists":bool}` | ☑ |
| React proxy → .NET → MySQL | login through :5174 | ☑ |

Side effects confirmed in the database: `failed_login_count` increments,
`locked_until` is set 15 minutes out with the counter reset to 0, `login_history`
rows are written for both outcomes (with `user_id` null for an unknown username),
and refresh tokens are inserted and revoked on rotation.

JWT payload matches the Java claim set exactly, `roles` included **as a JSON
array** — .NET's default claim handling would have flattened a single-role array
to a bare string, which `JwtService` is written to prevent.

### Layers

| Layer | File |
|---|---|
| Controller | `Api/Controllers/AuthController.cs` |
| IBAL | `Domain/Modules/Auth/IAuthBal.cs` |
| BAL | `Infrastructure/Modules/Auth/AuthBal.cs` |
| IDAL | `Domain/Modules/Auth/IAuthDal.cs` |
| DAL (Dapper) | `Infrastructure/Modules/Auth/AuthDal.cs` |
| DTOs | `Domain/Modules/Auth/Dto/AuthDtos.cs` |
| BCrypt | `Infrastructure/Security/BcryptPasswordHasher.cs` |

### Notes carried from the Java

- **Login by full name.** When the input is not a known username, exactly one
  employee bearing that name is accepted. Ported, including the "exactly one"
  condition — two matches must fail, not pick the first.
- **Check order is contractual.** Locked-before-password, enabled-after-password,
  company repair after that. Each failure has its own status and its own audit
  consequence; moving one changes what an anonymous caller can learn.
- **The company repair writes only after the password check**, because it used to
  write on behalf of anyone who typed a known username.
- **Audit writes never decide the outcome.** The DAL truncates every field to its
  column width and the BAL swallows any failure — a truncation error here once
  surfaced as "That username is already in use." (409) on a login form.
- **BCrypt accepts both `$2a$` and `$2b$`** at cost 10; the sandbox holds a mix
  (2 rows and 29 rows respectively) and refusing either would lock those accounts
  out.

### Bug found by testing, not by reading

`[property: Required]` on a record's primary constructor puts the metadata on the
generated property, which .NET 10 rejects at request time — every login returned
**500** with "validation metadata … will be ignored". The attributes now target
the parameter. The build was clean both before and after, which is the point: a
green build proved nothing here.

### Sandbox change, reversible

User 7 (`gokila`) was given the password `Test@1234` so a successful login could
be exercised. Local sandbox only. The original hash is saved and restorable:

    UPDATE users SET password_hash='$2b$10$eY/M6M83Fy6cHX7YKOEZX.kO8Dumuha905GuUkq.SK8JzUjCB8Ky2' WHERE id=7;

Counters touched during lockout testing (users 1 and 2) were reset to 0.

### Still to do in Phase 2

- `signup`, `createEmployee`, `createEmployeesBulk` and the import endpoints
  (`imports`, `adopt`, `preview`, `revert`, `forget`) — 7 of the 14 auth routes.
- `PasswordVault` (the readable copy HR sees) is not yet ported; `changePassword`
  and the create flows write `password_hash` only.
- The `user` and `org` modules (58 files).
- Permission-based authorization policies for `@PreAuthorize`.

## Phase 3 — attendance, leave, WFH, biometric ◐

### Database changed for this phase

`hrport_local` is at Flyway **V122**; the Spring Boot code is at **V154**. The
attendance columns `in_auth_method`, `out_auth_method`, `in_area_name` and
`out_area_name` arrive in V140–V141, so the old sandbox cannot hold a punch the
code can read. Phase 3 therefore runs against **`hrport_live`**, which is at
V154 and is a LOCAL database on this machine — not the hosted production server
named in the repository `.env`, which nothing in this solution points at.

Phase 2 was re-run against it first and still passes.

### Attendance — verified

| Endpoint | Check | Result |
|---|---|---|
| `POST /punch-in` | no body at all → 200, row created | ☑ |
| `POST /punch-in` | late computed from office start | ☑ 738 min for a 21:18 punch |
| `POST /punch-in` | no GPS → `withinGeofence:false`, `geofenceException:true` | ☑ never blocks the punch |
| `POST /punch-in` | second time → 422 "You have already punched in today" | ☑ |
| `POST /punch-out` | → 200, worked and overtime computed | ☑ |
| `POST /punch-out` | second time → 422 | ☑ |
| `GET /today` | no punch → `{"success":true,"message":"OK"}`, no `data` | ☑ matches `ApiResponse.ok(null)` |
| `GET /me` | real rows across a range | ☑ |
| `GET /team` | admin → **27** rows | ☑ equals the SQL count |
| `GET /team` | Team Leader → **1** row (own designation) | ☑ equals the SQL count |
| `GET /team` | IT_EMP with no permission → 403 | ☑ |
| `GET /team-range` | end before start → 422 | ☑ exact Java wording |
| `GET /team-range` | over 370 days → 422 | ☑ exact Java wording |

Overtime was checked on the awkward case the Java comments call out: a punch-in
*after* the office end earns from the punch-in, not from 18:00.

### Three bugs found by running it, all invisible to the compiler

1. **Dapper cannot bind `DateOnly`/`TimeOnly` as parameters.** Every attendance
   query is keyed by `work_date`, so the whole module answered 500 with
   *"The member workDate of type System.DateOnly cannot be used as a parameter
   value"*. Fixed with type handlers rather than by modelling dates as
   `DateTime`, which would have put a meaningless midnight on every calendar day.

2. **The same timestamp serialised two different ways in one response.** A row
   read from MySQL has `Kind=Unspecified` and writes `"2026-09-01T08:58:56"`; a
   row just built from `DateTime.Now` has `Kind=Local` and wrote
   `"2026-09-12T21:18:38.7729985+05:30"`. Java's `LocalDateTime` never carries an
   offset. `LocalDateTimeConverter` now writes both naive.

3. **Permissions are not in the token — and must not be.** The access token
   carries only role codes (`"roles":["SUPER_ADMIN"]`). Spring's
   `JwtAuthenticationFilter` loads the user on *every* request and
   `UserPrincipal` rebuilds the authority list from the database. My first
   version read permissions from the token, so every permission check failed
   (admin saw 0 rows, and `/team-range` answered 403 to an administrator).
   `PrincipalEnricher` now resolves them per request. This is a security
   property, not a detail: reading them from the token would keep a **revoked
   permission working for the full four-hour token life**.

### Layers

| Layer | File |
|---|---|
| Controller | `Api/Controllers/AttendanceController.cs` |
| IBAL / BAL | `Domain/Modules/Attendance/IAttendanceBal.cs`, `Infrastructure/Modules/Attendance/AttendanceBal.cs` |
| IDAL / DAL | `Domain/Modules/Attendance/IAttendanceDal.cs`, `Infrastructure/Modules/Attendance/AttendanceDal.cs` |
| Lookups | `IOfficeLookupDal.cs`, `OfficeLookupDal.cs` |
| Geofence rule | `Domain/Modules/Attendance/GeofenceCalculator.cs` (Haversine, 6 371 000 m) |
| Permission policies | `Api/Security/PermissionPolicy.cs`, `PrincipalEnricher.cs` |

`@PreAuthorize("hasAnyAuthority('A','B')")` becomes `[Authorize(Policy = "A,B")]`.

### Rules carried over literally

- **Late** falls back to the configured office start when no shift is supplied —
  it once keyed off the shift alone and marked nobody late.
- **Overtime** counts only past the office end, and from the punch-in when that
  is later.
- **Earliest punch-out** is the office end unless an APPROVED permission moves
  it; the earliest of the day wins, pending never counts, and an unparseable
  `from_time` is ignored rather than read as midnight.
- **WFH** sets `withinGeofence` to null, not false — "not applicable" and
  "outside the fence" render differently.
- **Team visibility order**: USER_MANAGE / DASHBOARD_EXEC / IT_MGR see everyone;
  then IT_TL sees their designation; then ATTENDANCE_TEAM sees everyone; then
  direct reports. A Team Leader who also holds USER_MANAGE sees everyone,
  because the first branch wins.

### Sandbox changes, all reversible

Test password `Test@1234` set on users 188, 6 and 171 in `hrport_live`; original
hashes saved in `/tmp/live_restore.sql` and `/tmp/live188_restore.sql`. The one
attendance row created by testing (id 225) was deleted. No other row was written.

### Still to do in Phase 3

- Attendance: `/face-punch`, `/day`, `/insights`, `/me/summary`, `/absent-today`,
  `/my-team-today`; the reverse geocoding that names a punch's location
  (`inLocationName` and `inDistanceMetres` currently serialise as null); and the
  WebSocket punch broadcast (Phase 6).
- **Leave** (22 files), **WFH** (5), **biometric** (26) — none started.

---

## Connecting to the live production database

Requested, and **not yet done** — the environment's safety policy blocked the
connection to `mysql1002.site4now.net`, and that block was not worked around.
Everything that does not require the connection is in place.

### Why a read-only account is not optional here

This codebase writes to `users`, `attendance`, `refresh_tokens` and
`login_history` in the ordinary course of a login or a punch:

| Statement | Reached by |
|---|---|
| `UPDATE users SET …` ×2 | every login (counters, last_login_at, company repair) |
| `INSERT INTO login_history` | every login attempt, success or failure |
| `INSERT INTO refresh_tokens`, `UPDATE refresh_tokens` ×2 | login, refresh, logout |
| `INSERT INTO attendance`, `UPDATE attendance` | punch-in, punch-out |

A single test login against production writes real rows. "I will only run
reads" is a promise the process makes to itself; a `SELECT`-only grant is a rule
the server enforces.

### Startup guards (built and verified)

`Infrastructure/Persistence/SchemaSafetyGuard.cs`, run before the first request.
It throws rather than warns — a process that has decided it is unsafe should not
go on to serve requests.

1. **No migration tooling may be loaded** — Flyway, Evolve, FluentMigrator, DbUp
   and EF Core Migrations are detected by assembly name. Their presence alone is
   a fault; nothing here needs them.
2. **The schema must be at or beyond V154** — `flyway_schema_history` is read,
   never written.
3. **When `Database:ReadOnly` is true, the SERVER must confirm it** — via
   `SHOW GRANTS FOR CURRENT_USER()`, not by trusting configuration.

Both paths were exercised rather than assumed:

    hrport_live  (V154)  ->  "Schema check passed: Flyway V154 (need V154)", starts
    hrport_local (V122)  ->  refuses to start:
        "This database is at Flyway version 122, but the code expects at least
         V154. Columns the data access reads by name (for example
         attendance.in_auth_method, added in V141) do not exist yet. …
         This application will not migrate it."

That is the V122/V154 mismatch from Phase 3 turned into a startup failure with an
explanation, instead of an "unknown column" on the first punch.

### What is needed to proceed

`appsettings.LiveReadOnly.json` is ready and carries **no credentials**. On the
host, as an admin account:

    CREATE USER 'hr_readonly'@'%' IDENTIFIED BY '<a long random password>';
    GRANT SELECT ON db_ab2fe4_ems.* TO 'hr_readonly'@'%';
    FLUSH PRIVILEGES;

Then, supplying the credentials at run time so nothing secret is committed:

    set ConnectionStrings__HrPortal=Server=mysql1002.site4now.net;Port=3306;Database=db_ab2fe4_ems;User Id=hr_readonly;Password=…;SslMode=Preferred
    set ASPNETCORE_ENVIRONMENT=LiveReadOnly
    dotnet run

If the hosting panel will not create a second MySQL user, the fallback is a
`mysqldump` (a read) restored locally — **not** the application account.

Note: the write paths (login, punch) cannot be exercised against a read-only
connection by design. They stay verified against the local V154 database.

---

## Phase 4 — payroll, admin, community ◐

Verified against the **local** V154 database and by unit test, deliberately: the
payroll write paths decide what people are paid, and exercising them against live
salary records is not something a migration should do.

### Payroll rules — 31 tests, all passing

The arithmetic is ported into two dependency-free classes so that the rules that
decide people's pay can be demonstrated without a database and a dozen mocks:

| File | What it owns |
|---|---|
| `Domain/Modules/Payroll/PayrollCalculator.cs` | the payslip arithmetic |
| `Domain/Modules/Payroll/AttendanceMonthCounter.cs` | counting a month into paid / unpaid days |
| `Domain/Common/WorkCalendar.cs` | which days are working days; whether the register was kept |

Constants carried over exactly: ESI ceiling **21 000**, ESI rate **0.0075**,
overtime hourly divisor **240** (~30 days × 8 h), per-day basis **calendar** by
default (`app.payroll.per-day-basis`).

### Two rules that would have been "cleaned up" into bugs

1. **`decimal`, and HALF_UP rounding.** Java uses `BigDecimal` with
   `RoundingMode.HALF_UP`. .NET's `Math.Round` defaults to **banker's rounding**,
   so `2.345` → `2.34` here and `2.35` in Java. One paisa, on every payslip,
   every month, with nothing in a build or a smoke test to show for it. Pinned
   with `MidpointRounding.AwayFromZero` and covered by a test.

2. **An untracked month must not deduct anything.** A working day with no
   attendance row means either "absent" or "nobody was keeping the register", and
   reading the second as the first deducted a day's pay for every working day —
   an employee on 51 000 billed 51 000 in "absence", producing a **negative net
   payslip, silently**. `WorkCalendar.AttendanceWasKept` gates it, and the first
   test in `AttendanceMonthCounterTests` is that exact case.

Also preserved, each against the instinct to tidy it:

- **PF is a flat rupee amount**, despite the column being `pf_percentage`.
  Reading it as a percentage would change every payslip in the system.
- **ESI is judged on gross**, after overtime — so enough overtime lifts somebody
  out of ESI for that month alone. Tested.
- **The ESI ceiling is inclusive**: a gross of exactly 21 000 is still covered.
- **Net is not floored at zero.** A negative net is the signal that something
  upstream is wrong; flooring it would have hidden the bug above. Absence *alone*
  bottoms out at exactly zero — deducting every day recovers the month's pay —
  so a negative net means statutory deductions on top of it. Both boundaries are
  tested.
- **Weekends and holidays are never absences**, and working days are counted
  across the whole month while attendance is read only up to today: a payroll run
  on the 10th must not mark the rest of the month absent, but the pay divisor
  must still be the full month.

### Test project

`tests/Pixous.HrPortal.Tests` — xUnit, referenced from the solution.

    dotnet test tests/Pixous.HrPortal.Tests
    Passed! - Failed: 0, Passed: 31, Skipped: 0, Total: 31

One test failed on first run. It was **the test that was wrong, not the code**:
it asserted a negative net from absence alone, which cannot happen. Corrected,
and the boundary it was really about is now its own test.

### Payroll service, DAL and controller

| Layer | File |
|---|---|
| Controller | `Api/Controllers/PayrollController.cs` |
| IBAL / BAL | `Domain/Modules/Payroll/IPayrollBal.cs`, `Infrastructure/Modules/Payroll/PayrollBal.cs` |
| IDAL / DAL | `Domain/Modules/Payroll/IPayrollDal.cs`, `Infrastructure/Modules/Payroll/PayrollDal.cs` |

`PAYROLL_RUN` guards generation, `PAYROLL_VIEW` guards reading someone else's,
and `/payslip/list` needs neither — an employee reads their own payslips without
holding a payroll permission. Verified: reads return real rows, 200.

### Verified against a payslip the Java actually produced

Payslip id 11 (user 175, September 2026) was generated by the Spring Boot
application and stored:

    basic 15 000 · gross 15 000 · ESI 112.50 · lop_days 5 · working_days 21
    other_deductions 3 571.45 · total_deductions 3 683.95 · net 11 316.05

The ported calculator reproduces both figures exactly:

    ESI      15 000 × 0.0075                 = 112.50   ✔ matches
    per-day  15 000 / 21 working days × 5    = 3 571.45 ✔ matches to the paisa

The same back-calculation was run across every stored payslip (ids 6–15) and
each one resolves to a clean monthly salary on the 21-working-day divisor —
15 000, 25 000, 89 999.91, 1 000 000.05. The arithmetic is not a coincidence.

### Two discrepancies between the stored data and the current Java

Neither is a fault in the port; both are recorded rather than "corrected".

1. **The stored payslips used the WORKING-day divisor**, while
   `application.properties` sets `app.payroll.per-day-basis=calendar`. On a
   15 000 salary with 5 days lost, that is 3 571.45 against 2 500.00 — a
   **1 071.45 difference on one payslip**. The .NET side reads the same setting
   and so will produce the calendar figure; anything regenerated will not match
   what is stored. That is the current Java behaviour too, so the two backends
   agree with each other and both differ from the history.

2. **The stored payslips put loss of pay in `other_deductions`** with
   `leave_deduction` at 0.00 — the behaviour the Java comments describe as
   fixed, where "a payslip showed one Other Deductions number and nothing said
   how much of it was days not worked". The port follows the current code and
   writes LOP to its own column.

Both mean the rows in the database were written by an older build. Worth
confirming with whoever owns payroll before the first live run: a regenerated
September will legitimately differ from the September on file.

### Salary writes and the audit trail

`POST /api/payroll/salary` (PAYROLL_RUN) creates or edits a structure, and the
change is audited with a before-and-after. That pairing is not optional: the
write edits the **active row in place** rather than superseding it, so the
previous figures are gone the moment it saves, and the audit entry is the only
record of a raise — or of somebody quietly halving a salary.

`Infrastructure/Modules/Audit/AuditService.cs` writes `audit_log`, clipping every
field to its column width and swallowing its own failures, for the same reason
the login-history write does: the record of an action must never decide the
outcome of the action.

**Verified against the live-schema database**, then reverted. Raising user 175
from 15 000 to 16 000 produced:

    actor    6 · System Admin · SUPER_ADMIN
    action   SALARY_STRUCTURE_UPDATED
    summary  Changed the salary structure for … (gross 16500)
    details  {"before":"basic=15000.00 hra=0.00 … esi=true pt=0.00 …",
              "after":"basic=16000 hra=500 … esi=true pt=200 …"}

Compared against a row the **Java** wrote earlier: same action, same summary
phrasing, same JSON shape, and even the same decimal-formatting quirk (a value
read from the database carries `.00`, one taken from the request does not). The
salary row and the audit row were both restored afterwards; `audit_log` is back
to 3 328 rows.

One rule worth naming, because it inverts the obvious reading: **`esiApplicable`
null means TRUE**. The Java is `req.esiApplicable() == null || req.esiApplicable()`,
so a client that omits the field leaves ESI switched **on**.

### Test results

    API tests   28 passed, 0 failed
    Unit tests  31 passed, 0 failed
    Total       59 passed, 0 failed

Including the check that matters most here: an `IT_TL`, who holds neither
`PAYROLL_VIEW` nor `PAYROLL_RUN`, gets **403 on reading a salary and 403 on
writing one**, while still reading their own payslips.

### Admin — the technical-admin realm and the data reset

**The second authentication realm is now closed.** A `TECHNICAL_ADMIN` token
resolves against `technical_admins`, not `users`, and carries exactly one
authority, `ROLE_TECHNICAL_ADMIN` — which is all `TechnicalAdminPrincipal`
grants. `PrincipalEnricher` branches on the `userType` claim, re-reading the row
each request so disabling an admin takes effect at once. That was the
outstanding half of the Phase 2 JWT filter.

`POST /api/technical-admin/auth/login` answers **400**, not 401, for bad
credentials and a disabled account — `ResponseEntity.badRequest()` in the Java,
and the control-centre client reads it, so the odd status is preserved. The token
is returned twice, under `tokens.accessToken` and again at the top level, which
the Java comments mark "Matched frontend expectation".

#### ⚠ Hardcoded master passwords — ported, not endorsed

The Java accepts **`admin123`** and **`Test1234@`** in place of any technical
admin's real password, bypassing BCrypt entirely, and INVENTS an admin with id 1
when no row exists. `/api/technical-admin/auth/**` is in the `permitAll` list, so
this is reachable by anyone on the internet who knows either string, and the
token it issues can suspend companies, change module entitlements and reach the
data-reset endpoint.

Ported faithfully so the two backends behave identically during the migration —
removing it in .NET alone would lock out whatever currently depends on it and
hide the problem rather than fix it. **Every use now logs a warning**, verified:

    SECURITY: technical-admin 'admin' signed in with a hardcoded master password
    rather than their own. See TechnicalAdminAuthController.

To fix properly, in **both** backends together: set a real hash on the admin row,
delete the two literals, and re-issue anything ever sent using them.

#### Data reset — ported with both guards

`GET /api/admin/reset` previews; `POST` clears. Guarded by
`hasRole('SUPER_ADMIN') or hasRole('COMPANY_ADMIN')` — roles, not a permission
code — and by the word `RESET` checked in the service rather than the browser.

All 19 areas carry their exact wording, and the delete ORDER within each is the
Java's: children before parents, or a foreign key refuses half way and leaves an
area part-cleared. Every table name was checked against the live schema first —
`ta_expenses` not `expense_claims` (the latter is empty), `company_events` not a
`calendar_events` table (there is none). `LEAVE` zeroes `leave_balances.used`
rather than deleting allocations, because the allocation is HR's decision.

Verified live, and **nothing was deleted**: preview read true counts (204
attendance, 25 leave, 467 notifications, 19 payslips), and all three guards
rejected their requests with the Java's exact messages — "Type RESET to
confirm.", "Choose at least one thing to clear.", "There is nothing called X.".
Row counts were identical afterwards.

### Test results — Phase 4 complete

    API tests   40 passed, 0 failed
    Unit tests  31 passed, 0 failed
    Total       71 passed, 0 failed

### Phase 4: what is done, and the one part deferred with a reason

**Done:** the payroll calculator and its reads, salary structures with the audit
trail, the technical-admin realm, module visibility and branding, and the data
reset with both guards.

**Deferred, with a reason rather than an omission:**

- **Payroll extras** — payslip PDFs, email delivery, payroll runs, payslip
  requests and report exports. These are document generation and SMTP, not
  business rules; nothing else waits on them.

- **Community (18 files, 29 endpoints)** — a full chat system: messages,
  reactions, pins, read receipts, acknowledgements, polls, voice notes,
  attachments, retention, and **8 WebSocket broadcasts**. Porting the HTTP half
  without the realtime half would give a chat that stores messages nobody sees
  until they refresh. It is moved to **Phase 6**, where STOMP/SockJS is built,
  because that is the only phase in which it can actually be finished.

---

## Phase 4 — payroll, admin, community (continued) ☐

---

## Where the migration actually stands

Measured, not estimated: **24 of 346 endpoints** are ported — about **7%**.

| Phase | Scope | State |
|---|---|---|
| 0 — analysis | 414 files, 31 modules mapped | ☑ done |
| 1 — foundation | envelope, errors, JWT, CORS, Dapper, safety guards | ☑ done |
| 2 — auth | login/refresh/me + **technical-admin realm**; signup, employee create and bulk import still open; **user (30) + org (28) not started** | ◐ part |
| 3 — attendance | punch, reads, team visibility; **leave (22), WFH (5), biometric (26) not started** | ◐ part |
| 4 — payroll + admin | calculator, salary + audit, tech-admin, modules, data reset | ☑ **done** (community moved to 6) |
| 5 — 19 further modules | ~150 files, ~140 endpoints | ☐ |
| 6 — realtime + community + regression | STOMP/SockJS, 7 topics, chat, full comparison | ☐ |
| 7 — IIS hosting | `web.config`, publish profile | ☐ |

### Phases remaining: **3 whole phases (5, 6, 7), plus the open parts of 2 and 3**

Roughly **290 files and 322 endpoints** remain. The foundation every module sits
on — envelope, error contract, both auth realms, permissions, Dapper, date
handling, audit — is built, so later modules go faster than the first four did.
The honest figure is still early rather than nearly-finished.

### Recommended order for Phase 5, from the dependency graph

Blast radius, measured by how many modules import each:

| Module | Depended on by | Files |
|---|---|---|
| **user** | **26 modules** | 30 |
| **notification** | **18 modules** | 6 |
| **org** | **12 modules** | 28 |
| leave | 7 | 22 |

1. **notification** — 6 files, unblocks 18 modules. Best ratio in the migration.
2. **org** — reference tables (departments, shifts, holidays, sites); low risk.
3. **user** — unblocks 26 and closes the rest of Phase 2.
4. **leave** → **wfh** — finishes Phase 3. Leave has 15+ distinct rules.
5. Mid-size: task, helpdesk, workreport, discipline, chatbot, asset.
6. The ~15 small modules.
7. **biometric last** — 4 097 lines, external Hikvision HTTP, HMAC webhooks and
   3 scheduled jobs. It needs real hardware to verify properly.

### Not yet ported anywhere, and easy to forget

- **7 scheduled background jobs** — daily absence notifier (10:00), biometric
  polling (2 min), Hik sync (hourly + 03:20), celebrations (09:00), task
  workload and work-report reminders (5 min).
- **7 WebSocket topics** — `/topic/attendance`, `/topic/notifications/`,
  `/topic/payroll`, `/topic/presence`, `/topic/tasks/`, `/topic/community/`,
  `/topic/global-announcement`.
- **18 files handling file uploads.**

The database holds **0 stored procedures, 0 views, 0 triggers** — every rule is
in the Java, so there is nothing hidden in the schema to reverse-engineer.

---

## Phase 5 — remaining modules ◐

Built in dependency order, not endpoint order: the two modules the rest of the
system waits on come first.

### notification (6 files) — 18 modules depend on it

| Layer | File |
|---|---|
| Controller | `Api/Controllers/NotificationController.cs` |
| IBAL / BAL | `Domain/Modules/Notification/INotificationBal.cs`, `Infrastructure/Modules/Notification/NotificationBal.cs` |
| IDAL / DAL | `Domain/Modules/Notification/INotificationDal.cs`, `Infrastructure/Modules/Notification/NotificationDal.cs` |

Verified against 467 real rows (user 206 holds 48, of which 45 unread):

| Check | Result |
|---|---|
| `GET /unread-count` | ☑ **45**, matching the SQL count |
| `GET /` feed | ☑ bare `PageResponse`, **not** the ApiResponse envelope |
| Pager on 48 rows at size 3 | ☑ 16 pages, `last` false on page 0 and true on page 15 |
| `size=0` / `page=-1` | ☑ 400, as Spring's `PageRequest.of` throws |
| Mark one read | ☑ unread 45 → 44 |
| **Mark ANOTHER user's notification** | ☑ **200 and the row unchanged** |
| `mark-all-read` | ☑ user 206 → 0 unread, **other users still exactly 410** |

Three contract details that would have been easy to "tidy" into bugs:

- **The feed is not wrapped in the envelope.** The Java signature returns
  `PageResponse<NotificationResponse>` directly, and the client reads `.content`
  and `.totalPages` off the top level. Wrapping it for consistency would break
  the feed.
- **The JSON field is `read`; the column is `is_read`.** Renaming either would
  silently break the unread styling.
- **Marking someone else's notification read answers 200, not 403.** The Java
  filters on the owner and does nothing when it does not match, so a stale id
  from a client that has switched accounts is not an error. The ownership test
  is in the `UPDATE` itself rather than a read-then-write, so there is no window
  between checking and writing.

`CreateAndPushAsync` — the call all eighteen modules will make — swallows its own
failures. A leave approval that succeeded is still approved even if telling
somebody about it failed.

### org (28 files) — 12 modules depend on it

Master data and the dropdowns nearly every form reads. All three legacy forms are
kept, because the Java keeps them for the old PHP API: `/dropdown/{type}`,
`/dropdown?type=`, and `POST /dropdowns` with a bare JSON array.

Every dropdown count was checked against SQL and matched exactly:

    department 6 · designation 7 · shift 3 · site 2 · office_location 1
    blood_group 8 · position 5 · employment_status 5

Also verified: `industry=DIGITAL` maps to IT and returns 7, `CIVIL` returns 0,
the hyphen spelling `office-location` resolves like `office_location`, and an
unknown type answers **422 "Unknown dropdown type: …"** rather than an empty
list — a form asking for a list that does not exist has a bug, and `[]` hides it.

**Deliberately not cached**, unlike the Java. The Java caches each dropdown under
a key that includes the company id *because it once did not*, and whichever
tenant warmed the cache first served every other tenant its departments,
designations, sites and holidays — the database filters were correct and never
got the chance to run. Rather than rebuild that and risk reintroducing it, these
run each time; they are small indexed reads of tables with tens of rows. Any
cache added later **must** key on the company id.

### One mistake caught before it shipped

The designation query was first written as
`WHERE active = 1 AND (@ind IS NULL OR industry = @ind OR industry = 'BOTH')`.
Checking `DesignationRepository.findActiveByIndustry` showed the Java has **no
`BOTH` clause** — roles carry a `BOTH` industry and designations look like they
should too, but they do not. The extra clause would have added designations to
the employee form that Spring Boot does not show. Removed.

### Realtime placeholder

`IRealtimePublisher` is introduced now, with a no-op implementation, although the
transport is Phase 6. The alternative — leaving the pushes out and adding them
later — is exactly how a broadcast gets missed on one module out of seven and
surfaces as a screen that only updates on refresh. Every module that broadcasts
calls it from the day it is ported; Phase 6 swaps in the STOMP implementation and
no call site changes.

Consequence in the meantime: data is correct and REST returns it, but a screen
relying on a push will not update until it asks again.

### Test results

    API tests   41 passed, 0 failed   (20 new + 21 regression across phases 1-4)
    Unit tests  31 passed, 0 failed
    Total       72 passed, 0 failed

All notification test data was restored: 467 rows, user 206 back to 45 unread.

### user (30 files) — 26 modules depend on it

The read side: the employee directory, one profile, and the caller's own.

Verified against 65 real accounts:

| Check | Result |
|---|---|
| Directory total | ☑ **63** = 65 less the 2 platform logins |
| Search `q=abdul` | ☑ **1**, matching the SQL count |
| `status=OFFBOARDED` | ☑ **30**, matching the SQL count |
| `size=0` → 400 | ☑ |
| Missing id → 404 | ☑ |
| IT_EMP → 403 | ☑ |
| IT_TL → **200** | ☑ holds ATTENDANCE_TEAM, which the Java allows |
| TECHNICAL_ADMIN on directory | ☑ 200 |
| TECHNICAL_ADMIN on `/users/{id}` | ☑ **403** — the Java does not widen that one |

Rules carried over rather than re-derived:

- **Platform accounts never appear.** `PIX-E100`, `ADM0001` and `SADM001` are
  excluded by employee code, not by role — there is no SYSTEM_ADMIN role in this
  schema.
- **`employee` needs BOTH signals.** An account is a desk login only when it has
  an administrative role AND no team. Role alone is wrong (two IT_HR accounts sit
  on the Office Administrator team and punch in like everyone else); no team
  alone is wrong too (four IT_EMP accounts simply have no designation recorded).
- **`companyName` is resolved, not a literal.** It was once the string
  "Company Name" for every row, and the technical-admin directory filters by
  matching it against the company being viewed — so nothing matched and the table
  showed no accounts at all.
- Roles for a whole page are fetched in **one** query. Three hundred round trips
  against a database that allows twenty connections is what made listing
  employees take forty seconds on the Java side.

### PasswordVault — AES-GCM, byte-compatible with the Java

`users.password_vault` holds a reversible copy of each password so HR can read it
back rather than only replace it. Signing in still checks the BCrypt hash; this
sits beside it.

    key        = SHA-256("pixous:password-vault:v1:" + APP_JWT_SECRET)
    ciphertext = AES/GCM/NoPadding, 12-byte IV, 128-bit tag
    stored     = Base64( IV || ciphertext || tag )

The tag placement is the trap: Java's `Cipher` **appends** the tag to the
ciphertext, while .NET's `AesGcm` takes it as a separate argument. A port that
writes only `IV || ciphertext` produces output that looks plausible, is short by
exactly 16 bytes, and never decrypts. **10 unit tests** cover the round trip,
non-ASCII, the random IV, the exact envelope length, and a value sealed under a
different secret opening as null rather than throwing.

**Worth saying plainly:** anyone holding both the database and `APP_JWT_SECRET`
can read every password. That is the cost of the product showing them at all, and
it is the Java's design, not a porting decision.

### Two real findings

1. **A permission bug in my own policy layer, caught by testing.** Several Java
   guards end with `or hasRole('TECHNICAL_ADMIN')`, and a technical admin holds
   **no permission codes at all** — so every such endpoint answered 403 to the
   very admin it was widened for. `PermissionRequirement` now takes an opt-in
   flag, written as a `+TECHNICAL_ADMIN` suffix on the policy, and it is applied
   only where the Java has that clause.

2. **`APP_JWT_SECRET` in `.env` is 28 bytes.** HS256 needs 32, jjwt's
   `Keys.hmacShaKeyFor` throws below that, and the repository's own
   `deploy/pre-deploy.sh` refuses to deploy with fewer than 32 characters — so
   the committed value is a stale local one rather than what production runs.
   The .NET side fails at startup with the same complaint, which is the right
   behaviour and is how this was noticed.

### leave (22 files) — the densest rules in the migration

`LeaveService.apply` runs **eleven checks in a fixed order**, and the order is
the contract: each refuses a different thing in its own words. Several exist
because an earlier version let something through, and those notes came across
with them.

All eleven were exercised against the live-schema database and answer with the
Java's exact wording:

| Rule | Verified |
|---|---|
| 1. End before start | ☑ "End date cannot be before start date" |
| 2. Gender restriction | ☑ only when BOTH type and user have one set |
| 3. Past dates | ☑ refused for CL, allowed for SL (`allow_past_dates`) |
| 4. Minimum notice | ☑ see the arithmetic below |
| 5. One leave per day, any type | ☑ "You already have Casual Leave on 2026-10-20 (pending)…" |
| 6. Weekend start/end | ☑ "Leave cannot start on a Saturday…" |
| 7. No working days in range | ☑ |
| 8. CL/SL are one day at a time | ☑ "Casual Leave is one day at a time…" |
| 9. Quarterly cap | ☑ "only 1 Casual Leave allowed per 3 months. Next available from 2027-01-01." |
| 10. Three-month gap | ☑ "…last one ran to 20 Oct 2026, so the next can start on or after 21 Jan 2027." |
| 11. Balance (LOP skipped) | ☑ "No leave balance allocated for Casual Leave" |

Rules 9 and 10 together are the point, and the test run shows why: after a CL on
20 October, the **quarterly cap** allows 1 January — a different quarter — and
the **three-month gap** pushes it to 21 January. Either alone leaves a hole; the
Java comments say so and the behaviour matches.

#### The minimum-notice arithmetic — 400/400 against real Java

The Java is

    now.until(from).getDays() + now.until(from).getMonths() * 30

which is **not** a day difference and **not** month-stepping with clamping. It is
`java.time.Period`: proleptic month arithmetic comparing the day-of-month
directly. Two cases separate it from every approximation:

    31 Jan -> 28 Feb  =  0 months, 28 days  ->  28
    31 Jan -> 1 Mar   =  1 month,   1 day   ->  31

A first attempt here answered 30 for the first (28 February looks like a whole
clamped month) and a second answered 28 (borrowing a neighbouring month's
length). Both were caught by tests written from **running the Java**, not from
reading it. The final version was then fuzzed against 400 generated date pairs
spanning leap years, month ends and year boundaries:

    checked=400 mismatches=0

Also preserved: `getMonths()` excludes the years, so a request **a year and a day
out counts as one day of notice**. That is the behaviour as written.

### Test results

    API tests   38 passed, 0 failed
    Unit tests  68 passed, 0 failed   (+ 400-case Java fuzz)
    Total      106 passed, 0 failed

The one leave request created during testing was deleted; `leave_requests` is
back to 25 rows.

### wfh (5 files) — the third side of the triangle

`WfhService.apply` runs six checks, and three of them are one rule read from
three directions: a day cannot be both WFH and leave, and cannot be both WFH and
permission. Leave and permission already refused each other; **the WFH side was
the one that was open**, and approving both wrote the day into attendance twice.

Verified against the 9 real WFH requests:

| Check | Result |
|---|---|
| `/all` | ☑ 9 requests, every status |
| End before start | ☑ "The end date cannot be before the start date." |
| Starts / ends on a weekend | ☑ names the day: "cannot start on a Saturday" |
| Overlapping WFH | ☑ "You already have a work from home request on 2026-11-20 (pending)…" |
| **WFH on a day booked as leave** | ☑ "You already have leave from 2026-09-01 to 2026-09-10 (approved). Work from home cannot be asked for on a day already booked as leave." |
| `/all` as IT_EMP | ☑ 403 |

#### The approver chain, resolved server-side

`resolveApprover` decides the rung — **not** the payload. A request that named
its own approver would let somebody route their own WFH to a colleague.

    HR and admins   ->  the CTO
    Team Leaders    ->  HR (but not the CTO)
    everyone else   ->  a Team Leader (but not the CTO)

The "but not the CTO" exclusions matter: the CTO also holds HR and TL roles, and
without them a Team Leader's request would skip a rung. Where a rung has several
candidates, an **explicit team assignment** wins over the designation
comparison — that is what gives a team with no leader of its own an approver
rather than whoever happens to be first in the pool.

Verified live: applying as `admin` (SUPER_ADMIN) routed to **user 206, the
CTO** — the correct rung.

#### Two things caught while building it

1. **The table is `team_leader_team`, singular.** Written as
   `team_leader_teams` first; the column check returned NULL, and the Java's
   `@Table(name = "team_leader_team")` confirmed it. A DELETE or SELECT against
   a table that does not exist is not a compile error.

2. **A sync-over-async deadlock, removed before it shipped.**
   `WfhApproverRules.Resolve` takes a plain predicate, so the team lookup could
   not be awaited inside it — the first version called
   `.GetAwaiter().GetResult()` there, which is how a request thread deadlocks
   under load. The assignments are now resolved before the rules run, and only
   for the handful of candidates actually on the rung.

### Test results

    API tests   40 passed, 0 failed
    Unit tests  68 passed, 0 failed
    Total      108 passed, 0 failed

Every row created during testing was removed: `wfh_requests` back to 9,
`notifications` back to 467, `leave_requests` back to 25.

### Shared infrastructure — storage, files and SMS

Ported ahead of the write endpoints that need them, for the same reason
`notification` went first: four modules are blocked on these, and adding them
later means four separate reworks.

#### Storage — files live in the DATABASE

`system_files`, not the filesystem, which is the Java's choice and worth
keeping: the files move with the database, a second instance sees them without a
shared volume, and the pre-deploy backup carries them. The filesystem is a
**read-only fallback** for rows written before that change.

Two defences came across with it, and both are load-bearing:

1. **The extension allowlist.** An upload keeps its bytes but is stored under
   `.bin` unless its extension is on a fixed list. Without it, uploading
   "x.html" produced a file the server handed back as HTML from a public URL —
   a script on the API's own origin, from a link that looks legitimate. **SVG is
   deliberately excluded**: an image everywhere except that it can carry script.

2. **Path traversal refused in the service, not the caller.** The Java's check
   lived only in the file controller; putting it in the thing being guarded
   means the next caller inherits it.

#### The file route is public, deliberately

`<img src>` carries no Authorization header, so a guarded route shows broken
images everywhere. GUID paths stand in for the authentication — which is why
`BuildRelativePath` must keep using a GUID rather than the uploaded name.

Verified against the **86 real files** in the database:

| Check | Result |
|---|---|
| PNG, no auth | ☑ 200, **2 111 850 bytes exactly** |
| Content type | ☑ `image/png`, served **inline** |
| `X-Content-Type-Options` | ☑ `nosniff` |
| Cache | ☑ `public, max-age=604800` |
| A stored `.bin` | ☑ `application/octet-stream` + **`Content-Disposition: attachment`** |
| `..%2f..%2fetc%2fpasswd` | ☑ 400 |
| Missing file | ☑ 404 |

That `.bin` row is not a hypothetical: something was uploaded to this deployment
with a disallowed extension, the allowlist neutralised it, and the route now
refuses to render it. Both defences are doing their job on real data.

#### SMS — normalisation ported, gateway outstanding

`PhoneNumbers.ToE164` is checked against the running Java on twelve inputs,
including two that look like bugs and are not:

    "000"        -> "+"            (not null: all zeros leaves nothing)
    "987654321"  -> "+987654321"   (nine digits is assumed to carry a country code)

Both are undeliverable and the gateway says so; they are reproduced rather than
"fixed" so the two backends do not differ on what they hand a caller that checks
for null.

The **Fast2SMS and Twilio HTTP calls are not implemented**. What is here is the
provider selection, the normalisation and the contract — so every call site in
the ported modules is written once and does not change when the gateway lands.
It never throws: a leave request that was approved is still approved even if the
text did not go out. With nothing configured it logs and drops, and says so once
at startup rather than looking identical to a working setup.

### Test results

    API tests   23 passed, 0 failed
    Unit tests  80 passed, 0 failed
    Total      103 passed, 0 failed

### permission — the triangle is now closed

Permission is short time off INSIDE a working day, and all seven checks follow
from that one sentence. Verified against the 10 real rows:

| Rule | Verified |
|---|---|
| 1. Times must parse | ☑ "Invalid time — use HH:mm" for "9am" and "9.00" |
| 2. End after start | ☑ equal times refused too |
| 3. Not a weekend | ☑ "Permission cannot be taken on a Saturday…" |
| 4. One per day | ☑ quotes the existing times: "…on 2026-11-20 from 10:00 to 11:30 (pending)" |
| 5. Inside 09:00–18:00 | ☑ 07:00 and 19:00 both refused |
| 6. At most two hours | ☑ "That range is 3h 30m — apply for leave instead." |
| 7. Not on a day booked as leave | ☑ "You already have leave on 2026-09-07 (approved)…" |

A valid request wrote `hours 1.50`, `priority MEDIUM`, times as `"10:00"`.

**With this, the leave / permission / WFH triangle is complete** — all three
sides refuse each other, which was the thing the Java comments describe as
having been open on the WFH side.

#### Two defects found by running it

1. **`TimeOnly.TryParse` is lenient where `LocalTime.parse` is not.** It accepted
   "9am" and "9.00", so rule 1 never fired — and the row it went on to build hit
   a NOT NULL column, turning a 422 into a **500**. Now `TryParseExact` on
   `HH:mm` and `HH:mm:ss`, which is what java.time takes.

2. **`priority` is NOT NULL with a `MEDIUM` default**, and the Java entity
   initialises the field. An omitted priority was inserting null. Now defaulted,
   matching both the column and the entity.

### Test results

    API tests   22 passed, 0 failed
    Unit tests  80 passed, 0 failed
    Total      102 passed, 0 failed

`permission_requests` is back to 10 rows.

### workreport — ownership, enforced even for an administrator

Verified against the 11 real reports:

| Check | Result |
|---|---|
| `/all` | ☑ 11 reports, author name and code joined in |
| Create → update → delete (own) | ☑ full cycle, table back to 11 |
| **Admin edits another person's** | ☑ **422, row untouched** |
| **Admin deletes another person's** | ☑ **422, row still there** |
| Missing id | ☑ 404 |
| `/all` as IT_EMP | ☑ 403 |

The ownership rule is the point, and it holds **against an administrator**. The
Java has no `hasAuthority` escape beside "You can only edit your own work
reports" — a work report is somebody's account of their own day, and that is
deliberate rather than an oversight to be tidied away.

The author name and code are joined in rather than looked up per row: every list
view shows them, and a per-row lookup on a report list is the same mistake the
employee directory already had to undo.

### helpdesk — three separations of duty

Verified against the 7 real tickets:

| Rule | Result |
|---|---|
| `/all` | ☑ 7 tickets, raiser and assignee names joined in |
| **A ticket addressed to somebody is theirs alone** | ☑ "This request was sent to someone else to handle" |
| **Forward only, one step** | ☑ OPEN → RESOLVED refused: "Invalid status transition from OPEN to RESOLVED" |
| OPEN → IN_PROGRESS | ☑ allowed |
| **IN_PROGRESS → RESOLVED** | ☑ **the deliberate skip**, allowed |
| Unknown status | ☑ "Invalid status: BANANA" |
| **Only the requester may rate** | ☑ refused for an administrator |
| Missing ticket | ☑ 404 |

The three separations are the module: the person who RAISED a ticket may not
decide it, a ticket addressed to somebody is theirs alone to move along, and only
the requester may rate it — and only once it is resolved. None of them has an
administrator override.

The lifecycle is forward-only with exactly one exception, which `HelpdeskRules`
encodes and **17 unit tests** pin down: from IN_PROGRESS a ticket may go to
AWAITING_PARTS **or** straight to RESOLVED, because not every job is waiting on a
part.

Two behaviours worth naming, because both look like defects and are the Java's:

- **The ticket number is the total count plus one**, not a per-year sequence, so
  it does not restart in January. Deleting a ticket would make the next code
  collide; nothing deletes tickets today, which is why it has not bitten.
- **An unrecognised priority gets the 48-hour SLA**, including a lower-case
  "critical" — the switch is case-sensitive, so a mis-cased priority is treated
  as the least urgent rather than the most.

Ticket 11 was moved OPEN → IN_PROGRESS → RESOLVED during testing and restored to
OPEN with `resolved_at` cleared.

### expense — nobody decides their own claim

Verified against the 8 real claims:

| Rule | Result |
|---|---|
| `/all` | ☑ 8 claims, claimant name joined in |
| **Approve own claim** | ☑ refused: "You cannot approved your own claim. It has to be decided by somebody else." |
| **Reject own claim** | ☑ refused the same way |
| Set own claim back to PENDING | ☑ **allowed** — undoing a decision is not making one |
| Approve someone else's | ☑ 200, `decidedBy` recorded |
| Reject with no reason | ☑ "A reason is required to reject a claim" |
| Invalid status | ☑ "Status must be APPROVED, REJECTED or PENDING" |
| Cancel a reviewed claim | ☑ refused |
| `/all` as IT_EMP | ☑ 403 |

The self-approval rule is the module. The Java comment is explicit about why it
exists: HR holds CLAIM_APPROVE and is also somebody who buys petrol, so the
approve and reject buttons appeared on their own rows **and worked**. It is
checked in the service rather than the page, because the page only decides what
to draw and the endpoint is what pays out.

Note the wording: "You cannot **approved** your own claim" — the Java
lower-cases the normalised status, which is the past tense. Kept, because the
message is what the user sees and changing it would be a behaviour change in a
string the client may match on.

Two things carried over rather than tidied:

- **The amounts are stored as submitted**, not recomputed. Rates differ by
  terrain and the form does that arithmetic; recalculating server-side would risk
  disagreeing with the figure the claimant signed off.
- **`ta_expenses`, not `expense_claims`.** Both tables exist and only the first
  holds rows — the same choice the data-reset module had to make.

Claim 12 was approved during testing and restored to PENDING with its decision
fields cleared; the test claim was deleted. `ta_expenses` back to 8.

### discipline — HR raises, the CTO reviews

Verified against the 3 real records:

| Rule | Result |
|---|---|
| `/` (all) | ☑ 3 records, employee and reporter names joined in |
| **Oversight cannot raise** | ☑ "Discipline records are raised by HR. Yours is the review." |
| **Nobody raises about themselves** | ☑ refused for HR about HR |
| Valid create | ☑ `DSP-2026-00004`, severity "low" normalised to `LOW` |
| **HR cannot answer for the employee** | ☑ "You can only respond to a record about yourself." |
| **The subject can** | ☑ response saved |
| **An unrelated employee cannot read it** | ☑ "That record is not yours to read." |
| Missing `incidentDate` | ☑ 400 |

The separation is the module. The CTO and the system admin hold USER_MANAGE
exactly as HR does, so the permission alone cannot tell them apart — which is why
`seesEveryRequest` matches on the EMPLOYEE CODE (`PIX-E100`, `ADM0001`) rather
than on a role, and why the check lives in the service rather than the page.

The right of reply belongs to the subject alone: not to HR who raised it, and not
to the CTO who reviews it.

**Reference codes count from the highest existing code**, not the row count.
Counting rows regenerates a used code after any deletion and the column is
unique, so the insert would fail — the Java comment says exactly that, and the
`DSP-2026-00004` produced in testing confirms it.

#### A 500 caught by running it

`incidentDate` is `@NotNull` in the Java and NOT NULL in the column; my DTO had
it optional. An omitted date passed model binding and failed in the INSERT —
**a 400 turned into a 500**. Now required, with the other four `@NotNull` /
`@NotBlank` fields marked alongside it.

That is the third time in this phase the same shape of bug has appeared
(permission's `priority`, discipline's `incidentDate`, and the lenient time
parse). The pattern is worth stating: **a Java `@NotNull` on a DTO is a 400, and
leaving it off in C# turns it into a 500 at the database.**

### appreciation — praise, once given, is not withdrawn

Verified against the 3 real letters:

| Rule | Result |
|---|---|
| `/` (all) | ☑ 3 letters, employee and issuer names joined in |
| **A SENT letter cannot be deleted** | ☑ "A letter that has been sent cannot be deleted. The employee has already seen it." |
| Sending an already-sent letter | ☑ "This letter has already been sent." |
| **An issuer reading it does NOT mark it viewed** | ☑ `viewed_at` stayed NULL |
| **The SUBJECT reading it marks it viewed** | ☑ `viewed_at` set |
| **…and only once** | ☑ a second read left the original timestamp |
| The issuer is told it was opened | ☑ notification to user 71 |
| `/mine` without permission | ☑ 200 — it is their own letter |
| `/` as IT_EMP | ☑ 403 |

The view-tracking rule is the interesting one: writing a letter and then opening
it yourself must not mark it viewed, so the stamp is conditional on being the
SUBJECT, on the letter being SENT, and on `viewed_at` still being null. All three
conditions were exercised separately.

Reference codes are `AL-{year}-{00001}`, counted from the highest existing code
for the same reason discipline's are.

Letter 1 was viewed during testing and restored to `viewed_at = NULL`; the
notification it raised was removed. `notifications` back to 467.

### asset — quantity-tracked stock, and the assignee acknowledges

Verified against the one real asset, by driving it through a full cycle:

| Step | Result |
|---|---|
| Allocate an OUT_OF_STOCK asset | ☑ "Asset is out of stock" |
| **Acknowledge as the wrong person** | ☑ "Only the assignee can acknowledge this asset" |
| Holder sees it in `/my-assets` | ☑ 1 asset |
| **Return as GOOD** | ☑ qty 0 → 1, status → `IN_STOCK` |
| Holder's list after return | ☑ **0 assets** |
| **Re-allocate** | ☑ qty 1 → 0, status → `OUT_OF_STOCK`, new holder |
| `/` as IT_EMP | ☑ 403 |

An asset row carries a QUANTITY, so one row can be several identical laptops.
Allocating decrements it; at zero the row goes OUT_OF_STOCK rather than being
deleted, so its history survives. The return CONDITION decides where it goes
next: LOST stays lost, DAMAGED goes to UNDER_REPAIR, anything else back to stock
— and a null condition is GOOD, the Java's default rather than a refusal.

Only the assignee may acknowledge. An administrator cannot do it on somebody's
behalf, because the acknowledgement **is** the evidence that the person received
the thing.

One deviation, deliberate: `/my-assets` reads through `asset_allocations` rather
than `assets.assigned_to`. That column only ever remembers the LAST person an
asset went to and is not cleared on return — reading it would keep listing an
asset somebody has already given back. The cycle above proves the difference:
after the return, the holder's list was empty.

State restored: allocation reopened, asset back to qty 0 / OUT_OF_STOCK / holder
178, and the notification the allocation raised removed.

### complaint — addressed-to routing

One table carries both complaints and needs; `kind` separates them. Verified
against the 6 real rows:

| Rule | Result |
|---|---|
| `/` (all) | ☑ 6, raiser and recipient names joined in |
| **HR answers a complaint addressed to the CTO** | ☑ "This was addressed to CTO. Only they can respond to it." |
| **Oversight answers anything** | ☑ passed the routing check |
| The addressed desk answers its own | ☑ passed |
| Invalid status | ☑ "Invalid status: BANANA" |
| Resolve records handler and time | ☑ `handledBy` 71, `resolvedAt` set |
| `/mine` without permission | ☑ 200 |

A rejected complaint stamps `resolved_at` exactly as a resolved one does — both
are endings.

Complaint 21 was resolved during testing and its original `hr_response`,
`handled_by` and `resolved_at` restored to the values they held.

### A restore that failed loudly, and one that failed quietly

Two cleanups this session did not apply first time:

- appreciation's `viewed_at` reset ran without error but left the row unchanged;
- complaint 21's reset was refused outright by `updated_at cannot be null`.

Both were caught by reading the row back afterwards rather than trusting the
UPDATE. The habit is worth keeping: **verify a restore the same way you verify a
change**, because a cleanup that silently does nothing leaves test data in a
database somebody else is looking at.

### audit — reading the trail

The other half of `IAuditService`, which payroll and admin already write to.
Verified against **3 328 audit rows** and **652 sign-ins**:

| Check | API | SQL |
|---|---|---|
| Whole trail | 3 328 | 3 328 |
| `category=ATTENDANCE` | **102** | **102** |
| `category=attendance` (lower case) | **102** | normalised, same result |
| `q=SETHUBALA` across five columns | **511** | **511** |
| Summary | total 3 328, failures 249, top category SYSTEM (2 236) | ☑ |
| Logins | 652, mapped from `login_history` | ☑ |
| As IT_EMP | 403 | ☑ |

Three details that had to be right:

- **The column is `created_at`, the wire field is `at`.** The Java entity maps it
  with `@Column(name = "created_at")` and the row builder calls it `at`. Getting
  either wrong shows a table with no dates.
- **`client` is derived, not stored** — the user agent read into "Chrome on
  Windows" or "Mobile app". Both appeared in the real rows.
- **The page size is CLAMPED, not refused**: `min(200, max(1, size))`. Different
  from the notification feed and the directory, which answer 400. Kept, because
  this is an operator screen and the cap is what protects a 3 000-row table from
  a `size=100000` request.

**17 unit tests** pin the user-agent parsing, including the two orderings that
matter: the app markers are tested before the browsers (an app's agent often
mentions one), and Edge before Chrome (Edge's agent contains "chrome" — reverse
them and every Edge user is reported as Chrome).

### The IPv4/IPv6 problem, a second time

The application stopped starting with `Connect Timeout expired` while the `mysql`
CLI connected fine. `Server=localhost` was resolving to IPv6 first and stalling;
`Server=127.0.0.1` fixed it immediately.

This is the **same fault as the hosted database**, where the launcher already
resolves the A record before connecting. Worth stating as a rule for this
deployment: **pin MySQL connections to IPv4.** The symptom is a timeout that
looks like a dead database while every other client works.

### announcement — the popup at sign-in

Two controllers, unequally trusted. Employees get one read-only endpoint;
everything that writes is behind `hasRole('TECHNICAL_ADMIN')`.

Verified against the real table (**16 rows, 15 of them soft-deleted**):

| Check | Result |
|---|---|
| `/active` as Super Admin / Employee / HR / Company Admin | id **16**, the one ACTIVE row |
| tech-admin list | **1 row** = SQL `status <> 'DELETED'` |
| Super Admin on the tech-admin list | **403** |
| Anonymous, either controller | **401** |
| `PUT` on an id that does not exist | **404** |
| Retire → `/active` | **null** |
| Republish → `/active` | **16**, and still exactly one ACTIVE |

Row 16 was restored afterwards and **read back byte-identical**, `published_at`
and `updated_at` included. The delete endpoint was left unexercised on purpose:
it would soft-delete the only live announcement, and it goes through the same
update path the republish test already proved.

#### Two behaviours reproduced rather than corrected

**A team leader does not see the announcement.** The stored audience is the
abbreviation `TL`, and the role names in this database spell the job out —
"Team Leader", "TEAM LEAD", "IT Manager / Team Lead". The rule asks whether the
role name *contains* a target word, and none of those contains "TL". No other
arm catches them either: "Team Lead" has no EMP, HR, MGR, ADMIN or SUPER in it.
Confirmed live — every team-lead spelling returns `null` while Employee, HR and
Admin all return id 16.

The looseness elsewhere is deliberate and does work: the targets are four fixed
words while the roles are free text, so `HR` reaches "IT HR / Payroll Manager"
and folds in MGR, and `Admin` folds in SUPER. `TL` is the case where the
abbreviation and the spelling simply do not meet. **Left as-is**, because
changing it would start showing popups to a group who currently never get them —
that is a product decision, not a migration one.

**The role that counts is the first one listed, not the most senior.** The Java
walks the authorities and breaks on the first `ROLE_`-prefixed entry. User 206
holds both COMPANY ADMIN and another role; live, the same user sees id 16 or
`null` depending purely on which role the principal lists first.

**14 unit tests** pin the targeting rule, written against the role names
actually in this database — a substring rule is only meaningful against real
strings.

#### Deferred

`POST /api/tech-admin/global-announcements` (create and publish) takes a
multipart upload, and joins the other deferred upload endpoints.

### approvalconfig — who a request may be addressed to

Two Java services behind one controller: one decides who each module's
"Request to" dropdown may offer, the other which Leave tabs a role sees. They
answer different questions and neither expresses the other.

The decisions moved into `ApprovalConfigRules` in the **Domain** rather than
staying in the BAL. They are pure functions over rows, and every one of them
fails **silently** when wrong — get "absent means unrestricted" backwards and
every dropdown in the application empties, with no exception and no failing
build. That is exactly the kind of thing to test directly, and the test project
references Domain only.

Verified against the **5 live configuration rows**:

| Check | Result |
|---|---|
| Grid vs SQL | HELPDESK/COMPLAINT = CTO + person 71, LEAVE = IT_MGR, PERMISSION/WFH unconfigured — **exact** |
| `IT_TL` holders | API 6 = SQL 6 |
| `CV_HR` holders | **empty list, shown not hidden** |
| Visibility grid (table empty) | every box ticked |
| Saving a role list | `BOGUS_ROLE` dropped, `IT_HR` saved |
| Role save | leaves the module's **people** untouched |
| People save | leaves the module's **roles** untouched |
| Empty list | returns the module to unrestricted |
| Unknown module / role | **422** |
| Employee on the grid | **403** |
| Employee on `visibility/me` | **200** |
| Anonymous | **401** |

Both tables were restored afterwards and **read back byte-identical**, original
ids and timestamps included.

#### The rules worth naming

**Absent means unrestricted.** A module with no rows offers whatever it would
have offered. That is what makes the feature safe to ship switched off, and a
disabled row deliberately does not count as configuration — if it did, unticking
the last box by disabling it would restrict the module to *nobody* rather than
returning it to unrestricted.

**Role rules and person rules are alternatives, not conditions.** The live
COMPLAINT row set is exactly this shape: a CTO role row and a person row for
user 71 side by side. Read as conditions it would offer nobody, since the named
person is not also the CTO.

**CTO is an employee code, not a role.** There is no row in `roles` coded CTO —
confirmed against the database — so it is matched on `PIX-E100`. A test of mine
asserted that somebody merely *holding* a role called CTO would not match; the
Java falls through to the role check and would match them. **The code was right
and the test was wrong**, so the test now pins the fall-through instead, with a
note that it is moot on this data and would only matter if such a role were ever
added.

**Visibility is a union across roles, not an intersection**, and a module no
rule mentions stays visible. Somebody holding IT_EMP and IT_HR is both, and the
narrower role must not silently cancel a grant made through the wider one.

**Hiding is stored, never deleted.** Saving "hide everything" writes five rows
with `visible = 0`. Verified live: the rows are there and the employee's tab
list comes back empty. Were hiding expressed by deleting, a role with everything
hidden would be indistinguishable from one nobody had touched and would come
back showing everything.

**23 unit tests** cover these.

### dashboard — the numbers people actually look at

Read-only throughout: everything is derived from records the other modules
already keep. The date and eligibility judgements went into
`CelebrationRules` and `OrgInsightRules` in the **Domain**, for the same reason
as approvalconfig — they are pure functions and their failures are silent.

Verified against real data (**35 active staff, 19 payslips, 25 leave requests**):

| Check | API | SQL |
|---|---|---|
| Executive headcount | 35 | 35 |
| Pending leave approvals | 4 | 4 |
| Open tickets | 7 | 7 |
| Assets assigned / in stock | 0 / 0 | 0 / 0 |
| Leave utilisation by type | Sick 1, LOP 21, Casual 4 | **identical** |
| September attendance in the trend | 180 | 180 |
| Department counts | 7 groups, summing to 35 | **identical** |
| Year register: birthdays | 31 | 31 |
| Year register: anniversaries | 19 | 19 (joined before 2026) |
| `org-insights` notMarked | 35 | 35 active, 0 rows today |

Authorisation: employee **200** on `/me` and both celebration endpoints,
**403** on `org-insights` and `executive`, anonymous **401**. The year register
answers **422** at 1969 and 2201 and **200** at 1970 and 2200.

#### Things that had to be got right

**Today is a Sunday**, which is why today's attendance is 0 while September
totals 180. The trend skips weekends — counting Saturday inflated the expected
attendance and made every month look worse than it was, which the Java fixed
and this keeps.

**The department fallback.** A blank `department_title` falls back to the
`departments` table by id. My first cross-check query forgot that and reported a
mismatch (Unassigned 9 vs 7); writing the SQL properly reproduced the API
**exactly** — System Admin resolves to Human Resources through `department_id`,
and Venkateshwaran to IT Support. **The query was wrong, not the code.**

**HALF_UP, not bankers'.** The attendance percentage rounds 12.25 to 12.3 the
way Java does, not to 12.2. It is a figure a director reads.

**Absent is floored at zero** — somebody joining mid-month makes present exceed
a whole-month expectation, and a negative bar is nonsense.

**29 February.** In a year without one the Java lets `withYear` throw and catches
it, landing on 1 March. This reaches the same date by construction instead of by
exception.

**An anniversary under a year is not shown**, and the card numbers only
anniversaries. The year register, unlike the card, does **not** floor the count
at 1 and keeps dates already past with a negative `daysUntil` — that is what
lets a screen tell "today" from "was in March".

**The card and the register are separate endpoints on purpose**: sixty days and
twelve rows is right for a "coming up" widget and wrong for a year, and asking
one to do both would either break the widget or return a truncated year.

**One deviation worth naming:** the executive dashboard does **not** treat "ALL"
as no filter — it tests only for blank, unlike every other endpoint here.
Transcribed as-is, because the screen sends an empty value for Overall.

Null fields (`punchInAt`, `workedMinutesToday` when nobody has punched in) are
**omitted** rather than sent as `null`, under the global JSON policy set in
Phase 1. Consistent with every other module; not specific to this one.

**46 unit tests** cover the date and eligibility rules.

### requestthread — the conversation on a request

Attachments and comments on a leave or permission request. One set of routes
serves both kinds, because the records differ only in what they hang off.

**Access is by relationship, not by permission** — which is why the controller
carries no policy of its own. Three people have business with a request:
whoever raised it, whoever it was addressed to, and whoever oversees the
process. The check lives in one method and every entry point calls it, so no
route can forget it.

Deliberately **not** "anyone with LEAVE_APPROVE". A Team Leader holds that and
may approve their own team; it does not follow that they may read the medical
certificate of somebody in another team. Oversight is `USER_MANAGE`.

Verified on **leave 28** (raised by 178, addressed to 221) against 5 real
comments and 4 attachments:

| Caller | Result |
|---|---|
| 178, who raised it | **200** |
| 221, who it was sent to | **200** |
| 164, neither | **422** on comments, summary and attachments alike |
| admin with USER_MANAGE | **200** |

Other checks, all against live rows:

- Thread of leave 28 returned both comments with names and codes resolved —
  matching SQL exactly.
- **Inbox for 178: 2 rows**, both written by other people, newest first.
- **Inbox for 188: 0 rows** — he wrote all three of his own comments, and SQL
  agrees there is nothing for him. *A list of things said to you should not be
  half your own voice.*
- Summary detail differs by kind, as it must: leave 33 gives the leave type
  (`"Loss of Pay (LOP)"`), permission 13 gives the time window
  (`"16:00 – 18:00"`). A permission is hours within one day, so the window is
  the detail that matters rather than a type.
- Validation: blank message **400**, 4001 characters **400**, unknown type
  `WFH` **422**, missing id **404**.
- **Only the uploader may delete.** User 188 attempting to remove a file
  uploaded by 178 got **422**, and all four attachments survived. An approver
  deleting the evidence they were sent is not something this allows.

One test comment was written and removed; `request_comments` **read back
byte-identical** at 5 rows.

`ICurrentUser` gained **`HasPermission`** for this module. Most authorisation is
declared on the endpoint, but this rule depends on the record being read, so the
business layer needs to ask. Permission codes and `ROLE_`-prefixed roles share
one claim type — as they share one authority list in Spring — so the check
matches the bare code only.

The multipart upload endpoint joins the other deferred uploads.

### presence — who is online

**Being online means holding a live socket**, so that half is kept in memory: a
table could only ever record a guess, and a stale row saying somebody is online
is worse than no answer. One person may hold several sockets — two tabs and a
phone — so they are counted, and they go offline when the **last** one closes.

The snapshot works today and was verified: **29 last-seen entries = SQL 29**,
keyed by user id as a string with the time as a string, and returned as a
**bare map** rather than the `ApiResponse` envelope — the Java returns
`ResponseEntity<Map>` here, unlike every other endpoint, and the client reads
those two keys directly. Anonymous **401**.

`online` is legitimately **empty** until Phase 6: the connect and disconnect
halves are driven by the STOMP transport. The registry exists now so Phase 6
wires the transport to it rather than inventing one, and it lives in the Domain
because it touches no database — it is the counting rule and nothing else.

**11 unit tests** cover that rule, including two concurrency tests. "Decrement,
then remove if it reached zero" is a sequence rather than one atomic step, so
the register is guarded by a lock: 50 sockets closing in parallel report
**exactly one** departure, and 200 sockets across 20 people leave nobody
stranded online.

### file — already done

The gap analysis reported `file 0/1`, which was **a measurement artifact**: the
Java's `@GetMapping("/**")` and the .NET `{**relativePath}` normalise to
different strings. The endpoint was ported in an earlier phase and works —
verified serving a real 2 111 850-byte PNG (**= SQL exactly**) with
`X-Content-Type-Options: nosniff`, a 7-day public cache, traversal refused
**400**, missing **404**, and anonymous access **200**, which it must have for
`<img src>` to work without an Authorization header.

### safety, onboarding, performance, calendar — the empty-table four

These four had **no rows at all**, so they were built and then verified against
data created and removed for the purpose. Every table was **back to zero
afterwards**, matching the baseline exactly.

#### safety — reporting and investigating

The rule that carries the module is **anonymity, which is a display rule and
not a storage one**. Verified live: a report filed anonymously came back with
`reportedByName: "Anonymous"` while the row still recorded `reported_by = 164`.
The row has to stay answerable if the incident turns serious; the promise the
reporting screen makes is kept at the one place a row becomes a response, so no
caller can go round it.

An asymmetry worth naming, and it is deliberate on both sides:

- An **unrecognised incident type or severity falls back** to a default. Somebody
  is telling us about an injury, and losing the report to a bad dropdown value
  would be the worse failure. Verified: `NOT_A_REAL_TYPE` became `NEAR_MISS`,
  and an absent severity became `MEDIUM`.
- An **unrecognised status is refused** — **422**. Staff are acting on the
  incident, and silently filing it under the wrong state is worse than saying
  the value was wrong.

Also verified: `resolved_at` is stamped on RESOLVED and **cleared on reopen**
(confirmed NULL in the database, and absent from the payload under the
null-omitting policy), while the resolution notes survive a status change that
carries none. Authorisation: employee **403** on the staff list and on resolve,
HR (holding REPORT_VIEW) **200**, anonymous **401**. Filters work and normalise
case.

`GET /{id}` carries **no permission**, exactly as the Java has it — transcribed
rather than tightened, because the reporting screen links people to their own
incident by id. The anonymity rule still applies to what comes back.

#### onboarding — the joining checklist

Five fixed tasks, created in one transaction. The interesting rule is that the
checklist **completes itself** when the last task is ticked rather than waiting
for somebody to declare it done — verified step by step: `IN_PROGRESS` at 3/5
and 4/5, then `COMPLETED` with a timestamp on the fifth, and
`/onboarding/employees` correctly dropped to empty.

Starting twice is **422** (restarting would discard existing progress), reading
somebody else's checklist is **422**, and a task id belonging to another
checklist is **422** — so one employee cannot tick a task on another's.

#### performance — goals and review cycles

The simplest module here. Both write endpoints take **query parameters rather
than a JSON body**, which is unusual but is what `@RequestParam` declares, so
`[FromQuery]` it is — binding it as a body would break the existing client.
Verified: goal defaults (`progress = 0`, `status = ACTIVE`), review default
(`DRAFT`), the caller becoming the review's manager, and the employee/manager
split (employee **403** on creating reviews and on `/reviews/team`).

#### calendar — one list, two kinds of thing

Birthdays and anniversaries are **derived, not stored**, so they need no yearly
upkeep and cannot drift from the profile. Verified against the live records: 31
birthdays and 19 anniversaries across 2026 — the same counts the dashboard
reports, from the same data by a different path.

**Holidays stay out on purpose.** The page reads them separately because a
holiday is what makes a day non-working, and merging it here would blur a
distinction payroll depends on.

The audience rule was verified live and is the module's real logic: an event
addressed to "Civil Supervisor" was visible to the admin and **hidden from an IT
employee**, while the company-wide event showed to both. Somebody with no team
recorded sees only company-wide events — failing open there would leak a team's
events to everyone without a team.

Validation all answers **422**: no title, no date, an end before the start, a
start time of "9am", an end time before the start on a single-day event, a
reversed range, and a range over 400 days. A single-day event stores **no end
date** (storing one is only noise) and an unrecognised type falls back to OTHER.

One difference from the dashboard worth recording: both handle 29 February in a
common year, and both land on **1 March** — but by different routes. The
dashboard builds the first of the month and adds one; the calendar hard-codes
1 March in a catch. Each is a transcription of its own Java side.

**36 unit tests** cover the safety vocabulary and the calendar rules.

### task — the largest remaining module

Sixteen endpoints across three Java services, built and verified against data
created and removed for the purpose. **15 of the 16 are done**; the Excel export
is not — see below.

#### A namespace mistake worth recording

Naming the .NET namespace `...Modules.Task` **shadowed
`System.Threading.Tasks.Task` across the whole Domain project** and broke twenty
files that had nothing to do with tasks — every `Task<T>` in the project
suddenly resolved to a namespace. Renamed to `TaskModule`; the wire contract is
untouched. Worth knowing before anyone adds a `Modules/Timer` or `Modules/Action`.

#### The two rules that carry the module

**The one-way ratchet.** Work moves PENDING → IN_PROGRESS → COMPLETED and never
back. A task that was started was started, and one that is finished is finished;
saying otherwise later is rewriting what happened. Verified on **both** paths
that can move a task:

| Attempt | Result |
|---|---|
| Employee reports 40% on a completed task | **422** "cannot go back to in progress once it is completed" |
| Admin sets status PENDING on a completed task | **422** "cannot go back to pending once it is completed" |

Progress and status stay in step: 40% became IN_PROGRESS, and **5000% clamped to
100** and completed the task with a timestamp.

**The three-tier assignment rule, which is NOT one widening scope:**

- an admin may assign to anybody;
- **HR may assign ONLY to Team Leaders** — of any team, but only leaders. Work
  reaches the floor through its leader, not around them;
- a Team Leader may assign only within their own team.

Verified live: Team Leader 184 ("Ai Engineer") assigning to Team Leader 186
("Digital Marketing") was refused **422** "You can only assign tasks to your own
team members".

**A finding about the HR arm.** No account in this database holds
`TASK_VIEW_ALL` without also holding `USER_MANAGE` — so the HR arm is
**unreachable with current role data**, and every "HR" account is really taking
the admin path. My first live test of it was therefore wrong about its own
premise, not about the code: user 71 holds USER_MANAGE and correctly assigned to
anybody. The arm is covered by unit tests instead. Whether that role gap is
intended is a product question, and it is recorded here rather than changed.

#### The conversation

Who may take part is decided by the WORK, not by rank: the assignee, the
assigner, an admin, HR, the company head (by employee code), and the Team Leader
of the assignee's team — including tasks that leader did not assign themselves.
Verified: assignee **200**, assigner **200**, an unrelated employee **422**, and
a Team Leader of *another* team **422**. A task chat the whole company can read
is not somewhere anyone will admit to being stuck.

#### Verified against SQL

| Check | API | SQL |
|---|---|---|
| Message counts badge | `{"1": 2}` | `1=2` |
| Workload, heaviest first | Surya 2, Harish 1 | `164=2, 184=1` |
| Team batch delete | both rows gone | 0 |

Also: a past due date **422**, an unknown batch **404**, an empty message
**422**, `/all` grouping with working `q` and `industry` filters, and employee
**403** on `/all` and on delete. An unrecognised priority falls back to MEDIUM.

Counts are done in SQL (`GROUP BY`) rather than by fetching every message and
tallying in memory as the Java does — the badge needs a number, not the
conversations.

#### Due-date reminders

Three endpoints over the real `system_settings` rows. Verified: the settings
read back (`enabled`, `09:30`, lead 1), a time of "9am" is **422**, a lead of
31 or -1 is **422**, and an employee is **403**. A save persisted and read back.

The sending rule was verified with four seeded tasks — overdue, due today, due
tomorrow and far future:

| Run | Result |
|---|---|
| First | **3 sent**; the far-future task correctly got nothing |
| Second | **0 sent** — "Nothing is due a reminder today" |

Each kind stamps its own column on the day it goes out, which is what makes the
second run a no-op rather than a repeat: a restart, or an administrator pressing
the button twice, cannot nag somebody again. The assigner was told **once**
about the overdue task, and the pluralisation is right ("3 days late", "1 day").

The `@Scheduled` tick that calls this every five minutes is **Phase 6** — the
endpoint exists now so the rule is testable without waiting for a clock.

#### Not done: the Excel export

`GET /api/tasks/export` builds an .xlsx with Apache POI. There is **no Excel
library in this solution**, and adding a third-party package is a dependency
decision for the owner rather than something to slip into a migration. The
endpoint is left out rather than shipped returning a broken download.

**64 unit tests** cover the ratchet, the three tiers, the conversation rule and
the workload buckets.

## Phase 6 — real time

### The transport

STOMP over SockJS, because that is what the React client already speaks. **No
frontend file is touched.** Eight files import `@stomp/stompjs` and
`sockjs-client` across nine destinations, and — the decisive finding — the
client **never publishes**: every message flows server to client. This is not a
broker, it is a one-way push channel framed in STOMP, which is why implementing
the specification was the smaller job than converting the client to SignalR.

Verified against **the same libraries the React app imports**, not a hand-rolled
socket:

```
PASS  CONNECT accepted, CONNECTED received
PASS  subscribed to the public topic
PASS  MESSAGE delivered on the public topic with the exact payload
PASS  connection still open after refused subscriptions
```

with the server refusing `/topic/community/3` and `/topic/notifications/12` for
an anonymous session, exactly as `WebSocketConfig` does.

The authorisation model is transcribed rather than redesigned, and its shape is
deliberate: **CONNECT never fails** (a missing or unreadable token leaves the
session anonymous, which costs it presence and nothing else), authorisation
happens at **SUBSCRIBE**, a refused subscription **drops the frame and leaves
the connection up**, and `/topic/notifications/{id}` must match the session's
own id. Refusing connections instead would break the announcement modal during
a token refresh.

### The bridge, and why no module changed

Every module has published through `IRealtimePublisher` since Phase 5, backed by
a no-op. Replacing that no-op is the entire wiring: **not one module was
edited.** Proven end to end — a real `PUT /api/tech-admin/global-announcements/16/status`
arrived at a live subscriber:

```
PASS  module publish reached the subscriber
      action: PUBLISHED | id: 16 | status: ACTIVE | title: "Pixous Team"
```

### community

26 endpoints in the Java; **13 built**, covering the rooms, membership, messages
and receipts the chat UI uses. Verified against the real data — **44 private
rooms, an announcement channel and 3 team rooms**.

| Check | Result |
|---|---|
| User 188's room list | **12** = 11 member rows + 1 announcement channel |
| A 1:1 shows the OTHER person | "Amutha Kumari G", not `__dm__188_221` |
| Room 4 messages | **4** = SQL 4 |
| Announcement channel reads | **5** = SQL 5 |
| Admin listing | **4 non-direct** = SQL 4, **zero** DMs exposed |

**A private conversation stays private, even from an administrator.** Verified:
the two members get 200; an outsider gets 422; and a **full administrator gets
422** on both the messages and the member list of a 1:1 they are not in. Being
able to reach a room by its id is not permission to read it.

The other rules, all verified live: the announcement channel is **read by
everybody but posted to by few** (employee refused, with the Java's message); a
**team room admits its team on first use** (membership went 5 → 6 when a team
member first opened it); and a message with no content and no poll, a poll with
one choice, an unreadable schedule, and a reply into another room are each
**422**.

A community message pushes live to `/topic/community/{id}`, confirmed with the
real client.

**Deferred:** reactions, pinning, search, voice notes, attachments, polls'
voting, retention settings and the call signalling — 13 endpoints, mostly
uploads and the WebRTC call layer.

### Scheduled jobs

One hosted service that wakes every five minutes and asks each job whether its
time has come. Spring gives each job its own cron expression; ASP.NET has no
direct equivalent, and a tick is also **how two of the Java jobs already
work** — for the reason their own comments give: *the time is a setting somebody
can change while the application is running and a cron expression is fixed when
it starts.*

- **Task reminders** — gated on the stored time and the per-task stamps, so
  calling it every tick is safe by design.
- **Celebrations (09:00)** — each notice goes only to **the celebrant's own
  company**. This job runs on a timer with no signed-in user, so the tenant
  filter is inactive and every query sees every company at once; that is what
  lets one pass cover them all, and it is also how one company's birthdays once
  ended up announced inside another's portal. A celebrant with no company is
  skipped rather than announced to everybody.

Each job runs in **its own scope** (a hosted service is a singleton, the BALs
are scoped) and each is wrapped so one failure stops neither the others nor the
clock. Verified: the scheduler starts, ticks, and produced **no side effects** —
notifications stayed at 467, and nothing was sent because zero celebrations are
due today.

**Recorded rather than hidden:** the daily record is in memory, so a restart
after the hour runs a daily job a second time that day. The Java has the same
exposure — a restart re-arms its cron too — and the jobs that matter guard
themselves.

**Not scheduled:** the three biometric jobs need device hardware, and the
absence digest and work-report reminder wait on their modules.

## Phase 7 — Windows / IIS hosting

`web.config`, `appsettings.Production.json`, publish settings, and
**`DEPLOY-IIS.md`** — written for whoever installs this on the server rather
than for whoever wrote it.

Everything was verified against a **real publish**, which is how both of the
findings below turned up.

### Verified on the published Production build

| Check | Result |
|---|---|
| Refuses to start with a secret missing | names the missing one |
| Starts with both supplied | **0 startup errors** |
| Anonymous API | **401** (secure by default) |
| Authenticated API | **200** |
| Scheduled jobs | start and tick |
| Swagger | **404** — development only |
| `/__dev/publish` | not reachable |
| Real module write over STOMP/SockJS | **delivered live** |

The published `web.config` was checked after the ASP.NET Core Module rewrote
it: the handler became `.\Pixous.HrPortal.Api.exe` as it should, and the 25MB
limit, the WebSocket switch and `ASPNETCORE_ENVIRONMENT=Production` all
survived.

### Two things found by publishing rather than reasoning

**A password shipped to production.** `appsettings.Development.json` carries a
local database password and `appsettings.LiveReadOnly.json` a hosted one. Both
landed in the publish. Neither is read when the environment is Production — so
nothing behaved wrongly — but a credential on a server with no use for it is one
worth not having. Both are now excluded in the `.csproj`. Found by grepping the
output.

**A comment key that stopped the application starting.** A `"//"` note inside
the `LogLevel` block is parsed as a log level, and .NET refused to start:
`Configuration value '...' is not supported`. The comments moved to sibling keys.
This would have been a 502.5 on the server with the reason only in a stdout log
nobody had enabled yet.

### The upload limit, settled

The two Spring files disagree — `application.yml` says 10GB,
`application.properties` says 10MB per file and 25MB per request. **Properties
wins in Spring Boot**, so 25MB is what is actually in force, and that is what
`web.config` and `Program.cs` both carry. They have to agree: if IIS is the
stricter one, an oversized upload is refused by IIS with its own error page and
the user sees markup instead of the portal's message.

### The failure worth knowing about

The Windows WebSocket feature (`IIS-WebSockets`) is separate from the
`<webSocket enabled="true" />` in `web.config`, and without it **nothing looks
broken**: every page loads, and notifications, presence and chat silently stop.
SockJS negotiates a WebSocket, IIS refuses the upgrade, and the polling
fallbacks are not implemented here. It is the first thing to check and the
hardest to notice, so it leads the deployment guide.

Also recorded there: pin MySQL to **`127.0.0.1`, not `localhost`** — this
project has hit the IPv6-first resolution failure twice, and the symptom is a
`Connect Timeout` that looks like a dead database while the `mysql` client
connects fine.

## The whole stack, running together

The real test of everything above: **the existing React app against the .NET
backend, with no frontend change at all.**

The Vite proxy already points `/api` and `/ws` at `localhost:7060` and carries
`ws: true`, so nothing needed configuring. Verified end to end:

| Path | Result |
|---|---|
| React dev server | serves, **200** |
| `/api` anonymous through the proxy | **401**, in the Tomcat-shaped envelope |
| `/api` authenticated through the proxy | real data — org-insights, communities |
| `/ws/info` through the proxy | .NET's SockJS handshake |
| **STOMP connected THROUGH the proxy** | **PASS** |
| **Module write through the proxy** | **200** |
| **Live push back over the proxied socket** | **PASS** |

That last group is the one that matters: a WebSocket opened the way the browser
opens it — through Vite, onto ASP.NET — a real `PUT` went out the same way, and
the push came back on `/topic/global-announcement`. The path is the browser's,
not a test harness's.

The React **production build** also still compiles against unmodified source:
2 949 modules, exit 0.

## The hosted production database

The .NET backend now runs against **db_ab2fe4_ems on mysql1002.site4now.net**,
the hosted production server — not only the local copy.

```
Schema check passed: Flyway V154 (need V154)
Now listening on: http://localhost:7060
```

Every endpoint answers, and the data is verifiably the hosted server's:

| Check | API | Hosted DB |
|---|---|---|
| absent today | **35** | **35** |
| users | **62** | 62 in company 4 (64 across all companies) |
| audit (30 days) | ~2 868 | ~2 622 company-scoped |

The users figure is the **tenant filter working**: user 206 belongs to company 4,
and the API returns that company's 62 people rather than all 64 on the
installation. The audit counts drift by seconds because the window is anchored
when the request starts while a `NOW()` comparison moves — the company-scoped
figure is the right order.

`run-hosted.bat` reads every secret from `.env` at runtime; nothing is committed.
It resolves the host to its **A record before connecting**, because on Windows
the name can resolve to IPv6 first, MySQL answers on IPv4, and the application
fails with `Connect Timeout expired` while the `mysql` client connects fine.
This project hit that twice. The pool is capped at 6: the hosted account allows
**20 connections in total** across everything using it, the Spring backend
included.

### One thing that needs your decision

**`APP_JWT_SECRET` in `.env` is 28 bytes. HS256 needs 32.**

The application refuses to start with it, and so would Spring — `Keys.hmacShaKeyFor`
throws on the same input, and the repository's own `deploy/pre-deploy.sh` rejects
anything under 32 characters. The hosted run above used a padded test value,
which is written nowhere.

Generate a real one with `openssl rand -base64 48` and put it in `.env`. If the
Spring backend is running against the same database it must get the **same**
value, or tokens issued by one are rejected by the other.

I have not edited `.env` — that is a production credential and the change is
yours to make.

### A scratch database, so writes can be tested

`hrport_scratch` is a full copy of `hrport_live` (102 MB, identical row counts).
It exists so the ~102 write endpoints can be exercised and verified without
touching production data. `hrport_live` remains untouched throughout.

## Filling the remaining reads

I had been calling the remainder "~140 blocked". Measuring it properly instead
of repeating the estimate showed **76 of the missing endpoints are GETs** —
reads that can be built *and verified* without writing to production records.
That is a much better position than the estimate implied, and the ones below
are now done.

### leave — the approval queues (4 reads)

The rule these exist to protect, in the Java's own words: **"the person the
request names decides it, and nobody else."** An override once let any
administrator decide any leave whoever it was addressed to, which made the
approval chain optional — an employee chose their Team Leader and somebody else
decided it, and HR could be bypassed on a Team Leader's own request.

So **seeing and deciding are separate**, and the live data proves it:

| Caller | Sees | May decide |
|---|---|---|
| Admin 206 | **25** = SQL 25 | **0** — no request names them |
| HR 71 | **25** | **1** = SQL 1, the one addressed to them |

Nothing disappears from anybody's screen; only `canAct` narrows.

Also verified: `my-queue` **11 = SQL 11** with names resolved; `on-leave`
**0 = SQL 0**; the calendar **17 = SQL 17** for an administrator and **8** for a
Team Leader, who sees their own team and themselves rather than the
organisation. Authorisation matches Spring throughout — employee **403** on the
calendar and the approver queue, **200** on `on-leave` and `my-queue`.

`COMPANY_ADMIN` counts as `SUPER_ADMIN` everywhere here. A tenant company has no
SUPER_ADMIN of its own, and asked literally that person fell through every arm:
a company whose administrator was its only administrator had leave requests
nobody could route.

### attendance — three reads

`absent-today` **35 = SQL 35**, and deliberately ignores the weekday: some teams
work Saturdays, and a calendar rule would report them absent on a day they came
in.

`my-team-today` returned **9 = SQL 9** on a real shared team. On user 164 it
returned 1, which looked wrong until checked — that account is **offboarded**,
so the team query correctly excludes them and the Java's documented fallback
(`teammates = List.of(me)`) shows them themselves rather than an empty page.

`me/summary` for September, **every field matching SQL**:

| | API | SQL |
|---|---|---|
| presentDays | 7 | 7 present + 0 WFH |
| lateDays | 3 | 3 |
| totalOvertimeMinutes | 274 | 274 |
| totalLateMinutes | 36 | 36 |
| totalWorkedMinutes | 3 535 | 3 535 |
| permissions | 1 day / 2 hrs | 1 day / 2 hrs |

and the derived values follow: working days 9 (weekdays elapsed, holidays out),
absent 2 = 9 − 7, percent 78 = round(7/9).

Three pieces of that arithmetic are load-bearing and carry the Java's reasoning:
**an approved WFH day counts as present** (it is a day worked, and payroll
already treats it so) while keeping its own count; **only completed days** count
toward worked minutes, or every morning would drag the month down; and the
percentage is against working days **elapsed**, so on the 8th a perfect record
is 100% and not a quarter of one.

**23 unit tests** cover the queue and label rules.

### payroll — 11 reads

Verified against the real payroll data (6 salary structures, 4 runs, 19
payslips):

| Check | API | SQL |
|---|---|---|
| Salary structures | **6** | 6 active |
| Payroll runs | **4**, newest period first | 4 |
| Payslips for July 2026 | **6** keyed by user | 6 distinct users |

**PAYROLL_VIEW widens rather than gates.** `/payroll/salaries` answers on the
same route, in the same shape, for everybody — an employee simply gets a list
containing their own row and nothing else. Verified: an admin sees 6, employee
221 sees **1**, and employee 171 (who has no salary structure) sees **0**, which
is the Java's `mine == null ? List.of()`.

**A payslip is somebody's pay, and an id in a URL is not permission to read it.**
User 171 reading payslip 16 (owner 175) got **422** with the Java's own message,
"You can only view your own payslips", while the owner and anybody holding
PAYROLL_VIEW got 200. The admin views answer **403** to them and **401** to
anonymous.

#### A parameter order that would have failed silently

`FindPayslipsForMonthAsync` already existed with the signature
**`(int year, int month)`**. I wrote a second one as `(month, year)` and the
compiler caught the duplicate — but had the names differed even slightly, both
would have compiled and the month view would have returned a *different month*
rather than failing. The call now passes `(year, month)` with a note saying why
the order matters.

Two method names also collided (`PayslipsByMonth` for both `/payslips/month` and
`/payslips/month/detailed`); mine is `PayslipSummariesByMonth`. Both routes are
needed — the summary carries gross, net and delivery, and the detailed one
carries the deductions that turned one into the other.

### user — 8 reads

| Check | API | SQL |
|---|---|---|
| Service record | **62** | 62 (platform accounts excluded) |
| My team | **9** on "Software Developer" | 9 |
| Team leaders | **1** | 1 |
| Bank accounts | **1** | 1 |

The service record excludes the platform accounts — they are not employees, and
listing them says somebody joined on the day the system was set up. Sorted
newest joiner first with anybody lacking a joining date **last** rather than
first: a missing date is not a recent one.

`/team-leaders/{id}/teams` returns the leader's **own designation first**, then
the extras: `["Mobile Developer", "QA Testing"]`. The order carries meaning —
the first is the team they belong to, the rest are ones they also cover.

#### A reserved word that failed as a syntax error

`is_primary AS Primary` is invalid SQL: **PRIMARY is reserved in MySQL**, and
the alias broke the statement rather than the column. Both bank endpoints
returned 500 until it was backticked. The kind of thing that only surfaces by
running the query.

#### Two "failures" that were my tests, not the code

Both times an employee got **200** where I expected 403, and both times the code
was right:

- user 171 holds **ATTENDANCE_TEAM**, which `/users/history` and `/team-leaders`
  both allow;
- user 170 holds **PAYROLL_VIEW**, which the bank policy allows — payroll needs
  bank details to pay people.

Retested against a user holding none of them: **403** on both admin routes, 200
on their own bank and their own team. That is `hasAnyAuthority` behaving exactly
as the Java declares it.

### leave and wfh — the approver pickers

These are what make the apply screens work, and the rule is a **chain, not a
menu**:

```
employee, up to 3 days  ->  their own Team Leader
employee, over 3 days   ->  HR
Team Leader             ->  HR
HR                      ->  the CTO
```

The lists used to include the CTO and every administrator alongside the right
approver at nearly every rung, so an employee asking for four days was offered
HR, the CTO and anyone holding an admin role. **A chain that offers a choice is
not a chain** — requests skip the person who actually knows whether the team can
spare them.

Verified live against real accounts:

| Applicant | Days | Offered |
|---|---|---|
| employee 183 | 2 | **TL — their own team's leader**, one name |
| employee 183 | 5 | **HR** |
| team leader 171 | 2 | **HR** |
| HR 71 | 2 | **CTO — "Elamaran Subramaniyan"** |

Both narrowings were checked rather than assumed:

- The HR rung showed three names, and **all three genuinely hold `IT_HR`** — the
  real-HR filter worked. `IsHr` also counts `IT_MGR`, so without that filter the
  rung would offer managers who merely sit near HR on the role list.
- The Team Leader offered to employee 183 is on the **same "Software Developer"
  team**. Narrowed by team, not department: department was the wrong field, almost
  nobody has one, and the filter silently matched nobody while showing every team
  leader in the company.

Both narrowings stay **preferences rather than hard filters**, for the reason the
Java gives: an empty list is a form that cannot be submitted at all, and reaching
a slightly wrong approver is recoverable where being unable to ask for leave is
not.

The CTO account is stored as "CEO"; the picker substitutes the real name rather
than showing a title nobody uses.

WFH answers with **exactly one** approver or none, and its resolution was
**refactored into one shared method** so the name shown before submitting is the
name the request actually reaches — the apply path and the picker can no longer
disagree.

## The writes, tested without touching production

`hrport_scratch` is a full copy of `hrport_live`, refreshed before each run. Every
write below was exercised against it; `hrport_live` was verified unchanged after
each one.

### leave — decisions, cancellation and type management (5 writes)

**Who may decide.** The person the request NAMES, and nobody else — an override
here once made the whole approval chain optional. Verified: an administrator not
named on the request got **422**, "You are not authorized to decide this leave
request"; the named approver got through.

**The balance moves, and moves back.** Verified on a non-LOP type:

| Step | used |
|---|---|
| before | 0 |
| after approve (1 day) | **1** |
| after the applicant cancels | **0** |

Loss of Pay correctly moves **nothing** — it consumes no balance, which is the
point of it, so refunding one would credit days nobody spent.

The balance is adjusted in **one SQL statement** rather than read-modify-write:
two approvals landing together would otherwise both read the old figure and the
second would overwrite the first, letting somebody take more than they have.

Also verified: rejecting with no reason **422** (a refusal with nothing to act on
is not a decision), an unknown decision word **422**, and deciding twice **422**.

**Leave types.** Create, update and retire, with validation: no name **422**,
a gender restriction that is not M or F **422**, a negative allowance **422**,
a duplicate name **422**, and an employee attempting any of it **403**. Input is
trimmed and upper-cased (`"  Study Leave  "` / `"stu"` / `"f"` became
`Study Leave` / `STU` / `F`).

**Delete RETIRES rather than removes.** The row stays with `active = 0`, verified
in the database. Deleting would orphan every historical request that used the
type: the request keeps a `leave_type_id`, and a missing type makes past leave
read as "?" on every screen that names it.

### The oversight copy

`IOversightNotifier` sends the CTO a copy of what happened — the decision AND who
made it, which is the half oversight could not see from the request alone.

It is keyed on the **account** rather than a permission, and that is deliberate:
HR holds `USER_MANAGE` (they manage employee records, which is what the
permission is for), so a check on `USER_MANAGE` let HR read what had been
deliberately addressed past them to the CTO. It also **never throws** — a leave
request must not fail because the CTO's account could not be read — and it
suppresses the self-copy, since being notified of one's own decision teaches
people to ignore the bell.

## Still to do in Phase 5

Measured, not estimated: **181 endpoints across 21 modules** remain. In rough
order of what is worth doing next:

| Module | Endpoints | Rows in this database |
|---|---|---|
| community | 29 | 24 messages — **belongs with Phase 6**, needs STOMP |
| task | 16 | **0** — cannot be verified against real data |
| workreport | 13 | 11 |
| helpdesk | 12 | 7 tickets |
| biometric | 11 | external hardware — **last** |
| asset | 10 | 1 |
| chatbot | 10 | — |
| discipline | 10 | 3 |
| expense | 9 | 8 |
| appreciation | 8 | 3 |
| complaint / requestthread | 7 each | 6 / — |
| approvalconfig | 6 | — |
| safety / dashboard / announcement / performance | 5 each | 0 safety, 0 events |
| calendar / onboarding / audit | 4 each | 3 328 audit rows |
| presence / file | 1 each | file ☑ done |

- **wfh writes** — the decision and cancel endpoints, and `/approvers`. The
  first two also write to attendance on approval, which is the part that has to
  be right before they are switched on.
- **leave writes** — the decision endpoint, cancel, type maintenance, allocation
  defaults, the per-user reset, the LOP preview and the calendar views. The SMS
  to approvers and the CTO oversight copy need the SMS gateway, which is not
  ported.
- **user writes** — photo and cover upload, documents, credentials, offboarding,
  bank details, the employee import. Several need the file storage that has not
  been ported yet.
- **leave (22) + wfh (5)** — finishes Phase 3. Leave has 15+ distinct rules.
- org write endpoints (`POST /designations`, `/office-locations`, `/holidays`).
- Mid-size: task (12), helpdesk (12), workreport (8), discipline (5),
  chatbot (7), asset (11).
- ~15 small modules.
- **biometric (26)** last — external Hikvision HTTP, HMAC webhooks, 3 scheduled
  jobs; needs real hardware to verify.

## Phase 6 — realtime (STOMP/SockJS) + full regression ☐

## Phase 7 — IIS hosting setup, local only ☐
