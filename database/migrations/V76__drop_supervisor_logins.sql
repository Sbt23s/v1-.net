-- ============================================================
-- V76 — the two supervisor logins come off again.
--
-- V75 created an Infra Admin and two supervisors. Only the Infra
-- Admin is wanted, so supervisor1 and supervisor2 are removed.
--
-- V75 itself is left exactly as it is: Flyway records a checksum for
-- an applied migration, and editing one already run stops the
-- application from starting.
--
-- The two accounts were created by that migration and were never
-- used, so nothing of anyone's work goes with them. Their role rows
-- fall away with them through ON DELETE CASCADE.
--
-- infra.admin is untouched, as are both Infra teams and every
-- Digital record.
-- ============================================================

DELETE FROM users WHERE username IN ('supervisor1', 'supervisor2');
