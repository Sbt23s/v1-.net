# Pixous HR Portal (.NET 10 + React + MySQL)

A modern, high-performance Human Resource & Operations Management System built with **React (TypeScript)**, **ASP.NET Core (.NET 10)**, and **MySQL (Flyway V154)**.

---

## 1. Architecture Overview

This repository contains the complete, self-contained implementation of the HR Portal:

```
├── web/                   # React 18 + TypeScript + Vite + Tailwind CSS Frontend
├── backend-dotnet/        # ASP.NET Core (.NET 10) Web API Backend
│   ├── Pixous.HrPortal.Domain/          # Domain Entities, DTOs, Business Interfaces
│   ├── Pixous.HrPortal.Infrastructure/  # BAL, DAL, Dapper Mappings, Real-time & Schedulers
│   ├── Pixous.HrPortal.Api/             # Controllers, Middleware, Auth & Swagger
│   └── tests/Pixous.HrPortal.Tests/     # 507 Automated Unit & Regression Tests
├── database/              # MySQL Database Schema & Migrations
│   └── migrations/                      # 124 Versioned SQL Migrations (V1 to V154)
├── start-all.bat          # One-click Windows Launcher (Backend + Frontend)
├── start-backend.bat      # Windows Launcher for .NET 10 Backend
├── start-frontend.bat     # Windows Launcher for React Frontend
└── publish-live-iis.bat   # Production Packaging for Windows Server IIS
```

### Reference Backend Architecture
The backend strictly follows a decoupled, maintainable layered design:
$$\text{Controller} \longrightarrow \text{IBAL} \longrightarrow \text{BAL} \longrightarrow \text{IDAL} \longrightarrow \text{DAL} \longrightarrow \text{Dapper} \longrightarrow \text{MySQL}$$

- **Controller**: HTTP request parsing, status codes, route mapping.
- **BAL (Business Access Layer)**: Business logic, validation, transaction coordination, notification dispatch.
- **DAL (Data Access Layer)**: Parameterized SQL queries using **Dapper** against MySQL.
- **Real-Time Layer**: Full **STOMP-over-SockJS** WebSocket broker compatible with React `@stomp/stompjs` clients on `/ws`.
- **Database Safety**: `SchemaSafetyGuard` verifies Flyway V154 compliance without running destructive migrations against live tables.

---

## 2. Core Functional Modules

1. **Authentication & Security**: JWT bearer authentication, multi-tenant RBAC permissions, refresh tokens, lockout protection.
2. **Attendance & Biometrics**: Geofenced GPS punch in/out, selfie capture, Hikvision biometric terminal webhooks & backfill.
3. **Leave & Permission Management**: Casual/Sick/Annual leave allocations, loss of pay (LOP) tracking, multi-tier approvals.
4. **Work From Home (WFH)**: Request lifecycle, manager approval, calendar synchronization.
5. **Tasks & Projects**: Kanban assignment, task chat, subtasks, deadline notifications.
6. **Performance & Appreciations**: KPI tracking, appreciation letters with automated PDF generation.
7. **Discipline & Grievances**: Incident reporting, show-cause notices, resolution tracking.
8. **Helpdesk & Support**: Ticket raising, SLA tracking, internal comments, status progression.
9. **Travel & Expense Claims (TA)**: Mileage reimbursement, receipt attachments, approver workflow.
10. **Asset Management**: Hardware inventory, employee allocation, return audits.
11. **Payroll & Payslips**: Salary structures, payroll processing runs, dynamic payslip PDF rendering.
12. **Community & Chat**: Team channels, rich messaging, voice notes, attachments.
13. **Announcements & Calendar**: Broadcast banners, mandatory read acknowledgments, holiday overlays.
14. **Technical Admin & Multi-Tenancy**: Company provisioning, feature flag toggles, audit trails.
15. **AI Assistant / Chatbot**: RAG-style knowledge base answers, live organizational queries.

---

## 3. Quick Start (Windows)

### Prerequisites
- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- [Node.js 18+](https://nodejs.org/)
- [MySQL 8.0+](https://dev.mysql.com/downloads/)

### One-Click Launch
1. Copy `.env.example` to `.env` and fill in your database credentials:
   ```cmd
   copy .env.example .env
   ```
2. Double-click **`start-all.bat`**. This starts:
   - **.NET 10 Backend**: `http://localhost:7060`
   - **React Frontend**: `http://localhost:5174`
   - **Swagger Docs**: `http://localhost:7060/swagger`
   - **Actuator Health**: `http://localhost:7060/actuator/health`

---

## 4. Automated Testing

Run the full regression test suite (507 tests):
```powershell
dotnet test backend-dotnet/tests/Pixous.HrPortal.Tests -c Release
```
*Guaranteed 100% test pass with 0 warnings and 0 compilation errors.*

---

## 5. Production Windows Server / IIS Deployment

To package both the backend and frontend for production Windows hosting:
```cmd
publish-live-iis.bat
```
- **Backend Publish**: `publish-backend-iis/` with in-process `AspNetCoreModuleV2` and WebSockets enabled in `web.config`.
- **Frontend Publish**: `web/dist/` with client-side SPA URL rewriting configured in `web.config`.

---

## 6. License
Proprietary — Pixous Technologies. All rights reserved.
