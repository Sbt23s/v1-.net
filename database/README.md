# MySQL Database Schema & Migrations

This directory contains the complete MySQL schema migrations for the Pixous HR Portal.

## Schema Versioning & Flyway Compatibility
- **Current Required Version**: `V154`
- **Migration Format**: Flyway versioned SQL (`V1__...sql` to `V154__...sql`)
- **Total Tables**: 108 application tables

## Safety & Governance
The ASP.NET Core (.NET 10) backend includes a strict `SchemaSafetyGuard` that verifies:
1. The database contains the `flyway_schema_history` table.
2. The schema version is at or beyond `V154`.
3. Zero migration machinery (EF Core Migrations, Flyway, DbUp, etc.) is loaded into the .NET runtime. The schema is owned by these versioned scripts and cannot be modified by the backend during runtime.

## Applying Migrations
To initialize a fresh local MySQL instance:
1. Create database:
   ```sql
   CREATE DATABASE hrport_live CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
2. Run migrations sequentially from `V1__init.sql` up to `V154__...sql`, or execute them via Flyway CLI:
   ```bash
   flyway -url="jdbc:mysql://localhost:3306/hrport_live" -user=root -password=root -locations="filesystem:./database/migrations" migrate
   ```
