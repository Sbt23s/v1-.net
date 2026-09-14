-- One-time: clear old notifications so the bell starts fresh. Runs once on deploy.
DELETE FROM notifications;
