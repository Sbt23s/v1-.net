# Hosting the .NET backend on Windows / IIS

Written for whoever installs this on the server. It assumes you know IIS and
have never seen this application.

Everything below was run and verified on a real publish, not written from
memory. Where something is a known gap it says so.

---

## What you need on the server

**1. The ASP.NET Core Hosting Bundle (.NET 10).**
This is the one that matters. It installs the runtime *and* the
`AspNetCoreModuleV2` IIS module, and without it the site returns
**HTTP 500.19** or **502.5** with nothing useful in the log.

Download the *Hosting Bundle*, not the SDK and not the plain runtime.
After installing, restart IIS so it picks the module up:

```
net stop was /y
net start w3svc
```

**2. The WebSocket feature.**

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebSockets
```

Skipping this is the failure worth knowing about, because **nothing looks
broken**. Every page loads, every button works, and notifications, presence and
chat simply go silent — the browser negotiates a WebSocket, IIS refuses the
upgrade, and the fallback transports are not implemented here (see
`REALTIME.md`). `web.config` enables WebSockets *for the site*; it cannot
install the Windows feature.

**3. MySQL reachable from the server**, with an account that can read and write
the portal database.

---

## Publishing

From the repository root:

```
dotnet publish backend-dotnet/Pixous.HrPortal.Api/Pixous.HrPortal.Api.csproj -c Release -o <folder>
```

Copy `<folder>` to the server, e.g. `C:\inetpub\hrportal`.

The publish is **framework-dependent** — it relies on the Hosting Bundle you
installed above, which the server needs anyway for the IIS module. It is about
30 files rather than the ~200MB a self-contained publish would be.

`appsettings.Development.json` and `appsettings.LiveReadOnly.json` are
**deliberately excluded**: they carry database passwords, nothing reads them
when the environment is Production, and a credential on a server that has no
use for it is a credential worth not having. This was found by grepping a real
publish, so it will stay found — the exclusion is in the `.csproj`.

---

## The two settings the application will not start without

It refuses to start rather than guessing, and says which one is missing. That
is deliberate: a default connection string points some deployment at the wrong
database, and a default signing key is a publicly known one.

| Setting | What it is |
|---|---|
| `ConnectionStrings__HrPortal` | The MySQL connection string |
| `App__Jwt__Secret` | The JWT signing key, **at least 32 bytes** |

**`App__Jwt__Secret` must be byte-for-byte the same as the Spring backend's
`APP_JWT_SECRET`** for as long as both run side by side. They sign each other's
tokens; a mismatch means every user of one is rejected by the other, and the
symptom is a login that appears to succeed and then 401s on the next request.
The repository's own `deploy/pre-deploy.sh` enforces the same 32-byte minimum.

### Where to put them

**Not in `web.config`** — it is committed to source control. Use the
application pool's environment variables:

> IIS Manager → the site → **Configuration Editor** →
> `system.webServer/aspNetCore` → `environmentVariables` → add each one

or set them as machine-level environment variables and restart the pool.

A connection string that works, as a shape to copy:

```
Server=127.0.0.1;Port=3306;Database=<db>;User Id=<user>;Password=<pass>;SslMode=None;AllowPublicKeyRetrieval=true;
```

**Use `127.0.0.1`, not `localhost`.** This has bitten this project twice: on
Windows, `localhost` can resolve to IPv6 first, MySQL listens on IPv4, and the
application fails with `Connect Timeout expired` while the `mysql` command-line
client connects perfectly. The symptom looks like a dead database and is not.

---

## The site in IIS

1. **Application pool** → .NET CLR version **"No Managed Code"**.
   The pool does not run .NET Framework code; the module starts your process.
2. **Physical path** → the folder you copied.
3. The pool identity needs **read** on that folder, and **write** only if you
   turn on stdout logging.

`web.config` sets the rest and is already in the publish: in-process hosting,
`ASPNETCORE_ENVIRONMENT=Production`, a 25MB request limit, the `X-Powered-By`
header removed, and WebSockets enabled for the site.

### Upload limits

25MB per request, 10MB per file — matching
`spring.servlet.multipart.max-request-size` in `application.properties`.

Note that the two Spring config files disagree: `application.yml` says 10GB and
`application.properties` says 10MB/25MB. **Properties wins in Spring Boot**, so
25MB is the limit actually in force, and it is the one reproduced here.

The limit is set in **two places that must agree** — `maxAllowedContentLength`
in `web.config` and the Kestrel/IIS options in `Program.cs`. If IIS is the
stricter one, an oversized upload is refused by IIS with its own error page and
the user sees a wall of markup instead of the portal's message.

---

## Checking it works

```powershell
# 1. It is up, and secure by default
curl.exe -i http://localhost/api/users          # expect 401, not 500

# 2. Real time is actually working  -- the one people forget
curl.exe http://localhost/ws/info               # expect {"websocket":true,...}
```

If `/ws/info` answers but the portal's notifications never arrive, the Windows
WebSocket feature is missing. That is the single most likely misconfiguration
and the hardest to notice.

### Verified on a real publish

- Refuses to start with a clear message when either secret is absent
- Starts clean with them supplied: **0 startup errors**
- Serves: anonymous **401**, authenticated **200**
- Scheduled jobs start and tick
- Swagger is **404** in Production, and the development-only publish hook is
  not reachable
- A real module write was **delivered live over STOMP/SockJS** on the published
  Production build

---

## When something is wrong

**500.19** — the Hosting Bundle is missing, or the pool is not "No Managed Code".

**502.5** — the process failed to start. Turn on stdout logging to see why:

```xml
<aspNetCore ... stdoutLogEnabled="true" stdoutLogFile=".\logs\stdout">
```

Create the `logs` folder, give the pool identity write access, reproduce, then
**turn it off again**. It writes an unbounded file, and a forgotten stdout log
is how a disk fills up months later. The commonest cause is one of the two
required settings being absent — the log says which.

**Login works, then everything 401s** — `App__Jwt__Secret` does not match the
Spring backend's.

**Notifications and chat are silent, everything else fine** — the WebSocket
feature is not installed.

---

## What is not covered here

- **HTTPS / certificates** — a normal IIS binding, no different for this app.
- **The React frontend** — served separately; its Vite proxy already points at
  this API and needs no change.
- **`App:Cors:AllowedOrigins`** — set it in `appsettings.Production.json` to the
  real public origin. Left empty, the `/ws` endpoint accepts a socket from any
  origin, which keeps a misconfigured setup working rather than silently mute —
  but it means the one channel carrying notifications, presence and chat has no
  origin check on it.
- **Running both backends at once** — supported, and the reason the JWT secret
  must match. They share the database.
