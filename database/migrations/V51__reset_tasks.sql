-- One-time: clear all tasks so Tasks starts fresh. Runs once on deploy.
-- Employees, logins and everything else are untouched.
DELETE FROM tasks;
