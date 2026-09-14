-- Per-employee tech stack (comma-separated skills/technologies), shown and
-- edited on the Teams page.
ALTER TABLE users ADD COLUMN tech_stack VARCHAR(255) NULL;
