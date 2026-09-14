-- ============================================================
-- V71 — a readable-back copy of each account's password.
--
-- HR and the admin need to see an employee's actual password on
-- the record, not only be able to replace it. password_hash is
-- BCrypt and one-way, so it cannot answer that; this column holds
-- the same password encrypted with AES-GCM under a key derived
-- from APP_JWT_SECRET (see PasswordVault.java).
--
-- Signing in is unchanged: it still checks password_hash.
--
-- Existing rows stay NULL. Nothing can fill them in — the old
-- passwords exist only as hashes — so they read as "not recorded"
-- until the password is set again through Reset Login.
-- ============================================================

ALTER TABLE users ADD COLUMN password_vault VARCHAR(255) NULL AFTER password_hash;
